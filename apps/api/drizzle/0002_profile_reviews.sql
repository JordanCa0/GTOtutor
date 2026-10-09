CREATE TABLE "profile_reviews" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"decisions_count" integer NOT NULL,
	"stats" jsonb NOT NULL,
	"coach" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One review per account; deleting the account deletes it.
ALTER TABLE "profile_reviews" ADD CONSTRAINT "profile_reviews_user_id_auth_users_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;--> statement-breakpoint
-- Only the API's server connection may read or write: RLS on, and no policies for the public roles.
ALTER TABLE "profile_reviews" ENABLE ROW LEVEL SECURITY;
