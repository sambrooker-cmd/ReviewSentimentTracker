import type { SupabaseClient } from "@supabase/supabase-js";
import { ALERT_REALERT_COOLDOWN_DAYS, type DetectedAlert } from "./alerts.js";
import { hasRecentAlert, insertAlert } from "./db.js";
import { fileAlertIssue } from "./github.js";

function alertTitle(alert: DetectedAlert): string {
  switch (alert.type) {
    case "sentiment_spike":
      return `Rating trend alert: average dropped to ${alert.metricValue}`;
    case "theme_spike":
      return `Theme spike alert: ${alert.summary.split('"')[1] ?? "complaint theme"}`;
    case "import_stale":
      return `Import stale: ${alert.window}`;
  }
}

/** Dedupes against recently-filed alerts, files a GitHub Issue, and records the alert. */
export async function processAlert(supabase: SupabaseClient, alert: DetectedAlert): Promise<void> {
  const recent = await hasRecentAlert(supabase, alert.type, alert.sourceId, ALERT_REALERT_COOLDOWN_DAYS);
  if (recent) {
    console.log(`  Skipping ${alert.type} alert (already filed within ${ALERT_REALERT_COOLDOWN_DAYS}d): ${alert.summary}`);
    return;
  }

  const title = alertTitle(alert);
  const body = `${alert.summary}\n\n_Window: ${alert.window} — metric ${alert.metricValue} vs threshold ${alert.threshold}_`;
  let issueUrl: string | null = null;
  try {
    issueUrl = await fileAlertIssue(title, body, ["alert", alert.type.replace(/_/g, "-")]);
    console.log(`  Filed alert issue: ${issueUrl}`);
  } catch (err) {
    console.error(`  Failed to file GitHub issue for alert, recording alert anyway: ${(err as Error).message}`);
  }
  await insertAlert(supabase, alert, issueUrl);
}
