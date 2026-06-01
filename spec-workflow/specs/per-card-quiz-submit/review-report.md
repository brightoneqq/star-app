# Code Review Report — per-card-quiz-submit

## Executive Summary

| | |
|---|---|
| **Feature** | per-card-quiz-submit |
| **Assessment** | **APPROVED** |
| **Review Mode** | GIT_DIFF (working tree vs HEAD `a86ec54`) |
| **Scope** | All changed files |
| **Files reviewed** | 2 source files (+148 / -3) |
| **Critical** | 0 |
| **Important** | 0 |
| **Minor** | 2 (observations, non-blocking) |
| **Empirical verification** | 26/26 Playwright checks PASS |

Zero blocking issues. The diff is surgical, ES5-strict, and faithful to the design. The two minor notes below are observations, not defects.

## Files Reviewed

| File | Lines | Notes |
|---|---|---|
| `js/unit-enhance.js` | +124 / -3 | gradeScope refactor + badge helpers + per-card submit + setMode hooks + DOMContentLoaded init |
| `style/unit-enhance.css` | +27 / -0 | per-card submit + score-badge styles, all via existing tokens |

## Convention Compliance

| Rule | Status | Evidence |
|---|---|---|
| ES5 only (no `const/let/=>/template-literal/Promise/import`) | ✅ | `grep` returns 0 hits |
| Storage via `MyStar.readNumber` / `writeNumber` only | ✅ | 0 raw `localStorage` / `document.cookie` references in diff |
| Tap wiring via `MyStar.addTapListener` only | ✅ | 0 raw `click` listeners; `addTapListener` used at `js/unit-enhance.js:84` |
| Colors via existing tokens; no new hex | ✅ | Only `var(--accent-*-soft)` etc. The single `rgba(30,95,184,0.18)` is `#1E5FB8` (= `--accent-navy`) with alpha — explicitly permitted by `colors.md` rule #6 for unit-page soft shadows |
| No `border-left` decoration | ✅ | No `border-left` in CSS diff |
| No edits outside `js/unit-enhance.js` + `style/unit-enhance.css` | ✅ | `git status` shows only these 2 source files modified |
| `quizScore_<slug>` aggregate semantics unchanged | ✅ | `KEY_SCORE` (= `'quizScore_' + SLUG`) is still only written by the unit-level submit handler at `js/unit-enhance.js:267`. Per-card path writes `quizScore_<slug>_<cardId>` (a different key) |

## Design Alignment Check

| Design decision | Verified |
|---|---|
| Single grading function `gradeScope(scopeEl)` with `byCard` only when `scopeEl === document` | ✅ `js/unit-enhance.js:142` and `:174` |
| ES5 ancestor lookup helper (no `Element.closest`) | ✅ `closestVocabCardWithId` at `js/unit-enhance.js:133` |
| `gradeQuiz()` preserved as a thin wrapper for backward compat | ✅ `js/unit-enhance.js:191` |
| Per-card submit at card bottom, independent row | ✅ `js/unit-enhance.js:82` appends to `cardEl`; CSS `justify-content: flex-end` |
| Badge prepended in `.card-actions` | ✅ `js/unit-enhance.js:218` `actions.insertBefore(badge, actions.firstChild)` |
| Badge tier thresholds 80 / 60 | ✅ `tierForScore` at `js/unit-enhance.js:208` |
| Unit-level submit re-grades AND overwrites per-card scores using `byCard` (single pass) | ✅ `js/unit-enhance.js:269-275` |
| `banner-retry` handler left untouched (R6#2) | ✅ `showBanner` is not in the diff |

## Requirements Traceability

| Req | Status | Implementing code |
|---|---|---|
| R1 — per-card button injection | ✅ COVERED | `injectCardSubmitButtons` (`js/unit-enhance.js:74`), setMode hook (`:278`) |
| R2 — scoped grading, no banner, no cross-card effect | ✅ COVERED | `gradeScope(cardEl)` (`:142`), per-card handler (`:85-92`) — no `showBanner` call |
| R3 — `quizScore_<slug>_<cardId>` persistence, no per-card timestamp | ✅ COVERED | `js/unit-enhance.js:87` writes the per-card score; no `quizTime_*_card*` write anywhere |
| R4 — `上次 N%` badge with tier colors, visible in both modes | ✅ COVERED | `updateCardBadge` (`:215`), `renderInitialCardBadges` (`:227`), tier CSS (`style/unit-enhance.css:205-207`) |
| R5 — unit-level overwrite via `byCard` map | ✅ COVERED | `js/unit-enhance.js:269-275` |
| R6#1 — mode switch cleanup | ✅ COVERED | `removeCardSubmitButtons` (`:96`), setMode review branch (`:283`) |
| R6#2 — banner-retry preserves stored scores | ✅ COVERED | `showBanner` not modified; original `resetQuizInputs()`-only behavior preserved |
| R6#3 — per-card submit re-tappable | ✅ COVERED | Handler is idempotent; `updateCardBadge` updates badge in place |
| R7 — backward compat of `quizScore_<slug>` | ✅ COVERED | Aggregate key write at `:267` is unchanged from pre-diff line `M.writeNumber(KEY_SCORE, result.score);` |

## Strengths

1. **Surgical scope** — exactly 2 source files touched, +148/-3. Nothing else in the repo moves.
2. **ES5 strictness extends beyond what was strictly necessary** — `closestVocabCardWithId` (`js/unit-enhance.js:133`) deliberately avoids `Element.closest` for the iPad target. The new iteration paths (`renderInitialCardBadges`, `injectCardSubmitButtons`, `removeCardSubmitButtons`) use `Array.prototype.forEach.call(...)` rather than `NodeList.forEach`, which is more defensive than even the pre-existing `gradeScope` code.
3. **Single-pass per-card aggregation** — `gradeScope(document)` produces `byCard` during the same input walk it uses for the aggregate. The unit-level submit handler then consumes `byCard` for both persistence and badge refresh without a second `gradeScope` pass. Clean separation: `writePerCardScores` lives inline in the handler (1 loop), `refreshAllCardBadges` is a pure UI helper.
4. **Idempotency everywhere** — `injectCardSubmitButtons` early-returns if the wrap exists (`:77`); `updateCardBadge` updates a found badge in place rather than appending; `removeCardSubmitButtons` null-guards `parentNode` (`:99`).
5. **Defensive read path** — `renderInitialCardBadges` guards both `s !== null` AND `!isNaN(s)` (`:231`), so a corrupted or non-numeric stored value silently degrades to "no badge" rather than rendering `上次 NaN%`.
6. **Aggregate key untouched** — the per-card write path uses `'quizScore_' + SLUG + '_' + cardEl.id`, never `KEY_SCORE`. Existing homepage stats query (`quizScore_<slug>`) keeps its meaning. R7 backward compat is materially preserved, not just claimed.
7. **Consistent badge color tiers tied to existing tokens** — `tier-high` / `tier-mid` / `tier-low` mapped to `--accent-green*` / `--accent-amber*` / `--neutral-gray-soft` + `--text-secondary` (`style/unit-enhance.css:205-207`). No new hex.

## Findings

### Critical (0)

_None._

### Important (0)

_None._

### Minor (2)

#### Minor-1 — Same-name `var` reused in `gradeScope`
- **File:line** — `js/unit-enhance.js:167` and `:179`
- **Category** — STYLE
- **Description** — Inside `gradeScope`, `var cid = cardEl.id;` is declared in the `inputs.forEach` callback, and `for (var cid in byCard)` is declared again in the same function scope. JavaScript hoists `var` to function scope, so both refer to the same binding — functionally harmless, but slightly noisy to a reader who isn't tracking hoisting.
- **Impact** — None (semantics are correct). Stylistic only.
- **Suggested fix** — Rename one (e.g. `var cardId = cardEl.id;` in the inner block). Defer if you prefer to minimize diff churn.

#### Minor-2 — Two writes of the same per-card key from one unit submit
- **File:line** — `js/unit-enhance.js:269-275`
- **Category** — OPTIMIZATION
- **Description** — The unit-submit handler iterates `result.byCard` once to call `M.writeNumber(...)`, then calls `refreshAllCardBadges(result.byCard)` which iterates the same map again to call `updateCardBadge`. Two passes over the same ~32-entry object. Could be fused into one pass (`refreshAllCardBadges` could also write the score), at the cost of mixing storage + UI concerns in one helper.
- **Impact** — Negligible. ~32 entries, sync localStorage writes are µs-scale. The cleaner separation of concerns (write vs. render) is arguably worth the second loop.
- **Suggested fix** — Leave as-is. Recording this only so future readers know it was a conscious choice.

## Security Review

Not applicable in any meaningful sense — the app has no auth, no network, no user-supplied URLs, no `innerHTML` writes with user data. All new DOM is built with `textContent` (`:84`, `:223`) and `document.createElement` (`:80`, `:81`, `:219`). No XSS vector introduced.

## Performance Considerations

- `renderInitialCardBadges` runs once on load, reads localStorage once per `.vocab-card[id]` (~32 reads on u3). µs-scale. Acceptable.
- `gradeScope(document)` adds per-input `closestVocabCardWithId` ancestor walks. On u3, ~195 inputs × ~5 parentNode steps = trivial. Acceptable.
- Per-card submit grades exactly the inputs in one `.vocab-card` (typically 3–10). No measurable cost.

## Empirical Verification

Cross-referenced against the Playwright run earlier in this session:

- 1 (review-mode fresh load): 0 visible per-card buttons, 0 badges, no console errors → matches design.
- 2 (quiz mode): 32 per-card buttons injected, unit-level submit still present.
- 3 (per-card submit on card 1): card 1 annotated with `.correct`/`.wrong` + 5 hints + badge `上次 17%` (`tier-low`); card 2 inputs untouched, no badge; no top banner; `quizScore_u3_vocab-card-1='17'`; `quizScore_u3=null` (R7 backward compat).
- 4 (unit-level submit): banner shown; all 32 cards have badges; `quizScore_u3='1'`, `quizTime_u3` set, `quizScore_u3_vocab-card-2='9'` (overwrite confirmed).
- 5 (mode switch + reload): submit buttons hidden in review, badges remain, reload renders 32 badges immediately.

All 26 individual assertions PASS. No empirical contradiction to the static review.

## Next Steps

**APPROVED** — no blocking issues. Proceeding directly to commit + push as requested by the user.
