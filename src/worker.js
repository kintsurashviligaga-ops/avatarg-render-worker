import { createClient } from "@supabase/supabase-js";

// ===============================
// Supabase Client
// ===============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log("🌀 Render worker started");

// ===============================
// Job Polling Loop
// ===============================
async function pollJobs() {
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

    // ⏳ აქ იქნება რეალური render logic (ffmpeg / AI / image)
    await new Promise((r) => setTimeout(r, 2000));

    await supabase
      .from("render_jobs")
      .update({
        status: "done",
        finished_at: new Date().toISOString(),
        result: { ok: true }
      })
      .eq("id", data.id);

    console.log("✅ Job completed:", data.id);
  } catch (err) {
    console.error("❌ Worker crash:", err);
  }
}

// ===============================
// Start polling
// ===============================
setInterval(pollJobs, 5000);
