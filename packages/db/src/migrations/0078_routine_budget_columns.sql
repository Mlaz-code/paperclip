-- SHA-3600 Phase C: routine budget columns for the warn-only budget sweep.
--
-- Two nullable soft caps on the routines table. NULL means "uncalibrated /
-- no budget" — current behavior is unchanged for any routine left null, and
-- the sweep skips null-budget routines. Both are plain ADD COLUMN of a
-- nullable integer with no default, so the migration is metadata-only and
-- does not rewrite the table or take a long lock.
ALTER TABLE "routines"
  ADD COLUMN "expected_max_queue_depth" integer,
  ADD COLUMN "cost_budget_monthly_cents" integer;

COMMENT ON COLUMN "routines"."expected_max_queue_depth" IS 'SHA-3600: soft cap on open routine_execution issues (origin_kind=routine_execution, origin_id=routine.id) that may pile up; budget sweep files a Platform issue when exceeded. NULL = uncalibrated (skipped).';
COMMENT ON COLUMN "routines"."cost_budget_monthly_cents" IS 'SHA-3600: soft monthly cost cap in cents. Sweep attributes cost via routine_execution issues -> heartbeat_runs.context_snapshot->>issueId -> usage_json->>costUsd (routine_runs has no cost column). NULL = uncalibrated (skipped).';
