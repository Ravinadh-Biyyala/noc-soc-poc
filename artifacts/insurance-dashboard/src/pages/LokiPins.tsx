// Pinned Visuals — the dashboard of charts the BI Companion pinned from chat.
// Each card persists in the `loki` Postgres DB (via /api/loki-pins) with its
// query metadata, so Refresh re-runs the query and pulls in new data.

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutDashboard, RefreshCw, X, Sparkles, AlertCircle } from "lucide-react";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useLokiPins, isRefreshable, type LokiPin } from "@/lib/loki-pins";
import LokiChart from "@/components/loki/LokiChart";
import { useToast } from "@/hooks/use-toast";

function updatedAgo(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function PinCard({ pin, onRemove, onRefresh }: { pin: LokiPin; onRemove: () => void; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const refreshable = isRefreshable(pin);

  const refresh = async () => {
    setBusy(true);
    try { await onRefresh(); } finally { setBusy(false); }
  };

  return (
    <Card className="group relative">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <CardTitle className="text-sm font-semibold truncate">{pin.title}</CardTitle>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary disabled:opacity-40"
            onClick={refresh}
            disabled={!refreshable || busy}
            title={refreshable ? "Refresh with live data" : "Static snapshot — no re-runnable query"}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-red-500"
            onClick={onRemove}
            title="Remove"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <LokiChart type={pin.type} xKey={pin.xKey} yKey={pin.yKey} data={pin.data} colors={pin.colors} />
        {pin.summary && <p className="text-[11px] text-muted-foreground mt-2">{pin.summary}</p>}
        <div className="flex items-center justify-between mt-1 gap-2">
          {pin.logql && <code className="text-[10px] text-muted-foreground font-mono break-all min-w-0 truncate">{pin.logql}</code>}
          {pin.updatedAt && <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">updated {updatedAgo(pin.updatedAt)}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function LokiPins() {
  const { pins, loading, error, removePin, refreshPin, refreshAll } = useLokiPins();
  const { toast } = useToast();
  const [refreshingAll, setRefreshingAll] = useState(false);

  useRegisterObservation(
    useMemo(
      () => ({
        label: "Pinned Visuals",
        kind: "other" as const,
        summary:
          `User is on the Pinned Visuals dashboard (${pins.length} chart${pins.length === 1 ? "" : "s"} pinned from Loki log analysis). ` +
          "Each chart stores its LogQL query and can be refreshed with live data. Ask me to chart more Loki metrics and I'll pin them here.",
        suggestions: [
          "Chart alert volume over time for the last 6 hours",
          "Count alerts by severity over 24h and chart it",
          "Which device produces the most warnings? Chart it.",
        ],
      }),
      [pins.length],
    ),
  );

  const doRefreshAll = useCallback(async () => {
    setRefreshingAll(true);
    try {
      await refreshAll();
      toast({ title: "Refreshed", description: "Pinned visuals updated with live data." });
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshAll, toast]);

  const refreshableCount = pins.filter(isRefreshable).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Pinned Visuals</h1>
          <span className="text-xs text-muted-foreground">{pins.length} chart{pins.length === 1 ? "" : "s"}</span>
        </div>
        {refreshableCount > 0 && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={doRefreshAll} disabled={refreshingAll}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingAll ? "animate-spin" : ""}`} />
            Refresh all
          </Button>
        )}
      </div>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
      ) : pins.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <LayoutDashboard className="w-7 h-7 opacity-40" />
            <p className="text-sm font-medium text-foreground">No pinned visuals yet</p>
            <p className="text-xs max-w-sm text-center">
              Ask the BI Companion something like “Count alerts by severity over the last 24h and chart it.” The chart it creates is pinned here and can be refreshed anytime.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {pins.map((pin) => (
            <PinCard key={pin.id} pin={pin} onRemove={() => removePin(pin.id)} onRefresh={() => refreshPin(pin.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
