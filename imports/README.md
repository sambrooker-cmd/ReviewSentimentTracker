# Importing reviews

Drop a CSV in this folder and push (or use GitHub's "Add file" button in the
web UI) to bring new reviews in. See `PLANNING.md` §3 for the full pipeline
design.

## Shared template

`template.csv` in this folder has the two example rows below — delete them
before adding your real rows, they're just there to show the expected shape.

| column | notes |
|---|---|
| `source` | one of `trustpilot`, `google`, `feefo`, `tripadvisor`, `cruisecritic` |
| `rating` | 1–5 |
| `review_date` | `YYYY-MM-DD` |
| `reviewer_name` | as shown publicly on the platform (e.g. "Sarah M.") |
| `review_text` | the review body. Wrap in quotes if it contains a comma |
| `review_url` | optional — link to the individual review if you have it |

## Per-source notes

- **Feefo**: has a real export (Feedback tab → Download Data). Its CSV has
  different column names than the template above — drop Feefo's file in
  as-is (keep its original filename/headers) and the import script maps its
  columns automatically rather than you reformatting it by hand.
- **Trustpilot / Google / TripAdvisor / Cruise Critic**: no bulk export
  exists on these platforms — fill the shared template directly while
  looking at the dashboard. See the main chat / `PLANNING.md` §2 for exactly
  where to find reviews in each dashboard.

## What happens after you push

A GitHub Action picks up any new file here, parses it, dedupes against
already-imported reviews, runs Claude sentiment/theme analysis on the new
rows only, and moves the file to `imports/processed/` once done. (This
Action isn't built yet — template and folder structure come first so the
format is settled before the pipeline code is written against it.)
