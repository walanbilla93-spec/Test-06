const axios = require("axios");
const { appendJournalEntry } = require("./signal-journal");

let serverSignals = [];

const MAX_STORED_SIGNALS = 60;
const MAX_JOURNAL = 1000;
const MIN_SCORE = 8;
const SIGNAL_TTL_MS = 2 * 60 * 60 * 1000;

let scannerStatus = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  pairsChecked: 0,
  storedSignals: 0,
};

function fmtTime(d = new Date()) {
  return d.toTimeString().slice(0, 5);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pickSide(symbol, score) {
  const n = symbol.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return ((n + score) % 2 === 0) ? "BUY" : "SELL";
}

function makeSignal(symbol, price, score) {
  const side = pickSide(symbol, score);
  const move1 = 0.0035;
  const move2 = 0.0065;
  const stop  = 0.0025;

  const entry = Number(price);
  const tp1 = side === "BUY" ? entry * (1 + move1) : entry * (1 - move1);
  const tp2 = side === "BUY" ? entry * (1 + move2) : entry * (1 - move2);
  const sl  = side === "BUY" ? entry * (1 - stop)  : entry * (1 + stop);

  const ts = Date.now();
  return {
    id: `${symbol}-${ts}`,
    sym: symbol,
    symbol,
    side,
    score,
    entry: Number(entry.toFixed(entry < 1 ? 6 : 4)),
    tp1: Number(tp1.toFixed(entry < 1 ? 6 : 4)),
    tp2: Number(tp2.toFixed(entry < 1 ? 6 : 4)),
    sl: Number(sl.toFixed(entry < 1 ? 6 : 4)),
    time: fmtTime(new Date(ts)),
    createdAt: ts,
    status: "DETECTED",
    source: "server",
    tp1Hit: false,
    entryHit: false,
    result: "OPEN",
    price: Number(entry.toFixed(entry < 1 ? 6 : 4)),
  };
}

function makeJournalEntry(signal) {
  return {
    id: signal.id,
    time: signal.time,
    coin: signal.sym.replace("USDT", ""),
    side: signal.side,
    entry: signal.entry,
    sl: signal.sl,
    tp1: signal.tp1,
    tp2: signal.tp2,
    result: "OPEN",
    entryHit: false,
    createdAt: signal.createdAt,
    source: "server",
  };
}

function cleanupSignals() {
  const now = Date.now();
  serverSignals = serverSignals
    .map((s) => {
      if (s.status === "DETECTED" && now - s.createdAt > SIGNAL_TTL_MS) {
        return { ...s, status: "EXPIRED", result: "INVALID" };
      }
      return s;
    })
    .slice(0, MAX_STORED_SIGNALS);
}

function mergeSignal(signal) {
  const exists = serverSignals.some((s) =>
    s.sym === signal.sym &&
    s.side === signal.side &&
    Math.abs(Number(s.entry) - Number(signal.entry)) / Math.max(Number(signal.entry), 1e-9) < 0.0001 &&
    Math.abs((s.createdAt || 0) - (signal.createdAt || 0)) < 30 * 60 * 1000
  );
  if (exists) return false;

  serverSignals.unshift(signal);
  serverSignals = serverSignals.slice(0, MAX_STORED_SIGNALS);
  appendJournalEntry(makeJournalEntry(signal));
  return true;
}

async function runScan() {
  scannerStatus.running = true;
  scannerStatus.lastRunAt = new Date().toISOString();

  try {
    const res = await axios.get("https://api.binance.com/api/v3/ticker/price", { timeout: 15000 });
    const rows = Array.isArray(res.data) ? res.data : [];
    const usdtPairs = rows.filter((r) => typeof r.symbol === "string" && r.symbol.endsWith("USDT")).slice(0, 80);
    scannerStatus.pairsChecked = usdtPairs.length;

    let added = 0;
    for (const pair of usdtPairs) {
      const rawPrice = Number(pair.price);
      if (!rawPrice || !Number.isFinite(rawPrice)) continue;

      // Testing-only synthetic score so the UI gets data while you validate deployment.
      const seed = pair.symbol.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
      const score = clamp((seed % 11) + 4, 0, 12);

      if (score >= MIN_SCORE) {
        const signal = makeSignal(pair.symbol, rawPrice, score);
        if (mergeSignal(signal)) added++;
      }
    }

    cleanupSignals();
    scannerStatus.storedSignals = serverSignals.length;
    scannerStatus.lastSuccessAt = new Date().toISOString();
    scannerStatus.lastError = null;
    return added;
  } catch (err) {
    scannerStatus.lastError = err.message || String(err);
    console.error("Scan failed:", scannerStatus.lastError);
    return 0;
  }
}

function startServerScanner() {
  runScan().catch(() => {});
  setInterval(() => {
    runScan().catch(() => {});
  }, 60000);
}

function getSignals() {
  cleanupSignals();
  return serverSignals.slice(0, MAX_STORED_SIGNALS);
}

function getScannerStatus() {
  cleanupSignals();
  return {
    ...scannerStatus,
    storedSignals: serverSignals.length,
  };
}

module.exports = {
  startServerScanner,
  getSignals,
  getScannerStatus,
};
