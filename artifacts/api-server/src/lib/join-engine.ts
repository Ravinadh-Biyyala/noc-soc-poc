// Server-side join suggestion engine.
//
// For each pair of datasets we compute the best (column, column) match by
// combining name similarity and value overlap. We also report match rate,
// unmatched count, and a recommended join type so the client can show the
// "confidence + match rate + unmatched" UX from the design doc.

const SAMPLE_CAP = 5_000;

export type JoinType = "inner" | "left" | "right" | "outer";

export interface DatasetForJoin {
  id: number;
  name: string;
  rowCount: number;
  columns: { name: string; semanticType?: string; uniqueCount?: number }[];
  rows: Record<string, unknown>[];
}

export interface JoinSuggestion {
  leftDatasetId: number;
  leftDatasetName: string;
  rightDatasetId: number;
  rightDatasetName: string;
  leftColumn: string;
  rightColumn: string;
  /** 0..1 — overall confidence. */
  confidence: number;
  /** 0..1 — fraction of right-side distinct keys present on the left. */
  matchRate: number;
  /** Number of distinct right-side keys with no left match. */
  unmatchedCount: number;
  /** AI-recommended join type given cardinality. */
  recommendedJoinType: JoinType;
  reason: string;
}

function makeKey(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  if (value instanceof Date) return `d:${value.getTime()}`;
  return `s:${String(value).trim().toLowerCase()}`;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[_\s\-]/g, "");
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) return 0.75;
  const stripId = (x: string) => (x.endsWith("id") ? x.slice(0, -2) : x);
  const sa = stripId(na);
  const sb = stripId(nb);
  if (sa && sa === sb) return 0.7;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  const jacc = inter / (ba.size + bb.size - inter);
  return jacc >= 0.5 ? jacc : 0;
}

interface OverlapResult {
  matchRate: number;
  matched: number;
  unmatched: number;
  rightDistinct: number;
  leftDistinct: number;
  leftCardinality: number;
  rightCardinality: number;
}

function valueOverlap(
  left: DatasetForJoin,
  right: DatasetForJoin,
  lk: string,
  rk: string,
): OverlapResult {
  const leftRows = left.rows.slice(0, SAMPLE_CAP);
  const rightRows = right.rows.slice(0, SAMPLE_CAP);

  const leftKeys = new Set<string>();
  let leftNonNull = 0;
  for (const r of leftRows) {
    const k = makeKey(r[lk]);
    if (k !== null) {
      leftKeys.add(k);
      leftNonNull++;
    }
  }
  const rightDistinct = new Set<string>();
  let matched = 0;
  for (const r of rightRows) {
    const k = makeKey(r[rk]);
    if (k === null || rightDistinct.has(k)) continue;
    rightDistinct.add(k);
    if (leftKeys.has(k)) matched++;
  }
  const unmatched = rightDistinct.size - matched;
  return {
    matchRate: rightDistinct.size === 0 ? 0 : matched / rightDistinct.size,
    matched,
    unmatched,
    rightDistinct: rightDistinct.size,
    leftDistinct: leftKeys.size,
    leftCardinality: leftNonNull === 0 ? 0 : leftKeys.size / leftNonNull,
    rightCardinality: rightDistinct.size === 0 ? 0 : rightDistinct.size / Math.max(1, rightRows.length),
  };
}

function recommendJoinType(o: OverlapResult): JoinType {
  // Pure-key on both sides: inner
  if (o.leftCardinality > 0.95 && o.rightCardinality > 0.95) return "inner";
  // Right is the dim table (distinct keys), left is the fact: left join
  if (o.rightCardinality > 0.9) return "left";
  // Left is dim, right is fact: right join
  if (o.leftCardinality > 0.9) return "right";
  return "inner";
}

function buildReason(
  leftName: string,
  rightName: string,
  leftKey: string,
  rightKey: string,
  matched: number,
  rightDistinct: number,
): string {
  const pct = rightDistinct === 0 ? 0 : Math.round((matched / rightDistinct) * 100);
  const sameName = normalizeName(leftKey) === normalizeName(rightKey);
  if (sameName) {
    return `Both files share a "${leftKey}" column and ${pct}% of values match (${matched} keys overlap).`;
  }
  return `"${leftName}.${leftKey}" matches "${rightName}.${rightKey}" with ${pct}% value overlap (${matched} keys).`;
}

export function suggestJoins(datasets: DatasetForJoin[]): JoinSuggestion[] {
  if (datasets.length < 2) return [];
  const out: JoinSuggestion[] = [];

  for (let i = 0; i < datasets.length; i++) {
    for (let j = i + 1; j < datasets.length; j++) {
      const left = datasets[i];
      const right = datasets[j];

      let best: JoinSuggestion | null = null;
      for (const lc of left.columns) {
        for (const rc of right.columns) {
          const ns = nameSimilarity(lc.name, rc.name);
          if (ns < 0.5) continue;
          const fwd = valueOverlap(left, right, lc.name, rc.name);
          const rev = valueOverlap(right, left, rc.name, lc.name);
          const useFwd = fwd.matchRate >= rev.matchRate;
          const overlap = useFwd ? fwd : rev;
          if (overlap.matchRate < 0.15) continue;

          const confidence = Math.max(0, Math.min(1, ns * 0.4 + overlap.matchRate * 0.6));
          if (!best || confidence > best.confidence) {
            best = {
              leftDatasetId: useFwd ? left.id : right.id,
              leftDatasetName: useFwd ? left.name : right.name,
              rightDatasetId: useFwd ? right.id : left.id,
              rightDatasetName: useFwd ? right.name : left.name,
              leftColumn: useFwd ? lc.name : rc.name,
              rightColumn: useFwd ? rc.name : lc.name,
              confidence,
              matchRate: overlap.matchRate,
              unmatchedCount: overlap.unmatched,
              recommendedJoinType: recommendJoinType(overlap),
              reason: buildReason(
                useFwd ? left.name : right.name,
                useFwd ? right.name : left.name,
                useFwd ? lc.name : rc.name,
                useFwd ? rc.name : lc.name,
                overlap.matched,
                overlap.rightDistinct,
              ),
            };
          }
        }
      }
      if (best) out.push(best);
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Join execution (preview + materialize)
// ---------------------------------------------------------------------------

export interface JoinSpec {
  leftDatasetId: number;
  rightDatasetId: number;
  leftColumn: string;
  rightColumn: string;
  joinType: JoinType;
}

export function performJoin(
  left: DatasetForJoin,
  right: DatasetForJoin,
  spec: Pick<JoinSpec, "leftColumn" | "rightColumn" | "joinType">,
): { columns: string[]; rows: Record<string, unknown>[] } {
  const { leftColumn, rightColumn, joinType } = spec;
  const leftCols = left.columns.map((c) => c.name);
  const rightCols = right.columns.map((c) => c.name);
  const leftSet = new Set(leftCols);

  const outCols: string[] = [...leftCols];
  for (const c of rightCols) {
    if (c === rightColumn) continue;
    outCols.push(leftSet.has(c) ? `${right.name}_${c}` : c);
  }

  const rightIndex = new Map<string, Record<string, unknown>[]>();
  for (const r of right.rows) {
    const k = makeKey(r[rightColumn]);
    if (k === null) continue;
    let bucket = rightIndex.get(k);
    if (!bucket) {
      bucket = [];
      rightIndex.set(k, bucket);
    }
    bucket.push(r);
  }

  const blank = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const c of outCols) out[c] = null;
    return out;
  };

  const merge = (
    l: Record<string, unknown>,
    r: Record<string, unknown> | null,
  ): Record<string, unknown> => {
    const out = blank();
    for (const c of leftCols) out[c] = l[c] ?? null;
    if (r) {
      for (const c of rightCols) {
        if (c === rightColumn) continue;
        const target = leftSet.has(c) ? `${right.name}_${c}` : c;
        out[target] = r[c] ?? null;
      }
    }
    return out;
  };

  const rows: Record<string, unknown>[] = [];
  const matchedRightKeys = new Set<string>();
  for (const lr of left.rows) {
    const k = makeKey(lr[leftColumn]);
    const matches = k !== null ? rightIndex.get(k) : undefined;
    if (matches && matches.length > 0) {
      if (k !== null) matchedRightKeys.add(k);
      for (const rr of matches) rows.push(merge(lr, rr));
    } else if (joinType === "left" || joinType === "outer") {
      rows.push(merge(lr, null));
    }
  }
  if (joinType === "right" || joinType === "outer") {
    for (const rr of right.rows) {
      const k = makeKey(rr[rightColumn]);
      if (k !== null && matchedRightKeys.has(k)) continue;
      const out = blank();
      out[leftColumn] = rr[rightColumn];
      for (const c of rightCols) {
        if (c === rightColumn) continue;
        const target = leftSet.has(c) ? `${right.name}_${c}` : c;
        out[target] = rr[c] ?? null;
      }
      rows.push(out);
    }
  }
  return { columns: outCols, rows };
}
