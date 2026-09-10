import { parse } from "csv-parse/sync";
import { computeDedupeHash } from "./dedupe.js";
import { SOURCE_TYPES, type NormalizedReview, type SourceType } from "./types.js";

type Row = Record<string, string>;

const TEMPLATE_HEADERS = ["source", "rating", "review_date", "reviewer_name", "review_text", "review_url"];

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function isTemplateFormat(headers: string[]): boolean {
  const normalized = new Set(headers.map(normalizeHeader));
  return TEMPLATE_HEADERS.every((h) => normalized.has(h));
}

/**
 * Feefo's real export column names aren't confirmed from a live sample yet.
 * This tries a list of plausible header names per field so a real Feefo CSV
 * has a decent chance of "just working"; tighten this list (or add the exact
 * names) once a real export has actually been seen — see imports/README.md.
 */
const FEEFO_FIELD_CANDIDATES = {
  externalId: ["reference", "review_reference", "feedback_reference", "id"],
  rating: ["service_rating", "overall_rating", "product_rating", "rating"],
  reviewDate: ["date_created", "review_date", "date", "created_date", "date_submitted"],
  reviewerName: ["customer_name", "reviewer_name", "name"],
  reviewText: ["comments", "review_text", "comment", "feedback", "service_review"],
  reviewUrl: ["review_url", "url", "permalink"],
} as const;

type FeefoField = keyof typeof FEEFO_FIELD_CANDIDATES;

function findColumn(headers: string[], candidates: readonly string[]): string | null {
  const normalized = headers.map((h) => ({ original: h, normalized: normalizeHeader(h) }));
  for (const candidate of candidates) {
    const match = normalized.find((h) => h.normalized === candidate);
    if (match) return match.original;
  }
  return null;
}

export type DetectedFormat = "template" | "feefo";

export function detectFormat(headers: string[]): DetectedFormat {
  if (isTemplateFormat(headers)) return "template";

  const requiredFeefoFields: FeefoField[] = ["rating", "reviewDate", "reviewText"];
  const allFound = requiredFeefoFields.every(
    (field) => findColumn(headers, FEEFO_FIELD_CANDIDATES[field]) !== null,
  );
  if (allFound) return "feefo";

  throw new Error(
    `Could not recognize CSV format. Headers found: ${headers.join(", ")}. ` +
      `Expected either the shared template (${TEMPLATE_HEADERS.join(", ")}) or a Feefo export ` +
      `with recognizable rating/date/comment columns. See imports/README.md.`,
  );
}

function parseRating(raw: string): number {
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) throw new Error(`Could not parse rating: "${raw}"`);
  return Math.round(n);
}

function parseDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) throw new Error(`Could not parse date: "${raw}"`);
  return d.toISOString().slice(0, 10);
}

function parseTemplateRows(rows: Row[]): NormalizedReview[] {
  return rows.map((row) => {
    const get = (key: string): string => {
      const headerKey = Object.keys(row).find((h) => normalizeHeader(h) === key);
      return headerKey ? (row[headerKey]?.trim() ?? "") : "";
    };
    const source = get("source").toLowerCase() as SourceType;
    if (!SOURCE_TYPES.includes(source)) {
      throw new Error(`Unknown source "${source}" — expected one of ${SOURCE_TYPES.join(", ")}`);
    }
    const rating = parseRating(get("rating"));
    const reviewDate = parseDate(get("review_date"));
    const reviewText = get("review_text");
    if (!reviewText) throw new Error("Row is missing review_text");
    const reviewerName = get("reviewer_name") || null;
    const reviewUrl = get("review_url") || null;

    return {
      source,
      externalId: null,
      rating,
      reviewDate,
      reviewerName,
      reviewText,
      reviewUrl,
      dedupeHash: computeDedupeHash(source, rating, reviewDate, reviewText),
    };
  });
}

function parseFeefoRows(rows: Row[], headers: string[]): NormalizedReview[] {
  const columns = Object.fromEntries(
    (Object.keys(FEEFO_FIELD_CANDIDATES) as FeefoField[]).map((field) => [
      field,
      findColumn(headers, FEEFO_FIELD_CANDIDATES[field]),
    ]),
  ) as Record<FeefoField, string | null>;

  return rows.map((row) => {
    const rating = parseRating(columns.rating ? row[columns.rating] : "");
    const reviewDate = parseDate(columns.reviewDate ? row[columns.reviewDate] : "");
    const reviewText = (columns.reviewText ? row[columns.reviewText] : "")?.trim();
    if (!reviewText) throw new Error("Feefo row is missing review text");
    const reviewerName = columns.reviewerName ? (row[columns.reviewerName]?.trim() ?? null) || null : null;
    const reviewUrl = columns.reviewUrl ? (row[columns.reviewUrl]?.trim() ?? null) || null : null;
    const externalId = columns.externalId ? (row[columns.externalId]?.trim() ?? null) || null : null;

    return {
      source: "feefo" as const,
      externalId,
      rating,
      reviewDate,
      reviewerName,
      reviewText,
      reviewUrl,
      dedupeHash: computeDedupeHash("feefo", rating, reviewDate, reviewText),
    };
  });
}

export function parseImportFile(csvContent: string): NormalizedReview[] {
  const rows: Row[] = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const format = detectFormat(headers);
  return format === "template" ? parseTemplateRows(rows) : parseFeefoRows(rows, headers);
}
