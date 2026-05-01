import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024; // 60 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// Custom multer error handler — translate raw multer errors into friendly JSON
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `File too large. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
        });
        return;
      }
      res.status(400).json({ error: err.message || "Upload failed" });
      return;
    }
    next();
  });
}

interface ColumnInfo {
  name: string;
  type: "number" | "string" | "date" | "boolean" | "mixed";
  sample: unknown[];
  uniqueCount: number;
  nullCount: number;
  min?: number;
  max?: number;
  mean?: number;
}

interface SheetSummary {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
  sampleRows: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  returnedRowCount?: number;
}

interface UploadResult {
  fileName: string;
  sheets: SheetSummary[];
}

function detectColumnType(values: unknown[]): ColumnInfo["type"] {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "string";

  let numCount = 0;
  let dateCount = 0;
  let boolCount = 0;

  for (const v of nonNull.slice(0, 100)) {
    if (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== "")) numCount++;
    else if (typeof v === "boolean") boolCount++;
    else if (v instanceof Date || (typeof v === "string" && !isNaN(Date.parse(v)) && v.length > 6)) dateCount++;
  }

  const total = Math.min(nonNull.length, 100);
  if (numCount / total > 0.8) return "number";
  if (dateCount / total > 0.8) return "date";
  if (boolCount / total > 0.8) return "boolean";
  return "string";
}

function analyzeSheet(sheet: XLSX.WorkSheet, sheetName: string): SheetSummary {
  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (jsonData.length === 0) {
    return { name: sheetName, rowCount: 0, columns: [], sampleRows: [] };
  }

  const colNames = Object.keys(jsonData[0]);
  const columns: ColumnInfo[] = colNames.map((name) => {
    const values = jsonData.map((row) => row[name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
    const type = detectColumnType(values);

    const info: ColumnInfo = {
      name,
      type,
      sample: nonNull.slice(0, 5),
      uniqueCount: new Set(nonNull.map(String)).size,
      nullCount: values.length - nonNull.length,
    };

    if (type === "number") {
      // Avoid Math.min(...nums) — spread blows the call stack past ~64k args.
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = 0;
      for (const v of nonNull) {
        const n = Number(v);
        if (!isNaN(n)) {
          if (n < min) min = n;
          if (n > max) max = n;
          sum += n;
          count++;
        }
      }
      if (count > 0) {
        info.min = min;
        info.max = max;
        info.mean = sum / count;
      }
    }

    return info;
  });

  return {
    name: sheetName,
    rowCount: jsonData.length,
    columns,
    sampleRows: jsonData.slice(0, 8),
    rows: jsonData,
  };
}

// Cap rows returned to the browser. Larger files are still accepted (we keep the
// real rowCount and column stats from the full sheet), but the row payload is
// truncated so that:
//   - the response body stays under ~50 MB
//   - JSON parsing and React rendering on the client don't freeze the main thread
//   - downstream joins/filters/aggs run in milliseconds, not seconds
const MAX_ROWS_PER_SHEET = 100_000;

router.post("/upload", handleUpload, async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheets = workbook.SheetNames.map((name) =>
      analyzeSheet(workbook.Sheets[name], name)
    ).filter((s) => s.rowCount > 0);

    if (sheets.length === 0) {
      res.status(400).json({ error: "No data found in the uploaded file" });
      return;
    }

    // Truncate per-sheet rows to keep the wire payload small, but preserve the
    // true rowCount and the column stats (computed over the full sheet earlier).
    const trimmedSheets = sheets.map((s) => {
      if (!s.rows || s.rows.length <= MAX_ROWS_PER_SHEET) return { ...s, truncated: false };
      return {
        ...s,
        rows: s.rows.slice(0, MAX_ROWS_PER_SHEET),
        truncated: true,
        returnedRowCount: MAX_ROWS_PER_SHEET,
      };
    });

    const result: UploadResult = {
      fileName: req.file.originalname,
      sheets: trimmedSheets,
    };

    res.json(result);
  } catch (error: any) {
    req.log.error({ err: error }, "Upload error");
    res.status(500).json({ error: "Failed to parse file: " + (error.message || "Unknown error") });
  }
});

const VIZ_TYPES = [
  "area", "bar", "line", "pie", "donut", "scatter", "radar",
  "treemap", "horizontal-bar", "stacked-bar", "stacked-area",
  "gauge", "waterfall", "heatmap", "bubble", "progress-bar", "number-card",
];

router.post("/generate-dashboard", async (req: Request, res: Response) => {
  try {
    const { sheets, fileName } = req.body as { sheets: SheetSummary[]; fileName: string };

    if (!sheets || sheets.length === 0) {
      res.status(400).json({ error: "No sheet data provided" });
      return;
    }

    const MAX_ROWS_IN_PROMPT = 150;

    const sheetsContext = sheets.map((sheet) => {
      const colDescriptions = sheet.columns.map((col) => {
        let desc = `  - "${col.name}" (${col.type}, ${col.uniqueCount} unique values)`;
        if (col.type === "number" && col.min !== undefined) {
          desc += ` range: ${col.min.toFixed(2)}–${col.max!.toFixed(2)}, avg: ${col.mean!.toFixed(2)}`;
        }
        if (col.type === "string") {
          desc += ` samples: ${col.sample.slice(0, 4).map((s) => `"${s}"`).join(", ")}`;
        }
        return desc;
      });

      // Use actual rows if provided (from data prep pipeline), capped for token budget
      const fullRows = sheet.rows && sheet.rows.length > 0 ? sheet.rows : sheet.sampleRows;
      const dataForPrompt = fullRows.slice(0, MAX_ROWS_IN_PROMPT);
      const omitted = fullRows.length - dataForPrompt.length;
      const dataLabel = omitted > 0
        ? `Data (${dataForPrompt.length} of ${fullRows.length} rows shown — aggregate/sample as needed):`
        : `Data (all ${fullRows.length} rows):`;

      return `Sheet "${sheet.name}" (${sheet.rowCount} rows):\n${colDescriptions.join("\n")}\n\n${dataLabel}\n${JSON.stringify(dataForPrompt, null, 1)}`;
    });

    const systemPrompt = `You are an expert data visualization designer inspired by Tableau Public and McKinsey dashboards.
You analyze datasets and create stunning, diverse dashboard configurations.

CRITICAL RULES:
1. NEVER repeat the same chart type in a single dashboard. Each visualization MUST be a different type.
2. Use these viz types (pick 6-10 for a dashboard): ${VIZ_TYPES.join(", ")}
3. Prioritize PICTORIAL and VISUAL chart types (treemap, donut, gauge, scatter, radar, bubble, heatmap) over simple bar/line charts.
4. Create 3-5 number-card KPIs at the top summarizing key metrics.
5. Generate REAL computed values from the actual data provided, not placeholders.
6. Each chart must have a creative, insightful title (like a data journalist would write).
7. Charts should tell a STORY — show comparisons, trends, distributions, outliers.
8. For multi-sheet data, create cross-sheet analysis where possible.
9. Use the actual column names and data values from the dataset.

Respond with ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "title": "Dashboard title based on data theme",
  "subtitle": "One-line data description",
  "kpis": [
    { "label": "KPI Name", "value": "computed value", "format": "currency|number|percent", "trend": "+X% vs prior", "icon": "lucide-icon-name" }
  ],
  "charts": [
    {
      "id": "unique-id",
      "type": "one of: ${VIZ_TYPES.join("|")}",
      "title": "Creative insight title",
      "subtitle": "What this chart reveals",
      "dataKey": "sheet-name",
      "xKey": "column for x-axis or category",
      "yKey": "column for values (or array for multi-series)",
      "colorKey": "optional column for color grouping",
      "data": [actual computed/aggregated data array, max 20 items],
      "config": { any extra config like "innerRadius", "showLabels", "orientation" }
    }
  ],
  "tables": [
    {
      "id": "unique-id",
      "title": "Table title",
      "columns": ["col1", "col2"],
      "data": [first 10 rows of relevant data],
      "highlightColumn": "optional column name to highlight"
    }
  ]
}

IMPORTANT: Aggregate and transform the raw data into meaningful visualizations. Don't just dump raw rows.
For example: group by category and sum values, compute percentages, find top N items, calculate trends.
Make each chart reveal a unique insight. Think like a data analyst presenting to executives.`;

    const userMessage = `Analyze this dataset and generate a creative, diverse dashboard:\n\nFile: ${fileName}\n\n${sheetsContext.join("\n\n---\n\n")}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "AI returned empty response" });
      return;
    }

    const dashboardConfig = JSON.parse(content);
    res.json(dashboardConfig);
  } catch (error: any) {
    req.log.error({ err: error }, "Dashboard generation error");
    res.status(500).json({ error: "Failed to generate dashboard: " + (error.message || "Unknown error") });
  }
});

export default router;
