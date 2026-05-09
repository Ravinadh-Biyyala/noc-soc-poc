// Phase 4 — "The Why Panel" support library.
//
// Generates a deterministic, plain-English narrative for any KPI or chart on
// the dashboard, plus the lineage (source data + operations) that produced it,
// and an auditor-friendly export bundle (JSON download + printable HTML).
//
// Kept fully client-side and template-driven on purpose: instant, offline,
// no AI cost, and the math/lineage we cite is *exactly* what the chart code
// computes — never a hallucination.

export type ExplainKind = "kpi" | "chart";

export interface ExplainContext {
  kind: ExplainKind;
  title: string;
  // KPI specifics
  value?: unknown;
  format?: string;
  changePct?: number;
  // Chart specifics
  chartType?: string;
  xKey?: string;
  yKeys?: string[];
  data?: unknown[];
  // Lineage
  source?: string; // e.g. "policies.csv" or "Section: Brokerage"
  operations?: ReadonlyArray<{ kind: string; summary: string }>;
  // Free-form notes the caller wants to surface (filters in effect, etc.)
  notes?: string[];
}

export interface NarrativeBlock {
  heading: string;
  body: string;
}

const fmtNum = (n: number): string => {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const fmtValue = (val: unknown, format?: string): string => {
  if (typeof val !== "number" || !Number.isFinite(val)) return String(val ?? "—");
  if (format === "currency" || format === "currency-compact") return `$${fmtNum(val)}`;
  if (format === "percent") {
    // Heuristic: 0.42 → 42%, 42 → 42%
    const pct = Math.abs(val) <= 1 ? val * 100 : val;
    return `${pct.toFixed(1)}%`;
  }
  return fmtNum(val);
};

function pickNumeric(rows: unknown[], key: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    if (r && typeof r === "object") {
      const v = (r as Record<string, unknown>)[key];
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

function topN(
  rows: unknown[],
  labelKey: string,
  valueKey: string,
  n: number,
): Array<{ label: string; value: number }> {
  const items: Array<{ label: string; value: number }> = [];
  for (const r of rows) {
    if (r && typeof r === "object") {
      const o = r as Record<string, unknown>;
      const v = typeof o[valueKey] === "number" ? (o[valueKey] as number) : Number(o[valueKey]);
      if (Number.isFinite(v)) items.push({ label: String(o[labelKey] ?? "—"), value: v });
    }
  }
  items.sort((a, b) => b.value - a.value);
  return items.slice(0, n);
}

/**
 * Produce the narrative block list for the panel.
 * The tone is intentionally short, factual, and auditable — these sentences
 * will end up in a PDF that goes to compliance/auditors.
 */
export function narrate(ctx: ExplainContext): NarrativeBlock[] {
  const blocks: NarrativeBlock[] = [];

  if (ctx.kind === "kpi") {
    const v = fmtValue(ctx.value, ctx.format);
    const change =
      typeof ctx.changePct === "number" && Number.isFinite(ctx.changePct)
        ? `${ctx.changePct > 0 ? "↑" : ctx.changePct < 0 ? "↓" : "·"} ${Math.abs(ctx.changePct).toFixed(1)}% YoY`
        : null;
    blocks.push({
      heading: "What this is",
      body: `**${v}** — ${ctx.title}.${change ? ` ${change}.` : ""}`,
    });
  } else {
    const rows = ctx.data ?? [];
    const n = rows.length;
    const xKey = ctx.xKey || "category";
    const yKey = ctx.yKeys?.[0] || "value";
    const nums = pickNumeric(rows, yKey);
    const total = nums.reduce((a, b) => a + b, 0);
    const top = topN(rows, xKey, yKey, 3);

    const lines: string[] = [];
    lines.push(`**${ctx.title}** — ${n} ${n === 1 ? "row" : "rows"} of \`${yKey}\` by \`${xKey}\`.`);
    if (nums.length > 0) {
      lines.push(`Total: **${fmtNum(total)}**, average: **${fmtNum(total / nums.length)}**.`);
    }
    if (top.length > 0) {
      const topLine = top
        .map((t) => `**${t.label}** (${fmtNum(t.value)}${total > 0 ? `, ${((t.value / total) * 100).toFixed(0)}%` : ""})`)
        .join(", ");
      lines.push(`Top: ${topLine}.`);
    }
    blocks.push({ heading: "What this shows", body: lines.join(" ") });
  }

  // Lineage — always present so the auditor can trace the number.
  const lineageLines: string[] = [];
  if (ctx.source) lineageLines.push(`**Source:** ${ctx.source}`);
  if (ctx.operations && ctx.operations.length > 0) {
    lineageLines.push("**Operations applied:**");
    for (const op of ctx.operations) lineageLines.push(`• ${op.kind} — ${op.summary}`);
  } else {
    lineageLines.push("**Operations applied:** none (raw source).");
  }
  blocks.push({ heading: "How it was built", body: lineageLines.join("\n") });

  if (ctx.notes && ctx.notes.length > 0) {
    blocks.push({ heading: "Notes", body: ctx.notes.map((n) => `• ${n}`).join("\n") });
  }

  return blocks;
}

/**
 * Auditor bundle — JSON download (machine-readable lineage) plus an opt-in
 * printable HTML window the user can save as PDF via the browser print
 * dialog. We deliberately avoid jsPDF/html2canvas to keep the bundle small
 * and the PDF identical to what's on screen.
 */
export function exportAuditorBundle(
  ctx: ExplainContext,
  narrative: NarrativeBlock[],
  opts: { print?: boolean } = { print: true },
): void {
  const stamp = new Date().toISOString();
  const safeTitle = ctx.title.replace(/[^\w. -]+/g, "_").slice(0, 60) || "explain";

  // 1. JSON bundle
  const bundle = {
    generatedAt: stamp,
    artifact: "Gen-BI Asset",
    kind: ctx.kind,
    title: ctx.title,
    value: ctx.value,
    format: ctx.format,
    changePct: ctx.changePct,
    chartType: ctx.chartType,
    xKey: ctx.xKey,
    yKeys: ctx.yKeys,
    rowCount: ctx.data?.length ?? null,
    // Cap the data dump so the file stays compact and pasteable.
    sampleRows: (ctx.data ?? []).slice(0, 50),
    source: ctx.source,
    operations: ctx.operations ?? [],
    notes: ctx.notes ?? [],
    narrative,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeTitle}-lineage-${stamp.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  // 2. Printable HTML (optional — true by default)
  if (opts.print === false) return;
  const win = window.open("", "_blank", "width=820,height=1000");
  if (!win) return; // popup blocked → JSON download still happened, fine.
  const esc = (s: string): string =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] || c);
  const mdLite = (s: string): string =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br/>");
  const sections = narrative
    .map((b) => `<section><h2>${esc(b.heading)}</h2><p>${mdLite(b.body)}</p></section>`)
    .join("");
  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>Audit — ${esc(ctx.title)}</title>
<style>
  body { font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #0f172a; max-width: 720px; margin: 32px auto; padding: 0 24px; }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header .meta { color: #64748b; font-size: 11px; }
  section { margin: 18px 0; page-break-inside: avoid; }
  section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; margin: 0 0 6px; }
  section p { margin: 0; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10px; }
  @media print { body { margin: 0; } header { border-color: #000; } }
</style></head><body>
<header>
  <h1>${esc(ctx.title)}</h1>
  <div class="meta">Gen-BI Asset · ${ctx.kind === "kpi" ? "KPI" : `Chart (${esc(ctx.chartType ?? "")})`} · Generated ${esc(stamp)}</div>
</header>
${sections}
<footer>Auditor export — narrative and lineage are produced deterministically from the same data the dashboard renders.</footer>
<script>setTimeout(function(){window.print();}, 250);</script>
</body></html>`);
  win.document.close();
}
