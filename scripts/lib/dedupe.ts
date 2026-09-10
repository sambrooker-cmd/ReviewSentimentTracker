import { createHash } from "node:crypto";
import type { SourceType } from "./types.js";

/**
 * Hand-filled rows have no stable platform review ID, so dedupe on content
 * instead: re-exporting an overlapping date range shouldn't create
 * duplicate rows. Feefo rows also get this hash, but their real externalId
 * is the primary defense (unique(source_id, external_id) in schema.sql).
 */
export function computeDedupeHash(
  source: SourceType,
  rating: number,
  reviewDate: string,
  reviewText: string,
): string {
  const normalizedText = reviewText.trim().toLowerCase().slice(0, 50);
  const raw = `${source}|${rating}|${reviewDate}|${normalizedText}`;
  return createHash("sha256").update(raw).digest("hex");
}
