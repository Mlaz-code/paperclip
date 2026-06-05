DROP INDEX IF EXISTS "heartbeat_runs_company_agent_started_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_company_agent_created_idx" ON "heartbeat_runs" USING btree ("company_id","agent_id","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_agent_status_created_idx" ON "heartbeat_runs" USING btree ("agent_id","status","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_company_created_idx" ON "heartbeat_runs" USING btree ("company_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_company_issueid_created_idx" ON "heartbeat_runs" USING btree ("company_id",((context_snapshot ->> 'issueId')),"created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heartbeat_runs_scheduled_retry_due_idx" ON "heartbeat_runs" USING btree ("scheduled_retry_at","created_at","id") WHERE status = 'scheduled_retry';