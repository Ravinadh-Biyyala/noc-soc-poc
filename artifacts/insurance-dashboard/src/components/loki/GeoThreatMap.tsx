// Geographic threat map — plots attacker source IPs on a world map. Basemap is
// the offline world-atlas TopoJSON projected with d3-geo (geoNaturalEarth1); the
// IP coordinates come from the best-effort /api/loki-geoip lookup. Degrades to a
// "geolocation unavailable" note when no points resolve.

import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldData from "world-atlas/countries-110m.json";
import type { GeoPoint } from "@/lib/loki-dashboard";

const W = 820;
const H = 420;

// Build country paths once (module-level memo via closure in component).
function useWorldPaths() {
  return useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = feature(worldData as any, (worldData as any).objects.countries) as any;
    const projection = geoNaturalEarth1().fitSize([W, H], fc);
    const path = geoPath(projection);
    const countries: string[] = (fc.features as any[]).map((f) => path(f) || "");
    return { projection, countries };
  }, []);
}

export interface GeoThreatMapProps {
  points: GeoPoint[];
  onSelect?: (ip: string) => void;
  height?: number;
  /** Noun for the count shown in the hover card (e.g. "critical alarms"). */
  metricLabel?: string;
  /** Message shown when there are no plottable points. */
  emptyText?: string;
}

export default function GeoThreatMap({ points, onSelect, height = 360, metricLabel = "events", emptyText }: GeoThreatMapProps) {
  const { projection, countries } = useWorldPaths();
  const [hover, setHover] = useState<GeoPoint | null>(null);

  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const radius = (c: number) => 4 + Math.sqrt(c / maxCount) * 14;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <rect x={0} y={0} width={W} height={H} fill="hsl(222 47% 7%)" />
        <g>
          {countries.map((d, i) => (
            <path key={i} d={d} fill="hsl(217 33% 14%)" stroke="hsl(218 32% 22%)" strokeWidth={0.4} />
          ))}
        </g>
        <g>
          {points.map((p) => {
            const xy = projection([p.lon, p.lat]);
            if (!xy) return null;
            const [x, y] = xy;
            const r = radius(p.count);
            return (
              <g key={p.ip} transform={`translate(${x},${y})`} className="cursor-pointer"
                 onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
                 onClick={() => onSelect?.(p.ip)}>
                <circle r={r + 4} fill="#f43f5e" opacity={0.15}>
                  <animate attributeName="r" values={`${r};${r + 10};${r}`} dur="2.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.25;0;0.25" dur="2.4s" repeatCount="indefinite" />
                </circle>
                <circle r={r} fill="#f43f5e" fillOpacity={0.7} stroke="#fecdd3" strokeWidth={1} />
              </g>
            );
          })}
        </g>
      </svg>

      {points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {emptyText ?? "No geolocated points in range."}
        </div>
      )}

      {hover && (
        <div className="absolute top-2 left-2 rounded-md border border-border bg-popover/95 px-2.5 py-1.5 text-[11px] shadow-lg pointer-events-none">
          <div className="font-semibold text-rose-300 font-mono">{hover.ip}</div>
          <div className="text-muted-foreground">{[hover.city, hover.country].filter(Boolean).join(", ") || "Unknown"}</div>
          <div className="text-foreground">{hover.count.toLocaleString()} {metricLabel}</div>
        </div>
      )}
    </div>
  );
}
