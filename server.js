const path = require("path");
const express = require("express");
const { startServerScanner, getSignals, getScannerStatus } = require("./src/orayan-backend-scanner");
const { readJournal } = require("./src/signal-journal");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/server-signals", (req, res) => {
  res.json({
    ok: true,
    signals: getSignals(),
  });
});

app.get("/api/journal", (req, res) => {
  res.json({
    ok: true,
    count: readJournal().length,
    entries: readJournal(),
  });
});

app.get("/api/scanner-status", (req, res) => {
  res.json({
    ok: true,
    scanner: getScannerStatus(),
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

startServerScanner();

app.listen(PORT, () => {
  console.log(`Orayan Northflank app listening on port ${PORT}`);
});
