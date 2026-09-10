# Setup

Three things need doing before the pipeline can actually run — none of them
code, all one-time:

## 1. Create a Supabase project (free tier)

1. Sign up at [supabase.com](https://supabase.com) and create a new project.
2. Open the SQL editor and run everything in `schema.sql` from this repo —
   creates the tables and seeds the five sources.
3. Under Project Settings → API, grab:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (not the anon key — the pipeline needs write
     access and runs server-side only, never in a browser) → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Get an Anthropic API key

1. Create a key at [console.anthropic.com](https://console.anthropic.com).
2. That's `ANTHROPIC_API_KEY`. Cost at this review volume should be
   negligible (a few dollars/month at most — see PLANNING.md §5) but it's
   the one part of this stack that isn't literally free, worth keeping an
   eye on usage early on.

## 3. Add the secrets to this GitHub repo

Repo → Settings → Secrets and variables → Actions → New repository secret,
for each of:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

(`GITHUB_TOKEN` is provided automatically inside Actions — nothing to add
for that one.)

## Running it

Once secrets are in place:
- **Import**: drop a CSV into `imports/` (see `imports/README.md` for the
  format) and push to `main` — the *Import reviews* workflow picks it up
  automatically. While this branch isn't merged to `main` yet, trigger it
  manually instead: Actions tab → "Import reviews" → Run workflow.
- **Staleness check**: runs weekly on its own (Mondays); also
  manually-triggerable the same way from the Actions tab.

To run locally instead of through Actions: copy `.env.example` to `.env`,
fill it in, then `npm install` and `npm run import` / `npm run check-stale`.
