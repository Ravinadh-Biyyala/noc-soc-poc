// AG-UI bridge — a two-way link between the app UI and the BI Companion chat.
//
//  • chat → UI: the agent's tools call `openDiagnosis(target)` to slide the
//    deep-diagnosis drawer open / change the page (see noc-actions DriveDrawer).
//  • UI → chat: a page click calls `askCompanion(prompt)` to push a turn into the
//    chat so the agent answers about whatever the user just clicked (e.g.
//    selecting an incident in Traces, or a KPI/visual on the Dashboard).
//    `explainVisual(title, hint, values)` is the standardised "the user clicked
//    THIS visual — explain it" gesture, used by the ExplainButton on every panel
//    and by the KPI tiles. It ships the visual's CURRENTLY-RENDERED on-screen
//    values to the chat and asks the agent to explain them WITHOUT re-querying
//    Loki — so the answer reflects exactly what the user is looking at. (Typed
//    questions are different: those still go through the named NOC functions /
//    LogQL to pull live data.)
//
// The deep-diagnosis slide-over (DiagnosisDrawer) is owned here at app level and
// mounted once, so both directions share a single drawer.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCopilotChat, useCopilotReadable } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { useChatObserver } from "@/lib/chat-observer";
import DiagnosisDrawer, { type DrawerTarget } from "@/components/loki/DiagnosisDrawer";

interface NocUiCtx {
  /** Open the deep-diagnosis drawer on a target (device / incident / alarms list). */
  openDiagnosis: (target: DrawerTarget, since?: string) => void;
  closeDiagnosis: () => void;
  /** Push a user turn into the BI Companion chat (UI → chat); the agent answers. */
  askCompanion: (prompt: string) => void;
  /**
   * UI → chat: the user clicked a visual and wants it explained. The CHAT only
   * shows a clean question (`Explain the "X" visual.`); the `values` rendered on
   * screen (scraped via `readVisualValues`), the optional chart `spec` (so the
   * chat can REDRAW the same visual inline via renderClickedVisual), and the
   * optional `hint` ride along out-of-band as agent context (a CopilotKit
   * readable), never shown to the user. The agent renders the visual + answers
   * from those values ONLY — no NOC function, no LogQL.
   */
  explainVisual: (title: string, hint?: string, values?: string, chart?: VisualChartSpec) => void;
}

/** A redraw-able spec for the clicked visual (mirrors LokiChart's props). */
export interface VisualChartSpec {
  type: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, unknown>>;
}

/** Out-of-band context for a clicked-visual explanation (not shown in chat). */
interface ExplainContext {
  visual: string;
  page: string;
  onScreenValues: string;
  /** Present when the clicked visual is a chart the chat can redraw. */
  chart?: VisualChartSpec;
  guidance?: string;
}

const Ctx = createContext<NocUiCtx>({
  openDiagnosis: () => {}, closeDiagnosis: () => {}, askCompanion: () => {}, explainVisual: () => {},
});

/**
 * Read a visual's currently-rendered values straight off the screen.
 *
 *  • Charts expose their exact data as `data-explain-values` (see LokiChart /
 *    TimeSeriesChart) because their rendered SVG mashes axis ticks + labels
 *    together and can't be read back accurately — those are preferred.
 *  • Everything else (KPI tiles, tables, rank lists) renders its values as plain
 *    text, so the panel's textContent IS what the user sees.
 *
 * Elements tagged `data-explain-omit` (e.g. the Explain button) are stripped.
 * Returns a compact, whitespace-collapsed string capped so the chat turn stays
 * small.
 */
export function readVisualValues(el: HTMLElement | null | undefined): string | undefined {
  if (!el) return undefined;
  const structured = Array.from(el.querySelectorAll<HTMLElement>("[data-explain-values]"))
    .map((n) => n.getAttribute("data-explain-values")?.trim())
    .filter((s): s is string => !!s);
  let text: string | undefined;
  if (structured.length) {
    text = structured.join(" | ");
  } else {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-explain-omit]").forEach((n) => n.remove());
    text = clone.textContent?.replace(/\s+/g, " ").trim();
  }
  if (!text) return undefined;
  return text.length > 1800 ? `${text.slice(0, 1800)}…` : text;
}

/**
 * Read the redraw spec a chart visual exposes via `data-explain-chart` (emitted
 * by LokiChart / TimeSeriesChart / RankList). Lets the chat redraw the EXACT
 * chart the user clicked, from the on-screen data — no re-query. Returns
 * undefined for non-chart visuals (KPI tiles, tables) — those explain from text.
 */
export function readVisualChart(el: HTMLElement | null | undefined): VisualChartSpec | undefined {
  if (!el) return undefined;
  const raw = el.querySelector<HTMLElement>("[data-explain-chart]")?.getAttribute("data-explain-chart");
  if (!raw) return undefined;
  try {
    const spec = JSON.parse(raw) as VisualChartSpec;
    if (spec && Array.isArray(spec.data) && spec.data.length && spec.xKey && spec.yKey) return spec;
  } catch { /* not a parseable chart spec */ }
  return undefined;
}

export function NocUiProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [since, setSince] = useState("24h");
  // Context for the visual the user most recently clicked "Explain" on. Held out
  // of the message stream so the chat bubble stays clean; the agent reads it as
  // a readable to answer from the on-screen values.
  const [explainCtx, setExplainCtx] = useState<ExplainContext | null>(null);
  const pendingExplainMsg = useRef<string | null>(null);
  // This provider sits inside <CopilotKit> AND <ChatObserverProvider>, so it can
  // drive the chat directly and read which page/visuals the user is looking at.
  const { appendMessage } = useCopilotChat();
  const { observation } = useChatObserver();
  // Keep a stable handle to appendMessage so the send effect can depend only on
  // explainCtx (and not be re-run / cancelled when appendMessage's identity changes).
  const appendRef = useRef(appendMessage);
  appendRef.current = appendMessage;

  // The clicked-visual values travel here as agent context — NEVER shown in the
  // chat. Only authoritative for "Explain the …" turns (see the persona); typed
  // questions ignore it and fetch live.
  useCopilotReadable({
    description:
      "The visual the user most recently clicked 'Explain' on, with the EXACT values currently shown on their screen " +
      "(onScreenValues) and, when it's a chart, a redraw spec (chart: {type,xKey,yKey,data}). When the user's message " +
      "asks to explain a visual (e.g. 'Explain the \"X\" visual.'): if a chart spec is present, FIRST call " +
      "renderClickedVisual with that chart's title/type/xKey/yKey/data verbatim to redraw it inline, THEN explain. " +
      "Answer using ONLY these values — do NOT call any NOC function or query Loki; this is exactly what they see.",
    value: explainCtx ?? {},
  });

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

  const explainVisual = useCallback((title: string, hint?: string, values?: string, chart?: VisualChartSpec) => {
    const t = title.trim();
    if (!t) return;
    const shown = values?.trim();
    setExplainCtx({
      visual: t,
      page: observation.label ?? "",
      onScreenValues: shown && shown.length
        ? shown
        : "(values not captured — explain from the current page summary instead, still without fetching)",
      ...(chart ? { chart } : {}),
      ...(hint?.trim() ? { guidance: hint.trim() } : {}),
    });
    // The chat shows ONLY this clean question; values/instructions are in the
    // readable above. Sent from the effect once that readable reflects the click.
    pendingExplainMsg.current = `Explain the "${t}" visual.`;
  }, [observation.label]);

  // Fire the clean question only AFTER the readable's value has COMMITTED into
  // CopilotKit's context store. That store update is itself a setState (one more
  // render), so we defer one macrotask — otherwise the run would read the stale
  // (empty) value and the agent would think the visual has no data. Depends on
  // explainCtx alone so a new click is the only thing that (re)schedules a send.
  useEffect(() => {
    if (!explainCtx || !pendingExplainMsg.current) return;
    const content = pendingExplainMsg.current;
    pendingExplainMsg.current = null;
    const id = setTimeout(() => {
      void appendRef.current(new TextMessage({ role: Role.User, content }));
    }, 80);
    return () => clearTimeout(id);
  }, [explainCtx]);

  const value = useMemo(
    () => ({ openDiagnosis, closeDiagnosis, askCompanion, explainVisual }),
    [openDiagnosis, closeDiagnosis, askCompanion, explainVisual],
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
