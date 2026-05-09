/**
 * Layout actions that the Copilot (or a deterministic helper) can apply to a
 * generated dashboard. Kept tiny and JSON-serialisable so the LLM can emit
 * them inside a fenced action block without any tool-calling plumbing.
 *
 * The contract for the LLM lives in `LAYOUT_TOOL_PROMPT` below — keep that
 * string in sync with the action shape if you change it.
 */

export type LayoutAction =
  | { type: "set_col_span"; chartId: string; span: 1 | 2 }
  | { type: "reorder"; ids: string[] }
  | { type: "hide"; chartId: string }
  | { type: "show"; chartId: string }
  | { type: "tidy" };

export interface ChartLike {
  id: string;
  type?: string;
  title?: string;
  colSpan?: 1 | 2;
  hidden?: boolean;
  // The renderer keeps lots more, but the layout helpers only touch these.
  [k: string]: unknown;
}

export interface DashboardLike {
  charts?: ChartLike[];
  [k: string]: unknown;
}

const FULL_WIDTH_TYPES = new Set([
  "area",
  "line",
  "scatter",
  "treemap",
  "stacked-bar",
  "stacked-area",
]);

/**
 * Deterministic "make this look nice" pass:
 * - Trends, scatters, treemaps go full-width (they need horizontal room).
 * - Donuts/bars stay half-width and pair up.
 * - Trend (area/line) charts are pulled to the front.
 * - Hidden charts are left hidden.
 * No LLM needed — wired both to the "Tidy" button and to the `tidy` action.
 */
export function autoTidy(config: DashboardLike): DashboardLike {
  const charts = Array.isArray(config.charts) ? config.charts.map((c) => ({ ...c })) : [];

  for (const c of charts) {
    if (c.hidden) continue;
    c.colSpan = FULL_WIDTH_TYPES.has(String(c.type)) ? 2 : 1;
  }

  // Stable sort: trends/scatters first, everything else in original order.
  const priority = (c: ChartLike) => {
    const t = String(c.type);
    if (t === "area" || t === "line") return 0;
    if (t === "scatter") return 1;
    if (t === "treemap") return 2;
    return 3;
  };
  charts.sort((a, b) => priority(a) - priority(b));

  return { ...config, charts };
}

/**
 * Apply a batch of layout actions to a dashboard config and return a new
 * config object (the original is not mutated). Unknown actions are skipped
 * silently rather than thrown — the LLM occasionally invents fields and we
 * don't want a typo to wipe out a whole batch.
 */
export function applyActions(config: DashboardLike, actions: LayoutAction[]): DashboardLike {
  let next: DashboardLike = { ...config, charts: (config.charts ?? []).map((c) => ({ ...c })) };

  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    switch (action.type) {
      case "tidy":
        next = autoTidy(next);
        break;
      case "set_col_span": {
        const span = action.span === 2 ? 2 : 1;
        next = {
          ...next,
          charts: (next.charts ?? []).map((c) => (c.id === action.chartId ? { ...c, colSpan: span } : c)),
        };
        break;
      }
      case "hide":
        next = {
          ...next,
          charts: (next.charts ?? []).map((c) => (c.id === action.chartId ? { ...c, hidden: true } : c)),
        };
        break;
      case "show":
        next = {
          ...next,
          charts: (next.charts ?? []).map((c) => (c.id === action.chartId ? { ...c, hidden: false } : c)),
        };
        break;
      case "reorder": {
        const wanted = Array.isArray(action.ids) ? action.ids : [];
        const byId = new Map((next.charts ?? []).map((c) => [c.id, c]));
        const ordered: ChartLike[] = [];
        for (const id of wanted) {
          const c = byId.get(id);
          if (c) { ordered.push(c); byId.delete(id); }
        }
        // Anything not mentioned keeps its original relative order at the end.
        ordered.push(...byId.values());
        next = { ...next, charts: ordered };
        break;
      }
    }
  }
  return next;
}

/** Block markers the Copilot uses to emit machine-readable layout actions. */
const OPEN = "[[LAYOUT_ACTIONS]]";
const CLOSE = "[[/LAYOUT_ACTIONS]]";

/**
 * Pull every layout-actions block out of an assistant message, returning the
 * parsed actions and the human-readable text with the blocks stripped out.
 *
 * Tolerant on purpose — the LLM is inconsistent about exactly how it wraps
 * the JSON, so we accept all of:
 *   1. [[LAYOUT_ACTIONS]] {...} [[/LAYOUT_ACTIONS]]   (preferred)
 *   2. [LAYOUT_ACTIONS] {...} [/LAYOUT_ACTIONS]       (single brackets)
 *   3. ```json {...} ```                              (markdown fences)
 *   4. A bare top-level {"actions":[...]} block       (last-resort fallback)
 * Bad JSON is dropped silently rather than thrown.
 */
export function parseLayoutActions(text: string): {
  actions: LayoutAction[];
  cleanText: string;
} {
  const actions: LayoutAction[] = [];
  let cleanText = text;

  const consume = (body: string) => {
    try {
      const parsed = JSON.parse(body.trim());
      const list: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { actions?: unknown }).actions)
        ? (parsed as { actions: unknown[] }).actions
        : [];
      let added = 0;
      for (const a of list) {
        if (a && typeof a === "object" && "type" in a) { actions.push(a as LayoutAction); added++; }
      }
      return added > 0;
    } catch {
      return false;
    }
  };

  // 1 + 2: bracket-delimited blocks (single OR double).
  const bracketRe = /\[\[?LAYOUT_ACTIONS\]?\]([\s\S]*?)\[\[?\/LAYOUT_ACTIONS\]?\]/g;
  cleanText = cleanText.replace(bracketRe, (_m, body: string) => { consume(body); return ""; });

  // 3: ```json ... ``` fences that contain an "actions" key. We don't
  // strip every fence indiscriminately — only ones that actually parse as
  // a layout-actions payload — so prose-y code samples are left alone.
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  cleanText = cleanText.replace(fenceRe, (m, body: string) => {
    const trimmed = body.trim();
    if (!/"actions"\s*:/.test(trimmed)) return m;
    return consume(trimmed) ? "" : m;
  });

  // 4: bare {"actions":[...]} at top level. Only run this if we have not
  // already harvested actions via the structured forms — otherwise a polite
  // narration like '{"actions":["resize"]}' inside prose would double-fire.
  if (actions.length === 0) {
    const bareRe = /\{[^{}]*"actions"\s*:\s*\[[\s\S]*?\][^{}]*\}/g;
    cleanText = cleanText.replace(bareRe, (m) => (consume(m) ? "" : m));
  }

  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();
  return { actions, cleanText };
}

/**
 * The LLM prompt fragment that teaches the Copilot how to mutate the layout.
 * Embedded into the presenter context message so the model knows this is a
 * real capability, not just narration.
 */
export function buildLayoutToolPrompt(charts: { id: string; title?: string; type?: string }[]): string {
  const chartList = charts.map((c) => `  - id: ${c.id}  (type: ${c.type ?? "?"}, title: ${c.title ?? ""})`).join("\n");
  return `\n[LAYOUT TOOLS]
You can rearrange and resize the on-screen charts by emitting a fenced action block in your reply. The user will see your prose and the dashboard will update automatically — do NOT describe the JSON itself in your prose.

Action block format (emit ONLY when the user asks for layout/resize/tidy/cleanup/reorder/hide/show changes):
${OPEN}
{ "actions": [
  { "type": "tidy" },
  { "type": "set_col_span", "chartId": "<id>", "span": 1 | 2 },
  { "type": "reorder", "ids": ["<id>", "<id>", ...] },
  { "type": "hide", "chartId": "<id>" },
  { "type": "show", "chartId": "<id>" }
] }
${CLOSE}

Rules:
- span: 1 = half-width, 2 = full-width.
- "tidy" is the catch-all for "make this look nice / beautify / clean up the layout".
- Use the chart ids below verbatim. Do not invent ids.
- After emitting actions, give the user one short sentence telling them what you did.

Available chart ids:
${chartList}
`;
}
