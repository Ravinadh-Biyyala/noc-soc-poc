// Client for the backend NOC function registry (services/agents-py app/loki/noc.py),
// proxied by Express at /api/loki/noc/*. These canonical functions are the single
// source of truth shared by the dashboard AND the chat agent — so the dashboard
// never re-derives LogQL and the agent calls a named function instead of
// hallucinating queries.

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Run a canonical NOC function by name with params → structured result. */
export async function callNoc<T = Record<string, unknown>>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${API_BASE}/api/loki/noc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.detail || detail.error || `NOC function "${name}" failed (${r.status})`);
  }
  return r.json();
}

export interface NocFunctionParam { name: string; type: string; required: boolean; description: string }
export interface NocFunctionSpec { name: string; description: string; params: NocFunctionParam[] }

/** The function specs (name/description/params) — used to ground the chat agent. */
export async function listNocFunctions(): Promise<NocFunctionSpec[]> {
  const r = await fetch(`${API_BASE}/api/loki/noc/functions`, { credentials: "include" });
  if (!r.ok) return [];
  const body = await r.json().catch(() => ({}));
  return Array.isArray(body.functions) ? body.functions : [];
}

// ── Result types (mirror app/loki/noc.py) ──────────────────────────────────

export interface CategoryCount { category: string; count: number }
export interface SeverityCount { severity: string; count: number }
export interface DeviceInventory { categories: CategoryCount[]; total: number }
export interface AlarmsBySeverity { severities: SeverityCount[]; total: number }

export interface AlarmRow {
  ts: number; alert_id?: string; device_id?: string; model?: string;
  category?: string; severity?: string; source?: string; status?: string; message?: string;
}
export interface TopAlarms { severity: string; count: number; alarms: AlarmRow[] }

export interface IncidentRow {
  ts: number; incident_id?: string; type?: string; severity?: string; incident?: string;
  summary?: string; source?: string; root_cause?: string; confidence?: number;
  affected_assets?: string[]; early_warning?: boolean;
}
export interface Incidents { count: number; incidents: IncidentRow[]; by_severity: SeverityCount[] }

export interface IncidentDetail {
  incident_id: string; incident?: string; summary?: string; severity?: string; type?: string; source?: string;
  affected_assets?: string[]; root_cause?: string; rca_summary?: string; confidence?: number;
  evidence?: string[]; recommendation?: string[]; escalation_team?: string; automatable?: boolean;
  early_warning?: Record<string, unknown> | null; raw_logs?: Array<{ agent: string; ts: number; line: string }>;
}

export interface EarlyWarning {
  ts: number; incident_id?: string; kind?: string; risk?: string; warning?: string;
  asset?: string; observed?: number; threshold?: number;
}
export interface EarlyWarnings { count: number; warnings: EarlyWarning[] }

export interface DeviceMetricRank { device_id: string; value: number }
export interface TopDevicesByMetric { metric: string; agg: string; devices: DeviceMetricRank[] }

export interface MetricSeries { name: string; values: Array<{ ts: number; value: number }> }
export interface MetricTrend { metric: string; agg: string; device_id: string | null; series: MetricSeries[] }

export interface DeviceHealth {
  device_id: string; category?: string; model?: string;
  metrics: Record<string, number | null>; open_alarms: number;
  recent_alarms: AlarmRow[]; related_incidents: IncidentRow[];
}

export interface AttackTypeCount { attack_type: string; count: number }
export interface CountryCount { country: string; count: number }

export interface SecurityEvents {
  security_alarms_by_severity: SeverityCount[]; security_alarms_total: number;
  threats_blocked: number; attack_types: AttackTypeCount[]; top_countries: CountryCount[];
}

export interface AttackTypes { types: AttackTypeCount[]; total: number }
export interface ThreatsByCountry { countries: CountryCount[]; total: number }

export interface BranchHealthItem {
  code: string; branch?: string; status: string; lat?: number; lon?: number;
  critical: number; warning: number; ts?: number;
}
export interface BranchHealth { branches: BranchHealthItem[]; total: number; down: number; up: number }

export interface AssetRow {
  name: string; type: string; ip: string | null; location: string | null;
  category: string | null; model: string | null; severity: string | null;
  status: "up" | "degraded" | "down"; alarms: number;
}
export interface AssetInventory {
  assets: AssetRow[];
  total: number; online: number; degraded: number; offline: number;
  availability_pct: number; by_type: Array<{ type: string; count: number }>;
}

// ── Direct device inventory (no LogQL query) ────────────────────────────────
// The Assets + Topology pages pull the *complete* device list straight from the
// Loki server's `device_id` label-values endpoint (proxied at /api/loki, which
// targets LOKI_URL). This is a label lookup, not a LogQL query, so it returns
// EVERY monitored device — not just those surfaced by the alarm-scoped
// asset_inventory function. Per-device status/severity/model aren't available
// from a label lookup, so they're left unset (status defaults to "up").

// device_id prefix → asset type (mirrors `_device_type` in app/loki/noc.py).
const DEVICE_TYPE_PREFIX: Array<[string, string[]]> = [
  ["atm", ["ATM-"]],
  ["router", ["RTR-", "ROUTER"]],
  ["switch", ["SW-", "SWT-", "SWITCH"]],
  ["server", ["SRV-", "APP-", "DB-", "EXCH-", "WSUS-"]],
  ["vm", ["VM-", "VMW-"]],
  ["network", ["FW-", "VPN-", "AP-", "WLC-", "GW-", "LB-"]],
];

function deviceType(name: string): string {
  const n = (name || "").toUpperCase();
  for (const [t, prefixes] of DEVICE_TYPE_PREFIX) {
    if (prefixes.some((p) => n.startsWith(p))) return t;
  }
  return "host";
}

/** The middle segment(s) of a device id (TYPE-<location>-NN) as a location hint. */
function deviceLocation(name: string): string | null {
  const parts = (name || "").split("-").filter(Boolean);
  if (parts.length >= 3) return parts.slice(1, -1).join("-") || null;
  return null;
}

/**
 * Fetch the full fleet inventory directly from the Loki server (label-values
 * lookup on `device_id`, no LogQL query). Returns every monitored device.
 */
export async function fetchAllDevices(window = "30d"): Promise<AssetInventory> {
  const r = await fetch(
    `${API_BASE}/api/loki/label/device_id/values?since=${encodeURIComponent(window)}`,
    { credentials: "include" },
  );
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.detail || detail.error || `Loki device lookup failed (${r.status})`);
  }
  const body = await r.json();
  const names: string[] = Array.isArray(body.values) ? body.values : [];

  const assets: AssetRow[] = names
    .filter((n) => typeof n === "string" && n.trim())
    .map((name) => ({
      name,
      type: deviceType(name),
      ip: null,
      location: deviceLocation(name),
      category: null,
      model: null,
      severity: null,
      status: "up" as const,
      alarms: 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byType = new Map<string, number>();
  for (const a of assets) byType.set(a.type, (byType.get(a.type) ?? 0) + 1);

  return {
    assets,
    total: assets.length,
    online: assets.length,
    degraded: 0,
    offline: 0,
    availability_pct: assets.length ? 100 : 0,
    by_type: [...byType.entries()].map(([type, count]) => ({ type, count })),
  };
}

// ── SOC (Security Operations) — mirror the soc_* functions in app/loki/noc.py ──

export interface SocSourceSummary { source: string; total: number; by_severity: SeverityCount[] }
export interface SocKpis {
  siem_critical_high: number; darknet_iocs: number; sentinel_alerts: number;
  windows_alerts: number; firewall_denies: number; edr_events: number; threats_blocked: number;
}
export interface SocSummary {
  sources: SocSourceSummary[]; total: number; by_severity: SeverityCount[]; kpis: SocKpis;
}
export interface SocEventTrend { since: string; step: string; series: MetricSeries[] }
export interface SocFieldItem { value: string; count: number }
export interface SocTopFields { source: string; field: string; items: SocFieldItem[]; total: number }
export interface SocEventRow {
  ts: number; source?: string; severity?: string; host?: string; user?: string; message?: string;
  event_id?: string | number; mitre_technique?: string; tactics?: string; threat_actor?: string;
  indicator_type?: string; ioc_value?: string; process?: string; action?: string; protocol?: string;
  src_ip?: string; dst_ip?: string; dst_port?: string | number; country?: string;
  rule_name?: string; rule_id?: string; alert_name?: string; platform?: string; confidence?: string;
  [k: string]: unknown;
}
export interface SocRecentEvents { source: string | null; count: number; rows: SocEventRow[] }

export interface SocThreatTrend { since: string; step: string; series: MetricSeries[] }
export interface SocPosture {
  security_incidents: number;
  malicious_queries: number;
  firewall_availability_pct: number;
  firewall_total: number;
  firewall_up: number;
  mttd_minutes: number;
  mttr_minutes: number;
  patch_compliance_pct: number;
  av_compliance_pct: number;
  domain_health_pct: number;
  configured: string[];
}

// ── NOC deep-dive — mirror noc_alarm_analytics / top_alarming_devices /
//    noc_node_performance in app/loki/noc.py ───────────────────────────────────

export interface KeyCount { key: string; count: number }
export interface NocAlarmAnalytics {
  total: number;
  by_source: KeyCount[];
  by_category: KeyCount[];
  by_severity: SeverityCount[];
  by_model: KeyCount[];
  by_site: KeyCount[];
  by_status: KeyCount[];
}
export interface AlarmingDevice { device: string; count: number }
export interface TopAlarmingDevices { devices: AlarmingDevice[]; total: number }
export interface NodePerf {
  node: string; cpu_pct?: number; mem_pct?: number; bandwidth_pct?: number; latency_ms?: number;
}
export interface NocNodePerformance { nodes: NodePerf[] }

export const METRIC_LABELS: Record<string, string> = {
  cpu_utilization_percent: "CPU %",
  interface_utilization_percent: "Link util %",
  latency_ms: "Latency (ms)",
};

// ── Tracing (waterfall) ─────────────────────────────────────────────────────

export interface TraceListItem {
  incident_id: string; type?: string; severity?: string; device_id?: string | null; title?: string; ts: number;
}
export interface RecentTraces {
  count: number;
  incidents: TraceListItem[];
  by_type: Array<{ type: string; count: number }>;
}

export type TraceSpanKind = "event" | "warning" | "diagnosis";
export interface TraceSpan {
  label: string; kind: TraceSpanKind; severity?: string | null; source?: string | null;
  message?: string; ts: number; offset_ms: number; duration_ms: number;
}
export interface IncidentTrace {
  incident_id: string; device_id?: string | null; incident?: string; severity?: string; type?: string;
  root_cause?: string; rca_summary?: string; confidence?: number; recommendation?: string[]; escalation_team?: string;
  evidence?: string[]; detected_at?: number; started_at: number; ended_at: number; duration_ms: number;
  span_count: number; spans: TraceSpan[]; summary?: string;
}
