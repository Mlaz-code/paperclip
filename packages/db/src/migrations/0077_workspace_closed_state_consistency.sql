-- SHA-2492: closed_at MUST pair with a closed status (archived/cleanup_failed).
--
-- Added with NOT VALID so the migration is fast and does not lock the table
-- while validating every existing row. The constraint takes effect for all
-- INSERTs and UPDATEs immediately. Existing violator rows (1037 known on
-- prod paperclip DB at filing time) must be backfilled to status='archived'
-- before running `ALTER TABLE ... VALIDATE CONSTRAINT
-- execution_workspaces_closed_state_consistency` as a follow-up.
ALTER TABLE "execution_workspaces"
  ADD CONSTRAINT "execution_workspaces_closed_state_consistency"
  CHECK ("closed_at" IS NULL OR "status" IN ('archived', 'cleanup_failed'))
  NOT VALID;
