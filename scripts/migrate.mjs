// Idempotent migration runner for Turso (libSQL).
// Reads migrations/*.sql in filename-sorted order, splits on `;`, and applies
// each statement. CREATE TABLE/INDEX IF NOT EXISTS execute directly; ALTER
// TABLE ADD COLUMN is guarded with a PRAGMA table_info check (libSQL has no
// IF NOT EXISTS for ADD COLUMN). All other statements execute as-is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (typeof url !== 'string' || url.length === 0 ||
    typeof authToken !== 'string' || authToken.length === 0) {
    console.error('[migrate] missing env');
    process.exit(1);
}

const RE_CREATE_TABLE = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i;
const RE_CREATE_INDEX = /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i;
const RE_ALTER_ADD_COLUMN = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i;

function stmtPrefix(stmt) {
    const oneLine = stmt.replace(/\s+/g, ' ').trim();
    return oneLine.length > 60 ? oneLine.slice(0, 60) + '...' : oneLine;
}

async function run() {
    const db = createClient({ url, authToken });

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .sort();

    for (const file of files) {
        const body = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        const statements = body
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

        for (const stmt of statements) {
            if (RE_CREATE_TABLE.test(stmt) || RE_CREATE_INDEX.test(stmt)) {
                await db.execute(stmt);
                console.log('[migrate] applied ' + file);
                continue;
            }

            const alterMatch = stmt.match(RE_ALTER_ADD_COLUMN);
            if (alterMatch) {
                const table = alterMatch[1];
                const column = alterMatch[2];
                const info = await db.execute('PRAGMA table_info(' + table + ')');
                const exists = info.rows.some((row) => row.name === column);
                if (exists) {
                    console.log('[migrate] skipped ' + file + ' ' + stmtPrefix(stmt));
                } else {
                    await db.execute(stmt);
                    console.log('[migrate] applied ' + file);
                }
                continue;
            }

            await db.execute(stmt);
            console.log('[migrate] applied ' + file);
        }
    }
}

run().catch((err) => {
    console.error('[migrate] error', err && err.message ? err.message : err);
    process.exit(1);
});
