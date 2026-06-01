# Requirements Document

## Introduction

Today the quiz mode on a unit page grades **every blank in the unit at once**: the student fills in dozens of inputs, scrolls to the bottom, taps "提交并查看结果", and the entire unit gets a single score (`quizScore_<slug>`). For a student practicing one vocabulary card at a time, this is too coarse — they want to verify a single card before moving on, without committing to (and biasing) the rest of the unit.

This feature adds **per-card submit/grading** alongside the existing unit-level submit. Each `.vocab-card` gets its own "提交本卡" button in quiz mode; tapping it grades only that card's blanks, persists a card-scoped score, and shows a "上次 N%" badge in the card header on subsequent visits. The unit-level "提交并查看结果" continues to work and remains the authoritative source for the aggregate `quizScore_<slug>` shown on the homepage.

The per-card score keys (`quizScore_<slug>_<cardId>`) are designed to be addressable: future features (card-level mastery, weakest-card review, spaced repetition) can read them without further schema changes.

## Alignment with Product Vision

This feature is squarely on the product vision in `steering/product.md`:

- **"Per-unit progress"** is extended into per-card progress without breaking the existing per-unit signal. `quizScore_<slug>` and the homepage stats continue to behave exactly as today.
- **"Lenient quiz matching"** is reused as-is via `MyStar.isAnswerCorrect`; no grading logic changes.
- **Single-student, old-iPad, no-build** constraints (`steering/tech.md`) are respected: vanilla ES5, `MyStar.writeNumber` for storage (no raw `localStorage`), `MyStar.addTapListener` for the button, no new dependencies, no new global keys outside the documented `_<slug>` suffix convention (`steering/structure.md`).
- **Cookie size budget** is the reason per-card *time* is **not** persisted; only per-card score is.

## Requirements

### Requirement 1 — Per-card submit button

**User Story:** As a student practicing in quiz mode, I want a "提交本卡" button on each vocabulary card, so that I can check my answers for one card without committing to the whole unit.

#### Acceptance Criteria

1. WHEN the unit page enters quiz mode (body has `quiz-mode` class), THE SYSTEM SHALL inject a "提交本卡" button at the bottom of every `.vocab-card` that contains at least one `.blank`, on an independent row below the card's last content row.
2. WHEN a `.vocab-card` has zero `.blank` elements (intro/note-only cards), THE SYSTEM SHALL NOT inject a per-card submit button for it.
3. WHEN the unit page leaves quiz mode (mode switched back to review), THE SYSTEM SHALL remove all per-card submit buttons (parity with how the existing bottom submit button is removed).
4. THE per-card submit button SHALL be wired with `MyStar.addTapListener` (not raw `click`) to avoid iPad Safari double-fire.
5. THE per-card submit button visual style SHALL reuse the existing `.quiz-submit` look (or a minor variant), so it reads as the same affordance as the unit-level submit without ad-hoc colors. Color tokens come from `conventions/colors.md`; no new hex values.

### Requirement 2 — Per-card grading scope and feedback

**User Story:** As a student, I want tapping "提交本卡" to grade only that card, so that other cards I haven't finished yet are not marked wrong.

#### Acceptance Criteria

1. WHEN the per-card submit button on card `C` is tapped, THE SYSTEM SHALL grade only `.quiz-input` elements that are descendants of card `C`.
2. THE SYSTEM SHALL apply the same grading function used by the unit-level submit (`MyStar.isAnswerCorrect`) — no separate normalization path.
3. WHEN a per-card input is correct, THE SYSTEM SHALL add the `.correct` class to that input and remove any prior `.quiz-hint` sibling.
4. WHEN a per-card input is wrong, THE SYSTEM SHALL add the `.wrong` class and insert a `.quiz-hint` sibling containing `✗ <expected>`, replacing any prior hint.
5. THE SYSTEM SHALL NOT show the top `.quiz-banner` when a per-card submit is processed. Per-card feedback is conveyed via input colors + hints only.
6. THE per-card submit SHALL NOT affect inputs in other cards (no class changes, no hint mutation outside card `C`).

### Requirement 3 — Per-card score persistence

**User Story:** As a returning student, I want my last per-card score to be remembered, so that I can see where I last stood when I open the unit again.

#### Acceptance Criteria

1. WHEN a per-card submit completes on card `C`, THE SYSTEM SHALL compute `score = round(correct / total * 100)` over the card's inputs and persist it via `MyStar.writeNumber` under key `quizScore_<slug>_<cardId>`, where `<cardId>` is the value of the card's `id` attribute (e.g. `vocab-card-1`). Cards without inputs cannot reach this state because no submit button is injected for them (cross-ref Requirement 1 #2).
2. IF a `.vocab-card` has no `id` attribute, THE SYSTEM SHALL NOT persist a per-card score for it (graceful no-op; existing units already assign stable ids). No fallback id is generated client-side.
3. THE SYSTEM SHALL NOT write any per-card timestamp key. The only per-card key is `quizScore_<slug>_<cardId>` (rationale: cookie size budget — `tech.md` Known limitations).
4. THE SYSTEM SHALL NOT modify `quizScore_<slug>` or `quizTime_<slug>` on a per-card submit. Those keys are owned by the unit-level submit (see Requirement 5).
5. Storage SHALL go through `MyStar.readNumber / writeNumber` exclusively — never raw `localStorage` (per `tech.md` architectural decision).

### Requirement 4 — Last-score badge in card header

**User Story:** As a returning student, I want to see my last score for each card at a glance, so that I can prioritize cards I scored poorly on.

#### Acceptance Criteria

1. WHEN the unit page loads AND `quizScore_<slug>_<cardId>` exists for a card, THE SYSTEM SHALL render a small badge in that card's `.card-header` (placed inside `.card-actions`, before the existing buttons) showing `上次 N%`.
2. THE badge SHALL be visible in both review mode and quiz mode (it is a passive stats indicator, not a spoiler).
3. WHEN the per-card submit on card `C` completes with a new score, THE SYSTEM SHALL update card `C`'s badge text in place to reflect the new score (creating the badge if it did not exist).
4. WHEN the unit-level submit completes, THE SYSTEM SHALL update the badge for every card that has at least one input (parity with Requirement 5).
5. THE badge SHALL use color tokens from `conventions/colors.md`: `--accent-green-soft` background + `--accent-green` text for score ≥ 80, `--accent-amber-soft` background + `--accent-amber` text for 60–79, `--neutral-gray-soft` background + `--text-secondary` text for < 60. No new hex values.
6. WHEN the user clears local storage (or first-time visit), the badge SHALL NOT render for cards without a stored score. No "—" placeholder.

### Requirement 5 — Unit-level submit re-grades and overwrites

**User Story:** As a student doing a full-unit run, I want the bottom "提交并查看结果" to be authoritative, so that one tap re-scores everything and reflects the truth in both per-card badges and the homepage.

#### Acceptance Criteria

1. WHEN the unit-level "提交并查看结果" is tapped, THE SYSTEM SHALL grade all `.quiz-input` elements in the unit (current behavior, unchanged).
2. AFTER unit-level grading, THE SYSTEM SHALL recompute per-card scores from the same input pass and write `quizScore_<slug>_<cardId>` for every card that has at least one input — overwriting any prior per-card scores from individual submits.
3. AFTER unit-level grading, THE SYSTEM SHALL update each card's header badge in place (Requirement 4 #4).
4. AFTER unit-level grading, THE SYSTEM SHALL write `quizScore_<slug>` (the unit aggregate) and `quizTime_<slug>` exactly as today.
5. THE SYSTEM SHALL show the top `.quiz-banner` with the aggregate result (current behavior, unchanged).

### Requirement 6 — Mode lifecycle and reset

**User Story:** As a student switching between modes, I want the UI to come back clean, so that the previous mode's artifacts don't leak.

#### Acceptance Criteria

1. WHEN switching from quiz mode to review mode, THE SYSTEM SHALL remove all per-card submit buttons (Requirement 1 #3) and clear all `.quiz-input` values/classes/hints (current `resetQuizInputs` behavior, extended to cover per-card additions).
2. WHEN the existing "重新测验" (banner-retry) button is tapped, THE SYSTEM SHALL clear all `.quiz-input` values/classes/hints across the unit (current behavior). THE SYSTEM SHALL NOT clear stored per-card scores or remove header badges — only the in-page input state is reset.
3. THE per-card submit button on card `C` SHALL be re-tappable any number of times; each tap re-grades card `C` and overwrites `quizScore_<slug>_<cardId>` with the latest score.

### Requirement 7 — Backward compatibility

**User Story:** As a stakeholder watching the homepage stats, I want this change to not silently shift what `quizScore_<slug>` means, so that historical scores remain comparable.

#### Acceptance Criteria

1. THE SYSTEM SHALL NOT migrate, rewrite, or remove any existing `quizScore_<slug>` or `quizTime_<slug>` values.
2. THE SYSTEM SHALL NOT change the semantics of `quizScore_<slug>` (still: aggregate score from the most recent unit-level submit).
3. THE homepage rendering and the review/重点集 page SHALL NOT need code changes for this feature to ship. (Per-card keys are read-only from those surfaces' perspective; reading them is out of scope for this spec.)
4. Per-card score keys SHALL coexist with the unit aggregate key. A unit may have an aggregate score without any per-card scores (legacy state) and vice versa.

## Out of Scope

The following are deliberately **not** part of this spec and will be tracked separately if needed:

- Reading per-card scores from the homepage or `review/index.html` to drive new stats/sorts.
- Card-level mastery, weakest-card review, or spaced-repetition scheduling.
- Per-card timestamp persistence.
- Migrating existing `quizScore_<slug>` into per-card buckets.
- Showing per-card scores anywhere outside the unit page.
- Adding card ids to units that lack them (current units already have stable ids; new authoring guidance — if any — goes in the design phase).
