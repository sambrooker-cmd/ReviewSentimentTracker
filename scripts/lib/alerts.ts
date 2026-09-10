import type { SupabaseClient } from "@supabase/supabase-js";

// See PLANNING.md §6: rating trend is the lagging signal, theme velocity on
// specific complaint themes is the earlier warning.
const RATING_ALERT_WINDOW_DAYS = 7;
const RATING_BASELINE_WINDOW_DAYS = 90;
const RATING_DROP_THRESHOLD = 0.4;
const RATING_MIN_SAMPLE = 5;

const THEME_ALERT_WINDOW_DAYS = 7;
const THEME_BASELINE_WEEKS = 8;
const THEME_MIN_COUNT = 3;
const THEME_SPIKE_MULTIPLIER = 2.5;

export const STALE_IMPORT_DAYS = 10;
export const ALERT_REALERT_COOLDOWN_DAYS = 7;

export interface DetectedAlert {
  type: "sentiment_spike" | "theme_spike" | "import_stale";
  sourceId: string | null;
  window: string;
  metricValue: number;
  threshold: number;
  summary: string;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Rolling 7-day average rating vs. a 90-day baseline — the lagging signal. */
export async function detectRatingTrendAlert(supabase: SupabaseClient): Promise<DetectedAlert | null> {
  const { data: recent, error: recentError } = await supabase
    .from("reviews")
    .select("rating")
    .gte("review_date", daysAgoIso(RATING_ALERT_WINDOW_DAYS));
  if (recentError) throw recentError;
  if (!recent || recent.length < RATING_MIN_SAMPLE) return null;

  const { data: baseline, error: baselineError } = await supabase
    .from("reviews")
    .select("rating")
    .gte("review_date", daysAgoIso(RATING_BASELINE_WINDOW_DAYS))
    .lt("review_date", daysAgoIso(RATING_ALERT_WINDOW_DAYS));
  if (baselineError) throw baselineError;
  if (!baseline || baseline.length < RATING_MIN_SAMPLE) return null;

  const avg = (rows: { rating: number }[]) => rows.reduce((sum, r) => sum + r.rating, 0) / rows.length;
  const recentAvg = avg(recent);
  const baselineAvg = avg(baseline);
  const drop = baselineAvg - recentAvg;

  if (drop < RATING_DROP_THRESHOLD) return null;
  return {
    type: "sentiment_spike",
    sourceId: null,
    window: `${RATING_ALERT_WINDOW_DAYS}d vs ${RATING_BASELINE_WINDOW_DAYS}d baseline`,
    metricValue: Number(recentAvg.toFixed(2)),
    threshold: Number((baselineAvg - RATING_DROP_THRESHOLD).toFixed(2)),
    summary:
      `Average rating dropped to ${recentAvg.toFixed(2)} over the last ${RATING_ALERT_WINDOW_DAYS} days, ` +
      `down from a ${baselineAvg.toFixed(2)} baseline (${recent.length} recent reviews).`,
  };
}

/** Spike in a specific complaint theme's mention rate — the earlier warning (PLANNING.md §6). */
export async function detectThemeSpikeAlerts(supabase: SupabaseClient): Promise<DetectedAlert[]> {
  const { data: rows, error } = await supabase
    .from("review_themes")
    .select("theme_id, themes(name, category), reviews!inner(review_date)")
    .gte("reviews.review_date", daysAgoIso(THEME_BASELINE_WEEKS * 7));
  if (error) throw error;
  if (!rows) return [];

  type Row = {
    theme_id: string;
    themes: { name: string; category: string } | null;
    reviews: { review_date: string } | null;
  };
  const byTheme = new Map<string, { name: string; dates: string[] }>();
  for (const r of rows as unknown as Row[]) {
    if (!r.themes || !r.reviews || r.themes.category !== "complaint") continue;
    const entry = byTheme.get(r.theme_id) ?? { name: r.themes.name, dates: [] };
    entry.dates.push(r.reviews.review_date);
    byTheme.set(r.theme_id, entry);
  }

  const currentWindowStart = daysAgoIso(THEME_ALERT_WINDOW_DAYS);
  const priorWeeks = THEME_BASELINE_WEEKS - 1;
  const alerts: DetectedAlert[] = [];

  for (const theme of byTheme.values()) {
    const currentCount = theme.dates.filter((d) => d >= currentWindowStart).length;
    if (currentCount < THEME_MIN_COUNT) continue;

    const priorCount = theme.dates.filter((d) => d < currentWindowStart).length;
    const baselineWeeklyAvg = priorCount / priorWeeks;
    // No usable baseline yet -> a bare minimum count is the only bar (cold start).
    if (baselineWeeklyAvg > 0 && currentCount < baselineWeeklyAvg * THEME_SPIKE_MULTIPLIER) continue;

    alerts.push({
      type: "theme_spike",
      sourceId: null,
      window: `${THEME_ALERT_WINDOW_DAYS}d vs ${priorWeeks}-week baseline`,
      metricValue: currentCount,
      threshold: Number((baselineWeeklyAvg * THEME_SPIKE_MULTIPLIER).toFixed(1)),
      summary:
        `"${theme.name}" mentioned in ${currentCount} reviews in the last ${THEME_ALERT_WINDOW_DAYS} days, ` +
        `vs. a baseline of ~${baselineWeeklyAvg.toFixed(1)}/week.`,
    });
  }
  return alerts;
}

/** No new import for a source in a while — the safety net for the manual-import workflow (PLANNING.md §3/§6). */
export async function detectStaleImportAlerts(
  supabase: SupabaseClient,
): Promise<(DetectedAlert & { sourceId: string })[]> {
  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("id, name")
    .eq("enabled", true);
  if (sourcesError) throw sourcesError;
  if (!sources) return [];

  const alerts: (DetectedAlert & { sourceId: string })[] = [];
  for (const source of sources) {
    const { data: lastBatch, error } = await supabase
      .from("import_batches")
      .select("imported_at")
      .eq("source_id", source.id)
      .order("imported_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!lastBatch) continue; // never imported yet — that's a setup gap, not staleness

    const daysSince = (Date.now() - new Date(lastBatch.imported_at as string).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < STALE_IMPORT_DAYS) continue;

    alerts.push({
      type: "import_stale",
      sourceId: source.id as string,
      window: `${Math.floor(daysSince)}d since last import`,
      metricValue: Math.floor(daysSince),
      threshold: STALE_IMPORT_DAYS,
      summary:
        `No new ${source.name} import in ${Math.floor(daysSince)} days — last one was ` +
        `${new Date(lastBatch.imported_at as string).toISOString().slice(0, 10)}.`,
    });
  }
  return alerts;
}
