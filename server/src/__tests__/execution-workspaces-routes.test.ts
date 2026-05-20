import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { executionWorkspaceRoutes } from "../routes/execution-workspaces.js";

const mockExecutionWorkspaceService = vi.hoisted(() => ({
  list: vi.fn(),
  listSummaries: vi.fn(),
  getById: vi.fn(),
  getCloseReadiness: vi.fn(),
  update: vi.fn(),
}));

const mockWorkspaceOperationService = vi.hoisted(() => ({
  listForExecutionWorkspace: vi.fn(),
  createRecorder: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  executionWorkspaceService: () => mockExecutionWorkspaceService,
  logActivity: mockLogActivity,
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

function createApp(companyIds = ["company-1"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds,
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", executionWorkspaceRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe.sequential("execution workspace routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutionWorkspaceService.list.mockResolvedValue([]);
    mockExecutionWorkspaceService.listSummaries.mockResolvedValue([
      {
        id: "workspace-1",
        name: "Alpha",
        mode: "isolated_workspace",
        projectWorkspaceId: null,
      },
    ]);
    mockExecutionWorkspaceService.getById.mockResolvedValue(null);
  });

  it("uses summary mode for lightweight workspace lookups", async () => {
    const res = await request(createApp())
      .get("/api/companies/company-1/execution-workspaces?summary=true&reuseEligible=true");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "workspace-1",
        name: "Alpha",
        mode: "isolated_workspace",
        projectWorkspaceId: null,
      },
    ]);
    expect(mockExecutionWorkspaceService.listSummaries).toHaveBeenCalledWith("company-1", {
      projectId: undefined,
      projectWorkspaceId: undefined,
      issueId: undefined,
      status: undefined,
      reuseEligible: true,
    });
    expect(mockExecutionWorkspaceService.list).not.toHaveBeenCalled();
  });

  function buildArchivedRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      projectWorkspaceId: null,
      sourceIssueId: null,
      mode: "isolated_workspace",
      strategyType: "branch",
      name: "Alpha",
      status: "archived",
      cwd: null,
      repoUrl: null,
      baseRef: null,
      branchName: null,
      providerType: "local_fs",
      providerRef: null,
      derivedFromExecutionWorkspaceId: null,
      lastUsedAt: new Date(),
      openedAt: new Date(),
      closedAt: new Date("2026-05-04T17:04:41.000Z"),
      cleanupEligibleAt: null,
      cleanupReason: "stale_7d_SHA-2221",
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it("delegates the patch verbatim on reopen — clearing is the service's job (SHA-2492)", async () => {
    const archivedRow = buildArchivedRow();
    mockExecutionWorkspaceService.getById.mockResolvedValue(archivedRow);
    mockExecutionWorkspaceService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...archivedRow,
      ...patch,
      // Mirror what the real service does so the response shape matches what
      // a caller would see; the route is not expected to inject these nulls.
      closedAt: null,
      cleanupReason: null,
    }));

    const res = await request(createApp())
      .patch("/api/execution-workspaces/workspace-1")
      .send({ status: "active" });

    expect(res.status).toBe(200);
    expect(mockExecutionWorkspaceService.update).toHaveBeenCalledTimes(1);
    const [, patchArg] = mockExecutionWorkspaceService.update.mock.calls[0];
    // Route forwards req.body to the service; it does NOT inject closedAt /
    // cleanupReason clearings — the service handles that invariant atomically.
    expect(patchArg).toEqual({ status: "active" });
    // Response reflects the service-level clearing.
    expect(res.body.closedAt).toBeNull();
    expect(res.body.cleanupReason).toBeNull();
  });

  it("records reopen-from-closed in the activity log (SHA-2492)", async () => {
    const archivedRow = buildArchivedRow();
    mockExecutionWorkspaceService.getById.mockResolvedValue(archivedRow);
    mockExecutionWorkspaceService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...archivedRow,
      ...patch,
      closedAt: null,
      cleanupReason: null,
    }));

    const res = await request(createApp())
      .patch("/api/execution-workspaces/workspace-1")
      .send({ status: "idle" });

    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const [, logCall] = mockLogActivity.mock.calls[0];
    expect(logCall.action).toBe("execution_workspace.updated");
    expect(logCall.details).toMatchObject({
      changedKeys: ["status"],
      reopenedFromClosedStatus: "archived",
      clearedClosedAt: true,
      clearedCleanupReason: true,
    });
  });

  it("does not flag reopen in the activity log when PATCH does not change status", async () => {
    const archivedRow = buildArchivedRow();
    mockExecutionWorkspaceService.getById.mockResolvedValue(archivedRow);
    mockExecutionWorkspaceService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...archivedRow,
      ...patch,
    }));

    const res = await request(createApp())
      .patch("/api/execution-workspaces/workspace-1")
      .send({ name: "Beta" });

    expect(res.status).toBe(200);
    const [, patchArg] = mockExecutionWorkspaceService.update.mock.calls[0];
    expect(patchArg).toEqual({ name: "Beta" });
    const [, logCall] = mockLogActivity.mock.calls[0];
    expect("reopenedFromClosedStatus" in logCall.details).toBe(false);
    expect("clearedClosedAt" in logCall.details).toBe(false);
  });
});
