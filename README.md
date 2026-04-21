# Orayan Structure Hunter v4.1

## What's Fixed in v4.1

### Bug 1 — DOGE / Coin Duplicate Signals
**Root cause:** `backgroundAutoDetect` was building a signal plan before checking
duplicates. Signal key = `sym|side|roundedPrice`. Since DOGE price changes every
scan (0.094450 → 0.094500 → 0.094590), each scan produced a different key →
new signal every 45 seconds.

**Fix:** Added `hasRecentSignalForSymbol()` + `isDuplicateSignalCandidate()` guards
inside `backgroundAutoDetect` **before** building the trade plan. Same guards the
rest of the system already used — just weren't being called from here.

### Bug 2 — Scanner Stops When Browser Tab Closes
**Root cause:** All scanning (WebSocket, `backgroundAutoDetect`) is browser-side.
Android/Chrome suspends JS when tab is backgrounded or closed.

**Fix:** `src/orayan-backend-scanner.js` runs on your Northflank server 24/7:
- Fetches Binance klines via REST every 60s (no WebSocket needed)
- Runs same scoring logic as frontend
- Stores captured signals server-side
- Frontend polls `GET /api/server-signals` every 30s
- When user reopens the tab, all missed signals sync automatically

---

## Project Structure

```
orayan-v41-project/
├── public/
│   └── index.html          ← Fixed frontend (v4.1)
├── src/
│   └── orayan-backend-scanner.js   ← Server-side scanner module
├── server.js               ← Express backend
├── package.json
├── .gitignore
└── README.md
```

---

## One-Time Setup (Northflank)

1. Push this folder to GitHub
2. In Northflank, point your service to this repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Set env vars in Northflank dashboard:
   - `PORT` = 3000 (or Northflank sets it automatically)
   - `BACKEND_TOKEN` = any secret string (optional, for auth)
   - `TG_TOKEN` = your Telegram bot token (optional)
   - `TG_CHAT_ID` = your Telegram chat ID (optional)

---

## Connecting Frontend to Backend

In `public/index.html`, find this line (~line 4995):
```js
// ← PUT YOUR NORTHFLANK BACKEND URL HERE
return '';
```
Change it to your Northflank backend URL:
```js
return 'https://your-service.northflank.app';
```

Or leave it empty (`''`) — the frontend still works fully standalone without the backend. The backend just adds 24/7 signal capture when the tab is closed.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Uptime + signal count |
| GET | `/api/server-signals` | Returns server-captured signals array |
| GET | `/*` | Serves frontend HTML |
