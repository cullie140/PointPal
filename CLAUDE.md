# PointPal

A single-page, installable PWA for tracking a kid's chores, school days, and earned screen time/prizes, with a parent-gated approval flow. No backend — everything lives in one child's browser via `localStorage`.

## What it does

- **Child side (unauthenticated, default view):**
  - Tap chore cards to request credit (points). Chores can be one-time-per-day or `repeatable`.
  - Tap "Good Day at School" to request +15 min screen time (once/day).
  - Browse a **Prizes** tab and request redemptions (spends points, optionally grants bonus minutes).
  - View a chronological **History** tab of everything requested/approved/denied.
  - A "tank" header shows current points (as a filling water tank with animated fish) and screen-time minutes.
  - 5 approved school days in a calendar week (Mon–Sun) auto-generates a pending "5-Day Streak Bonus" entry (+120 min).
- **Parent side (PIN-gated, default PIN `1234`):**
  - **Approvals** tab: approve/deny any pending entry (chore, school day, bonus, prize redemption).
  - **Chores** tab: edit point values, delete, or add chores.
  - **Prizes** tab: edit costs, delete, or add prizes (optionally granting bonus minutes).
  - **Settings** tab: rename child, change PIN, manually adjust points/minutes, reset all data.
- Every request from the child creates a `pending` entry; nothing affects the point/minute balance until a parent approves it.

## File structure

Flat, no build step, no dependencies:

- `index.html` — all markup + all CSS (custom properties for the color theme, no framework). Contains the shell (header/tank, nav bar, PIN overlay, Parent Zone overlay) and an empty `#mainContent` div that `app.js` fills per view.
- `app.js` — the entire application: state, persistence, business logic, and hand-rolled DOM rendering (no framework — HTML strings via template literals, re-rendered wholesale on `render()`).
- `manifest.json` — PWA manifest (name, icons, theme colors, standalone display).
- `sw.js` — service worker: cache-first-with-background-refresh for the app shell (`pointpal-cache-v1`), bumping `CACHE_NAME` invalidates old caches on activate.
- `icon-192.png`, `icon-512.png` — app icons.

## State model (`app.js`)

Single `state` object, persisted to `localStorage` under key `pointpal_v1` (see `DEFAULT_STATE`):

- `childName`, `pin`, `points`, `minutes`
- `weekStart` — ISO date of the current tracking week's Monday, used to compute the school streak; recomputed by `ensureWeek()` on every render.
- `chores[]` — `{id, label, emoji, points, repeatable}`
- `prizes[]` — `{id, label, emoji, cost, grantsMinutes?}`
- `entries[]` — the append-only ledger: `{id, ts, kind: 'chore'|'school'|'bonus'|'redeem', refId, label, emoji, currency: 'points'|'minutes', amount, status: 'pending'|'approved'|'denied', grantsMinutes?}`

All balance changes flow through `approveEntry(id)` — the only place `state.points`/`state.minutes` are mutated from a ledger entry. Nothing is deleted from `entries`; denied requests stay in history with a `denied` status.

## Rendering pattern

No framework/virtual DOM. `render()` regenerates the header stats and calls one of `homeHTML()` / `prizesHTML()` / `historyHTML()` based on the global `view`, sets `innerHTML`, then `wireMainContent()` reattaches event listeners by querying `data-*` attributes. The Parent Zone overlay follows the same pattern via `renderParentBody()` / `wireParentBody()` keyed on `activeParentTab`. Global mutable state (`view`, `pinContext`, `pinBuffer`, `activeParentTab`) lives as top-level `let` variables in `app.js`.

## Working in this repo

- No build/test/lint tooling — edit `index.html`/`app.js` directly and open `index.html` in a browser (or serve it locally) to check changes.
- Keep new UI consistent with the existing CSS custom-property theme in `index.html` (`--navy`, `--teal`, `--coral`, `--gold`, etc.) rather than introducing new ad hoc colors.
- Any new state field added to `DEFAULT_STATE` is auto-merged into existing users' saved state via `Object.assign` in `loadState()` — no migration step needed for additive changes.
- Bump `CACHE_NAME` in `sw.js` when shipping changes that must not be masked by stale cached assets.
