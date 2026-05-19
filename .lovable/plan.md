## Goal

Track 100% Xbox game completions per user, score each completion by time/effort, and surface a public leaderboard plus a personal dashboard.

## Core decisions (from your answers)

- **Data source**: Official Xbox API (via OpenXBL) detects 100% completion + gamerscore. Hours played is **manually entered** by the user when logging a completion (Xbox API doesn't expose reliable playtime).
- **Anti-cheat for inflated hours**: see "Anti-cheat" section below.
- **Auth**: Email + password (Lovable Cloud).
- **Gamertag**: one per user, set once at profile setup, verified via Xbox API lookup.
- **Scoring tiers**:
  - <1h → 10 pts
  - 1–5h → 25 pts
  - 5–15h → 50 pts
  - 15–30h → 75 pts
  - 30h+ → 100 pts

## Pages / routes

- `/` — Landing + public leaderboard (top users by total points, recent completions feed).
- `/login`, `/signup`, `/reset-password`
- `/onboarding` — set gamertag, verified against Xbox API.
- `/dashboard` — your completed games table (game, completed date, hours, points), totals, rank.
- `/log-completion` — pick a 100%-completed game from your Xbox achievements, enter hours, submit.
- `/u/:gamertag` — public profile view of any user's completions.

## Anti-cheat for hours-played

Because users self-report hours and could inflate them on short games, we layer several checks:

1. **Achievement timestamp window**: pull the user's earliest and latest achievement unlock timestamps for the game via Xbox API. Reported hours cannot exceed (last unlock − first unlock) in real-world hours by more than a sane multiplier. If a game's achievements all unlocked within 2 hours of real time, claiming 40 hours is rejected.
2. **Community baseline**: store an aggregate of all submitted hours per game (title ID). New submissions more than 3× the median for that game get flagged and capped at the median tier for scoring (still saved, but marked "adjusted").
3. **Gamerscore-per-hour sanity check**: total game gamerscore ÷ reported hours. Anything above a reasonable ceiling (e.g. >500 GS/hour sustained) gets flagged.
4. **Flag review**: flagged entries show a badge on the dashboard and are excluded from the leaderboard until resolved. Admin (you) can approve/reject.
5. **Idempotency**: a (user, titleId) pair can only be logged once.

## Data model (Lovable Cloud / Postgres)

- `profiles` — user_id (FK auth.users), gamertag, xuid, avatar_url, created_at.
- `completions` — id, user_id, title_id, game_name, game_cover_url, total_gamerscore, completed_at (date from last achievement), hours_played, points, status ('approved' | 'flagged' | 'rejected'), created_at.
- `game_stats` — title_id, median_hours, submission_count (rolling aggregate for anti-cheat).
- `user_roles` — separate table with `app_role` enum for admin role (used to review flagged entries). RLS via `has_role()` SECURITY DEFINER function.
- RLS: users read/write only their own `completions` and `profiles`; everyone can read approved completions + profiles for leaderboard.

## Integrations

- **OpenXBL API** (Xbox data): requires an API key. You'll need to register at xbl.io and add `OPENXBL_API_KEY` as a secret. All Xbox calls happen server-side in `createServerFn` handlers (`xbox.functions.ts`). Endpoints used:
  - resolve gamertag → XUID
  - list player's titles + completion percentage
  - list achievements for a title (for timestamps + total gamerscore)
- **Lovable Cloud**: auth, database, RLS.

## Scoring + leaderboard logic

- On completion submission, server function:
  1. Verifies game is at 100% via Xbox API.
  2. Runs anti-cheat checks, adjusts/flags if needed.
  3. Computes points from tier.
  4. Inserts row, updates `game_stats` aggregate.
- Leaderboard query: sum of `points` per user where `status = 'approved'`, ordered desc, paginated. Recent completions: latest 20 approved rows joined with profiles.

## Technical details

- Stack: TanStack Start + Lovable Cloud (Supabase). All Xbox API calls in `src/lib/xbox.functions.ts` using `createServerFn` + `requireSupabaseAuth`. OpenXBL key read from `process.env.OPENXBL_API_KEY` inside `.handler()`.
- Realtime: leaderboard polls every 30s via TanStack Query (good enough for MVP; can upgrade to Supabase Realtime later).
- UI: shadcn components, semantic tokens in `src/styles.css`. Dark Xbox-inspired palette (deep greens/blacks) — happy to ask for a design direction before building if you'd like.

## Out of scope for v1

- Multiple gamertags per user
- TrueAchievements scraping
- Friend follows / social feed beyond the global recent-completions list
- Auto-refresh of completions (v1 = user manually logs each one; v2 could poll Xbox API on a schedule)

## Open question before build

Do you want me to ask for a **design direction** (3 visual concepts) before implementing, or jump straight to building with an Xbox-inspired dark theme?
