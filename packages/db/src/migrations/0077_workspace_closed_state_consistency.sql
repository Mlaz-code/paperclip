-- SHA-2492: closed_at MUST pair with a closed status (archived/cleanup_failed).
--
-- The constraint is added with NOT VALID so the migration is fast and does
-- not lock the table while validating every existing row. NOT VALID skips
-- the historical row scan, but the predicate is enforced against every
-- subsequent INSERT *and UPDATE* — including UPDATEs that don't touch
-- closed_at or status (Postgres re-evaluates CHECK on the new tuple).
--
-- The backfill below normalizes the ~1037 pre-existing violator rows
-- (closed_at set, status non-terminal) BEFORE the constraint is added, so
-- there is no window in which an unrelated UPDATE on a violator (e.g.
-- DELETE /environments/:id → clearEnvironmentSelection) would fail the
-- new CHECK. Pre-audit on prod paperclip DB at filing time confirmed
-- 0 violators have a non-terminal source issue, so promoting them to
-- 'archived' is safe.
UPDATE "execution_workspaces"
   SET "status" = 'archived',
       "updated_at" = now()
 WHERE "closed_at" IS NOT NULL
   AND "status" NOT IN ('archived', 'cleanup_failed');

ALTER TABLE "execution_workspaces"
  ADD CONSTRAINT "execution_workspaces_closed_state_consistency"
  CHECK ("closed_at" IS NULL OR "status" IN ('archived', 'cleanup_failed'))
  NOT VALID;
