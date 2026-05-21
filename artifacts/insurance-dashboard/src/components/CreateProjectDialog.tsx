import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useCreateWorkspace,
  getListWorkspacesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Projects are built on top of the workspaces table (same id space, same
 * /api/workspaces endpoints). The user-facing concept is a Project with a
 * 3-phase pipeline; internally the row lives in the workspaces table for now.
 *
 * On create the server also provisions proj_{id}_raw and proj_{id}_warehouse
 * Postgres schemas — see lib/db/src/project-schemas.ts.
 */
export function CreateProjectDialog({ open, onOpenChange }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const createMut = useCreateWorkspace();

  const reset = () => {
    setName("");
    setDescription("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please give the project a name.");
      return;
    }
    setError(null);
    try {
      // packId is not user-facing for Projects; default to a generic pack so
      // the existing API contract is satisfied without exposing domain packs.
      const created = await createMut.mutateAsync({
        data: {
          name: name.trim(),
          packId: "custom",
          description: description.trim() || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
      reset();
      onOpenChange(false);
      setLocation(`/projects/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project.");
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
          <DialogTitle>Create a new project</DialogTitle>
          <DialogDescription>
            A project is an isolated workspace with its own raw + warehouse Postgres schemas.
            You'll move through three phases: Data Engineering, Dashboards, and Chat.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Project name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 Claims Risk Analysis"
              data-testid="input-project-name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-desc">Description</Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What question does this project answer? The agent uses this to tailor transformation suggestions."
              rows={3}
              data-testid="input-project-description"
            />
          </div>
          {error && (
            <p className="text-xs text-red-600" data-testid="error-message">{error}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMut.isPending} data-testid="button-create-project">
              {createMut.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create project"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
