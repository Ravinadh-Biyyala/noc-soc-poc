// Shared formatting + severity styling for NOC components (dashboard, drawer, chat
// cards). Keeps colours/number/time formatting consistent across every surface.

export function fmtNum(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(Number(ts)).toLocaleString();
}

export function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const diff = Date.now() - Number(ts);
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const SEV = (s: string | null | undefined) => String(s ?? "").toLowerCase();

/** Tailwind classes for a severity pill/badge (bg + border + text). */
export function severityBadge(sev: string | null | undefined): string {
  switch (SEV(sev)) {
    case "critical":
    case "error":
      return "bg-rose-500/15 border-rose-500/50 text-rose-300";
    case "high":
      return "bg-orange-500/15 border-orange-500/50 text-orange-300";
    case "warning":
    case "warn":
      return "bg-amber-500/15 border-amber-500/50 text-amber-300";
    case "info":
      return "bg-cyan-500/15 border-cyan-500/50 text-cyan-300";
    default:
      return "bg-slate-500/15 border-slate-500/50 text-slate-300";
  }
}

/** A solid hex colour for a severity (charts/dots). */
export function severityColor(sev: string | null | undefined): string {
  switch (SEV(sev)) {
    case "critical":
    case "error":
      return "#f43f5e";
    case "high":
      return "#f97316";
    case "warning":
    case "warn":
      return "#f59e0b";
    case "info":
      return "#22d3ee";
    default:
      return "#94a3b8";
  }
}

/** Tone for a performance-metric value (green ok → amber → red), threshold-based. */
export function metricTone(metric: string, value: number | null | undefined): string {
  if (value == null) return "text-muted-foreground";
  const v = Number(value);
  if (metric === "latency_ms") return v >= 100 ? "text-rose-400" : v >= 40 ? "text-amber-400" : "text-emerald-400";
  // percentage metrics (cpu / interface utilization)
  return v >= 85 ? "text-rose-400" : v >= 65 ? "text-amber-400" : "text-emerald-400";
}
