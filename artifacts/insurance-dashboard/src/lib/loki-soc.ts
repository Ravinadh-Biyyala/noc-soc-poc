// Data layer for the Security Operations (SOC) dashboard. Composes the canonical
// soc_* NOC functions (services/agents-py app/loki/noc.py → /api/loki/noc/*) in
// parallel into one model — same grounding as the chat agent, so the numbers
// always agree. Per-call resilience: a failing function degrades its panel
// rather than collapsing the page (only errors if EVERYTHING fails).

import { callNoc } from "@/lib/loki-noc";
import { seriesToTimeRows } from "@/lib/loki-dashboard";
import type {
  SocSummary, SocEventTrend, SocTopFields, SocRecentEvents, SocFieldItem, SocEventRow,
  SocThreatTrend, SocPosture, AttackTypes, ThreatsByCountry, AttackTypeCount, CountryCount,
  Incidents, IncidentRow,
} from "@/lib/loki-noc";

const EMPTY_POSTURE: SocPosture = {
  security_incidents: 0, malicious_queries: 0, firewall_availability_pct: 0,
  firewall_total: 0, firewall_up: 0, mttd_minutes: 0, mttr_minutes: 0,
  patch_compliance_pct: 0, av_compliance_pct: 0, domain_health_pct: 0, configured: [],
};

export interface SocDashboardModel {
  summary: SocSummary;
  posture: SocPosture;
  trend: { rows: Array<Record<string, unknown>>; keys: string[] };
  threatTrend: { rows: Array<Record<string, unknown>>; keys: string[] };
  attackTypes: AttackTypeCount[];
  countries: CountryCount[];
  securityIncidents: IncidentRow[];
  mitre: SocFieldItem[];
  tactics: SocFieldItem[];
  threatActors: SocFieldItem[];
  iocTypes: SocFieldItem[];
  winEvents: SocFieldItem[];
  winProcs: SocFieldItem[];
  fwActions: SocFieldItem[];
  fwPorts: SocFieldItem[];
  siemEvents: SocEventRow[];
  sentinelEvents: SocEventRow[];
  darknetEvents: SocEventRow[];
  endpointEvents: SocEventRow[];
}

const EMPTY_SUMMARY: SocSummary = {
  sources: [], total: 0, by_severity: [],
  kpis: {
    siem_critical_high: 0, darknet_iocs: 0, sentinel_alerts: 0,
    windows_alerts: 0, firewall_denies: 0, edr_events: 0, threats_blocked: 0,
  },
};

export async function fetchSocDashboard(since: string): Promise<SocDashboardModel> {
  let ok = 0, failed = 0;
  async function safe<T>(name: string, params: Record<string, unknown>, fallback: T): Promise<T> {
    try { const r = await callNoc<T>(name, params); ok += 1; return r; }
    catch { failed += 1; return fallback; }
  }
  const topFields = (source: string, field: string, limit = 10) =>
    safe<SocTopFields>("soc_top_fields", { source, field, limit, since }, { source, field, items: [], total: 0 });
  const recent = (source: string | undefined, limit: number, severity?: string) =>
    safe<SocRecentEvents>("soc_recent_events", { source, severity, limit, since }, { source: source ?? null, count: 0, rows: [] });

  const [
    summary, posture, trend, threatTrend, attacks, threats, secIncidents,
    mitre, tactics, actors, iocs, winEvents, winProcs, fwActions, fwPorts,
    siem, sentinel, darknet, endpoint,
  ] = await Promise.all([
    safe<SocSummary>("soc_summary", { since }, EMPTY_SUMMARY),
    safe<SocPosture>("soc_posture", { since }, EMPTY_POSTURE),
    safe<SocEventTrend>("soc_event_trend", { since }, { since, step: "", series: [] }),
    safe<SocThreatTrend>("soc_threat_trend", { since }, { since, step: "", series: [] }),
    safe<AttackTypes>("attack_types", { since }, { types: [], total: 0 } as AttackTypes),
    safe<ThreatsByCountry>("threats_by_country", { since }, { countries: [], total: 0 } as ThreatsByCountry),
    safe<Incidents>("incidents", { since, incident_type: "security", limit: 10 }, { count: 0, incidents: [], by_severity: [] }),
    topFields("fortisiem", "mitre_technique"),
    topFields("sentinel", "tactics"),
    topFields("darknet", "threat_actor"),
    topFields("darknet", "indicator_type"),
    topFields("windows", "event_id"),
    topFields("windows", "process"),
    topFields("firewall", "action"),
    topFields("firewall", "dst_port"),
    recent("fortisiem", 40, "critical"),
    recent("sentinel", 40),
    recent("darknet", 40),
    recent(undefined, 50, "warning"), // windows+firewall+edr endpoint-ish stream
  ]);

  if (ok === 0 && failed > 0) {
    throw new Error("All SOC queries failed — is the Python Loki service running and reachable?");
  }

  return {
    summary,
    posture,
    trend: seriesToTimeRows(trend.series ?? []),
    threatTrend: seriesToTimeRows(threatTrend.series ?? []),
    attackTypes: attacks.types ?? [],
    countries: threats.countries ?? [],
    securityIncidents: secIncidents.incidents ?? [],
    mitre: mitre.items ?? [],
    tactics: tactics.items ?? [],
    threatActors: actors.items ?? [],
    iocTypes: iocs.items ?? [],
    winEvents: winEvents.items ?? [],
    winProcs: winProcs.items ?? [],
    fwActions: fwActions.items ?? [],
    fwPorts: fwPorts.items ?? [],
    siemEvents: siem.rows ?? [],
    sentinelEvents: sentinel.rows ?? [],
    darknetEvents: darknet.rows ?? [],
    endpointEvents: endpoint.rows ?? [],
  };
}
