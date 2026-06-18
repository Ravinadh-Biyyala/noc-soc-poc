// The AI diagnosis card — renders a full incident_detail (root cause,
// recommendation, evidence, escalation) for the diagnosis drawer and the chat's
// diagnoseIncident render. Falls back gracefully when fields are missing.

import { AlertOctagon, Stethoscope, ListChecks, FileSearch, Users, Bot, ShieldAlert } from "lucide-react";
import { severityBadge } from "@/lib/noc-format";
import type { IncidentDetail } from "@/lib/loki-noc";

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground mb-1.5">
        <Icon className="w-3.5 h-3.5 text-cyan-300" /> {title}
      </div>
      {children}
    </div>
  );
}

export default function IncidentCard({ detail, onAssetClick }: { detail: IncidentDetail; onAssetClick?: (deviceId: string) => void }) {
  const confidencePct = detail.confidence != null ? Math.round(Number(detail.confidence) * 100) : null;
  const ew = detail.early_warning && typeof detail.early_warning === "object" ? detail.early_warning as Record<string, unknown> : null;

  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="flex items-start gap-2">
        <AlertOctagon className="w-4 h-4 mt-0.5 text-rose-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(detail.severity)}`}>{detail.severity ?? "—"}</span>
            {detail.type && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{detail.type}</span>}
            {detail.incident_id && <span className="text-[10px] font-mono text-muted-foreground">{detail.incident_id}</span>}
          </div>
          <p className="text-xs text-foreground mt-1 leading-snug">{detail.incident || detail.summary || "Incident"}</p>
        </div>
      </div>

      {/* Affected assets */}
      {(detail.affected_assets?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {detail.affected_assets!.map((a) => (
            onAssetClick ? (
              <button key={a} onClick={() => onAssetClick(a)} title="Open device health"
                className="rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-mono text-cyan-200 hover:bg-primary/10 hover:text-primary transition-colors">{a}</button>
            ) : (
              <span key={a} className="rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-mono text-cyan-200">{a}</span>
            )
          ))}
        </div>
      )}

      {/* Root cause */}
      <Section icon={Stethoscope} title={`Root cause analysis${confidencePct != null ? ` · ${confidencePct}% confidence` : ""}`}>
        <p className="text-[11px] text-foreground/90 leading-snug">{detail.root_cause || "Not available."}</p>
        {detail.rca_summary && <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{detail.rca_summary}</p>}
      </Section>

      {/* Recommendation */}
      {(detail.recommendation?.length ?? 0) > 0 && (
        <Section icon={ListChecks} title="Recommended actions">
          <ol className="list-decimal pl-4 space-y-0.5">
            {detail.recommendation!.map((r, i) => <li key={i} className="text-[11px] text-foreground/90 leading-snug">{r}</li>)}
          </ol>
          {(detail.escalation_team || detail.automatable != null) && (
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              {detail.escalation_team && <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {detail.escalation_team}</span>}
              {detail.automatable != null && <span className="flex items-center gap-1"><Bot className="w-3 h-3" /> {detail.automatable ? "Automatable" : "Manual"}</span>}
            </div>
          )}
        </Section>
      )}

      {/* Early warning */}
      {ew && Boolean(ew.warning || ew.kind) && (
        <Section icon={ShieldAlert} title="Early warning">
          <p className="text-[11px] text-amber-200/90 leading-snug">{String(ew.warning ?? ew.kind)}</p>
          {(ew.observed != null && ew.threshold != null) && (
            <p className="text-[10px] text-muted-foreground mt-0.5">observed {String(ew.observed)} vs threshold {String(ew.threshold)}{ew.risk ? ` · risk ${String(ew.risk)}` : ""}</p>
          )}
        </Section>
      )}

      {/* Evidence */}
      {(detail.evidence?.length ?? 0) > 0 && (
        <Section icon={FileSearch} title="Correlated evidence">
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {detail.evidence!.map((e, i) => (
              <div key={i} className="text-[10px] font-mono text-muted-foreground break-words border-l-2 border-border pl-2 leading-snug">{e}</div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
