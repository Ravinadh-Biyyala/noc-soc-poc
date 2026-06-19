// Data layer for the NOC (Network Operations) deep-dive dashboard. Composes the
// canonical NOC functions (services/agents-py app/loki/noc.py → /api/loki/noc/*).
//
// Split into TWO models on purpose: the device-metric `unwrap` queries
// (metric_trend, top_devices_by_metric) are very slow on this Loki instance
// (topk over ~139 dense series — 15-25s), while everything else is fast (count/
// json aggregations, ~1-6s). The page fetches them as separate queries so the
// fast "core" renders immediately and the slow "performance" panels fill in
// independently instead of blocking the whole dashboard.

import { callNoc } from "@/lib/loki-noc";
import type {
  AlarmsBySeverity, Incidents, EarlyWarning, MetricSeries,
  IncidentRow, SeverityCount,
  NocAlarmAnalytics, TopAlarmingDevices, NocNodePerformance, AlarmingDevice, NodePerf,
} from "@/lib/loki-noc";

// ── core (fast) ───────────────────────────────────────────────────────────────
// NOTE: panels that already live on the main NOC/SOC overview dashboard (alarm
// volume trend, alarms-by-category, top-CPU ranking, branch health, top critical
// alarms, the device-availability/peak-CPU/branches-down KPIs) are intentionally
// NOT fetched here — this page is the network-ops DEEP-DIVE, not a repeat.

export interface NocCoreModel {
  kpis: {
    totalAlarms: number; criticalAlarms: number; warningAlarms: number;
    openAlarms: number; resolvedAlarms: number; networkIncidents: number; earlyWarnings: number;
  };
  analytics: NocAlarmAnalytics;
  topAlarmingDevices: AlarmingDevice[];
  nodes: NodePerf[];
  incidents: IncidentRow[];
  earlyWarnings: EarlyWarning[];
}

// ── performance (unwrap-heavy fleet trends) ─────────────────────────────────────

export interface NocPerfModel {
  window: string;
  cpuTrend: { rows: Array<Record<string, unknown>>; keys: string[] };
  latencyTrend: { rows: Array<Record<string, unknown>>; keys: string[] };
}

const EMPTY_ANALYTICS: NocAlarmAnalytics = {
  total: 0, by_source: [], by_category: [], by_severity: [], by_model: [], by_site: [], by_status: [],
};

const RANGE_SECONDS: Record<string, number> = {
  "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "30d": 2592000, "90d": 7776000, "180d": 15552000, "1y": 31536000,
};

/** Floor the performance window to ≥24h — device metrics on this feed are a dense
 * batch, and short windows can miss it entirely (returning empty charts). */
export function perfWindow(since: string): string {
  return (RANGE_SECONDS[since] ?? 0) >= RANGE_SECONDS["24h"] ? since : "24h";
}

function sevCount(list: SeverityCount[], sev: string): number {
  return list.find((s) => s.severity?.toLowerCase() === sev)?.count ?? 0;
}
function keyCount(list: Array<{ key: string; count: number }>, key: string): number {
  return list.find((s) => s.key?.toLowerCase() === key)?.count ?? 0;
}

function fleetRows(series: MetricSeries[]): { rows: Array<Record<string, unknown>>; keys: string[] } {
  const byTs = new Map<number, number>();
  for (const s of series ?? []) for (const v of s.values) byTs.set(v.ts, (byTs.get(v.ts) || 0) + v.value);
  const rows = [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([ts, value]) => ({
    time: new Date(ts).toLocaleString(), value: Math.round(value * 100) / 100,
  }));
  return { rows, keys: ["value"] };
}

// Run thunks with bounded concurrency, preserving order.
async function runPool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) { const idx = next++; results[idx] = await tasks[idx](); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function makeSafe() {
  const state = { ok: 0, failed: 0 };
  function safe<T>(name: string, params: Record<string, unknown>, fallback: T): () => Promise<T> {
    return async () => {
      try { const r = await callNoc<T>(name, params); state.ok += 1; return r; }
      catch { state.failed += 1; return fallback; }
    };
  }
  return { state, safe };
}

export async function fetchNocCore(since: string): Promise<NocCoreModel> {
  const { state, safe } = makeSafe();
  const [alarmsBySev, analytics, alarmingR, nodesR, incidentsR, earlyR] = await runPool(([
    safe<AlarmsBySeverity>("alarms_by_severity", { since }, { severities: [], total: 0 }),
    safe<NocAlarmAnalytics>("noc_alarm_analytics", { since }, EMPTY_ANALYTICS),
    safe<TopAlarmingDevices>("top_alarming_devices", { since, limit: 12 }, { devices: [], total: 0 }),
    safe<NocNodePerformance>("noc_node_performance", { since }, { nodes: [] }),
    safe<Incidents>("incidents", { since, incident_type: "network", limit: 20 }, { count: 0, incidents: [], by_severity: [] }),
    safe<{ warnings: EarlyWarning[] }>("early_warnings", { since, limit: 14 }, { warnings: [] }),
  ] as Array<() => Promise<unknown>>), 4) as [
    AlarmsBySeverity, NocAlarmAnalytics, TopAlarmingDevices, NocNodePerformance,
    Incidents, { warnings: EarlyWarning[] },
  ];

  if (state.ok === 0 && state.failed > 0) {
    throw new Error("All NOC queries failed — is the Python Loki service running and reachable?");
  }

  return {
    kpis: {
      totalAlarms: alarmsBySev.total ?? 0,
      criticalAlarms: sevCount(alarmsBySev.severities ?? [], "critical"),
      warningAlarms: sevCount(alarmsBySev.severities ?? [], "warning"),
      openAlarms: keyCount(analytics.by_status ?? [], "open"),
      resolvedAlarms: keyCount(analytics.by_status ?? [], "resolved"),
      networkIncidents: incidentsR.count ?? 0,
      earlyWarnings: (earlyR.warnings ?? []).length,
    },
    analytics,
    topAlarmingDevices: alarmingR.devices ?? [],
    nodes: nodesR.nodes ?? [],
    incidents: incidentsR.incidents ?? [],
    earlyWarnings: earlyR.warnings ?? [],
  };
}

export async function fetchNocPerf(since: string): Promise<NocPerfModel> {
  const win = perfWindow(since);
  const { safe } = makeSafe();
  // Fleet metric TRENDS only (fast) — the slow topk-over-all-devices rankings
  // live on the main NOC/SOC overview dashboard, so they're not repeated here.
  const [cpuTrendR, latTrendR] = await runPool(([
    safe<{ series: MetricSeries[] }>("metric_trend", { metric: "cpu_utilization_percent", agg: "avg", since: win }, { series: [] }),
    safe<{ series: MetricSeries[] }>("metric_trend", { metric: "latency_ms", agg: "avg", since: win }, { series: [] }),
  ] as Array<() => Promise<unknown>>), 2) as [
    { series: MetricSeries[] }, { series: MetricSeries[] },
  ];
  return {
    window: win,
    cpuTrend: fleetRows(cpuTrendR.series ?? []),
    latencyTrend: fleetRows(latTrendR.series ?? []),
  };
}
