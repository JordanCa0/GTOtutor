-- Poker tracker: money in and out instead of a single result, stakes for cash games, and game mode from a fixed list.
ALTER TABLE "tracked_sessions" ADD COLUMN "buy_in_cents" bigint;--> statement-breakpoint
ALTER TABLE "tracked_sessions" ADD COLUMN "cash_out_cents" bigint;--> statement-breakpoint
ALTER TABLE "tracked_sessions" ADD COLUMN "small_blind_cents" bigint;--> statement-breakpoint
ALTER TABLE "tracked_sessions" ADD COLUMN "big_blind_cents" bigint;--> statement-breakpoint
-- Sessions logged before this only have a result: a win becomes 0 in and the win out, a loss the loss in and 0 out.
UPDATE "tracked_sessions" SET "buy_in_cents" = greatest(-"result_cents", 0), "cash_out_cents" = greatest("result_cents", 0);--> statement-breakpoint
-- Game mode was free text: keep what clearly matches a choice, file the rest under "other".
UPDATE "tracked_sessions" SET "game_mode" = CASE
  WHEN "game_mode" ~* '(5|five).?card|plo.?5' THEN 'plo5'
  WHEN "game_mode" ~* 'plo|omaha' THEN 'plo'
  WHEN "game_mode" ~* 'limit hold|lhe|fixed' AND "game_mode" !~* 'no.?limit' THEN 'lhe'
  WHEN "game_mode" ~* 'nlh|no.?limit|hold.?em|holdem' THEN 'nlh'
  WHEN "game_mode" ~* 'short' THEN 'short_deck'
  WHEN "game_mode" ~* 'mix|horse|8.?game' THEN 'mixed'
  ELSE 'other' END
WHERE "game_mode" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_sessions" ALTER COLUMN "buy_in_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_sessions" ALTER COLUMN "cash_out_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracked_sessions" ADD CONSTRAINT "tracked_sessions_money" CHECK ("tracked_sessions"."buy_in_cents" >= 0 and "tracked_sessions"."cash_out_cents" >= 0 and "tracked_sessions"."result_cents" = "tracked_sessions"."cash_out_cents" - "tracked_sessions"."buy_in_cents");--> statement-breakpoint
ALTER TABLE "tracked_sessions" ADD CONSTRAINT "tracked_sessions_game_mode" CHECK ("tracked_sessions"."game_mode" in ('nlh', 'plo', 'plo5', 'lhe', 'short_deck', 'mixed', 'other'));--> statement-breakpoint
ALTER TABLE "tracked_sessions" ADD CONSTRAINT "tracked_sessions_blinds" CHECK (("tracked_sessions"."small_blind_cents" is null) = ("tracked_sessions"."big_blind_cents" is null) and ("tracked_sessions"."small_blind_cents" is null or ("tracked_sessions"."small_blind_cents" > 0 and "tracked_sessions"."small_blind_cents" <= "tracked_sessions"."big_blind_cents")));
