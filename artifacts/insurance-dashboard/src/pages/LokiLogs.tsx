// Loki Logs — a Grafana-style log explorer over the Loki server (proxied through
// the Python service at /api/loki/*) plus an AI layer wired into the right-rail
// CopilotKit chat (AG-UI). The agent generates LogQL dynamically via the
// `queryLoki` action and renders/pins visuals via `pinLokiVisual`. Pinned
// visuals live on their own page (/loki-pins); this page is the Explorer.

import { useState, useMemo, useCallback } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useCopilotReadable } from "@copilotkit/react-core";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Play, AlertCircle, X, Plus, Minus } from "lucide-react";
import { useRegisterObservation } from "@/lib/chat-observer";
import { postLokiQuery } from "@/lib/loki-api";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// A single Grafana-style label filter row: the user picks which label, an
// operator, and a value. Filters are added/removed dynamically.
interface LabelFilter {
  id: string;
  label: string;
  op: string;
  value: string;
}

const OPERATORS = [
  { value: "=", label: "=" },
  { value: "!=", label: "!=" },
  { value: "=~", label: "=~" },
  { value: "!~", label: "!~" },
];

function newFilter(): LabelFilter {
  return { id: `f-${Date.now()}-${Math.round(Math.random() * 1e6)}`, label: "", op: "=", value: "" };
}

const TIME_RANGES = [
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last 1 hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "1y", label: "Last 1 year" },
];

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-rose-500/10 border-rose-500 text-rose-200",
  error: "bg-rose-500/10 border-rose-500 text-rose-200",
  high: "bg-orange-500/10 border-orange-500 text-orange-200",
  warning: "bg-amber-500/10 border-amber-500 text-amber-200",
  warn: "bg-amber-500/10 border-amber-500 text-amber-200",
  medium: "bg-yellow-500/10 border-yellow-500 text-yellow-200",
  info: "bg-cyan-500/10 border-cyan-500 text-cyan-200",
  low: "bg-sky-500/10 border-sky-500 text-sky-200",
  debug: "bg-slate-500/10 border-slate-500 text-slate-300",
};

interface LokiRow {
  ts: number;
  tsNs: string;
  labels: Record<string, string>;
  severity?: string;
  service?: string;
  line: string;
  message?: string;
  parsed?: Record<string, unknown> | null;
}

interface LokiQueryResult {
  kind: string;
  rows?: LokiRow[];
  rowCount?: number;
  series?: Array<{ name: string; values: Array<{ ts: number; value: number }> }>;
  stats?: Record<string, unknown>;
  query?: { logql: string };
}

// How many log lines to fetch per page. Pagination is time-cursor based (Loki
// has no offset paging): each page fetches the next-oldest PAGE_SIZE lines.
const PAGE_SIZE = 200;

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, y: 31_536_000_000 };
function durationToMs(d: string): number {
  const m = /^(\d+)([smhdwy])$/.exec(d.trim());
  return m ? Number(m[1]) * UNIT_MS[m[2]] : 3_600_000;
}
function msToNs(ms: number): string {
  return (BigInt(ms) * 1_000_000n).toString();
}

function escapeLogQLString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Escape RE2 regex metacharacters so an exact value is matched literally inside
 *  a `=~`/`!~` alternation. */
function regexEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a LogQL stream selector from chosen label filters + an optional line filter.
 *
 *  Matchers in a Loki selector are AND-ed, so two equality matchers on the SAME
 *  label (e.g. device_id="a", device_id="b") can never both be true and return
 *  nothing. When a label has multiple values we OR them via a regex alternation
 *  (device_id=~"a|b") — matching how Grafana's query builder behaves. */
function buildLogQL(filters: LabelFilter[], lineFilter: string): string {
  const active = filters.filter((f) => f.label && f.value);

  // Group by label, splitting positive (= / =~) from negative (!= / !~) matchers.
  const groups = new Map<string, { positive: LabelFilter[]; negative: LabelFilter[] }>();
  for (const f of active) {
    const g = groups.get(f.label) ?? { positive: [], negative: [] };
    const bucket = f.op === "=" || f.op === "=~" ? g.positive : g.negative;
    // Dedupe identical op+value so re-adding the same chip doesn't bloat the query.
    if (!bucket.some((x) => x.op === f.op && x.value === f.value)) bucket.push(f);
    groups.set(f.label, g);
  }

  const matchers: string[] = [];
  for (const [label, g] of groups) {
    for (const isNegative of [false, true]) {
      const bucket = isNegative ? g.negative : g.positive;
      if (bucket.length === 0) continue;
      if (bucket.length === 1) {
        const f = bucket[0];
        matchers.push(`${label}${f.op}"${escapeLogQLString(f.value)}"`);
      } else {
        // Multiple values for one label → OR them. Regex values pass through;
        // exact (= / !=) values are regex-escaped so they match literally.
        const alts = bucket.map((f) => (f.op === "=~" || f.op === "!~" ? f.value : regexEscape(f.value)));
        const op = isNegative ? "!~" : "=~";
        matchers.push(`${label}${op}"${escapeLogQLString(alts.join("|"))}"`);
      }
    }
  }

  // Loki needs at least one non-empty matcher; default to "match any service".
  const selector = matchers.length ? `{${matchers.join(", ")}}` : `{service_name=~".+"}`;
  const trimmed = lineFilter.trim();
  return trimmed ? `${selector} |= "${escapeLogQLString(trimmed)}"` : selector;
}

/** All label names → their values, fetched once. Powers every filter row's
 *  label and value dropdowns and grounds the Copilot agent. */
function useLabelMap() {
  return useQuery<Record<string, string[]>>({
    queryKey: ["loki-labels-with-values"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/loki/labels-with-values`, { credentials: "include" });
      if (!r.ok) return {};
      const body = await r.json();
      return body.labels && typeof body.labels === "object" ? body.labels : {};
    },
    staleTime: 60_000,
  });
}

export default function LokiLogs() {
  // Grafana-style: the user adds label filters and picks which label each one is.
  const [filters, setFilters] = useState<LabelFilter[]>([newFilter()]);
  const [lineFilter, setLineFilter] = useState("");
  const [since, setSince] = useState("24h");
  // The committed query — set on "Run". Pins an absolute [startNs, endNs] window
  // at commit time so pagination can page backward within a stable range.
  const [committed, setCommitted] = useState<{ logql: string; since: string; startNs: string; endNs: string } | null>(null);

  // All labels + their values, fetched once.
  const labelMapQuery = useLabelMap();
  const labelMap = labelMapQuery.data ?? {};
  const labelNames = useMemo(() => Object.keys(labelMap).sort(), [labelMap]);

  const previewLogQL = useMemo(() => buildLogQL(filters, lineFilter), [filters, lineFilter]);

  // Time-cursor pagination: first page ends at endNs; each subsequent page ends
  // just before the oldest line already loaded. startNs stays fixed so we never
  // page outside the selected time range.
  const logsQuery = useInfiniteQuery({
    queryKey: ["loki-logs-explore", committed?.logql, committed?.startNs, committed?.endNs],
    enabled: !!committed,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (await postLokiQuery({
        logql: committed!.logql,
        kind: "logs",
        start: committed!.startNs,
        end: pageParam ?? committed!.endNs,
        limit: PAGE_SIZE,
      })) as unknown as LokiQueryResult,
    getNextPageParam: (lastPage) => {
      const pageRows = lastPage.rows ?? [];
      if (pageRows.length < PAGE_SIZE) return undefined; // exhausted
      const oldest = pageRows[pageRows.length - 1]; // rows are newest→oldest
      if (!oldest?.tsNs || !committed) return undefined;
      const nextEnd = BigInt(oldest.tsNs) - 1n;
      // Stop once the cursor would fall before the window start.
      return nextEnd > BigInt(committed.startNs) ? nextEnd.toString() : undefined;
    },
  });

  const commitQuery = useCallback((logql: string) => {
    const nowMs = Date.now();
    setCommitted({ logql, since, startNs: msToNs(nowMs - durationToMs(since)), endNs: msToNs(nowMs) });
  }, [since]);

  const runQuery = useCallback(() => {
    commitQuery(buildLogQL(filters, lineFilter));
  }, [commitQuery, filters, lineFilter]);

  // Filter-row mutators.
  const updateFilter = useCallback((id: string, patch: Partial<LabelFilter>) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);
  const addFilter = useCallback(() => setFilters((prev) => [...prev, newFilter()]), []);
  const removeFilter = useCallback((id: string) => {
    setFilters((prev) => {
      const next = prev.filter((f) => f.id !== id);
      return next.length ? next : [newFilter()];
    });
  }, []);

  // Grafana-style drill-down: clicking an indexed label on a log row scopes the
  // query to it ("filter for" / "filter out") and re-runs immediately. Replaces
  // any existing filter for the same label so toggling stays intuitive.
  const applyLabelFilter = useCallback((label: string, value: string, op: "=" | "!=") => {
    const kept = filters.filter((f) => f.label && f.label !== label);
    const next = [...kept, { ...newFilter(), label, op, value }];
    setFilters(next);
    commitQuery(buildLogQL(next, lineFilter));
  }, [commitQuery, filters, lineFilter]);

  useRegisterObservation(
    useMemo(
      () => ({
        label: "Loki Logs",
        kind: "other" as const,
        summary:
          "User is on the Loki Logs explorer (Grafana-style). Logs come from a Loki server of network-device monitoring (SolarWinds → Cisco). " +
          `Available labels: service_name, severity (critical/warning/info), environment, source, category, device_id, app. ` +
          `Current filter preview LogQL: ${previewLogQL} over ${since}. ` +
          "To answer log questions, call the `queryLoki` action with a LogQL query you generate (kind 'logs' for lines, 'metric' for aggregations like count_over_time/sum by). " +
          "Then summarise findings and call `pinLokiVisual` to chart key stats in the chat.",
        suggestions: [
          "Count alerts by severity over the last 24h and chart it",
          "Show the most recent critical alerts",
          "Which device_id produces the most warnings?",
          "Plot alert volume over time for the last 6 hours",
        ],
      }),
      [previewLogQL, since],
    ),
  );

  useCopilotReadable({
    description:
      "Available Loki label names mapped to their values, for building LogQL stream selectors. Use these EXACT label names and values — never guess. Severity values are critical/warning/info.",
    value: labelMap,
  });

  useCopilotReadable({
    description: "The user's current Loki Explorer filter selection and the LogQL it produces. Use as a starting point when the user says 'these logs' or 'the current filter'.",
    value: { filters, lineFilter, since, previewLogQL },
  });

  // The agent's tools (NOC functions + queryLoki/pinLokiVisual) are registered
  // globally in CopilotPanel via useNocCopilotActions(), so they work on every
  // page. This page only contributes Explorer-specific readables above.

  // Flatten paged results, de-duping by timestamp+line in case a cursor boundary
  // re-returns a line shared at the same nanosecond.
  const rows = useMemo(() => {
    const all = (logsQuery.data?.pages ?? []).flatMap((p) => p.rows ?? []);
    const seen = new Set<string>();
    const out: LokiRow[] = [];
    for (const r of all) {
      const key = `${r.tsNs}|${r.line}`;
      if (!seen.has(key)) { seen.add(key); out.push(r); }
    }
    return out;
  }, [logsQuery.data]);

  return (
    <div className="space-y-4">
      {/* Explorer ──────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Filters</CardTitle>
              <CardDescription className="text-xs font-mono break-all">{previewLogQL}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Label filters — the user chooses which label, operator, and value. */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Label filters</label>
                  <Select value={since} onValueChange={setSince}>
                    <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIME_RANGES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {filters.map((f) => {
                  const valueOptions = labelMap[f.label] ?? [];
                  return (
                    <div key={f.id} className="flex flex-wrap items-center gap-2">
                      {/* Label name */}
                      <Select value={f.label} onValueChange={(v) => updateFilter(f.id, { label: v, value: "" })}>
                        <SelectTrigger className="h-9 w-[180px]">
                          <SelectValue placeholder="Select label" />
                        </SelectTrigger>
                        <SelectContent>
                          {labelNames.length === 0 && <SelectItem value="__loading" disabled>Loading…</SelectItem>}
                          {labelNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {/* Operator */}
                      <Select value={f.op} onValueChange={(v) => updateFilter(f.id, { op: v })}>
                        <SelectTrigger className="h-9 w-[72px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {OPERATORS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {/* Value */}
                      <Select value={f.value} onValueChange={(v) => updateFilter(f.id, { value: v })} disabled={!f.label}>
                        <SelectTrigger className="h-9 w-[200px]">
                          <SelectValue placeholder={f.label ? "Select value" : "Pick a label first"} />
                        </SelectTrigger>
                        <SelectContent>
                          {valueOptions.length === 0 && <SelectItem value="__none" disabled>No values</SelectItem>}
                          {valueOptions.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-red-500"
                        onClick={() => removeFilter(f.id)}
                        aria-label="Remove filter"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}

                <Button variant="outline" size="sm" className="gap-1.5" onClick={addFilter}>
                  <Plus className="w-3.5 h-3.5" /> Add label filter
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder='Line filter (contains)…'
                    value={lineFilter}
                    onChange={(e) => setLineFilter(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") runQuery(); }}
                    className="pl-8"
                  />
                </div>
                <Button onClick={runQuery} className="gap-1.5"><Play className="w-3.5 h-3.5" /> Run query</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Results
                {committed && !logsQuery.isLoading && (
                  <span className="text-muted-foreground font-normal">
                    {" · "}{rows.length} line{rows.length === 1 ? "" : "s"} loaded{logsQuery.hasNextPage ? " (more available)" : ""}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!committed ? (
                <p className="text-sm text-muted-foreground text-center py-10">Set filters and click <span className="font-medium">Run query</span> to load logs.</p>
              ) : logsQuery.isLoading ? (
                <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : logsQuery.error ? (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <AlertCircle className="w-6 h-6 text-red-500" />
                  <p className="text-sm">{(logsQuery.error as Error).message}</p>
                </div>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No logs match these filters in this time range.</p>
              ) : (
                <div className="space-y-1.5 max-h-[560px] overflow-y-auto">
                  {rows.map((r, idx) => {
                    const sev = (r.severity || "").toLowerCase();
                    return (
                      <div key={idx} className={`p-2.5 rounded-md text-xs font-mono border-l-4 ${SEVERITY_STYLES[sev] ?? "bg-muted/40 border-border text-foreground"}`}>
                        <div className="flex justify-between items-center gap-2">
                          <span className="font-semibold uppercase">{r.severity ?? "log"}</span>
                          <span className="text-[10px] opacity-70 whitespace-nowrap">{new Date(r.ts).toLocaleString()}</span>
                        </div>
                        <div className="text-[11px] mt-1 whitespace-pre-wrap break-words">{r.message ?? r.line}</div>
                        {/* Indexed labels — click to drill down (filter for / filter out). */}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {Object.entries(r.labels ?? {}).map(([k, v]) => (
                            <span key={k} className="inline-flex items-center rounded border border-border bg-background/60 text-[10px] overflow-hidden">
                              <button
                                type="button"
                                className="px-1.5 py-0.5 hover:bg-primary/10 hover:text-primary transition-colors"
                                title={`Filter for ${k}="${v}"`}
                                onClick={() => applyLabelFilter(k, String(v), "=")}
                              >
                                {k}=<span className="font-semibold">{String(v)}</span>
                              </button>
                              <button
                                type="button"
                                className="px-1 py-0.5 border-l border-border opacity-50 hover:opacity-100 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                                title={`Filter out ${k}="${v}"`}
                                onClick={() => applyLabelFilter(k, String(v), "!=")}
                              >
                                <Minus className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                        {(r.parsed?.alert_id != null || r.parsed?.status != null) && (
                          <div className="text-[10px] opacity-60 mt-1 flex flex-wrap gap-x-3">
                            {r.parsed?.alert_id != null && <span>alert: {String(r.parsed.alert_id)}</span>}
                            {r.parsed?.status != null && <span>status: {String(r.parsed.status)}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Time-cursor pagination: fetch the next-oldest page. */}
                  <div className="pt-2 flex justify-center">
                    {logsQuery.hasNextPage ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => logsQuery.fetchNextPage()}
                        disabled={logsQuery.isFetchingNextPage}
                      >
                        {logsQuery.isFetchingNextPage ? "Loading…" : "Load older logs"}
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground py-1">End of results for this range.</span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
      </div>
    </div>
  );
}
