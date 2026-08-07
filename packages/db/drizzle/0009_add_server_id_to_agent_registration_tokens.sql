ALTER TABLE "agent_registration_tokens" ADD COLUMN "server_id" uuid;
--> statement-breakpoint
-- Existing tokens predate multi-server; attribute them to the single seeded
-- server (see 0008_stale_fixer) so upgrading installs keep working.
UPDATE "agent_registration_tokens" SET "server_id" = (SELECT "id" FROM "servers" LIMIT 1) WHERE "server_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "agent_registration_tokens" ALTER COLUMN "server_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_registration_tokens" ADD CONSTRAINT "agent_registration_tokens_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
