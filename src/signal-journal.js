const fs = require("fs");
const path = require("path");

const JOURNAL_FILE = path.join(__dirname, "..", "data", "signals-journal.json");

function ensureJournalFile() {
  const dir = path.dirname(JOURNAL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(JOURNAL_FILE)) {
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify([], null, 2), "utf8");
  }
}

function readJournal() {
  ensureJournalFile();
  try {
    const raw = fs.readFileSync(JOURNAL_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read journal:", err.message);
    return [];
  }
}

function writeJournal(entries) {
  ensureJournalFile();
  fs.writeFileSync(JOURNAL_FILE, JSON.stringify(entries, null, 2), "utf8");
}

function appendJournalEntry(entry) {
  const journal = readJournal();
  journal.unshift(entry);
  writeJournal(journal.slice(0, 1000));
  return journal;
}

module.exports = {
  readJournal,
  writeJournal,
  appendJournalEntry,
};
