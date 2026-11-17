CREATE TABLE "tracked_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"played_on" date NOT NULL,
	"location" text NOT NULL,
	"hours" real NOT NULL,
	"result_cents" bigint NOT NULL,
	"game_type" text NOT NULL,
	"game_mode" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_sessions_game_type" CHECK ("tracked_sessions"."game_type" in ('cash', 'tournament')),
	CONSTRAINT "tracked_sessions_hours" CHECK ("tracked_sessions"."hours" >= 0)
);
--> statement-breakpoint
CREATE INDEX "tracked_sessions_user_idx" ON "tracked_sessions" USING btree ("user_id","played_on");--> statement-breakpoint
-- Deleting the account deletes its logged sessions.
ALTER TABLE "tracked_sessions" ADD CONSTRAINT "tracked_sessions_user_id_auth_users_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;--> statement-breakpoint
-- Only the API's server connection may read or write: RLS on, and no policies for the public roles.
ALTER TABLE "tracked_sessions" ENABLE ROW LEVEL SECURITY;
