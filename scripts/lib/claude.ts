import Anthropic from "@anthropic-ai/sdk";
import type { ReviewAnalysisResult, SentimentLabel, ThemeCategory } from "./types.js";

export const ANALYSIS_MODEL = "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
    client = new Anthropic({ apiKey });
  }
  return client;
}

const ANALYZE_TOOL = {
  name: "record_review_analysis",
  description: "Record sentiment, themes, and quote-bank candidacy for a customer review of a cruise line.",
  input_schema: {
    type: "object" as const,
    properties: {
      sentiment_label: { type: "string", enum: ["positive", "neutral", "negative"] },
      sentiment_score: {
        type: "number",
        description: "Overall sentiment from -1 (very negative) to 1 (very positive).",
      },
      themes: {
        type: "array",
        description:
          "Specific, recurring topics actually mentioned in the text — not just a restatement of the star rating.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                'Short lowercase theme, e.g. "embarkation delays", "cabin cleanliness", "dining", ' +
                '"staff friendliness", "value for money". Reuse an existing theme name where it genuinely ' +
                "fits rather than inventing a near-duplicate.",
            },
            category: { type: "string", enum: ["complaint", "praise"] },
          },
          required: ["name", "category"],
        },
      },
      quote_bank_candidate: {
        type: "boolean",
        description:
          "True only for a specific, well-written, strongly positive review that would work as a standalone " +
          "marketing quote — not just any high star rating.",
      },
      quote_bank_rationale: {
        type: "string",
        description: "One sentence on why this is or isn't a quote-bank candidate.",
      },
    },
    required: ["sentiment_label", "sentiment_score", "themes", "quote_bank_candidate", "quote_bank_rationale"],
  },
};

interface AnalyzeToolInput {
  sentiment_label: SentimentLabel;
  sentiment_score: number;
  themes: { name: string; category: ThemeCategory }[];
  quote_bank_candidate: boolean;
  quote_bank_rationale: string;
}

export async function analyzeReview(
  reviewText: string,
  rating: number,
  existingThemeNames: string[],
): Promise<ReviewAnalysisResult> {
  const anthropic = getClient();
  const message = await anthropic.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 1024,
    tools: [ANALYZE_TOOL],
    tool_choice: { type: "tool", name: "record_review_analysis" },
    messages: [
      {
        role: "user",
        content:
          "Analyze this cruise line customer review for Ambassador Cruise Line.\n\n" +
          `Star rating: ${rating}/5\n` +
          `Review text: """${reviewText}"""\n\n` +
          (existingThemeNames.length > 0
            ? `Existing theme vocabulary (reuse these names when they genuinely fit): ${existingThemeNames.join(", ")}\n\n`
            : "") +
          "Call record_review_analysis with your analysis.",
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a tool_use block for record_review_analysis");
  }
  const input = toolUse.input as AnalyzeToolInput;

  return {
    sentimentLabel: input.sentiment_label,
    sentimentScore: input.sentiment_score,
    themes: input.themes.map((t) => ({ name: t.name.toLowerCase().trim(), category: t.category })),
    quoteBankCandidate: input.quote_bank_candidate,
    quoteBankRationale: input.quote_bank_rationale,
  };
}
