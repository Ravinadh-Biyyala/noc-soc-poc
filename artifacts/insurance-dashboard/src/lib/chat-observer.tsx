import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * What the right-rail Copilot is currently "watching". Pages register their
 * observation on mount; the chat reads it to render an "Observing X" pill,
 * to seed page-aware suggestion chips, and — most importantly — to inject
 * a context block into the first user message of each conversation so the
 * model can answer specifically rather than generically.
 *
 * Kept very small on purpose: just a label, a kind, and an optional
 * machine-readable summary string. The chat doesn't need (or want) the
 * full config — a few hundred chars is plenty.
 */
export interface ChatObservation {
  /** Short human-friendly label for the pill ("Revenue dashboard"). */
  label: string;
  /** Coarse kind helps the chat pick suggestion chips. */
  kind: "home" | "workspace" | "workspaces" | "dashboard" | "settings" | "data" | "other";
  /** Compact summary the chat will inject as ground truth (≤ ~600 chars). */
  summary?: string;
  /** Optional pre-baked suggestion chips for this view. */
  suggestions?: string[];
}

interface Ctx {
  observation: ChatObservation;
  setObservation: (next: ChatObservation | null) => void;
}

const DEFAULT: ChatObservation = {
  label: "Gen-BI workspace",
  kind: "home",
  suggestions: [
    "Summarise everything I've uploaded so far",
    "What should I analyse next?",
    "Which of my dashboards is the most interesting?",
  ],
};

const ChatObserverContext = createContext<Ctx>({ observation: DEFAULT, setObservation: () => {} });

export function ChatObserverProvider({ children }: { children: React.ReactNode }) {
  const [observation, setObs] = useState<ChatObservation>(DEFAULT);
  const setObservation = useCallback((next: ChatObservation | null) => {
    setObs(next ?? DEFAULT);
  }, []);
  const value = useMemo(() => ({ observation, setObservation }), [observation, setObservation]);
  return <ChatObserverContext.Provider value={value}>{children}</ChatObserverContext.Provider>;
}

export function useChatObserver() {
  return useContext(ChatObserverContext);
}

/**
 * Convenience hook: register an observation while a page/component is
 * mounted, and clear it on unmount so the chat never lies about what
 * it can see.
 */
export function useRegisterObservation(obs: ChatObservation | null) {
  const { setObservation } = useChatObserver();
  // Stringify for cheap deep-equality so callers can pass a fresh object
  // every render without re-firing the effect.
  const key = JSON.stringify(obs ?? null);
  useEffect(() => {
    setObservation(obs);
    return () => setObservation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
