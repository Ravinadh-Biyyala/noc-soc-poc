import { useState, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { useGeneratedDashboards } from "@/lib/generated-dashboards";
import { getPack, DOMAIN_PACKS } from "@/lib/domain-packs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { ConnectorPickerDialog } from "@/components/ConnectorPickerDialog";
import { setPendingFile } from "@/lib/pending-file";
import { CONNECTORS } from "@/lib/connectors.config";
import {
  Plus,
  Briefcase,
  LayoutDashboard,
  AlertTriangle,
  Upload,
  ArrowRight,
  Sparkles,
  MessageSquare,
  Wand2,
  Package,
  FileSpreadsheet,
  Database,
  SendHorizonal,
} from "lucide-react";

function EmptyState({
  icon: Icon,
  label,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground gap-2">
      <Icon className="w-6 h-6 opacity-50" />
      <p className="text-xs">{label}</p>
      {action}
    </div>
  );
}

export default function Home() {
  const [createOpen, setCreateOpen] = useState(false);
  const [samplePackId, setSamplePackId] = useState<string | undefined>(undefined);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();
  const { data: workspaces, isLoading: wsLoading, error: wsError } = useListWorkspaces();
  const { dashboards } = useGeneratedDashboards();

  const openCreate = (packId?: string) => {
    setSamplePackId(packId);
    setCreateOpen(true);
  };

  const askCopilot = (seed?: string) => {
    window.dispatchEvent(new CustomEvent("copilot:focus", { detail: { seed } }));
  };

  const handleFileSelected = useCallback(
    (file: File) => {
      setPendingFile(file);
      setLocation("/upload");
    },
    [setLocation]
  );

  const handleHeroDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFileSelected(file);
    },
    [handleFileSelected]
  );

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = chatDraft.trim();
    if (!v) return;
    askCopilot(v);
    setChatDraft("");
  };

  const recentWorkspaces = (workspaces ?? []).slice(0, 4);
  const recentDashboards = dashboards.slice(0, 4);

  return (
    <div className="space-y-6 max-w-6xl" data-testid="page-home">
      {/* CHAT-FIRST FRONT DOOR ----------------------------------------- */}
      <Card className="border-primary/20 shadow-md bg-gradient-to-br from-primary/5 via-background to-background">
        <CardContent className="p-6 md:p-8 space-y-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-primary font-semibold">
                <Sparkles className="w-3.5 h-3.5" /> Gen-BI · Conversational analytics
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1.5">
                Hi — I'm Gen-BI. Let's build your first dashboard.
              </h1>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
                Drop your files, connect a data source, or just tell me what you have. I'll profile it, suggest joins, flag quality issues, and generate the dashboard.
              </p>
            </div>
          </div>

          {/* Two big tiles */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Files dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleHeroDrop}
              onClick={() => fileInputRef.current?.click()}
              className={
                "rounded-xl border-2 border-dashed p-5 cursor-pointer transition-all duration-200 bg-card " +
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
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    CSV · XLSX · XLS — up to 60 MB. I'll auto-generate a dashboard.
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-primary font-medium">
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

            {/* Connect a source */}
            <button
              type="button"
              onClick={() => setConnectorOpen(true)}
              className="rounded-xl border-2 border-dashed border-border p-5 text-left cursor-pointer transition-all duration-200 bg-card hover:border-primary/60 hover:bg-muted/40 group"
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
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    Salesforce · Snowflake · Databricks · SharePoint · Postgres
                  </div>
                  <div className="flex items-center gap-1 mt-2.5 flex-wrap">
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

          {/* Chat prompt */}
          <form onSubmit={handleChatSubmit} className="relative" data-testid="hero-chat-form">
            <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder="Or just tell me what you have — e.g. 'I have last quarter's sales data in Salesforce and a vendor list in SharePoint…'"
              className="pl-10 pr-12 h-11 text-sm bg-card"
              data-testid="hero-chat-input"
            />
            <button
              type="submit"
              disabled={!chatDraft.trim()}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-opacity"
              aria-label="Send to Copilot"
            >
              <SendHorizonal className="w-4 h-4" />
            </button>
          </form>

          {/* Sample chips */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Try a sample pack:
            </span>
            {DOMAIN_PACKS.slice(0, 5).map((p) => {
              const PI = p.icon;
              return (
                <button
                  key={p.id}
                  onClick={() => openCreate(p.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-card hover:border-primary/60 hover:bg-primary/5 text-[11px] font-medium transition-colors"
                  data-testid={`sample-pack-${p.id}`}
                >
                  <PI className="w-3 h-3 text-primary" /> {p.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* DEMO BAND — what already works ---------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" /> Recent workspaces
              </CardTitle>
              <CardDescription className="text-xs">Jump back into recent analysis.</CardDescription>
            </div>
            <Link href="/workspaces">
              <button className="text-[11px] text-primary hover:underline">View all</button>
            </Link>
          </CardHeader>
          <CardContent>
            {wsLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 rounded-md" />
                ))}
              </div>
            ) : wsError ? (
              <EmptyState icon={AlertTriangle} label="Could not load workspaces." />
            ) : recentWorkspaces.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                label="No workspaces yet."
                action={
                  <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                    Create your first
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-1">
                {recentWorkspaces.map((w) => {
                  const pack = getPack(w.packId);
                  const PackIcon = pack.icon;
                  return (
                    <li key={w.id}>
                      <Link href={`/workspaces/${w.id}`}>
                        <div
                          className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/40 cursor-pointer group"
                          data-testid={`workspace-card-${w.id}`}
                        >
                          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <PackIcon className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">{w.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {pack.label} · {w.fileCount} files · {w.dashboardCount} dashboards
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Quick actions
            </CardTitle>
            <CardDescription className="text-xs">Common starting points.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <Link href="/upload">
              <Button variant="outline" size="sm" className="justify-start w-full" data-testid="quick-upload">
                <Upload className="w-4 h-4 mr-2" /> Upload data
              </Button>
            </Link>
            <Button variant="outline" size="sm" className="justify-start w-full" onClick={() => openCreate()} data-testid="quick-create-workspace">
              <Plus className="w-4 h-4 mr-2" /> Create workspace
            </Button>
            <Button variant="outline" size="sm" className="justify-start w-full" onClick={() => askCopilot()} data-testid="quick-ask">
              <MessageSquare className="w-4 h-4 mr-2" /> Ask Gen-BI
            </Button>
            <Link href="/dashboards">
              <Button variant="outline" size="sm" className="justify-start w-full" data-testid="quick-dashboards">
                <LayoutDashboard className="w-4 h-4 mr-2" /> Browse dashboards
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="justify-start w-full"
              onClick={() => openCreate(DOMAIN_PACKS[0].id)}
              data-testid="quick-sample-pack"
            >
              <Package className="w-4 h-4 mr-2" /> Try a sample pack
              <ArrowRight className="w-3 h-3 ml-auto opacity-60" />
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <LayoutDashboard className="w-4 h-4 text-primary" /> Recent dashboards
            </CardTitle>
            <CardDescription className="text-xs">Generated from your uploads.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentDashboards.length === 0 ? (
              <EmptyState
                icon={LayoutDashboard}
                label="No generated dashboards yet — drop a file above to make one."
                action={
                  <Link href="/dashboards">
                    <Button size="sm" variant="outline">Browse built-in dashboards</Button>
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-1">
                {recentDashboards.map((d) => (
                  <li key={d.id}>
                    <Link href={d.route}>
                      <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/40 cursor-pointer">
                        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <LayoutDashboard className="w-4 h-4 text-primary" />
                        </div>
                        <div className="text-sm font-medium text-foreground truncate flex-1">{d.title}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" /> What's new
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[12px]">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="text-[10px] mt-0.5">New</Badge>
              <span className="text-muted-foreground">Conversational front door — drop files or connect a source from Home.</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="text-[10px] mt-0.5">New</Badge>
              <span className="text-muted-foreground">5 connectors: Salesforce, Snowflake, Databricks, SharePoint, Postgres.</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setSamplePackId(undefined);
        }}
        defaultPackId={samplePackId}
      />
      <ConnectorPickerDialog open={connectorOpen} onOpenChange={setConnectorOpen} />
    </div>
  );
}
