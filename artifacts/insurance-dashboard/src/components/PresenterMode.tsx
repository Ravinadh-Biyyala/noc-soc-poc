import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, X, Send, Loader2, BrainCircuit, BarChart3, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import GeneratedDashboard from "@/components/GeneratedDashboard";
import {
  applyActions,
  autoTidy,
  buildLayoutToolPrompt,
  parseLayoutActions,
} from "@/lib/layout-actions";

interface Props {
  config: any;
  onClose: () => void;
  /** When provided, the Copilot can mutate the dashboard layout. */
  onConfigChange?: (next: any) => void;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * Build a compact text summary of the dashboard so the Copilot can answer
 * questions about what is currently on screen ("why is Mercedes the outlier?",
 * "what's our top customer?", etc.) without needing tool-calling. Capped per
 * chart so the prompt stays well within the model's context window.
 */
function summarizeDashboard(config: any): string {
  if (!config) return "";
  const lines: string[] = [];
  lines.push(`Dashboard: "${config.title ?? "Untitled"}"`);
  if (config.subtitle) lines.push(`Subtitle: ${config.subtitle}`);

  const kpis = Array.isArray(config.kpis) ? config.kpis : [];
  if (kpis.length) {
    lines.push("", "KPIs:");
    for (const k of kpis) {
      const v = typeof k.value === "number" ? k.value.toLocaleString() : k.value;
      lines.push(`- ${k.label}: ${v}${k.trend ? ` (${k.trend})` : ""}`);
    }
  }

  const charts = Array.isArray(config.charts) ? config.charts : [];
  if (charts.length) {
    lines.push("", "Charts on screen:");
    for (const c of charts) {
      const sample = Array.isArray(c.data) ? c.data.slice(0, 12) : [];
      lines.push(
        `- "${c.title}" (${c.type}, x=${c.xKey}, y=${Array.isArray(c.yKey) ? c.yKey.join("/") : c.yKey})`,
      );
      if (c.subtitle) lines.push(`    note: ${c.subtitle}`);
      if (sample.length) lines.push(`    data: ${JSON.stringify(sample)}`);
    }
  }
  return lines.join("\n");
}

export default function PresenterMode({ config, onClose, onConfigChange }: Props) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Esc-to-exit + lock background scroll for the duration of the overlay so
  // the dashboard underneath can't peek out via wheel events. Also restore
  // focus to whatever the user had focused before opening the overlay.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move initial focus into the overlay so screen readers / keyboard users
    // land somewhere meaningful and can't tab into background content.
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Render through a portal so we escape the app's sidebar/topbar layout
  // entirely and own the full viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-background animate-in fade-in duration-200 flex"
      role="dialog"
      aria-modal="true"
      aria-label={`Presenter mode: ${config?.title ?? "Dashboard"}`}
    >
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-12 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between px-5 flex-shrink-0">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="uppercase tracking-wider font-semibold">Presenter mode</span>
            <span className="opacity-50">·</span>
            <span className="truncate max-w-[40vw]">{config?.title ?? "Dashboard"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {onConfigChange && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onConfigChange(autoTidy(config))}
                className="h-8 gap-1.5 text-xs"
                title="Auto-arrange charts"
              >
                <Wand2 className="w-3.5 h-3.5" /> Tidy
              </Button>
            )}
            <Button ref={closeBtnRef} variant="ghost" size="sm" onClick={onClose} className="h-8 gap-1.5 text-xs">
              <X className="w-3.5 h-3.5" /> Exit (Esc)
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-8 py-6 max-w-[1600px] mx-auto">
            <GeneratedDashboard config={config} hidePresenter />
          </div>
        </ScrollArea>
      </div>

      <PresenterCopilot config={config} onConfigChange={onConfigChange} />
    </div>,
    document.body,
  );
}

function PresenterCopilot({
  config,
  onConfigChange,
}: {
  config: any;
  onConfigChange?: (next: any) => void;
}) {
  const summary = useMemo(() => summarizeDashboard(config), [config]);
  // Read latest config inside async streaming code without re-creating send().
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);
  const onConfigChangeRef = useRef(onConfigChange);
  useEffect(() => { onConfigChangeRef.current = onConfigChange; }, [onConfigChange]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sentContextRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const convIdRef = useRef<number | null>(null);
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  // Spin up a fresh conversation per presenter session so context from other
  // chats doesn't leak in and so the dashboard summary only lives here.
  // On unmount we delete it server-side — the dashboard summary contains
  // sampled data we don't want persisted in the global conversations list.
  useEffect(() => {
    aliveRef.current = true;
    let createdId: number | null = null;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/openai/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `Presenter · ${config?.title ?? "dashboard"}` }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        createdId = data.id;
        convIdRef.current = data.id;
        if (aliveRef.current) setConvId(data.id);
      } catch (err: unknown) {
        if (aliveRef.current) {
          setError(err instanceof Error ? err.message : "Failed to start Copilot");
        }
      }
    })();
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      const id = convIdRef.current ?? createdId;
      if (id != null) {
        // keepalive lets the request fly even though the component is gone;
        // failures here are intentionally swallowed (best-effort cleanup).
        fetch(`${apiBase}/api/openai/conversations/${id}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [apiBase, config?.title]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  const send = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || !convId || busy) return;

    // Inject the dashboard summary on the FIRST send only — the model carries
    // it forward through the conversation thread, so we don't pay the token
    // cost again, and follow-up messages stay clean. When the host provided
    // an onConfigChange callback we also teach the model the layout tools.
    //
    // ALSO re-inject the layout tools whenever the user's message looks like
    // a layout intent ("resize", "tidy", "wider", "hide", "reorder", …), even
    // mid-conversation. The model otherwise tends to forget the protocol
    // after a few turns and starts apologising about not being able to edit.
    const isLayoutIntent = /\b(tidy|tidies|tidy[- ]?up|beautify|resize|wider|narrower|full[- ]?width|half[- ]?width|reorder|rearrange|swap|hide|show|remove|cleanup|clean[- ]?up|layout)\b/i.test(trimmed);
    const layoutTools = onConfigChangeRef.current && (!sentContextRef.current || isLayoutIntent)
      ? buildLayoutToolPrompt((configRef.current?.charts ?? []).map((c: any) => ({ id: c.id, type: c.type, title: c.title })))
      : "";
    const payload = sentContextRef.current
      ? (layoutTools ? `${layoutTools}\n[USER QUESTION]\n${trimmed}` : trimmed)
      : `You are observing the user's currently displayed dashboard. Use it as ground truth when answering. If a question can't be answered from the on-screen data, say so plainly.\n\n[ON-SCREEN DASHBOARD]\n${summary}\n${layoutTools}\n[USER QUESTION]\n${trimmed}`;
    sentContextRef.current = true;

    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    setInput("");
    setBusy(true);
    setStreaming("");
    setError(null);

    // Abort any in-flight stream from a previous send (defensive — UI disables
    // input while busy, but better safe than dangling) and tie this stream to
    // a controller so unmount can cancel it cleanly.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${apiBase}/api/openai/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      // SSE chunks can split mid-event across reads, so we buffer until we see
      // a blank-line terminator before parsing each event.
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!aliveRef.current) { reader.cancel(); return; }
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          for (const line of ev.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const body = line.slice(6);
            if (body === "[DONE]") continue;
            try {
              const parsed = JSON.parse(body);
              if (parsed.content) { acc += parsed.content; setStreaming(acc); }
            } catch { /* ignore partial */ }
          }
        }
      }
      if (aliveRef.current) {
        // Strip layout-action blocks out of what the user sees, then apply
        // them to the live dashboard config. Note: we apply against the LATEST
        // config (via ref), not a closure over the value at send-time, so two
        // back-to-back layout asks compose correctly.
        const { actions, cleanText } = parseLayoutActions(acc);
        if (actions.length && onConfigChangeRef.current) {
          onConfigChangeRef.current(applyActions(configRef.current, actions));
        }
        const display = cleanText || acc;
        const tag = actions.length ? `\n\n_Applied ${actions.length} layout change${actions.length === 1 ? "" : "s"}._` : "";
        // Empty stream = something went wrong upstream. Show a real error
        // instead of "(no response)" so users don't think they typed something
        // wrong. Most common cause: rate limit / model hiccup.
        if (!display.trim() && !actions.length) {
          setError("The Copilot didn't return anything. Try asking again — if it keeps happening, the model may be rate-limited.");
        } else {
          setMessages((m) => [...m, { role: "assistant", content: (display || "Done.") + tag }]);
        }
      }
    } catch (err: unknown) {
      // Aborts on unmount are expected — don't surface to the UI.
      if (!aliveRef.current || (err instanceof DOMException && err.name === "AbortError")) return;
      setError(err instanceof Error ? `Copilot error: ${err.message}` : "Something went wrong while talking to the Copilot.");
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setStreaming("");
      }
    }
  };

  const suggestions = useMemo(() => {
    const out: string[] = [];
    const charts = Array.isArray(config?.charts) ? config.charts : [];
    if (charts[0]) out.push(`What stands out in "${charts[0].title}"?`);
    if (onConfigChange) out.push("Tidy up the layout for me");
    if (charts[1]) out.push(`Walk me through "${charts[1].title}"`);
    out.push("Any outliers I should worry about?");
    return out.slice(0, 4);
  }, [config, onConfigChange]);

  return (
    <aside className="w-[380px] xl:w-[420px] border-l border-border bg-card flex flex-col flex-shrink-0">
      <div className="h-12 px-4 border-b border-border flex items-center gap-2 flex-shrink-0 bg-muted/20">
        <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
          <BrainCircuit className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground leading-tight">Gen-BI Copilot</div>
          <div className="text-[10px] text-muted-foreground leading-tight">Watching this dashboard</div>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-3">
          {messages.length === 0 && !streaming && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-[12px] text-muted-foreground leading-relaxed">
                <div className="flex items-center gap-1.5 text-primary text-[10px] font-semibold uppercase tracking-wider mb-1.5">
                  <BarChart3 className="w-3 h-3" /> Context loaded
                </div>
                I can see {(config?.kpis?.length ?? 0)} KPIs and {(config?.charts?.length ?? 0)} charts on screen. Ask me anything about them.
              </div>
              <div className="space-y-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={!convId || busy}
                    className="w-full text-left text-[12px] text-foreground bg-background hover:bg-muted/60 border border-border rounded-md px-2.5 py-2 transition-colors disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg text-[13px] leading-relaxed px-3 py-2 max-w-[92%] whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-primary text-primary-foreground ml-auto rounded-tr-sm"
                  : "bg-muted text-foreground mr-auto rounded-tl-sm",
              )}
            >
              {m.content}
            </div>
          ))}

          {streaming && (
            <div className="bg-muted text-foreground rounded-lg rounded-tl-sm text-[13px] leading-relaxed px-3 py-2 max-w-[92%] mr-auto whitespace-pre-wrap">
              {streaming}
              <span className="inline-block w-1.5 h-3 bg-primary ml-0.5 align-middle animate-pulse" />
            </div>
          )}

          {busy && !streaming && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
            </div>
          )}

          {error && (
            <div className="text-[12px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-2.5 py-2">
              {error}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="p-3 border-t border-border bg-card flex-shrink-0"
      >
        <div className="relative">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!convId || busy}
            placeholder={!convId ? "Starting Copilot…" : "Ask about this dashboard…"}
            className="w-full text-sm bg-muted border-none py-2.5 pl-3 pr-10 rounded-md focus:ring-1 focus:ring-primary outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || !convId || busy}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-primary disabled:opacity-40 disabled:hover:text-muted-foreground"
            aria-label="Send"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </aside>
  );
}
