import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * What the right-rail Copilot is currently "watching". Pages register their
 * observation on mount; the chat reads it to render an "Observing X" pill,
 * to seed page-aware suggestion chips, and — most importantly — to inject
 * a context block into the first user message of each conversation so the
 * model can answer specifically rather than generically.
 */
export interface ChatObservation {
  label: string;
  kind: "home" | "workspace" | "workspaces" | "dashboard" | "settings" | "data" | "other";
  /** Compact summary the chat will inject as ground truth (≤ ~600 chars). */
  summary?: string;
  /** Optional pre-baked suggestion chips for this view. */
  suggestions?: string[];
  /**
   * Active workspace/project id, if any. Passed to /api/openai/chat so the
   * server can load the project's applied semantic model + metrics and inject
   * them into the system prompt. Substituting {{metric:name}} placeholders in
   * generated SQL also keys off this.
   */
  workspaceId?: number;
}

/**
 * A proactive agent-driven nudge surfaced in the right-rail Copilot — for
 * example, after the data-quality engine flags 47 malformed dates on
 * upload it pushes one of these so the user can apply or skip the fix
 * without leaving the chat. Replaces a dedicated "Cleaning" page.
 */
export interface AgentSuggestion {
  id: string;
  /** Short, human-readable lead line ("47 malformed dates in orders.csv"). */
  title: string;
  /** Why the agent is recommending this (rule + evidence). */
  rationale: string;
  /** What clicking Apply will do, in plain language. */
  applyLabel?: string;
  /** Severity tints the card. */
  severity: "info" | "warn" | "critical";
  /** Called when the user clicks Apply. The card auto-dismisses after. */
  onApply?: () => void;
}

interface Ctx {
  observation: ChatObservation;
  setObservation: (next: ChatObservation | null) => void;
  /** Reset to default ONLY if `obs` is still the active observation (owner check). */
  clearObservation: (obs: ChatObservation) => void;
  agentSuggestions: AgentSuggestion[];
  pushAgentSuggestion: (s: Omit<AgentSuggestion, "id"> & { id?: string }) => string;
  dismissAgentSuggestion: (id: string) => void;
  clearAgentSuggestions: () => void;
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

const ChatObserverContext = createContext<Ctx>({
  observation: DEFAULT,
  setObservation: () => {},
  clearObservation: () => {},
  agentSuggestions: [],
  pushAgentSuggestion: () => "",
  dismissAgentSuggestion: () => {},
  clearAgentSuggestions: () => {},
});

export function ChatObserverProvider({ children }: { children: React.ReactNode }) {
  const [observation, setObs] = useState<ChatObservation>(DEFAULT);
  const [agentSuggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const counter = useRef(0);

  const setObservation = useCallback((next: ChatObservation | null) => {
    setObs(next ?? DEFAULT);
  }, []);

  // Owner-checked reset: the functional updater reads the LIVE observation, so a
  // component unmounting only clears its OWN observation — it never clobbers one
  // that a newer page/panel already registered (fixes lost context on tab/route
  // switches where cleanup and re-register race).
  const clearObservation = useCallback((obs: ChatObservation) => {
    setObs((current) => (current === obs ? DEFAULT : current));
  }, []);

  const pushAgentSuggestion = useCallback<Ctx["pushAgentSuggestion"]>((s) => {
    counter.current += 1;
    const id = s.id ?? `sug-${Date.now().toString(36)}-${counter.current}`;
    setSuggestions((prev) => {
      // Idempotent: same id replaces the older card so re-running the
      // rules engine doesn't spam the chat with duplicates.
      const filtered = prev.filter((x) => x.id !== id);
      return [...filtered, { ...s, id }];
    });
    return id;
  }, []);

  const dismissAgentSuggestion = useCallback((id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clearAgentSuggestions = useCallback(() => setSuggestions([]), []);

  const value = useMemo(
    () => ({
      observation,
      setObservation,
      clearObservation,
      agentSuggestions,
      pushAgentSuggestion,
      dismissAgentSuggestion,
      clearAgentSuggestions,
    }),
    [observation, setObservation, clearObservation, agentSuggestions, pushAgentSuggestion, dismissAgentSuggestion, clearAgentSuggestions],
  );

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
  const { setObservation, clearObservation } = useChatObserver();
  const key = JSON.stringify(obs ?? null);
  useEffect(() => {
    // A null observation means "this component opts out" — it must NOT clobber
    // an observation a parent already registered (e.g. an embedded
    // GeneratedDashboard with hidePresenter would otherwise wipe the project's
    // workspaceId context). Skip entirely so the parent's observation stands.
    if (obs == null) return;
    setObservation(obs);
    // Owner-checked cleanup: only reset to default if OUR observation is still
    // active. On a tab/route switch the next view registers its own observation
    // first; without this check our unmount cleanup would wipe it and the
    // Copilot would lose project context.
    return () => clearObservation(obs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
