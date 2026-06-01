// Pure validators consumed by route handlers for 400 / 413 decisions.

export function validateCode(code) {
    // Charset constrained to match EdgeOne KV key rules (alphanumeric + underscore only — no `-`).
    return typeof code === 'string' && /^[a-zA-Z0-9_]{6,16}$/.test(code);
}

export function payloadByteLength(rawBodyString) {
    return new TextEncoder().encode(rawBodyString).byteLength;
}
