# Product

## What it is

A lightweight static web app for between-class vocabulary review — "myStar · 课间复习". Students open a unit, flip flashcards or take a fill-in-the-blank quiz, star difficult cards into a personal "重点集" (focus set), and come back later.

## Target users

Primary: a single student (or small group) using the app on an **old iPad** during school breaks. UI is Chinese.

## Core capabilities

- **Books → Units**: content is organized as books (e.g. "Book 1 · 课本一") containing units (e.g. "Unit 6 · Famous people in history"). Each unit has cards (vocabulary) and blanks (cloze exercises).
- **Per-unit progress**: last-visit time, last quiz score, and starred-card count are tracked per unit and shown on the homepage.
- **Starred set ("重点集")**: cards starred across units are aggregated into a single review view.
- **Lenient quiz matching**: answers are normalized (case, trailing punctuation, whitespace) and accept multiple variants separated by `/`.

## Non-goals

- No accounts, no sync, no backend. All state is per-device in `localStorage` + cookie fallback.
- No build pipeline, no framework, no package manager. Stays a folder of static files.
- Not optimized for desktop or modern mobile — old iPad Safari is the constraint that drives everything.

## Distribution

Run locally via `./startup.sh` (Python `http.server`). No public deployment, no CI/CD.
