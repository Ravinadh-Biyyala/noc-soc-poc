import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send } from "lucide-react";

/**
 * Phase 3 — Project-scoped agent chat (AnalystChatAgent).
 *
 * Streams from the Python agent service via Server-Sent Events:
 *   POST /api/projects/:id/agents/analyst-chat/messages   { message }
 *   -> data: {"type":"tool","name":...}
 *      data: {"type":"token","value":"..."}   (repeated)
 *      data: {"type":"done"}
 *
 * The agent has a single read-only tool (execute_warehouse_query) scoped to
 * proj_{id}_warehouse and emits [CHART:{…}] / [TABLE:{…}] / [METRIC:{…}] blocks
 * in its text. (The rich block renderer lives in components/chat.tsx; this panel
 * renders the streamed text — blocks appear inline until that renderer is shared.)
 */
type ChatMessage = { role: "user" | "assistant"; content: string };

export function ProjectChatPanel({ projectId }: { projectId: number }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    if (!draft.trim() || busy) return;
    const userMsg = draft.trim();
    setDraft("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/agents/analyst-chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: userMsg }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const appendToLast = (text: string) =>
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + text };
          return next;
        });

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line.
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.type === "token") appendToLast(payload.value);
            else if (payload.type === "error") appendToLast(`\n\n_Error: ${payload.message}_`);
          } catch {
            /* ignore keep-alive / partial frames */
          }
        }
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        const msg = err instanceof Error ? err.message : "Stream failed";
        if (last?.role === "assistant" && !last.content) next[next.length - 1] = { ...last, content: `_Error: ${msg}_` };
        return next;
      });
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
                The agent has read-only access to{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">proj_{projectId}_warehouse</code> only.
              </p>
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto max-h-[420px]">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[75%] bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm"
                      : "mr-auto max-w-[75%] bg-muted rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
                  }
                >
                  {m.content || (busy && m.role === "assistant" ? "…" : "")}
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
