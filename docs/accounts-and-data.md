# Accounts and data

**Status (2026-10-04): steps 1 (database and guest persistence) and 2 (sign-in) are built and live; steps 3–4 are next.** Decided with Jordan: Supabase (Postgres + Auth + Storage), sign-in with Google and email/password, guest play that carries over on sign-up, and storing hands, decisions, coach conversations, settings, session reviews/progress, and starred decisions. The column-by-column schema is in `docs/database-schema.md`.

## Why

Nothing survives a restart today:
- Hands, practice sessions, and coach answers live only in the API's memory (`HandStore` and `SessionStore` in `apps/api/src/engine/`, caches in `apps/api/src/teacher/llmTeacher.ts`).
- Players are anonymous: the browser keeps a random id in localStorage (`apps/web/src/session.ts`).
- Solved flops exist only on the desktop's disk (`solver/output`, read by `apps/api/src/postflop/flopStore.ts`).

## Architecture

- **Web** uses `@supabase/supabase-js` only for sign-in: Google, email/password, verification, password reset, and session refresh. It sends the access token to our API as `Authorization: Bearer …`; guests send `X-Guest-Id`.
- **API** is the only thing that reads or writes data. It verifies Supabase JWTs (`jose` + the project's JWKS) and uses Postgres through **Drizzle ORM**; schema and migrations live in the repo.
- **Row Level Security** is on for every table with **no policies**, so the public (publishable) key can't read anything directly. Only the API's server-side connection can.
- **Solver output** lives in a private Storage bucket as `<spot>/<flop>.json.gz`, indexed by a table. The API downloads on demand and caches on disk and in memory. The solver itself still runs only offline (AGPL).
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
| `solver_spots`, `solved_flops` | Index of solved flops in Storage: weight, accuracy, tree, whether EVs are included, size, checksum |

## Build steps

1. **Database and persistence, guests first.** ✅ Done.
   - Drizzle schema and migrations (`npm run db:migrate`).
   - A `Repo` interface with a Postgres version and an in-memory version for tests.
   - Hand and session stores backed by the repo.
   - A guest id in the browser, separate from the practice session id.
   - Ownership checks on every hand, decision, coach, and review route (today any hand id works for anyone).
   - Coach rate limits per player instead of per IP.
2. **Sign-in.** ✅ Done.
   - Auth modal (Google button, email/password, forgot password), set-new-password on the recovery link, account menu.
   - The API verifies tokens and creates the profile row.
   - `POST /api/me/claim-guest` moves a guest's history to the new account.
   - `DELETE /api/me` deletes the account and its data.
3. **Features on the stored data.**
   - Coach answers saved: explanations are paid for once, and chats reappear.
   - Saved session reviews.
   - Settings synced across devices.
   - **Star a decision** (with an optional note).
   - A **"My hands"** view (filters: starred, mistakes, flop, position; replay a decision with its chart and coach thread).
   - Progress stats over time (reusing `computeSessionStats`).
4. **Solver data off-device.**
   - `apps/api/scripts/uploadSolverOutput.ts`: gzip, upload, index; idempotent and resumable.
   - `FlopStore` source switch: `SOLVER_SOURCE=local|remote`, with a disk cache in `.cache/solver/`.
   - Measure the gzipped size of one spot first. The free tier allows 1 GB of storage and a 500 MB database: 184 flops × 47 spots should fit, while all 1,755 flops for every spot needs the Pro plan (about $25/month).
5. **Docs:** finish this file and update `CLAUDE.md`, both `.env.example` files, `solver/README.md`, and `docs/postflop-plan.md`.

Out of scope for now: hosting the app itself, other sign-in providers, separate dev and prod projects.

**Guest data is temporary** (decided 2026-10-04): a guest's session and everything in it is deleted when they start a new session or after 24 hours with no new hand, unless they sign up during it. Details in `docs/database-schema.md`.

## One-time Supabase setup (Jordan)

1. **Create a project** at supabase.com. Pick the region closest to you and save the database password somewhere safe.
2. **Google sign-in:**
   - In Google Cloud Console, create an OAuth client (type "Web application").
   - Add the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - In Supabase → Authentication → Providers → Google, paste the client ID and secret, and enable it.
3. **Email sign-in:** in Authentication → Providers → Email, keep it enabled with "Confirm email" on.
4. **URLs:** in Authentication → URL Configuration, set the Site URL to `http://localhost:5173` and add it to the redirect URLs. Add the real domain later.
5. **Keys:** the project URL, the publishable key, the secret (service-role) key, and the database connection string (the session pooler URI if your network has no IPv6).
   - Put the web values in `apps/web/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
   - Put the API values in `apps/api/.env`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   - Both files are gitignored. Never paste these into a `.env.example` file.

## Testing

- **Unit tests** run on the in-memory repo: ownership 404s, guest claim, stars, settings, saved coach messages, progress stats.
- **Database tests** run only when `DATABASE_URL` is set: migrations apply, and the Postgres repo passes the same tests as the in-memory one.
- **RLS check:** the publishable key can't read `hands`.
- **End to end in a browser:** play as a guest and star a decision, sign up, see that history under the account, restart the API, and confirm everything (including a hand in progress) is still there. Then try Google sign-in and a password reset.
- **Solver from Storage:** with `SOLVER_SOURCE=remote` and no local `solver/output`, flop practice still works.

## How it works now (steps 1–2)

- **Who's asking:** every API request carries `X-Guest-Id` (a random id in localStorage, `apps/web/src/auth/identity.ts`). A signed-in browser also sends `Authorization: Bearer <Supabase token>`, which wins. `apps/api/src/auth/player.ts` resolves the player; tokens are checked locally against the project's public signing keys (`src/auth/verify.ts`). Hand, coach and review routes answer 401 without an identity and 404 for someone else's data.
- **Storage:** `src/db/repo.ts` defines the `Repo` interface plus an in-memory version (tests, or running without `DATABASE_URL`); `src/db/pgRepo.ts` is the Supabase Postgres version. `src/engine/handService.ts` keeps hands being played in memory and writes every change through, so a restart continues from the database. A finished hand drops the engine state (deck, every hole card) and keeps a replay (action log + result).
- **Guests:** starting a hand in a new session deletes the guest's previous sessions; the API deletes guest sessions idle for 24 hours (hourly check in `src/server.ts`).
- **Sign-in (web):** `apps/web/src/components/AccountMenu.tsx` has the sign-in/sign-up dialog (Google, email + password, forgot password), the new-password dialog for reset links, and the account menu (sign out, delete account). On sign-in, `POST /api/me/claim-guest` moves the guest's session to the account and the browser starts a fresh guest id. Signing out resets the table.
- **Deleting an account:** `DELETE /api/me` deletes the Supabase user with the secret key (`src/auth/accounts.ts`); foreign keys delete everything it owned.
- **Tests:** `npm test` uses the in-memory repo. `RUN_DB_TESTS=1 npx vitest run test/persistence.test.ts` (in `apps/api`) also runs the storage checks against Supabase, cleaning up after itself.
- **Not yet:** the stored coach conversations, stars and tags, settings sync, "My hands", and solver data in Storage (steps 3–4).
