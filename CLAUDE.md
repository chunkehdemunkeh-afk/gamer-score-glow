# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**CompletionDex** — an Xbox 100% game-completion leaderboard. Users link their Xbox gamertag, and the app fetches their 100%-completed games directly from the Xbox Live API (via openxbl.io). When logging a completion, users self-report hours played; the server cross-checks those hours against Xbox achievement timestamps, community medians, and a gamerscore-per-hour ceiling. Completions that pass are `approved` and earn points; suspicious ones are `flagged` for review.

Points are purely time-based (see `src/lib/scoring.ts`): <1 h = 10 pts, 1–5 h = 25, 5–15 h = 50, 15–30 h = 75, 30 h+ = 100.

## Commands

```bash
bun run dev        # start dev server (Vite + TanStack Start)
bun run build      # production build
bun run lint       # ESLint
bun run format     # Prettier
```

There are no tests.

## Stack

- **Framework**: TanStack Start (SSR React, file-based routing via TanStack Router)
- **Database / Auth**: Supabase (Postgres + Supabase Auth)
- **Styling**: Tailwind CSS v4 + shadcn/ui components (Radix primitives in `src/components/ui/`)
- **Data fetching**: TanStack Query on the client
- **Package manager**: Bun

## Architecture

### Routing

Routes live in `src/routes/` and are file-based (TanStack Router). The generated route tree is at `src/routeTree.gen.ts` — do not edit it manually; it regenerates on `dev`/`build`.

- `/` — public leaderboard + recent completions
- `/login`, `/signup`, `/reset-password` — auth pages
- `/onboarding` — first-time gamertag linking (calls `lookupGamertag` server fn, then `createProfile`)
- `/_authenticated` — layout route that guards all children; redirects to `/login` if unauthenticated
- `/_authenticated/dashboard` — user's completions list
- `/_authenticated/log` — log a new completion
- `/u/$gamertag` — public profile page

### Server functions

Business logic that needs secrets or must not run in the browser lives in `src/lib/*.functions.ts` as TanStack Start `createServerFn` calls. Server functions requiring a logged-in user apply the `requireSupabaseAuth` middleware (`src/integrations/supabase/auth-middleware.ts`), which reads the `Authorization: Bearer <token>` header, validates it against Supabase, and injects `{ supabase, userId, claims }` into `context`.

### openxbl.io API quirks

- The search endpoint (`GET /search/{gamertag}`) wraps its response in a `content` object: `{ content: { people: [...] } }` — not `{ people: [...] }` at the top level.
- Old-format Xbox gamertags with spaces (pre-2019) must be sent with a raw space in the URL path, not `%20`. Use `encodeURIComponent(tag).replace(/%20/g, " ")`.
- Do not send `Content-Type` on GET requests; use `Accept-Language: en-GB` instead.

### Server functions

Key server functions:
- `lookupGamertag` — public; resolves gamertag → xuid + avatar via openxbl.io
- `getCompletedTitles` — auth-gated; fetches the user's 100%-completed Xbox titles
- `getTitleAchievements` — auth-gated; fetches unlock timestamps for a single title (used for anti-cheat)
- `logCompletion` — auth-gated; full anti-cheat pipeline, then inserts into `completions`
- `deleteCompletion` — auth-gated; deletes own completion
- `createProfile` — auth-gated; inserts into `profiles`

### Database schema (Supabase)

| Table | Purpose |
|---|---|
| `profiles` | One row per user: `gamertag`, `xuid`, `gamerpic` |
| `completions` | One row per logged completion: `title_id`, `hours_played`, `points`, `status` (`approved`/`flagged`/`rejected`), `flag_reason` |
| `game_stats` | Aggregate stats per title (`median_hours`, `submission_count`) — used in anti-cheat; updated by the `refresh_game_stats` Postgres function |
| `user_roles` | RBAC: `admin`, `moderator`, `user` |

Types are generated at `src/integrations/supabase/types.ts`.

### Auth

`AuthProvider` (`src/hooks/use-auth.tsx`) wraps the app and exposes `{ user, session, loading }` via `useAuth()`. Auth state changes invalidate the TanStack Router and all React Query caches (wired in `src/routes/__root.tsx`).

The browser Supabase client is at `src/integrations/supabase/client.ts`; server-side server functions instantiate their own Supabase client per-request inside the middleware using the user's JWT.

### Environment variables

Required in `.env`:
- `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` — used server-side in server functions
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` — used client-side (exposed via Vite)
- `OPENXBL_API_KEY` — server-side only; key for the openxbl.io Xbox Live proxy API
