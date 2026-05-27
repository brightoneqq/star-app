# Structure

## Directory layout

```
star-app/
├── index.html              # Homepage: lists books → units with per-unit stats
├── startup.sh              # Local server launcher (python3 http.server, port 8000)
├── README.md
├── AGENTS.md               # AI coding guide
├── js/
│   ├── manifest.js         # window.MYSTAR_MANIFEST — single source of truth for content tree
│   ├── shared.js           # MyStar.* utilities (storage, tap, time, answer matching)
│   └── unit-enhance.js     # Shared behavior loaded by individual Unit pages
├── style/
│   ├── shared.css          # Homepage + review page styles
│   └── unit-enhance.css    # Unit-page-specific styles
├── review/
│   └── index.html          # "重点集" — aggregates starred cards across units
├── units/
│   └── <book-id>/<slug>/
│       └── index.html      # One file per unit; references ../../../js + ../../../style
└── spec-workflow/          # Steering + spec docs (this directory)
```

## Naming conventions

- **Book IDs**: lowercase, no separator, like `book1`. Used as a directory name and the `id` field in manifest.
- **Unit slugs**: lowercase, terse, like `u3`, `u6`. Used as a directory name and the `slug` field in manifest.
- **Storage keys**: suffix with the unit slug — `starredCards_<slug>`, `lastVisit_<slug>`, `quizScore_<slug>`. Keep this pattern so the homepage stats query works.
- **CSS classes**: kebab-case (`unit-row`, `book-group`, `btn-pill`). Match existing naming when extending.
- **JS globals**: namespaced under `window.MyStar` (utilities) or `window.MYSTAR_MANIFEST` (data). Do not pollute the global scope with anything else — wrap module code in IIFEs.

## Where things go

- **A new utility function** used by multiple pages → add to `js/shared.js` under `W.MyStar`.
- **A new piece of persisted state** → use `MyStar.readJSON/writeJSON` with a key suffixed by `_<slug>` (or unsuffixed if global).
- **A new unit** → `units/<book>/<slug>/index.html` + entry in `js/manifest.js` (see AGENTS.md).
- **A new book** → new entry in `MYSTAR_MANIFEST.books` with its own `units` array; mirror the directory structure under `units/<book-id>/`.
- **Shared style tweaks** → `style/shared.css`. Unit-page-only tweaks → `style/unit-enhance.css`.

## Anti-patterns to avoid

- ❌ Raw `localStorage.setItem` / `localStorage.getItem` — always go through `MyStar.*` (iPad Safari private mode breaks plain localStorage).
- ❌ `onclick=` or raw `click` listeners on tappable elements — use `MyStar.addTapListener` (iPad fires both touchend and click).
- ❌ `const`, `let`, arrow functions, template literals, ES modules — see AGENTS.md for the full list. ES5 only.
- ❌ Adding npm/yarn/pnpm, a bundler, or any build step — the project is intentionally buildless.
- ❌ Adding third-party JS/CSS dependencies — every dep risks breaking the old-iPad target. Reach for vanilla JS first.
- ❌ Translating Chinese UI strings to English without being asked.
- ❌ Hard-coding unit lists in HTML — drive everything from `js/manifest.js`.
