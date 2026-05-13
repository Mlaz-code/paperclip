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

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
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

  it("clears closedAt and cleanupReason when PATCH transitions out of a closed status (SHA-2492)", async () => {
    const archivedRow = {
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
    };
    mockExecutionWorkspaceService.getById.mockResolvedValue(archivedRow);
    mockExecutionWorkspaceService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...archivedRow,
      ...patch,
    }));

    const res = await request(createApp())
      .patch("/api/execution-workspaces/workspace-1")
      .send({ status: "active" });

    expect(res.status).toBe(200);
    expect(mockExecutionWorkspaceService.update).toHaveBeenCalledTimes(1);
    const [, patchArg] = mockExecutionWorkspaceService.update.mock.calls[0];
    expect(patchArg.status).toBe("active");
    expect(patchArg.closedAt).toBeNull();
    expect(patchArg.cleanupReason).toBeNull();
  });

  it("does not touch closedAt when PATCH does not change status", async () => {
    const archivedRow = {
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
    };
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
    expect("closedAt" in patchArg).toBe(false);
    expect("cleanupReason" in patchArg).toBe(false);
  });
});
