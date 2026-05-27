# Tech

## Stack

- **HTML / CSS / vanilla JavaScript (ES5)** — no framework, no bundler, no transpiler.
- **Python `http.server`** — used by `startup.sh` for local serving on port 8000.
- That's the entire stack.

## Architectural decisions

### Plain static files, no build step
Files are served as-is. Edit, refresh, done. This keeps the project trivially portable (any static host or local Python server works) and removes a class of tooling churn that's not worth it for the project's scale.

### ES5 / "IE-safe" JS
The deployment target is an **old iPad running an old Safari**. Modern syntax (`const/let`, arrow functions, template literals, `Promise`, ES modules) is avoided everywhere — not as a stylistic choice but because it would break on the target device. See `js/shared.js` as the canonical example.

### Storage: localStorage + cookie double-write
`localStorage` silently fails on iPad Safari in private mode. `js/shared.js` writes every key to both `localStorage` and a long-lived cookie, and reads from `localStorage` first, falling back to the cookie. **All persisted state must go through `MyStar.readJSON / writeJSON / readNumber / writeNumber`** — never raw `localStorage`.

### Tap interactions: touchend + click with dedup
iPad Safari fires both `touchend` and `click` for the same tap, causing double-triggers. `MyStar.addTapListener` listens to both with a `touchHandled` flag to dedupe, and ignores taps that became scrolls (`touchmove`). Use this helper for any tappable element.

### Manifest-driven content
`js/manifest.js` declares the full book → unit hierarchy as a single `window.MYSTAR_MANIFEST` object. The homepage and the starred-set page both render from this manifest. Adding a unit is "write HTML + append one manifest entry".

## Known limitations / gotchas

- **No tests, no linter.** Verification is manual — open in a browser. iPad Safari is the device that matters; what works in desktop Chrome may not work there.
- **No cross-device sync.** Wiping browser data wipes all progress.
- **Cookie size budget.** Storing large objects via `MyStar.writeJSON` bloats cookies (4KB-per-cookie limit). Keep stored values small (lists of card IDs, scores, timestamps — not full card content).
- **Quiz answer matching is lenient by design.** Trailing `.,!?。，！？；;` are stripped and `/` separates accepted variants — be mindful when authoring blank answers.

## External dependencies

None. Zero third-party JS or CSS. Do not introduce dependencies without an explicit reason — every dep risks breaking the old-iPad target.
