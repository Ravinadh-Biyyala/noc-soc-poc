import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListWorkspacesQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Copy, Check, Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Type-to-confirm project deletion. The user must type the exact project name
 * (shown in a copyable box) before the destructive action enables. Deleting a
 * project cascades on the server: dashboards, pinned charts, uploaded data,
 * warehouse/raw schemas, semantic model, metrics — everything tied to it.
 */
export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { id: number; name: string } | null;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const name = project?.name ?? "";
  const matches = name.length > 0 && confirm.trim() === name.trim();

  useEffect(() => {
    if (open) { setConfirm(""); setCopied(false); }
  }, [open]);

  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const doDelete = async () => {
    if (!project || !matches || busy) return;
    setBusy(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const r = await fetch(`${base}/api/workspaces/${project.id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok && r.status !== 204) throw new Error(`Delete failed (${r.status})`);
      await qc.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
      toast({ title: "Project deleted", description: `"${name}" and all its data were removed.` });
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "Could not delete the project." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" /> Delete project
          </DialogTitle>
          <DialogDescription>
            This permanently deletes <strong className="text-foreground">{name}</strong> and{" "}
            <strong className="text-foreground">everything</strong> in it — dashboards, pinned charts,
            uploaded data, warehouse tables, semantic model, metrics, and its Postgres schemas.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Type the project name to confirm:</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-muted px-2.5 py-1.5 rounded border truncate" title={name}>{name}</code>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8 flex-shrink-0" onClick={copyName} title="Copy name">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
          <Input
            autoFocus
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={`Type "${name}" to confirm`}
            onKeyDown={(e) => { if (e.key === "Enter" && matches) doDelete(); }}
            data-testid="delete-project-confirm-input"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={doDelete} disabled={!matches || busy} className="gap-1.5" data-testid="delete-project-confirm-button">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
