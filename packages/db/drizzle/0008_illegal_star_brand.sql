CREATE TABLE "friend_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "friend_requests_status_check" CHECK ("friend_requests"."status" in ('pending', 'accepted', 'declined', 'canceled')),
	CONSTRAINT "friend_requests_not_self" CHECK ("friend_requests"."requester_id" <> "friend_requests"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_requests_pending_pair_idx" ON "friend_requests" USING btree ("requester_id","recipient_id") WHERE "friend_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "friend_requests_recipient_status_idx" ON "friend_requests" USING btree ("recipient_id","status");--> statement-breakpoint
CREATE INDEX "friend_requests_requester_status_idx" ON "friend_requests" USING btree ("requester_id","status");