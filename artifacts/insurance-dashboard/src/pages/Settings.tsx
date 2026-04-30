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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Sparkles, Bell, ShieldCheck, Plug } from "lucide-react";

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetSettings();
  const update = useUpdateSettings();

  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [defaultPackId, setDefaultPackId] = useState<string>("");

  useEffect(() => {
    if (data) {
      setProfileName(data.profileName ?? "");
      setProfileEmail(data.profileEmail ?? "");
      setTimezone(data.timezone ?? "UTC");
      setDefaultPackId(data.defaultPackId ?? "");
    }
  }, [data]);

  const handleSave = async () => {
    try {
      await update.mutateAsync({
        data: {
          profileName: profileName || null,
          profileEmail: profileEmail || null,
          timezone,
          defaultPackId: defaultPackId || null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Settings saved" });
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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

  return (
    <div className="space-y-6 max-w-3xl" data-testid="page-settings">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Profile, defaults and platform preferences.</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="defaults">Defaults</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
              <CardDescription>How you appear in this workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Your name" data-testid="input-profile-name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} placeholder="you@example.com" data-testid="input-profile-email" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tz">Timezone</Label>
                <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" data-testid="input-timezone" />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={update.isPending} data-testid="button-save-profile">
                  {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="defaults" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Defaults
              </CardTitle>
              <CardDescription>Auto-select these for new workspaces.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Default domain pack</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DOMAIN_PACKS.map((p) => {
                    const Icon = p.icon;
                    const selected = defaultPackId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setDefaultPackId(selected ? "" : p.id)}
                        className={`flex items-center gap-2.5 p-3 rounded-md border text-left transition-colors ${
                          selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                        }`}
                        data-testid={`default-pack-${p.id}`}
                      >
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${selected ? "bg-primary text-white" : "bg-muted"}`}>
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
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={update.isPending} data-testid="button-save-defaults">
                  {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card>
            <CardContent className="py-10 flex flex-col items-center text-center gap-2 text-muted-foreground">
              <Bell className="w-6 h-6 opacity-50" />
              <p className="text-sm font-medium text-foreground">Notification preferences</p>
              <p className="text-xs max-w-sm">Email and in-app alerts for data quality and approvals will live here.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card>
            <CardContent className="py-10 flex flex-col items-center text-center gap-2 text-muted-foreground">
              <ShieldCheck className="w-6 h-6 opacity-50" />
              <p className="text-sm font-medium text-foreground">Security</p>
              <p className="text-xs max-w-sm">Auth, SSO and session management arrive in the Enterprise layer.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-4">
          <Card>
            <CardContent className="py-10 flex flex-col items-center text-center gap-2 text-muted-foreground">
              <Plug className="w-6 h-6 opacity-50" />
              <p className="text-sm font-medium text-foreground">Integrations</p>
              <p className="text-xs max-w-sm">Hook up Google Sheets, Snowflake, Postgres and more in a later release.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
