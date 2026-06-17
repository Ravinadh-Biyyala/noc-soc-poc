// Pinned Loki visuals — charts the CopilotKit agent generates in the chat and
// "pins" to the Loki Logs page's "Pinned Visuals" subtab. Lightweight,
// localStorage-backed (no DB/schema change for v1), mirroring the shape used by
// the in-chat render and the subtab grid (see LokiChart).

import { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface LokiPin {
  id: string;
  title: string;
  /** bar | line | area | pie */
  type: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, unknown>>;
  colors?: string[];
  /** Optional context shown under the chart (LogQL, summary). */
  logql?: string;
  summary?: string;
  createdAt: number;
}

interface LokiPinsContextType {
  pins: LokiPin[];
  addPin: (pin: Omit<LokiPin, "id" | "createdAt">) => LokiPin;
  removePin: (id: string) => void;
  clearPins: () => void;
}

const LokiPinsContext = createContext<LokiPinsContextType>({
  pins: [],
  addPin: () => ({ id: "", title: "", type: "bar", xKey: "", yKey: "", data: [], createdAt: 0 }),
  removePin: () => {},
  clearPins: () => {},
});

const STORAGE_KEY = "loki-pinned-visuals-v1";

function load(): LokiPin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function LokiPinsProvider({ children }: { children: React.ReactNode }) {
  const [pins, setPins] = useState<LokiPin[]>(() => load());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
    } catch {
      /* quota / serialization — ignore, pins stay in-memory */
    }
  }, [pins]);

  const addPin = useCallback((pin: Omit<LokiPin, "id" | "createdAt">) => {
    const entry: LokiPin = { ...pin, id: `loki-${Date.now()}-${Math.round(Math.random() * 1e6)}`, createdAt: Date.now() };
    setPins((prev) => [entry, ...prev]);
    return entry;
  }, []);

  const removePin = useCallback((id: string) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const clearPins = useCallback(() => setPins([]), []);

  return (
    <LokiPinsContext.Provider value={{ pins, addPin, removePin, clearPins }}>
      {children}
    </LokiPinsContext.Provider>
  );
}

export function useLokiPins() {
  return useContext(LokiPinsContext);
}
