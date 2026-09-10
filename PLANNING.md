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
| 2 | Existing API access | Trustpilot + Feefo *accounts* exist; API access unconfirmed for either — see §2 |
| 3 | Who sees alerts | Just the user — no team distribution needed |
| 4 | Quote bank vs. negative-trend priority | Negative-trend detection is the main driver; quote bank is secondary |
| 5 | Hosting/budget | Must be free (same constraint as the pricing tracker) |

## 2. Source viability — researched 2026-09-10

This is the gating finding for the whole project. Summary, most to least viable:

| Source | Official API? | Cost | Access requirement | Verdict |
|---|---|---|---|---|
| **Google Business Profile** | Yes (Business Profile API) | Free (no per-call billing) | Google Cloud project, OAuth, a **verified, owned** GBP listing (60+ days verified), formal quota request approved by Google (starts at zero quota) | **Viable for v1**, if Ambassador owns/administers the GBP listing. Approval can take time — start this early. |
| **Feefo** | Yes (OAuth2 "App Key" API, `feefo.readme.io`) | Unclear whether included in your existing merchant plan or a paid tier | Create an App Key under Settings → App Keys in your Feefo dashboard | **Needs a 5-minute check on your end** (see §3) — this is the fastest thing to unblock since you already have the account |
| **Trustpilot** | Yes (Business API) | **Paid add-on only** — the API module is not available on Starter/Plus/Premium without an add-on purchase; effectively gated behind Premium/Enterprise + a separate API module fee (tiered by call volume) | Would require Ambassador to upgrade/add the API module | **Not free today.** Worth a 5-minute check of your plan tier (see §3), but budget for "not available" as the likely answer. RSS/widget-scraping fallbacks exist but are fragile and against Trustpilot's terms for structured reuse — not recommended. |
| **TripAdvisor** | The old Content API (5,000 free calls/month) **sunset 31 Aug 2026** — i.e. it's already gone. Replacement is the "Terra" API | Free tier exists (~1,000 calls) but early signals suggest production/agentic access needs a signed commercial order, not pure self-serve | Uncertain, in flux | **Skip for v1.** Re-evaluate once Terra's self-serve terms settle. |
| **Cruise Critic** | No official public developer API or program found | N/A | N/A | **Skip.** Only route in is third-party scraper services (e.g. WExtractor), which conflicts with the brief's own preference for official APIs over scraping. Revisit only if Cruise Critic/its owner (Tripadvisor Media Group) offers a licensing deal. |

**Net effect on v1 scope:** realistically buildable sources are **Google** (pending GBP ownership + approval) and **possibly Feefo** (pending your App Key check). Trustpilot is likely blocked by cost, not effort. Cruise Critic and TripAdvisor are out for now. The architecture below is built source-agnostic so adding Trustpilot later (if the plan changes) or TripAdvisor's Terra API (once it stabilizes) is a connector, not a redesign.

## 3. Action items only you can resolve (do these first, before build starts)

1. **Feefo**: log into the Feefo merchant dashboard → Settings → App Keys. If you can create an App Key and see Client ID/Secret, the API is available to you at no extra cost — tell me and I'll wire up the connector first.
2. **Trustpilot**: check your account's plan tier (Starter/Plus/Premium/Enterprise) under billing, and look for an "API" or "Integrations" section. If it's Starter/Plus with no API module, Trustpilot is out unless Ambassador is willing to pay for the add-on.
3. **Google Business Profile**: confirm Ambassador (or you) is the verified owner/manager of the GBP listing, and how long it's been verified. If yes, I can start the Cloud Console project + API access request immediately — the approval step is the longest lead time in this whole plan, so it should be kicked off in parallel with everything else, not last.

## 4. Data model

```
sources          (id, name, type[trustpilot|google|feefo|...], config_json, enabled)
reviews          (id, source_id, external_id, rating, text, author_display_name,
                   reviewer_raw_name,        -- private, never exposed in dashboard/quote bank
                   review_date, source_url, pulled_at)
review_analysis  (review_id, sentiment_label, sentiment_score, themes[] via join table,
                   quote_bank_candidate bool, quote_bank_status[pending|approved|rejected],
                   model, analyzed_at)
themes           (id, name, category[complaint|praise])
review_themes    (review_id, theme_id)        -- many-to-many
alerts           (id, type, window, metric_value, threshold, summary, triggered_at, status)
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

Same shape as the pricing tracker: this needs a scheduler, not just static
hosting.

- **Ingestion + analysis**: scheduled GitHub Actions workflow (e.g. every 6h)
  — pulls new reviews per source, calls Claude for analysis, writes results.
  Free on GitHub's free tier at this frequency/volume.
- **Storage**: Supabase free-tier Postgres (500MB, free indefinitely, gives a
  real DB + instant REST API the dashboard can query directly). Fallback if
  you'd rather not sign up for another service: commit a SQLite file
  straight into this repo from the Action ("git as the database") — zero
  signup, but a live dashboard would need to read a static export rather than
  query it directly. Recommend Supabase unless you push back.
- **Dashboard**: static/SSR site (e.g. Next.js) on Vercel or Cloudflare Pages
  free tier, querying Supabase. Views: rating trend chart, recent-reviews
  feed, theme breakdown, alert banner; separate quote-bank view.
- **Alerting**: auto-filed GitHub Issue on threshold trip (see §6) — no extra
  infra or signup required.
- **The one non-free piece**: the Claude API calls themselves (§5) — flagged,
  not hidden.

## 10. Phased build plan

- **Phase 0 (done)**: this scoping doc.
- **Phase 1 — MVP**: whichever of Google/Feefo clears §3 first → ingestion
  connector, Claude analysis pipeline, storage schema, rating-trend + theme-
  velocity detectors, GitHub Issue alerting, dashboard v1 (trend + feed +
  theme breakdown).
- **Phase 2**: add the second confirmed source; backfill trend baselines.
- **Phase 3**: quote bank (flagging, approval workflow, attribution
  formatting, browsable view).
- **Phase 4 (later, conditional)**: Trustpilot if Ambassador adds the API
  module; TripAdvisor Terra once its self-serve terms are confirmed; Cruise
  Critic only if an official licensing route appears.

## Next step

Waiting on the three checks in §3 — Feefo App Key, Trustpilot plan tier,
Google Business Profile ownership/verification age — to know which connector
to actually build first. Tell me what you find (or say "just start with
whichever is feasible" and I'll assume Google, since it's the only source
that's unambiguously free and self-serve, and kick off the Cloud Console
access request in parallel with building the rest of the pipeline).
