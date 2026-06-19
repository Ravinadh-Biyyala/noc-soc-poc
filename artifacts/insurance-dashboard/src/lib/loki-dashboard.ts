// Data layer for the unified NOC/SOC overview dashboard. It composes the backend
// canonical NOC functions (services/agents-py app/loki/noc.py, proxied at
// /api/loki/noc/*) in parallel into one dashboard model — the dashboard never
// builds LogQL itself; it calls the same functions the chat agent uses.

import {
  callNoc, type DeviceInventory, type AlarmsBySeverity, type AlarmRow, type Incidents,
  type EarlyWarning, type DeviceMetricRank, type CategoryCount, type SecurityEvents, type MetricSeries,
  type AttackTypes, type ThreatsByCountry, type BranchHealth, type AttackTypeCount, type CountryCount,
  type BranchHealthItem, type AssetInventory,
} from "@/lib/loki-noc";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface TimeRangeOpt { value: string; label: string }
export const DASH_TIME_RANGES: TimeRangeOpt[] = [
  { value: "1h", label: "Last 1 hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "180d", label: "Last 6 months" },
  { value: "1y", label: "Last 1 year" },
];

// Merge metric series into time-bucketed rows for a multi-series chart.
export function seriesToTimeRows(seriesList: MetricSeries[]): { rows: Array<Record<string, unknown>>; keys: string[] } {
  const keys = seriesList.map((s) => s.name);
  const byTs = new Map<number, Record<string, unknown>>();
  for (const s of seriesList) {
    for (const v of s.values) {
      const row = byTs.get(v.ts) ?? { ts: v.ts, time: new Date(v.ts).toLocaleString() };
      row[s.name] = (Number(row[s.name]) || 0) + (v.value || 0);
      byTs.set(v.ts, row);
    }
  }
  const rows = [...byTs.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
  for (const r of rows) for (const k of keys) if (r[k] == null) r[k] = 0;
  return { rows, keys };
}

export interface GeoPoint { ip: string; count: number; lat: number; lon: number; country: string; countryCode: string; city: string }

export async function geoipLookup(ips: string[]): Promise<Record<string, { lat: number; lon: number; country: string; countryCode: string; city: string }>> {
  if (ips.length === 0) return {};
  try {
    const r = await fetch(`${API_BASE}/api/loki-geoip`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ ips }),
    });
    if (!r.ok) return {};
    return (await r.json()).geo ?? {};
  } catch {
    return {};
  }
}

const sevCount = (sevs: { severity: string; count: number }[], name: string) =>
  sevs.find((s) => s.severity.toLowerCase() === name)?.count ?? 0;

export interface NocDashboardData {
  inventory: DeviceInventory;
  alarmsBySeverity: AlarmsBySeverity;
  alarmTrend: { rows: Array<Record<string, unknown>>; keys: string[] };
  topAlarms: AlarmRow[];
  incidents: Incidents;
  earlyWarnings: EarlyWarning[];
  topCpu: DeviceMetricRank[];
  topLink: DeviceMetricRank[];
  worstLatency: DeviceMetricRank[];
  eventsByCategory: CategoryCount[];
  security: SecurityEvents;
  attackTypes: AttackTypeCount[];
  threatsByCountry: CountryCount[];
  branches: BranchHealthItem[];
  geo: GeoPoint[];
  kpis: {
    totalDevices: number; deviceOnline: number; availabilityPct: number;
    totalAlarms: number; criticalAlarms: number;
    activeIncidents: number; earlyWarnings: number; securityEvents: number;
    peakCpu: number; threatsBlocked: number; branchesDown: number;
  };
}

// ── persistent cache ─────────────────────────────────────────────────────────
// react-query's cache is in-memory, so a cold page load / remount always shows
// skeletons. We mirror the last-good dashboard (per time range) to localStorage so
// the page can render the PREVIOUS snapshot instantly while a single background
// refetch recomputes the whole thing and swaps it in atomically. Bump CACHE_VERSION
// if NocDashboardData's shape changes so stale snapshots are ignored.
const CACHE_VERSION = "v1";
const cacheKey = (since: string) => `noc-dashboard-cache:${CACHE_VERSION}:${since}`;

export interface CachedDashboard { data: NocDashboardData; ts: number }

export function readDashboardCache(since: string): CachedDashboard | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(cacheKey(since));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CachedDashboard;
    return parsed && parsed.data ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeDashboardCache(since: string, data: NocDashboardData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(since), JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* quota exceeded / storage disabled — caching is best-effort */
  }
}

export async function fetchNocDashboard(since: string): Promise<NocDashboardData> {
  // Per-call resilience: a single failing function degrades that panel to empty
  // rather than collapsing the whole dashboard. Only throw if EVERYTHING failed.
  let ok = 0, failed = 0;
  async function safe<T>(name: string, params: Record<string, unknown>, fallback: T): Promise<T> {
    try { const r = await callNoc<T>(name, params); ok += 1; return r; }
    catch { failed += 1; return fallback; }
  }

  const [inventory, alarmsBySeverity, alarmTrendR, topAlarmsR, incidents, earlyR, topCpuR, topLinkR, latencyR, byCategory, security, attacksR, threatsR, branchR, assetsR] = await Promise.all([
    safe<DeviceInventory>("device_inventory", { since }, { categories: [], total: 0 }),
    safe<AlarmsBySeverity>("alarms_by_severity", { since }, { severities: [], total: 0 }),
    safe<{ series: MetricSeries[] }>("alarm_trend", { since }, { series: [] }),
    safe<{ alarms: AlarmRow[] }>("top_alarms", { since, severity: "critical", limit: 12 }, { alarms: [] }),
    safe<Incidents>("incidents", { since, limit: 20 }, { count: 0, incidents: [], by_severity: [] }),
    safe<{ warnings: EarlyWarning[] }>("early_warnings", { since, limit: 12 }, { warnings: [] }),
    safe<{ devices: DeviceMetricRank[] }>("top_devices_by_metric", { metric: "cpu_utilization_percent", agg: "avg", since, limit: 10 }, { devices: [] }),
    safe<{ devices: DeviceMetricRank[] }>("top_devices_by_metric", { metric: "interface_utilization_percent", agg: "avg", since, limit: 10 }, { devices: [] }),
    safe<{ devices: DeviceMetricRank[] }>("top_devices_by_metric", { metric: "latency_ms", agg: "max", since, limit: 10 }, { devices: [] }),
    safe<{ categories: CategoryCount[] }>("events_by_category", { since }, { categories: [] }),
    safe<SecurityEvents>("security_events", { since }, { security_alarms_by_severity: [], security_alarms_total: 0, threats_blocked: 0, attack_types: [], top_countries: [] }),
    safe<AttackTypes>("attack_types", { since }, { types: [], total: 0 }),
    safe<ThreatsByCountry>("threats_by_country", { since }, { countries: [], total: 0 }),
    safe<BranchHealth>("branch_health", { since }, { branches: [], total: 0, down: 0, up: 0 }),
    safe<AssetInventory>("asset_inventory", { since }, { assets: [], total: 0, online: 0, degraded: 0, offline: 0, availability_pct: 0, by_type: [] }),
  ]);

  if (ok === 0 && failed > 0) {
    throw new Error("All NOC queries failed — is the Python Loki service running and reachable?");
  }

  // The branch_health feed carries real lat/lon, so plot branches directly on the
  // threat map (no GeoIP round-trip needed); marker size scales with critical count.
  const branches = branchR.branches ?? [];
  const geo: GeoPoint[] = branches
    .filter((b) => typeof b.lat === "number" && typeof b.lon === "number")
    .map((b) => ({
      ip: b.code, count: b.critical, lat: b.lat as number, lon: b.lon as number,
      country: b.branch ?? b.code, countryCode: b.code, city: b.status,
    }));

  const incidentsBySev = incidents.by_severity ?? [];
  const activeIncidents = sevCount(incidentsBySev, "critical") + sevCount(incidentsBySev, "high");
  const topCpu = topCpuR.devices ?? [];

  // Canonical fleet size = device_inventory total (the full device_id set on the
  // Loki server, e.g. 139). asset_inventory only covers devices seen in
  // manageengine alarms/metrics, so it undercounts — use it only for health
  // (degraded/offline), and derive online against the true total.
  const totalDevices = inventory.total || assetsR.total || 0;
  const deviceOnline = Math.max(0, totalDevices - (assetsR.degraded ?? 0) - (assetsR.offline ?? 0));
  const availabilityPct = totalDevices ? Math.round((deviceOnline / totalDevices) * 100) : 0;

  return {
    inventory,
    alarmsBySeverity,
    alarmTrend: seriesToTimeRows(alarmTrendR.series ?? []),
    topAlarms: topAlarmsR.alarms ?? [],
    incidents,
    earlyWarnings: earlyR.warnings ?? [],
    topCpu,
    topLink: topLinkR.devices ?? [],
    worstLatency: latencyR.devices ?? [],
    eventsByCategory: byCategory.categories ?? [],
    security,
    attackTypes: attacksR.types ?? [],
    threatsByCountry: threatsR.countries ?? [],
    branches,
    geo,
    kpis: {
      totalDevices,
      deviceOnline,
      availabilityPct,
      totalAlarms: alarmsBySeverity.total ?? 0,
      criticalAlarms: sevCount(alarmsBySeverity.severities ?? [], "critical"),
      activeIncidents,
      earlyWarnings: (earlyR.warnings ?? []).length,
      securityEvents: security.security_alarms_total ?? 0,
      peakCpu: topCpu.length ? Math.round(topCpu[0].value) : 0,
      threatsBlocked: attacksR.total ?? 0,
      branchesDown: branchR.down ?? 0,
    },
  };
}
