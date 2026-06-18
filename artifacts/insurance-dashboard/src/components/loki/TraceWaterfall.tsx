// Waterfall (Gantt) renderer for a reconstructed incident trace. Each span is a row
// — its bar positioned by offset/duration on a shared time axis — so an operator can
// see the device's precursor events build up and culminate in the AI diagnosis.
// Used full-size on the Traces page and compact inline in the chat.

import { useState } from "react";
import { severityColor } from "@/lib/noc-format";
import type { IncidentTrace, TraceSpan } from "@/lib/loki-noc";

const DIAGNOSIS_COLOR = "#38bdf8"; // cyan — AI analysis phases, distinct from event severities

function spanColor(s: TraceSpan): string {
  if (s.kind === "diagnosis") return DIAGNOSIS_COLOR;
  if (s.kind === "warning") return severityColor(s.severity || "high");
  return severityColor(s.severity);
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

export interface TraceWaterfallProps {
  trace: IncidentTrace;
  compact?: boolean;
}

export default function TraceWaterfall({ trace, compact }: TraceWaterfallProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const total = Math.max(trace.duration_ms || 1, 1);
  const spans = compact ? trace.spans.slice(0, 14) : trace.spans;
  const minPct = 1.5;
  const labelW = compact ? "38%" : "34%";

  if (!spans.length) {
    return <p className="text-xs text-muted-foreground py-4 text-center">No correlated events to trace.</p>;
  }

  return (
    <div className="space-y-2">
      {/* Time axis */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <div style={{ width: labelW }} className="shrink-0">{trace.span_count} spans · {fmtDur(total)}</div>
        <div className="flex-1 flex justify-between"><span>T+0</span><span>{fmtDur(total)}</span></div>
      </div>

      <div className={`space-y-1 ${compact ? "" : "max-h-[420px] overflow-y-auto pr-1"}`}>
        {spans.map((s, i) => {
          const left = Math.min((s.offset_ms / total) * 100, 99);
          const width = Math.max((s.duration_ms / total) * 100, minPct);
          const color = spanColor(s);
          const isSel = selected === i;
          return (
            <button
              key={i}
              onClick={() => setSelected(isSel ? null : i)}
              className={`w-full flex items-center gap-2 rounded px-1 py-0.5 text-left transition-colors ${isSel ? "bg-accent/50" : "hover:bg-accent/30"}`}
            >
              <div style={{ width: labelW }} className="shrink-0 flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className={`truncate text-[10.5px] ${s.kind === "diagnosis" ? "text-cyan-300 font-medium" : "text-foreground/85"}`} title={s.message || s.label}>
                  {s.label}
                </span>
              </div>
              <div className="relative flex-1 h-3.5 rounded bg-muted/25 overflow-hidden">
                <div
                  className="absolute inset-y-0 rounded"
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, backgroundColor: color, opacity: s.kind === "diagnosis" ? 0.85 : 0.7 }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{fmtDur(s.offset_ms)}</span>
            </button>
          );
        })}
      </div>

      {/* Selected span detail */}
      {selected != null && spans[selected] && (
        <div className="rounded-md border border-border/60 bg-background/50 p-2 text-[11px]">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: spanColor(spans[selected]) }} />
            <span className="font-semibold text-foreground">{spans[selected].label}</span>
            <span className="ml-auto text-[10px] text-muted-foreground uppercase">{spans[selected].kind}</span>
          </div>
          <p className="text-foreground/80 leading-snug break-words">{spans[selected].message}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
            {spans[selected].source && <span>source: {spans[selected].source}</span>}
            {spans[selected].severity && <span>severity: {spans[selected].severity}</span>}
            <span>{new Date(spans[selected].ts).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground pt-0.5">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#f43f5e" }} /> critical</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#f59e0b" }} /> warning</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: DIAGNOSIS_COLOR }} /> AI diagnosis</span>
      </div>
    </div>
  );
}
