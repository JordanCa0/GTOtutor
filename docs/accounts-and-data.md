# Accounts and data

**Status (2026-10-09): steps 1 (database and guest persistence) and 2 (sign-in) are built and live; step 3 is in progress (saved coach answers, saved session reviews and stars done); step 4 (solver data) is done through S3 instead of Supabase Storage.** Decided with Jordan: Supabase (Postgres + Auth), sign-in with Google (email/password was dropped on 2026-10-08, see below), guest play that carries over on sign-up, and storing hands, decisions, coach conversations, settings, session reviews/progress, and starred decisions. The column-by-column schema is in `docs/database-schema.md`.

## Why

Nothing survives a restart today:
- Hands, practice sessions, and coach answers live only in the API's memory (`HandStore` and `SessionStore` in `apps/api/src/engine/`, caches in `apps/api/src/teacher/llmTeacher.ts`).
- Players are anonymous: the browser keeps a random id in localStorage (`apps/web/src/session.ts`).
- Solved flops exist only on the desktop's disk (`solver/output`, read by `apps/api/src/postflop/flopStore.ts`).

## Architecture

- **Web** uses `@supabase/supabase-js` only for sign-in: Google OAuth and session refresh. It sends the access token to our API as `Authorization: Bearer …`; guests send `X-Guest-Id`.
- **API** is the only thing that reads or writes data. It verifies Supabase JWTs (`jose` + the project's JWKS) and uses Postgres through **Drizzle ORM**; schema and migrations live in the repo.
- **Row Level Security** is on for every table with **no policies**, so the public (publishable) key can't read anything directly. Only the API's server-side connection can.
- **Solver output** isn't in Supabase. The flop files are uploaded to a private S3 bucket and synced to the API server's disk on each deploy; `FlopStore` reads them there through `SOLVER_OUTPUT_DIR` (see `docs/deployment.md`). The solver itself still runs only offline (AGPL).
- **Secrets:** the web gets only the project URL and the publishable key. The database URL and the service-role (secret) key stay in `apps/api/.env`, never in the web app or git.

## Data model (`apps/api/src/db/schema.ts`; full column-by-column draft in `docs/database-schema.md`)

Every player-owned row has either `user_id` (→ `auth.users`, deleted with the account) or `guest_id`, never both.

| Table | Holds |
|---|---|
| `profiles` | One per user: display name, settings (sound, animations, default table/stack/position, skip easy folds, flop practice) |
| `practice_sessions` | A sitting of hands (today's client `sessionId`) |
| `hands` | Config, hero position, status, full engine state (so a hand in progress survives a restart), result, net bb |
| `decisions` | Every graded decision: spot, street, board, hand, chosen vs best action, grade, frequencies, borrowed flop, hint used, **starred time and note** |
| `coach_messages` | Explanations and chat turns per decision (TL;DR, detail, points, ungrounded numbers) |
| `session_reviews` | Saved session reviews (stats + coach summary) |
| `solver_spots`, `solved_flops` | **Unused.** Created for the dropped Supabase Storage plan; nothing reads or writes them. Remove them in a later migration, or reuse them as an index of the S3 files |

## Build steps

1. **Database and persistence, guests first.** ✅ Done.
   - Drizzle schema and migrations (`npm run db:migrate`).
   - A `Repo` interface with a Postgres version and an in-memory version for tests.
   - Hand and session stores backed by the repo.
   - A guest id in the browser, separate from the practice session id.
   - Ownership checks on every hand, decision, coach, and review route (today any hand id works for anyone).
   - Coach rate limits per player instead of per IP.
2. **Sign-in.** ✅ Done.
   - Auth modal (Google button) and account menu.
   - The API verifies tokens and creates the profile row.
   - `POST /api/me/claim-guest` moves a guest's history to the new account.
   - `DELETE /api/me` deletes the account and its data.
3. **Features on the stored data.**
   - Coach answers saved: explanations are paid for once, and chats reappear. ✅ Done.
   - Saved session reviews. ✅ Done: a review is paid for once per decision count (`session_reviews`); reviews with invented numbers aren't kept.
   - Settings synced across devices.
   - **Star a decision** (with an optional note). ✅ Done: the star button on the verdict, with a note field once starred (`GET`/`PUT /api/hands/:id/decisions/:decisionId/star`). Tags aren't built yet.
   - A **"My hands"** view (filters: starred, mistakes, flop, position; replay a decision with its chart and coach thread).
   - Progress stats over time (reusing `computeSessionStats`).
4. **Solver data off-device.** ✅ Done, through S3 instead of Supabase Storage (2026-10-09).
   - Flop files are uploaded with `aws s3 sync`, and `deploy/deploy.sh` syncs the bucket to the API server's disk. Steps are in `docs/deployment.md`.
   - Why not Supabase Storage: the files already live next to the API on AWS, and the free tier's 1 GB couldn't hold them. Charts `preflop-v8` alone are 3.6 GB of flop files uncompressed.
   - No `uploadSolverOutput.ts` script and no `SOLVER_SOURCE` switch: `FlopStore` keeps reading local files.
5. **Docs:** finish this file and update `CLAUDE.md`, both `.env.example` files, `solver/README.md`, and `docs/postflop-plan.md`.

Out of scope for now: other sign-in providers, separate dev and prod projects. Hosting is in `docs/deployment.md`.

**Guest data is temporary** (decided 2026-10-04): a guest's session and everything in it is deleted when they start a new session or after 24 hours with no new hand, unless they sign up during it. Details in `docs/database-schema.md`.

**Google is the only sign-in** (decided 2026-10-08): email/password sign-up, verification and password reset were removed. Supabase's built-in email sender only reaches project team members, and Google-only sign-in avoids running an SMTP provider. The Email provider is turned off in Supabase (Authentication → Sign In / Providers), so it can't be used directly with the public key either.

## One-time Supabase setup (Jordan)

1. **Create a project** at supabase.com. Pick the region closest to you and save the database password somewhere safe.
2. **Google sign-in:**
   - In Google Cloud Console, create an OAuth client (type "Web application").
   - Add the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - In Supabase → Authentication → Providers → Google, paste the client ID and secret, and enable it.
3. **Email sign-in:** in Authentication → Sign In / Providers → Email, turn it off (Google is the only sign-in).
4. **URLs:** in Authentication → URL Configuration, set the Site URL to `http://localhost:5173` and add it to the redirect URLs. Add the real domain later.
5. **Keys:** the project URL, the publishable key, the secret (service-role) key, and the database connection string (the session pooler URI if your network has no IPv6).
   - Put the web values in `apps/web/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
   - Put the API values in `apps/api/.env`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   - Both files are gitignored. Never paste these into a `.env.example` file.

## Testing

- **Unit tests** run on the in-memory repo: ownership 404s, guest claim, stars, settings, saved coach messages, progress stats.
- **Database tests** run only when `DATABASE_URL` is set: migrations apply, and the Postgres repo passes the same tests as the in-memory one.
- **RLS check:** the publishable key can't read `hands`.
- **End to end in a browser:** play as a guest and star a decision, sign up, see that history under the account, restart the API, and confirm everything (including a hand in progress) is still there. Then try Google sign-in.
- **Solver files on the server:** after `deploy.sh`, flop play works for every spot synced to the bucket.

## How it works now (steps 1–2)

- **Who's asking:** every API request carries `X-Guest-Id` (a random id in localStorage, `apps/web/src/auth/identity.ts`). A signed-in browser also sends `Authorization: Bearer <Supabase token>`, which wins. `apps/api/src/auth/player.ts` resolves the player; tokens are checked locally against the project's public signing keys (`src/auth/verify.ts`). Hand, coach and review routes answer 401 without an identity and 404 for someone else's data.
- **Storage:** `src/db/repo.ts` defines the `Repo` interface plus an in-memory version (tests, or running without `DATABASE_URL`); `src/db/pgRepo.ts` is the Supabase Postgres version. `src/engine/handService.ts` keeps hands being played in memory and writes every change through, so a restart continues from the database. A finished hand drops the engine state (deck, every hole card) and keeps a replay (action log + result).
- **Guests:** starting a hand in a new session deletes the guest's previous sessions; the API deletes guest sessions idle for 24 hours (hourly check in `src/server.ts`).
- **Sign-in (web):** `apps/web/src/components/AccountMenu.tsx` has the sign-in dialog (Google only) and the account menu (sign out, delete account). On sign-in, `POST /api/me/claim-guest` moves the guest's session to the account and the browser starts a fresh guest id. Signing out resets the table.
- **Deleting an account:** `DELETE /api/me` deletes the Supabase user with the secret key (`src/auth/accounts.ts`); foreign keys delete everything it owned.
- **Tests:** `npm test` uses the in-memory repo. `RUN_DB_TESTS=1 npx vitest run test/persistence.test.ts` (in `apps/api`) also runs the storage checks against Supabase, cleaning up after itself.
- **Stars and saved reviews:** a decision's star and note live on its `decisions` row; unstarring clears the note. `GET /api/sessions/:id/review` returns the saved coach review for the current decision count, and asks the coach only when there isn't one.
- **Not yet:** tags, settings sync, "My hands" (where starred decisions will be listed), and progress stats (the rest of step 3).
