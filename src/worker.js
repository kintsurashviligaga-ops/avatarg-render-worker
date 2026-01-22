import { createClient } from "@supabase/supabase-js";

// ===============================
// Env validation
// ===============================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing required env vars:");
  console.error("   - SUPABASE_URL:", SUPABASE_URL ? "✅ set" : "❌ missing");
  console.error(
    "   - SUPABASE_SERVICE_ROLE_KEY:",
    SUPABASE_SERVICE_ROLE_KEY ? "✅ set" : "❌ missing"
  );
  console.error("🛑 Worker will not start until env vars are provided.");
  process.exit(1);
}

// ===============================
// Supabase Client
// ===============================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log("🌀 Render worker started");

// ===============================
// Safe polling (no overlap)
// ===============================
let isRunning = false;

async function pollJobs() {
  if (isRunning) return;
  isRunning = true;

  try {
    const { data, error } = await supabase.rpc("fetch_next_render_job");

    if (error) {
      console.error("❌ Job fetch error:", error.message);
      return;
    }

    if (!data) {
      return; // no jobs
    }

    console.log("🎬 Processing job:", data.id);
    console.log("Payload:", data.payload);

    // ⏳ TODO: real render logic (ffmpeg / AI / image)
    await new Promise((r) => setTimeout(r, 2000));

    const { error: updateError } = await supabase
      .from("render_jobs")
      .update({
        status: "done",
        finished_at: new Date().toISOString(),
        result: { ok: true }
      })
      .eq("id", data.id);

    if (updateError) {
      console.error("❌ Job update error:", updateError.message);
      return;
    }

    console.log("✅ Job completed:", data.id);
  } catch (err) {
    console.error("❌ Worker crash:", err?.message ?? err);
  } finally {
    isRunning = false;
  }
}

// ===============================
// Start polling
// ===============================
pollJobs(); // run immediately
setInterval(pollJobs, 5000);

// graceful shutdown
process.on("SIGINT", () => {
  console.log("🛑 SIGINT received. Shutting down worker...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received. Shutting down worker...");
  process.exit(0);
});
