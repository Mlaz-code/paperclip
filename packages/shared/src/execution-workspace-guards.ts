import type { ExecutionWorkspace } from "./types/workspace-runtime.js";

type ExecutionWorkspaceGuardTarget = Pick<ExecutionWorkspace, "closedAt" | "mode" | "name" | "status">;

export const CLOSED_EXECUTION_WORKSPACE_STATUSES: ReadonlySet<ExecutionWorkspace["status"]> =
  new Set<ExecutionWorkspace["status"]>(["archived", "cleanup_failed"]);

export function isClosedExecutionWorkspaceStatus(status: ExecutionWorkspace["status"]): boolean {
  return CLOSED_EXECUTION_WORKSPACE_STATUSES.has(status);
}

export function isClosedIsolatedExecutionWorkspace(
  workspace: Pick<ExecutionWorkspaceGuardTarget, "closedAt" | "mode" | "status"> | null | undefined,
): boolean {
  if (!workspace) return false;
  if (workspace.mode !== "isolated_workspace") return false;
  // The OR over both signals is load-bearing pre-backfill: ~1037 historic rows
  // have (status='idle', closedAt=stamped) from manual cleanup recipes and must
  // still fail-closed until the SHA-2492 backfill clears closed_at on them.
  // Once the companion CHECK constraint (closed_at IS NULL OR status IN
  // ('archived','cleanup_failed')) is VALIDATEd, the OR becomes redundant —
  // the status check alone is sufficient. Do not collapse it before then.
  return workspace.closedAt != null || CLOSED_EXECUTION_WORKSPACE_STATUSES.has(workspace.status);
}

export function getClosedIsolatedExecutionWorkspaceMessage(
  workspace: Pick<ExecutionWorkspaceGuardTarget, "name">,
): string {
  return `This issue is linked to the closed workspace "${workspace.name}". Move it to an open workspace before adding comments or resuming work.`;
}
