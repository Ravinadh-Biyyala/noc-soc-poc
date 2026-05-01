import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  useGetWorkspace,
  getGetWorkspaceQueryKey,
  type Workspace,
} from "@workspace/api-client-react";
import { getPack, type DomainPack } from "./domain-packs";

/**
 * Reads the current workspace id from the URL (`/workspaces/:id`) and
 * loads it. When the user is anywhere else, returns `{ workspace: null }`
 * so callers can fall back to the global tenant copy.
 */
export function useActiveWorkspace(): {
  workspaceId: number | null;
  workspace: Workspace | null;
  pack: DomainPack | null;
  isLoading: boolean;
} {
  const [location] = useLocation();
  const workspaceId = useMemo(() => {
    const match = location.match(/^\/workspaces\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [location]);

  const id = workspaceId ?? 0;
  const { data, isLoading } = useGetWorkspace(id, {
    query: {
      enabled: workspaceId !== null,
      queryKey: getGetWorkspaceQueryKey(id),
    },
  });

  return {
    workspaceId,
    workspace: workspaceId !== null ? data ?? null : null,
    pack: data ? getPack(data.packId) : null,
    isLoading: workspaceId !== null && isLoading,
  };
}
