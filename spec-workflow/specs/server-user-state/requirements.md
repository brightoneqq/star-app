# Requirements Document

## Introduction

Today every piece of student progress in star-app — quiz scores, starred cards, active-day streak, per-card scores — lives in browser `localStorage` (with cookie double-write). That's fine when the app has a stable URL, but it breaks once we deploy to **EdgeOne Pages**: each prod deploy gives the project a different domain, and the student does not (or will not) bind a custom domain. Different origin → different `localStorage` bucket → progress appears wiped.

This spec adds a thin **server-side persistence layer** that survives both deploys and origin changes:

- The user identifies themselves with a **short code** (typed name / PIN, 6–16 chars). No accounts, no email, no password.
- The entire MyStar storage blob is mirrored to **Turso (libsql managed SaaS)** under that code. Turso is an external service — completely outside the EdgeOne deploy lifecycle, so deploys never touch user data.
- The browser still writes `localStorage` first (offline cache + < 50ms first paint). Cloud sync is a layer **on top**, debounced and best-effort.
- Conflict resolution uses `updatedAt` last-write-wins **after identity is established**, with an explicit Modal prompt when identity is established / switched and both sides hold data.

The architecture decisions (Turso, Hono on EdgeOne Pages Functions, whole-blob JSON, short-code identity) are pre-confirmed in `~/.claude/plans/foamy-foraging-blanket.md` and are not re-litigated here. This document specifies the *behavior* the implementation must deliver.

## Alignment with Product Vision

- **"Per-unit progress" + "Starred set" preserved across origins / deploys** — directly supports `product.md`'s core capabilities; this is the first time those signals will reliably survive a prod URL change.
- **No accounts** stays true. A short code is a self-chosen alias, not an authenticated account.
- **iPad-Safari constraint stays** — `tech.md`'s ES5 / no-fetch / no-modules rules continue to apply to all frontend code under `js/`. The new backend layer (Pages Functions) is a separate concern.
- **Offline-first behavior preserved** — `tech.md`'s localStorage + cookie double-write remains the source of truth for the running session. Cloud sync never blocks UI.
- **Cookie-budget concern respected** — only the short code itself (≤ 16 chars) is added to cookies; the data blob lives in `localStorage` and Turso, not in cookies.

## Requirements

### Requirement 1 — Identity via short code

**User Story:** As a student, I want to identify myself with a short code I choose, so that I can recover my progress on a new device or after the prod URL changes — without an account.

#### Acceptance Criteria

1. WHEN a user opens the homepage AND no short code is set, THE SYSTEM SHALL render a top-of-page prompt: an input field + "开始" button asking the user to enter or create a short code.
2. THE short code SHALL be validated against `/^[a-zA-Z0-9_\-]{6,16}$/` on both client and server (minimum 6 chars; the 3-char minimum was rejected during requirements review because the keyspace was too small relative to the per-IP rate limit). Invalid input SHALL be rejected with inline error text; the API SHALL reject with HTTP 400.
3. THIS spec deliberately accepts the security model "short code is the only handle": anyone who guesses the code can GET / PUT / DELETE that code's data. The product threat model is single-student / family use; brute-force is mitigated by Requirement 10's per-IP rate limit. Adding a PIN, secret token, or proof-of-ownership flow is **out of scope for v1** and tracked separately if usage shifts.
4. WHEN a short code is set, THE SYSTEM SHALL persist it via **silent metadata write**: raw `document.cookie =` (long-lived, same-site) AND raw `localStorage.setItem('mystar_user_code', code)`. The persistence path SHALL NOT go through `MyStar.writeJSON` because writeJSON triggers the sync chain — setting a code is identity establishment, NOT a state write. Both sources are read on next load; cookie wins on tie.
5. WHEN a short code is set, THE SYSTEM SHALL show a compact header strip: `你好，<code> · 切换`. Tapping "切换" SHALL open the identity prompt again with the current code clearable.
6. WHEN the user types a new code that differs from the current `mystar_user_code` (the **probe** phase), THE SYSTEM SHALL NOT clear local state at probe time. Instead THE SYSTEM SHALL: (a) GET `/api/state?code=<typed-code>`; (b) compute the four-scenario decision (Requirement 5) against the typed code's cloud data + the current local data; (c) **only after** the user has made a choice in Scenario D (or A/B/C resolves silently) THE SYSTEM SHALL: commit the new code via the silent metadata write (Requirement 1 #4), then apply the chosen blob (cloud-wins → atomic swap; local-wins → PUT). RATIONALE: clearing local state BEFORE the user has chosen would make Scenario D impossible to display (no "local non-empty" side to summarize), and would destroy data if the user picks "取消".
7. THE short code SHALL NEVER appear in the `data_json` blob (it's an identity field, not a state field).

### Requirement 2 — Whole-blob sync scope

**User Story:** As a maintainer, I want every key currently written via `MyStar.*` to round-trip through the cloud automatically, so that adding a new feature with a new storage key doesn't require backend changes.

#### Acceptance Criteria

1. THE sync payload SHALL be a JSON object containing **every** key that the running browser has stored via `MyStar.writeJSON / MyStar.writeNumber`. The browser SHALL enumerate keys at sync time from **BOTH** `localStorage` AND `document.cookie` (in that precedence order — localStorage wins on conflict), matching the documented MyStar key patterns (prefixes: `mystar_`, `quizScore_`, `quizTime_`, `lastVisit_`, `starredCards_`) AND applying the **envelope-metadata exclusion list**: `mystar_user_code` (identity, Requirement 1 #7) and `mystar_local_updated_at` (race-safe clock, Requirement 4). These two keys ARE persisted but ARE NOT included in `data_json` because they are envelope/identity metadata rather than user state. **Cookie pass rationale:** iPad-Safari private mode silently fails `localStorage.setItem` while cookie writes succeed; without the cookie pass, a private-mode user's data would be readable on-page (via existing JSON cookie fallback) yet missing from sync payloads.
2. NEW storage keys introduced by future features (e.g. `quizScore_<slug>_<cardId>` from the just-shipped per-card-quiz-submit feature) SHALL be automatically included with no code change, AS LONG AS they follow one of the documented prefixes above. **Cookie-fallback exclusion + private-mode behavior (the honest trade-off):** per-card score keys (matching `/^quizScore_[^_]+_/`) are explicitly **excluded from the cookie double-write** for cookie-budget reasons (see design Risk #1). Consequence under iPad-Safari private mode (where `localStorage.setItem` silently fails): a per-card score written during that session has NO durable backing — it lives only in the page's in-memory DOM until the page unloads. `_collectStateBlob` cannot find it (not in localStorage, not in cookie), so the upcoming PUT does not carry it; the data is lost on browser close, **even if a short code is set**. This is documented as an **accepted limit** for v1, not a recoverable scenario. Resilience guarantees that DO hold in private mode: `mystar_active_days`, `starredCards_<slug>`, `quizScore_<slug>` (unit aggregate), `quizTime_<slug>`, `lastVisit_<slug>`, `mystar_user_code`, `mystar_local_updated_at` — all still cookie-backed and therefore PUT-able. Users who need per-card scores to survive private-mode sessions should exit private mode (the regular cookie path doesn't help here since per-card cookies are intentionally not written).
3. THE `MyStar.writeJSON / writeNumber` implementations SHALL emit a `console.warn` (once per key per page load) if called with a key that matches none of the documented prefixes. This prevents silent drop-out from sync coverage when a future feature picks a non-conforming key name.
4. THE payload SHALL include a top-level numeric `updatedAt` (epoch ms) reflecting the latest local write. Individual keys do NOT carry their own timestamps in the payload.
5. THE backend SHALL store the payload **as opaque text** in a single column (`user_state.data_json`) without parsing or schema-checking individual keys. Schema changes in MyStar storage keys SHALL NOT require Turso migrations.
6. THE sync payload bytes SHALL be capped at **64 KB**. IF an attempted PUT exceeds 64 KB, THE backend SHALL respond 413 and the client SHALL surface a non-blocking warning in the top status strip (Requirement 6).

### Requirement 3 — Debounced write-through to server

**User Story:** As a student, I want my progress to be saved to the cloud automatically as I use the app, so that I never have to think about syncing.

#### Acceptance Criteria

1. WHEN any `MyStar.writeJSON` or `MyStar.writeNumber` call completes AND a short code is set, THE SYSTEM SHALL schedule a PUT to `/api/state` after a **600 ms** debounce window. (The system does NOT gate on `navigator.onLine` — it always attempts the PUT and lets transport failure surface naturally through Requirement 6.)
2. THE debounce SHALL coalesce multiple writes inside the window into a single PUT carrying the latest full blob.
3. THE PUT body SHALL be `{ code, data, updatedAt }`. THE backend SHALL respond 204 on success (no body), 400 on invalid input, 413 on oversize.
4. WHEN no short code is set, NO PUT SHALL ever be attempted. `MyStar.*` writes SHALL continue to update `localStorage` and cookies exactly as today.
5. WHEN the page is about to unload (`visibilitychange` → hidden, or `beforeunload`), AND a debounced write is pending, THE SYSTEM SHALL attempt an immediate sync flush. Best-effort; failure does NOT block unload.
6. ALL network calls SHALL go through `XMLHttpRequest`, NOT `fetch` (iPad Safari ES5 constraint per `tech.md`).

### Requirement 4 — Initial pull on page load

**User Story:** As a returning student on a new device or new prod URL, I want my last progress to appear automatically after I enter my code, so that I don't have to wait or do any extra action.

#### Acceptance Criteria

1. WHEN the homepage or a unit page loads AND a short code is set, THE SYSTEM SHALL render with whatever is already in `localStorage` (zero-wait first paint), AND in parallel issue `GET /api/state?code=<code>`.
2. WHEN the GET response arrives, THE SYSTEM SHALL compare server `updatedAt` to local `mystar_local_updated_at`. The local `mystar_local_updated_at` snapshot used for comparison SHALL be the value read at GET-fire time, NOT at apply time, so writes that happened during the in-flight GET are not overwritten. IF the current local `mystar_local_updated_at` at apply time is newer than the snapshot → abort the overwrite and treat as local-newer (schedule a PUT). Otherwise:
   - IF server is null (no record) AND local has data → behave per Requirement 5 scenario C (promote local to server).
   - IF server `updatedAt` > snapshot local `mystar_local_updated_at` → overwrite all `MyStar.*` keys in `localStorage` with the server blob's keys, then call `location.reload()` so all DOM derived from those keys re-renders from the new state. Local keys not present in the server blob SHALL be removed (server is authoritative when newer). RATIONALE: home + unit + review pages today render from IIFE-private functions on `DOMContentLoaded`; exposing a public re-render hook in each is out of scope for v1, so the simpler reload is chosen. A future improvement may introduce `MyStar.onStateApplied(callback)` and avoid the reload.
   - IF snapshot local `mystar_local_updated_at` >= server `updatedAt` → no DOM change; schedule a PUT to push local up.
3. THE GET SHALL time out at 8 s. ON timeout or HTTP ≥ 500, the system SHALL stay in offline mode (Requirement 5) without modifying `localStorage`.
4. THE GET SHALL be fired AT MOST ONCE per page load (no auto-refresh polling).
5. ALL network calls SHALL go through `XMLHttpRequest`, NOT `fetch`.

### Requirement 5 — Conflict resolution and the four scenarios

**User Story:** As a student, I want clear handling when my browser and the cloud disagree, so that I don't silently lose progress.

#### Acceptance Criteria

1. **Scenario A — new origin, empty local, server has data for the entered code:** server wins. THE SYSTEM SHALL pull and overwrite `localStorage` without prompting (per Requirement 4).
2. **Scenario B — identity stable, both sides have data:** apply `updatedAt` last-write-wins (per Requirement 4 #2). NO prompt SHALL be shown.
3. **Scenario C — first time setting a short code, local has non-empty data, server has no record for this code:** THE SYSTEM SHALL automatically PUT the local blob to the server as the initial value, with no prompt. (Local is promoted to the cloud.)
4. **Scenario D — setting / switching to a code that already has server data, while local also has non-empty data:** THE SYSTEM SHALL show a **full-screen Modal** (dark overlay + centered card) BEFORE applying any change, presenting:
   - The cloud account's `updatedAt` formatted as `M月D日 HH:MM` AND a one-line summary computed from the cloud blob: `约 N 张星标 · K 个 unit 有成绩`. **N** = sum of `length` over all keys whose name matches `starredCards_*` (each value parsed as a JSON array of card IDs). **K** = count of keys matching `quizScore_<slug>` where `<slug>` contains no further `_` AND the stored value is a number > 0.
   - The local state's `updatedAt` AND the same summary computed from the local blob using the same N / K rules.
   - Three buttons: **「用云端覆盖本地」** (apply server blob to local), **「用本地覆盖云端」** (PUT local blob to server with current time as `updatedAt`), **「取消」** (no change; the typed code is discarded so the user is back in the identity-prompt state).
5. WHEN local and cloud `updatedAt` are equal (tie), the Modal SHALL still be shown — explicit user choice is preferred over silent overwrite even though the timestamps match. If the user picks "用云端覆盖本地", cloud wins; if "用本地覆盖云端", local wins and a fresh `updatedAt = Date.now()` is generated to break the tie on the server side.
6. THE Modal in Scenario D SHALL block other interactions until a choice is made (no background scroll, ESC = "取消").
7. WHEN the user chooses in Scenario D, the result SHALL be applied as a **best-effort sequential apply** (localStorage has no real transactions): (a) write each new MyStar key to a temp key `__pending_<orig>__`; (b) synchronously remove live MyStar keys that are not in the new blob; (c) synchronously rename pending → live; (d) silently set `mystar_local_updated_at` to the server's `updatedAt` (without re-triggering sync). On any mid-apply failure, the SYSTEM SHALL abort and surface an error toast `"同步出错，建议重新进入页面"`. Live keys are **not guaranteed** untouched on failure — recovery is "reload + re-pull from server". This is an honest downgrade from "truly atomic" because the iPad-Safari runtime offers no transactional storage; the operational mitigation is that the apply step runs synchronously immediately before `location.reload()` so the user does not observe a half-swapped state in the same DOM render.

### Requirement 6 — Offline / network-failure behavior

**User Story:** As a student in a school break with patchy wifi, I want the app to keep working even if the cloud is unreachable, and I want to know when it's offline.

#### Acceptance Criteria

1. WHEN any network call to `/api/state` fails (timeout, 5xx, network error), THE SYSTEM SHALL continue serving the app entirely from `localStorage`. No UI flow is blocked.
2. THE top-of-page header strip SHALL contain a small **status dot + text** indicator with three states:
   - 🟢 `已同步 · <relative time>` (last successful sync within last 10 minutes)
   - 🟡 `离线，仅本地保存` (last attempt failed OR no successful sync in this session yet)
   - ⚪ `未启用云同步` (no short code set)
3. WHEN a sync failure occurs, THE SYSTEM SHALL retry on next successful `MyStar.write*` call (which schedules a new debounce), AND on page reload. NO automatic background polling SHALL be added.
4. THE status text SHALL be readable but de-emphasized (e.g. `--text-tertiary` / `--text-secondary` colors from `conventions/colors.md`) — it is informational, not a CTA.

### Requirement 7 — Backend storage schema and idempotent deploys

**User Story:** As an operator, I want every deploy to leave my user data untouched, so that I never have to "sync user settings on deploy" (the answer is: the data isn't in the deploy).

#### Acceptance Criteria

1. THE backend SHALL store user state in a Turso (libsql) database with two tables:
   - `user_state(code TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, bytes INTEGER NOT NULL)` — the user-state blob, one row per short code.
   - `rate_limit(ip TEXT, window_minute INTEGER, count INTEGER, PRIMARY KEY(ip, window_minute))` — the per-IP rate-limit counter (R10 #2).
2. THE migration script (`migrations/001_init.sql`) SHALL use `CREATE TABLE IF NOT EXISTS` for table creation. For evolving schema (`ALTER TABLE ADD COLUMN`), the migrate runner SHALL inspect the existing schema via `PRAGMA table_info(user_state)` (or libsql equivalent) and skip add-column statements whose target column already exists. libsql does NOT natively support `ADD COLUMN IF NOT EXISTS`; the runner does the existence check.
3. THE EdgeOne build phase SHALL run `npm ci && npm run build` (where `npm run build` is an alias for `npm run migrate`, per the design's package.json script contract). The migration runner SHALL be **idempotent and non-destructive** — running it against a populated DB SHALL never `DROP`, `TRUNCATE`, or reset rows.
4. Turso credentials (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) SHALL ONLY be read from environment variables. THE repo SHALL NOT contain these values. `.env` SHALL be in `.gitignore`.
5. THE backend SHALL never block on missing optional columns; new columns added later SHALL be optional or carry sensible defaults so the previous deploy's code can still read the row during deploy rollover.

### Requirement 8 — Frontend compatibility preserved

**User Story:** As a student on an old iPad Safari, I want the app to keep working exactly as before — the sync layer is invisible until I opt in by entering a code.

#### Acceptance Criteria

1. ALL code under `js/` (existing files + new `js/user-code.js` + `js/sync.js`) SHALL stay ES5: `var`, `function`, no arrow functions, no template literals, no `const/let`, no `Promise`, no ES modules. Verified by `node --check` and a `grep -E '(const |let |=> |\`)'` pass returning zero hits.
2. **NEW** network calls introduced by this spec (sync layer in `js/sync.js`, identity in `js/user-code.js`) SHALL use `XMLHttpRequest`, NOT `fetch`. The pre-existing `fetch` + `Promise` chain in `review/index.html:175` for loading unit HTML is **grandfathered** — this spec does NOT migrate it. If a future feature touches that block, prefer XHR.
3. THE `MyStar.*` public API SHALL be additive only: existing functions (`readJSON / writeJSON / readNumber / writeNumber / isAnswerCorrect / addTapListener / timeAgo / recordActiveDay / getActiveDays / getStreak / isSameLocalDay`) keep their signatures. **Signature unchanged but internal behavior extended** for `writeNumber` / `readNumber`: they SHALL now double-write to cookie (same pattern as `writeJSON / readJSON`) so that iPad-Safari private-mode localStorage failures no longer silently lose `quizScore_*` / `lastVisit_*` / `quizTime_*` values. New additions: `setUserCode / getUserCode / clearUserCode / syncFromServer / syncToServer / getSyncStatus`.
4. THE inline `getStarredCards / saveStarredCards` functions in `units/book1/u3/index.html` (lines ~980–1004) AND `units/book1/u6/index.html` (lines ~1249–1270) SHALL be replaced with thin wrappers that delegate to `MyStar.readJSON('starredCards_<slug>')` / `MyStar.writeJSON('starredCards_<slug>', list)`. The rest of each inline `<script>` (including the local `addTapListener`, `toggleCard`, `toggleAll`, blank-toggle, sort, globalBtn wiring) SHALL remain UNCHANGED — these helpers are tightly coupled to other inline logic and a wholesale extraction is out of scope. RATIONALE: today's inline `saveStarredCards` writes localStorage + cookie directly, bypassing `MyStar.writeJSON`'s sync hook. After this surgical edit, every star toggle goes through `MyStar.writeJSON` and is automatically synced per Requirement 3. Card IDs continue to be stored as full DOM ids (`"vocab-card-N"`) — schema unchanged.
5. THE per-card-quiz-submit feature (already shipped) SHALL NOT need ANY code changes. Its `quizScore_<slug>_<cardId>` keys flow through Requirement 2 automatically.
6. WHEN no short code is set, THE app SHALL be **user-visibly identical** to today: no GET / PUT / DELETE network calls, no Modal interruptions, no DOM additions beyond the dormant identity-prompt strip. The R8#3 `writeNumber` cookie double-write and R8#4 surgical star-helper rewire are pure resilience / sync-coverage wins that take effect regardless of code state — they DO add cookie writes for previously-cookieless number keys, and route star toggles through `MyStar.writeJSON`. These are intentional side effects of the resilience layer, not regressions of the no-code baseline.

### Requirement 9 — User-controlled cloud-data deletion

**User Story:** As a student, I want to be able to delete my cloud copy if I no longer want it stored, so that I'm in control of my own data.

#### Acceptance Criteria

1. THE 切换 / identity panel SHALL include a "清除云端进度" affordance (small text link, NOT a prominent button) visible ONLY when a short code is set.
2. WHEN tapped, THE SYSTEM SHALL show a confirmation Modal stating clearly: "这将永久删除云端账号 `<code>` 的所有进度。本机数据不会被清除。确认？".
3. ON confirmation, THE SYSTEM SHALL call `DELETE /api/state` with the code; backend SHALL delete the matching `user_state` row. Response **204** on both real delete AND no-op (non-existent code) — DELETE is idempotent; clients SHALL NOT distinguish.
4. AFTER successful delete, the short code SHALL remain set on this device (so further local activity can still re-promote if desired). The status indicator SHALL revert to `🟡 离线，仅本地保存` until the next successful PUT.
5. THERE SHALL NOT be a "delete local progress" affordance in this spec — the existing browser "clear site data" path is sufficient. (Adding a local clear is out of scope.)

### Requirement 10 — Abuse-resistance floor

**User Story:** As an operator, I want a minimal abuse floor so that a malicious actor can't trivially blow up Turso usage or write-flood a victim's short code.

#### Acceptance Criteria

1. THE backend SHALL enforce the 64 KB payload cap from Requirement 2 #6 — responses 413 on violation.
2. THE backend SHALL enforce a **per-IP write rate limit** of at most 30 PUT requests per minute. THE limit SHALL be implemented via a Turso table `rate_limit(ip TEXT, window_minute INTEGER, count INTEGER, PRIMARY KEY(ip, window_minute))` — NOT via in-memory counters, because EdgeOne Pages Functions runs distributed across edge nodes and ephemeral instances; an in-memory counter would only be per-instance and effectively useless. Each PUT SHALL `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1` against the current `window_minute = floor(now_ms / 60000)`, then `SELECT count` and 429 if ≥ 30. Excess SHALL respond 429 with a `Retry-After` header in seconds. Rows older than 2 minutes SHALL be opportunistically deleted (best-effort GC; OK to skip on most requests). The client SHALL treat 429 as a transient failure (status indicator goes 🟡, retry on next debounced write).
3. THE backend SHALL log one structured line per request with fields: `ts, ip, code, method, bytes, status, latency_ms`. PII is limited to the short code (self-chosen alias). No request bodies SHALL be logged.
4. THERE SHALL NOT be a separate auth token, captcha, or proof-of-work mechanism in this spec — those are out of scope. The short code is the only handle; rate limiting + size cap is the only floor.

## Out of Scope (explicit)

Any of the following are **deliberately not** part of this spec and will be tracked separately if needed:

- **Multi-device real-time sync / conflict merging beyond last-write-wins.** No CRDT, no operational transform, no per-key timestamp diffing.
- **Account recovery beyond "remember your code".** Forgotten codes mean lost cloud data. No email, no recovery link.
- **GitHub Actions backup of Turso.** Mentioned in the plan as a future op; not in v1.
- **Migration of `manifest.js` content into Turso** — that's the deferred `nodejs-sqlite-migration` spec's territory.
- **Mobile apps, push notifications, native integrations.**
- **Per-key history / undo / audit log.**
- **Admin UI to inspect or edit other users' cloud data.**
- **Encryption of user blob at rest beyond Turso's defaults.**
- **A "share my progress with a friend" feature.**
- **Anything that would require breaking the ES5 / no-fetch / no-modules frontend constraint.**
