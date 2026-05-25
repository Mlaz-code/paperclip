-- SHA-3629: one-shot reconcile sweep for stale routine_execution assignees.
--
-- Sibling fix to the FOR UPDATE patch in services/routines.ts dispatchRoutineRun.
-- Before that patch, dispatchRoutineRun used an in-memory snapshot of the
-- routine row, so any PATCH /routines that bumped assigneeAgentId between
-- tickScheduledTriggers' SELECT and the dispatch transaction would file the
-- new execution issue against the *previous* assignee for at least one
-- cycle. The patch closes the source going forward; this migration heals
-- the open issues that landed on the wrong agent.
--
-- Idempotent — only touches rows where the issue's assignee diverges from
-- the routine's current assignee. The status filter avoids reopening closed
-- work (done/cancelled) and the hidden_at filter avoids resurrecting
-- soft-deleted issues. Safe to re-run.
UPDATE "issues" AS i
   SET "assignee_agent_id" = r."assignee_agent_id",
       "updated_at" = now()
  FROM "routines" AS r
 WHERE i."origin_kind" = 'routine_execution'
   AND i."origin_id" = r."id"::text
   AND i."status" NOT IN ('done', 'cancelled')
   AND i."hidden_at" IS NULL
   AND i."assignee_agent_id" IS DISTINCT FROM r."assignee_agent_id";
