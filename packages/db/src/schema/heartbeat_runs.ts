import { type AnyPgColumn, pgTable, uuid, text, timestamp, jsonb, index, integer, bigint, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { agentWakeupRequests } from "./agent_wakeup_requests.js";

export const heartbeatRuns = pgTable(
  "heartbeat_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    invocationSource: text("invocation_source").notNull().default("on_demand"),
    triggerDetail: text("trigger_detail"),
    status: text("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    wakeupRequestId: uuid("wakeup_request_id").references(() => agentWakeupRequests.id),
    exitCode: integer("exit_code"),
    signal: text("signal"),
    usageJson: jsonb("usage_json").$type<Record<string, unknown>>(),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    sessionIdBefore: text("session_id_before"),
    sessionIdAfter: text("session_id_after"),
    logStore: text("log_store"),
    logRef: text("log_ref"),
    logBytes: bigint("log_bytes", { mode: "number" }),
    logSha256: text("log_sha256"),
    logCompressed: boolean("log_compressed").notNull().default(false),
    stdoutExcerpt: text("stdout_excerpt"),
    stderrExcerpt: text("stderr_excerpt"),
    errorCode: text("error_code"),
    externalRunId: text("external_run_id"),
    processPid: integer("process_pid"),
    processGroupId: integer("process_group_id"),
    processStartedAt: timestamp("process_started_at", { withTimezone: true }),
    lastOutputAt: timestamp("last_output_at", { withTimezone: true }),
    lastOutputSeq: integer("last_output_seq").notNull().default(0),
    lastOutputStream: text("last_output_stream"),
    lastOutputBytes: bigint("last_output_bytes", { mode: "number" }),
    retryOfRunId: uuid("retry_of_run_id").references((): AnyPgColumn => heartbeatRuns.id, {
      onDelete: "set null",
    }),
    processLossRetryCount: integer("process_loss_retry_count").notNull().default(0),
    scheduledRetryAt: timestamp("scheduled_retry_at", { withTimezone: true }),
    scheduledRetryAttempt: integer("scheduled_retry_attempt").notNull().default(0),
    scheduledRetryReason: text("scheduled_retry_reason"),
    issueCommentStatus: text("issue_comment_status").notNull().default("not_applicable"),
    issueCommentSatisfiedByCommentId: uuid("issue_comment_satisfied_by_comment_id"),
    issueCommentRetryQueuedAt: timestamp("issue_comment_retry_queued_at", { withTimezone: true }),
    livenessState: text("liveness_state"),
    livenessReason: text("liveness_reason"),
    continuationAttempt: integer("continuation_attempt").notNull().default(0),
    lastUsefulActionAt: timestamp("last_useful_action_at", { withTimezone: true }),
    nextAction: text("next_action"),
    contextSnapshot: jsonb("context_snapshot").$type<Record<string, unknown>>(),
    // DB-maintained scope key: issueId, falling back to taskId/taskKey, extracted
    // from context_snapshot. Lets per-issue heartbeat_runs lookups filter on a real
    // indexed column instead of a 3-way JSONB OR (text, so non-uuid keys never throw).
    issueId: text("issue_id").generatedAlwaysAs(
      sql`coalesce(context_snapshot ->> 'issueId', context_snapshot ->> 'taskId', context_snapshot ->> 'taskKey')`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // NOTE: index ordering below is rendered with NULLS LAST by drizzle's .desc();
    // the authoritative migrations (0093-0095) create them with default DESC
    // (NULLS FIRST) to match query ORDER BY. created_at/id are NOT NULL so this is
    // semantically identical. drizzle-kit generate is unusable here (snapshot drift).
    companyAgentCreatedIdx: index("heartbeat_runs_company_agent_created_idx").on(
      table.companyId,
      table.agentId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    agentStatusCreatedIdx: index("heartbeat_runs_agent_status_created_idx").on(
      table.agentId,
      table.status,
      table.createdAt.desc(),
    ),
    companyCreatedIdx: index("heartbeat_runs_company_created_idx").on(
      table.companyId,
      table.createdAt.desc(),
    ),
    companyIssueidCreatedIdx: index("heartbeat_runs_company_issueid_created_idx").on(
      table.companyId,
      sql`(${table.contextSnapshot} ->> 'issueId')`,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    scheduledRetryDueIdx: index("heartbeat_runs_scheduled_retry_due_idx")
      .on(table.scheduledRetryAt, table.createdAt, table.id)
      .where(sql`${table.status} = 'scheduled_retry'`),
    companyAgentIssueCreatedIdx: index("heartbeat_runs_company_agent_issue_created_idx").on(
      table.companyId,
      table.agentId,
      table.issueId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    companyLivenessIdx: index("heartbeat_runs_company_liveness_idx").on(
      table.companyId,
      table.livenessState,
      table.createdAt,
    ),
    companyStatusLastOutputIdx: index("heartbeat_runs_company_status_last_output_idx").on(
      table.companyId,
      table.status,
      table.lastOutputAt,
    ),
    companyStatusProcessStartedIdx: index("heartbeat_runs_company_status_process_started_idx").on(
      table.companyId,
      table.status,
      table.processStartedAt,
    ),
  }),
);
