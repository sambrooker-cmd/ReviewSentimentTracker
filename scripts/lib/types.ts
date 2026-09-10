export type SourceType = "trustpilot" | "google" | "feefo" | "tripadvisor" | "cruisecritic";

export const SOURCE_TYPES: SourceType[] = [
  "trustpilot",
  "google",
  "feefo",
  "tripadvisor",
  "cruisecritic",
];

export interface NormalizedReview {
  source: SourceType;
  externalId: string | null;
  rating: number;
  reviewDate: string; // YYYY-MM-DD
  reviewerName: string | null;
  reviewText: string;
  reviewUrl: string | null;
  dedupeHash: string;
}

export type SentimentLabel = "positive" | "neutral" | "negative";
export type ThemeCategory = "complaint" | "praise";

export interface ThemeTag {
  name: string;
  category: ThemeCategory;
}

export interface ReviewAnalysisResult {
  sentimentLabel: SentimentLabel;
  sentimentScore: number; // -1..1
  themes: ThemeTag[];
  quoteBankCandidate: boolean;
  quoteBankRationale: string;
}
