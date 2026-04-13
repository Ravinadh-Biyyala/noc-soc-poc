import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  TrendingUp,
  Package,
  RefreshCw,
  ShieldAlert,
  MessageSquare,
  Plus,
  Bot,
  User,
  Send,
  ChevronRight,
  BrainCircuit,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useListOpenaiConversations,
  useCreateOpenaiConversation,
  useListOpenaiMessages,
  getListOpenaiConversationsQueryKey,
  getListOpenaiMessagesQueryKey
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback } from "./ui/avatar";

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
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2 text-primary font-semibold text-lg tracking-tight">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/30 shadow-[0_0_10px_rgba(20,184,166,0.2)]">
              <ShieldAlert className="w-5 h-5 text-primary" />
            </div>
            INVEX USA
          </div>
        </div>
        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-3">
            Command Center
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all cursor-pointer group",
                    isActive
                      ? "bg-sidebar-accent text-primary font-medium border-l-2 border-primary shadow-[inset_2px_0_0_rgba(20,184,166,1)]"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-foreground border-l-2 border-transparent"
                  )}
                >
                  <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border text-xs text-muted-foreground">
          &copy; 2024 INVEX Brokerage
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 flex items-center justify-between px-8 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10 sticky top-0">
          <h1 className="text-xl font-semibold tracking-tight text-white">
            {navItems.find((i) => i.href === location)?.label || "Dashboard"}
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
              </span>
              <span className="text-sm text-muted-foreground font-medium">System Active</span>
            </div>
            <div className="h-6 w-px bg-border mx-2"></div>
            <Avatar className="h-8 w-8 border border-border">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">BK</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8 scroll-smooth bg-background">
          {children}
        </div>
      </main>

      {/* Right Sidebar - Chatbot */}
      <aside className="w-[380px] flex-shrink-0 border-l border-border bg-card flex flex-col shadow-[-4px_0_24px_-8px_rgba(0,0,0,0.5)]">
        <ChatPanel />
      </aside>
    </div>
  );
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

    // Optimistically update UI could go here, but for simplicity we rely on refetch later
    
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
    // Basic bold parsing
    let parsed = content.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>');
    
    // Navigation parsing
    const navMatch = content.match(/\[NAVIGATE:(.*?)\]/);
    if (navMatch) {
      const route = navMatch[1];
      parsed = parsed.replace(/\[NAVIGATE:.*?\]/, '');
      return (
        <div className="space-y-2">
          <div dangerouslySetInnerHTML={{ __html: parsed }} />
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full mt-2 bg-primary/10 hover:bg-primary/20 border-primary/20 text-primary hover:text-primary transition-all"
            onClick={() => setLocation(route)}
          >
            View Dashboard <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      );
    }
    
    const createMatch = content.match(/\[CREATE_DASHBOARD:(.*?)\]/);
    if (createMatch) {
      const title = createMatch[1];
      parsed = parsed.replace(/\[CREATE_DASHBOARD:.*?\]/, '');
      return (
        <div className="space-y-2">
          <div dangerouslySetInnerHTML={{ __html: parsed }} />
          <div className="bg-background/50 border border-border rounded-md p-3 mt-2">
            <p className="text-sm mb-2 font-medium text-white">New dashboard created: {title}. Add to sidebar?</p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90">Yes</Button>
              <Button size="sm" variant="outline" className="flex-1 bg-transparent border-border hover:bg-muted text-foreground">No</Button>
            </div>
          </div>
        </div>
      );
    }
    
    return <div dangerouslySetInnerHTML={{ __html: parsed }} className="leading-relaxed" />;
  };

  return (
    <>
      <div className="h-16 flex items-center justify-between px-5 border-b border-border bg-sidebar/50">
        <div className="flex items-center gap-2 font-semibold text-white tracking-tight">
          <BrainCircuit className="w-5 h-5 text-primary" />
          Broker Copilot
        </div>
        <Button variant="ghost" size="icon" onClick={handleNewChat} className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-card/50" ref={scrollRef}>
        {messages.length === 0 && !isTyping && !streamingMessage && (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-4 px-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shadow-[0_0_20px_rgba(20,184,166,0.15)]">
              <BrainCircuit className="w-7 h-7 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-white mb-1">How can I help you today?</p>
              <p className="text-sm text-muted-foreground/80 leading-relaxed max-w-[250px]">Ask me about premium trends, producer performance, or risk analytics.</p>
            </div>
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex flex-col max-w-[85%]", msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start")}>
            <div className="flex items-center gap-2 mb-1.5 px-1">
              {msg.role === 'user' ? (
                <span className="text-xs font-semibold text-muted-foreground">You</span>
              ) : (
                <>
                  <Bot className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold text-primary">Copilot</span>
                </>
              )}
            </div>
            <div 
              className={cn(
                "rounded-xl px-4 py-3 text-sm shadow-md",
                msg.role === 'user' 
                  ? "bg-blue-600 text-white rounded-tr-sm" 
                  : "bg-sidebar border border-border text-foreground rounded-tl-sm shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
              )}
            >
              {renderContent(msg.content)}
            </div>
          </div>
        ))}
        
        {(streamingMessage || isTyping) && (
          <div className="flex flex-col max-w-[85%] mr-auto items-start">
            <div className="flex items-center gap-2 mb-1.5 px-1">
              <Bot className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary">Copilot</span>
            </div>
            <div className="rounded-xl px-4 py-3 text-sm shadow-md bg-sidebar border border-border text-foreground rounded-tl-sm shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
              {isTyping ? (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span className="text-muted-foreground animate-pulse font-medium">Analyzing data...</span>
                </div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: streamingMessage.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>') }} className="leading-relaxed" />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-5 border-t border-border bg-sidebar/80 backdrop-blur-sm">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="relative flex items-center"
        >
          <Input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Copilot..."
            className="pr-12 bg-background/80 border-border focus-visible:ring-primary h-11 rounded-lg shadow-inner text-white placeholder:text-muted-foreground/70"
            disabled={isTyping}
          />
          <Button 
            type="submit" 
            size="icon" 
            variant="ghost" 
            className="absolute right-1.5 h-8 w-8 text-primary hover:text-primary hover:bg-primary/20 transition-all"
            disabled={!input.trim() || isTyping}
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </>
  );
}
