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
  perMissingPct: number; // points per percent of missing values, capped per column
  perMissingMax: number; // max penalty per column from missing
  duplicateRows: number; // flat penalty if any duplicate rows
  inconsistentFormat: number; // per column
  invalidDate: number; // per column (any invalid date in a date column)
  emptyColumn: number; // per column entirely null
  suspicious: number; // per column flagged
}

const PENALTIES: PenaltyWeights = {
  perMissingPct: 0.3,
  perMissingMax: 15,
  duplicateRows: 8,
  inconsistentFormat: 6,
  invalidDate: 8,
  emptyColumn: 10,
  suspicious: 5,
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
        });
        penalty += PENALTIES.suspicious;
      }
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, issues };
}
