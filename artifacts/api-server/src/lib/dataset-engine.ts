/**
 * Dataset analysis helpers.
 *
 * `classifyColumns` walks every cell once to produce a richer "semantic" type
 * (date / currency / percent / id / category / measure / text) and a
 * "business meaning" guess derived from the column name. These power the
 * Understanding screen.
 *
 * `scoreReadiness` runs a second cheap pass to produce a 0-100 Data Readiness
 * Score plus a flat list of issues (missing values, duplicates, invalid
 * dates, etc.) that drive the Quality screen.
 *
 * Both are pure-data — no DB access — so they're trivial to unit test.
 */

export type SemanticType =
  | "date"
  | "currency"
  | "percent"
  | "id"
  | "category"
  | "measure"
  | "text"
  | "boolean";

export type RawType = "number" | "string" | "date" | "boolean" | "mixed";

export interface ColumnClassification {
  name: string;
  ordinal: number;
  rawType: RawType;
  semanticType: SemanticType;
  businessMeaning: string;
  uniqueCount: number;
  nullCount: number;
  sample: unknown[];
  stats?: { min?: number; max?: number; mean?: number };
}

export type IssueSeverity = "low" | "medium" | "high";
export type IssueStatus = "open" | "ignored" | "resolved" | "review";

export interface DatasetIssue {
  id: string;
  category:
    | "missing"
    | "duplicates"
    | "format"
    | "outliers"
    | "invalid_date"
    | "empty_column"
    | "suspicious";
  severity: IssueSeverity;
  column?: string;
  count: number;
  message: string;
  suggestedFix: string;
  status: IssueStatus;
}

export interface SuggestedKpi {
  id: string;
  label: string;
  agg: "sum" | "avg" | "count" | "count_distinct" | "min" | "max";
  column: string;
  reason: string;
}

export interface ReadinessReport {
  score: number;
  issues: DatasetIssue[];
}

const CURRENCY_REGEX = /^[\s$€£¥]?-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?[\s$€£¥]?$/;
const PERCENT_REGEX = /^-?\d+(?:\.\d+)?\s*%$/;
const ID_NAME_REGEX = /(^|[_\s])id$|^id($|[_\s])|_id$|^id_/i;
// Strong date-name signal: column literally talks about a date/time stamp.
// We deliberately do NOT include bare "year"/"month"/"time" here because
// columns like `policy_year`, `term_months`, `response_time` are typically
// numeric measures, not date columns — we'd rather under-fire the date
// classifier than misclassify a measure and then penalise it for failing to
// parse as a date.
const DATE_NAME_REGEX = /(date|datetime|timestamp|created_at|updated_at|deleted_at|_at$)/i;
const CURRENCY_NAME_REGEX =
  /(amount|price|revenue|cost|total|premium|salary|payment|sales|spend|fee|commission|profit|loss|value|charge)/i;
const PERCENT_NAME_REGEX = /(rate|ratio|percent|share|margin|growth)/i;

function detectRawType(values: unknown[]): RawType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "string";
  let n = 0;
  let d = 0;
  let b = 0;
  const sample = nonNull.slice(0, 100);
  for (const v of sample) {
    if (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)))) n++;
    else if (typeof v === "boolean") b++;
    else if (v instanceof Date || (typeof v === "string" && v.length > 6 && !isNaN(Date.parse(v)))) d++;
  }
  const total = sample.length;
  if (n / total > 0.8) return "number";
  if (d / total > 0.8) return "date";
  if (b / total > 0.8) return "boolean";
  return "string";
}

function inferSemanticType(name: string, rawType: RawType, values: unknown[]): SemanticType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "text";

  // Boolean is its own thing
  if (rawType === "boolean") return "boolean";

  // Date wins early. Either:
  //   • the raw type already detected mostly-date-shaped values, OR
  //   • the column name strongly signals a date AND a majority of sampled
  //     values actually parse as a date. The second leg prevents columns
  //     like `policy_year` (numeric) from being forced into "date".
  if (rawType === "date") return "date";
  if (DATE_NAME_REGEX.test(name)) {
    const sample = nonNull.slice(0, 30);
    const parses = sample.filter(
      (v) => v instanceof Date || (typeof v === "string" && v.length > 6 && !isNaN(Date.parse(v))),
    ).length;
    if (sample.length > 0 && parses / sample.length > 0.6) return "date";
  }

  // ID heuristic: explicitly named "id" / "*_id" with very high cardinality.
  if (ID_NAME_REGEX.test(name)) {
    const uniques = new Set(nonNull.map(String)).size;
    if (uniques / nonNull.length > 0.9) return "id";
  }

  // Currency / percent — check string formatting first, then column name
  const strSample = nonNull.slice(0, 30).map((v) => String(v).trim());
  const currencyHits = strSample.filter((s) => CURRENCY_REGEX.test(s) && /[$€£¥,]/.test(s)).length;
  const percentHits = strSample.filter((s) => PERCENT_REGEX.test(s)).length;
  if (percentHits / strSample.length > 0.6) return "percent";
  if (currencyHits / strSample.length > 0.6) return "currency";

  if (rawType === "number") {
    if (CURRENCY_NAME_REGEX.test(name)) return "currency";
    if (PERCENT_NAME_REGEX.test(name)) return "percent";
    return "measure";
  }

  // String columns: short, low-cardinality → category
  const uniques = new Set(nonNull.map(String)).size;
  if (uniques <= Math.max(20, Math.floor(nonNull.length * 0.05))) return "category";

  return "text";
}

function inferBusinessMeaning(name: string, semanticType: SemanticType): string {
  const tidy = name
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const cap =
    tidy.length === 0 ? name : tidy.charAt(0).toUpperCase() + tidy.slice(1).toLowerCase();
  switch (semanticType) {
    case "id":
      return `${cap} (identifier)`;
    case "date":
      return cap.toLowerCase().includes("date") ? cap : `${cap} (date)`;
    case "currency":
      return `${cap} (money)`;
    case "percent":
      return `${cap} (rate)`;
    case "measure":
      return `${cap} (measure)`;
    case "category":
      return `${cap} (category)`;
    case "boolean":
      return `${cap} (flag)`;
    default:
      return cap;
  }
}

export function classifyColumns(
  rows: Record<string, unknown>[],
  columnNames: string[],
): ColumnClassification[] {
  return columnNames.map((name, ordinal) => {
    const values = rows.map((r) => r[name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
    const rawType = detectRawType(values);
    const semanticType = inferSemanticType(name, rawType, values);
    const businessMeaning = inferBusinessMeaning(name, semanticType);

    const cls: ColumnClassification = {
      name,
      ordinal,
      rawType,
      semanticType,
      businessMeaning,
      uniqueCount: new Set(nonNull.map(String)).size,
      nullCount: values.length - nonNull.length,
      sample: nonNull.slice(0, 5),
    };

    if (rawType === "number") {
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
      if (count > 0) cls.stats = { min, max, mean: sum / count };
    }

    return cls;
  });
}

interface PenaltyWeights {
  perMissingPct: number;
  perMissingMax: number;
  duplicateRows: number;
  inconsistentFormat: number;
  invalidDate: number;
  emptyColumn: number;
  suspicious: number;
  outlierPerColumn: number;
  outlierPerPct: number;
  outlierMaxPct: number;
}

const PENALTIES: PenaltyWeights = {
  perMissingPct: 0.3,
  perMissingMax: 15,
  duplicateRows: 8,
  inconsistentFormat: 6,
  invalidDate: 8,
  emptyColumn: 10,
  suspicious: 5,
  outlierPerColumn: 2,
  outlierPerPct: 0.4,
  outlierMaxPct: 8,
};

function severityFor(impact: number): IssueSeverity {
  if (impact >= 10) return "high";
  if (impact >= 5) return "medium";
  return "low";
}

/**
 * Walk the rows + classified columns and produce a 0-100 readiness score plus
 * a flat issue list. Each issue includes: severity, count, plain-language
 * message, and a suggested fix string (the UI maps these to actions).
 */
export function scoreReadiness(
  rows: Record<string, unknown>[],
  columns: ColumnClassification[],
): ReadinessReport {
  const issues: DatasetIssue[] = [];
  let penalty = 0;
  let issueCounter = 0;
  const nextId = () => `issue-${++issueCounter}`;

  // 1. Missing values per column
  for (const col of columns) {
    if (rows.length === 0) break;
    const missingPct = (col.nullCount / rows.length) * 100;
    if (missingPct === 100) {
      issues.push({
        id: nextId(),
        category: "empty_column",
        severity: "high",
        column: col.name,
        count: col.nullCount,
        message: `Column "${col.name}" is completely empty.`,
        suggestedFix: "Drop this column or backfill from another source.",
        status: "open",
      });
      penalty += PENALTIES.emptyColumn;
      continue;
    }
    if (missingPct >= 1) {
      const cost = Math.min(PENALTIES.perMissingMax, missingPct * PENALTIES.perMissingPct);
      issues.push({
        id: nextId(),
        category: "missing",
        severity: severityFor(cost),
        column: col.name,
        count: col.nullCount,
        message: `${col.nullCount.toLocaleString()} missing value${col.nullCount === 1 ? "" : "s"} in "${col.name}" (${missingPct.toFixed(1)}%).`,
        suggestedFix:
          missingPct > 30
            ? "Consider dropping the column or imputing with a default."
            : "Impute with the median / mode or filter out rows.",
        status: "open",
      });
      penalty += cost;
    }
  }

  // 2. Duplicate rows (compare by stringified row contents — keep cheap on large rows
  // by sampling up to first 50k rows for the dedupe check).
  if (rows.length > 1) {
    const checkLimit = Math.min(rows.length, 50_000);
    const seen = new Set<string>();
    let dupCount = 0;
    for (let i = 0; i < checkLimit; i++) {
      const key = JSON.stringify(rows[i]);
      if (seen.has(key)) dupCount++;
      else seen.add(key);
    }
    if (dupCount > 0) {
      issues.push({
        id: nextId(),
        category: "duplicates",
        severity: dupCount > rows.length * 0.05 ? "high" : "medium",
        count: dupCount,
        message: `${dupCount.toLocaleString()} duplicate row${dupCount === 1 ? "" : "s"} detected${
          checkLimit < rows.length ? ` in the first ${checkLimit.toLocaleString()} rows` : ""
        }.`,
        suggestedFix: "Deduplicate by primary key or full-row hash.",
        status: "open",
      });
      penalty += PENALTIES.duplicateRows;
    }
  }

  // 3. Inconsistent format (per column, focused on dates + numbers)
  for (const col of columns) {
    const sample = rows.slice(0, 200).map((r) => r[col.name]).filter((v) => v !== null && v !== undefined && v !== "");
    if (sample.length === 0) continue;

    if (col.semanticType === "date") {
      const invalid = sample.filter((v) => !(v instanceof Date) && (typeof v !== "string" || isNaN(Date.parse(String(v))))).length;
      if (invalid > 0) {
        issues.push({
          id: nextId(),
          category: "invalid_date",
          severity: invalid > sample.length * 0.1 ? "high" : "medium",
          column: col.name,
          count: invalid,
          message: `"${col.name}" contains ${invalid} value${invalid === 1 ? "" : "s"} that don't parse as a date.`,
          suggestedFix: "Normalize to ISO 8601 (YYYY-MM-DD) or drop bad rows.",
          status: "open",
        });
        penalty += PENALTIES.invalidDate;
      }
    }

    // Mixed number/string in a numeric column suggests format issues
    if (col.semanticType === "currency" || col.semanticType === "measure" || col.semanticType === "percent") {
      const stringy = sample.filter((v) => typeof v === "string" && isNaN(Number(String(v).replace(/[$€£¥,%\s]/g, "")))).length;
      if (stringy > 0 && stringy < sample.length) {
        issues.push({
          id: nextId(),
          category: "format",
          severity: "medium",
          column: col.name,
          count: stringy,
          message: `"${col.name}" mixes numeric and non-numeric formatting in ${stringy} sample value${stringy === 1 ? "" : "s"}.`,
          suggestedFix: "Strip currency symbols / commas and coerce to a number.",
          status: "open",
        });
        penalty += PENALTIES.inconsistentFormat;
      }
    }
  }

  // 4. Suspicious values: negative currency where rare positives expected
  for (const col of columns) {
    if (col.semanticType !== "currency" || !col.stats) continue;
    if (col.stats.min !== undefined && col.stats.min < 0) {
      const negs = rows.filter((r) => Number(r[col.name]) < 0).length;
      if (negs > 0 && negs < rows.length * 0.5) {
        issues.push({
          id: nextId(),
          category: "suspicious",
          severity: "low",
          column: col.name,
          count: negs,
          message: `${negs} negative value${negs === 1 ? "" : "s"} in money column "${col.name}".`,
          suggestedFix: "Verify these are refunds / adjustments and not data entry errors.",
          status: "open",
        });
        penalty += PENALTIES.suspicious;
      }
    }
  }

  // 5. Outliers via the IQR rule on numeric columns. We need a meaningful
  // sample (>= 12 values) and we cap the scan at the first 5k rows so the
  // computation stays cheap on large workbooks.
  for (const col of columns) {
    if (
      col.semanticType !== "measure" &&
      col.semanticType !== "currency" &&
      col.semanticType !== "percent"
    ) {
      continue;
    }
    const values: number[] = [];
    const scan = Math.min(rows.length, 5_000);
    for (let i = 0; i < scan; i++) {
      const raw = rows[i][col.name];
      const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[$€£¥,%\s]/g, ""));
      if (Number.isFinite(n)) values.push(n);
    }
    if (values.length < 12) continue;
    values.sort((a, b) => a - b);
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    if (iqr === 0) continue;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const outliers = values.filter((v) => v < lo || v > hi).length;
    const pct = outliers / values.length;
    if (pct >= 0.01 && outliers >= 1) {
      const sev: IssueSeverity = pct >= 0.1 ? "high" : pct >= 0.03 ? "medium" : "low";
      issues.push({
        id: nextId(),
        category: "outliers",
        severity: sev,
        column: col.name,
        count: outliers,
        message: `${outliers.toLocaleString()} potential outlier${outliers === 1 ? "" : "s"} in "${col.name}" (outside ${lo.toFixed(2)}…${hi.toFixed(2)}).`,
        suggestedFix: "Inspect the values — they may be data-entry errors or genuine extremes.",
        status: "open",
      });
      penalty +=
        PENALTIES.outlierPerColumn + Math.min(PENALTIES.outlierMaxPct, pct * 100 * PENALTIES.outlierPerPct);
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, issues };
}

/**
 * Recompute the readiness score honouring user issue-status overrides
 * (ignored issues no longer count, resolved issues stop penalising).
 * The function takes the freshly-recomputed issues and merges in the
 * statuses from the previous version so manual triage isn't lost.
 */
export function mergeIssueStatuses(
  fresh: DatasetIssue[],
  previous: DatasetIssue[],
): DatasetIssue[] {
  const previousByKey = new Map<string, DatasetIssue>();
  for (const prev of previous) {
    previousByKey.set(`${prev.category}|${prev.column ?? ""}`, prev);
  }
  return fresh.map((f) => {
    const prev = previousByKey.get(`${f.category}|${f.column ?? ""}`);
    if (prev && prev.status && prev.status !== "open") {
      return { ...f, status: prev.status };
    }
    return f;
  });
}

/**
 * Discount the score by the issues the user has chosen to ignore or mark as
 * resolved. A pragmatic implementation: compute base penalty as `100 - score`,
 * then refund a category-weighted penalty per non-open issue.
 */
export function applyStatusToScore(score: number, issues: DatasetIssue[]): number {
  const refund = (cat: DatasetIssue["category"]): number => {
    switch (cat) {
      case "missing":
        return PENALTIES.perMissingMax / 2;
      case "duplicates":
        return PENALTIES.duplicateRows;
      case "format":
        return PENALTIES.inconsistentFormat;
      case "outliers":
        return PENALTIES.outlierPerColumn;
      case "invalid_date":
        return PENALTIES.invalidDate;
      case "empty_column":
        return PENALTIES.emptyColumn;
      case "suspicious":
        return PENALTIES.suspicious;
    }
  };
  let bonus = 0;
  for (const i of issues) {
    if (i.status === "ignored" || i.status === "resolved") {
      bonus += refund(i.category);
    }
  }
  return Math.max(0, Math.min(100, Math.round(score + bonus)));
}

/**
 * Suggest 3-5 KPI fields the user is most likely to want, derived from the
 * column classifications. Order: count of identifier rows → sum/avg of money
 * columns → avg of percent → top category breakdown. The downstream metric
 * builder (a future task) reads these as starter suggestions.
 */
export function suggestKpis(columns: ColumnClassification[], rowCount: number): SuggestedKpi[] {
  const out: SuggestedKpi[] = [];
  const usable = columns.filter((c) => c.nullCount < rowCount);
  let counter = 0;
  const next = () => `kpi-${++counter}`;

  const idCol = usable.find((c) => c.semanticType === "id");
  if (idCol) {
    out.push({
      id: next(),
      label: `Total ${prettify(idCol.name)}`,
      agg: "count_distinct",
      column: idCol.name,
      reason: "Counts unique identifiers — usually the headline volume KPI.",
    });
  } else if (rowCount > 0) {
    out.push({
      id: next(),
      label: "Total records",
      agg: "count",
      column: "*",
      reason: "Row count is a baseline volume metric for this dataset.",
    });
  }

  const currencyCols = usable.filter((c) => c.semanticType === "currency");
  for (const col of currencyCols.slice(0, 2)) {
    out.push({
      id: next(),
      label: `Total ${prettify(col.name)}`,
      agg: "sum",
      column: col.name,
      reason: "Sum of a money column — typical revenue / spend KPI.",
    });
    if (out.length >= 5) break;
    out.push({
      id: next(),
      label: `Average ${prettify(col.name)}`,
      agg: "avg",
      column: col.name,
      reason: "Average money per row gives a per-unit economics view.",
    });
    if (out.length >= 5) break;
  }

  if (out.length < 5) {
    const percent = usable.find((c) => c.semanticType === "percent");
    if (percent) {
      out.push({
        id: next(),
        label: `Average ${prettify(percent.name)}`,
        agg: "avg",
        column: percent.name,
        reason: "Average rate is a typical performance KPI.",
      });
    }
  }

  if (out.length < 5) {
    const measure = usable.find((c) => c.semanticType === "measure");
    if (measure) {
      out.push({
        id: next(),
        label: `Average ${prettify(measure.name)}`,
        agg: "avg",
        column: measure.name,
        reason: "Average of the leading numeric measure.",
      });
    }
  }

  if (out.length < 5) {
    const cat = usable.find((c) => c.semanticType === "category" && c.uniqueCount <= 25 && c.uniqueCount > 1);
    if (cat) {
      out.push({
        id: next(),
        label: `${prettify(cat.name)} breakdown`,
        agg: "count",
        column: cat.name,
        reason: "Top categories are useful for grouping and filtering.",
      });
    }
  }

  return out.slice(0, 5);
}

function prettify(name: string): string {
  const tidy = name
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return tidy.length === 0
    ? name
    : tidy.charAt(0).toUpperCase() + tidy.slice(1).toLowerCase();
}
