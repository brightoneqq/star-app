// EdgeOne KV binding accessor for Pages Functions.
// The namespace is bound to the project as `env.MYSTAR_KV` in the EdgeOne
// console (KV namespace name: "star"). No external service; reachable from
// any edge node in the same platform with no cross-region latency.
//
// Surface used by server/app.js:
//   kv.get(key, "json")  → returns parsed object or null
//   kv.put(key, str)     → writes string value
//   kv.delete(key)       → idempotent delete
//
// EdgeOne KV is eventually consistent across edge nodes (up to ~60s); see
// design.md for why this is acceptable for the single-student threat model.
export function getKv(env) {
    if (!env || !env.MYSTAR_KV) {
        throw new Error('MYSTAR_KV binding missing — check EdgeOne Pages KV namespace binding');
    }
    return env.MYSTAR_KV;
}
