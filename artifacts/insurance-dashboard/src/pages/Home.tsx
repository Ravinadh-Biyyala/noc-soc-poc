import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectorPickerDialog } from "@/components/ConnectorPickerDialog";
import { CONNECTORS } from "@/lib/connectors.config";
import { useRegisterObservation } from "@/lib/chat-observer";
import {
  ArrowRight,
  Sparkles,
  Database,
} from "lucide-react";

export default function Home() {
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [autoOpenGoogleSheets, setAutoOpenGoogleSheets] = useState(false);

  useRegisterObservation(
    useMemo(
      () => ({
        label: "Home",
        kind: "home" as const,
        summary: "The user is on the front-door page. They can connect a data source. No specific dataset or project is active.",
        suggestions: [
          "What's the fastest way to get started?",
          "Which connector should I use?",
        ],
      }),
      [],
    ),
  );

  // After Google OAuth callback, the URL will include ?google_connected=1.
  // Auto-open the connector dialog directly to the Google Sheets picker.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connected") === "1") {
      setAutoOpenGoogleSheets(true);
      setConnectorOpen(true);
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
  }, []);

  return (
    <div className="max-w-4xl mx-auto" data-testid="page-home">
      <Card className="border-primary/20 shadow-md bg-gradient-to-br from-primary/5 via-background to-background">
        <CardContent className="p-8 md:p-10 space-y-7">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary font-semibold">
              <Sparkles className="w-3.5 h-3.5" /> Gen-BI · Conversational analytics
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mt-2">
              Hi — I'm Gen-BI. Let's build your first dashboard.
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">
              Connect a data source and I'll put together a dashboard for you.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setConnectorOpen(true)}
            className="w-full rounded-xl border-2 border-dashed border-border p-6 text-left cursor-pointer transition-all duration-200 bg-card hover:border-primary/60 hover:bg-muted/40 group"
            data-testid="hero-connect-source"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Database className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  Connect a data source
                  <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-primary" />
                </div>
                <div className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                  Salesforce, Snowflake, Databricks, SharePoint or Postgres.
                </div>
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {CONNECTORS.slice(0, 5).map((c) => {
                    const Icon = c.icon;
                    return (
                      <span
                        key={c.id}
                        className={`inline-flex items-center justify-center w-6 h-6 rounded border ${c.accent}`}
                        title={c.label}
                      >
                        <Icon className="w-3 h-3" />
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </button>
        </CardContent>
      </Card>

      <ConnectorPickerDialog
        open={connectorOpen}
        onOpenChange={(v) => {
          setConnectorOpen(v);
          if (!v) setAutoOpenGoogleSheets(false);
        }}
        autoOpenGoogleSheets={autoOpenGoogleSheets}
      />
    </div>
  );
}
