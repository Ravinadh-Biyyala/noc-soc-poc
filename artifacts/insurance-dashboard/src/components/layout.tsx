import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Bot,
  Send,
  ChevronRight,
  ChevronDown,
  BrainCircuit,
  Loader2,
  Sparkles as SparklesNav,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useCopilot } from "@/lib/copilot-context";
import { useTenantConfig, resolveIcon } from "@/lib/tenant-config";
import { useGeneratedDashboards } from "@/lib/generated-dashboards";
import { useChatObserver } from "@/lib/chat-observer";
import { Eye, AlertTriangle, Info, AlertOctagon, Check, XCircle } from "lucide-react";
import { NAV } from "@/lib/nav-config";
import { useActiveWorkspace } from "@/lib/active-workspace";
import {
  useListOpenaiConversations,
  useCreateOpenaiConversation,
  useListOpenaiMessages,
  getListOpenaiConversationsQueryKey,
  getListOpenaiMessagesQueryKey
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

function pageTitle(location: string): string {
  // Quick lookups so the header reads sensibly on every route.
  if (location === "/") return "Home";
  if (location === "/workspaces") return "Workspaces";
  if (location.startsWith("/workspaces/")) return "Workspace";
  if (location === "/upload") return "Upload Data";
  if (location === "/settings") return "Settings";
  if (location === "/governance") return "Governance";
  if (location === "/dashboards") return "Dashboards";
  if (location.startsWith("/dashboards/")) return "Dashboard";
  return "Dashboard";
}

function SidebarNav() {
  const [location] = useLocation();
  const { config } = useTenantConfig();
  // Built-in tenant sections render as nested quick-links under Dashboards
  // so the user can still jump straight to e.g. Claims or Sales without
  // a separate top-level entry.
  const sectionItems = (config?.sections || []).map((s) => ({
    id: s.id,
    label: s.label,
    href: s.route === "/" ? `/dashboards/${s.id}` : s.route,
    icon: resolveIcon(s.icon),
  }));

  return (
    <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
      {NAV.map((item) => {
        const isActive = item.matchPrefix
          ? location === item.href || location.startsWith(item.matchPrefix + "/")
          : location === item.href;
        const showDashboardSections =
          item.href === "/dashboards" &&
          (location === "/dashboards" ||
            location.startsWith("/dashboards/") ||
            sectionItems.some((s) => s.href === location)) &&
          sectionItems.length > 0;
        return (
          <div key={item.href}>
            <Link href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-all cursor-pointer",
                  isActive
                    ? "bg-sidebar-accent text-white font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white",
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50")} />
                {item.label}
              </div>
            </Link>
            {showDashboardSections && (
              <div className="ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border/50 pl-2">
                {sectionItems.map((sec) => {
                  const SecIcon = sec.icon;
                  const secActive = location === sec.href;
                  return (
                    <Link key={sec.id} href={sec.href}>
                      <div
                        className={cn(
                          "flex items-center gap-2 px-2 py-1 rounded-md text-[11.5px] transition-all cursor-pointer",
                          secActive
                            ? "bg-sidebar-accent text-white font-medium"
                            : "text-sidebar-foreground/55 hover:bg-sidebar-accent/40 hover:text-white",
                        )}
                        data-testid={`nav-section-${sec.id}`}
                      >
                        <SecIcon className={cn("w-3 h-3", secActive ? "text-sidebar-primary" : "text-sidebar-foreground/40")} />
                        {sec.label}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { config } = useTenantConfig();
  const { workspace } = useActiveWorkspace();
  const brandName = config?.branding?.name || "Gen-BI";
  const headerTitle = workspace?.name && location.startsWith("/workspaces/") ? workspace.name : pageTitle(location);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside className="w-60 flex-shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-sidebar-border">
          <Link href="/">
            <div className="flex items-center gap-2.5 text-white font-bold text-base tracking-tight cursor-pointer">
              <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center">
                <SparklesNav className="w-4 h-4 text-sidebar-primary" />
              </div>
              {brandName}
            </div>
          </Link>
        </div>
        <SidebarNav />
        <div className="p-3 border-t border-sidebar-border text-[10px] text-sidebar-foreground/40">
          {brandName} {new Date().getFullYear()}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-white z-10 sticky top-0">
          <h1 className="text-base font-semibold text-foreground" data-testid="page-title">
            {headerTitle}
          </h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
            <div className="h-5 w-px bg-border"></div>
            <Avatar className="h-7 w-7 border border-border">
              <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">BK</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6 bg-background scroll-smooth">
          {children}
        </div>
      </main>

      <aside className="w-[380px] flex-shrink-0 border-l border-border bg-white flex flex-col">
        <ChatPanel />
      </aside>
    </div>
  );
}

const CHART_COLORS = ["#1565C0", "#0288D1", "#0097A7", "#00838F", "#00695C", "#6366f1", "#8b5cf6"];

function InlineChart({ chartData }: { chartData: { type: string; title: string; xKey: string; yKey: string; data: any[] } }) {
  const { type, title, xKey, yKey, data } = chartData;

  const formatValue = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    if (val < 1 && val > 0) return `${(val * 100).toFixed(1)}%`;
    return val.toLocaleString();
  };

  return (
    <div className="mt-2 mb-1 bg-muted/40 rounded-lg border border-border p-3">
      <div className="mb-2">
        <p className="text-[11px] font-semibold text-foreground">{title}</p>
      </div>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'pie' ? (
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={35} outerRadius={65} paddingAngle={2} dataKey={yKey} nameKey={xKey}>
                {data.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [formatValue(v)]} />
            </PieChart>
          ) : type === 'bar' ? (
            <BarChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
              <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="#6b7280" />
              <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [formatValue(v)]} />
              <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
                {data.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          ) : type === 'line' ? (
            <LineChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
              <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="#6b7280" />
              <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [formatValue(v)]} />
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
              <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="#6b7280" />
              <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [formatValue(v)]} />
              <Area type="monotone" dataKey={yKey} stroke={CHART_COLORS[1]} strokeWidth={2} fillOpacity={1} fill="url(#chatAreaGrad)" />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      {type === 'pie' && (
        <div className="grid grid-cols-2 gap-1 mt-2">
          {data.slice(0, 6).map((item: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-[9px]">
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="text-muted-foreground truncate">{item[xKey]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function parseCharts(content: string): { text: string; charts: any[] } {
  const charts: any[] = [];
  let text = content;

  const marker = '[CHART:';
  let startIdx = text.indexOf(marker);
  while (startIdx !== -1) {
    const jsonStart = startIdx + marker.length;
    let depth = 0;
    let endIdx = jsonStart;
    for (let i = jsonStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
    const closeBracket = text.indexOf(']', endIdx);
    const fullMatch = text.substring(startIdx, closeBracket !== -1 ? closeBracket + 1 : endIdx);
    const jsonStr = text.substring(jsonStart, endIdx);

    try {
      const chartJson = JSON.parse(jsonStr);
      charts.push(chartJson);
    } catch (e) {}

    text = text.replace(fullMatch, '');
    startIdx = text.indexOf(marker);
  }

  return { text: text.trim(), charts };
}

function ChatPanel() {
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streamingMessage, setStreamingMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [highlightInput, setHighlightInput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [_, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { registerHandler } = useCopilot();
  const pendingQuestionRef = useRef<string | null>(null);
  const { config } = useTenantConfig();
  const { pack } = useActiveWorkspace();
  const { observation, agentSuggestions, dismissAgentSuggestion } = useChatObserver();
  // Conversations into which we've already injected the page-context block
  // (so we don't re-pay the prompt cost on every turn). Cleared when the
  // observation label changes — next message in the same conversation will
  // re-seed against the new view.
  const seededConvIds = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (activeConvId != null) seededConvIds.current.delete(activeConvId);
  }, [observation.label, activeConvId]);

  // Listen for the global "copilot:focus" event (dispatched, for example,
  // by the Home "Ask Gen-BI" quick action) and visibly bring the chat
  // input into focus with a brief highlight ring so the user has clear
  // feedback that the Copilot is ready.
  useEffect(() => {
    const onFocus = (ev: Event) => {
      const el = inputRef.current;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        el.focus({ preventScroll: false });
      }
      // If the dispatcher passed a seed prompt (e.g. the chat-first hero on
      // Home), prefill the input so the user can review/edit before sending.
      const detail = (ev as CustomEvent).detail as { seed?: string } | undefined;
      const seed = detail?.seed?.trim();
      if (seed) setInput(seed);
      setHighlightInput(true);
      window.setTimeout(() => setHighlightInput(false), 1400);
    };
    window.addEventListener("copilot:focus", onFocus);
    return () => window.removeEventListener("copilot:focus", onFocus);
  }, []);

  // When the user is inside a workspace, prefer that workspace's pack copy.
  // Falls back to the global tenant config (legacy insurance content) and
  // finally to safe generic prompts.
  const copilotName =
    pack?.copilotName || config?.branding?.copilotName || "Gen-BI Copilot";
  // Page-aware suggestions take precedence over pack defaults — when a
  // page (e.g. a generated dashboard) registers its own chips via
  // useRegisterObservation, the Copilot reflects what the user is actually
  // looking at instead of generic "Show top 10 records" prompts.
  const suggestedPrompts =
    observation.suggestions?.slice(0, 4) ||
    pack?.suggestedPrompts.slice(0, 3) ||
    config?.suggestedPrompts?.slice(0, 3) || [
      "Summarize what's on this page",
      "What should I do next?",
      "Show me the most interesting metric",
    ];

  const { data: conversations } = useListOpenaiConversations();
  const createConv = useCreateOpenaiConversation();
  
  const { data: messages = [] } = useListOpenaiMessages(activeConvId || 0, { 
    query: { enabled: !!activeConvId, queryKey: getListOpenaiMessagesQueryKey(activeConvId || 0) } 
  });

  useEffect(() => {
    if (conversations?.length && !activeConvId) {
      setActiveConvId(conversations[0].id);
    } else if (conversations?.length === 0 && !activeConvId) {
      createConv.mutate({ data: { title: "New Conversation" } }, {
        onSuccess: (conv) => {
          setActiveConvId(conv.id);
          queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        }
      });
    }
  }, [conversations, activeConvId, createConv, queryClient]);

  useEffect(() => {
    registerHandler((question: string) => {
      if (activeConvId && !isTyping) {
        setInput(question);
        pendingQuestionRef.current = question;
      }
    });
  }, [registerHandler, activeConvId, isTyping]);

  useEffect(() => {
    if (pendingQuestionRef.current && input === pendingQuestionRef.current && activeConvId && !isTyping) {
      pendingQuestionRef.current = null;
      handleSendMessage(input);
    }
  }, [input, activeConvId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingMessage, isTyping]);

  const handleNewChat = () => {
    createConv.mutate({ data: { title: "New Conversation" } }, {
      onSuccess: (conv) => {
        setActiveConvId(conv.id);
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
      }
    });
  };

  const handleSendMessage = async (messageOverride?: string) => {
    const msg = messageOverride || input;
    if (!msg.trim() || !activeConvId) return;
    
    const userMsg = msg.trim();
    setInput("");
    setIsTyping(true);
    setStreamingMessage("");

    // Inject the current observation as ground truth on the FIRST send of
    // each conversation (or after the user navigates to a different view).
    // The model carries it forward through the thread so we don't pay the
    // token cost again until the observation actually changes.
    const needsContext = observation.summary && !seededConvIds.current.has(activeConvId);
    const payload = needsContext
      ? `You are the user's right-rail data Copilot. They are currently looking at: **${observation.label}** (${observation.kind}).\n\n[CONTEXT — what's on screen]\n${observation.summary}\n\nAnswer with that view in mind. If they ask about something off-screen, say so plainly and offer where to look.\n\n[USER]\n${userMsg}`
      : userMsg;
    seededConvIds.current.add(activeConvId);

    try {
      const base = import.meta.env.BASE_URL || '/';
      const response = await fetch(`${base}api/openai/conversations/${activeConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload }),
      });

      if (!response.ok) throw new Error("Failed to send message");
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      setIsTyping(false);
      
      let done = false;
      
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.done) continue;
                if (parsed.error) continue;
                if (parsed.content) {
                  setStreamingMessage(prev => prev + parsed.content);
                }
              } catch (e) {}
            }
          }
        }
      }
      
      queryClient.invalidateQueries({ queryKey: getListOpenaiMessagesQueryKey(activeConvId) });
      setStreamingMessage("");
      
    } catch (e) {
      console.error(e);
      setIsTyping(false);
    }
  };

  const renderContent = (content: string) => {
    const { text, charts } = parseCharts(content);
    let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>');
    
    const navMatch = text.match(/\[NAVIGATE:(.*?)\]/);
    if (navMatch) {
      processed = processed.replace(/\[NAVIGATE:.*?\]/g, '');
    }
    
    processed = processed.replace(/\[CREATE_DASHBOARD:.*?\]/g, '');

    return (
      <div className="space-y-2">
        <div dangerouslySetInnerHTML={{ __html: processed.trim() }} className="leading-relaxed" />
        {charts.map((chart, i) => (
          <InlineChart key={i} chartData={chart} />
        ))}
        {navMatch && (
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full mt-1 bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary hover:text-primary transition-all text-xs"
            onClick={() => setLocation(navMatch[1])}
          >
            View Dashboard <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        )}
      </div>
    );
  };

  const renderStreamingContent = (content: string) => {
    const { text, charts } = parseCharts(content);
    let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>');
    processed = processed.replace(/\[NAVIGATE:.*?\]/g, '').replace(/\[CREATE_DASHBOARD:.*?\]/g, '');
    
    return (
      <div className="space-y-2">
        <div dangerouslySetInnerHTML={{ __html: processed.trim() }} className="leading-relaxed" />
        {charts.map((chart, i) => (
          <InlineChart key={i} chartData={chart} />
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
          <BrainCircuit className="w-4 h-4 text-primary" />
          {copilotName}
          <span className="text-[9px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Gen-BI</span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleNewChat} className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Live "what I'm looking at" pill — proves the Copilot is page-aware
          on every screen, not just a generic global chat. */}
      <div className="px-3 py-1.5 border-b border-border bg-primary/5 flex items-center gap-1.5 text-[11px]" data-testid="copilot-observation-pill">
        <Eye className="w-3 h-3 text-primary flex-shrink-0" />
        <span className="text-muted-foreground">Observing</span>
        <span className="font-medium text-foreground truncate flex-1 min-w-0">{observation.label}</span>
      </div>

      {/* Proactive agent suggestions — replaces the dead "Cleaning" /
          "Joins" nav pages. When the data-quality engine flags something
          on upload, it lands here as an actionable card. */}
      {agentSuggestions.length > 0 && (
        <div className="px-2 py-2 border-b border-border bg-amber-50/40 space-y-1.5" data-testid="agent-suggestions-tray">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Agent suggestions ({agentSuggestions.length})
          </p>
          {agentSuggestions.map((s) => {
            const SevIcon = s.severity === "critical" ? AlertOctagon : s.severity === "warn" ? AlertTriangle : Info;
            const tone =
              s.severity === "critical"
                ? "border-red-200 bg-red-50"
                : s.severity === "warn"
                ? "border-amber-200 bg-amber-50"
                : "border-blue-200 bg-blue-50";
            const iconTone =
              s.severity === "critical" ? "text-red-600" : s.severity === "warn" ? "text-amber-600" : "text-blue-600";
            return (
              <div
                key={s.id}
                className={cn("rounded-md border p-2 text-[11px] space-y-1.5", tone)}
                data-testid={`agent-suggestion-${s.id}`}
              >
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
                      onClick={() => {
                        s.onApply?.();
                        dismissAgentSuggestion(s.id);
                      }}
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

      <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-muted/30" ref={scrollRef}>
        {messages.length === 0 && !isTyping && !streamingMessage && (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-3 px-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <BrainCircuit className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5 text-sm">Watching {observation.label}</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px]">
                {observation.summary
                  ? `I can see what's on screen — ask me anything about it, or pick a starter:`
                  : `Ask any data question and get instant visualizations.`}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-1.5 w-full max-w-[260px] mt-2">
              {suggestedPrompts.map((q) => (
                <button
                  key={q}
                  className="text-left text-[11px] px-3 py-2 rounded-md border border-border bg-white hover:bg-primary/5 hover:border-primary/30 text-muted-foreground hover:text-foreground transition-all"
                  onClick={() => { setInput(q); }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex flex-col max-w-[92%]", msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start")}>
            <div className="flex items-center gap-1.5 mb-1 px-0.5">
              {msg.role === 'user' ? (
                <span className="text-[10px] font-medium text-muted-foreground">You</span>
              ) : (
                <>
                  <Bot className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-medium text-primary">Copilot</span>
                </>
              )}
            </div>
            <div 
              className={cn(
                "rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed",
                msg.role === 'user' 
                  ? "bg-primary text-white rounded-tr-sm" 
                  : "bg-white border border-border text-foreground rounded-tl-sm shadow-sm"
              )}
            >
              {msg.role === 'user' ? msg.content : renderContent(msg.content)}
            </div>
          </div>
        ))}
        
        {(streamingMessage || isTyping) && (
          <div className="flex flex-col max-w-[92%] mr-auto items-start">
            <div className="flex items-center gap-1.5 mb-1 px-0.5">
              <Bot className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-medium text-primary">Copilot</span>
            </div>
            <div className="rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed bg-white border border-border text-foreground rounded-tl-sm shadow-sm">
              {isTyping ? (
                <div className="flex items-center gap-2 py-0.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span className="text-muted-foreground text-xs animate-pulse">Generating insights...</span>
                </div>
              ) : (
                renderStreamingContent(streamingMessage)
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border bg-white">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
          className="relative flex items-center"
        >
          <Input
            ref={inputRef}
            data-testid="copilot-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about your data..."
            className={cn(
              "pr-10 bg-muted/50 border-border focus-visible:ring-primary h-9 rounded-lg text-sm placeholder:text-muted-foreground/60 transition-shadow",
              highlightInput && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md",
            )}
            disabled={isTyping}
          />
          <Button 
            type="submit" 
            size="icon" 
            variant="ghost" 
            className="absolute right-1 h-7 w-7 text-primary hover:text-primary hover:bg-primary/10 transition-all"
            disabled={!input.trim() || isTyping}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>
    </>
  );
}
