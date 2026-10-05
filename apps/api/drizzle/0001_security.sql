-- Owner rows belong to Supabase auth users: deleting an account deletes its data.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_auth_users_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_auth_users_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "hands" ADD CONSTRAINT "hands_user_id_auth_users_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_user_id_auth_users_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_user_id_auth_users_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;--> statement-breakpoint
-- Only the API's server connection may read or write: RLS on, and no policies for the public roles.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practice_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coach_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "solver_spots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "solved_flops" ENABLE ROW LEVEL SECURITY;
