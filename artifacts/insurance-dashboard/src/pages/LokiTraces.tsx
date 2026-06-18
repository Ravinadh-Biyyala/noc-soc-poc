// Traces — the NOC/SOC investigation view. A live feed of major incidents
// (critical+high), tabbed by incident_type (NOC = network, SOC = security). Click an
// incident → its reconstructed WATERFALL trace (the affected device's correlated
// precursor events → AI diagnosis) plus root cause + recommendation. Polls Loki so
// new major incidents surface in real time.

import { useState, useMemo, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Workflow, Radio, RefreshCw, AlertCircle, Server, ExternalLink, ScanSearch } from "lucide-react";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useNocUi } from "@/lib/ui-bridge";
import { callNoc, type RecentTraces, type IncidentTrace, type IncidentDetail } from "@/lib/loki-noc";
import { severityBadge, fmtAgo, fmtTime } from "@/lib/noc-format";
import TraceWaterfall from "@/components/loki/TraceWaterfall";
import IncidentCard from "@/components/loki/IncidentCard";

const LIVE_OPTIONS = [
  { value: "0", label: "Live: Off" },
  { value: "10000", label: "Live: 10s" },
  { value: "30000", label: "Live: 30s" },
];

type TabKey = "all" | "network" | "security" | "other";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "network", label: "Network" },
  { key: "security", label: "Security" },
  { key: "other", label: "Other" },
];

function tabOf(type?: string): Exclude<TabKey, "all"> {
  const t = (type || "").toLowerCase();
  return t === "network" || t === "security" ? t : "other";
}

export default function LokiTraces() {
  const [, setLocation] = useLocation();
  const { askCompanion } = useNocUi();
  const [tab, setTab] = useState<TabKey>("all");
  const [live, setLive] = useState("30000");
  const [selected, setSelected] = useState<string | null>(null);

  // Selecting an incident from the list (a user click — NOT the auto-select on
  // load) asks the BI Companion to trace it, so the chat responds in real time
  // alongside the on-page waterfall (AG-UI: UI → chat).
  const selectAndAsk = (it: { incident_id: string; title?: string }) => {
    setSelected(it.incident_id);
    askCompanion(
      `Walk me through the trace for incident ${it.incident_id}${it.title ? ` ("${it.title}")` : ""} — the precursor events, root cause and recommendation.`,
    );
  };

  // Deep-link: /loki-traces?incident=INC-xxx preselects that incident.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("incident");
    if (id) setSelected(id);
  }, []);

  const listQuery = useQuery({
    queryKey: ["noc-traces-list"],
    queryFn: () => callNoc<RecentTraces>("recent_incident_traces", { since: "7d", limit: 40 }),
    refetchInterval: live === "0" ? false : Number(live),
    placeholderData: keepPreviousData,
  });

  const incidents = listQuery.data?.incidents ?? [];
  const counts = useMemo(() => {
    const c = { all: incidents.length, network: 0, security: 0, other: 0 };
    for (const it of incidents) c[tabOf(it.type)]++;
    return c;
  }, [incidents]);

  const filtered = useMemo(
    () => (tab === "all" ? incidents : incidents.filter((it) => tabOf(it.type) === tab)),
    [incidents, tab],
  );

  // Auto-select the newest in view once data arrives.
  useEffect(() => {
    if (!selected && filtered.length) setSelected(filtered[0].incident_id);
  }, [filtered, selected]);

  const traceQuery = useQuery({
    queryKey: ["noc-trace", selected],
    queryFn: () => callNoc<IncidentTrace>("incident_trace", { incident_id: selected }),
    enabled: !!selected,
    placeholderData: keepPreviousData,
  });
  const trace = traceQuery.data;

  useRegisterObservation(
    useMemo(() => ({
      label: "Incident Traces",
      kind: "other" as const,
      summary:
        `User is on the Traces (investigation) view — a live feed of ${incidents.length} major incidents, tab "${tab}". ` +
        (selected ? `Inspecting trace ${selected}. ` : "") +
        "Each trace is a waterfall of the affected device's correlated events → AI root cause. " +
        "Use getRecentTraces / getIncidentTrace to answer; render the waterfall card.",
      suggestions: [
        "Trace the latest critical incident",
        "Which devices have the most network incidents?",
        "Summarise the security incidents and their root causes",
        "Walk me through the events that led to the top incident",
      ],
    }), [incidents.length, tab, selected]),
  );

  // Build an IncidentDetail-shaped object so we can reuse IncidentCard for the
  // root-cause / recommendation / evidence block beneath the waterfall.
  const detailForCard: IncidentDetail | null = trace ? {
    incident_id: trace.incident_id, incident: trace.incident, summary: trace.summary,
    severity: trace.severity, type: trace.type,
    affected_assets: trace.device_id ? [trace.device_id] : [],
    root_cause: trace.root_cause, rca_summary: trace.rca_summary, confidence: trace.confidence,
    evidence: trace.evidence, recommendation: trace.recommendation, escalation_team: trace.escalation_team,
    early_warning: null,
  } : null;

  return (
    <div className="space-y-3">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Workflow className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-bold text-foreground">Incident Traces</h1>
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <Radio className={`w-3 h-3 ${live !== "0" ? "animate-pulse" : ""}`} /> {live !== "0" ? "live" : "static"}
          </span>
          {listQuery.isFetching && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
        </div>
        <Select value={live} onValueChange={setLive}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{LIVE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <div className="inline-flex items-center gap-1 rounded-lg bg-muted/40 p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tab === t.key ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label} <span className="ml-1 text-[10px] opacity-70">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {listQuery.error ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <AlertCircle className="w-6 h-6 text-rose-500" /><p className="text-sm">{(listQuery.error as Error).message}</p>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          {/* Master: incident list */}
          <Card className="lg:col-span-1">
            <CardContent className="p-2">
              {listQuery.isLoading ? (
                <div className="space-y-2 p-1">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No {tab === "all" ? "" : tab} incidents to trace in this range.</p>
              ) : (
                <div className="space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {filtered.map((it) => (
                    <button key={it.incident_id} onClick={() => selectAndAsk(it)}
                      className={`w-full text-left rounded-md border px-2.5 py-2 transition-colors ${selected === it.incident_id ? "border-primary/60 bg-primary/5" : "border-border/60 bg-background/40 hover:bg-accent/30"}`}>
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(it.severity)}`}>{it.severity ?? "—"}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{it.type}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{fmtAgo(it.ts)}</span>
                      </div>
                      <p className="text-[11px] text-foreground/90 mt-1 leading-snug line-clamp-2">{it.title}</p>
                      {it.device_id && <p className="text-[10px] font-mono text-cyan-300/80 mt-0.5 flex items-center gap-1"><Server className="w-2.5 h-2.5" />{it.device_id}</p>}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Detail: waterfall + diagnosis */}
          <Card className="lg:col-span-2">
            <CardContent className="p-3">
              {!selected ? (
                <p className="text-sm text-muted-foreground text-center py-16">Select an incident to view its trace.</p>
              ) : traceQuery.isLoading && !trace ? (
                <Skeleton className="h-[460px]" />
              ) : traceQuery.error ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground"><AlertCircle className="w-5 h-5 text-rose-500" /><p className="text-xs">{(traceQuery.error as Error).message}</p></div>
              ) : trace ? (
                <div className="space-y-3">
                  {/* Header strip */}
                  <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-border/60">
                    <ScanSearch className="w-4 h-4 text-cyan-300" />
                    <span className="text-sm font-semibold text-foreground">Trace</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{trace.incident_id}</span>
                    {trace.device_id && <span className="text-[11px] font-mono text-cyan-300">{trace.device_id}</span>}
                    {trace.detected_at && <span className="ml-auto text-[10px] text-muted-foreground">detected {fmtTime(trace.detected_at)}</span>}
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => setLocation("/loki-logs")}>
                      <ExternalLink className="w-3 h-3" /> Explorer
                    </Button>
                  </div>
                  <TraceWaterfall trace={trace} />
                  {detailForCard && (
                    <div className="pt-2 border-t border-border/60">
                      <IncidentCard detail={detailForCard} />
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
