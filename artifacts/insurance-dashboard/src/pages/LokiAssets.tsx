// Asset Inventory — a Grafana-style device list over the Loki fleet. Mirrors the
// reference AiOps "Assets" screen: searchable, with type + status filter chips and
// a TYPE/NAME/IP/LOCATION/STATUS/SEVERITY table. Data comes from the canonical
// asset_inventory NOC function (same source the Device Availability KPI uses).

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Server, Router as RouterIcon, Network, HardDrive, Cpu, Monitor, Box,
  RefreshCw, Search, AlertCircle, type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useNocUi } from "@/lib/ui-bridge";
import { fetchAllDevices, type AssetRow } from "@/lib/loki-noc";
import { severityBadge } from "@/lib/noc-format";
import ExplainButton from "@/components/loki/ExplainButton";

// type → icon + tint for the leading TYPE cell.
const TYPE_META: Record<string, { icon: LucideIcon; tint: string }> = {
  atm: { icon: Box, tint: "text-violet-300 bg-violet-500/15" },
  router: { icon: RouterIcon, tint: "text-cyan-300 bg-cyan-500/15" },
  switch: { icon: Network, tint: "text-sky-300 bg-sky-500/15" },
  server: { icon: Server, tint: "text-emerald-300 bg-emerald-500/15" },
  network: { icon: Network, tint: "text-indigo-300 bg-indigo-500/15" },
  vm: { icon: Cpu, tint: "text-fuchsia-300 bg-fuchsia-500/15" },
  host: { icon: Monitor, tint: "text-amber-300 bg-amber-500/15" },
  storage: { icon: HardDrive, tint: "text-teal-300 bg-teal-500/15" },
};
function typeMeta(t: string) {
  return TYPE_META[t] ?? { icon: Box, tint: "text-slate-300 bg-slate-500/15" };
}

const STATUS_DOT: Record<string, string> = { up: "bg-emerald-400", degraded: "bg-amber-400", down: "bg-rose-500" };
const STATUS_TEXT: Record<string, string> = { up: "text-emerald-300", degraded: "text-amber-300", down: "text-rose-300" };
const STATUS_LABEL: Record<string, string> = { up: "up", degraded: "degraded", down: "down" };

// status-filter chip → predicate over the asset status.
const STATUS_FILTERS: Array<{ key: string; label: string; match: (s: string) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "online", label: "Online", match: (s) => s === "up" },
  { key: "offline", label: "Offline", match: (s) => s === "down" },
  { key: "degraded", label: "Degraded", match: (s) => s === "degraded" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
        active ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-primary/40"
      }`}
    >
      {children}
    </button>
  );
}

export default function LokiAssets() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const { askCompanion } = useNocUi();

  // Full fleet straight from the Loki server (device_id label lookup — no LogQL
  // query). Loaded once and cached: these tabs don't auto-refresh on revisit.
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["loki-all-devices"],
    queryFn: () => fetchAllDevices(),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useRegisterObservation(
    useMemo(() => ({
      label: "Asset Inventory",
      kind: "other" as const,
      summary:
        `User is on the Asset Inventory page — ${data?.total ?? "all"} monitored devices ` +
        `(${data?.online ?? 0} online, ${data?.degraded ?? 0} degraded, ${data?.offline ?? 0} offline; ` +
        `availability ${data?.availability_pct ?? 0}%). Use asset_inventory / getDeviceHealth to answer.`,
      suggestions: [
        "Which devices are offline or degraded?",
        "Check the health of the busiest device",
        "How many devices per type?",
      ],
    }), [data?.total, data?.online, data?.degraded, data?.offline, data?.availability_pct]),
  );

  const assets = data?.assets ?? [];
  const typeChips = useMemo(() => ["all", ...(data?.by_type ?? []).map((t) => t.type)], [data?.by_type]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const statusMatch = STATUS_FILTERS.find((f) => f.key === statusFilter)?.match ?? (() => true);
    return assets.filter((a) => {
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      if (!statusMatch(a.status)) return false;
      if (q && !(`${a.name} ${a.location ?? ""} ${a.model ?? ""} ${a.ip ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [assets, search, typeFilter, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" /> Asset Inventory
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data?.total ?? 0} assets across all branches and data centers
            {data ? ` · ${data.availability_pct}% available` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExplainButton title="Asset inventory" hint="Use asset_inventory to summarise the fleet — counts by type and status, availability, and any offline/degraded devices." label="Explain inventory" />
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs text-foreground hover:border-primary/50 hover:text-primary transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, location or model…"
            className="w-full rounded-md border border-border bg-background/40 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {typeChips.map((t) => <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{t === "all" ? "All" : t}</Chip>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => <Chip key={f.key} active={statusFilter === f.key} onClick={() => setStatusFilter(f.key)}>{f.label}</Chip>)}
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">{filtered.length} results</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[64px_1fr_120px_140px_120px_110px] gap-2 px-4 py-2.5 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Type</span><span>Name</span><span>IP</span><span>Location</span><span>Status</span><span>Severity</span>
        </div>

        {error ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <AlertCircle className="w-6 h-6 text-rose-500" /><p className="text-sm">{(error as Error).message}</p>
            <p className="text-xs">Is the Python Loki service running and reachable?</p>
          </div>
        ) : isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No assets match these filters.</p>
        ) : (
          <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
            {filtered.map((a) => (
              <AssetRowView key={a.name} a={a}
                onClick={() => askCompanion(`Check the health of device ${a.name} and summarise its status, open alarms and any related incidents.`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetRowView({ a, onClick }: { a: AssetRow; onClick?: () => void }) {
  const meta = typeMeta(a.type);
  const Icon = meta.icon;
  return (
    <div
      onClick={onClick}
      title={onClick ? `Ask the BI Companion about ${a.name}` : undefined}
      className={`grid grid-cols-[64px_1fr_120px_140px_120px_110px] gap-2 items-center px-4 py-2.5 border-b border-border/50 hover:bg-accent/30 transition-colors ${onClick ? "cursor-pointer" : ""}`}>
      <div className={`w-7 h-7 rounded-md flex items-center justify-center ${meta.tint}`} title={a.type}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground font-mono truncate">{a.name}</div>
        {a.model && <div className="text-[10px] text-muted-foreground truncate">{a.model}</div>}
      </div>
      <span className="text-[11px] font-mono text-muted-foreground">{a.ip ?? "—"}</span>
      <span className="text-[11px] text-foreground/80 truncate">{a.location ?? "—"}</span>
      <span className={`flex items-center gap-1.5 text-[11px] ${STATUS_TEXT[a.status] ?? "text-muted-foreground"}`}>
        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[a.status] ?? "bg-slate-500"}`} />
        {STATUS_LABEL[a.status] ?? a.status}
      </span>
      <span>
        {a.severity
          ? <span className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(a.severity)}`}>{a.severity}</span>
          : <span className="text-[11px] text-muted-foreground">—</span>}
      </span>
    </div>
  );
}
