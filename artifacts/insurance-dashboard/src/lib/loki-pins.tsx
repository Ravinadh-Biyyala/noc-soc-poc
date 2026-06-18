// Pinned Loki visuals — persisted server-side in the dedicated `loki` Postgres
// database (via /api/loki-pins). Each pin stores the query metadata
// (logql/kind/since/transform) so it can be Refreshed: re-run the query and
// rebuild the chart rows with the same transform, then save the new snapshot.

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { postLokiQuery, buildChartRows, type LokiTransform } from "@/lib/loki-api";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface LokiPin {
  id: string;
  title: string;
  /** bar | line | area | pie */
  type: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, unknown>>;
  colors?: string[];
  summary?: string;
  /** Query metadata for refresh. */
  logql?: string;
  kind?: string;
  since?: string;
  transform?: LokiTransform;
  createdAt: number;
  updatedAt?: number;
}

export type NewLokiPin = Omit<LokiPin, "id" | "createdAt" | "updatedAt">;

interface LokiPinsContextType {
  pins: LokiPin[];
  loading: boolean;
  error: string | null;
  addPin: (pin: NewLokiPin) => Promise<LokiPin | null>;
  removePin: (id: string) => Promise<void>;
  /** Re-run a pin's stored query and persist the fresh snapshot. */
  refreshPin: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  reload: () => Promise<void>;
}

const LokiPinsContext = createContext<LokiPinsContextType>({
  pins: [], loading: false, error: null,
  addPin: async () => null, removePin: async () => {}, refreshPin: async () => {},
  refreshAll: async () => {}, reload: async () => {},
});

/** A pin can be refreshed only if it carries a re-runnable query + transform. */
export function isRefreshable(p: LokiPin): boolean {
  return !!p.logql && !!p.transform && p.transform !== "none";
}

export function LokiPinsProvider({ children }: { children: React.ReactNode }) {
  const [pins, setPins] = useState<LokiPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/loki-pins`, { credentials: "include" });
      if (!r.ok) throw new Error(`Failed to load pins (${r.status})`);
      setPins(await r.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pinned visuals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const addPin = useCallback(async (pin: NewLokiPin): Promise<LokiPin | null> => {
    const r = await fetch(`${API_BASE}/api/loki-pins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(pin),
    });
    if (!r.ok) return null;
    const created: LokiPin = await r.json();
    setPins((prev) => [created, ...prev]);
    return created;
  }, []);

  const removePin = useCallback(async (id: string) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
    await fetch(`${API_BASE}/api/loki-pins/${id}`, { method: "DELETE", credentials: "include" }).catch(() => {});
  }, []);

  const refreshPin = useCallback(async (id: string) => {
    const pin = pins.find((p) => p.id === id);
    if (!pin || !isRefreshable(pin)) return;
    const result = await postLokiQuery({ logql: pin.logql, kind: pin.kind || "metric", since: pin.since || "24h", limit: 1000 });
    const data = buildChartRows(result, { transform: pin.transform as LokiTransform, xKey: pin.xKey, yKey: pin.yKey });
    const r = await fetch(`${API_BASE}/api/loki-pins/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ data }),
    });
    if (r.ok) {
      const updated: LokiPin = await r.json();
      setPins((prev) => prev.map((p) => (p.id === id ? updated : p)));
    }
  }, [pins]);

  const refreshAll = useCallback(async () => {
    await Promise.all(pins.filter(isRefreshable).map((p) => refreshPin(p.id)));
  }, [pins, refreshPin]);

  return (
    <LokiPinsContext.Provider value={{ pins, loading, error, addPin, removePin, refreshPin, refreshAll, reload }}>
      {children}
    </LokiPinsContext.Provider>
  );
}

export function useLokiPins() {
  return useContext(LokiPinsContext);
}
