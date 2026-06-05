// Right-rail "BI Companion" — now powered by CopilotKit (AG-UI protocol).
// Keeps the existing chrome (header, "Observing" pill, agent-suggestion tray)
// but the message list + input are CopilotKit's <CopilotChat>, which talks to
// the /api/copilotkit runtime. Interactive frontend actions are registered by
// <CopilotActions/>. The legacy askCopilot() bridge (dashboard "Explain"
// buttons) is wired to CopilotKit's sendMessage.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { BrainCircuit, Plus, Eye, AlertTriangle, Info, AlertOctagon, Check, XCircle } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { useChatObserver } from "@/lib/chat-observer";
import { useCopilot } from "@/lib/copilot-context";
import { useTenantConfig } from "@/lib/tenant-config";
import { useActiveProject } from "@/lib/active-project";
import { CopilotActions } from "@/lib/copilot-actions";

function useCopilotInstructions(workspaceId?: number) {
  return useQuery<string>({
    queryKey: ["copilot-instructions", workspaceId ?? 0],
    queryFn: async () => {
      const qs = workspaceId ? `?workspaceId=${workspaceId}` : "";
      const r = await fetch(`/api/copilotkit/instructions${qs}`, { credentials: "include" });
      if (!r.ok) return "";
      const body = await r.json();
      return typeof body.instructions === "string" ? body.instructions : "";
    },
    staleTime: 30_000,
  });
}

export default function CopilotPanel() {
  const { observation, agentSuggestions, dismissAgentSuggestion } = useChatObserver();
  const { registerHandler } = useCopilot();
  const { config } = useTenantConfig();
  const { pack } = useActiveProject();
  const { appendMessage, reset } = useCopilotChat();

  const copilotName = pack?.copilotName || config?.branding?.copilotName || "BI Companion";
  const { data: instructions } = useCopilotInstructions(observation.workspaceId);

  // Bridge: other surfaces (dashboard chart/KPI clicks, Home hero) call
  // askCopilot(question) — append it as a user turn so it shows in the chat AND
  // triggers the agent. appendMessage uses the GraphQL message type that
  // <CopilotChat> actually renders (the headless sendMessage does not).
  useEffect(() => {
    registerHandler((question: string) => {
      void appendMessage(new TextMessage({ content: question, role: Role.User })).catch(() => {});
    });
  }, [registerHandler, appendMessage]);

  return (
    <>
      <CopilotActions />

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
        <div className="px-2 py-2 border-b border-border bg-amber-50/40 space-y-1.5" data-testid="agent-suggestions-tray">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Agent suggestions ({agentSuggestions.length})
          </p>
          {agentSuggestions.map((s) => {
            const SevIcon = s.severity === "critical" ? AlertOctagon : s.severity === "warn" ? AlertTriangle : Info;
            const tone =
              s.severity === "critical" ? "border-red-200 bg-red-50"
              : s.severity === "warn" ? "border-amber-200 bg-amber-50"
              : "border-blue-200 bg-blue-50";
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
            initial: observation.summary
              ? `I can see **${observation.label}** — ask me about it, or tell me what to do (open a dashboard, switch tabs, build a dashboard).`
              : "Ask about your data, or tell me where to go and what to build.",
            placeholder: "Ask anything about your data…",
          }}
        />
      </div>
    </>
  );
}
