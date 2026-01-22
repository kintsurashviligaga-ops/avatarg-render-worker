const express = require("express");

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`
    <h1>Avatar G Render Worker</h1>
    <p>Status: OK</p>
    <p>Use <code>/health</code> to check runtime</p>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
    ffmpeg: true
  });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("✅ Render worker listening on", port));
