import { useEffect, useState } from "react";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { DOMAIN_PACKS } from "@/lib/domain-packs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Building2, Palette, HardDrive, Layers, Bot, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const THEMES: { id: string; label: string; description: string }[] = [
  { id: "light", label: "Light", description: "Bright corporate look — best for daylight." },
  { id: "dark", label: "Dark", description: "Reduced glare for late-night analysis." },
  { id: "system", label: "System", description: "Follow your operating system preference." },
];

const AI_TONES: { id: string; label: string; description: string }[] = [
  { id: "concise", label: "Concise", description: "Short, punchy answers focused on the headline number." },
  { id: "balanced", label: "Balanced", description: "Default mix of explanation and detail." },
  { id: "detailed", label: "Detailed", description: "Long-form answers with caveats and methodology." },
];

const AI_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"];

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetSettings();
  const update = useUpdateSettings();

  const [organizationName, setOrganizationName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [theme, setTheme] = useState("light");
  const [fileSizeLimitMb, setFileSizeLimitMb] = useState<number>(60);
  const [defaultPackId, setDefaultPackId] = useState<string>("");
  const [aiTone, setAiTone] = useState("balanced");
  const [aiModel, setAiModel] = useState("gpt-4.1-mini");

  useEffect(() => {
    if (data) {
      setOrganizationName(data.organizationName ?? "");
      setProfileName(data.profileName ?? "");
      setProfileEmail(data.profileEmail ?? "");
      setTimezone(data.timezone ?? "UTC");
      setTheme(data.theme ?? "light");
      setFileSizeLimitMb(data.fileSizeLimitMb ?? 60);
      setDefaultPackId(data.defaultPackId ?? "");
      setAiTone(data.aiTone ?? "balanced");
      setAiModel(data.aiModel ?? "gpt-4.1-mini");
    }
  }, [data]);

  const handleSave = async () => {
    try {
      await update.mutateAsync({
        data: {
          organizationName: organizationName || null,
          profileName: profileName || null,
          profileEmail: profileEmail || null,
          timezone,
          theme: theme as "light" | "dark" | "system",
          fileSizeLimitMb,
          defaultPackId: defaultPackId || null,
          aiTone: aiTone as "concise" | "balanced" | "detailed",
          aiModel,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Settings saved" });
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const SaveBar = ({ testid }: { testid: string }) => (
    <div className="flex justify-end">
      <Button onClick={handleSave} disabled={update.isPending} data-testid={testid}>
        {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
        Save
      </Button>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl" data-testid="page-settings">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your organization, theme, file limits, default domain pack and AI behavior.
        </p>
      </div>

      <Tabs defaultValue="organization">
        <TabsList>
          <TabsTrigger value="organization" data-testid="tab-organization">Organization</TabsTrigger>
          <TabsTrigger value="theme" data-testid="tab-theme">Theme</TabsTrigger>
          <TabsTrigger value="files" data-testid="tab-files">File limits</TabsTrigger>
          <TabsTrigger value="packs" data-testid="tab-packs">Domain packs</TabsTrigger>
          <TabsTrigger value="ai" data-testid="tab-ai">AI behavior</TabsTrigger>
        </TabsList>

        <TabsContent value="organization" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" /> Organization
              </CardTitle>
              <CardDescription>How your team appears across Gen-BI.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="org">Organization name</Label>
                <Input
                  id="org"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Acme Brokerage"
                  data-testid="input-organization-name"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Display name</Label>
                  <Input
                    id="name"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="Your name"
                    data-testid="input-profile-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    placeholder="you@example.com"
                    data-testid="input-profile-email"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tz">Timezone</Label>
                <Input
                  id="tz"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="UTC"
                  data-testid="input-timezone"
                />
              </div>
              <SaveBar testid="button-save-organization" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="theme" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="w-4 h-4 text-primary" /> Theme
              </CardTitle>
              <CardDescription>
                Pick a default look. (Applied across the workspace once the theme switcher ships.)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {THEMES.map((t) => {
                  const selected = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme(t.id)}
                      data-testid={`theme-${t.id}`}
                      className={cn(
                        "p-3 rounded-md border text-left transition-colors",
                        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{t.label}</span>
                        {selected && <Check className="w-4 h-4 text-primary" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">{t.description}</p>
                    </button>
                  );
                })}
              </div>
              <SaveBar testid="button-save-theme" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-primary" /> File limits
              </CardTitle>
              <CardDescription>Cap the size of CSV / XLSX uploads per file.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="file-size">Max upload size (MB)</Label>
                <Input
                  id="file-size"
                  type="number"
                  min={1}
                  max={500}
                  value={fileSizeLimitMb}
                  onChange={(e) => setFileSizeLimitMb(Number(e.target.value) || 0)}
                  data-testid="input-file-size-limit"
                />
                <p className="text-[11px] text-muted-foreground">
                  Files larger than this are rejected by the upload API. Allowed range: 1–500 MB.
                </p>
              </div>
              <SaveBar testid="button-save-files" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="packs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" /> Domain packs
              </CardTitle>
              <CardDescription>Auto-select this pack when creating a new workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DOMAIN_PACKS.map((p) => {
                  const Icon = p.icon;
                  const selected = defaultPackId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDefaultPackId(selected ? "" : p.id)}
                      className={cn(
                        "flex items-center gap-2.5 p-3 rounded-md border text-left transition-colors",
                        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                      )}
                      data-testid={`default-pack-${p.id}`}
                    >
                      <div className={cn("w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0", selected ? "bg-primary text-white" : "bg-muted")}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold">{p.label}</div>
                        <div className="text-[11px] text-muted-foreground line-clamp-1">{p.industry}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <SaveBar testid="button-save-packs" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" /> AI behavior
              </CardTitle>
              <CardDescription>Tune how the Copilot responds and which model to use.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Response tone</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {AI_TONES.map((t) => {
                    const selected = aiTone === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setAiTone(t.id)}
                        data-testid={`ai-tone-${t.id}`}
                        className={cn(
                          "p-3 rounded-md border text-left transition-colors",
                          selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">{t.label}</span>
                          {selected && <Check className="w-4 h-4 text-primary" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">{t.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-model">Model</Label>
                <Select value={aiModel} onValueChange={setAiModel}>
                  <SelectTrigger id="ai-model" data-testid="select-ai-model">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Used by the Gen-BI Copilot. Smaller models respond faster; larger ones reason better.
                </p>
              </div>
              <SaveBar testid="button-save-ai" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
