// The interactive Network Topology canvas. Renders the fleet as type clusters of
// device nodes (positions are precomputed + deterministic — see lib/topology.ts), so
// the map is static but every node is clickable to open its Asset Details. Pure HTML
// + CSS (absolutely-positioned nodes), no SVG/graph deps — always renders offline.

import {
  Network, Router as RouterIcon, Server, Cpu, HardDrive, Box, Monitor,
  Wifi, ShieldAlert, type LucideIcon,
} from "lucide-react";
import { buildTopology, type TopoCluster, type TopoAsset } from "@/lib/topology";
import type { AssetRow } from "@/lib/loki-noc";

// type → node icon (colour comes from lib/topology TYPE_META).
const TYPE_ICON: Record<string, LucideIcon> = {
  switch: Network,
  router: RouterIcon,
  network: ShieldAlert,
  server: Server,
  vm: Cpu,
  storage: HardDrive,
  atm: Box,
  host: Monitor,
  wireless: Wifi,
};
function typeIcon(type: string): LucideIcon {
  return TYPE_ICON[type] ?? Box;
}

// status → glow ring colour for the node halo.
const STATUS_RING: Record<string, string> = {
  up: "#34d399",
  degraded: "#f59e0b",
  down: "#f43f5e",
};

export interface TopologyGraphProps {
  assets: AssetRow[];
  selectedId: string | null;
  onSelect: (asset: TopoAsset) => void;
}

export default function TopologyGraph({ assets, selectedId, onSelect }: TopologyGraphProps) {
  const clusters: TopoCluster[] = buildTopology(assets);

  return (
    <div className="relative w-full h-full min-h-[480px] rounded-lg border border-border bg-[radial-gradient(circle_at_50%_40%,hsl(217_33%_12%),hsl(222_47%_7%))] overflow-hidden">
      {/* faint dotted backdrop grid */}
      <div
        className="absolute inset-0 opacity-[0.18] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(hsl(217 33% 30%) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />

      {/* nodes */}
      {clusters.flatMap((c) =>
        c.nodes.map((n) => {
          const Icon = typeIcon(n.asset.type);
          const selected = selectedId === n.asset.name;
          const ring = STATUS_RING[n.asset.status] ?? "#64748b";
          return (
            <button
              key={n.asset.name}
              type="button"
              onClick={() => onSelect(n.asset)}
              title={`${n.asset.friendly} · ${n.asset.status}`}
              data-testid={`topo-node-${n.asset.name}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 group focus:outline-none"
              style={{ left: `${n.xPct}%`, top: `${n.yPct}%` }}
            >
              {/* down devices pulse a danger halo */}
              {n.asset.status === "down" && (
                <span
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: ring, opacity: 0.25 }}
                />
              )}
              <span
                className="relative flex items-center justify-center rounded-full transition-transform duration-150 group-hover:scale-110"
                style={{
                  width: 34,
                  height: 34,
                  background: c.color,
                  boxShadow: selected
                    ? `0 0 0 3px hsl(222 47% 7%), 0 0 0 5px #fff, 0 0 16px ${c.color}`
                    : `0 0 0 2px hsl(222 47% 7%), 0 0 0 3px ${ring}66`,
                }}
              >
                <Icon className="w-4 h-4 text-white" strokeWidth={2} />
              </span>
              {/* label appears on hover / when selected */}
              <span
                className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-background/90 px-1.5 py-0.5 text-[9px] font-mono text-foreground border border-border transition-opacity ${
                  selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                {n.asset.name}
              </span>
            </button>
          );
        }),
      )}

      {/* legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-border bg-background/70 px-2.5 py-1.5 backdrop-blur">
        {clusters.map((c) => (
          <span key={`leg-${c.type}`} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
            {c.label} <span className="text-foreground/50">{c.nodes.length}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
