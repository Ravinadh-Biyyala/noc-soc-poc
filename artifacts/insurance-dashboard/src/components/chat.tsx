import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  BrainCircuit, Send, Loader2, Plus, Eye, Sparkles, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useChatObserver } from "@/lib/chat-observer";
import { parseLayoutActions } from "@/lib/layout-actions";
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChartData {
  type: string;
  title: string;
  xKey: string;
  yKey: string;
  data: any[];
}

interface ChatProps {
  onClose: () => void;
}

// ─── Chart utilities ──────────────────────────────────────────────────────────

const CHART_COLORS = ["#1565C0", "#0288D1", "#0097A7", "#00838F", "#00695C", "#6366f1", "#8b5cf6"];

function parseCharts(content: string): { text: string; charts: ChartData[] } {
  const charts: ChartData[] = [];
  let text = content;

  const marker = "[CHART:";
  let startIdx = text.indexOf(marker);
  while (startIdx !== -1) {
    const jsonStart = startIdx + marker.length;
    let depth = 0;
    let endIdx = jsonStart;
    for (let i = jsonStart; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
    const closeBracket = text.indexOf("]", endIdx);
    const fullMatch = text.substring(startIdx, closeBracket !== -1 ? closeBracket + 1 : endIdx);
    const jsonStr = text.substring(jsonStart, endIdx);
    try {
      charts.push(JSON.parse(jsonStr));
    } catch {}
    text = text.replace(fullMatch, "");
    startIdx = text.indexOf(marker);
  }

  return { text: text.trim(), charts };
}

function formatChartValue(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  if (val < 1 && val > 0) return `${(val * 100).toFixed(1)}%`;
  return val.toLocaleString();
}

// ─── Inline bold parser ───────────────────────────────────────────────────────

function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// ─── Markdown normalizer (also used in renderMessageContent) ──────────────────

function normalizeMarkdown(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n");
  // Only convert if no proper newline-bullets already present
  if (!/\n\s*[-*•]\s/.test(t)) {
    const c = t.replace(/([.!?:,;])\s{1,4}[-–—]\s{1,4}/g, "$1\n- ");
    if (c !== t) t = c;
  }
  return t;
}

// ─── Markdown renderer (pure renderer — normalization done before this) ────────

function MarkdownText({ content }: { content: string }) {
  const text = content;

  // Parse lines into typed segments
  type Seg =
    | { k: "h1" | "h2" | "h3"; text: string }
    | { k: "bullets"; items: string[] }
    | { k: "numbered"; items: string[] }
    | { k: "para"; text: string };

  const segs: Seg[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];

  const flushBullets = () => { if (bullets.length) { segs.push({ k: "bullets", items: [...bullets] }); bullets = []; } };
  const flushNumbered = () => { if (numbered.length) { segs.push({ k: "numbered", items: [...numbered] }); numbered = []; } };
  const flush = () => { flushBullets(); flushNumbered(); };

  for (const raw of text.split("\n")) {
    const t = raw.trim();
    // Blank line = hard segment break
    if (!t) { flush(); continue; }

    const hm = t.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      flush();
      const level = hm[1].length;
      segs.push({ k: level === 1 ? "h1" : level === 2 ? "h2" : "h3", text: hm[2] });
      continue;
    }

    const bm = t.match(/^[-*•]\s+(.+)$/);
    if (bm) { flushNumbered(); bullets.push(bm[1]); continue; }

    const nm = t.match(/^\d+\.\s+(.+)$/);
    if (nm) { flushBullets(); numbered.push(nm[1]); continue; }

    flush();
    segs.push({ k: "para", text: t });
  }
  flush();

  // Step 4 — render using explicit bullet chars (no CSS list-style dependency)
  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
      {segs.map((s, i) => {
        if (s.k === "h1") return (
          <div key={i} className="font-bold text-sm text-foreground mt-2 mb-1">
            <InlineBold text={s.text} />
          </div>
        );
        if (s.k === "h2") return (
          <div key={i} className="font-semibold text-[11px] text-primary/80 mt-2 mb-0.5 uppercase tracking-wide">
            <InlineBold text={s.text} />
          </div>
        );
        if (s.k === "h3") return (
          <div key={i} className="font-semibold text-[12px] text-foreground mt-1.5 mb-0.5">
            <InlineBold text={s.text} />
          </div>
        );
        if (s.k === "bullets") return (
          <div key={i} className="space-y-1.5 my-1.5 pl-1">
            {s.items.map((it, j) => (
              <div key={j} className="flex gap-2 items-start">
                <span className="text-primary font-black mt-[2px] flex-shrink-0 text-[16px] leading-none">•</span>
                <span className="flex-1 leading-relaxed"><InlineBold text={it} /></span>
              </div>
            ))}
          </div>
        );
        if (s.k === "numbered") return (
          <div key={i} className="space-y-1.5 my-1.5">
            {s.items.map((it, j) => (
              <div key={j} className="flex gap-2 items-start">
                <span className="text-primary font-semibold flex-shrink-0 min-w-[1.25rem] text-[12px]">{j + 1}.</span>
                <span className="flex-1 leading-relaxed"><InlineBold text={it} /></span>
              </div>
            ))}
          </div>
        );
        return (
          <p key={i} className="leading-relaxed">
            <InlineBold text={s.text} />
          </p>
        );
      })}
    </div>
  );
}

function InlineChart({ chartData }: { chartData: ChartData }) {
  const { type, title, xKey } = chartData;
  // Coerce string numbers from pg query results so Recharts renders correctly.
  const rawData = chartData.data || [];
  const data = rawData.map((row: any) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === "string" && v !== "" && isFinite(Number(v)) ? Number(v) : v;
    }
    return out;
  });
  // Guard against AI generating yKey === xKey (same bug as ChartCard).
  const rawYKey = chartData.yKey;
  const cols = data.length > 0 ? Object.keys(data[0]) : [];
  const yKey = rawYKey !== xKey ? rawYKey : (cols.find((c) => c !== xKey) ?? rawYKey);
  const tooltipStyle = {
    backgroundColor: "#fff",
    borderColor: "#e5e7eb",
    borderRadius: "8px",
    fontSize: "11px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  };

  return (
    <div className="mt-2 mb-1 bg-muted/40 rounded-lg border border-border p-3">
      <p className="text-[11px] font-semibold text-foreground mb-2">{title}</p>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === "pie" ? (
            <PieChart>
              <Pie
                data={data} cx="50%" cy="50%"
                innerRadius={35} outerRadius={65}
                paddingAngle={2} dataKey={yKey} nameKey={xKey}
              >
                {data.map((_: any, i: number) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatChartValue(v)]} />
            </PieChart>
          ) : type === "bar" ? (
            <BarChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
              <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatChartValue} stroke="#6b7280" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatChartValue(v)]} />
              <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
                {data.map((_: any, i: number) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          ) : type === "line" ? (
            <LineChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
              <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatChartValue} stroke="#6b7280" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatChartValue(v)]} />
              <Line type="monotone" dataKey={yKey} stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ fill: CHART_COLORS[0], r: 3 }} />
            </LineChart>
          ) : (
            <AreaChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 20 }}>
              <defs>
                <linearGradient id="chatAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
              <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatChartValue} stroke="#6b7280" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatChartValue(v)]} />
              <Area type="monotone" dataKey={yKey} stroke={CHART_COLORS[1]} strokeWidth={2} fillOpacity={1} fill="url(#chatAreaGrad)" />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      {type === "pie" && (
        <div className="grid grid-cols-2 gap-1 mt-2">
          {data.slice(0, 6).map((item: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-[9px]">
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="text-muted-foreground truncate">{item[xKey]}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[9px] text-muted-foreground/50 mt-1.5 text-right">{data.length} data points</p>
    </div>
  );
}

// ─── Main Chat component ───────────────────────────────────────────────────────

export function Chat({ onClose }: ChatProps) {
  const [, setLocation] = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streamingMessage, setStreamingMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  // Whether we've already prepended the observation context for this session
  const contextInjected = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { observation } = useChatObserver();

  // Re-seed context when the user navigates to a different page
  useEffect(() => {
    contextInjected.current = false;
  }, [observation.label]);

  // Auto-scroll to bottom whenever messages or streaming content change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  // Listen for `copilot:focus` events from other surfaces (e.g. Home hero tile)
  useEffect(() => {
    const onFocus = (e: Event) => {
      const seed = (e as CustomEvent<{ seed?: string }>).detail?.seed;
      if (seed) setInput(seed);
      inputRef.current?.focus();
    };
    window.addEventListener("copilot:focus", onFocus);
    return () => window.removeEventListener("copilot:focus", onFocus);
  }, []);

  // Suggestion chips from the current page observation, or generic fallback
  const chips = useMemo(
    () => observation.suggestions ?? ["Summarise what's on this page", "What should I do next?"],
    [observation.suggestions],
  );

  const handleNewChat = () => {
    setMessages([]);
    setStreamingMessage("");
    contextInjected.current = false;
    setInput("");
  };

  const handleSend = async (raw: string) => {
    const userMessage = (raw ?? input).trim();
    if (!userMessage || isStreaming) return;

    // Build the context-enriched first message if this is a fresh session
    const needsContext = !contextInjected.current && !!observation.summary;
    const payload = needsContext
      ? `You are the user's right-rail data Copilot. They are looking at: **${observation.label}** (${observation.kind}).\n\n[CONTEXT — current view]\n${observation.summary}\n\nUse this context if the question is directly answered here. If the user asks about data not shown (rankings, top N, totals, trends, comparisons), call execute_dataset_query with the relevant dataset to retrieve real results — do NOT say the dashboard doesn't show it.\n\n[USER]\n${userMessage}`
      : userMessage;
    contextInjected.current = true;

    setInput("");

    // Append the raw user message to local history (show original text, not the enriched payload)
    const updatedMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(updatedMessages);

    // Build the history to send — use payload for the last message (has context prepended if needed)
    const apiMessages: Message[] = [
      ...updatedMessages.slice(0, -1),
      { role: "user", content: payload },
    ];

    setIsStreaming(true);
    setStreamingMessage("");

    try {
      const response = await fetch("/api/openai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          ...(observation.workspaceId ? { workspaceId: observation.workspaceId } : {}),
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.error) {
                  fullResponse = `_${data.error}_`;
                  setStreamingMessage(fullResponse);
                } else if (data.status === "querying_database") {
                  setIsQuerying(true);
                } else if (data.content) {
                  setIsQuerying(false);
                  fullResponse += data.content;
                  setStreamingMessage(fullResponse);
                } else if (data.finalText) {
                  // Server sent the complete normalized response — use it as the definitive text
                  fullResponse = data.finalText;
                }
              } catch {}
            }
          }
        }
      }

      setMessages((prev) => [...prev, { role: "assistant", content: fullResponse }]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Chat failed";
      setMessages((prev) => [...prev, { role: "assistant", content: `_Error: ${msg}_` }]);
    } finally {
      setIsStreaming(false);
      setStreamingMessage("");
      setIsQuerying(false);
    }
  };

  const renderMessageContent = (content: string, isStreaming = false) => {
    const { cleanText } = parseLayoutActions(content);
    const raw = cleanText || content;

    const { text, charts } = parseCharts(raw);

    // Strip NAVIGATE tokens from display text, capture for button
    const navMatch = text.match(/\[NAVIGATE:(.*?)\]/);
    const cleanedText = text.replace(/\[NAVIGATE:.*?\]/g, "").trim();

    // Normalize inline bullets on every render (streaming + final).
    // Server also sends a normalised finalText event for the complete message.
    const normalizedText = normalizeMarkdown(cleanedText);

    return (
      <div className="space-y-2">
        <MarkdownText content={normalizedText} />
        {charts.map((chart, i) => (
          <InlineChart key={i} chartData={chart} />
        ))}
        {navMatch && !isStreaming && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-1 bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary text-xs"
            onClick={() => setLocation(navMatch[1])}
          >
            View Dashboard <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        )}
        {isStreaming && (
          <span className="animate-pulse ml-1 text-muted-foreground">...</span>
        )}
      </div>
    );
  };

  return (
    <aside className="w-80 md:w-96 border-l border-border bg-card flex flex-col animate-in slide-in-from-right duration-300 shadow-xl z-20 absolute right-0 top-0 h-full md:relative">
      {/* Header */}
      <div className="p-3 border-b border-border flex justify-between items-center bg-muted/20">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <BrainCircuit className="h-4 w-4 text-primary" />
          BI Companion
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={handleNewChat} title="Start a new chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-7 w-7 md:hidden"
            onClick={onClose}
          >
            &times;
          </Button>
        </div>
      </div>

      {/* Observing pill */}
      <div
        className="px-3 py-2 border-b border-border bg-primary/5 flex items-center gap-2 text-[11px]"
        data-testid="chat-observation-pill"
      >
        <Eye className="h-3 w-3 text-primary flex-shrink-0" />
        <span className="text-muted-foreground">Observing</span>
        <span className="font-medium text-foreground truncate">{observation.label}</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {messages.length === 0 && !isStreaming && (
            <>
              <div className="bg-muted/50 p-3 rounded-lg text-sm rounded-tl-none self-start mr-8 leading-relaxed">
                <div className="flex items-center gap-1.5 text-primary text-[10px] font-semibold uppercase tracking-wider mb-1">
                  <Sparkles className="h-3 w-3" /> Watching this view
                </div>
                I can see{" "}
                <span className="font-medium text-foreground">{observation.label}</span>.
                Ask me anything about it, or pick one of these to start:
              </div>
              <div className="space-y-1.5 pl-1">
                {chips.map((c) => (
                  <button
                    key={c}
                    onClick={() => handleSend(c)}
                    disabled={isStreaming}
                    className="w-full text-left text-[12px] text-foreground bg-background hover:bg-muted/60 border border-border rounded-md px-2.5 py-2 transition-colors disabled:opacity-50"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={cn(
                "p-3 rounded-lg text-sm max-w-[90%]",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-none self-end ml-auto"
                  : "bg-muted rounded-tl-none self-start mr-auto",
              )}
            >
              {msg.role === "user" ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                renderMessageContent(msg.content)
              )}
            </div>
          ))}

          {isStreaming && streamingMessage && (
            <div className="bg-muted p-3 rounded-lg text-sm rounded-tl-none self-start mr-auto max-w-[90%]">
              {renderMessageContent(streamingMessage, true)}
            </div>
          )}

          {isStreaming && !streamingMessage && (
            <div className="bg-muted p-3 rounded-lg text-sm rounded-tl-none self-start flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground text-xs">
                {isQuerying ? "Querying your data…" : "Thinking…"}
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border bg-card">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
          className="relative flex items-center"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming}
            placeholder={isStreaming ? "Thinking…" : `Ask about ${observation.label}…`}
            className="w-full bg-muted border-none text-sm py-2 pl-3 pr-10 rounded-md focus:ring-1 focus:ring-primary outline-none disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            className="absolute right-1 h-7 w-7 text-muted-foreground hover:text-primary"
            disabled={!input.trim() || isStreaming}
          >
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </aside>
  );
}
