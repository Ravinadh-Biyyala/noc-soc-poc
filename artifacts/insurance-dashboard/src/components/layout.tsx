import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  FileText, 
  ShieldCheck, 
  BrainCircuit, 
  MessageSquare, 
  BarChart3, 
  Users, 
  DollarSign,
  MessageCircle
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Chat } from "./chat";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/claims", label: "Claims Analysis", icon: FileText },
  { href: "/policies", label: "Policy Analytics", icon: ShieldCheck },
  { href: "/predictive", label: "Predictive Insights", icon: BrainCircuit },
  { href: "/sentiment", label: "Sentiment", icon: MessageSquare },
  { href: "/eda", label: "Data Explorer", icon: BarChart3 },
  { href: "/brokers", label: "Broker Teams", icon: Users },
  { href: "/revenue", label: "Revenue", icon: DollarSign },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isChatOpen, setIsChatOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col hidden md:flex">
        <div className="p-4 border-b border-sidebar-border flex items-center gap-2">
          <div className="h-8 w-8 bg-sidebar-primary rounded-md flex items-center justify-center text-sidebar-primary-foreground font-bold">
            IB
          </div>
          <span className="font-semibold text-sidebar-foreground">InsureBroker</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto flex flex-col">
        <header className="h-14 border-b border-border flex items-center justify-between px-4 lg:px-8 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2 md:hidden">
             {/* Mobile menu trigger could go here */}
          </div>
          <h1 className="font-semibold text-lg capitalize">
            {navItems.find(i => i.href === location)?.label || "Dashboard"}
          </h1>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsChatOpen(!isChatOpen)}
            className={cn("gap-2 transition-all", isChatOpen && "bg-primary text-primary-foreground border-primary")}
          >
            <MessageCircle className="h-4 w-4" />
            AI Assistant
          </Button>
        </header>
        <div className="p-4 lg:p-8 flex-1">
          {children}
        </div>
      </main>

      {/* AI Chatbot Panel */}
      {isChatOpen && <Chat onClose={() => setIsChatOpen(false)} />}
    </div>
  );
}