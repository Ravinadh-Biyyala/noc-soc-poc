// Network/host topology status map — the monitored host at the hub with its log
// sources as spokes, each node colored by relative volume and flagged when under
// attack (auth.log with failed logins). Clicking a node cross-filters the whole
// dashboard. Pure SVG, no external deps; always works offline.

import { useState } from "react";

export interface TopoNode {
  /** Short label shown on the node. */
  label: string;
  /** Full filename value used for the cross-filter. */
  value: string;
  count: number;
  /** Mark this node as under attack (pulses red). */
  attack?: boolean;
}

export interface TopologyMapProps {
  host: string;
  nodes: TopoNode[];
  onSelect?: (value: string) => void;
  activeValue?: string | null;
  height?: number;
}

const W = 820;
const H = 360;

function healthColor(ratio: number): string {
  if (ratio >= 0.66) return "#f43f5e"; // hot
  if (ratio >= 0.33) return "#f59e0b"; // busy
  return "#34d399"; // calm
}

export default function TopologyMap({ host, nodes, onSelect, activeValue, height = 340 }: TopologyMapProps) {
  const [hover, setHover] = useState<string | null>(null);
  const cx = W * 0.22;
  const cy = H / 2;
  const max = Math.max(1, ...nodes.map((n) => n.count));

  // Spread spoke nodes in a vertical arc on the right.
  const placed = nodes.slice(0, 8).map((n, i, arr) => {
    const t = arr.length === 1 ? 0.5 : i / (arr.length - 1);
    const x = W * 0.62 + (i % 2) * (W * 0.2);
    const y = 50 + t * (H - 100);
    return { ...n, x, y };
  });

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        {/* links */}
        {placed.map((n) => (
          <line key={`l-${n.value}`} x1={cx} y1={cy} x2={n.x} y2={n.y}
                stroke={n.attack ? "#f43f5e" : "hsl(218 32% 26%)"} strokeWidth={n.attack ? 1.8 : 1}
                strokeDasharray={n.attack ? "4 3" : undefined} opacity={0.7} />
        ))}

        {/* host hub */}
        <g transform={`translate(${cx},${cy})`}>
          <circle r={42} fill="hsl(217 33% 16%)" stroke="hsl(190 95% 50%)" strokeWidth={2} />
          <text textAnchor="middle" y={-4} fill="hsl(190 95% 70%)" fontSize={11} fontWeight={700}>HOST</text>
          <text textAnchor="middle" y={12} fill="hsl(210 40% 90%)" fontSize={8} fontFamily="monospace">{host}</text>
        </g>

        {/* source nodes */}
        {placed.map((n) => {
          const color = n.attack ? "#f43f5e" : healthColor(n.count / max);
          const active = activeValue === n.value;
          const r = 10 + Math.sqrt(n.count / max) * 16;
          return (
            <g key={n.value} transform={`translate(${n.x},${n.y})`} className="cursor-pointer"
               onMouseEnter={() => setHover(n.value)} onMouseLeave={() => setHover(null)}
               onClick={() => onSelect?.(n.value)}>
              {n.attack && (
                <circle r={r + 6} fill="#f43f5e" opacity={0.18}>
                  <animate attributeName="r" values={`${r};${r + 12};${r}`} dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle r={r} fill={color} fillOpacity={active ? 0.95 : 0.7}
                      stroke={active ? "#fff" : color} strokeWidth={active ? 2 : 1} />
              <text textAnchor="middle" y={r + 12} fill="hsl(210 30% 80%)" fontSize={9} fontFamily="monospace">{n.label}</text>
              <text textAnchor="middle" y={3} fill="hsl(222 47% 8%)" fontSize={9} fontWeight={700}>{n.count}</text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground font-mono">
          click a node to filter the dashboard
        </div>
      )}
    </div>
  );
}
