CREATE TABLE "channel_agents" (
	"channel_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_agents_channel_id_agent_id_pk" PRIMARY KEY("channel_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "channel_agents" ADD CONSTRAINT "channel_agents_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_agents" ADD CONSTRAINT "channel_agents_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;