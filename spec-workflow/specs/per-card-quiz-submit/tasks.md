# Implementation Plan

## Task Overview

All changes are confined to two files — `style/unit-enhance.css` (new selectors only) and `js/unit-enhance.js` (additions inside the existing IIFE plus one refactor of `gradeQuiz`). No new globals, no new files, no HTML edits, no homepage/review-page edits. Each task is independently executable and verifiable by opening `units/book1/u3/index.html` in a browser.

## Steering Document Compliance

- All JS additions live in `js/unit-enhance.js` per `structure.md` ("Shared behavior loaded by individual Unit pages"). All CSS in `style/unit-enhance.css` ("Unit-page-only tweaks").
- Storage exclusively via `MyStar.readNumber` / `MyStar.writeNumber`; tap wiring via `MyStar.addTapListener` (per `tech.md`). ES5 only — `var`, `function`, `Array.prototype.forEach`. No `const/let/arrow/template-literal/Promise/import`.
- All colors use existing tokens from `conventions/colors.md` (no new hex, no `border-left` decoration).
- New storage key follows the `_<slug>` suffix pattern, extended once with `_<cardId>`. Existing `quizScore_<slug>` semantics unchanged.

## Tasks

- [X] 1. Add per-card-submit and score-badge styles to `style/unit-enhance.css`
    - File: `style/unit-enhance.css` (append at end of file, after the existing `.quiz-banner` block)
    - Add `.quiz-card-submit-wrap { display: flex; justify-content: flex-end; margin-top: 12px; }` and `body:not(.quiz-mode) .quiz-card-submit-wrap { display: none; }`.
    - Add `.quiz-submit.quiz-submit--card { padding: 8px 18px; font-size: 0.9rem; box-shadow: 0 4px 12px rgba(30, 95, 184, 0.18); }` (compact variant; inherits navy CTA from `.quiz-submit`).
    - Add `.card-score-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 600; margin-right: 8px; }` and three tier classes:
      - `.card-score-badge.tier-high { background: var(--accent-green-soft); color: var(--accent-green); }`
      - `.card-score-badge.tier-mid  { background: var(--accent-amber-soft); color: var(--accent-amber); }`
      - `.card-score-badge.tier-low  { background: var(--neutral-gray-soft); color: var(--text-secondary); }`
    - Purpose: Provide the visual layer for per-card submit + score badge without touching JS.
    - _Leverage: existing `.quiz-submit` rule at `style/unit-enhance.css:122`; existing color tokens declared in `style/shared.css :root`_
    - _Requirements: R1#5, R4#5_

- [X] 2. Refactor `gradeQuiz` into `gradeScope(scopeEl)` returning a `byCard` map
    - File: `js/unit-enhance.js` (replace `gradeQuiz` at lines 104–128)
    - Rename the function body to `function gradeScope(scopeEl)`. Read inputs via `scopeEl.querySelectorAll('.quiz-input')` instead of `document.querySelectorAll('.quiz-input')`. Keep all grading/feedback logic identical.
    - When `scopeEl === document`, build a `byCard` object as you iterate: for each input, find `inp.closest('.vocab-card')` (use a small ES5 helper if `closest` is unavailable on the iPad target — walk `parentNode` chain). If the ancestor card has a non-empty `id`, accumulate `{ correct, total }` under that id. After the loop, compute each entry's `score = total > 0 ? Math.round(correct/total*100) : 0`.
    - Return `{ score, correct, total, byCard }`. Set `byCard = null` when `scopeEl !== document`.
    - Add a thin wrapper `function gradeQuiz() { return gradeScope(document); }` so the existing call site at line 159 keeps working unchanged.
    - Purpose: Single grading function used by both unit-level and per-card paths; produces the `byCard` map that downstream steps consume without a second walk.
    - _Leverage: `MyStar.isAnswerCorrect` (js/shared.js:49); existing `.quiz-input` / `.quiz-hint` mutation logic_
    - _Requirements: R2#1, R2#2, R2#3, R2#4, R7#1, R7#2 (wrapper preserves all existing call-site behavior)_

- [X] 3. Add badge helpers: `tierForScore`, `updateCardBadge`, `renderInitialCardBadges`, `refreshAllCardBadges`
    - File: `js/unit-enhance.js` (insert as a new section between the existing `// ---------- Quiz input lifecycle ----------` block and the `// ---------- Mode switching ----------` block, i.e. just below `gradeScope`)
    - `function tierForScore(score)` — returns `'tier-high'` for `score >= 80`, `'tier-mid'` for `60 <= score < 80`, `'tier-low'` otherwise.
    - `function updateCardBadge(cardEl, score)` — find or create a `span.card-score-badge` inside `cardEl.querySelector('.card-actions')`, inserted as the **first child** of `.card-actions` (before existing `.btn-star` / `.btn-card-toggle`). Set `span.className = 'card-score-badge ' + tierForScore(score)` and `span.textContent = '上次 ' + score + '%'`. Idempotent: re-call with a new score updates text and class in place.
    - `function renderInitialCardBadges()` — for each `cardEl` in `document.querySelectorAll('.vocab-card[id]')`, read `MyStar.readNumber('quizScore_' + SLUG + '_' + cardEl.id)`; if non-null, call `updateCardBadge(cardEl, score)`. Cards without a stored score get **no** badge (no placeholder rendered).
    - `function refreshAllCardBadges(byCard)` — for each key in `byCard`, find `document.getElementById(key)` and call `updateCardBadge(cardEl, byCard[key].score)`. Does not re-grade.
    - Purpose: Encapsulate badge DOM and tier logic in one place; both load-time and submit-time paths converge here.
    - _Leverage: `MyStar.readNumber` (js/shared.js:28); existing `.card-actions` DOM (`units/book1/u3/index.html:289`)_
    - _Requirements: R4#1, R4#2, R4#3, R4#5, R4#6_

- [X] 4. Add per-card submit inject / remove with grading handler
    - File: `js/unit-enhance.js` (insert two new functions in the `// ---------- DOM injection ----------` section, after the existing `removeQuizUi` at line 67)
    - `function injectCardSubmitButtons()` — iterate `document.querySelectorAll('.vocab-card[id]')`. For each `cardEl`: skip if `cardEl.querySelector('.quiz-card-submit-wrap')` already exists (idempotent); skip if `cardEl.querySelectorAll('.blank').length === 0`. Otherwise build `<div class="quiz-card-submit-wrap"><button class="quiz-submit quiz-submit--card">提交本卡</button></div>`, append it as the last child of `cardEl`, then wire the button with `MyStar.addTapListener` to a handler that calls `gradeScope(cardEl)`, writes `MyStar.writeNumber('quizScore_' + SLUG + '_' + cardEl.id, result.score)`, and calls `updateCardBadge(cardEl, result.score)`. The handler must NOT call `showBanner` and must NOT touch `quizScore_<slug>` / `quizTime_<slug>`.
    - `function removeCardSubmitButtons()` — `document.querySelectorAll('.quiz-card-submit-wrap').forEach(function (el) { el.parentNode.removeChild(el); });`
    - Purpose: Per-card submit lifecycle and grading wiring in one self-contained pair, matching the existing `injectSubmitButton` / `removeQuizUi` pattern.
    - _Leverage: `MyStar.addTapListener` (js/shared.js:60), `MyStar.writeNumber` (js/shared.js:36); patterns from existing `injectSubmitButton` (js/unit-enhance.js:56) and `removeQuizUi` (js/unit-enhance.js:67); `gradeScope` and `updateCardBadge` from tasks 2 and 3_
    - _Requirements: R1#1, R1#2, R1#3, R1#4, R2#1, R2#5, R2#6, R3#1, R3#2, R3#3, R3#4, R3#5, R6#3_

- [X] 5. Hook into `setMode` and the unit-level submit handler
    - File: `js/unit-enhance.js` (modify `setMode` at lines 143–169)
    - In the `if (mode === 'quiz')` branch, after the existing `injectSubmitButton` + tap-listener block, add a call to `injectCardSubmitButtons()`.
    - In the `else` (review) branch, add `removeCardSubmitButtons()` alongside the existing `removeQuizUi()` call.
    - In the unit-level submit tap handler (currently the inline `function () { var result = gradeQuiz(); ... }` at lines 158–163), after the existing `M.writeNumber(KEY_SCORE, result.score)` + `M.writeNumber(KEY_QTIME, Date.now())` lines, add: (a) write per-card scores — `if (result.byCard) { for (var cid in result.byCard) { if (Object.prototype.hasOwnProperty.call(result.byCard, cid)) { M.writeNumber('quizScore_' + SLUG + '_' + cid, result.byCard[cid].score); } } }`; (b) call `refreshAllCardBadges(result.byCard || {})`. The existing `showBanner(result)` call stays — banner still shows for the unit-level submit.
    - Purpose: Wire the new lifecycle calls and the per-card persistence/badge refresh into the existing mode/submit flow without restructuring it.
    - _Leverage: existing `setMode` switch (js/unit-enhance.js:143), existing unit-level submit handler wiring (js/unit-enhance.js:158); functions from tasks 2, 3, 4. Do NOT modify the existing `banner-retry` handler in `showBanner` (js/unit-enhance.js:135) — its `resetQuizInputs()`-only behavior preserves R6#2._
    - _Requirements: R1#1, R1#3, R5#1, R5#2, R5#3, R5#4, R5#5, R6#1, R6#2 (untouched by design), R7#3 (no homepage/review edits)_

- [X] 6. Render initial badges on page load
    - File: `js/unit-enhance.js` (modify the `DOMContentLoaded` handler at lines 172–181)
    - After the existing `injectTopBar()` call, add `renderInitialCardBadges();`. Keep the rest of the handler (the `M.writeNumber(KEY_LAST, …)` call and the mode-tab wiring) unchanged.
    - Purpose: Show last-score badges immediately when the unit page opens, in both review and quiz mode.
    - _Leverage: `renderInitialCardBadges` from task 3; existing `DOMContentLoaded` entry (js/unit-enhance.js:172)_
    - _Requirements: R4#1, R4#2, R4#6_
