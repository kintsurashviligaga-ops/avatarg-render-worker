import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// ===============================
// Supabase Client
// ===============================
const supabase = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);

console.log("🌀 Render worker started");

// ===============================
// Job Polling Loop
// ===============================
let isPolling = false;

async function pollJobs() {
  if (isPolling) return;
  isPolling = true;

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

    // ⏳ აქ იქნება რეალური render logic (ffmpeg / AI / image)
    await new Promise((r) => setTimeout(r, 2000));

    const { error: updErr } = await supabase
      .from("render_jobs")
      .update({
        status: "done",
        finished_at: new Date().toISOString(),
        result: { ok: true }
      })
      .eq("id", data.id);

    if (updErr) {
      console.error("❌ Update job error:", updErr.message);
      return;
    }

    console.log("✅ Job completed:", data.id);
  } catch (err) {
    console.error("❌ Worker crash:", err?.message ?? err);
  } finally {
    isPolling = false;
  }
}

// ===============================
// Keep alive + schedule
// ===============================
setInterval(pollJobs, 5000);
pollJobs(); // run immediately at boot

// Make sure Node never exits
process.stdin.resume();

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received. Shutting down...");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("🛑 SIGINT received. Shutting down...");
  process.exit(0);
});
