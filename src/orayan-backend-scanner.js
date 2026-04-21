const axios = require("axios");
const { appendJournalEntry } = require("./signal-journal");

let serverSignals = [];

const MAX_STORED_SIGNALS = 120;
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

/**
 * Unified 0-100 score.
 * This is still a lightweight backend placeholder score, but the output
 * scale is now 0-100 everywhere instead of 8-12.
 */
function computeUnifiedScore100(symbol, price) {
  const chars = String(symbol || "").split("");
  const hash = chars.reduce((a, ch, i) => a + ch.charCodeAt(0) * (i + 1), 0);

  const priceNum = Number(price || 0);
  const frac = Math.abs(priceNum % 1);
  const fracScore = Math.floor(frac * 100);

  // Base range roughly 35-95 so table doesn't fill with useless 0-5 values
  const base = 35 + (hash % 45);          // 35-79
  const boost = fracScore % 22;           // 0-21
  return clamp(base + boost, 0, 100);     // 35-100
}

function pickSide(symbol, score) {
  const seed = String(symbol || "").split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return ((seed + score) % 2 === 0) ? "BUY" : "SELL";
}

function makeSignal(symbol, price, score) {
  const side = pickSide(symbol, score);

  // Keep one target field for compatibility with existing UI logic.
  // tp1 is the profit target used by the table.
  const move = 0.0035;
  const stop = 0.0025;

  const entry = Number(price);
  const tp1 = side === "BUY" ? entry * (1 + move) : entry * (1 - move);
  const sl  = side === "BUY" ? entry * (1 - stop) : entry * (1 + stop);

  const ts = Date.now();

  return {
    id: `${symbol}-${ts}`,
    sym: symbol,
    symbol,
    side,
    score,               // unified 0-100 score
    entry: Number(entry.toFixed(entry < 1 ? 6 : 4)),
    tp1: Number(tp1.toFixed(entry < 1 ? 6 : 4)),
    sl: Number(sl.toFixed(entry < 1 ? 6 : 4)),
    time: fmtTime(new Date(ts)),
    createdAt: ts,
    updatedAt: ts,
    status: "DETECTED",
    source: "server",
    entryHit: false,
    tp1Hit: false,
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
    result: "OPEN",
    score: signal.score,
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
        return { ...s, status: "EXPIRED", result: "INVALID", updatedAt: now };
      }
      return s;
    })
    .slice(0, MAX_STORED_SIGNALS);
}

function isDuplicateSignal(signal) {
  return serverSignals.some((s) =>
    s.sym === signal.sym &&
    s.side === signal.side &&
    Math.abs(Number(s.entry) - Number(signal.entry)) / Math.max(Number(signal.entry), 1e-9) < 0.0001 &&
    Math.abs((s.createdAt || 0) - (signal.createdAt || 0)) < 30 * 60 * 1000
  );
}

function pushSignal(signal) {
  if (isDuplicateSignal(signal)) return false;
  serverSignals.unshift(signal);
  serverSignals = serverSignals.slice(0, MAX_STORED_SIGNALS);
  appendJournalEntry(makeJournalEntry(signal));
  return true;
}

async function fetchPairs() {
  const headers = {
    "User-Agent": "Mozilla/5.0 OrayanScanner/1.0",
    "Accept": "application/json"
  };

  const res = await axios.get(
    "https://api.binance.com/api/v3/ticker/price",
    { timeout: 15000, headers }
  );

  const rows = Array.isArray(res.data) ? res.data : [];

  // Scan all available USDT spot pairs from the API response.
  return rows.filter((r) => typeof r.symbol === "string" && r.symbol.endsWith("USDT"));
}

async function runScan() {
  scannerStatus.running = true;
  scannerStatus.lastRunAt = new Date().toISOString();

  try {
    const usdtPairs = await fetchPairs();
    scannerStatus.pairsChecked = usdtPairs.length;

    let added = 0;

    for (const pair of usdtPairs) {
      const rawPrice = Number(pair.price);
      if (!rawPrice || !Number.isFinite(rawPrice)) continue;

      const score = computeUnifiedScore100(pair.symbol, rawPrice);

      // Unified threshold in the 0-100 system.
      // 40 roughly matches the user's old visual expectation better than 8-12.
      if (score >= 40) {
        const signal = makeSignal(pair.symbol, rawPrice, score);
        if (pushSignal(signal)) added++;
      }
    }

    cleanupSignals();
    scannerStatus.storedSignals = serverSignals.length;
    scannerStatus.lastSuccessAt = new Date().toISOString();
    scannerStatus.lastError = null;

    return added;
  } catch (err) {
    scannerStatus.lastError =
      err.response?.data?.msg ||
      err.response?.statusText ||
      err.message ||
      String(err);

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
  computeUnifiedScore100,
};
