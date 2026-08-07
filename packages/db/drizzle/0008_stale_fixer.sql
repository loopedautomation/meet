CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"registration" text DEFAULT 'invite' NOT NULL,
	"retention_days" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "servers_registration_check" CHECK ("servers"."registration" in ('invite', 'open'))
);
--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Seed the pre-multi-server deployment as its own server, carrying over the
-- old singleton instance_settings row (name/icon/registration/retention) so
-- an existing instance keeps working unchanged as "server 1" after upgrade.
INSERT INTO "servers" ("slug", "name", "icon_url", "registration", "retention_days")
SELECT
	'main',
	COALESCE(s.name, 'looped meet'),
	s.icon_url,
	COALESCE(s.registration, 'invite'),
	s.retention_days
FROM (SELECT 1) AS one
LEFT JOIN "instance_settings" s ON s.id = 1;
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "server_id" uuid;
--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "server_id" uuid;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "server_id" uuid;
--> statement-breakpoint
ALTER TABLE "server_agents" ADD COLUMN "server_id" uuid;
--> statement-breakpoint
-- Backfill every existing row onto the single seeded server.
UPDATE "channels" SET "server_id" = (SELECT "id" FROM "servers" LIMIT 1) WHERE "server_id" IS NULL;
--> statement-breakpoint
UPDATE "invites" SET "server_id" = (SELECT "id" FROM "servers" LIMIT 1) WHERE "server_id" IS NULL;
--> statement-breakpoint
UPDATE "memberships" SET "server_id" = (SELECT "id" FROM "servers" LIMIT 1) WHERE "server_id" IS NULL;
--> statement-breakpoint
UPDATE "server_agents" SET "server_id" = (SELECT "id" FROM "servers" LIMIT 1) WHERE "server_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "server_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "server_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "server_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "server_agents" ALTER COLUMN "server_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "server_agents" ADD CONSTRAINT "server_agents_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Re-key memberships and server_agents to be per-server: drop the old
-- single-column primary keys and replace with (server_id, <col>) composites.
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey";
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_server_id_user_id_pk" PRIMARY KEY("server_id","user_id");
--> statement-breakpoint
ALTER TABLE "server_agents" DROP CONSTRAINT "server_agents_pkey";
--> statement-breakpoint
ALTER TABLE "server_agents" ADD CONSTRAINT "server_agents_server_id_agent_id_pk" PRIMARY KEY("server_id","agent_id");
