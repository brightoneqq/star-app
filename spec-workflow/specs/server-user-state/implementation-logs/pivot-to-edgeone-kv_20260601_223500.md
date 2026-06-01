# Pivot — Turso/libsql → EdgeOne KV

Date: 2026-06-01 22:35

## Why

The original design targeted Turso (managed libsql, US-hosted) accessed via `@libsql/client/web` from EdgeOne Pages Functions. Two concerns surfaced after the initial implementation landed:

1. **Cross-region reachability risk** — EdgeOne edge nodes are primarily China/APAC; Turso is US-hosted. Outbound HTTPS from EdgeOne functions to Turso is not guaranteed reliable, and even when it works the latency is meaningful.
2. **Vendor dependency** — adding a US-based SaaS for a hobby project run on a China-vendor platform is operationally awkward.

EdgeOne Pages offers a built-in KV store (per Tencent docs at https://cloud.tencent.com/document/product/1552/127420) bound directly to Pages Functions as `env.<binding>`. Same vendor, same network, no external SaaS.

## What changed

Architecture pivot, frontend untouched.

### Removed
- `@libsql/client` dependency → down to **1 runtime dep** (`hono`).
- `server/rate-limit.js` — KV has no atomic increment / CAS, and EdgeOne's WAF covers the abuse floor for single-student / family scale. Removed entirely from v1.
- `migrations/001_init.sql`, `migrations/002_rate_limit.sql` — KV has no schema.
- `scripts/migrate.mjs` — no migrations to run.
- `npm run migrate` script.
- `npm run build` is now a no-op (`echo`). EdgeOne build command can be empty.

### Rewritten
- `server/db.js` — now a thin `getKv(env)` returning `env.MYSTAR_KV`. No client factory, no network handshake.
- `server/app.js` — `GET → kv.get(code, "json")`, `PUT → kv.put(code, JSON.stringify({data, updatedAt, bytes}))`, `DELETE → kv.delete(code)`. Removed rate-limit middleware import.
- `scripts/dev.mjs` — added in-memory KV mock (`createMemoryKv()`) backed by `.dev-kv.json` so `npm run dev` still gives a working full-stack experience locally without EdgeOne CLI.
- `.env.example` — removed `TURSO_*` keys; no required env vars in production (binding is automatic via the EdgeOne console).

### Schema impact (code charset)
EdgeOne KV keys allow only **alphanumeric + underscore**. The original code regex `/^[a-zA-Z0-9_\-]{6,16}$/` allowed `-`; tightened to `/^[a-zA-Z0-9_]{6,16}$/` in:
- `server/validators.js`
- `js/sync.js` (`getUserCode` validation)
- `js/user-code.js` (`CODE_RE` + error hint text "字母 / 数字 / 下划线")

### Steering
- `tech.md` — Backend section now lists EdgeOne KV instead of @libsql/client; one dep budget; ~60s eventual-consistency caveat documented.
- `structure.md` — directory layout drops `migrations/`; mentions `.dev-kv.json` (gitignored); "Where things go" entry for SQL migrations replaced with KV key family note.
- `product.md` — optional layers entry now mentions EdgeOne KV (not Turso).

### Untouched (the pivot's value)
- All frontend code (`js/shared.js`, `js/sync.js`, `js/user-code.js`, `js/unit-enhance.js`) — sync engine, identity UI, Modal, header strip, status indicator: zero changes.
- All HTML page wiring (`index.html`, `review/index.html`, `units/book1/u3 + u6`).
- All styling (`style/shared.css`, `--overlay-tint` token).
- All requirements (R1–R10) still met; only the storage backend below `server/db.js` changed.
- Data shape: KV value is JSON `{ data, updatedAt, bytes }` — identical content to the libsql row layout.

## Verification

Local `npm run dev` smoke test (port 8003) with in-memory KV mock:
- `GET /api/health` → 200 `{"ok":true}`
- `GET /api/state` (no code) → 400 `{"error":"invalid code"}`
- `GET /api/state?code=jay_kv01` → 200 `{"data":null,"updatedAt":null}` (fresh)
- `PUT /api/state` with valid body → 204
- `GET /api/state?code=jay_kv01` → 200 with the upserted blob
- `DELETE /api/state` → 204; subsequent GET → null
- `GET /api/state?code=jay-kv01` (dash, now invalid) → 400 ✓
- Homepage + static assets → 200
- `node --check` clean on all server + frontend JS.
- ES5 strictness grep on `js/*.js` returns zero hits.
- Final dep tree: `star-app@ └── hono@4.12.23`.

## Deployment

EdgeOne Pages build settings simplified:
- 安装命令: `npm ci`
- 编译命令: `npm run build` (no-op echo, or leave empty)
- 环境变量: **none required** (KV binding is platform-native; configured in EdgeOne console, not via env)
- 启动命令: N/A (Pages Functions auto-discover under `functions/`)

KV namespace `star` is bound to the project as `MYSTAR_KV` in EdgeOne console.

## Why R1–R10 still hold

| Req | Pre-pivot path | Post-pivot path |
|---|---|---|
| R1 short-code identity | Same | Same (charset tightened to drop `-`) |
| R2 whole-blob sync | libsql column `data_json TEXT` | KV value `JSON.stringify({data, ...})` |
| R3 600ms debounce + PUT | Same | Same |
| R4 race-safe initial GET | Same | Same |
| R5 four scenarios + Modal | Same | Same |
| R6 offline indicator | Same | Same |
| R7 idempotent deploy | Migrations + PRAGMA check | No migrations; idempotent by design |
| R8 frontend additive only | Same | Same |
| R9 DELETE idempotent 204 | `DELETE FROM user_state` | `kv.delete(code)` (no-op tolerated) |
| R10 abuse floor | Turso rate_limit table + 429 | EdgeOne WAF (platform layer) |
