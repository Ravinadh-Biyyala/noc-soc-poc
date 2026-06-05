/**
 * Deterministic data-science helpers used by AdvancedAnalytics.
 * Everything here runs client-side on prepared rows so we can show real
 * predictive / segmentation output without a server round-trip and without
 * the LLM hallucinating numbers. Each function is intentionally small,
 * dependency-free and pure so it's easy to swap in a heavier engine later.
 */

export interface ColumnInfo {
  name: string;
  type: "number" | "string" | "date" | "boolean";
  uniqueCount?: number;
  min?: number;
  max?: number;
}

export type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 1. Fitness classifier — should we surface a "data scientist" experience?
// ---------------------------------------------------------------------------

export interface DSClassification {
  recommended: boolean;
  score: number; // 0–100
  reasons: string[];
  /** Things we *can* run given the columns present. */
  capabilities: {
    correlation: boolean;
    forecast: { dateCol: string; numericCol: string } | null;
    clusters: { cols: [string, string] } | null;
    anomalies: string[]; // numeric cols good for z-score
  };
}

const NUMERIC = (c: ColumnInfo) => c.type === "number";
const DATE = (c: ColumnInfo) => c.type === "date";

export function classifyDataScienceFitness(
  rows: Row[],
  columns: ColumnInfo[],
): DSClassification {
  const reasons: string[] = [];
  let score = 0;

  const numericCols = columns.filter(NUMERIC);
  const dateCols = columns.filter(DATE);

  if (rows.length >= 100) { score += 25; reasons.push(`${rows.length.toLocaleString()} rows is enough for statistical signal`); }
  else if (rows.length >= 30) { score += 10; reasons.push(`${rows.length} rows — light, exploratory only`); }

  if (numericCols.length >= 3) { score += 30; reasons.push(`${numericCols.length} numeric columns enable correlation & clustering`); }
  else if (numericCols.length === 2) { score += 15; reasons.push(`2 numeric columns enable correlation`); }

  if (dateCols.length >= 1 && numericCols.length >= 1) {
    score += 25;
    reasons.push(`Date + numeric columns enable forecasting`);
  }

  // Variance bonus — a column with a real spread is more interesting than
  // a near-constant one.
  const varied = numericCols.filter((c) => c.min !== undefined && c.max !== undefined && c.max - c.min > 0).length;
  if (varied >= 2) { score += 10; reasons.push(`Numeric values show real variance, not flat`); }

  // Pick a forecast pair (first date + first interesting numeric).
  let forecast: DSClassification["capabilities"]["forecast"] = null;
  if (dateCols[0] && numericCols[0]) forecast = { dateCol: dateCols[0].name, numericCol: numericCols[0].name };

  let clusters: DSClassification["capabilities"]["clusters"] = null;
  if (numericCols.length >= 2) clusters = { cols: [numericCols[0].name, numericCols[1].name] };

  return {
    recommended: score >= 40,
    score: Math.min(100, score),
    reasons,
    capabilities: {
      correlation: numericCols.length >= 2,
      forecast,
      clusters,
      anomalies: numericCols.slice(0, 3).map((c) => c.name),
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Correlation matrix (Pearson)
// ---------------------------------------------------------------------------

export interface CorrelationCell { a: string; b: string; r: number }

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

function numericSeries(rows: Row[], col: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = Number(r[col]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Build a flat list of correlations between every pair of numeric columns.
 * We skip self-pairs (r=1 by definition) and only keep one direction per
 * pair to halve the heatmap size.
 */
export function correlationMatrix(rows: Row[], cols: string[]): CorrelationCell[] {
  const out: CorrelationCell[] = [];
  // Pre-compute series once per column to avoid an O(n*m^2) re-scan.
  const series = new Map<string, number[]>();
  for (const c of cols) series.set(c, numericSeries(rows, c));
  for (let i = 0; i < cols.length; i++) {
    for (let j = 0; j < cols.length; j++) {
      const a = cols[i], b = cols[j];
      const r = i === j ? 1 : pearson(series.get(a)!, series.get(b)!);
      out.push({ a, b, r: Number.isFinite(r) ? r : 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Anomaly detection — top-K rows by |z-score|
// ---------------------------------------------------------------------------

export interface Anomaly {
  rowIndex: number;
  value: number;
  z: number;
  row: Row;
}

export function detectAnomalies(rows: Row[], col: string, k = 8): Anomaly[] {
  const values = rows.map((r) => Number(r[col])).map((v) => (Number.isFinite(v) ? v : NaN));
  const valid = values.filter((v) => !Number.isNaN(v));
  if (valid.length < 5) return [];
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return [];
  const scored: Anomaly[] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    const z = (v - mean) / sd;
    if (Math.abs(z) >= 1.5) scored.push({ rowIndex: i, value: v, z, row: rows[i] });
  }
  scored.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return scored.slice(0, k);
}

// ---------------------------------------------------------------------------
// 4. Linear forecast on a date+numeric series
// ---------------------------------------------------------------------------

export interface ForecastPoint {
  /** ISO date or original bucket label. */
  date: string;
  actual: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
}

function parseDate(v: unknown): number | null {
  if (v == null) return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Aggregate by day (or by the natural granularity of the series), fit a
 * least-squares line, then project N periods forward with a simple
 * residual-based confidence band. This is intentionally NOT ARIMA — it's
 * the simplest thing that demonstrates the "predictive layer" without
 * pulling in heavy stats deps.
 */
export function linearForecast(
  rows: Row[],
  dateCol: string,
  numericCol: string,
  periods = 7,
): ForecastPoint[] {
  // Bucket: aggregate sum per day key (YYYY-MM-DD).
  const buckets = new Map<string, { sum: number; t: number }>();
  for (const r of rows) {
    const t = parseDate(r[dateCol]);
    const v = Number(r[numericCol]);
    if (t == null || !Number.isFinite(v)) continue;
    const d = new Date(t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const cur = buckets.get(key);
    if (cur) cur.sum += v; else buckets.set(key, { sum: v, t: ts });
  }
  const sorted = [...buckets.entries()]
    .map(([key, v]) => ({ key, t: v.t, y: v.sum }))
    .sort((a, b) => a.t - b.t);
  if (sorted.length < 4) return [];

  // Fit y = m*x + b where x is days since first point.
  const x0 = sorted[0].t;
  const xs = sorted.map((p) => (p.t - x0) / 86_400_000);
  const ys = sorted.map((p) => p.y);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const m = den === 0 ? 0 : num / den;
  const b = meanY - m * meanX;

  // Residual std-dev → +-1.96σ band.
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const yhat = m * xs[i] + b;
    sse += (ys[i] - yhat) ** 2;
  }
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));
  const band = 1.96 * sigma;

  const out: ForecastPoint[] = sorted.map((p, i) => {
    const yhat = m * xs[i] + b;
    return { date: p.key, actual: p.y, forecast: yhat, lower: yhat - band, upper: yhat + band };
  });

  // Project forward.
  const stepDays = sorted.length > 1 ? Math.max(1, Math.round((sorted[sorted.length - 1].t - sorted[0].t) / 86_400_000 / (sorted.length - 1))) : 1;
  const lastX = xs[xs.length - 1];
  const lastT = sorted[sorted.length - 1].t;
  for (let i = 1; i <= periods; i++) {
    const nx = lastX + i * stepDays;
    const nt = lastT + i * stepDays * 86_400_000;
    const d = new Date(nt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const yhat = m * nx + b;
    out.push({ date: key, actual: null, forecast: yhat, lower: yhat - band, upper: yhat + band });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. K-means clustering (small, 2-D)
// ---------------------------------------------------------------------------

export interface ClusterPoint { x: number; y: number; cluster: number; row: Row }
export interface ClusterResult { points: ClusterPoint[]; centroids: { x: number; y: number }[] }

// ---------------------------------------------------------------------------
// 5b. Box-plot statistics (5-number summary + IQR whiskers)
// ---------------------------------------------------------------------------

export interface BoxStats {
  col: string;
  min: number;
  q1: number;
  median: number;
  mean: number;
  q3: number;
  max: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
}

function quantile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function boxPlotStats(rows: Row[], col: string): BoxStats | null {
  const vals: number[] = [];
  for (const r of rows) {
    const v = Number(r[col]);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < 4) return null;
  vals.sort((a, b) => a - b);
  const q1 = quantile(vals, 0.25);
  const median = quantile(vals, 0.5);
  const q3 = quantile(vals, 0.75);
  const iqr = q3 - q1;
  const whiskerLow = Math.max(vals[0], q1 - 1.5 * iqr);
  const whiskerHigh = Math.min(vals[vals.length - 1], q3 + 1.5 * iqr);
  const outliers = vals.filter((v) => v < whiskerLow || v > whiskerHigh);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { col, min: vals[0], q1, median, mean, q3, max: vals[vals.length - 1], whiskerLow, whiskerHigh, outliers };
}

// ---------------------------------------------------------------------------
// 5c. Histogram bins for distribution chart
// ---------------------------------------------------------------------------

export interface HistBin {
  label: string;
  count: number;
}

export function histogramBins(rows: Row[], col: string, bins = 10): HistBin[] {
  const vals: number[] = [];
  for (const r of rows) {
    const v = Number(r[col]);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < 2) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) return [{ label: String(min), count: vals.length }];
  const w = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - min) / w))]++;
  const fmt = (n: number) => Math.abs(n) >= 10000 ? (n / 1000).toFixed(0) + "k" : Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(1);
  return counts.map((c, i) => ({ label: fmt(min + i * w), count: c }));
}

// ---------------------------------------------------------------------------

export function kmeansClusters(
  rows: Row[],
  cols: [string, string],
  k = 4,
  iters = 20,
): ClusterResult {
  const pts: { x: number; y: number; row: Row }[] = [];
  for (const r of rows) {
    const x = Number(r[cols[0]]);
    const y = Number(r[cols[1]]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y, row: r });
  }
  if (pts.length < k) return { points: pts.map((p) => ({ ...p, cluster: 0 })), centroids: [{ x: 0, y: 0 }] };

  // Deterministic seeding: spread initial centroids along the data range
  // so re-runs of the same data give the same colour layout.
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const centroids = Array.from({ length: k }, (_, i) => ({
    x: minX + ((maxX - minX) * (i + 0.5)) / k,
    y: minY + ((maxY - minY) * (i + 0.5)) / k,
  }));

  const assign = new Array(pts.length).fill(0);
  for (let it = 0; it < iters; it++) {
    let changed = false;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = pts[i].x - centroids[c].x;
        const dy = pts[i].y - centroids[c].y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    // Recompute centroids.
    const sums = Array.from({ length: k }, () => ({ x: 0, y: 0, n: 0 }));
    for (let i = 0; i < pts.length; i++) {
      const a = assign[i]; sums[a].x += pts[i].x; sums[a].y += pts[i].y; sums[a].n++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c].n > 0) { centroids[c] = { x: sums[c].x / sums[c].n, y: sums[c].y / sums[c].n }; }
    }
    if (!changed) break;
  }

  return {
    points: pts.map((p, i) => ({ ...p, cluster: assign[i] })),
    centroids,
  };
}
