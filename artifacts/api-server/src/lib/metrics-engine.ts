// Metric engine: minimal validation + AI suggestion of starter KPIs.
//
// Formulas are stored as plain text. We don't evaluate them server-side here
// (the dashboard consumes them), but we do a lightweight syntax check so the
// UI can show errors before the user saves.

export type MetricStatus =
  | "ai_suggested"
  | "user_approved"
  | "certified"
  | "rejected";

export interface AuditEntry {
  at: string;
  action: string;
  by: string;
  note?: string;
}

const ALLOWED = /^[a-zA-Z0-9_+\-*/%().,:?!&|<>=\s"'\[\]]+$/;

export function validateFormula(formula: string): { ok: true } | { ok: false; error: string } {
  const trimmed = formula.trim();
  if (trimmed.length === 0) return { ok: false, error: "Formula cannot be empty" };
  if (trimmed.length > 1000) return { ok: false, error: "Formula too long" };
  if (!ALLOWED.test(trimmed)) return { ok: false, error: "Formula contains disallowed characters" };
  // Balance parens
  let depth = 0;
  for (const c of trimmed) {
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth < 0) return { ok: false, error: "Unbalanced parentheses" }; }
  }
  if (depth !== 0) return { ok: false, error: "Unbalanced parentheses" };
  return { ok: true };
}

export function appendAudit(
  log: AuditEntry[],
  entry: Omit<AuditEntry, "at">,
): AuditEntry[] {
  return [
    ...log,
    { at: new Date().toISOString(), ...entry },
  ];
}

export interface SuggestedMetric {
  name: string;
  description: string;
  formula: string;
  format: "number" | "currency" | "percent";
}

interface ColumnInfo {
  name: string;
  semanticType: string;
  businessMeaning?: string | null;
}

const SYSTEM_PROMPT = `You are a senior analytics consultant designing KPIs for a business dashboard.
You will receive a list of columns from a prepared dataset. Suggest 5-8 starter
KPIs (key performance indicators) that would be valuable to track for this data.

CRITICAL RULES:
1. Each KPI must use ONLY the column names provided.
2. Formulas use plain math: SUM(col), COUNT(col), COUNT_DISTINCT(col), AVG(col),
   MIN(col), MAX(col), and arithmetic +-*/() — keep it simple and explicit.
3. Choose format appropriately: "currency" for money, "percent" for ratios, "number" otherwise.
4. Keep names short and human (e.g. "Total Revenue", "Active Customers", "Avg Order Value").
5. Descriptions must explain what the KPI measures in one short sentence.

Respond with ONLY valid JSON in this exact shape (no markdown, no backticks):
{ "metrics": [ { "name": "...", "description": "...", "formula": "...", "format": "currency|percent|number" } ] }`;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

interface OpenAIChatClient {
  chat: {
    completions: {
      create: (args: {
        model: string;
        max_completion_tokens: number;
        messages: Array<{ role: "system" | "user"; content: string }>;
        response_format: { type: "json_object" };
      }) => Promise<ChatCompletionResponse>;
    };
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export async function suggestMetrics(
  openaiClient: OpenAIChatClient,
  opts: {
    datasetName: string;
    domain: string;
    columns: ColumnInfo[];
  },
): Promise<SuggestedMetric[]> {
  const colDescriptions = opts.columns
    .map((c) =>
      `  - "${c.name}" (${c.semanticType}${c.businessMeaning ? ` — ${c.businessMeaning}` : ""})`,
    )
    .join("\n");

  const userMessage = `Domain: ${opts.domain}
Prepared dataset: "${opts.datasetName}"

Columns:
${colDescriptions}

Suggest 5-8 starter KPIs.`;

  const resp = await openaiClient.chat.completions.create({
    model: "gpt-4.1-mini",
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
  });
  const content = resp.choices?.[0]?.message?.content;
  if (!content) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!isObject(parsed) || !Array.isArray(parsed.metrics)) return [];
  const out: SuggestedMetric[] = [];
  for (const raw of parsed.metrics) {
    if (!isObject(raw)) continue;
    const name = raw.name;
    const formula = raw.formula;
    if (typeof name !== "string" || typeof formula !== "string") continue;
    const v = validateFormula(formula);
    if (!v.ok) continue;
    const formatRaw = raw.format;
    const format: "number" | "currency" | "percent" =
      formatRaw === "currency" || formatRaw === "percent" ? formatRaw : "number";
    const description = typeof raw.description === "string" ? raw.description : "";
    out.push({
      name: name.slice(0, 80),
      description: description.slice(0, 240),
      formula: formula.trim(),
      format,
    });
  }
  return out;
}
