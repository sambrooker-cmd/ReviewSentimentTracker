import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedReview, ReviewAnalysisResult, SourceType, ThemeTag } from "./types.js";

export async function getSourceIdByType(supabase: SupabaseClient, type: SourceType): Promise<string> {
  const { data, error } = await supabase.from("sources").select("id").eq("type", type).single();
  if (error || !data) throw new Error(`Unknown or missing source "${type}" — did schema.sql seed it? (${error?.message})`);
  return data.id as string;
}

export async function getAllThemeNames(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("themes").select("name");
  if (error) throw error;
  return (data ?? []).map((t) => t.name as string);
}

/** Filters out reviews that already exist by dedupe_hash or (source_id, external_id). */
export async function filterNewReviews(
  supabase: SupabaseClient,
  sourceId: string,
  reviews: NormalizedReview[],
): Promise<NormalizedReview[]> {
  const hashes = reviews.map((r) => r.dedupeHash);
  const { data: byHash, error: hashError } = await supabase
    .from("reviews")
    .select("dedupe_hash")
    .in("dedupe_hash", hashes);
  if (hashError) throw hashError;
  const existingHashes = new Set((byHash ?? []).map((r) => r.dedupe_hash as string));

  const externalIds = reviews.map((r) => r.externalId).filter((id): id is string => id !== null);
  let existingExternalIds = new Set<string>();
  if (externalIds.length > 0) {
    const { data: byExternalId, error: extError } = await supabase
      .from("reviews")
      .select("external_id")
      .eq("source_id", sourceId)
      .in("external_id", externalIds);
    if (extError) throw extError;
    existingExternalIds = new Set((byExternalId ?? []).map((r) => r.external_id as string));
  }

  return reviews.filter(
    (r) => !existingHashes.has(r.dedupeHash) && !(r.externalId && existingExternalIds.has(r.externalId)),
  );
}

export async function insertImportBatch(
  supabase: SupabaseClient,
  sourceId: string,
  filename: string,
  rowCount: number,
): Promise<string> {
  const { data, error } = await supabase
    .from("import_batches")
    .insert({ source_id: sourceId, filename, row_count: rowCount })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to insert import batch: ${error?.message}`);
  return data.id as string;
}

export async function insertReviews(
  supabase: SupabaseClient,
  sourceId: string,
  importBatchId: string,
  reviews: NormalizedReview[],
): Promise<{ id: string; reviewText: string; rating: number }[]> {
  if (reviews.length === 0) return [];
  const rows = reviews.map((r) => ({
    source_id: sourceId,
    external_id: r.externalId,
    dedupe_hash: r.dedupeHash,
    rating: r.rating,
    review_text: r.reviewText,
    author_display_name: r.reviewerName,
    reviewer_raw_name: r.reviewerName,
    review_date: r.reviewDate,
    source_url: r.reviewUrl,
    import_batch_id: importBatchId,
  }));
  const { data, error } = await supabase
    .from("reviews")
    .insert(rows)
    .select("id, review_text, rating");
  if (error) throw new Error(`Failed to insert reviews: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id as string, reviewText: r.review_text as string, rating: r.rating as number }));
}

export async function getOrCreateThemeIds(supabase: SupabaseClient, themes: ThemeTag[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const theme of themes) {
    const { data: existing, error: selectError } = await supabase
      .from("themes")
      .select("id")
      .eq("name", theme.name)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing) {
      result.set(theme.name, existing.id as string);
      continue;
    }
    const { data: created, error: insertError } = await supabase
      .from("themes")
      .insert({ name: theme.name, category: theme.category })
      .select("id")
      .single();
    if (insertError || !created) {
      // Race with another insert of the same theme name — fetch it instead of failing.
      const { data: retry } = await supabase.from("themes").select("id").eq("name", theme.name).maybeSingle();
      if (retry) {
        result.set(theme.name, retry.id as string);
        continue;
      }
      throw new Error(`Failed to create theme "${theme.name}": ${insertError?.message}`);
    }
    result.set(theme.name, created.id as string);
  }
  return result;
}

export async function insertReviewAnalysis(
  supabase: SupabaseClient,
  reviewId: string,
  analysis: ReviewAnalysisResult,
  model: string,
  themeIdsByName: Map<string, string>,
): Promise<void> {
  const { error: analysisError } = await supabase.from("review_analysis").insert({
    review_id: reviewId,
    sentiment_label: analysis.sentimentLabel,
    sentiment_score: analysis.sentimentScore,
    quote_bank_candidate: analysis.quoteBankCandidate,
    quote_bank_status: "pending",
    quote_bank_rationale: analysis.quoteBankRationale,
    model,
  });
  if (analysisError) throw new Error(`Failed to insert review_analysis for ${reviewId}: ${analysisError.message}`);

  const themeRows = analysis.themes
    .map((t) => themeIdsByName.get(t.name))
    .filter((id): id is string => Boolean(id))
    .map((themeId) => ({ review_id: reviewId, theme_id: themeId }));
  if (themeRows.length > 0) {
    const { error: themeLinkError } = await supabase.from("review_themes").insert(themeRows);
    if (themeLinkError) throw new Error(`Failed to link themes for ${reviewId}: ${themeLinkError.message}`);
  }
}

/** Avoids re-filing an alert (and a duplicate GitHub Issue) within `cooldownDays` for the same type+source. */
export async function hasRecentAlert(
  supabase: SupabaseClient,
  type: string,
  sourceId: string | null,
  cooldownDays: number,
): Promise<boolean> {
  const since = new Date();
  since.setDate(since.getDate() - cooldownDays);
  let query = supabase
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("type", type)
    .gte("triggered_at", since.toISOString());
  query = sourceId ? query.eq("source_id", sourceId) : query.is("source_id", null);
  const { count, error } = await query;
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function insertAlert(
  supabase: SupabaseClient,
  alert: {
    type: string;
    sourceId: string | null;
    window: string;
    metricValue: number;
    threshold: number;
    summary: string;
  },
  githubIssueUrl: string | null,
): Promise<void> {
  const { error } = await supabase.from("alerts").insert({
    type: alert.type,
    source_id: alert.sourceId,
    window: alert.window,
    metric_value: alert.metricValue,
    threshold: alert.threshold,
    summary: alert.summary,
    github_issue_url: githubIssueUrl,
  });
  if (error) throw new Error(`Failed to insert alert: ${error.message}`);
}
