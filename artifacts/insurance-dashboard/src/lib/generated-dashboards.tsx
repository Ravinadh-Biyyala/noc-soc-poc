import { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface GeneratedDashboard {
  id: string;
  title: string;
  route: string;
  config: any;
  createdAt: number;
}

interface GeneratedDashboardsContextType {
  dashboards: GeneratedDashboard[];
  addDashboard: (config: any) => GeneratedDashboard;
  removeDashboard: (id: string) => void;
  /** Replace the stored config for a dashboard (e.g. after a layout edit). */
  updateDashboardConfig: (id: string, config: any) => void;
}

const GeneratedDashboardsContext = createContext<GeneratedDashboardsContextType>({
  dashboards: [],
  addDashboard: () => ({ id: "", title: "", route: "", config: null, createdAt: 0 }),
  removeDashboard: () => {},
  updateDashboardConfig: () => {},
});

const STORAGE_KEY = "genbi-generated-dashboards";

function slugify(title: string): string {
  return "/generated/" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function GeneratedDashboardProvider({ children }: { children: React.ReactNode }) {
  const [dashboards, setDashboards] = useState<GeneratedDashboard[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards));
  }, [dashboards]);

  const addDashboard = useCallback((config: any) => {
    const title = config.title || "Generated Dashboard";
    const id = `gen-${Date.now()}`;
    const route = slugify(title) + "-" + id.slice(-6);
    const entry: GeneratedDashboard = { id, title, route, config, createdAt: Date.now() };
    setDashboards((prev) => [entry, ...prev]);
    return entry;
  }, []);

  const removeDashboard = useCallback((id: string) => {
    setDashboards((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const updateDashboardConfig = useCallback((id: string, config: any) => {
    setDashboards((prev) => prev.map((d) => (d.id === id ? { ...d, config } : d)));
  }, []);

  return (
    <GeneratedDashboardsContext.Provider value={{ dashboards, addDashboard, removeDashboard, updateDashboardConfig }}>
      {children}
    </GeneratedDashboardsContext.Provider>
  );
}

export function useGeneratedDashboards() {
  return useContext(GeneratedDashboardsContext);
}
