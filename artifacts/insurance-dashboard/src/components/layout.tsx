import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Sparkles as SparklesNav, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "@/lib/nav-config";
import { Avatar, AvatarFallback } from "./ui/avatar";
import CopilotPanel from "./CopilotPanel";

const BRAND_NAME = "Gen VI";

function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const [location] = useLocation();

  return (
    <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
      {NAV.map((item) => {
        const isActive = item.matchPrefix
          ? location === item.href || location.startsWith(item.matchPrefix + "/")
          : location === item.href;
        return (
          <Link key={item.href} href={item.href}>
            <div
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md text-[11px] transition-all cursor-pointer",
                collapsed ? "justify-center px-2 py-1.5" : "px-2 py-1.5",
                isActive
                  ? "bg-sidebar-accent text-white font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white",
              )}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon className={cn("w-3.5 h-3.5 flex-shrink-0", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50")} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

const SIDEBAR_COLLAPSED_KEY = "geva-sidebar-collapsed";

export default function Layout({ children }: { children: React.ReactNode }) {
  const brandName = BRAND_NAME;
  const headerTitle = "Loki Logs";

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside
        className={cn(
          "flex-shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col transition-[width] duration-200 ease-out",
          sidebarCollapsed ? "w-12" : "w-44",
        )}
      >
        <div
          className={cn(
            "h-14 flex items-center border-b border-sidebar-border",
            sidebarCollapsed ? "justify-center px-2" : "justify-between px-3",
          )}
        >
          {!sidebarCollapsed && (
            <Link href="/">
              <div className="flex items-center gap-2 text-white font-bold text-sm tracking-tight cursor-pointer">
                <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center">
                  <SparklesNav className="w-3.5 h-3.5 text-sidebar-primary" />
                </div>
                {brandName}
              </div>
            </Link>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="w-8 h-8 rounded-md flex items-center justify-center text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent/50 transition-colors"
            data-testid="sidebar-toggle"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
        <SidebarNav collapsed={sidebarCollapsed} />
        {!sidebarCollapsed && (
          <div className="p-3 border-t border-sidebar-border text-[10px] text-sidebar-foreground/40">
            {brandName} {new Date().getFullYear()}
          </div>
        )}
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-card z-10 sticky top-0">
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

      <aside className="w-[380px] flex-shrink-0 border-l border-border bg-card flex flex-col">
        <CopilotPanel />
      </aside>
    </div>
  );
}

