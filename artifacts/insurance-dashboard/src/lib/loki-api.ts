// Shared Loki query helpers used by both the Explorer/pin action (LokiLogs) and
// the Pinned Visuals refresh button (LokiPins). Keeping the query call + the
// result→chart-rows transform in one place guarantees a pinned chart and its
// refreshed version are built identically.

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface LokiSeries {
  name: string;
  values: Array<{ ts: number; value: number }>;
}

export interface LokiQueryResult {
  kind: string;
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
  series?: LokiSeries[];
  stats?: Record<string, unknown>;
  query?: { logql: string };
}

export async function postLokiQuery(payload: Record<string, unknown>): Promise<LokiQueryResult> {
  const r = await fetch(`${API_BASE}/api/loki/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.detail || detail.error || `Query failed (${r.status})`);
  }
  return r.json();
}

export type LokiTransform = "byLabel" | "overTime" | "none";

/** Turn a normalized Loki query result into chart rows keyed by xKey/yKey,
 *  using the transform the pin was created with. */
export function buildChartRows(
  result: LokiQueryResult,
  opts: { transform: LokiTransform; xKey: string; yKey: string },
): Array<Record<string, unknown>> {
  const { transform, xKey, yKey } = opts;
  const series = result.series ?? [];

  if (transform === "byLabel") {
    return series.map((s) => ({
      [xKey]: s.name,
      [yKey]: s.values.reduce((acc, v) => acc + (v.value || 0), 0),
    }));
  }

  if (transform === "overTime") {
    // Sum across series per timestamp, sorted ascending.
    const byTs = new Map<number, number>();
    for (const s of series) {
      for (const v of s.values) byTs.set(v.ts, (byTs.get(v.ts) || 0) + (v.value || 0));
    }
    return [...byTs.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, value]) => ({ [xKey]: new Date(ts).toLocaleString(), [yKey]: value }));
  }

  return [];
}
