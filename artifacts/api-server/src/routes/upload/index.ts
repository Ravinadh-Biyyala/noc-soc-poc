import { Router, type Request, type Response } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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
      const nums = nonNull.map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        info.min = Math.min(...nums);
        info.max = Math.max(...nums);
        info.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      }
    }

    return info;
  });

  return {
    name: sheetName,
    rowCount: jsonData.length,
    columns,
    sampleRows: jsonData.slice(0, 8),
  };
}

router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheets: SheetSummary[] = workbook.SheetNames.map((name) =>
      analyzeSheet(workbook.Sheets[name], name)
    ).filter((s) => s.rowCount > 0);

    if (sheets.length === 0) {
      res.status(400).json({ error: "No data found in the uploaded file" });
      return;
    }

    const result: UploadResult = {
      fileName: req.file.originalname,
      sheets,
    };

    res.json(result);
  } catch (error: any) {
    console.error("Upload error:", error);
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

      return `Sheet "${sheet.name}" (${sheet.rowCount} rows):\n${colDescriptions.join("\n")}\n\nSample data (first 5 rows):\n${JSON.stringify(sheet.sampleRows.slice(0, 5), null, 1)}`;
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
    console.error("Dashboard generation error:", error);
    res.status(500).json({ error: "Failed to generate dashboard: " + (error.message || "Unknown error") });
  }
});

export default router;
