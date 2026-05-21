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
  addDashboard: (config: any) => Promise<GeneratedDashboard>;
  removeDashboard: (id: string) => void;
  updateDashboardConfig: (id: string, config: any) => void;
}

const GeneratedDashboardsContext = createContext<GeneratedDashboardsContextType>({
  dashboards: [],
  addDashboard: async () => ({ id: "", title: "", route: "", config: null, createdAt: 0 }),
  removeDashboard: () => {},
  updateDashboardConfig: () => {},
});

function slugify(title: string): string {
  return "/generated/" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function rowToEntry(row: any): GeneratedDashboard {
  return {
    id: String(row.id),
    title: row.title,
    route: row.route,
    config: row.config,
    createdAt: new Date(row.createdAt).getTime(),
  };
}

export function GeneratedDashboardProvider({ children }: { children: React.ReactNode }) {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [dashboards, setDashboards] = useState<GeneratedDashboard[]>([]);

  useEffect(() => {
    fetch(`${apiBase}/api/copilot-dashboards`)
      .then((r) => r.json())
      .then((rows: any[]) => setDashboards(rows.map(rowToEntry)))
      .catch(() => {});
  }, [apiBase]);

  const addDashboard = useCallback(
    async (config: any): Promise<GeneratedDashboard> => {
      const title = config.title || "Generated Dashboard";
      const id = `gen-${Date.now()}`;
      const route = config.customRoute ?? (slugify(title) + "-" + id.slice(-6));

      const res = await fetch(`${apiBase}/api/copilot-dashboards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, route, config }),
      });
      const row = await res.json();
      const entry = rowToEntry(row);
      setDashboards((prev) => [entry, ...prev.filter((d) => d.route !== route)]);
      return entry;
    },
    [apiBase],
  );

  const removeDashboard = useCallback(
    (id: string) => {
      setDashboards((prev) => prev.filter((d) => d.id !== id));
      fetch(`${apiBase}/api/copilot-dashboards/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [apiBase],
  );

  const updateDashboardConfig = useCallback(
    (id: string, config: any) => {
      setDashboards((prev) => prev.map((d) => (d.id === id ? { ...d, config } : d)));
      fetch(`${apiBase}/api/copilot-dashboards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      }).catch(() => {});
    },
    [apiBase],
  );

  return (
    <GeneratedDashboardsContext.Provider
      value={{ dashboards, addDashboard, removeDashboard, updateDashboardConfig }}
    >
      {children}
    </GeneratedDashboardsContext.Provider>
  );
}

export function useGeneratedDashboards() {
  return useContext(GeneratedDashboardsContext);
}
