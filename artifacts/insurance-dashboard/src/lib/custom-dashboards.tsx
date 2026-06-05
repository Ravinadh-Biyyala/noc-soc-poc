import { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface CustomChart {
  id: string;
  type: string;
  title: string;
  xKey: string;
  yKey: string;
  data: any[];
  /** Optional AI-chosen colour palette (hex/rgb/hsl) for this chart. */
  colors?: string[];
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
      if (searchText.includes(keyword)) score += keyword.length;
    }
    if (score > bestScore) { bestScore = score; bestSection = section; }
  }

  return { section: bestSection, sectionLabel: SECTION_LABELS[bestSection] };
}

function slugify(title: string): string {
  return "/custom/" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rowToChart(row: any): CustomChart {
  return {
    id: String(row.id),
    type: row.config.type ?? "bar",
    title: row.config.title ?? "",
    xKey: row.config.xKey ?? "x",
    yKey: row.config.yKey ?? "y",
    data: row.config.data ?? [],
    colors: Array.isArray(row.config.colors) ? row.config.colors : undefined,
    section: row.sectionRoute,
    sectionLabel: row.config.sectionLabel ?? row.sectionRoute,
    addedAt: new Date(row.createdAt).getTime(),
  };
}

export function CustomDashboardsProvider({ children }: { children: React.ReactNode }) {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  const [charts, setCharts] = useState<CustomChart[]>([]);
  const [sidebarEntries, setSidebarEntries] = useState<CustomSidebarEntry[]>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  useEffect(() => {
    fetch(`${apiBase}/api/section-pinned-charts`)
      .then((r) => r.json())
      .then((rows: any[]) => setCharts(rows.map(rowToChart)))
      .catch(() => {});
  }, [apiBase]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(sidebarEntries));
  }, [sidebarEntries]);

  const addChart = useCallback(
    (chart: Omit<CustomChart, "id" | "addedAt">) => {
      // Optimistic local add
      const optimisticId = `pending-${Date.now()}`;
      const optimistic: CustomChart = { ...chart, id: optimisticId, addedAt: Date.now() };
      setCharts((prev) => [...prev, optimistic]);

      const config = {
        type: chart.type,
        title: chart.title,
        xKey: chart.xKey,
        yKey: chart.yKey,
        data: chart.data,
        ...(chart.colors?.length ? { colors: chart.colors } : {}),
        sectionLabel: chart.sectionLabel,
      };

      fetch(`${apiBase}/api/section-pinned-charts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionRoute: chart.section, config }),
      })
        .then((r) => r.json())
        .then((row: any) => {
          setCharts((prev) =>
            prev.map((c) => (c.id === optimisticId ? rowToChart(row) : c)),
          );
        })
        .catch(() => {
          setCharts((prev) => prev.filter((c) => c.id !== optimisticId));
        });
    },
    [apiBase],
  );

  const removeChart = useCallback(
    (id: string) => {
      setCharts((prev) => prev.filter((c) => c.id !== id));
      if (!id.startsWith("pending-")) {
        fetch(`${apiBase}/api/section-pinned-charts/${id}`, { method: "DELETE" }).catch(() => {});
      }
    },
    [apiBase],
  );

  const getChartsForSection = useCallback(
    (section: string) => charts.filter((c) => c.section === section),
    [charts],
  );

  const addSidebarEntry = useCallback((title: string) => {
    const route = slugify(title);
    const entry: CustomSidebarEntry = {
      id: `sidebar-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title,
      route,
      addedAt: Date.now(),
    };
    setSidebarEntries((prev) => {
      if (prev.some((e) => e.route === route)) return prev;
      return [...prev, entry];
    });
    return entry;
  }, []);

  const removeSidebarEntry = useCallback((id: string) => {
    setSidebarEntries((prev) => {
      const entry = prev.find((e) => e.id === id);
      if (entry) setCharts((c) => c.filter((ch) => ch.section !== entry.route));
      return prev.filter((e) => e.id !== id);
    });
  }, []);

  return (
    <CustomDashboardsContext.Provider
      value={{ charts, addChart, removeChart, getChartsForSection, sidebarEntries, addSidebarEntry, removeSidebarEntry }}
    >
      {children}
    </CustomDashboardsContext.Provider>
  );
}

export function useCustomDashboards() {
  return useContext(CustomDashboardsContext);
}
