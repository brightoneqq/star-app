# Implementation Plan

## Task Overview

15 atomic tasks split across backend bootstrap (1–7), local-dev helper (8), frontend shared infrastructure (9–11), styling (12), page wiring (13–14), and steering housekeeping (15). Backend can be implemented in parallel with frontend layers; the only hard sequencing is **task 10 (sync.js) before task 13 (user-code.js)** and **all frontend code before tasks 13–14 (page wiring)**.

Each task touches 1–3 files and is independently verifiable: backend tasks via `curl` against `npm run dev` once tasks 1–8 complete; frontend tasks by visiting `http://localhost:8000` and exercising in DevTools. End-to-end verification + Playwright happens in spec-test / spec-review, not here.

## Steering Document Compliance

- All backend files live under `server/`, `functions/`, `migrations/`, `scripts/` per the new structure.md additions. ESM + Node 24.5.0 — confined to these directories.
- All frontend code stays ES5 IIFE under `js/`. No const/let/arrow/template-literal/Promise/ES-modules anywhere in `js/`. Verified by `node --check` + `grep -E '(const |let |=> |\\\`)'` returning zero.
- All storage routed via `MyStar.*`; backend exclusively uses `@libsql/client` + `MyStar` never touches the network from the server side (obviously — but listing the boundary).
- All colors via existing tokens in `conventions/colors.md`. The single new token `--overlay-tint` is added in task 12 with documentation in `conventions/colors.md`.
- Dependency budget: exactly two (`hono`, `@libsql/client`). No devDependencies.

## Tasks

- [ ] 1. Create `package.json` + `.env.example` + extend `.gitignore`
    - Files: `package.json`, `.env.example`, `.gitignore`
    - Create `package.json` exactly as specified in design.md "package.json script contract": `"name": "star-app"`, `"private": true`, `"type": "module"`, `"engines.node": ">=24.0.0"`, scripts (`migrate`/`build`/`dev`/`test`), `"dependencies": { "hono": "^4.6.0", "@libsql/client": "^0.14.0" }`. **No devDependencies.**
    - Create `.env.example` with two keys + comments: `TURSO_DATABASE_URL=`, `TURSO_AUTH_TOKEN=`.
    - Extend the **existing** `.gitignore` (already in repo) by appending two lines: `node_modules/` and `.env`. The committed file is `.env.example`; the actual `.env` is git-ignored.
    - Purpose: Define the manifest. (Lockfile generated in 1b.)
    - _Leverage: design.md "package.json script contract" subsection (verbatim shape)_
    - _Requirements: R7#4 (credentials env-only, .env in .gitignore)_

- [ ] 2. Generate + commit `package-lock.json`
    - File: `package-lock.json` (NEW; produced by npm)
    - Run `npm install` locally (NOT `npm ci` — there's no lockfile yet) to resolve `hono ^4.6.0` and `@libsql/client ^0.14.0`, produce `node_modules/`, and write `package-lock.json` at repo root.
    - Commit `package-lock.json`. Do NOT commit `node_modules/` (gitignored in 1a).
    - Verify: after this task, `npm ci` works against the committed lockfile, which is what EdgeOne's build phase will run. Cleanly delete `node_modules/` and re-run `npm ci` once to confirm the lockfile is sufficient.
    - Purpose: Without a committed lockfile, `npm ci` fails at deploy time (R7#3's verification command). This task closes the C-1 gap surfaced in review.
    - _Leverage: standard npm tooling; no project-specific config_
    - _Requirements: R7#3 (`npm ci && npm run build` must work)_

- [ ] 3. Create initial Turso migrations
    - Files: `migrations/001_init.sql`, `migrations/002_rate_limit.sql`
    - `001_init.sql`: `CREATE TABLE IF NOT EXISTS user_state (code TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, bytes INTEGER NOT NULL)` + `CREATE INDEX IF NOT EXISTS idx_user_state_updated_at ON user_state (updated_at)`.
    - `002_rate_limit.sql`: `CREATE TABLE IF NOT EXISTS rate_limit (ip TEXT NOT NULL, window_minute INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (ip, window_minute))`.
    - Statements separated by `;` + newline; nothing else (no transactions, no DROP, no destructive ops).
    - Purpose: Authoritative schema definition, kept under version control while the actual DB lives in Turso.
    - _Leverage: design.md "Data Models → Turso schema" — copy SQL verbatim_
    - _Requirements: R7#1 (schema), R7#3 (non-destructive), R10#2 (rate_limit table)_

- [ ] 4. Idempotent migration runner `scripts/migrate.mjs`
    - File: `scripts/migrate.mjs`
    - ESM. Imports `createClient` from `@libsql/client`. At startup, validate `process.env.TURSO_DATABASE_URL` and `process.env.TURSO_AUTH_TOKEN` are non-empty strings; if missing, `console.error` and `process.exit(1)`.
    - Read `migrations/*.sql` sorted by filename via `fs.readdirSync` + `path.join`. For each file: split on `;` boundaries (single-pass naive split is fine — migrations are simple CREATE/INDEX statements), trim, skip empties. For each statement:
      - If matches `/CREATE TABLE IF NOT EXISTS/i` or `/CREATE INDEX IF NOT EXISTS/i` → just `await db.execute(stmt)`.
      - If matches `/ALTER TABLE (\w+) ADD COLUMN (\w+)/i` → run `PRAGMA table_info(<table>)`, check if `<column>` already present in result rows; if so skip, else execute.
      - Other statements → execute as-is (rare, but support).
    - Log each `[migrate] applied 001_init.sql` / `[migrate] skipped <stmt-prefix>` line. Exit 0 on success, 1 on any thrown error.
    - Purpose: Make `npm run build` produce a populated DB without ever destroying data.
    - _Leverage: design.md "Migration runner: `scripts/migrate.mjs`" subsection_
    - _Requirements: R7#2 (idempotent + PRAGMA check), R7#3 (non-destructive), R7#5 (additive schema evolution)_

- [ ] 5. Server core: `server/db.js` + `server/validators.js`
    - Files: `server/db.js`, `server/validators.js`
    - `server/db.js`: ESM. **Import from the web flavor specifically:** `import { createClient } from '@libsql/client/web';` (NOT `'@libsql/client'`). The web flavor uses fetch transport with no Node-only APIs — required for EdgeOne Pages Functions edge runtime. `export function getDb(env)` returns `createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })`. **Per-request client — no module-level connection.** Each route handler calls `getDb(c.env)` fresh. The Node migration runner (task 3) uses the default `@libsql/client` import; this split is intentional.
    - `server/validators.js`: ESM. `export function validateCode(code)` — `return typeof code === 'string' && /^[a-zA-Z0-9_\-]{6,16}$/.test(code)`. `export function payloadByteLength(rawBodyString)` — `return new TextEncoder().encode(rawBodyString).byteLength`. Used by route handlers (task 6) for 400 / 413 decisions.
    - Purpose: Two tiny pure modules consumed by the rate-limit and app modules.
    - _Leverage: design.md "Backend: `server/db.js`" + "Backend: `server/validators.js`" subsections; `@libsql/client` `createClient` API_
    - _Requirements: R1#2 (code regex 6–16), R2#6 (64KB cap), R7#1 (Turso connection)_

- [ ] 6. Rate-limit module `server/rate-limit.js`
    - File: `server/rate-limit.js`
    - ESM. `export async function checkAndIncrement(db, ip): { allowed: boolean, count: number, resetInSeconds: number }`. Algorithm: `const windowMinute = Math.floor(Date.now() / 60000);` then `await db.execute({ sql: 'INSERT INTO rate_limit (ip, window_minute, count) VALUES (?, ?, 1) ON CONFLICT(ip, window_minute) DO UPDATE SET count = count + 1 RETURNING count', args: [ip, windowMinute] })`. Compare `count` to 30; if exceeded → `{ allowed: false, count, resetInSeconds: 60 - (Date.now() % 60000) / 1000 | 0 }`.
    - Opportunistic GC: on ~2% of calls (e.g. `Math.random() < 0.02`), `await db.execute({ sql: 'DELETE FROM rate_limit WHERE window_minute < ?', args: [windowMinute - 1] })`. Wrap in try/catch — GC failures must not break the request.
    - Purpose: Edge-safe per-IP write rate limit backed by Turso (in-memory counters would be per-instance and useless across edge nodes).
    - _Leverage: design.md "Backend: `server/rate-limit.js`" subsection (SQL verbatim); `server/db.js` from task 4_
    - _Requirements: R10#2 (Turso-table rate limit with INSERT ON CONFLICT, 30/min, Retry-After)_

- [ ] 6a. Hono app skeleton + CORS + structured-log wrapper + `/api/health` in `server/app.js`
    - File: `server/app.js` (NEW; created in this task with skeleton + health route only)
    - ESM. Imports: `Hono` from `'hono'`; `getDb` from `'./db.js'`; `validateCode`, `payloadByteLength` from `'./validators.js'`; `checkAndIncrement` from `'./rate-limit.js'`. (Some imports are unused in this task but pre-wired for 6b.)
    - `const app = new Hono();`
    - **CORS middleware** as the first `app.use('*', ...)`: sets `Access-Control-Allow-Origin` to the request's own origin (same-origin in deploy, identity in dev). `OPTIONS` preflight returns 204 immediately.
    - **Structured-log wrapper middleware** (R10#3): `app.use('*', async (c, next) => { ... })`. Snapshot `t0 = Date.now()`; resolve `ip` from `CF-Connecting-IP || X-Real-IP || X-Forwarded-For.split(',')[0] || 'unknown'`. `await next();` inside a try/finally — **the `finally` block** always runs the `console.log(JSON.stringify({ ts: t0, ip, code: c.get('code') || '-', method: c.req.method, bytes: c.get('bytes') || 0, status: c.res.status, latency_ms: Date.now() - t0 }))`. Route handlers in 6b call `c.set('code', code)` and `c.set('bytes', len)` so the wrapper picks them up. This guarantees 4xx early-return paths still log.
    - **`GET /api/health`**: returns `c.json({ ok: true })`. No DB call, no auth.
    - `export default app;`
    - Purpose: Plumbing that every route in 6b plugs into. Verifiable independently: `curl http://localhost:8000/api/health` after `npm run dev` returns `{"ok":true}` + a structured log line on stdout.
    - _Leverage: design "Backend: `server/app.js`" subsection (CORS + log middleware)_
    - _Requirements: R10#3 (structured log; finally pattern catches 4xx early returns)_

- [ ] 6b. State routes (`GET / PUT / DELETE /api/state`) in `server/app.js`
    - File: `server/app.js` (extends 6a)
    - **`GET /api/state`**: read `code` from query; `validateCode`, 400 on fail; `c.set('code', code)`; `getDb(c.env)`; `SELECT data_json, updated_at FROM user_state WHERE code = ?` (Turso `db.execute({sql, args})` → `{ rows: [...] }`); respond `c.json({ data: JSON.parse(row.data_json), updatedAt: row.updated_at })` or `c.json({ data: null, updatedAt: null })` when no row.
    - **`PUT /api/state`**: read `var rawBody = await c.req.text();` ONCE; check `payloadByteLength(rawBody) <= 65536` → 413 otherwise (`c.set('bytes', rawBody.length)`). `JSON.parse(rawBody)`; `validateCode(body.code)` 400 on fail; `c.set('code', body.code)`. Resolve `ip` from the same header chain as the log wrapper (already in `c.var.ip` if 6a sets it via `c.set('ip', ip)` — recommended). Call `await checkAndIncrement(getDb(c.env), ip)`; on `!allowed` → `c.header('Retry-After', String(resetInSeconds))` + 429. Otherwise `INSERT INTO user_state (code, data_json, updated_at, bytes) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, bytes = excluded.bytes` with `args: [code, JSON.stringify(body.data), body.updatedAt, rawBody.length]`. Return 204.
    - **`DELETE /api/state`**: read body via `c.req.text()` + `JSON.parse`; `validateCode`; `c.set('code', body.code)`. `await db.execute({ sql: 'DELETE FROM user_state WHERE code = ?', args: [body.code] })`. Return 204 regardless of `rowsAffected` (R9#3 idempotent).
    - Purpose: All real API behavior. With 6a's middleware in place, every path through these routes (success, 400, 413, 429) ends in a structured log line and the correct status. Verifiable independently with `curl -X PUT -d '{"code":"test123","data":{},"updatedAt":1}' -H 'Content-Type: application/json' http://localhost:8000/api/state` etc.
    - _Leverage: 6a's middleware (CORS, log wrapper, `c.set` slots); `getDb`, `validateCode`, `payloadByteLength`, `checkAndIncrement` from tasks 4 and 5_
    - _Requirements: R3#3 (PUT 204/400/413), R7#1 (schema use), R9#3 (DELETE idempotent), R10#1 (413), R10#2 (429 + Retry-After)_

- [ ] 7. EdgeOne Pages Functions entry shim `functions/api/[[path]].js`
    - File: `functions/api/[[path]].js`
    - ESM. Body:
      ```js
      import app from '../../server/app.js';
      export const onRequest = (context) =>
          app.fetch(context.request, context.env, context);
      ```
    - **No business logic in this file.** Its sole purpose is to bridge EdgeOne's Pages Functions signature to Hono's standard 3-arg `fetch(request, env, ctx)`. If EdgeOne uses a slightly different shape at deploy time, this is the ONLY file that changes; `server/app.js` is portable.
    - Purpose: Catch-all entry that EdgeOne discovers automatically under `functions/api/`.
    - _Leverage: design.md "Backend: `functions/api/[[path]].js`" subsection_
    - _Requirements: R7 (deploy integration)_

- [ ] 8a. Local dev shim — env loader + Hono fetch bridge in `scripts/dev.mjs`
    - File: `scripts/dev.mjs` (NEW; this task adds env-loading + the API bridge only)
    - ESM. Sketch:
      - **Env loader** (~10 lines): if `fs.existsSync('.env')`, `readFileSync` it, split by `\n`, parse each non-comment line as `KEY=VAL` (trim, strip surrounding quotes if present), `process.env[KEY] ||= VAL`. No dotenv dep.
      - **Hono bridge** (~25 lines): `import app from '../server/app.js'`. Build `var env = { TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL, TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN };`. Create `var server = http.createServer(async function (req, res) { ... })` that for any `req.url` starting with `/api/`:
        1. Buffer body: `var chunks = []; for await (var c of req) chunks.push(c); var body = chunks.length ? Buffer.concat(chunks) : undefined;`
        2. Build `var request = new Request('http://' + req.headers.host + req.url, { method: req.method, headers: req.headers, body: body });`
        3. `var response = await app.fetch(request, env, undefined);`
        4. Write response back: `res.statusCode = response.status; response.headers.forEach(function (v, k) { res.setHeader(k, v); }); res.end(await response.text());`
      - For non-API paths, defer to 8b's static-file branch (in 8a, return a 501 placeholder so the file is still runnable). `server.listen(process.env.PORT || 8000)`.
    - Purpose: Make `/api/*` routes testable locally without EdgeOne CLI. Verifiable: `npm run dev` then `curl http://localhost:8000/api/health` returns `{"ok":true}`.
    - _Leverage: design "Backend: `scripts/dev.mjs`" notes; Node stdlib `http`, `fs`_
    - _Requirements: (dev convenience supporting R8 verification)_

- [ ] 8b. Local dev shim — static file fallback in `scripts/dev.mjs`
    - File: `scripts/dev.mjs` (extends 8a)
    - Replace the "501 placeholder" branch with a static-file handler:
      - Map `req.url === '/'` → `'/index.html'`.
      - Strip query string; reject `..` segments (400).
      - Resolve to a path under repo root via `path.join(repoRoot, urlPath)`; `fs.readFile`. On ENOENT → 404 with plain-text body.
      - Content-type lookup map (literal object): `.html → text/html; charset=utf-8`, `.js → application/javascript`, `.css → text/css`, `.json → application/json`, `.png → image/png`, `.svg → image/svg+xml`, `.ico → image/x-icon`; default `application/octet-stream`.
      - Write `Content-Type` + status 200 + binary body.
    - After this task lands: `npm run dev` then visit `http://localhost:8000` shows the homepage with all `js/`, `style/`, `units/`, `review/` paths working — same as the existing `python3 -m http.server` setup, plus the `/api/*` layer.
    - Purpose: Last piece of the local dev workflow. Excluded from any deploy artifact (EdgeOne serves static files itself).
    - _Leverage: 8a's `http.createServer` skeleton; Node stdlib `fs.readFile`, `path.extname`, `path.join`_
    - _Requirements: (dev convenience supporting R8 verification)_

- [ ] 9. Extend `js/shared.js` with cookie-double-write for numbers, silent variants, prefix warning, clock helper + swap `recordActiveDay` call site
    - File: `js/shared.js` (ONLY)
    - All additions in ES5. Inside the existing IIFE, between `writeNumber` and `normalize`:
      1. Add `var WRITE_NUMBER_NO_COOKIE = /^quizScore_[^_]+_/;` (per-card denylist).
      2. Add `var KNOWN_PREFIXES = ['mystar_', 'quizScore_', 'quizTime_', 'lastVisit_', 'starredCards_'];` and `var _warnedKeys = {};` plus `function _warnIfUnknownPrefix(key) { ... }` per design's verbatim regex + once-per-(key, page-load) gate.
      3. Add `function _writeCookieStr(key, valueStr) { var d = new Date(); d.setTime(d.getTime() + 10*365*24*60*60*1000); document.cookie = key + '=' + encodeURIComponent(valueStr) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax'; }` — extracted from the existing inline cookie write in `writeJSON`, **with `SameSite=Lax` added** for R1#4 long-lived same-site requirement. All cookie writes in the new code (identity, clock, all `writeJSON*` / `writeNumber*` paths) go through this helper, so the SameSite attribute is uniform.
      4. Extend `writeNumber(key, value)`: keep existing localStorage line; then `_warnIfUnknownPrefix(key)`; then `if (!WRITE_NUMBER_NO_COOKIE.test(key)) _writeCookieStr(key, String(value));`; then `_touchLocalUpdatedAt();`.
      5. Extend `readNumber(key)`: after the existing localStorage try, add cookie fallback `var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + key + '=([^;]*)')); if (m) { var n = Number(decodeURIComponent(m[1])); return isNaN(n) ? null : n; }`. Returns `null` if both miss.
      6. **Inside the existing `writeJSON` function body** (currently lines 20–26), after the existing `document.cookie = ...` line that ends the function, add one line: `_touchLocalUpdatedAt();`. The call goes INSIDE the function (before the closing `}`), NOT at module top level. This ensures JSON writes also bump the clock + trigger notify, just like writeNumber does.
      7. Add `function _touchLocalUpdatedAt() { var now = String(Date.now()); try { localStorage.setItem('mystar_local_updated_at', now); } catch (e) {} _writeCookieStr('mystar_local_updated_at', now); if (W.MyStar && W.MyStar.__notifyChange) { W.MyStar.__notifyChange(); } }`.
      8. Add `function writeJSONSilent(key, value) { var v = JSON.stringify(value); try { localStorage.setItem(key, v); } catch(e) {} _writeCookieStr(key, v); _warnIfUnknownPrefix(key); /* NO clock bump, NO notify */ }`.
      9. Add `function writeNumberSilent(key, value) { try { localStorage.setItem(key, String(value)); } catch(e) {} if (!WRITE_NUMBER_NO_COOKIE.test(key)) _writeCookieStr(key, String(value)); _warnIfUnknownPrefix(key); /* NO clock bump, NO notify */ }`.
      10. In `recordActiveDay` (line 121) change `writeJSON('mystar_active_days', out)` to `writeJSONSilent('mystar_active_days', out)`.
      11. Add `writeJSONSilent`, `writeNumberSilent`, `touchLocalUpdatedAt: _touchLocalUpdatedAt` to the `W.MyStar = { ... }` exports.
    - Purpose: The single most foundational frontend task. Every other frontend task depends on this contract being correct.
    - _Leverage: existing `writeJSON` cookie write pattern at `js/shared.js:25`; existing `readJSON` cookie fallback at `:13–17`; existing IIFE structure_
    - _Requirements: R2#1 (envelope-metadata exclusions), R2#3 (unknown-prefix warn), R8#3 (writeNumber cookie double-write conditional), R8#6 (silent variants for boot housekeeping), C-1 (boot-race fix), C-2 (clock cookie fallback)_

- [ ] 10a. Frontend sync — storage layer in `js/sync.js`
    - File: `js/sync.js` (NEW; this task creates the file and adds the storage half)
    - ES5 IIFE, attached to `window.MyStar`. Implements the pure-data half of design "Frontend: `js/sync.js`" — no network, no debounce. After this task lands, `js/sync.js` is a runnable file with no network features.
    - Add module-level state at top: `var _oversizeBlocked = false; var _initialSyncBlocking = false; var _lastSyncAt = null; var _lastError = null; var _debounceTimer = null;`. (Network half in 10b will reference these.)
    - **Identity helpers** (R1#4): `function setUserCode(code) { ... }`, `function getUserCode() { ... }`, `function clearUserCode() { ... }`. All three use silent raw `document.cookie = ... ;path=/;SameSite=Lax` and `localStorage.setItem/removeItem`. **No** `_touchLocalUpdatedAt` call, **no** debounce schedule. `getUserCode` reads cookie first, then localStorage, returns `null` if absent or fails the regex `/^[a-zA-Z0-9_\-]{6,16}$/`.
    - **`_collectStateBlob()`** (R2#1, C-2): exact algorithm from design (LS scan, then cookie scan with `decodeURIComponent`, envelope-metadata exclusion). Returns `{ blob: {...}, allKeys: {...} }`.
    - **`_hasLocalUserState()`** (R5 Scenario A/D gate): predicate per design — false when all values are `''`/`'0'`/`'""'`/`'[]'`/`'{}'`.
    - **`_atomicApplyServerBlob(blob, serverUpdatedAt)`** (R5#7, C-2): full sequential apply per design — collect `currentKeys` via `_collectStateBlob()`, write `__pending_*` keys (LS + cookie via `encodeURIComponent`), delete pass over `currentKeys` not in blob (LS + cookie expiry-clear), final swap, silent set of `mystar_local_updated_at` (LS + cookie). No `_touchLocalUpdatedAt` call.
    - **Exports added in this task:**
      - On `MyStar`: `setUserCode`, `getUserCode`, `clearUserCode`, `__hasLocalUserState`, `__applyServerBlob` (= `_atomicApplyServerBlob`).
    - Purpose: All the pure storage/state primitives. Verifiable in DevTools by manually calling `MyStar.setUserCode('test12') / MyStar.getUserCode() / MyStar.__hasLocalUserState()` without any network involvement.
    - _Leverage: `MyStar.readJSON / writeJSON / readNumber / writeNumber / writeJSONSilent / writeNumberSilent / touchLocalUpdatedAt` from task 9; `_writeCookieStr`'s SameSite contract_
    - _Requirements: R1#4 (silent identity), R2#1 (envelope exclusion + LS∪cookies), R5#7 (best-effort sequential apply), C-1 (silent identity prevents premature PUT), C-2 (cookie encoding contract)_

- [ ] 10b. Frontend sync — network + orchestration in `js/sync.js`, plus `unit-enhance.js` swap
    - Files: `js/sync.js` (extend with network half), `js/unit-enhance.js` (one line)
    - `js/unit-enhance.js`: change line ~290 `M.writeNumber(KEY_LAST, Date.now())` → `M.writeNumberSilent(KEY_LAST, Date.now())`. One line.
    - In `js/sync.js`, add to the existing IIFE (built in 10a):
      - **`_xhrJson(method, url, body, cb)`** — XHR wrapper, 8 s timeout, sets `Content-Type: application/json` for body-bearing methods. Calls back `cb(err, status, parsedJson)` exactly once; never throws.
      - **`MyStar.__notifyChange = function () { if (_oversizeBlocked || _initialSyncBlocking) return; clearTimeout(_debounceTimer); _debounceTimer = setTimeout(syncToServer, 600); }`** — wired so `shared.js`'s `_touchLocalUpdatedAt` triggers the debounce.
      - **`syncToServer()`** — public. If no `getUserCode()`, return. Gather `{ blob, _ } = _collectStateBlob()`. Read clock from `localStorage.getItem('mystar_local_updated_at') || Date.now()`. PUT `{ code, data: blob, updatedAt }`. Handle 204 → update status `synced`; 400 → status `offline` + log; 413 → `_oversizeBlocked = true` + toast + status `offline`; 429 → honor `Retry-After` header + status `offline`; 5xx/timeout → status `offline`.
      - **`syncFromServer(cb)`** — public. The whole Sequence A flow:
        1. If no code, status `disabled`, call `cb()`, return.
        2. `_initialSyncBlocking = true`.
        3. Snapshot `var localClockSnapshot = Number(localStorage.getItem('mystar_local_updated_at')) || 0;`.
        4. `_xhrJson('GET', '/api/state?code=' + encodeURIComponent(code), null, function (err, status, body) { ... })`.
        5. Compare server `updatedAt` vs `localClockSnapshot` per design's race-safe rules → Scenario A/B/C decision (Scenario D is NOT triggered here — it's triggered from `user-code.js` probe).
        6. Server-wins-overwrite branch: `_atomicApplyServerBlob` then `location.reload()` (do NOT call `cb` since reload is happening).
        7. Otherwise (silent pull complete, local-wins, scenario C): run post-initial-sync flush — `localStorage.setItem('mystar_local_updated_at', String(Date.now()))` + cookie write via `_writeCookieStr` from shared.js + `syncToServer()`. Then `_initialSyncBlocking = false`. Then `cb()`.
      - **`flushPendingSync()`** — public. Cancel `_debounceTimer`. If a write is pending, synchronously call `syncToServer()` (best-effort; XHR's async nature means we don't await it for `beforeunload`).
      - **`getSyncStatus()`** — public. Returns `{ state: 'synced' | 'offline' | 'disabled', lastSyncAt: _lastSyncAt, lastError: _lastError }`. After each status transition: `if (MyStar.__onSyncStatus) MyStar.__onSyncStatus(getSyncStatus());`.
      - **`__deleteCloudData(cb)`** — used by R9 flow in task 11. Reads current code via `getUserCode()`, calls `_xhrJson('DELETE', '/api/state', { code }, cb)`. Treats both 204 and any 4xx-on-missing as success (idempotent per R9#3).
      - **Unload hooks** at end of IIFE: `document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') MyStar.flushPendingSync(); })` and `window.addEventListener('beforeunload', function () { MyStar.flushPendingSync(); })`.
      - **Exports added in this task** — these names are the contract task 11 depends on, do NOT rename:
        - Public on `MyStar`: `syncFromServer`, `syncToServer`, `flushPendingSync`, `getSyncStatus`.
        - Private hooks: `__notifyChange`, `__xhrJson`, `__deleteCloudData`. (`__hasLocalUserState`, `__applyServerBlob` already exported in 10a.)
        - Callback slot left for task 11 to set: `__onSyncStatus`.
    - Purpose: The sync engine. After this task lands, sync is fully functional end-to-end except for the UI (task 11) and page wiring (tasks 13–14).
    - _Leverage: storage layer from 10a; `_writeCookieStr` from shared.js (task 9); design "Frontend: `js/sync.js`" subsection_
    - _Requirements: R3 (600ms debounce + flush hooks), R4 (race-safe snapshot, reload on server-wins), R5 (Scenarios A/B/C silent + Modal-triggered D handed off to user-code.js), R6 (offline status), R8#2 (XHR not fetch), R9 (DELETE helper), I-1-r6 (post-initial-sync flush), I-3-r6 (post-flush cookie)_
    - _Requirements: R1#4 (silent identity), R2#1 (envelope exclusion + LS∪cookies), R3 (600ms debounce + flush), R4 (race-safe snapshot + reload on server-wins), R5 (four scenarios + atomic best-effort), R6 (offline + status), R8 (ES5, XHR, additive API), C-1 (no flush during initial-sync window), C-2 (cookie encoding contract), I-1 (post-initial-sync housekeeping flush)_

- [ ] 11. Frontend identity UI `js/user-code.js`
    - File: `js/user-code.js` (NEW)
    - ES5 IIFE. Implements design "Frontend: `js/user-code.js`" subsection:
      - On `DOMContentLoaded`, call `_renderHeaderStrip()` which injects a `<div class="mystar-userbar">` as the first child of `<body>`.
      - Two states based on `MyStar.getUserCode()`: (a) no code → `[输入学习账号 ____] [开始]` prompt; (b) code set → `你好，<code> · 切换 · 清除云端进度 · <status dot> <status text>`.
      - All buttons wired with `MyStar.addTapListener` (iPad-Safari dedup).
      - **Probe flow** on "开始" tap: validate against `/^[a-zA-Z0-9_\-]{6,16}$/`; show inline error if invalid. On valid input, **do not commit the code yet** — call `_probeIdentity(typedCode)` which:
        1. `MyStar.__xhrJson('GET', '/api/state?code=' + encodeURIComponent(typedCode), null, cb)` — exported by task 10b, signature `cb(err, status, parsedJson)`, 8 s timeout. The single canonical XHR helper; do NOT inline a duplicate.
        2. Determine scenario A/C/D from `serverData` + `MyStar.__hasLocalUserState()` (expose this from sync.js as `MyStar.__hasLocalUserState`).
        3. **Scenario A** (local empty + server has data) → call `MyStar.setUserCode(typedCode)` (silent commit) → `MyStar.__applyServerBlob(blob, updatedAt)` (expose from sync.js) → `location.reload()`.
        4. **Scenario C** (local non-empty + server null) → `MyStar.setUserCode(typedCode)` → `MyStar.syncToServer()` → re-render header strip in "code set" state.
        5. **Scenario D** (both non-empty) → render the **full-screen Modal** (`_renderModal(localSummary, cloudSummary, cb)`).
      - **`_renderModal(local, cloud, choiceCb)`** — fixed overlay with `class="mystar-modal-overlay"`; centered card with `class="mystar-modal"`. Three buttons (cloud-wins / local-wins / cancel) using `MyStar.addTapListener`. ESC key listener fires "取消". Body `overflow: hidden` set; restored on close. `choiceCb` is called with `'cloud' | 'local' | 'cancel'` and the modal removes itself.
      - **`_computeSummary(blob)`** — per R5#4 formula: `N = sum of JSON.parse(blob[k]).length for all k matching /^starredCards_/`; `K = count of k matching /^quizScore_[^_]+$/ where Number(blob[k]) > 0`. Catch JSON.parse failures (treat as 0). Returns `'约 N 张星标 · K 个 unit 有成绩'`.
      - **`MyStar.__onSyncStatus`** is set here to a callback that updates the status dot's `data-state` attribute (`'synced' | 'offline' | 'disabled'`) + text content via the relative-time helper `MyStar.timeAgo`.
      - Status text refresh: on a `setInterval(updateStatusText, 30 * 1000)` to keep the relative time fresh; clear interval on `beforeunload`.
      - **R9 "清除云端进度" flow** — wired here. The "清除云端进度" text link in the header strip (visible only when a code is set) registers a `MyStar.addTapListener` handler:
        1. Render a confirmation Modal (reusing the `.mystar-modal-overlay` + `.mystar-modal` styles) with text: `这将永久删除云端账号 <code> 的所有进度。本机数据不会被清除。确认？` and two buttons: `确认删除` (red-ish; reuses an existing token like `var(--accent-amber)` for caution) and `取消`.
        2. On `确认删除`: call `MyStar.__deleteCloudData(function (err, status) { ... })`. The helper sends `DELETE /api/state` with `{ code: MyStar.getUserCode() }`. Both 204 success and 204 no-op are treated the same (R9#3 — idempotent).
        3. On 204: close the Modal, update the status indicator to `🟡 离线，仅本地保存` (per R9#4), show a small inline toast `已删除云端进度`. The local `mystar_user_code` SHALL remain set (so a follow-up write can re-promote).
        4. On error (timeout / 5xx / 429): close the Modal, show toast `删除失败，请稍后重试`. Status indicator unchanged.
        5. On `取消`: close the Modal, no other state change.
    - Purpose: All identity UX in one place; sync.js (task 10) stays free of DOM concerns.
    - _Leverage: `MyStar.addTapListener` (shared.js:60), `MyStar.timeAgo` (shared.js:82); identity + apply hooks from sync.js (task 10)_
    - _Requirements: R1#1 (prompt), R1#2 (6–16 regex), R1#5 (切换 affordance), R5 (Scenarios A/C/D + Modal), R5#4 (N/K formula), R6#2 (status dot 🟢🟡⚪), R9 (清除云端进度 + DELETE 204 idempotent)_

- [ ] 12. Add `--overlay-tint` token + sync-UI styles in `style/shared.css` + update `conventions/colors.md`
    - Files: `style/shared.css`, `spec-workflow/steering/conventions/colors.md`
    - In `style/shared.css :root`, add a new line near the other tokens: `--overlay-tint: rgba(22, 58, 95, 0.55);` (the `--ink` color `#163A5F` with 0.55 alpha — a paper-journal-toned modal scrim).
    - Append the styles per design "Style: `style/shared.css`" subsection: `.mystar-userbar`, `.mystar-userbar__status` (+ three `[data-state="…"] .dot` color states using existing tokens), `.mystar-modal-overlay` (using `var(--overlay-tint)`), `.mystar-modal`, `.mystar-modal__cta--cloud-wins` (navy primary), `.mystar-modal__cta--local-wins` (green secondary), `.mystar-modal__cta--cancel` (text link). No new hex values.
    - In `conventions/colors.md`'s **Token 总表**, add a new row: `| --overlay-tint | rgba(22, 58, 95, 0.55) | Modal/dialog scrim — composed from --ink with 0.55 alpha; permitted under colors.md rule #6 |`.
    - Purpose: Single steering+style change so both the design's CSS expectations and the conventions document stay aligned.
    - _Leverage: existing CSS tokens in `style/shared.css :root`; `conventions/colors.md` rule #6 (soft-variant composition permitted)_
    - _Requirements: R6#4 (status colors via tokens), R5#6 (Modal scroll lock), colors.md compliance (no new hex)_

- [ ] 13. Wire `index.html` + `review/index.html`
    - Files: `index.html`, `review/index.html`
    - **Two-part insertion** to preserve correct DCL execution order:
      - **Part A — extension scripts** go after `js/shared.js`, BEFORE the existing inline boot block. This makes `MyStar.setUserCode/getUserCode/syncFromServer/...` available by the time the inline `boot()` runs. Insert positions:
        - `index.html` line 35 → 36: after `<script src="js/shared.js">` (line 35) and BEFORE the inline `<script>` boot block opens at line 36. Add: `<script src="js/sync.js"></script>` then `<script src="js/user-code.js"></script>`.
        - `review/index.html` line 152 → 153: same pattern with paths `../js/sync.js` and `../js/user-code.js`.
      - **Part B — the `syncFromServer` trigger** goes AFTER the existing inline boot block CLOSES (after the `</script>` at index.html line 311; locate review/index.html's equivalent inline-boot `</script>` and insert after). This guarantees the DCL handler registered here fires AFTER `boot()` (which calls `M.recordActiveDay()` → silent write to localStorage). That way the post-initial-sync flush in `syncFromServer` correctly captures today's `mystar_active_days` write.
    - The new lines to insert in Part B, in this exact order (one combined block, placed AFTER the existing inline boot's `</script>`):
      ```html
      <script>
          document.addEventListener('DOMContentLoaded', function () {
              MyStar.syncFromServer(function () {});
          });
      </script>
      ```
      (The two `<script src=...>` lines are NOT in Part B — they're in Part A above.)
    - Do NOT move any existing `<script>` tag. Do NOT alter the existing inline `M.recordActiveDay()` boot — it now flows through `writeJSONSilent` automatically (task 9 swap), and runs FIRST (because its DCL handler is registered before the new tail script's handler).
    - Purpose: Activate the sync layer on the two main entry pages.
    - _Leverage: existing script blocks in `index.html` and `review/index.html`; design "Page boot — script include positions" subsection_
    - _Requirements: R1#1 (header strip renders), R4#1 (syncFromServer on load), I-2 (new tail script after user-code.js)_

- [ ] 14. Surgical edits + script additions in `units/book1/u3/index.html` + `u6/index.html`
    - Files: `units/book1/u3/index.html`, `units/book1/u6/index.html`
    - **Surgical body swap** (in the existing inline `<script>` block, do NOT move the block):
      - u3 lines **980–1004** — `getStarredCards` definition opens at line 980; `saveStarredCards` opens at line 992. Replace `getStarredCards` body with `return MyStar.readJSON('starredCards_u3') || [];`; replace `saveStarredCards` body with `MyStar.writeJSON('starredCards_u3', cards);`. Delete the inline cookie code in both bodies.
      - u6 lines **1249–1270** — `getStarredCards` at line 1249, `saveStarredCards` at line 1261. Same edit with `'starredCards_u6'`.
    - **Script include additions** (after the existing `<script src="../../../js/unit-enhance.js">` at the bottom):
      ```html
      <script src="../../../js/sync.js"></script>
      <script src="../../../js/user-code.js"></script>
      <script>
          document.addEventListener('DOMContentLoaded', function () {
              MyStar.syncFromServer(function () {});
          });
      </script>
      ```
    - Do NOT touch the existing inline DCL handler (which restores starred state, wires the inline `addTapListener`, blank toggle, sort, globalBtn). Its DCL fires first; the new sync DCL fires last (after user-code.js renders the header strip).
    - Purpose: Final wiring + the data-loss fix for star toggles.
    - _Leverage: existing inline storage helpers in u3/u6; design "Unit-page surgical edits" subsection_
    - _Requirements: R2 (star writes now flow through MyStar.writeJSON → sync), R8#4 (surgical helper replacement), I-2 (new tail script after user-code.js)_

- [ ] 15. Steering updates: `product.md`, `tech.md`, `structure.md`
    - Files: `spec-workflow/steering/product.md`, `spec-workflow/steering/tech.md`, `spec-workflow/steering/structure.md`
    - **`product.md`** — replace the existing Non-goals section per design's I-1 fix block: amend "No accounts, no sync, no backend" to acknowledge the optional `server-user-state` layer; keep frontend constraints intact.
    - **`tech.md`** — add a new "Backend (optional layer)" subsection per design's Steering Updates: Node 24.5.0, Hono ^4.x, @libsql/client ^0.14.x (web flavor), ESM in `server/` and `scripts/` only, exactly two deps. Append the two new Architectural Decisions ("Server is a sync mirror" + "Short-code identity is unprotected"). Append the two new Known Limitations (Turso outage; short-code threat model).
    - **`structure.md`** — add `functions/`, `server/`, `migrations/`, `scripts/`, `package.json`, `.env.example` rows to the directory layout. Add the three new "Where things go" entries. Add the two new Anti-patterns ("No long-lived global state in server/"; "No ESM/Node imports in js/").
    - Purpose: Bring steering in sync with the architectural reality the rest of these tasks introduce. Failing this means future agents will rule the feature out of bounds.
    - _Leverage: design "Steering Updates (carried by this spec)" section — copy the prose verbatim_
    - _Requirements: I-1 (product.md amendment), R8 (frontend constraints unchanged), R7 (backend layer documented)_
