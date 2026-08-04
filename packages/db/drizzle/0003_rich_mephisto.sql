CREATE TABLE "server_agents" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "server_agents" ADD CONSTRAINT "server_agents_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;