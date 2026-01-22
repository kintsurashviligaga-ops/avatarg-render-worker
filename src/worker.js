import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const supabase = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY")
);

console.log("🟢 Render worker started");

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

    console.log("🎬 Got job:", data.id);

    // TODO: render logic here

  } catch (err) {
    console.error("❌ Worker error:", err);
  } finally {
    isPolling = false;
  }
}

// 🔁 KEEP PROCESS ALIVE
setInterval(pollJobs, 3000);

// 🛑 Graceful shutdown (Fly sends SIGTERM)
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  process.exit(0);
});
