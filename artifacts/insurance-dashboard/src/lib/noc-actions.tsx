// Structured chat tools for the BI Companion. Registers one CopilotKit action per
// canonical backend NOC function (so the agent calls a named function instead of
// hallucinating LogQL) plus a generic `queryLoki` fallback and `pinLokiVisual`.
// Each action's `render` shows a rich, structured card/chart inline in the chat —
// not raw text. Registered once from CopilotPanel so the tools work on every page.

import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useCopilotAction, useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { Sparkles, Boxes, AlertOctagon, Server, ServerCog, Activity, ShieldAlert, Workflow, HeartPulse, ArrowRight, Compass, Crosshair, Globe, Building2 } from "lucide-react";
import {
  callNoc, type IncidentDetail, type DeviceHealth, type TopAlarms, type Incidents,
  type TopDevicesByMetric, type MetricTrend, type SecurityEvents, type AlarmsBySeverity,
  type DeviceInventory, type RecentTraces, type IncidentTrace, type AttackTypes,
  type ThreatsByCountry, type BranchHealth, type SocSummary, type SocTopFields,
  type SocRecentEvents, type NocAlarmAnalytics, type TopAlarmingDevices,
  type NocNodePerformance, METRIC_LABELS,
} from "@/lib/loki-noc";
import { postLokiQuery, buildChartRows, type LokiTransform } from "@/lib/loki-api";
import { useLokiPins } from "@/lib/loki-pins";
import { useNocUi } from "@/lib/ui-bridge";
import { type DrawerTarget } from "@/components/loki/DiagnosisDrawer";
import { useToast } from "@/hooks/use-toast";
import { severityBadge, severityColor, fmtNum } from "@/lib/noc-format";
import LokiChart from "@/components/loki/LokiChart";
import AlarmTable from "@/components/loki/AlarmTable";
import IncidentCard from "@/components/loki/IncidentCard";
import DeviceHealthCard from "@/components/loki/DeviceHealthCard";
import TraceWaterfall from "@/components/loki/TraceWaterfall";

// ── render helpers ───────────────────────────────────────────────────────────

function CardShell({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 mb-2"><Icon className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-semibold">{title}</span></div>
      {children}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <div className="my-2 text-[11px] text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-primary animate-pulse" /> {label}…</div>;
}

function ErrorLine({ msg }: { msg: string }) {
  return <div className="my-2 text-[11px] text-rose-400">⚠ {msg}</div>;
}

// A render prop param shape that is a supertype of CopilotKit's ActionRenderProps
// union (so it type-checks) while exposing the handler result + status we need.
type RenderProps<R> = { status: string; result?: R };

// ── AG-UI: let the agent's inline answers drive the app UI ────────────────────

// Follow-up "chips" (like the sample's pill suggestions). Clicking one sends it as
// the next user turn, so the agent keeps the investigation flowing in-place.
function FollowUpChips({ items }: { items: string[] }) {
  const { appendMessage } = useCopilotChat();
  const send = useCallback(
    (content: string) => { void appendMessage(new TextMessage({ role: Role.User, content })); },
    [appendMessage],
  );
  const chips = items.filter(Boolean);
  if (chips.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {chips.map((q) => (
        <button
          key={q}
          onClick={() => send(q)}
          className="group flex items-center justify-between gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-left text-[11px] text-foreground/90 transition-colors hover:border-primary/60 hover:bg-primary/10"
        >
          <span className="truncate">{q}</span>
          <ArrowRight className="w-3 h-3 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
    </div>
  );
}

// Side-effect-only: when a result card mounts, slide the matching deep-diagnosis
// drawer open on the dashboard — the chat literally changes the page UI. The ref
// guard keeps it to once per answer (renders re-run on every chat tick).
function DriveDrawer({ target, since }: { target: DrawerTarget; since?: string }) {
  const { openDiagnosis } = useNocUi();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openDiagnosis(target, since);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// A small "this action also opened the drawer" affordance + manual re-open.
function DrawerHint({ target, since, label }: { target: DrawerTarget; since?: string; label: string }) {
  const { openDiagnosis } = useNocUi();
  return (
    <button
      onClick={() => openDiagnosis(target, since)}
      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background/40 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
    >
      <Compass className="w-3 h-3 text-primary" /> {label}
    </button>
  );
}

// The headline result card: device health inline (mirrors the sample's product
// cards), proactively opens the deep-diagnosis drawer, and offers follow-ups.
function CriticalDeviceResult({ result }: { result: { health?: DeviceHealth; reason?: string; since?: string } }) {
  const health = result.health;
  if (!health) return <ErrorLine msg="No critical device found in this range." />;
  const relatedIncident = health.related_incidents?.find((i) => i.incident_id)?.incident_id;
  const chips = [
    relatedIncident ? `Diagnose incident ${relatedIncident}` : "",
    `Show the CPU utilization trend for ${health.device_id}`,
    "Which devices have the most open alarms right now?",
  ];
  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3">
      {/* Header strip — labelled tool call + DONE chip, like the sample UI. */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <HeartPulse className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide">Critical Device Health</span>
        </div>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">Done</span>
      </div>
      <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
        Most critical: <span className="font-mono text-foreground/90">{health.device_id}</span>
        {result.reason ? ` · ${result.reason}` : ""}. Opened the deep-diagnosis drawer →
      </p>

      {/* Side-effect: slide the device drawer open on the dashboard. */}
      <DriveDrawer target={{ kind: "device", id: health.device_id }} since={result.since} />

      <DeviceHealthCard health={health} />
      <DrawerHint target={{ kind: "device", id: health.device_id }} since={result.since} label="Re-open full diagnosis" />
      <FollowUpChips items={chips} />
    </div>
  );
}

function coerceRows(rows: unknown): Array<Record<string, unknown>> {
  let parsed: unknown[] = [];
  if (typeof rows === "string") { try { parsed = JSON.parse(rows); } catch { parsed = []; } }
  else if (Array.isArray(rows)) parsed = rows;
  return (Array.isArray(parsed) ? parsed : []).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries((row ?? {}) as Record<string, unknown>)) {
      out[k] = typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : v;
    }
    return out;
  });
}

function parsePalette(colors: unknown): string[] | undefined {
  let arr: unknown[] = [];
  if (typeof colors === "string" && colors.trim()) { try { arr = JSON.parse(colors); } catch { return undefined; } }
  else if (Array.isArray(colors)) arr = colors;
  const valid = arr.filter((c) => typeof c === "string" && /^(#|rgb|hsl)/i.test((c as string).trim())) as string[];
  return valid.length ? valid : undefined;
}

// The key visuals on each page, returned by `navigateTo` so the agent can answer
// "go to page X and explain visual Y" — it navigates, then knows what's there.
const PAGE_VISUALS: Record<string, string[]> = {
  dashboard: [
    "KPI strip (device availability, total/critical alarms, active incidents, security events, threats blocked, peak CPU, branches down)",
    "Device availability donut", "Top critical alarms table", "Incident summary donut",
    "Alarm volume over time", "Recent incidents", "Top CPU / WAN link / worst latency rankings",
    "Attack types blocked", "Threats by origin country", "Security posture", "Branch network map", "Branch health", "Device fabric", "Alarms by category",
  ],
  noc: [
    "NOC KPI strip (total/critical/warning/open/resolved alarms, network incidents, early warnings)",
    "Alarms by source / severity / status", "Noisiest devices", "Alarms by hardware model / site",
    "Fleet CPU & latency trends", "SolarWinds core-node telemetry", "Network incident queue", "Early warnings",
  ],
  soc: [
    "SOC KPI strip (SIEM critical/high, darknet IOCs, sentinel alerts, windows alerts, firewall denies, EDR events, threats blocked)",
    "Security posture & compliance (MTTD/MTTR, patch/AV/domain health)", "Per-source severity strip",
    "Event volume by source", "Threat trends", "Attacks blocked by type", "Top origin countries",
    "Security incidents", "FortiSIEM MITRE techniques + alert stream", "Sentinel tactics + cloud alerts",
    "Darknet threat actors / indicator types / IOC feed", "Windows endpoint events", "Firewall activity",
  ],
  assets: ["Searchable asset inventory table (type/name/IP/location/status/severity) with type & status filters"],
  topology: ["Interactive network topology graph (devices grouped by type, click a node for its asset details)"],
  traces: ["Live major-incident feed tabbed NOC/SOC", "Selected incident's waterfall trace + diagnosis card"],
  logs: ["Loki Explorer (label filters + line filter + paginated log table)"],
  pins: ["Pinned visuals dashboard (charts the agent pinned from chat)"],
};

// ── the hook ─────────────────────────────────────────────────────────────────

export function useNocCopilotActions() {
  const { addPin } = useLokiPins();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // ── headline AG-UI action: "check the health of the critical device" ─────────
  // Finds the single worst device (most/most-recent critical alarms, falling back
  // to highest peak CPU), renders its health card inline AND slides the device's
  // deep-diagnosis drawer open on the dashboard, then offers follow-up chips.
  useCopilotAction({
    name: "checkCriticalDeviceHealth",
    description:
      "Find the SINGLE most critical device right now (the device with the most / most-recent critical alarms; falls back to highest peak CPU) and return its full health snapshot. Use when the user asks to 'check the health of the critical device', 'what's the worst/most at-risk device', 'show me the device in trouble'. This ALSO opens that device's deep-diagnosis drawer in the dashboard UI — so just call it and add a one-line takeaway; don't pre-explain.",
    parameters: [{ name: "since", type: "string", description: "Lookback window, e.g. 24h. Default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      const s = since || "24h";
      try {
        let deviceId: string | undefined;
        let reason: string | undefined;
        // 1) Rank devices by their critical-alarm volume (most-recent breaks ties).
        const alarms = await callNoc<TopAlarms>("top_alarms", { severity: "critical", since: s, limit: 25 });
        const tally = new Map<string, { count: number; ts: number }>();
        for (const a of alarms.alarms ?? []) {
          if (!a.device_id) continue;
          const e = tally.get(a.device_id) ?? { count: 0, ts: 0 };
          e.count += 1;
          e.ts = Math.max(e.ts, a.ts || 0);
          tally.set(a.device_id, e);
        }
        const ranked = [...tally.entries()].sort((x, y) => y[1].count - x[1].count || y[1].ts - x[1].ts);
        if (ranked.length) {
          deviceId = ranked[0][0];
          const n = ranked[0][1].count;
          reason = `${n} critical alarm${n > 1 ? "s" : ""}`;
        }
        // 2) Fallback: no critical alarms in range → the highest peak-CPU device.
        if (!deviceId) {
          const top = await callNoc<TopDevicesByMetric>("top_devices_by_metric", { metric: "cpu_utilization_percent", agg: "max", since: s, limit: 1 });
          const d = top.devices?.[0];
          if (d) { deviceId = d.device_id; reason = `peak CPU ${d.value}%`; }
        }
        if (!deviceId) return { error: "No critical device found in this range." };
        const health = await callNoc<DeviceHealth>("device_health", { device_id: deviceId, since: s });
        return { health, reason, since: s };
      } catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<{ health?: DeviceHealth; reason?: string; since?: string; error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Locating the most critical device" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      return <CriticalDeviceResult result={p.result} />;
    },
  });

  // ── navigation: let the agent move the user between pages / deep-link traces ──
  useCopilotAction({
    name: "navigateTo",
    description:
      "Navigate the app to a page. page ∈ {dashboard, noc, soc, assets, topology, traces, logs, pins}. Optionally pass incident_id to deep-link the Traces view to one incident. Use when the user asks to 'open / go to / take me to' a page (e.g. 'open the SOC dashboard', 'open the NOC deep-dive'), or 'open the trace for INC-…'. The result lists the key VISUALS on the destination page — when the user asked to 'navigate to X and explain a visual', call this FIRST, then explain the requested visual (grounding with the matching NOC function) using that list.",
    parameters: [
      { name: "page", type: "string", description: "dashboard | noc | soc | assets | topology | traces | logs | pins", required: true },
      { name: "incident_id", type: "string", description: "Optional incident id to deep-link on the traces page.", required: false },
    ],
    handler: async ({ page, incident_id }: { page: string; incident_id?: string }) => {
      const routes: Record<string, string> = { dashboard: "/dashboard", noc: "/noc", soc: "/soc", assets: "/assets", topology: "/topology", traces: "/loki-traces", logs: "/loki-logs", pins: "/loki-pins" };
      const key = (page || "").toLowerCase();
      const base = routes[key] ?? "/dashboard";
      const path = base === "/loki-traces" && incident_id ? `${base}?incident=${encodeURIComponent(incident_id)}` : base;
      setLocation(path);
      return { navigated: path, page: key, visuals: PAGE_VISUALS[key] ?? [] };
    },
    render: (p: RenderProps<{ navigated?: string }>) => {
      if (p.status !== "complete") return <Loading label="Navigating" />;
      return (
        <div className="my-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Compass className="w-3 h-3 text-primary" /> Opened <span className="font-mono text-foreground/80">{p.result?.navigated ?? "page"}</span>
        </div>
      );
    },
  });

  useCopilotAction({
    name: "getDeviceInventory",
    description: "Count of monitored devices per category and the total fleet size. Use for device-availability / 'how many devices' questions.",
    parameters: [{ name: "since", type: "string", description: "Lookback window, e.g. 24h. Default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      try { return await callNoc<DeviceInventory>("device_inventory", { since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<DeviceInventory & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Counting devices" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = (p.result.categories ?? []).map((c) => ({ category: c.category, count: c.count }));
      return <CardShell icon={Boxes} title={`Device inventory · ${p.result.total} devices`}><LokiChart type="bar" xKey="category" yKey="count" data={rows} height={180} /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getAlarmsBySeverity",
    description: "Alarm counts grouped by severity (critical/high/warning/info). Optionally scope by category or device_id.",
    parameters: [
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
      { name: "category", type: "string", description: "Optional category filter.", required: false },
      { name: "device_id", type: "string", description: "Optional device filter.", required: false },
    ],
    handler: async (args: { since?: string; category?: string; device_id?: string }) => {
      try { return await callNoc<AlarmsBySeverity>("alarms_by_severity", { ...args, since: args.since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<AlarmsBySeverity & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Aggregating alarms" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = (p.result.severities ?? []).map((s) => ({ severity: s.severity, count: s.count }));
      return <CardShell icon={ShieldAlert} title={`Alarms by severity · ${fmtNum(p.result.total)} total`}><LokiChart type="bar" xKey="severity" yKey="count" data={rows} height={180} /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getTopAlarms",
    description: "Most recent alarms (default critical) as a structured table. Use for 'show critical alarms', 'latest alerts', etc.",
    parameters: [
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
      { name: "severity", type: "string", description: "Severity filter, default critical.", required: false },
      { name: "category", type: "string", description: "Optional category.", required: false },
      { name: "limit", type: "number", description: "Max rows, default 12.", required: false },
    ],
    handler: async (args: { since?: string; severity?: string; category?: string; limit?: number }) => {
      try { return await callNoc<TopAlarms>("top_alarms", { ...args, since: args.since || "24h", limit: args.limit || 12 }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<TopAlarms & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Fetching alarms" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      return <CardShell icon={AlertOctagon} title={`Top ${p.result.severity ?? "critical"} alarms`}><AlarmTable alarms={p.result.alarms ?? []} compact /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getIncidents",
    description: "AI-correlated incidents (the NOC incident queue) with severity tally. Use for incident-summary / recent-incidents.",
    parameters: [
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
      { name: "severity", type: "string", description: "Optional severity filter.", required: false },
      { name: "incident_type", type: "string", description: "Optional type: network/security.", required: false },
      { name: "limit", type: "number", description: "Max incidents, default 15.", required: false },
    ],
    handler: async (args: { since?: string; severity?: string; incident_type?: string; limit?: number }) => {
      try { return await callNoc<Incidents>("incidents", { ...args, since: args.since || "24h", limit: args.limit || 15 }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<Incidents & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Loading incidents" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      return (
        <CardShell icon={Activity} title={`Incidents · ${p.result.count}`}>
          <div className="space-y-1">
            {(p.result.incidents ?? []).slice(0, 8).map((inc, i) => (
              <div key={inc.incident_id ?? i} className="flex items-center gap-2 text-[11px]">
                <span className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(inc.severity)}`}>{inc.severity ?? "—"}</span>
                <span className="text-foreground/90 truncate flex-1">{inc.incident || inc.summary || inc.incident_id}</span>
              </div>
            ))}
          </div>
        </CardShell>
      );
    },
  });

  useCopilotAction({
    name: "diagnoseIncident",
    description: "FULL diagnosis for ONE incident_id: root-cause analysis, evidence, recommended actions, escalation team. Use to investigate/diagnose a specific incident (get the id from getIncidents first).",
    parameters: [{ name: "incident_id", type: "string", description: "The incident id, e.g. INC-eb820824b6.", required: true }],
    handler: async ({ incident_id }: { incident_id: string }) => {
      try { return await callNoc<IncidentDetail>("incident_detail", { incident_id }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<IncidentDetail & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Diagnosing incident" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const d = p.result;
      const asset = d.affected_assets?.[0];
      return (
        <div className="my-2 rounded-lg border border-border bg-card p-3">
          {d.incident_id && <DriveDrawer target={{ kind: "incident", id: d.incident_id }} />}
          <IncidentCard detail={d} />
          <FollowUpChips items={[
            asset ? `Check the health of ${asset}` : "",
            d.incident_id ? `Walk me through the trace for ${d.incident_id}` : "",
          ]} />
        </div>
      );
    },
  });

  useCopilotAction({
    name: "getDeviceHealth",
    description: "Health snapshot for one device: latest CPU/interface/latency, open-alarm count, recent alarms, related incidents. Use to investigate a specific device_id.",
    parameters: [
      { name: "device_id", type: "string", description: "The device id, e.g. SRV-DC1-MUM-07.", required: true },
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
    ],
    handler: async ({ device_id, since }: { device_id: string; since?: string }) => {
      try { return await callNoc<DeviceHealth>("device_health", { device_id, since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<DeviceHealth & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Checking device health" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const h = p.result;
      const relatedIncident = h.related_incidents?.find((i) => i.incident_id)?.incident_id;
      return (
        <div className="my-2 rounded-lg border border-border bg-card p-3">
          <DriveDrawer target={{ kind: "device", id: h.device_id }} />
          <DeviceHealthCard health={h} />
          <DrawerHint target={{ kind: "device", id: h.device_id }} label="Open full diagnosis" />
          <FollowUpChips items={[
            relatedIncident ? `Diagnose incident ${relatedIncident}` : "",
            `Show the CPU utilization trend for ${h.device_id}`,
          ]} />
        </div>
      );
    },
  });

  useCopilotAction({
    name: "getTopDevicesByMetric",
    description: "Top-N devices ranked by a performance metric. metric ∈ {cpu_utilization_percent, interface_utilization_percent, latency_ms}. Use for 'top CPU', 'highest link utilization', 'worst latency'.",
    parameters: [
      { name: "metric", type: "string", description: "cpu_utilization_percent | interface_utilization_percent | latency_ms", required: true },
      { name: "agg", type: "string", description: "avg|max|min, default avg.", required: false },
      { name: "limit", type: "number", description: "Top N, default 10.", required: false },
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
    ],
    handler: async (args: { metric: string; agg?: string; limit?: number; since?: string }) => {
      try { return await callNoc<TopDevicesByMetric>("top_devices_by_metric", { ...args, since: args.since || "24h", limit: args.limit || 10 }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<TopDevicesByMetric & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Ranking devices" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = (p.result.devices ?? []).map((d) => ({ device: d.device_id, value: d.value }));
      return <CardShell icon={Server} title={`Top devices · ${METRIC_LABELS[p.result.metric] ?? p.result.metric} (${p.result.agg})`}><LokiChart type="bar" xKey="device" yKey="value" data={rows} height={200} colors={["#22d3ee"]} /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getMetricTrend",
    description: "Time-series trend of a performance metric — for one device_id, or the fleet average if omitted. Use for plotting CPU/latency/utilization over time.",
    parameters: [
      { name: "metric", type: "string", description: "cpu_utilization_percent | interface_utilization_percent | latency_ms", required: true },
      { name: "device_id", type: "string", description: "Optional device; omit for fleet average.", required: false },
      { name: "agg", type: "string", description: "avg|max|min, default avg.", required: false },
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
    ],
    handler: async (args: { metric: string; device_id?: string; agg?: string; since?: string }) => {
      try { return await callNoc<MetricTrend>("metric_trend", { ...args, since: args.since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<MetricTrend & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Building trend" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const byTs = new Map<number, number>();
      for (const s of p.result.series ?? []) for (const v of s.values) byTs.set(v.ts, (byTs.get(v.ts) || 0) + v.value);
      const rows = [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([ts, value]) => ({ time: new Date(ts).toLocaleString(), value: Math.round(value * 100) / 100 }));
      return <CardShell icon={Activity} title={`${METRIC_LABELS[p.result.metric] ?? p.result.metric} trend${p.result.device_id ? ` · ${p.result.device_id}` : " · fleet avg"}`}><LokiChart type="line" xKey="time" yKey="value" data={rows} height={180} colors={["#22d3ee"]} /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getSecurityEvents",
    description: "SOC posture: security-category alarms total, blocked-threat count, the attack_type breakdown, and the top threat origin countries.",
    parameters: [{ name: "since", type: "string", description: "Lookback, default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      try { return await callNoc<SecurityEvents>("security_events", { since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<SecurityEvents & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Assessing security" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const r = p.result;
      return (
        <CardShell icon={ShieldAlert} title="Security posture">
          <div className="text-[11px] space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Security alarms</span><span className="font-semibold">{fmtNum(r.security_alarms_total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Threats blocked</span><span className="font-semibold text-rose-400">{fmtNum(r.threats_blocked)}</span></div>
            {(r.attack_types ?? []).slice(0, 7).map((a) => (
              <div key={a.attack_type} className="flex justify-between"><span className="text-foreground/80 capitalize">{a.attack_type.replace(/_/g, " ")}</span><span className="font-semibold text-rose-300">{fmtNum(a.count)}</span></div>
            ))}
            {(r.top_countries ?? []).length > 0 && (
              <div className="pt-1 mt-1 border-t border-border/60">
                <span className="text-muted-foreground">Top origins: </span>
                <span className="text-foreground/90">{(r.top_countries ?? []).slice(0, 5).map((c) => `${c.country} (${fmtNum(c.count)})`).join(", ")}</span>
              </div>
            )}
          </div>
        </CardShell>
      );
    },
  });

  useCopilotAction({
    name: "getAttackTypes",
    description: "Blocked SOC threats broken down by attack_type (bruteforce, ransomware, malware, phishing, port_scan, vpn_failure, firewall_block). Use for 'what attacks are we seeing'.",
    parameters: [{ name: "since", type: "string", description: "Lookback, default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      try { return await callNoc<AttackTypes>("attack_types", { since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<AttackTypes & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Tallying blocked attacks" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = (p.result.types ?? []).map((t) => ({ attack_type: t.attack_type, count: t.count }));
      return <CardShell icon={Crosshair} title={`Attacks blocked · ${fmtNum(p.result.total)} total`}><LokiChart type="bar" xKey="attack_type" yKey="count" data={rows} height={200} colors={["#f43f5e"]} /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getThreatsByCountry",
    description: "Blocked-threat volume by origin country code (RU/CN/IN/…). Use for 'where are attacks coming from'.",
    parameters: [{ name: "since", type: "string", description: "Lookback, default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      try { return await callNoc<ThreatsByCountry>("threats_by_country", { since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<ThreatsByCountry & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Mapping threat origins" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = (p.result.countries ?? []).map((c) => ({ country: c.country, count: c.count }));
      return <CardShell icon={Globe} title={`Threats by origin country · ${fmtNum(p.result.total)}`}><LokiChart type="bar" xKey="country" yKey="count" data={rows} height={200} colors={["#f59e0b"]} /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getBranchHealth",
    description: "Per-branch health: status (UP/DOWN) and critical/warning counts for each branch in the network. Use for branch availability questions.",
    parameters: [{ name: "since", type: "string", description: "Lookback, default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      try { return await callNoc<BranchHealth>("branch_health", { since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<BranchHealth & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Checking branch health" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      return (
        <CardShell icon={Building2} title={`Branch health · ${p.result.down}/${p.result.total} down`}>
          <div className="space-y-1">
            {(p.result.branches ?? []).slice(0, 10).map((b) => (
              <div key={b.code} className="flex items-center gap-2 text-[11px]">
                <span className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${b.status === "DOWN" ? "border-rose-500/40 text-rose-300 bg-rose-500/10" : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"}`}>{b.status || "—"}</span>
                <span className="text-foreground/90 truncate flex-1">{b.branch || b.code}</span>
                <span className="text-rose-300 tabular-nums">{fmtNum(b.critical)}</span>
                <span className="text-amber-300 tabular-nums">{fmtNum(b.warning)}</span>
              </div>
            ))}
          </div>
        </CardShell>
      );
    },
  });

  useCopilotAction({
    name: "getRecentTraces",
    description: "List recent MAJOR incidents (critical+high) available to trace, optionally filtered by incident_type (network/security). Use to find an incident to trace, then call getIncidentTrace with its id.",
    parameters: [
      { name: "since", type: "string", description: "Lookback, default 7d.", required: false },
      { name: "incident_type", type: "string", description: "Optional: network | security | unknown.", required: false },
    ],
    handler: async (args: { since?: string; incident_type?: string }) => {
      try { return await callNoc<RecentTraces>("recent_incident_traces", { ...args, since: args.since || "7d" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<RecentTraces & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Finding traceable incidents" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      return (
        <CardShell icon={Workflow} title={`Traceable incidents · ${p.result.count}`}>
          <div className="space-y-1">
            {(p.result.incidents ?? []).slice(0, 8).map((it, i) => (
              <div key={it.incident_id ?? i} className="flex items-center gap-2 text-[11px]">
                <span className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(it.severity)}`}>{it.severity ?? "—"}</span>
                <span className="text-foreground/90 truncate flex-1">{it.title}</span>
                <span className="font-mono text-[9px] text-muted-foreground shrink-0">{it.incident_id}</span>
              </div>
            ))}
          </div>
        </CardShell>
      );
    },
  });

  useCopilotAction({
    name: "getIncidentTrace",
    description: "Reconstruct ONE incident's WATERFALL trace: the affected device's correlated precursor events (timeline) leading to the AI diagnosis. Use to trace/investigate/'walk me through' how an incident unfolded.",
    parameters: [{ name: "incident_id", type: "string", description: "The incident id, e.g. INC-eb820824b6 (get it from getRecentTraces/getIncidents).", required: true }],
    handler: async ({ incident_id }: { incident_id: string }) => {
      try { return await callNoc<IncidentTrace>("incident_trace", { incident_id }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<IncidentTrace & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Reconstructing trace" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const t = p.result;
      return (
        <CardShell icon={Workflow} title={`Trace · ${t.device_id ?? t.incident_id}`}>
          <TraceWaterfall trace={t} compact />
          {t.root_cause && <p className="text-[11px] text-foreground/80 mt-2"><span className="font-semibold">Root cause:</span> {t.root_cause}</p>}
        </CardShell>
      );
    },
  });

  // ── NOC (Network Operations) deep-dive ────────────────────────────────────
  useCopilotAction({
    name: "getNocAlarmAnalytics",
    description:
      "NOC alarm analytics: monitoring-alarm volume broken down by source (solarwinds/manageengine), category, severity, hardware model, site, and open/resolved status. Use for 'break down the alarms', 'which models/sites alarm most', alarm posture. Suggest navigateTo(page=noc) for the full NOC deep-dive.",
    parameters: [{ name: "since", type: "string", description: "Lookback, default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      try { return await callNoc<NocAlarmAnalytics>("noc_alarm_analytics", { since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<NocAlarmAnalytics & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Analyzing alarms" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = (p.result.by_category ?? []).map((c) => ({ category: c.key, count: c.count }));
      return (
        <CardShell icon={Activity} title={`Alarm analytics · ${fmtNum(p.result.total)} alarms`}>
          <LokiChart type="bar" xKey="category" yKey="count" data={rows} height={180} />
          <div className="mt-2 text-[11px] text-muted-foreground">
            By source: {(p.result.by_source ?? []).map((s) => `${s.key} (${fmtNum(s.count)})`).join(", ") || "—"}
          </div>
        </CardShell>
      );
    },
  });

  useCopilotAction({
    name: "getTopAlarmingDevices",
    description: "The noisiest devices — those generating the most monitoring alarms over the window, ranked. Use for 'which devices alarm the most' / loudest devices.",
    parameters: [
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
      { name: "limit", type: "number", description: "Top N, default 12.", required: false },
    ],
    handler: async (args: { since?: string; limit?: number }) => {
      try { return await callNoc<TopAlarmingDevices>("top_alarming_devices", { since: args.since || "24h", limit: args.limit || 12 }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<TopAlarmingDevices & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Ranking noisiest devices" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = (p.result.devices ?? []).map((d) => ({ device: d.device, count: d.count }));
      return <CardShell icon={Server} title="Noisiest devices (most alarms)"><LokiChart type="bar" xKey="device" yKey="count" data={rows} height={200} colors={["#f43f5e"]} /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getNocNodePerformance",
    description: "SolarWinds core-node telemetry: average CPU%, memory%, bandwidth% and latency(ms) per monitored core node (Core-SW-01, DC-Router-03, FW-Edge-02, VPN-GW-01, WAN-LDN-01). Use for core network-node health.",
    parameters: [{ name: "since", type: "string", description: "Lookback, default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      try { return await callNoc<NocNodePerformance>("noc_node_performance", { since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<NocNodePerformance & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Reading core-node telemetry" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      return (
        <CardShell icon={ServerCog} title="Core-node telemetry">
          <div className="space-y-1 text-[11px]">
            {(p.result.nodes ?? []).map((n) => (
              <div key={n.node} className="flex items-center justify-between gap-2">
                <span className="font-mono text-foreground/90 truncate">{n.node}</span>
                <span className="text-muted-foreground tabular-nums shrink-0">CPU {n.cpu_pct ?? "—"}% · Mem {n.mem_pct ?? "—"}% · BW {n.bandwidth_pct ?? "—"}% · {n.latency_ms ?? "—"}ms</span>
              </div>
            ))}
            {(p.result.nodes ?? []).length === 0 && <p className="text-muted-foreground">No core-node telemetry in range.</p>}
          </div>
        </CardShell>
      );
    },
  });

  // ── SOC (Security Operations) ─────────────────────────────────────────────
  useCopilotAction({
    name: "getSocSummary",
    description:
      "Security Operations (SOC) overview: per-source event volume + severity breakdown for the security feeds (FortiSIEM, Sentinel, darknet, Windows, firewall, EDR) and headline KPIs (SIEM critical+high, darknet IOCs, sentinel alerts, windows alerts, firewall denies, threats blocked). Use for 'security operations summary' / 'how's the SOC looking'. This is the dedicated SOC dashboard's data — suggest opening /soc (navigateTo page=soc) for the full view.",
    parameters: [{ name: "since", type: "string", description: "Lookback, default 24h.", required: false }],
    handler: async ({ since }: { since?: string }) => {
      try { return await callNoc<SocSummary>("soc_summary", { since: since || "24h" }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<SocSummary & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Assessing the SOC" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const r = p.result;
      const rows = (r.sources ?? []).map((s) => ({ source: s.source, count: s.total }));
      return (
        <CardShell icon={ShieldAlert} title={`SOC overview · ${fmtNum(r.total)} events`}>
          <LokiChart type="bar" xKey="source" yKey="count" data={rows} height={180} colors={["#f43f5e"]} />
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <div className="flex justify-between"><span className="text-muted-foreground">SIEM crit/high</span><span className="font-semibold text-rose-300">{fmtNum(r.kpis.siem_critical_high)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Darknet IOCs</span><span className="font-semibold text-amber-300">{fmtNum(r.kpis.darknet_iocs)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Sentinel</span><span className="font-semibold">{fmtNum(r.kpis.sentinel_alerts)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Firewall denies</span><span className="font-semibold text-rose-300">{fmtNum(r.kpis.firewall_denies)}</span></div>
          </div>
        </CardShell>
      );
    },
  });

  useCopilotAction({
    name: "getSocTopFields",
    description:
      "Top values of a security field for one SOC source: fortisiem→mitre_technique/category/rule_name, sentinel→tactics/country/workspace, darknet→threat_actor/indicator_type/platform, windows→event_id/process, firewall→action/protocol/dst_port. Use for 'top MITRE techniques', 'which event IDs are firing', 'attacker tactics', 'top blocked ports'.",
    parameters: [
      { name: "source", type: "string", description: "fortisiem | sentinel | darknet | windows | firewall | edr", required: true },
      { name: "field", type: "string", description: "Field to break down (must be valid for the source).", required: true },
      { name: "limit", type: "number", description: "Top N, default 10.", required: false },
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
    ],
    handler: async (args: { source: string; field: string; limit?: number; since?: string }) => {
      try { return await callNoc<SocTopFields>("soc_top_fields", { ...args, since: args.since || "24h", limit: args.limit || 10 }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<SocTopFields & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Breaking down security events" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = (p.result.items ?? []).map((i) => ({ value: i.value, count: i.count }));
      return <CardShell icon={Crosshair} title={`${p.result.source} · top ${p.result.field}`}><LokiChart type="bar" xKey="value" yKey="count" data={rows} height={200} colors={["#a78bfa"]} /></CardShell>;
    },
  });

  useCopilotAction({
    name: "getSocRecentEvents",
    description:
      "Recent parsed security log events across all SOC sources or one source, with the key fields surfaced (mitre_technique, tactics, threat_actor, ioc_value, event_id, process, action, src/dst ip, country). Use for 'show recent security events', 'latest FortiSIEM alerts', 'recent darknet IOCs'.",
    parameters: [
      { name: "source", type: "string", description: "Optional SOC source: fortisiem|sentinel|darknet|windows|firewall|edr.", required: false },
      { name: "severity", type: "string", description: "Optional severity filter.", required: false },
      { name: "line_filter", type: "string", description: "Optional substring the line must contain.", required: false },
      { name: "limit", type: "number", description: "Max rows, default 20.", required: false },
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
    ],
    handler: async (args: { source?: string; severity?: string; line_filter?: string; limit?: number; since?: string }) => {
      try { return await callNoc<SocRecentEvents>("soc_recent_events", { ...args, since: args.since || "24h", limit: args.limit || 20 }); }
      catch (e) { return { error: e instanceof Error ? e.message : "failed" }; }
    },
    render: (p: RenderProps<SocRecentEvents & { error?: string }>) => {
      if (p.status !== "complete" || !p.result) return <Loading label="Fetching security events" />;
      if (p.result.error) return <ErrorLine msg={p.result.error} />;
      const rows = p.result.rows ?? [];
      return (
        <CardShell icon={ShieldAlert} title={`Recent security events · ${rows.length}${p.result.source ? ` · ${p.result.source}` : ""}`}>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {rows.length === 0 && <p className="text-[11px] text-muted-foreground">None in range.</p>}
            {rows.slice(0, 20).map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(r.severity)}`}>{r.severity || "—"}</span>
                {r.source && <span className="font-mono text-[9px] text-muted-foreground shrink-0">{r.source}</span>}
                <span className="text-foreground/90 truncate flex-1">{r.message}</span>
              </div>
            ))}
          </div>
        </CardShell>
      );
    },
  });

  // ── render the visual the user clicked "Explain" on, from on-screen data ──────
  // Draws the EXACT chart the user is looking at inline in the chat — no Loki
  // fetch, no pin. The agent passes the chart spec straight from the "visual the
  // user most recently clicked" context, then writes the structured explanation.
  useCopilotAction({
    name: "renderClickedVisual",
    description:
      "Redraw INLINE the visual the user just clicked 'Explain' on, from its on-screen values — NO data fetch, NO pin. " +
      "Call this FIRST on a clicked-visual turn WHEN the 'visual the user most recently clicked' context includes a " +
      "chart spec: pass that chart's title (use the context's visual name), type, xKey, yKey and data (the chart.data " +
      "array as a JSON string, VERBATIM — copy the numbers exactly). Then write the structured explanation. If the " +
      "context has no chart (e.g. a single KPI value), skip this and just explain.",
    parameters: [
      { name: "title", type: "string", description: "The visual's name (from context.visual).", required: true },
      { name: "type", type: "string", description: "bar | line | area | pie (from context.chart.type).", required: true },
      { name: "xKey", type: "string", description: "Category/x-axis key (context.chart.xKey).", required: true },
      { name: "yKey", type: "string", description: "Numeric/y-axis key (context.chart.yKey).", required: true },
      { name: "data", type: "string", description: "context.chart.data as a JSON array string, verbatim.", required: true },
      { name: "colors", type: "string", description: "Optional JSON array string of hex colors.", required: false },
    ],
    handler: async () => ({ ok: true }), // pure UI — the render below draws it
    render: (p: { args?: { title?: string; type?: string; xKey?: string; yKey?: string; data?: unknown; colors?: unknown } }) => {
      const a = p.args ?? {};
      const rows = coerceRows(a.data);
      if (rows.length === 0) return <Loading label="Rendering the visual" />;
      return (
        <div className="my-2 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-semibold">{a.title || "Visual"}</span><span className="ml-auto rounded-full border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[9px] font-medium text-primary/90">on screen</span></div>
          <LokiChart type={a.type || "bar"} xKey={a.xKey || "name"} yKey={a.yKey || "value"} data={rows} colors={parsePalette(a.colors)} height={200} />
        </div>
      );
    },
  });

  // ── generic fallback: raw LogQL for novel questions the functions don't cover ──
  useCopilotAction({
    name: "queryLoki",
    description: "FALLBACK ONLY. Run a raw LogQL query when none of the named NOC functions fit. Prefer the named functions. kind='logs' for lines, 'metric' for aggregations (count_over_time/sum by).",
    parameters: [
      { name: "logql", type: "string", description: "A valid LogQL query.", required: true },
      { name: "kind", type: "string", description: "'logs' or 'metric'. Default 'logs'.", required: false },
      { name: "since", type: "string", description: "Lookback, default 24h.", required: false },
    ],
    handler: async ({ logql, kind, since }: { logql: string; kind?: string; since?: string }) => {
      try {
        const result = await postLokiQuery({ logql, kind: kind || "logs", since: since || "24h", limit: 200 });
        if (result.kind === "logs") {
          const rows = (result.rows ?? []).slice(0, 40);
          return { kind: "logs", rowCount: result.rowCount ?? rows.length, sample: rows, logql };
        }
        const series = (result.series ?? []).map((s) => ({ name: s.name, total: s.values.reduce((a, v) => a + (v.value || 0), 0) }));
        return { kind: "metric", series, logql };
      } catch (e) { return { error: e instanceof Error ? e.message : "Loki query failed", logql }; }
    },
  });

  // ── pin a chart into the chat + Pinned Visuals dashboard ──────────────────────
  useCopilotAction({
    name: "pinLokiVisual",
    description: "Render a chart INLINE in the chat and pin it to the Pinned Visuals dashboard. Pass logql/kind/since + transform so the pin can be Refreshed later. Numbers must be raw (no commas/units).",
    parameters: [
      { name: "title", type: "string", description: "Chart title.", required: true },
      { name: "type", type: "string", description: "bar | line | area | pie.", required: true },
      { name: "xKey", type: "string", description: "Key for the category/x-axis.", required: true },
      { name: "yKey", type: "string", description: "Key for the numeric value/y-axis.", required: true },
      { name: "data", type: "string", description: "JSON array STRING of row objects.", required: true },
      { name: "transform", type: "string", description: "'byLabel', 'overTime', or 'none'.", required: false },
      { name: "logql", type: "string", description: "The LogQL used (enables Refresh).", required: false },
      { name: "kind", type: "string", description: "'metric' or 'logs'.", required: false },
      { name: "since", type: "string", description: "The lookback used.", required: false },
      { name: "summary", type: "string", description: "One-sentence takeaway.", required: false },
      { name: "colors", type: "string", description: "Optional JSON array STRING of hex colors.", required: false },
    ],
    handler: async ({ title, type, xKey, yKey, data, transform, logql, kind, since, summary, colors }: {
      title: string; type: string; xKey: string; yKey: string; data: unknown; transform?: string; logql?: string; kind?: string; since?: string; summary?: string; colors?: unknown;
    }) => {
      const tf = (["byLabel", "overTime", "none"].includes(transform || "") ? transform : "none") as LokiTransform;
      let rows = coerceRows(data);
      if (logql && tf !== "none") {
        try {
          const result = await postLokiQuery({ logql, kind: kind || "metric", since: since || "24h", limit: 1000 });
          const built = buildChartRows(result, { transform: tf, xKey, yKey });
          if (built.length) rows = built;
        } catch { /* fall back to provided data */ }
      }
      if (rows.length === 0) return "No data rows provided — re-run the query and pass rows as a JSON array string in `data`.";
      const pin = await addPin({ title, type, xKey, yKey, data: rows, colors: parsePalette(colors), summary, logql, kind, since, transform: tf });
      if (!pin) return "Pinned chart could not be saved (is the Loki metadata database available?).";
      toast({ title: "Pinned visual", description: `"${title}" added to Pinned Visuals.` });
      return `Rendered "${title}" and pinned it (${rows.length} points)${tf !== "none" ? ", refreshable" : ""}.`;
    },
    render: (p: { args?: { title?: string; type?: string; xKey?: string; yKey?: string; data?: unknown; summary?: string; colors?: unknown } }) => {
      const args = p.args ?? {};
      const rows = coerceRows(args.data);
      return (
        <div className="my-2 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-1.5"><Sparkles className="w-3.5 h-3.5 text-primary" /><span className="text-xs font-semibold">{args.title || "Loki visual"}</span></div>
          <LokiChart type={args.type || "bar"} xKey={args.xKey || "name"} yKey={args.yKey || "value"} data={rows} colors={parsePalette(args.colors)} height={200} />
          {args.summary && <p className="text-[11px] text-muted-foreground mt-1.5">{args.summary}</p>}
        </div>
      );
    },
  });
}
