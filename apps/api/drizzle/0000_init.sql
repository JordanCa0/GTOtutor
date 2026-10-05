CREATE TABLE "coach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" text NOT NULL,
	"user_id" uuid,
	"guest_id" uuid,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"tldr" text,
	"content" text NOT NULL,
	"points" jsonb,
	"ungrounded" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_messages_one_owner" CHECK (("coach_messages"."user_id" is null) <> ("coach_messages"."guest_id" is null))
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"hand_id" uuid NOT NULL,
	"user_id" uuid,
	"guest_id" uuid,
	"idx" integer NOT NULL,
	"street" text NOT NULL,
	"node_key" text NOT NULL,
	"spot_type" text NOT NULL,
	"hand_class" text NOT NULL,
	"hero_cards" text[] NOT NULL,
	"board" text[] NOT NULL,
	"chosen_action" text NOT NULL,
	"best_action" text NOT NULL,
	"grade" text NOT NULL,
	"chosen_frequency" real NOT NULL,
	"feedback" jsonb NOT NULL,
	"approx_flop" text,
	"hint_used" boolean DEFAULT false NOT NULL,
	"starred_at" timestamp with time zone,
	"note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_one_owner" CHECK (("decisions"."user_id" is null) <> ("decisions"."guest_id" is null))
);
--> statement-breakpoint
CREATE TABLE "hands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" uuid,
	"guest_id" uuid,
	"status" text NOT NULL,
	"hero_position" text NOT NULL,
	"config" jsonb NOT NULL,
	"flop_practice" boolean DEFAULT false NOT NULL,
	"state" jsonb,
	"result" jsonb,
	"net_bb" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "hands_one_owner" CHECK (("hands"."user_id" is null) <> ("hands"."guest_id" is null))
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"guest_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_sessions_one_owner" CHECK (("practice_sessions"."user_id" is null) <> ("practice_sessions"."guest_id" is null))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_reviews" (
	"session_id" text NOT NULL,
	"decisions_count" integer NOT NULL,
	"stats" jsonb NOT NULL,
	"coach" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_reviews_session_id_decisions_count_pk" PRIMARY KEY("session_id","decisions_count")
);
--> statement-breakpoint
CREATE TABLE "solved_flops" (
	"spot" text NOT NULL,
	"flop" text NOT NULL,
	"weight" integer NOT NULL,
	"exploitability_pct_pot" real NOT NULL,
	"tree" jsonb,
	"has_ev" boolean NOT NULL,
	"storage_path" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"solved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solved_flops_spot_flop_pk" PRIMARY KEY("spot","flop")
);
--> statement-breakpoint
CREATE TABLE "solver_spots" (
	"name" text PRIMARY KEY NOT NULL,
	"chart_version" text,
	"spot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_hand_id_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hands" ADD CONSTRAINT "hands_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_reviews" ADD CONSTRAINT "session_reviews_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solved_flops" ADD CONSTRAINT "solved_flops_spot_solver_spots_name_fk" FOREIGN KEY ("spot") REFERENCES "public"."solver_spots"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_messages_decision_idx" ON "coach_messages" USING btree ("decision_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_messages_guest_idx" ON "coach_messages" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "decisions_user_idx" ON "decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_user_spot_idx" ON "decisions" USING btree ("user_id","spot_type");--> statement-breakpoint
CREATE INDEX "decisions_user_star_idx" ON "decisions" USING btree ("user_id","starred_at");--> statement-breakpoint
CREATE INDEX "decisions_tags_idx" ON "decisions" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "decisions_guest_idx" ON "decisions" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "decisions_hand_idx" ON "decisions" USING btree ("hand_id");--> statement-breakpoint
CREATE INDEX "hands_user_idx" ON "hands" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "hands_guest_idx" ON "hands" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "hands_session_idx" ON "hands" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "practice_sessions_user_idx" ON "practice_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "practice_sessions_guest_idx" ON "practice_sessions" USING btree ("guest_id");