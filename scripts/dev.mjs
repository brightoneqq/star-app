// Local dev shim: minimal .env loader + http <-> Hono fetch bridge + static-file fallback.
// ESM, stdlib-only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../server/app.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.woff2': 'font/woff2',
};

// ---- .env loader (no dotenv dep) ----
if (fs.existsSync('.env')) {
    const raw = fs.readFileSync('.env', 'utf8');
    const lines = raw.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

const env = {
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
};

const server = http.createServer(async (req, res) => {
    if (req.url && req.url.startsWith('/api/')) {
        try {
            // Buffer request body for non-GET/HEAD methods.
            let body;
            const method = (req.method || 'GET').toUpperCase();
            if (method === 'GET' || method === 'HEAD') {
                body = undefined;
            } else {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                body = chunks.length ? Buffer.concat(chunks) : undefined;
            }

            const request = new Request('http://' + req.headers.host + req.url, {
                method: req.method,
                headers: req.headers,
                body: body,
                duplex: 'half',
            });

            const response = await app.fetch(request, env, undefined);

            res.statusCode = response.status;
            response.headers.forEach((v, k) => res.setHeader(k, v));
            res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain');
            res.end('dev bridge error: ' + (err && err.message ? err.message : String(err)));
        }
        return;
    }

    // Static-file fallback.
    let urlPath = req.url || '/';
    const qIdx = urlPath.indexOf('?');
    if (qIdx >= 0) urlPath = urlPath.slice(0, qIdx);
    if (urlPath === '/') urlPath = '/index.html';

    const segments = urlPath.split('/');
    for (const seg of segments) {
        if (seg === '..') {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('bad path');
            return;
        }
    }

    const filePath = path.join(repoRoot, urlPath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('not found');
                return;
            }
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('internal server error');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

const port = process.env.PORT || 8000;
server.listen(port, () => console.log('[dev] listening on http://localhost:' + port));
