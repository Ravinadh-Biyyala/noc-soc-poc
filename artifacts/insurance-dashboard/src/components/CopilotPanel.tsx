// Right-rail "BI Companion" — powered by CopilotKit (AG-UI protocol). The
// message list + input are CopilotKit's <CopilotChat>, talking to the
// /api/copilotkit runtime (a Loki-focused persona). The Loki tools the agent
// can call (queryLoki, pinLokiVisual) are registered by the Loki Logs page
// itself via useCopilotAction, so this panel just renders the chat chrome.

import { useQuery } from "@tanstack/react-query";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotChat } from "@copilotkit/react-core";
import { BrainCircuit, Plus, Eye, AlertTriangle, Info, AlertOctagon, Check, XCircle } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { useChatObserver } from "@/lib/chat-observer";
import { useNocCopilotActions } from "@/lib/noc-actions";

const COPILOT_NAME = "BI Companion";

function useCopilotInstructions() {
  return useQuery<string>({
    queryKey: ["copilot-instructions"],
    queryFn: async () => {
      const r = await fetch(`/api/copilotkit/instructions`, { credentials: "include" });
      if (!r.ok) return "";
      const body = await r.json();
      return typeof body.instructions === "string" ? body.instructions : "";
    },
    staleTime: 30_000,
  });
}

export default function CopilotPanel() {
  const { observation, agentSuggestions, dismissAgentSuggestion } = useChatObserver();
  const { reset } = useCopilotChat();

  // Register the NOC function-backed tools globally so the agent can call them on
  // every page (not just the Explorer).
  useNocCopilotActions();

  const copilotName = COPILOT_NAME;
  const { data: instructions } = useCopilotInstructions();

  return (
    <>
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
          <BrainCircuit className="w-4 h-4 text-primary" />
          {copilotName}
          <span className="text-[9px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">BI</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => reset()}
          title="Start a new chat"
          className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Live "what I'm looking at" pill — proves the Copilot is page-aware. */}
      <div className="px-3 py-1.5 border-b border-border bg-primary/5 flex items-center gap-1.5 text-[11px]" data-testid="copilot-observation-pill">
        <Eye className="w-3 h-3 text-primary flex-shrink-0" />
        <span className="text-muted-foreground">Observing</span>
        <span className="font-medium text-foreground truncate flex-1 min-w-0">{observation.label}</span>
      </div>

      {/* Proactive agent suggestions (data-quality nudges). */}
      {agentSuggestions.length > 0 && (
        <div className="px-2 py-2 border-b border-border bg-amber-500/5 space-y-1.5" data-testid="agent-suggestions-tray">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Agent suggestions ({agentSuggestions.length})
          </p>
          {agentSuggestions.map((s) => {
            const SevIcon = s.severity === "critical" ? AlertOctagon : s.severity === "warn" ? AlertTriangle : Info;
            const tone =
              s.severity === "critical" ? "border-rose-500/40 bg-rose-500/10"
              : s.severity === "warn" ? "border-amber-500/40 bg-amber-500/10"
              : "border-cyan-500/40 bg-cyan-500/10";
            const iconTone =
              s.severity === "critical" ? "text-red-600" : s.severity === "warn" ? "text-amber-600" : "text-blue-600";
            return (
              <div key={s.id} className={cn("rounded-md border p-2 text-[11px] space-y-1.5", tone)} data-testid={`agent-suggestion-${s.id}`}>
                <div className="flex items-start gap-1.5">
                  <SevIcon className={cn("w-3 h-3 mt-0.5 flex-shrink-0", iconTone)} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground leading-tight">{s.title}</p>
                    <p className="text-muted-foreground mt-0.5 leading-snug">{s.rationale}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pl-4">
                  {s.onApply && (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => { s.onApply?.(); dismissAgentSuggestion(s.id); }}
                      data-testid={`agent-suggestion-apply-${s.id}`}
                    >
                      <Check className="w-2.5 h-2.5" />
                      {s.applyLabel || "Apply"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] gap-1 text-muted-foreground"
                    onClick={() => dismissAgentSuggestion(s.id)}
                    data-testid={`agent-suggestion-skip-${s.id}`}
                  >
                    <XCircle className="w-2.5 h-2.5" />
                    Skip
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CopilotKit chat — manual suggestions = no auto follow-up chips. */}
      <div className="flex-1 min-h-0 copilot-rail">
        <CopilotChat
          className="h-full"
          instructions={instructions ?? ""}
          suggestions="manual"
          labels={{
            placeholder: "Ask about devices, alarms, incidents…",
          }}
        />
      </div>
    </>
  );
}
