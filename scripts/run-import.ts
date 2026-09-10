import { readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { ANALYSIS_MODEL, analyzeReview } from "./lib/claude.js";
import {
  filterNewReviews,
  getAllThemeNames,
  getOrCreateThemeIds,
  getSourceIdByType,
  insertImportBatch,
  insertReviewAnalysis,
  insertReviews,
} from "./lib/db.js";
import { detectRatingTrendAlert, detectThemeSpikeAlerts } from "./lib/alerts.js";
import { processAlert } from "./lib/processAlerts.js";
import { parseImportFile } from "./lib/sourceMappings.js";
import { getSupabaseClient } from "./lib/supabase.js";
import type { NormalizedReview, SourceType } from "./lib/types.js";

const IMPORTS_DIR = join(process.cwd(), "imports");
const PROCESSED_DIR = join(IMPORTS_DIR, "processed");

function listImportFiles(): string[] {
  return readdirSync(IMPORTS_DIR).filter((f) => f.toLowerCase().endsWith(".csv") && f !== "template.csv");
}

function groupBySource(reviews: NormalizedReview[]): Map<SourceType, NormalizedReview[]> {
  const map = new Map<SourceType, NormalizedReview[]>();
  for (const review of reviews) {
    const list = map.get(review.source) ?? [];
    list.push(review);
    map.set(review.source, list);
  }
  return map;
}

async function main() {
  const files = listImportFiles();
  if (files.length === 0) {
    console.log("No new import files found in imports/.");
  }

  const supabase = getSupabaseClient();

  for (const file of files) {
    console.log(`\nProcessing ${file}...`);
    const filePath = join(IMPORTS_DIR, file);
    const content = readFileSync(filePath, "utf-8");

    let parsed: NormalizedReview[];
    try {
      parsed = parseImportFile(content);
    } catch (err) {
      console.error(`  Failed to parse ${file}: ${(err as Error).message}`);
      console.error("  Leaving it in place — fix the file and re-run.");
      continue;
    }
    if (parsed.length === 0) {
      console.log(`  ${file} has no rows, skipping.`);
      continue;
    }

    let totalInserted = 0;
    for (const [sourceType, rows] of groupBySource(parsed)) {
      const sourceId = await getSourceIdByType(supabase, sourceType);
      const newRows = await filterNewReviews(supabase, sourceId, rows);
      console.log(`  ${sourceType}: ${rows.length} row(s), ${newRows.length} new after dedupe`);
      if (newRows.length === 0) continue;

      const batchId = await insertImportBatch(supabase, sourceId, file, newRows.length);
      const inserted = await insertReviews(supabase, sourceId, batchId, newRows);

      const existingThemeNames = await getAllThemeNames(supabase);
      for (const review of inserted) {
        try {
          const analysis = await analyzeReview(review.reviewText, review.rating, existingThemeNames);
          const themeIds = await getOrCreateThemeIds(supabase, analysis.themes);
          await insertReviewAnalysis(supabase, review.id, analysis, ANALYSIS_MODEL, themeIds);
          for (const t of analysis.themes) {
            if (!existingThemeNames.includes(t.name)) existingThemeNames.push(t.name);
          }
        } catch (err) {
          console.error(`  Failed to analyze review ${review.id}: ${(err as Error).message}`);
        }
      }
      totalInserted += inserted.length;
    }

    renameSync(filePath, join(PROCESSED_DIR, `${Date.now()}-${file}`));
    console.log(`  Imported ${totalInserted} new review(s) from ${file}, moved to imports/processed/.`);
  }

  console.log("\nChecking alert thresholds...");
  const ratingAlert = await detectRatingTrendAlert(supabase);
  if (ratingAlert) await processAlert(supabase, ratingAlert);

  const themeAlerts = await detectThemeSpikeAlerts(supabase);
  for (const alert of themeAlerts) await processAlert(supabase, alert);

  if (!ratingAlert && themeAlerts.length === 0) console.log("No alert thresholds tripped.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
