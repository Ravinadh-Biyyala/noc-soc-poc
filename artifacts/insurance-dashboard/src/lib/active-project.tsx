import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  useGetWorkspace,
  getGetWorkspaceQueryKey,
  type Workspace,
} from "@workspace/api-client-react";
import { getPack, type DomainPack } from "./domain-packs";

/**
 * Reads the current project id from the URL (`/projects/:id`) and loads it.
 * When the user is anywhere else, returns `{ project: null }` so callers can
 * fall back to the global tenant copy.
 *
 * Note: projects are persisted in the `workspaces` table, so the generated
 * `useGetWorkspace` hook is the loader here — the API contract is unchanged.
 */
export function useActiveProject(): {
  projectId: number | null;
  project: Workspace | null;
  pack: DomainPack | null;
  isLoading: boolean;
} {
  const [location] = useLocation();
  const projectId = useMemo(() => {
    const match = location.match(/^\/projects\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [location]);

  const id = projectId ?? 0;
  const { data, isLoading } = useGetWorkspace(id, {
    query: {
      enabled: projectId !== null,
      queryKey: getGetWorkspaceQueryKey(id),
    },
  });

  return {
    projectId,
    project: projectId !== null ? data ?? null : null,
    pack: data ? getPack(data.packId) : null,
    isLoading: projectId !== null && isLoading,
  };
}
