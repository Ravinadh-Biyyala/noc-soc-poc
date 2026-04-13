import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  TrendingUp,
  Package,
  RefreshCw,
  ShieldAlert,
  Plus,
  Bot,
  Send,
  ChevronRight,
  BrainCircuit,
  Loader2
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
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

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  
  const navItems = [
    { href: "/", label: "Executive Summary", icon: LayoutDashboard },
    { href: "/sales", label: "Sales Performance", icon: TrendingUp },
    { href: "/products", label: "Product Analytics", icon: Package },
    { href: "/renewals", label: "Renewals & Retention", icon: RefreshCw },
    { href: "/claims", label: "Claims & Risk", icon: ShieldAlert },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside className="w-60 flex-shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 text-white font-bold text-base tracking-tight">
            <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-sidebar-primary" />
            </div>
            INVEX USA
          </div>
        </div>
        <nav className="flex-1 py-4 px-2.5 space-y-0.5 overflow-y-auto">
          <div className="text-[10px] font-semibold text-sidebar-foreground/50 uppercase tracking-[0.1em] mb-3 px-2.5">
            Dashboards
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-all cursor-pointer",
                    isActive
                      ? "bg-sidebar-accent text-white font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white"
                  )}
                >
                  <item.icon className={cn("w-4 h-4", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50")} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border text-[10px] text-sidebar-foreground/40">
          INVEX Insurance USA 2026
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-white z-10 sticky top-0">
          <h1 className="text-base font-semibold text-foreground">
            {navItems.find((i) => i.href === location)?.label || "Dashboard"}
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
      <p className="text-[11px] font-semibold text-foreground mb-2">{title}</p>
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [_, setLocation] = useLocation();
  const queryClient = useQueryClient();

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

  const handleSend = async () => {
    if (!input.trim() || !activeConvId) return;
    
    const userMsg = input.trim();
    setInput("");
    setIsTyping(true);
    setStreamingMessage("");
    
    try {
      const base = import.meta.env.BASE_URL || '/';
      const response = await fetch(`${base}api/openai/conversations/${activeConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMsg }),
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
      const route = navMatch[1];
      processed = processed.replace(/\[NAVIGATE:.*?\]/g, '');
    }
    
    const createMatch = text.match(/\[CREATE_DASHBOARD:(.*?)\]/);
    if (createMatch) {
      const title = createMatch[1];
      processed = processed.replace(/\[CREATE_DASHBOARD:.*?\]/g, '');
    }

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
        {createMatch && (
          <div className="bg-muted border border-border rounded-lg p-3 mt-1">
            <p className="text-xs mb-2 font-medium text-foreground">New dashboard: {createMatch[1]}. Add to sidebar?</p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 text-xs">Yes</Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs">No</Button>
            </div>
          </div>
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
          Broker Copilot
          <span className="text-[9px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Gen-BI</span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleNewChat} className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-muted/30" ref={scrollRef}>
        {messages.length === 0 && !isTyping && !streamingMessage && (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-3 px-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <BrainCircuit className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground mb-0.5 text-sm">Generative BI</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px]">Ask any data question and get instant visualizations. Try "Compare top states" or "Show cyber premium trend".</p>
            </div>
            <div className="grid grid-cols-1 gap-1.5 w-full max-w-[260px] mt-2">
              {["Compare top 5 states by premium", "Show premium trend 2022-2026", "What's the policy mix breakdown?"].map((q) => (
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
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="relative flex items-center"
        >
          <Input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about your data..."
            className="pr-10 bg-muted/50 border-border focus-visible:ring-primary h-9 rounded-lg text-sm placeholder:text-muted-foreground/60"
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
