// Hono app skeleton: CORS, structured-log wrapper, /api/health.
// State routes (GET/PUT/DELETE /api/state) are added in task 8.
import { Hono } from 'hono';
import { getDb } from './db.js';
import { validateCode, payloadByteLength } from './validators.js';
import { checkAndIncrement } from './rate-limit.js';

function resolveIp(c) {
    const h = c.req.header.bind(c.req);
    const xff = h('X-Forwarded-For');
    return h('CF-Connecting-IP') || h('X-Real-IP') || (xff ? xff.split(',')[0].trim() : null) || 'unknown';
}

const app = new Hono();

// CORS — same-origin echo. Preflight short-circuits with 204.
app.use('*', async (c, next) => {
    const origin = new URL(c.req.url).origin;
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    if (c.req.method === 'OPTIONS') {
        return c.body(null, 204);
    }
    await next();
});

// Structured-log wrapper. The `finally` block runs even on early returns /
// thrown errors so 4xx paths still emit a log line.
app.use('*', async (c, next) => {
    const t0 = Date.now();
    const ip = resolveIp(c);
    c.set('ip', ip);
    try {
        await next();
    } finally {
        console.log(JSON.stringify({
            ts: t0,
            ip,
            code: c.get('code') || '-',
            method: c.req.method,
            bytes: c.get('bytes') || 0,
            status: c.res.status,
            latency_ms: Date.now() - t0,
        }));
    }
});

app.get('/api/health', (c) => c.json({ ok: true }));

// GET /api/state?code=... — read a user state blob.
app.get('/api/state', async (c) => {
    const code = c.req.query('code');
    if (!validateCode(code)) {
        return c.json({ error: 'invalid code' }, 400);
    }
    c.set('code', code);
    const db = getDb(c.env);
    const result = await db.execute({
        sql: 'SELECT data_json, updated_at FROM user_state WHERE code = ?',
        args: [code],
    });
    if (result.rows.length === 0) {
        return c.json({ data: null, updatedAt: null });
    }
    const row = result.rows[0];
    return c.json({ data: JSON.parse(row.data_json), updatedAt: row.updated_at });
});

// PUT /api/state — upsert a user state blob (rate-limited, 64KB cap).
app.put('/api/state', async (c) => {
    const rawBody = await c.req.text();
    const bytes = payloadByteLength(rawBody);
    c.set('bytes', bytes);
    if (bytes > 65536) {
        return c.json({ error: 'payload too large' }, 413);
    }
    let body;
    try {
        body = JSON.parse(rawBody);
    } catch (_e) {
        return c.json({ error: 'malformed body' }, 400);
    }
    if (!validateCode(body.code) || !body.data || typeof body.updatedAt !== 'number') {
        return c.json({ error: 'invalid body' }, 400);
    }
    c.set('code', body.code);
    const db = getDb(c.env);
    const ip = c.get('ip');
    const rl = await checkAndIncrement(db, ip);
    if (!rl.allowed) {
        c.header('Retry-After', String(rl.resetInSeconds));
        return c.json({ error: 'rate limited' }, 429);
    }
    await db.execute({
        sql: 'INSERT INTO user_state (code, data_json, updated_at, bytes) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, bytes = excluded.bytes',
        args: [body.code, JSON.stringify(body.data), body.updatedAt, bytes],
    });
    return c.body(null, 204);
});

// DELETE /api/state — idempotent delete; always 204 on valid input.
app.delete('/api/state', async (c) => {
    const rawBody = await c.req.text();
    let body;
    try {
        body = JSON.parse(rawBody);
    } catch (_e) {
        return c.json({ error: 'malformed body' }, 400);
    }
    if (!validateCode(body.code)) {
        return c.json({ error: 'invalid code' }, 400);
    }
    c.set('code', body.code);
    await getDb(c.env).execute({
        sql: 'DELETE FROM user_state WHERE code = ?',
        args: [body.code],
    });
    return c.body(null, 204);
});

export default app;
