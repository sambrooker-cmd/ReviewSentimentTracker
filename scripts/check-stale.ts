import { detectStaleImportAlerts } from "./lib/alerts.js";
import { processAlert } from "./lib/processAlerts.js";
import { getSupabaseClient } from "./lib/supabase.js";

async function main() {
  const supabase = getSupabaseClient();
  const alerts = await detectStaleImportAlerts(supabase);
  if (alerts.length === 0) {
    console.log("No sources are stale.");
    return;
  }
  for (const alert of alerts) {
    await processAlert(supabase, alert);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
