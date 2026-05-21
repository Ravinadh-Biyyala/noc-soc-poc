import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send } from "lucide-react";

/**
 * Phase 3 — Project-scoped agent chat.
 *
 * AnalystChatAgent answers questions over the project's warehouse tables. It
 * has a single tool (execute_warehouse_query) scoped to proj_{id}_warehouse
 * and emits the existing [CHART:{...}] / [TABLE:{...}] / [METRIC:{...}] visual
 * blocks so the chart parser in components/chat.tsx works unchanged.
 *
 * Full streaming + visual-block parsing is tracked as deferred work — this
 * skeleton lets the user reach the panel.
 */
export function ProjectChatPanel({ projectId }: { projectId: number }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!draft.trim()) return;
    const userMsg = draft.trim();
    setDraft("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setBusy(true);
    try {
      // Endpoint stub — POST /api/projects/:id/agents/analyst-chat/messages
      // is not yet implemented; see deferred work in the plan file.
      await new Promise((r) => setTimeout(r, 400));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `(AnalystChatAgent placeholder for project ${projectId}) — once wired, this will query the warehouse and return a chart/table/metric.`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 min-h-[300px] flex flex-col gap-3">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 text-muted-foreground py-12">
              <MessageSquare className="w-6 h-6 opacity-50" />
              <p className="text-sm">Ask a question about your warehouse data.</p>
              <p className="text-xs max-w-md">
                The agent has read-only access to <code className="text-xs bg-muted px-1.5 py-0.5 rounded">proj_{projectId}_warehouse</code> only.
              </p>
            </div>
          ) : (
            <div className="flex-1 space-y-2 overflow-y-auto">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[75%] bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm"
                      : "mr-auto max-w-[75%] bg-muted rounded-lg px-3 py-2 text-sm"
                  }
                >
                  {m.content}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Ask about project ${projectId}'s warehouse…`}
          disabled={busy}
          data-testid="project-chat-input"
        />
        <Button onClick={send} disabled={busy || !draft.trim()} className="gap-1.5">
          <Send className="w-3.5 h-3.5" />
          Send
        </Button>
      </div>
    </div>
  );
}
