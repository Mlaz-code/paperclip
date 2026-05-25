// SHA-3601 Phase 2 — single-owner CAS lock service tests.
//
// Covers two invariants the migration + service change must hold:
//
//   1. Backwards-compat dual-write: every legacy write site that touches
//      assignee_agent_id / checkout_run_id / execution_run_id must end up
//      with lock_agent_id / lock_run_id / lock_at in sync. The
//      `issues_sync_lock_columns_trg` trigger is responsible for this, so
//      these tests prove the trigger fires on the existing checkout/
//      release/update code paths.
//
//   2. CAS semantics on the new /claim path: concurrent calls from the same
//      agent (different runs) must produce exactly one winner. Repeat
//      claims from the same {agent, run} are idempotent. Claims while
//      held by another run return 409.
//
// These tests use the embedded Postgres harness, which applies the real
// migrations (including 0093) at boot.

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  companies,
  createDb,
  executionWorkspaces,
  goals,
  heartbeatRuns,
  instanceSettings,
  issueComments,
  issueInboxArchives,
  issueRelations,
  issues,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping SHA-3601 claim/lock tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function ensureIssueRelationsTable(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "issue_relations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "company_id" uuid NOT NULL,
      "issue_id" uuid NOT NULL,
      "related_issue_id" uuid NOT NULL,
      "type" text NOT NULL,
      "created_by_agent_id" uuid,
      "created_by_user_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `));
}

describeEmbeddedPostgres("SHA-3601 issue CAS lock", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-sha-3601-cas-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed(): Promise<{
    companyId: string;
    agentId: string;
    runId: string;
    secondRunId: string;
    issueId: string;
  }> {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const secondRunId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values([
      { id: runId, companyId, agentId, status: "running", invocationSource: "manual" },
      { id: secondRunId, companyId, agentId, status: "running", invocationSource: "manual" },
    ]);
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "CAS lock target",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    return { companyId, agentId, runId, secondRunId, issueId };
  }

  async function readLockColumns(issueId: string) {
    return db
      .select({
        lockAgentId: issues.lockAgentId,
        lockRunId: issues.lockRunId,
        lockAt: issues.lockAt,
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]!);
  }

  it("trigger backfills lock_* on insert", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Agent", role: "engineer", status: "active",
      adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId, status: "running", invocationSource: "manual",
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Pre-populated lock fields",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
      executionRunId: runId,
    });

    const row = await readLockColumns(issueId);
    expect(row.lockAgentId).toBe(agentId);
    expect(row.lockRunId).toBe(runId);
    expect(row.lockAt).toBeInstanceOf(Date);
  });

  it("trigger keeps lock_* in sync with svc.checkout (legacy writer)", async () => {
    const { agentId, runId, issueId } = await seed();

    const updated = await svc.checkout(issueId, agentId, ["todo"], runId);
    expect(updated?.status).toBe("in_progress");

    const row = await readLockColumns(issueId);
    expect(row.lockAgentId).toBe(agentId);
    expect(row.lockRunId).toBe(runId);
    expect(row.checkoutRunId).toBe(runId);
    expect(row.executionRunId).toBe(runId);
    expect(row.lockAt).toBeInstanceOf(Date);
  });

  it("trigger clears lock_* when svc.release nulls the legacy columns", async () => {
    const { agentId, runId, issueId } = await seed();
    await svc.checkout(issueId, agentId, ["todo"], runId);

    const released = await svc.release(issueId, agentId, runId);
    expect(released?.status).toBe("todo");

    const row = await readLockColumns(issueId);
    expect(row.lockAgentId).toBeNull();
    expect(row.lockRunId).toBeNull();
    expect(row.lockAt).toBeNull();
    expect(row.checkoutRunId).toBeNull();
    expect(row.executionRunId).toBeNull();
  });

  it("svc.claim acquires the lock on a clean issue", async () => {
    const { agentId, runId, issueId } = await seed();

    const claimed = await svc.claim(issueId, agentId, runId);
    expect(claimed?.status).toBe("in_progress");

    const row = await readLockColumns(issueId);
    expect(row.lockAgentId).toBe(agentId);
    expect(row.lockRunId).toBe(runId);
    expect(row.checkoutRunId).toBe(runId);
    expect(row.executionRunId).toBe(runId);
  });

  it("svc.claim is idempotent for the same {agent, run}", async () => {
    const { agentId, runId, issueId } = await seed();

    const first = await svc.claim(issueId, agentId, runId);
    const second = await svc.claim(issueId, agentId, runId);
    expect(second?.id).toBe(first?.id);
    expect(second?.status).toBe("in_progress");

    const row = await readLockColumns(issueId);
    expect(row.lockRunId).toBe(runId);
  });

  it("svc.claim returns 409 when another run already holds the lock", async () => {
    const { agentId, runId, secondRunId, issueId } = await seed();
    await svc.claim(issueId, agentId, runId);

    await expect(svc.claim(issueId, agentId, secondRunId)).rejects.toMatchObject({
      status: 409,
    });

    const row = await readLockColumns(issueId);
    expect(row.lockRunId).toBe(runId);
  });

  it("svc.claim throws conflict when the runId references a non-existent heartbeat_run", async () => {
    const { agentId, issueId } = await seed();
    await expect(svc.claim(issueId, agentId, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
  });

  it("svc.claim respects expectedStatuses when provided", async () => {
    const { agentId, runId, issueId } = await seed();
    // Issue is in 'todo'. Claim with expectedStatuses excluding 'todo' must
    // fail (no row matches the WHERE) and surface as a conflict.
    await expect(svc.claim(issueId, agentId, runId, ["in_progress"])).rejects.toMatchObject({
      status: 409,
    });

    // Lock should remain unset since the CAS didn't succeed.
    const row = await readLockColumns(issueId);
    expect(row.lockRunId).toBeNull();
  });

  it("concurrent svc.claim from two runs produces exactly one winner", async () => {
    const { agentId, runId, secondRunId, issueId } = await seed();

    const [r1, r2] = await Promise.allSettled([
      svc.claim(issueId, agentId, runId),
      svc.claim(issueId, agentId, secondRunId),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The winner's run id is what's stamped on the lock.
    const winningRunId = (fulfilled[0] as PromiseFulfilledResult<{ executionRunId: string | null }>)
      .value
      .executionRunId;
    expect([runId, secondRunId]).toContain(winningRunId);

    const row = await readLockColumns(issueId);
    expect(row.lockRunId).toBe(winningRunId);
  });
});
