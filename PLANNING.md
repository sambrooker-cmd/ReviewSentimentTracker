# Review & Sentiment Tracker — Scoping & Plan

Standalone sister tool to the Digital Team Planner, for Ambassador Cruise Line's
Acquisition/Retention/Website digital team. Purpose: catch negative sentiment
trends early (before they snowball), and surface strong positive reviews as a
ready-to-use quote bank for Retention/Marketing.

Owner: this is a single-user tool (alerts go to one person, no team routing).

## 1. Answers to the open questions (from brief)

| # | Question | Answer |
|---|---|---|
| 1 | Which sources matter | All five investigated: Trustpilot, Google, Feefo, Cruise Critic, TripAdvisor |
| 2 | Existing API access | Decided against APIs entirely — going with manual CSV export/import for every source instead (see §2–§3) |
| 3 | Who sees alerts | Just the user — no team distribution needed |
| 4 | Quote bank vs. negative-trend priority | Negative-trend detection is the main driver; quote bank is secondary |
| 5 | Hosting/budget | Must be free (same constraint as the pricing tracker) |

## 2. Decision: no APIs — manual CSV export/import for every source

Superseded the API-access plan below. Rationale: Trustpilot's API is a paid
add-on, Feefo's tier was unconfirmed, Google's is free but gated behind a
slow approval process, and TripAdvisor/Cruise Critic don't have a workable
official API at all. Rather than let five different access problems gate the
whole build, every source now goes through the same manual export → CSV
import pipeline (§3). This also **removes the only real lead-time item** in
the original plan (Google's quota approval) — there's nothing left to wait
on, build can start now.

Per-source export reality, checked 2026-09-10 — this matters because "export"
means genuinely different things per platform:

| Source | Native bulk export? | What "manual" actually means here |
|---|---|---|
| **Feefo** | **Yes** — Feefo Hub → Feedback tab → "Download Data" emails you a CSV download link (valid 24h) | Real export, real file. One click plus a download. |
| **Trustpilot** | **No** built-in export found in the business dashboard | You'd be hand-copying rating/date/text/reviewer name per review from the dashboard into the shared template (§3). Third-party "Trustpilot exporter" browser extensions exist but those are scrapers wearing a nicer name — same ToS/trust problem we already ruled out, so not using one. |
| **Google Business Profile** | **No** export button in the GBP dashboard. Google Takeout has a "Business Profile" option but it's unconfirmed whether it actually includes customer review text/ratings (historically Takeout's GBP export has been about business/listing data, not reviews) | Treat as hand-copy from the dashboard like Trustpilot, unless you confirm Takeout does include reviews — worth a one-time check. |
| **TripAdvisor** | No native export in the Management Center | Same hand-copy situation, and lower priority anyway (§10). |
| **Cruise Critic** | No export feature at all — the owner dashboard is respond-only | Hand-copy if/when it's in scope; lowest priority (§10). |

Upside worth naming: hand-copying from your own logged-in dashboard is
completely clean from a ToS standpoint — it's just you reading your own
account's data and typing it in, nothing automated touches the platform.
This sidesteps essentially every scraping/ToS concern from the earlier plan.

Downside worth naming honestly: for everything except Feefo, "export" is
manual transcription, not a real export. I'll make the template as fast to
fill as possible (§3), but the actual bottleneck is your time, not
engineering — worth deciding per source whether that's worth it, especially
for TripAdvisor/Cruise Critic where it's lowest-value anyway.

## 3. The import pipeline

**One shared template**, so there's only one format to learn regardless of
source:

```
source, rating, review_date, reviewer_name, review_text, review_url
```

- Feefo's real CSV export has its own column names — I'll write a small
  mapping step so you can drop Feefo's export in as-is rather than
  reformatting it by hand.
- For Trustpilot/Google/TripAdvisor/Cruise Critic, you (or whoever) fills
  this template directly while looking at the dashboard — a spreadsheet with
  six columns, one row per review, is about as fast as manual transcription
  gets.

**How a file gets in**: drop the CSV into an `imports/` folder in this repo
and push (or use GitHub's web "Add file" button if that's easier than git
locally). A GitHub Action watches that folder and, on push:
1. Parses the file, maps columns per source.
2. **Dedupes** — Feefo rows dedupe on Feefo's own review ID; hand-filled rows
   have no stable ID, so dedupe on a hash of (source, rating, review_date,
   first ~50 chars of review_text) to catch re-exports that overlap with
   previously imported rows.
3. Runs Claude analysis (§5) on genuinely new rows only.
4. Writes to storage, recomputes trend/theme-velocity detectors (§6), files
   a GitHub Issue if a threshold trips.
5. Moves the processed file to `imports/processed/` so re-running the Action
   doesn't reprocess it.

**Staleness check**: since ingestion is now human-triggered instead of a
timer polling an API, a missed week means a real gap in trend data — not
just a delayed API call. A small weekly scheduled Action checks how long
it's been since the last import per source and files a reminder Issue if
it's gone quiet (e.g. >10 days), so the tool tells you when it's waiting on
you rather than silently going stale.

## 4. Data model

```
sources          (id, name, type[trustpilot|google|feefo|tripadvisor|cruisecritic], enabled)
reviews          (id, source_id, external_id,        -- null for hand-filled rows
                   dedupe_hash,                       -- hash(source, rating, date, text[:50]); unique index
                   rating, text, author_display_name,
                   reviewer_raw_name,        -- private, never exposed in dashboard/quote bank
                   review_date, source_url, import_batch_id, imported_at)
import_batches   (id, source_id, filename, imported_at, row_count)
review_analysis  (review_id, sentiment_label, sentiment_score, themes[] via join table,
                   quote_bank_candidate bool, quote_bank_status[pending|approved|rejected],
                   model, analyzed_at)
themes           (id, name, category[complaint|praise])
review_themes    (review_id, theme_id)        -- many-to-many
alerts           (id, type[sentiment_spike|theme_spike|import_stale], window, metric_value,
                   threshold, summary, triggered_at, status)
```

`reviewer_raw_name` is kept separate from the display/attribution name used anywhere
outside the private dashboard (see §6).

## 5. Sentiment & theme extraction (Claude API)

Per the brief, this uses the Claude API rather than a bespoke model:
- **Model**: Claude Haiku 4.5 — cheap and fast, appropriate for short-text
  classification at review volumes this small (likely tens of reviews/day, not
  thousands). Reserve a larger model only if theme extraction quality on Haiku
  turns out to be insufficient in testing.
- **Per-review call** returns: sentiment label + score, a set of theme tags
  drawn from a controlled vocabulary that grows over time (e.g. "embarkation
  delays," "cabin cleanliness," "dining," "staff friendliness," "value for
  money"), and a boolean + rationale for quote-bank candidacy.
- **Cost**: not literally free (unlike the rest of the stack) — at this
  volume, realistically a few dollars a month at most. Flagging this now since
  the brief's budget note says "free"; happy to swap in a lightweight
  keyword/lexicon-based fallback for sentiment only if even that's unwanted,
  but it would weaken theme extraction quality, which is the more valuable
  part of this feature.

## 6. Negative-trend detection — the actual "catch it early" mechanism

A dropping overall star average is a **lagging** signal — by the time it
moves, the problem has already been live for a while. Two detectors, not one:

1. **Rating trend**: rolling 7-day average vs. a 90-day baseline; alert if it
   drops beyond a threshold (e.g. 0.4+ stars).
2. **Theme velocity (the earlier warning)**: count of reviews tagged with a
   specific complaint theme (e.g. "embarkation delays") in a rolling 7-day
   window vs. that theme's own baseline rate. A spike in one specific
   complaint theme can show up well before it drags the overall average down
   — this is the mechanism that actually delivers "flag before it snowballs."

Alerting (since it's just you): no team routing needed. Cheapest free option
is the tool auto-filing a **GitHub Issue** in this repo when a threshold
trips — you already get GitHub notifications/email for that, zero extra
infra. Can add a proper email (e.g. Resend's free tier) later if GitHub
notifications aren't a reliable enough channel for you.

Worth being direct about a consequence of the manual-import decision (§2–§3):
detection is only as timely as your last import. A theme spiking the day
after your last upload won't surface until the next one. The `import_stale`
alert (§3, §4) is the safety net for that — it at least tells you when
you're behind, rather than letting the gap be invisible.

## 7. Quote bank

- Claude flags positive, specific, on-brand reviews as candidates
  (`quote_bank_candidate`), not an automatic publish — a human approval step
  (`quote_bank_status`) sits before anything is marketable, since reuse has
  ToS and consumer-advertising-law implications (see §8).
- Quote bank view: browsable, filterable by theme/source/rating, shows the
  approved quote plus a **consistent attribution format** rather than the raw
  reviewer name (see §8).
- Lower priority than negative-trend detection per your answer to Q4 — planned
  for Phase 3, not the MVP.

## 8. PII & ToS handling

- **Reviewer names**: stored privately (`reviewer_raw_name`); anything shown
  outside the internal dashboard (i.e., quote bank exports for
  Marketing/Retention) uses a consistent attribution style instead (e.g.
  "Sarah M. — Trustpilot review, March 2026"), not the full raw name.
- **GDPR**: review text + name is personal data even though publicly posted;
  reusing it for marketing is a new purpose beyond why it was originally
  posted, so this needs a lawful basis (legitimate interest is workable) and
  a **takedown path** — if a reviewer objects, their review needs to be
  removable from the quote bank on request.
- **Platform ToS on reuse**: Trustpilot and Feefo both have rules on quoting
  reviews externally (typically: don't alter the text, attribute the source).
  Since Ambassador is UK-based, marketing use of reviews should also hold up
  against **ASA/CAP Code** expectations for genuine, unaltered, attributable
  testimonials — another reason the quote bank has a manual approval gate
  rather than auto-publishing.
- I'll pull the specific reuse clauses from each platform's ToS once source
  access is confirmed, rather than guessing them now.

## 9. Architecture (free-tier constraint)

Simpler than the pricing tracker's shape, precisely because ingestion is now
human-triggered (a file drop) instead of an always-on poller — there's no
24/7 process needed, just something that reacts to a push and one weekly
timer.

- **Ingestion + analysis**: GitHub Action triggered on push to `imports/`
  (§3) — parses, dedupes, calls Claude on new rows, writes results, checks
  thresholds. A second Action on a weekly cron does the staleness check
  only. Both free on GitHub's free tier at this volume.
- **Storage**: Supabase free-tier Postgres (500MB, free indefinitely) — gives
  a real DB, an instant REST API for the dashboard, and somewhere for the
  quote-bank approve/reject clicks (§7) to write to. Fallback if you'd
  rather not add another signup: the Action commits processed data as
  JSON/SQLite straight back into this repo ("git as the database") — fully
  free with zero third-party accounts, but the quote-bank approval workflow
  would need to work as a GitHub-native action too (e.g. approving files an
  Issue/PR comment that a second Action applies) rather than a plain button
  click. Recommend Supabase for that reason unless you'd rather stay
  entirely inside GitHub.
- **Dashboard**: static/SSR site (e.g. Next.js) on Vercel or Cloudflare Pages
  free tier, querying Supabase. Views: rating trend chart, recent-reviews
  feed, theme breakdown, alert banner; separate quote-bank view.
- **Alerting**: auto-filed GitHub Issue on threshold trip or staleness (§6) —
  no extra infra or signup required.
- **The one non-free piece**: the Claude API calls themselves (§5) — flagged,
  not hidden.

## 10. Phased build plan

No more access gating — nothing left to wait on, so this starts from the
sources that actually carry review volume for a cruise line rather than
whichever cleared an approval process first:

- **Phase 0 (done)**: this scoping doc.
- **Phase 1 — MVP**: import pipeline (§3) with Feefo's real CSV mapping plus
  the shared hand-fill template for Trustpilot and Google; storage schema;
  Claude analysis; rating-trend + theme-velocity detectors; `import_stale`
  check; GitHub Issue alerting; dashboard v1 (trend + feed + theme
  breakdown).
- **Phase 2**: quote bank (flagging, approval workflow, attribution
  formatting, browsable view) — brought forward from Phase 3 in the old plan
  since there's no access blocker left forcing sources to go first.
- **Phase 3**: TripAdvisor and Cruise Critic via the same hand-fill template,
  if the manual-transcription effort is worth it for their lower review
  volume/priority (§2).
- **Phase 4 (later, conditional)**: revisit real APIs only if circumstances
  change — e.g. Ambassador adds Trustpilot's API module, or TripAdvisor's
  Terra API turns out to have workable self-serve terms. Not planned for,
  just not ruled out.

## Next step

Phase 1 pipeline is built: `imports/` template, parsing (shared template +
best-effort Feefo column mapping), dedupe, Claude analysis, rating-trend +
theme-velocity + import-staleness detectors, GitHub Issue alerting, and the
two GitHub Actions that run it all. See `SETUP.md` for the three things
needed before it can actually run (Supabase project + schema, Anthropic API
key, repo secrets) — none of it code, all one-time account setup.

Not yet built: the dashboard (§9) and the quote-bank approval UI (§7/§10
Phase 2) — next up once the ingestion side is confirmed working end to end
with a real import.
