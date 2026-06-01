// Edge-safe per-IP write rate limiter backed by a Turso table.
// In-memory counters would be per-instance and useless across edge nodes,
// so we use a single INSERT ... ON CONFLICT ... RETURNING round trip to
// atomically increment the (ip, window_minute) counter.

const LIMIT_PER_MINUTE = 30;

export async function checkAndIncrement(db, ip) {
    const windowMinute = Math.floor(Date.now() / 60000);

    const result = await db.execute({
        sql: 'INSERT INTO rate_limit (ip, window_minute, count) VALUES (?, ?, 1) ON CONFLICT(ip, window_minute) DO UPDATE SET count = count + 1 RETURNING count',
        args: [ip, windowMinute],
    });

    // libsql `rows[0]` is an array-like with named accessors; `count` is the
    // only selected column.
    const row = result.rows[0];
    const count = Number(row.count);

    const allowed = count <= LIMIT_PER_MINUTE;
    let resetInSeconds = 0;
    if (!allowed) {
        const remainingMs = 60000 - (Date.now() % 60000);
        resetInSeconds = Math.max(1, Math.floor(remainingMs / 1000));
    }

    // Opportunistic GC: ~2% of calls sweep counters from prior minutes.
    // Failures must not break the request, so we swallow them.
    if (Math.random() < 0.02) {
        try {
            await db.execute({
                sql: 'DELETE FROM rate_limit WHERE window_minute < ?',
                args: [windowMinute - 1],
            });
        } catch (_e) {
            // GC failure is non-fatal — the limiter still works.
        }
    }

    return { allowed, count, resetInSeconds };
}
