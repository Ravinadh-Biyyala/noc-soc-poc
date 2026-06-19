// Network Topology — an interactive map of the monitored fleet, grouped into device
// clusters. Inventory comes from the canonical `asset_inventory` NOC function (same
// source as the Assets page); the layout is deterministic/static (lib/topology.ts) so
// node positions never shuffle. Click any node to open its Asset Details side panel.

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Workflow, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle, XCircle, X,
  Network, Router as RouterIcon, Server, Cpu, HardDrive, Box, Monitor, ShieldAlert, Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useNocUi } from "@/lib/ui-bridge";
import { fetchAllDevices } from "@/lib/loki-noc";
import { typeColor, typeLabel, type TopoAsset } from "@/lib/topology";
import { severityBadge } from "@/lib/noc-format";
import TopologyGraph from "@/components/loki/TopologyGraph";
import ExplainButton from "@/components/loki/ExplainButton";

const TYPE_ICON: Record<string, LucideIcon> = {
  switch: Network, router: RouterIcon, network: ShieldAlert, server: Server,
  vm: Cpu, storage: HardDrive, atm: Box, host: Monitor,
};

const STATUS_META: Record<string, { label: string; tint: string; Icon: LucideIcon }> = {
  up: { label: "Online & Healthy", tint: "text-emerald-400", Icon: CheckCircle2 },
  degraded: { label: "Degraded", tint: "text-amber-400", Icon: AlertTriangle },
  down: { label: "Offline", tint: "text-rose-400", Icon: XCircle },
};

export default function LokiTopology() {
  const [selected, setSelected] = useState<TopoAsset | null>(null);
  const { askCompanion } = useNocUi();

  // Full fleet straight from the Loki server (shares the Assets page cache);
  // loaded once and not auto-refreshed on revisit.
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["loki-all-devices"], // shares the Assets page cache
    queryFn: () => fetchAllDevices(),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useRegisterObservation(
    useMemo(() => ({
      label: "Network Topology",
      kind: "other" as const,
      summary:
        `User is on the Network Topology map — ${data?.total ?? "all"} monitored devices ` +
        `grouped by type (${(data?.by_type ?? []).map((t) => `${t.count} ${t.type}`).join(", ") || "loading"}). ` +
        `${data?.offline ?? 0} offline, ${data?.degraded ?? 0} degraded. ` +
        (selected ? `Currently inspecting ${selected.name} (${selected.status}). ` : "") +
        `Use asset_inventory / getDeviceHealth to answer.`,
      suggestions: [
        "Which devices are offline?",
        selected ? `Check the health of ${selected.name}` : "Check the health of the busiest device",
        "How many devices per type?",
      ],
    }), [data?.total, data?.by_type, data?.offline, data?.degraded, selected]),
  );

  const assets = data?.assets ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Workflow className="w-5 h-5 text-cyan-400" /> Network Topology
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data?.total ?? 0} devices across the fleet · click a node for details
            {data ? ` · ${data.online} online · ${data.degraded} degraded · ${data.offline} offline` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExplainButton title="Network topology" hint="Use asset_inventory to summarise the fabric — device counts per type and any offline/degraded nodes." label="Explain topology" />
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs text-foreground hover:border-primary/50 hover:text-primary transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Canvas + detail panel */}
      <div className="flex gap-4 items-stretch">
        <div className="flex-1 min-w-0 h-[calc(100vh-200px)]">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-2 h-full rounded-lg border border-border bg-card text-muted-foreground">
              <AlertCircle className="w-6 h-6 text-rose-500" />
              <p className="text-sm">{(error as Error).message}</p>
              <p className="text-xs">Is the Python Loki service running and reachable?</p>
            </div>
          ) : isLoading ? (
            <Skeleton className="h-full w-full rounded-lg" />
          ) : (
            <TopologyGraph
              assets={assets}
              selectedId={selected?.name ?? null}
              onSelect={setSelected}
            />
          )}
        </div>

        {selected && (
          <AssetDetailPanel
            asset={selected}
            onClose={() => setSelected(null)}
            onAsk={() => askCompanion(`Check the health of device ${selected.name} and summarise its status, open alarms and any related incidents.`)}
          />
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function AssetDetailPanel({ asset, onClose, onAsk }: { asset: TopoAsset; onClose: () => void; onAsk?: () => void }) {
  const Icon = TYPE_ICON[asset.type] ?? Box;
  const color = typeColor(asset.type);
  const status = STATUS_META[asset.status] ?? STATUS_META.up;

  return (
    <aside className="w-[320px] flex-shrink-0 rounded-lg border border-border bg-card flex flex-col">
      <div className="flex items-center justify-between px-4 h-12 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Asset Details</h2>
        <button
          onClick={onClose}
          aria-label="Close asset details"
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Identity */}
        <div className="flex flex-col items-center text-center gap-2 pt-2">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: color, boxShadow: `0 0 24px ${color}66` }}
          >
            <Icon className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
          <div className="text-lg font-bold text-foreground">{asset.friendly}</div>
          <span className="rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/80">
            {typeLabel(asset.type).replace(/s$/, "")}
          </span>
        </div>

        {/* Status */}
        <DetailRow
          label="Status"
          value={
            <span className={`flex items-center gap-1.5 font-medium ${status.tint}`}>
              <status.Icon className="w-4 h-4" /> {status.label}
            </span>
          }
        />

        <DetailRow label="IP Address" value={asset.ip} mono />
        <DetailRow label="System ID" value={asset.systemId} mono />
        {asset.location && <DetailRow label="Location" value={asset.location} mono />}
        {asset.category && <DetailRow label="Category" value={asset.category} />}
        {asset.model && <DetailRow label="Model" value={asset.model} />}

        <DetailRow
          label="Severity"
          value={
            asset.severity ? (
              <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(asset.severity)}`}>
                {asset.severity}
              </span>
            ) : "—"
          }
        />
        <DetailRow label="Open Alarms (24h)" value={asset.alarms.toLocaleString()} />

        {onAsk && (
          <button
            onClick={onAsk}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask the BI Companion about this device
          </button>
        )}
      </div>
    </aside>
  );
}
