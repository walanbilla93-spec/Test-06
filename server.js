const path = require("path");
const fs   = require("fs");
const express = require("express");
const { startServerScanner, getSignals, getPrices, getScannerStatus } = require("./src/orayan-backend-scanner");
const { readJournal } = require("./src/signal-journal");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Journal + Signals sync storage ───────────────────────────
// Stored in /tmp so it survives restarts within a session.
// For permanent storage across deploys, point these at a mounted volume.
const SYNC_JOURNAL_PATH  = process.env.SYNC_JOURNAL_PATH  || path.join("/tmp", "orayan_journal_sync.json");
const SYNC_SIGNALS_PATH  = process.env.SYNC_SIGNALS_PATH  || path.join("/tmp", "orayan_signals_sync.json");
const SYNC_AUTH_TOKEN    = process.env.SYNC_AUTH_TOKEN    || ""; // set in Northflank env vars

function readSyncFile(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) || fallback;
  } catch (e) {
    return fallback;
  }
}

function writeSyncFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
  } catch (e) {
    console.error("[Sync] Write error:", e.message);
  }
}

// Optional bearer token check
function checkAuth(req, res) {
  if (!SYNC_AUTH_TOKEN) return true; // no auth configured — open
  const auth = req.headers["authorization"] || "";
  if (auth === "Bearer " + SYNC_AUTH_TOKEN) return true;
  res.status(401).json({ ok: false, error: "Unauthorized" });
  return false;
}

// ── CORS — allow the HTML file opened from any origin ────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Existing endpoints ────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/server-signals", (req, res) => {
  res.json({ ok: true, signals: getSignals() });
});

app.get("/api/prices", (req, res) => {
  res.json({ ok: true, prices: getPrices() });
});

app.get("/api/journal", (req, res) => {
  res.json({
    ok: true,
    count: readJournal().length,
    entries: readJournal(),
  });
});

app.get("/api/scanner-status", (req, res) => {
  res.json({ ok: true, scanner: getScannerStatus() });
});

// ── Journal Sync endpoints (used by Orayan v3.9 HTML) ────────
//
//  GET  /journal          → return stored journal + signals
//  POST /journal          → receive journal + signals, merge & save
//
// In Orayan HTML settings: set URL = https://p01--abc--rpfg4d97xnm6.code.run
// The HTML appends /journal automatically.

app.get("/journal", (req, res) => {
  if (!checkAuth(req, res)) return;
  const journal = readSyncFile(SYNC_JOURNAL_PATH, []);
  const signals = readSyncFile(SYNC_SIGNALS_PATH, []);
  res.json({
    ok: true,
    journal,
    signals,
    serverTime: new Date().toISOString(),
    counts: { journal: journal.length, signals: signals.length },
  });
});

app.post("/journal", (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { journal: incoming, signals: incomingSignals, pushedAt, device } = req.body || {};

    // ── Merge journal ──────────────────────────────────────────
    const existing = readSyncFile(SYNC_JOURNAL_PATH, []);
    const existingKeys = new Set(existing.map(r =>
      [r.coin, r.side, r.entry, r.sl, r.tp1, r.tp2].join("|")
    ));
    const newEntries = (incoming || []).filter(r =>
      !existingKeys.has([r.coin, r.side, r.entry, r.sl, r.tp1, r.tp2].join("|"))
    );
    // Update result on existing entries if changed (WIN/LOSS/OPEN)
    existing.forEach(r => {
      const match = (incoming || []).find(x =>
        [x.coin, x.side, x.entry, x.sl, x.tp1, x.tp2].join("|") ===
        [r.coin, r.side, r.entry, r.sl, r.tp1, r.tp2].join("|")
      );
      if (match && match.result !== r.result) {
        r.result    = match.result;
        r.updatedAt = match.updatedAt || Date.now();
        r.entryHit  = match.entryHit  || r.entryHit;
      }
    });
    const merged = [...newEntries, ...existing].slice(0, 500);
    writeSyncFile(SYNC_JOURNAL_PATH, merged);

    // ── Merge signals ──────────────────────────────────────────
    const existingSigs = readSyncFile(SYNC_SIGNALS_PATH, []);
    const existingSigIds = new Set(existingSigs.map(s => s.id));
    const newSigs = (incomingSignals || []).filter(s => s.id && !existingSigIds.has(s.id));
    // Update status on existing signals
    existingSigs.forEach(s => {
      const match = (incomingSignals || []).find(x => x.id === s.id);
      if (match && match.status !== s.status) {
        s.status    = match.status;
        s.updatedAt = match.updatedAt || Date.now();
        s.tp1Hit    = match.tp1Hit    || s.tp1Hit;
        s.tp2Hit    = match.tp2Hit    || s.tp2Hit;
      }
    });
    const mergedSigs = [...newSigs, ...existingSigs].slice(0, 60);
    writeSyncFile(SYNC_SIGNALS_PATH, mergedSigs);

    console.log(`[Sync] Push from ${device || "unknown"} — journal: ${merged.length} entries, signals: ${mergedSigs.length}`);

    res.json({
      ok: true,
      saved: { journal: merged.length, signals: mergedSigs.length },
      newEntries: newEntries.length,
      newSignals: newSigs.length,
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[Sync] POST /journal error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Catch-all (serve HTML app) ────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

startServerScanner();

app.listen(PORT, () => {
  console.log(`Orayan Northflank server listening on port ${PORT}`);
  console.log(`Journal sync: GET/POST /journal | Auth: ${SYNC_AUTH_TOKEN ? "token required" : "open"}`);
});
