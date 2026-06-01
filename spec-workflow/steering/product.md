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

- **Pre-v1 product axis:** no accounts, no sync, no backend. (Superseded by server-user-state in 2026-06 — see below.)
- No build pipeline for the **frontend layer** — `js/` and `style/` stay file-served-as-is, ES5, no transpiler.
- No mobile/native apps. No public deployment beyond a single hobby host (currently EdgeOne Pages).

## Optional layers (added 2026-06)

- **Cloud sync via short code** — `server-user-state` adds an opt-in identity (typed short code) + Turso-backed mirror of `MyStar.*` state. The browser is still authoritative offline; the server is a replica that lets the same student carry progress across the prod-URL-changes-per-deploy quirk of the host platform. Frontend constraints are unchanged.
- **Backend layer (Node 24.5.0)** — see `tech.md` "Backend (optional layer)". Only the `server/`, `functions/`, `migrations/`, and `scripts/` directories use npm + ESM.

## Distribution

Run locally via `./startup.sh` (Python `http.server`). No public deployment, no CI/CD.
