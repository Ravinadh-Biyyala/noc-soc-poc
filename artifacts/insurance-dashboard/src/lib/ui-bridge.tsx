// AG-UI bridge — a two-way link between the app UI and the BI Companion chat.
//
//  • chat → UI: the agent's tools call `openDiagnosis(target)` to slide the
//    deep-diagnosis drawer open / change the page (see noc-actions DriveDrawer).
//  • UI → chat: a page click calls `askCompanion(prompt)` to push a turn into the
//    chat so the agent fetches + answers about whatever the user just clicked
//    (e.g. selecting an incident in Traces, or a KPI/visual on the Dashboard).
//
// The deep-diagnosis slide-over (DiagnosisDrawer) is owned here at app level and
// mounted once, so both directions share a single drawer.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import DiagnosisDrawer, { type DrawerTarget } from "@/components/loki/DiagnosisDrawer";

interface NocUiCtx {
  /** Open the deep-diagnosis drawer on a target (device / incident / alarms list). */
  openDiagnosis: (target: DrawerTarget, since?: string) => void;
  closeDiagnosis: () => void;
  /** Push a user turn into the BI Companion chat (UI → chat); the agent answers. */
  askCompanion: (prompt: string) => void;
}

const Ctx = createContext<NocUiCtx>({ openDiagnosis: () => {}, closeDiagnosis: () => {}, askCompanion: () => {} });

export function NocUiProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [since, setSince] = useState("24h");
  // This provider sits inside <CopilotKit>, so it can drive the chat directly.
  const { appendMessage } = useCopilotChat();

  const openDiagnosis = useCallback((t: DrawerTarget, s?: string) => {
    if (s) setSince(s);
    setTarget(t);
  }, []);
  const closeDiagnosis = useCallback(() => setTarget(null), []);

  // Appending a user message runs the agent (followUp default), so clicking a
  // visual makes the Companion fetch the relevant function and respond inline.
  const askCompanion = useCallback((prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    void appendMessage(new TextMessage({ role: Role.User, content: text }));
  }, [appendMessage]);

  const value = useMemo(
    () => ({ openDiagnosis, closeDiagnosis, askCompanion }),
    [openDiagnosis, closeDiagnosis, askCompanion],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Single, app-level drawer driven by both the dashboard and the chat agent. */}
      <DiagnosisDrawer target={target} since={since} onClose={closeDiagnosis} />
    </Ctx.Provider>
  );
}

export function useNocUi() {
  return useContext(Ctx);
}
