-- SHA-3601 Phase 1: introduce the single-owner CAS lock columns on issues.
--
-- The legacy triple {assignee_agent_id, checkout_run_id, execution_run_id}
-- produced the entire ownership-burn cluster (SHA-3081/3241/3359/3413/3419/
-- 3519). Phase 1 lands the new {lock_agent_id, lock_run_id, lock_at} columns
-- alongside the legacy triple. No API surface changes yet.
--
-- Coherency during the canary period is kept by a BEFORE INSERT/UPDATE
-- trigger that derives the lock triple from the legacy columns. The new
-- /claim endpoint (Phase 2, same PR) does a CAS WHERE on lock_run_id but
-- still SETs the legacy columns; the trigger then re-derives lock_* from
-- those, so old write sites and the new endpoint stay in sync without
-- having to touch every legacy writer.
--
-- The trigger is BEFORE so the derived values land in the same row write
-- (no extra row touch, no second WAL record). After Phase 3 has migrated
-- callers to the new endpoints, a follow-up migration will invert the
-- relationship (drop the legacy columns, drop the trigger) per the spec.

ALTER TABLE "issues"
  ADD COLUMN "lock_agent_id" uuid,
  ADD COLUMN "lock_run_id" uuid,
  ADD COLUMN "lock_at" timestamp with time zone;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_lock_agent_id_agents_id_fk') THEN
    ALTER TABLE "issues"
      ADD CONSTRAINT "issues_lock_agent_id_agents_id_fk"
      FOREIGN KEY ("lock_agent_id") REFERENCES "public"."agents"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_lock_run_id_heartbeat_runs_id_fk') THEN
    ALTER TABLE "issues"
      ADD CONSTRAINT "issues_lock_run_id_heartbeat_runs_id_fk"
      FOREIGN KEY ("lock_run_id") REFERENCES "public"."heartbeat_runs"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

-- One-shot backfill of existing rows. The trigger below will keep them in
-- sync going forward, but for the existing snapshot we set the lock triple
-- once so that the new partial index has clean values from t=0.
UPDATE "issues"
   SET "lock_agent_id" = "assignee_agent_id",
       "lock_run_id"   = COALESCE("execution_run_id", "checkout_run_id"),
       "lock_at"       = CASE
                           WHEN COALESCE("execution_run_id", "checkout_run_id") IS NULL THEN NULL
                           ELSE COALESCE("updated_at", "created_at")
                         END
 WHERE "assignee_agent_id" IS NOT NULL
    OR "checkout_run_id"   IS NOT NULL
    OR "execution_run_id"  IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "issues_sync_lock_columns"()
RETURNS TRIGGER AS $$
DECLARE
  next_agent uuid;
  next_run   uuid;
BEGIN
  next_agent := NEW.assignee_agent_id;
  next_run   := COALESCE(NEW.execution_run_id, NEW.checkout_run_id);
  NEW.lock_agent_id := next_agent;
  NEW.lock_run_id   := next_run;
  IF next_run IS NULL THEN
    NEW.lock_at := NULL;
  ELSIF TG_OP = 'INSERT'
        OR OLD.lock_run_id   IS DISTINCT FROM next_run
        OR OLD.lock_agent_id IS DISTINCT FROM next_agent THEN
    NEW.lock_at := COALESCE(NEW.updated_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "issues_sync_lock_columns_trg" ON "issues";
--> statement-breakpoint

CREATE TRIGGER "issues_sync_lock_columns_trg"
BEFORE INSERT OR UPDATE ON "issues"
FOR EACH ROW EXECUTE FUNCTION "issues_sync_lock_columns"();
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "issues_lock_idx"
  ON "issues" USING btree ("lock_agent_id", "lock_run_id")
  WHERE "lock_run_id" IS NOT NULL;
