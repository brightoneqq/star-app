// Hono app for EdgeOne Pages Functions. KV-backed user-state storage.
// Routes: /api/health, GET/PUT/DELETE /api/state.
//
// Storage = EdgeOne KV bound to env.MYSTAR_KV (namespace "star").
// Value shape per code: { data: {...flat MyStar keys...}, updatedAt, bytes }.
// No SQL, no migrations, no per-IP rate-limit table (EdgeOne platform handles
// abuse at the WAF layer; single-student threat model accepts no app-level
// rate limit for v1 — see design.md and steering/tech.md).
import { Hono } from 'hono';
import { getKv } from './db.js';
import { validateCode, payloadByteLength } from './validators.js';

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

// GET /api/state?code=... — read a user state blob from KV.
app.get('/api/state', async (c) => {
    const code = c.req.query('code');
    if (!validateCode(code)) {
        return c.json({ error: 'invalid code' }, 400);
    }
    c.set('code', code);
    const kv = getKv(c.env);
    const stored = await kv.get(code, 'json');
    if (!stored) {
        return c.json({ data: null, updatedAt: null });
    }
    return c.json({ data: stored.data, updatedAt: stored.updatedAt });
});

// PUT /api/state — upsert a user state blob (64KB cap).
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
    const kv = getKv(c.env);
    const value = JSON.stringify({
        data: body.data,
        updatedAt: body.updatedAt,
        bytes,
    });
    await kv.put(body.code, value);
    return c.body(null, 204);
});

// DELETE /api/state — idempotent delete; always 204 on valid code.
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
    await getKv(c.env).delete(body.code);
    return c.body(null, 204);
});

export default app;
