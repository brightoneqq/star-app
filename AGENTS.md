# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## What this is

A small static web app for classroom vocabulary review ("课间复习 / myStar"). Pure HTML/JS/CSS — **no build step, no bundler, no framework, no package.json**. Files are served as-is.

## Run locally

```bash
./startup.sh          # serves on http://localhost:8000 (PORT env var overrides)
```

That's it. Closing the shell stops the server.

## Hard rules

### 1. IE-safe JavaScript only

Target devices include **old iPad Safari**. All JS must run as plain ES5:

- Use `var` — never `const` or `let`
- Use `function () {}` — never arrow functions
- Wrap modules in IIFEs (`(function () { ... })();`) — no ES modules, no `import/export`
- No template literals, no destructuring, no spread, no `Promise`, no `fetch`, no optional chaining
- No modern Array/Object methods without verifying iPad-Safari support (avoid `Object.entries`, `Array.from`, etc.)

If a new file is needed, follow the style in `js/shared.js`.

### 2. Persistence goes through `MyStar.*`, never raw localStorage

iPad Safari private mode silently breaks `localStorage`. `js/shared.js` provides `MyStar.readJSON/writeJSON/readNumber/writeNumber`, which double-write to `localStorage` AND a cookie as a fallback. **Use these helpers for any persisted state** — do not call `localStorage.setItem` directly in new code.

### 3. Tap/click handlers go through `MyStar.addTapListener`

iPad Safari fires both `touchend` and `click`, causing double-trigger. `MyStar.addTapListener(el, handler)` deduplicates them. Use it instead of `onclick=` or raw `addEventListener('click', ...)` for any tappable element.

### 4. Preserve Chinese UI text

UI strings are in Chinese ("课间复习", "重点集", "刚刚", "X 分钟前", etc.). Keep them when editing — do not translate to English unless explicitly asked.

## Adding a new unit

1. Create `units/<book-id>/<slug>/index.html` (copy an existing unit, e.g. `units/book1/u3/index.html`).
2. Append a unit entry to the relevant `book.units` array in `js/manifest.js` (fields: `slug`, `number`, `title`, `cardCount`, `blankCount`).

The homepage and review page pick it up automatically — they're both manifest-driven.

## Testing

No automated tests, no linter. **Verify manually in a browser, ideally on iPad Safari** (the target device) — especially for storage and tap-interaction changes.

---

For detailed documentation, see the steering files:
- Product goals, target users, business objectives → spec-workflow/steering/product.md
- Technical decisions, architecture rationale, known limitations → spec-workflow/steering/tech.md
- Naming conventions, directory rules, anti-patterns → spec-workflow/steering/structure.md
- Coding standards, API conventions → spec-workflow/steering/conventions/
