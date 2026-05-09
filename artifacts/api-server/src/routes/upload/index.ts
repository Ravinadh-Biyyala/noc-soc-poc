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

// ---------------------------------------------------------------------------
// Deterministic insight engine
//
// We used to hand the LLM the raw rows and ask it to "be creative". That is
// what produced the random-quality / sometimes-empty charts: the model would
// invent xKey/yKey pairings with the wrong types (numeric column on the X
// axis of a bar chart, etc.), or hallucinate data arrays that didn't match
// the real numbers.
//
// New approach: we *compute* the chart drafts ourselves — top-N categories,
// monthly trends, distributions, correlations — using the prepared rows.
// The LLM is only allowed to write the dashboard's narrative (titles,
// subtitles, KPI labels). It cannot change a chart's type, keys, or data.
// This guarantees three things:
//   1. Every chart has real, well-shaped, non-empty data (no axis-only bars)
//   2. The same dataset always surfaces the same key insights
//   3. We can completely degrade the LLM call without breaking the dashboard
// ---------------------------------------------------------------------------

type SheetRow = Record<string, unknown>;

interface ChartDraft {
  id: string;
  type: string;
  xKey: string;
  yKey: string;
  data: SheetRow[];
  defaultTitle: string;
  defaultSubtitle: string;
  insightTag: string; // hint for the LLM ("trend:revenue-by-month", etc.)
}

interface DraftKpi {
  label: string;
  value: number;
  format?: "currency" | "number" | "percent";
  icon?: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isQuantityName(name: string): boolean {
  return /(revenue|sales|amount|total|value|price|cost|profit|spend|count|qty|units|score|speed|rate|range)/i.test(name);
}

function isCurrencyName(name: string): boolean {
  return /(revenue|sales|amount|price|cost|profit|spend|value)/i.test(name);
}

function pickPrimaryNumeric(cols: ColumnInfo[]): ColumnInfo {
  return cols.find((c) => isQuantityName(c.name)) ?? cols[0];
}

function topNCategorical(rows: SheetRow[], col: string, n: number): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined || v === "") continue;
    const k = String(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function aggregateByCategory(
  rows: SheetRow[],
  catCol: string,
  numCol: string,
  agg: "sum" | "mean",
  n: number,
): { name: string; value: number }[] {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const cv = r[catCol];
    if (cv === null || cv === undefined || cv === "") continue;
    const nv = num(r[numCol]);
    if (nv === null) continue;
    const k = String(cv);
    const b = buckets.get(k) ?? { sum: 0, count: 0 };
    b.sum += nv;
    b.count++;
    buckets.set(k, b);
  }
  return [...buckets.entries()]
    .map(([name, b]) => ({ name, value: agg === "sum" ? b.sum : b.sum / b.count }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

function trendByMonth(rows: SheetRow[], dateCol: string, numCol: string): { month: string; value: number }[] {
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const dv = r[dateCol];
    if (dv === null || dv === undefined || dv === "") continue;
    const d = dv instanceof Date ? dv : new Date(String(dv));
    if (isNaN(d.getTime())) continue;
    const nv = num(r[numCol]);
    if (nv === null) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + nv);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, value]) => ({ month, value }));
}

function pearson(rows: SheetRow[], a: string, b: string): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of rows) {
    const x = num(r[a]);
    const y = num(r[b]);
    if (x === null || y === null) continue;
    xs.push(x);
    ys.push(y);
  }
  const n = xs.length;
  if (n < 5) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n;
  my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

function distribution(rows: SheetRow[], col: string, bins: number): { name: string; value: number }[] {
  const vals: number[] = [];
  for (const r of rows) {
    const v = num(r[col]);
    if (v !== null) vals.push(v);
  }
  if (vals.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  if (min === max) return [{ name: min.toFixed(2), value: vals.length }];
  const w = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const v of vals) {
    const i = Math.min(bins - 1, Math.floor((v - min) / w));
    counts[i]++;
  }
  const fmt = (n: number) => Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(1);
  return counts.map((c, i) => ({
    name: `${fmt(min + i * w)}–${fmt(min + (i + 1) * w)}`,
    value: c,
  }));
}

/**
 * Build a ranked list of chart drafts from the prepared rows. Each draft
 * already has its `data` array materialised — the LLM only re-titles them.
 */
function buildInsightPlan(sheet: SheetSummary): ChartDraft[] {
  const rows = (sheet.rows && sheet.rows.length ? sheet.rows : sheet.sampleRows) as SheetRow[];
  if (!rows.length) return [];

  const numericCols = sheet.columns.filter((c) => c.type === "number");
  // Prefer date columns whose name actually reads like a date — guards against
  // numeric ID columns that XLSX coerces to Date objects (e.g. OrderID = 1001
  // becomes year-1001-01-01). Falls back to any date-typed column.
  const dateCols = [...sheet.columns.filter((c) => c.type === "date")].sort(
    (a, b) => Number(/(date|time|day|month|year|created|updated)/i.test(b.name))
            - Number(/(date|time|day|month|year|created|updated)/i.test(a.name)),
  );
  // Only categorical columns that actually segment the data well: at least 2
  // distinct values, capped at 50 (above that, every chart turns to mush).
  // Drop ID-looking columns — they're high-cardinality noise, not segments.
  const catCols = sheet.columns.filter(
    (c) =>
      (c.type === "string" || c.type === "boolean") &&
      c.uniqueCount >= 2 &&
      c.uniqueCount <= 50 &&
      !/(^id$|_id$|uuid|guid)/i.test(c.name),
  );

  const drafts: ChartDraft[] = [];
  let i = 0;
  const used = new Set<string>(); // dedupe by insightTag

  const push = (d: Omit<ChartDraft, "id"> & { id?: string }) => {
    if (used.has(d.insightTag)) return;
    if (!d.data || d.data.length < 2) return;
    used.add(d.insightTag);
    drafts.push({ ...d, id: d.id ?? `chart-${i++}` });
  };

  // 1. Trend over time — strongest narrative when a date column exists.
  if (dateCols.length && numericCols.length) {
    const d = dateCols[0];
    const y = pickPrimaryNumeric(numericCols);
    const data = trendByMonth(rows, d.name, y.name);
    push({
      type: "area",
      xKey: "month",
      yKey: "value",
      data,
      defaultTitle: `${y.name} over time`,
      defaultSubtitle: `Monthly ${y.name} trend across the dataset`,
      insightTag: `trend:${d.name}:${y.name}`,
    });
  }

  // 2. Top categories by primary numeric (sum) — the "who's winning" chart.
  if (catCols.length && numericCols.length) {
    const c = catCols[0];
    const y = pickPrimaryNumeric(numericCols);
    const data = aggregateByCategory(rows, c.name, y.name, "sum", 10);
    push({
      type: "bar",
      xKey: "name",
      yKey: "value",
      data,
      defaultTitle: `Top ${c.name} by ${y.name}`,
      defaultSubtitle: `Total ${y.name} per ${c.name}`,
      insightTag: `top-sum:${c.name}:${y.name}`,
    });
  }

  // 3. Composition (donut) — mix of records by lowest-cardinality categorical.
  if (catCols.length) {
    const c = [...catCols].sort((a, b) => a.uniqueCount - b.uniqueCount)[0];
    const top = topNCategorical(rows, c.name, 8);
    const data = top.map((d) => ({ name: d.name, value: d.count }));
    push({
      type: "donut",
      xKey: "name",
      yKey: "value",
      data,
      defaultTitle: `${c.name} mix`,
      defaultSubtitle: `Share of records by ${c.name}`,
      insightTag: `mix:${c.name}`,
    });
  }

  // 4. Mean comparison — different category × different metric, by mean.
  if (catCols.length && numericCols.length) {
    const c = catCols[Math.min(1, catCols.length - 1)];
    const y = numericCols[Math.min(1, numericCols.length - 1)];
    const data = aggregateByCategory(rows, c.name, y.name, "mean", 8);
    push({
      type: "horizontal-bar",
      xKey: "name",
      yKey: "value",
      data,
      defaultTitle: `Average ${y.name} by ${c.name}`,
      defaultSubtitle: `Where ${y.name} runs highest on average`,
      insightTag: `mean:${c.name}:${y.name}`,
    });
  }

  // 5. Strongest correlation among numeric pairs.
  if (numericCols.length >= 2) {
    let best: { a: string; b: string; r: number } | null = null;
    for (let a = 0; a < numericCols.length; a++) {
      for (let b = a + 1; b < numericCols.length; b++) {
        const r = pearson(rows, numericCols[a].name, numericCols[b].name);
        if (!best || Math.abs(r) > Math.abs(best.r)) {
          best = { a: numericCols[a].name, b: numericCols[b].name, r };
        }
      }
    }
    if (best && Math.abs(best.r) >= 0.3) {
      const data: SheetRow[] = [];
      for (const r of rows) {
        const x = num(r[best.a]);
        const y = num(r[best.b]);
        if (x !== null && y !== null) data.push({ [best.a]: x, [best.b]: y });
        if (data.length >= 200) break;
      }
      push({
        type: "scatter",
        xKey: best.a,
        yKey: best.b,
        data,
        defaultTitle: `${best.a} vs ${best.b}`,
        defaultSubtitle: `${best.r > 0 ? "Positive" : "Negative"} correlation (r = ${best.r.toFixed(2)})`,
        insightTag: `corr:${best.a}:${best.b}`,
      });
    }
  }

  // 6. Distribution histogram of primary numeric — outlier / shape view.
  if (numericCols.length) {
    const y = pickPrimaryNumeric(numericCols);
    const data = distribution(rows, y.name, 8);
    push({
      type: "bar",
      xKey: "name",
      yKey: "value",
      data,
      defaultTitle: `Distribution of ${y.name}`,
      defaultSubtitle: `How ${y.name} values are spread across the dataset`,
      insightTag: `dist:${y.name}`,
    });
  }

  return drafts;
}

function buildKpis(sheet: SheetSummary): DraftKpi[] {
  const rows = (sheet.rows && sheet.rows.length ? sheet.rows : sheet.sampleRows) as SheetRow[];
  const kpis: DraftKpi[] = [];

  kpis.push({ label: "Total records", value: sheet.rowCount, format: "number", icon: "Hash" });

  const numericCols = sheet.columns.filter((c) => c.type === "number");
  const primary = numericCols.length ? pickPrimaryNumeric(numericCols) : null;
  if (primary) {
    let sum = 0;
    let cnt = 0;
    for (const r of rows) {
      const v = num(r[primary.name]);
      if (v !== null) { sum += v; cnt++; }
    }
    if (cnt > 0) {
      const cur = isCurrencyName(primary.name);
      kpis.push({
        label: `Total ${primary.name}`,
        value: sum,
        format: cur ? "currency" : "number",
        icon: cur ? "DollarSign" : "BarChart3",
      });
      kpis.push({
        label: `Avg ${primary.name}`,
        value: sum / cnt,
        format: cur ? "currency" : "number",
        icon: "Activity",
      });
    }
  }

  const catCols = sheet.columns.filter(
    (c) => (c.type === "string" || c.type === "boolean") && c.uniqueCount >= 2,
  );
  if (catCols.length) {
    kpis.push({
      label: `Distinct ${catCols[0].name}`,
      value: catCols[0].uniqueCount,
      format: "number",
      icon: "Users",
    });
  }

  return kpis.slice(0, 4);
}

router.post("/generate-dashboard", async (req: Request, res: Response) => {
  try {
    const { sheets, fileName } = req.body as { sheets: SheetSummary[]; fileName: string };

    if (!sheets || sheets.length === 0) {
      res.status(400).json({ error: "No sheet data provided" });
      return;
    }

    // Multi-sheet datasets are joined client-side in DataPrep before they get
    // here, so we only need to plan against the first (final) sheet.
    const primary = sheets[0];
    const drafts = buildInsightPlan(primary);
    const baseKpis = buildKpis(primary);

    // Edge case: pure free-text or empty data — never return an empty
    // dashboard, fall back to a one-table preview.
    if (drafts.length === 0) {
      const previewRows = (primary.rows ?? primary.sampleRows).slice(0, 10);
      res.json({
        title: fileName.replace(/\.[^.]+$/, "") || "Dataset overview",
        subtitle: `${primary.rowCount} records, ${primary.columns.length} columns`,
        kpis: baseKpis,
        charts: [],
        tables: previewRows.length
          ? [{
              id: "preview",
              title: "Data preview",
              columns: primary.columns.slice(0, 8).map((c) => c.name),
              data: previewRows,
            }]
          : [],
      });
      return;
    }

    // Ask the LLM only to *narrate* the deterministic plan. It cannot alter
    // chart types, keys, or data — only the prose. If the call fails or
    // returns garbage, the deterministic defaults still render fine.
    const insightSummary = drafts
      .map((d) => `- id="${d.id}" type=${d.type} insight=${d.insightTag} default_title="${d.defaultTitle}" rows=${d.data.length}`)
      .join("\n");

    const dataSummary = primary.columns
      .map((c) => {
        const range =
          c.type === "number" && c.min !== undefined && c.max !== undefined
            ? ` range ${c.min.toFixed(2)}–${c.max.toFixed(2)}`
            : "";
        const samples = c.sample.slice(0, 3).map((s) => JSON.stringify(s)).join(", ");
        return `  - "${c.name}" (${c.type}, ${c.uniqueCount} unique${range}) e.g. ${samples}`;
      })
      .join("\n");

    const systemPrompt = `You are a senior data analyst writing executive-ready titles for a dashboard.
You receive a list of pre-computed chart drafts. Your only job is the narrative:
1. Pick a striking dashboard TITLE (5-7 words) and a one-line SUBTITLE.
2. For each chart draft, write a creative TITLE (a headline like a data journalist) and a one-line SUBTITLE that names the actual finding when possible (e.g. "Mercedes leads with 31% share").
3. For each KPI, choose a short LABEL and an optional TREND phrase if you can infer one from the data; pick a Lucide icon name.
You MUST NOT invent new charts, change chart types, keys, or alter the data. Return EXACTLY one entry per draft id, in the same order.

Respond with valid JSON only (no markdown):
{
  "title": "...",
  "subtitle": "...",
  "kpiOverrides": [{"label": "...", "trend": "...optional...", "icon": "Lucide-icon-name"}],
  "chartOverrides": [{"id": "...", "title": "...", "subtitle": "..."}]
}`;

    const sampleRows = (primary.rows ?? primary.sampleRows).slice(0, 8);
    const userMessage = `File: ${fileName}
Sheet: "${primary.name}" (${primary.rowCount} rows)

Columns:
${dataSummary}

Pre-computed KPIs (write better labels + trend prose):
${baseKpis.map((k, i) => `  ${i}. ${k.label} = ${k.value} (${k.format ?? "number"})`).join("\n")}

Pre-computed chart drafts (write better titles + subtitles):
${insightSummary}

Sample rows:
${JSON.stringify(sampleRows, null, 1)}`;

    let narrative: {
      title?: string;
      subtitle?: string;
      kpiOverrides?: Array<{ label?: string; trend?: string; icon?: string }>;
      chartOverrides?: Array<{ id?: string; title?: string; subtitle?: string }>;
    } | null = null;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        max_completion_tokens: 2048,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
      });
      const content = response.choices[0]?.message?.content;
      if (content) narrative = JSON.parse(content);
    } catch (llmErr: unknown) {
      // Soft-fail: the deterministic defaults are good enough on their own.
      req.log.warn({ err: llmErr }, "Narrative LLM call failed, using deterministic defaults");
    }

    const kpis = baseKpis.map((k, i) => {
      const o = narrative?.kpiOverrides?.[i];
      return {
        label: o?.label || k.label,
        value: k.value,
        format: k.format,
        trend: o?.trend,
        icon: o?.icon || k.icon,
      };
    });

    const overridesById = new Map<string, { title?: string; subtitle?: string }>();
    if (Array.isArray(narrative?.chartOverrides)) {
      for (const o of narrative.chartOverrides) {
        if (o?.id) overridesById.set(String(o.id), { title: o.title, subtitle: o.subtitle });
      }
    }

    const charts = drafts
      .map((d) => {
        const o = overridesById.get(d.id);
        return {
          id: d.id,
          type: d.type,
          title: o?.title || d.defaultTitle,
          subtitle: o?.subtitle || d.defaultSubtitle,
          xKey: d.xKey,
          yKey: d.yKey,
          data: d.data,
        };
      })
      // Final guard: empty data must never reach the client.
      .filter((c) => Array.isArray(c.data) && c.data.length > 0);

    res.json({
      title: narrative?.title || fileName.replace(/\.[^.]+$/, "") || "Dataset overview",
      subtitle: narrative?.subtitle || `${primary.rowCount} records analyzed`,
      kpis,
      charts,
      tables: [],
    });
  } catch (error: any) {
    req.log.error({ err: error }, "Dashboard generation error");
    res.status(500).json({ error: "Failed to generate dashboard: " + (error.message || "Unknown error") });
  }
});

export default router;
