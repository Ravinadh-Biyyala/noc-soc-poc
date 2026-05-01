import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useCreateWorkspace,
  getListWorkspacesQueryKey,
  useGetSettings,
} from "@workspace/api-client-react";
import { DOMAIN_PACKS, type DomainPack } from "@/lib/domain-packs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPackId?: string;
}

export function CreateWorkspaceDialog({ open, onOpenChange, defaultPackId }: Props) {
  // Resolve the initial pack with this priority:
  //   1. explicit `defaultPackId` prop (e.g. Home "Try a sample pack")
  //   2. organization-wide `settings.defaultPackId`
  //   3. first available pack as a final fallback
  const { data: settings } = useGetSettings();
  const knownPackIds = new Set(DOMAIN_PACKS.map((p) => p.id));
  const settingsPack =
    settings?.defaultPackId && knownPackIds.has(settings.defaultPackId)
      ? settings.defaultPackId
      : undefined;
  const resolvedDefault = defaultPackId ?? settingsPack ?? DOMAIN_PACKS[0].id;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [packId, setPackId] = useState<string>(resolvedDefault);
  const [error, setError] = useState<string | null>(null);

  // If the dialog is closed and the resolved default later changes (settings
  // load after mount, or the user navigates between sample-pack/regular flows),
  // make sure the next open reflects the freshest default.
  useEffect(() => {
    if (!open) {
      setPackId(resolvedDefault);
    }
  }, [open, resolvedDefault]);

  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const createMut = useCreateWorkspace();

  const reset = () => {
    setName("");
    setDescription("");
    setPackId(resolvedDefault);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please give the workspace a name.");
      return;
    }
    setError(null);
    try {
      const created = await createMut.mutateAsync({
        data: { name: name.trim(), packId, description: description.trim() || undefined },
      });
      await queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
      reset();
      onOpenChange(false);
      setLocation(`/workspaces/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create workspace.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a new workspace</DialogTitle>
          <DialogDescription>
            Pick a domain pack to seed metrics, dashboards and Copilot prompts.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 Renewal Analysis"
              data-testid="input-workspace-name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-desc">Description (optional)</Label>
            <Input
              id="ws-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What question does this workspace answer?"
              data-testid="input-workspace-description"
            />
          </div>
          <div className="space-y-2">
            <Label>Domain pack</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DOMAIN_PACKS.map((p: DomainPack) => {
                const Icon = p.icon;
                const selected = packId === p.id;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setPackId(p.id)}
                    data-testid={`pack-${p.id}`}
                    className={cn(
                      "flex items-start gap-2.5 p-3 rounded-md border text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/40",
                    )}
                  >
                    <div className={cn("w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0", selected ? "bg-primary text-white" : "bg-muted text-foreground")}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-xs font-semibold text-foreground">{p.label}</div>
                      <div className="text-[11px] text-muted-foreground line-clamp-2">{p.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          {error && (
            <p className="text-xs text-red-600" data-testid="error-message">{error}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMut.isPending} data-testid="button-create-workspace">
              {createMut.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create workspace"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
