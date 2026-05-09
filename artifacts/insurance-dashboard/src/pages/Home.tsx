import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { ConnectorPickerDialog } from "@/components/ConnectorPickerDialog";
import { setPendingFile } from "@/lib/pending-file";
import { CONNECTORS } from "@/lib/connectors.config";
import {
  Upload,
  ArrowRight,
  Sparkles,
  FileSpreadsheet,
  Database,
} from "lucide-react";

export default function Home() {
  const [createOpen, setCreateOpen] = useState(false);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();

  const handleFileSelected = useCallback(
    (file: File) => {
      setPendingFile(file);
      setLocation("/upload");
    },
    [setLocation],
  );

  const handleHeroDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFileSelected(file);
    },
    [handleFileSelected],
  );

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
              Drop your files or connect a data source. I'll review the data,
              suggest fixes for anything that looks off, and put together a
              dashboard for you.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleHeroDrop}
              onClick={() => fileInputRef.current?.click()}
              className={
                "rounded-xl border-2 border-dashed p-6 cursor-pointer transition-all duration-200 bg-card " +
                (dragActive
                  ? "border-primary bg-primary/5 scale-[1.01] shadow-sm"
                  : "border-border hover:border-primary/60 hover:bg-muted/40")
              }
              data-testid="hero-file-drop"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Upload className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">Drop files here</div>
                  <div className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                    CSV, XLSX or XLS — up to 60 MB. I'll build the dashboard automatically.
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 text-[11px] text-primary font-medium">
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Or click to browse
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelected(file);
                  e.target.value = "";
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => setConnectorOpen(true)}
              className="rounded-xl border-2 border-dashed border-border p-6 text-left cursor-pointer transition-all duration-200 bg-card hover:border-primary/60 hover:bg-muted/40 group"
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
          </div>
        </CardContent>
      </Card>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <ConnectorPickerDialog open={connectorOpen} onOpenChange={setConnectorOpen} />
    </div>
  );
}
