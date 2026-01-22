import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 8080;

// ===============================
// Supabase Client
// ===============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ===============================
// Health endpoint (Fly checks)
// ===============================
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`✅ Avatar G Render Worker listening on ${PORT}`);
});

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

    // 🔧 აქ იქნება რეალური render logic
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
console.log("🌀 Job polling started (5s)");
