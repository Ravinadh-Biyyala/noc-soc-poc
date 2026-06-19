// A compact ranked-bar list (label + value + proportional bar) for top-N
// breakdowns. Shared by the SOC and NOC deep-dive dashboards.

import { fmtNum } from "@/lib/noc-format";

export interface RankItem { value: string; count: number }

export default function RankList({ items, color = "#38bdf8", empty = "No data in range.", labelMap }: {
  items: RankItem[]; color?: string; empty?: string; labelMap?: (v: string) => string;
}) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0) || 1;
  if (items.length === 0) return <p className="text-[11px] text-muted-foreground py-4 text-center">{empty}</p>;
  // Redraw spec so the chat can re-render this ranking as a bar chart inline on
  // "Explain". See readVisualChart + the renderClickedVisual action.
  const explainChart = JSON.stringify({
    type: "bar", xKey: "label", yKey: "count",
    data: items.slice(0, 15).map((i) => ({ label: labelMap ? labelMap(i.value) : i.value, count: i.count })),
  });
  return (
    <div className="space-y-1.5" data-explain-chart={explainChart}>
      {items.map((i) => (
        <div key={i.value} className="space-y-0.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-mono text-foreground/90 truncate pr-2">{labelMap ? labelMap(i.value) : i.value}</span>
            <span className="text-muted-foreground tabular-nums">{fmtNum(i.count)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-background/60 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(i.count / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
