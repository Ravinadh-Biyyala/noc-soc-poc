import { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface CustomChart {
  id: string;
  type: string;
  title: string;
  xKey: string;
  yKey: string;
  data: any[];
  section: string;
  sectionLabel: string;
  addedAt: number;
}

export interface CustomSidebarEntry {
  id: string;
  title: string;
  route: string;
  addedAt: number;
}

interface CustomDashboardsContextType {
  charts: CustomChart[];
  addChart: (chart: Omit<CustomChart, "id" | "addedAt">) => void;
  removeChart: (id: string) => void;
  getChartsForSection: (section: string) => CustomChart[];
  sidebarEntries: CustomSidebarEntry[];
  addSidebarEntry: (title: string) => CustomSidebarEntry;
  removeSidebarEntry: (id: string) => void;
}

const CustomDashboardsContext = createContext<CustomDashboardsContextType>({
  charts: [],
  addChart: () => {},
  removeChart: () => {},
  getChartsForSection: () => [],
  sidebarEntries: [],
  addSidebarEntry: () => ({ id: "", title: "", route: "", addedAt: 0 }),
  removeSidebarEntry: () => {},
});

const STORAGE_KEY = "invex-custom-dashboards";
const SIDEBAR_STORAGE_KEY = "invex-custom-sidebar";

const SECTION_KEYWORDS: Record<string, string[]> = {
  "/": ["premium", "gwp", "written", "commission", "state", "states", "geographic", "growth", "yoy", "book", "overview", "executive", "total", "performance", "yearly"],
  "/sales": ["sales", "producer", "bind", "quote", "funnel", "pipeline", "lead", "closing", "days to bind", "agent", "leaderboard", "new business"],
  "/products": ["product", "line of business", "lob", "carrier", "commercial property", "general liability", "commercial auto", "workers comp", "cyber", "professional liability", "hartford", "travelers", "chubb"],
  "/renewals": ["renewal", "retention", "churn", "retained", "lost premium", "at risk", "non-renewal", "remarket"],
  "/claims": ["claim", "loss ratio", "incurred", "severity", "open claims", "closed claims", "risk", "filed"],
};

const SECTION_LABELS: Record<string, string> = {
  "/": "Executive Summary",
  "/sales": "Sales Performance",
  "/products": "Product Analytics",
  "/renewals": "Renewals & Retention",
  "/claims": "Claims & Risk",
};

export function classifyChart(chartData: { title: string; data: any[] }): { section: string; sectionLabel: string } {
  const titleLower = chartData.title.toLowerCase();
  const dataKeys = chartData.data.length > 0 ? Object.keys(chartData.data[0]).join(" ").toLowerCase() : "";
  const searchText = `${titleLower} ${dataKeys}`;

  let bestSection = "/";
  let bestScore = 0;

  for (const [section, keywords] of Object.entries(SECTION_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        score += keyword.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSection = section;
    }
  }

  return { section: bestSection, sectionLabel: SECTION_LABELS[bestSection] };
}

function slugify(title: string): string {
  return "/custom/" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function CustomDashboardsProvider({ children }: { children: React.ReactNode }) {
  const [charts, setCharts] = useState<CustomChart[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [sidebarEntries, setSidebarEntries] = useState<CustomSidebarEntry[]>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(charts));
  }, [charts]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(sidebarEntries));
  }, [sidebarEntries]);

  const addChart = useCallback((chart: Omit<CustomChart, "id" | "addedAt">) => {
    const newChart: CustomChart = {
      ...chart,
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      addedAt: Date.now(),
    };
    setCharts(prev => [...prev, newChart]);
  }, []);

  const removeChart = useCallback((id: string) => {
    setCharts(prev => prev.filter(c => c.id !== id));
  }, []);

  const getChartsForSection = useCallback((section: string) => {
    return charts.filter(c => c.section === section);
  }, [charts]);

  const addSidebarEntry = useCallback((title: string) => {
    const route = slugify(title);
    const entry: CustomSidebarEntry = {
      id: `sidebar-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title,
      route,
      addedAt: Date.now(),
    };
    setSidebarEntries(prev => {
      if (prev.some(e => e.route === route)) return prev;
      return [...prev, entry];
    });
    return entry;
  }, []);

  const removeSidebarEntry = useCallback((id: string) => {
    setSidebarEntries(prev => {
      const entry = prev.find(e => e.id === id);
      if (entry) {
        setCharts(c => c.filter(ch => ch.section !== entry.route));
      }
      return prev.filter(e => e.id !== id);
    });
  }, []);

  return (
    <CustomDashboardsContext.Provider value={{ charts, addChart, removeChart, getChartsForSection, sidebarEntries, addSidebarEntry, removeSidebarEntry }}>
      {children}
    </CustomDashboardsContext.Provider>
  );
}

export function useCustomDashboards() {
  return useContext(CustomDashboardsContext);
}
