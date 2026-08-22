# PointPal

A multi-child, installable PWA for tracking kids' activities (chores) and earned screen time/prizes, with a parent-gated approval flow. Supabase-backed (Postgres + Auth + Realtime) for cross-device sync — one shared family login across multiple kiosk tablets. No offline-first fallback: the app requires a live connection to boot and to make any change.

## What it does

- **Child side (per-child view; switch via child pills, no PIN needed to switch):**
  - Tap activity cards to request credit — each activity earns either points or minutes (`currency`), per its own setting. Activities can be repeatable, one-time-per-day, or follow a recurring/one-time **schedule** (daily / certain weekdays / every-other-week / monthly / one-time-only).
  - Browse a **Prizes** tab and request redemptions (spends points, optionally grants bonus minutes).
  - View a chronological **History** tab (by week or month) of everything requested/approved/denied.
  - A "tank" header shows current points (a filling water tank with animated fish) and screen-time minutes.
  - Home shows an **Active Challenges** section above the activity grid (see below).
- **Parent side (PIN-gated, default PIN `1234`; 5-attempt lockout with a 30s cooldown; auto-locks after 2 min idle):**
  - **Approvals** tab: approve/deny any pending entry, bulk-approve all, 6-second undo toast on a single approve/deny.
  - **Chores** tab (labeled "Activities" in the UI): edit label/icon/schedule/repeatable/amount/currency, delete, or add activities.
  - **Prizes** tab: edit costs, delete, or add prizes (optionally granting bonus minutes).
  - **Challenges** tab: create/edit/remove challenges — each watches one activity's approvals and pays a bonus (points or minutes) once a target count is hit, either **recurring** (resets weekly, indefinite) or **one-time** (only active between an explicit start/end date; pays out once, then simply stops appearing once the end date passes, completed or not).
  - **Settings** tab: rename/add/remove children, change PIN, manually adjust points/minutes, backfill past activity/prize entries (dated in the past, credited immediately, no approval needed), reset a child's data.
- Every child-initiated request creates a `pending` entry; nothing affects the point/minute balance until a parent approves it (manual backfills in Settings are the one exception — they apply immediately).
- "Good Day at School" is **not** special-cased in code — it's an ordinary seeded activity (`id:'school'`, worth 15 min) plus a seeded recurring Challenge (`id:'default-school'`, 5×/week → +120 min) that reproduces the old hardcoded streak. Both are fully editable/removable through the normal Activities/Challenges tabs, same as anything a parent adds later.

## File structure

Flat, no build step, no dependencies:

- `index.html` — all markup + all CSS (custom properties for the color theme, no framework). Shell (header/tank, nav bar, child-switch row, PIN overlay, Parent Zone overlay, icon/schedule/challenge picker overlays, offline banner, boot/login screens) plus an empty `#mainContent` div that `app.js` fills per view. Loads the Supabase JS CDN script before `app.js`.
- `app.js` — the entire application: Supabase client + sync, multi-child state, business logic, and hand-rolled DOM rendering (HTML strings via template literals, re-rendered wholesale on `render()`).
- `manifest.json` — PWA manifest (name, icons, theme colors, `orientation:"any"` for tablet landscape/portrait).
- `sw.js` — service worker: cache-first-with-background-refresh for the app shell only (`CACHE_NAME` = `pointpal-cache-vNN`; explicitly ignores cross-origin requests so it never intercepts Supabase traffic). **Bump `CACHE_NAME` on every shipped change** — a stale SW cache masking edits is the most common "why isn't my change showing up" during local testing; the fix is unregister service worker + clear caches + hard reload.
- `icon-192.png`, `icon-512.png` — app icons.

## Data model — Supabase, not localStorage

Postgres tables, each with `user_id uuid default auth.uid()` + RLS policy `user_id = auth.uid()`. One family = one `auth.users` account, shared across all kiosks.

- `children` — `{id, user_id, name, points, minutes, week_start}`
- `chores` — `{id, child_id, user_id, label, emoji, amount, currency:'points'|'minutes', repeatable, schedule jsonb}` — the activity catalog
- `prizes` — `{id, child_id, user_id, label, emoji, cost, grants_minutes}`
- `challenges` — `{id, child_id, user_id, chore_id, label, target, bonus, currency, type:'recurring'|'onetime', start_date, end_date}`
- `entries` — append-only ledger: `{id, child_id, user_id, ts, kind:'chore'|'bonus'|'redeem', ref_id, label, emoji, currency, amount, status:'pending'|'approved'|'denied', grants_minutes}`
- `family_settings` — `{user_id, pin}`

`children`/`chores`/`prizes`/`challenges`/`entries` are all realtime-subscribed (`subscribeRealtime()`) — a change from any other kiosk triggers a debounced full refetch (`scheduleRefetch()`). `activeChildId` (which child a given device is currently viewing) is **local-only**, kept per-device in `localStorage`, never synced.

In-memory shape (`app.js`, per child): `{id, name, points, minutes, weekStart, chores[], prizes[], challenges[], entries[]}` — camelCase (`choreId`, `startDate`, etc.); conversion to/from snake_case DB rows happens in `rowsToChild()` / `insertChildFull()` / `toEntryRow()`.

All balance changes flow through `approveEntry(id)` (or the manual-backfill functions in Settings) — never mutated ad hoc elsewhere. Nothing is deleted from `entries`; denied requests stay in history with a `denied` status. Every Supabase write ends in `.throwOnError()` — the JS client resolves rather than rejects on API/DB errors by default, so omitting this silently swallows real failures.

## Challenges engine (`app.js`)

`isChallengeActive(ch, dateKey)`, `challengeProgress(child, ch)`, `challengeBonusGranted(child, ch)`, `maybeGrantChallengeBonus(child, ch, status)`, `checkChallengesForApproval(child, entry, status)` — invoked from `approveEntry` and `addPastChore` whenever a `kind:'chore'` entry is approved. A bonus entry's `refId` is the **challenge's own id** (not the underlying chore's), so multiple challenges can independently watch the same activity without colliding. `lastActionSnapshot.extraEntryIds` is an array (not singular) so undo can revert every bonus a single approval may have triggered.

## Rendering pattern

No framework/virtual DOM. `render()` regenerates the header stats and calls one of `homeHTML()` / `prizesHTML()` / `historyHTML()` based on the global `view`, sets `innerHTML`, then `wireMainContent()` reattaches event listeners by querying `data-*` attributes. The Parent Zone overlay follows the same pattern via `renderParentBody()` / `wireParentBody()`, keyed on `activeParentTab` (`approve` / `chores` / `prizes` / `challenges` / `settings`). Icon picker, schedule picker, and challenge picker are separate overlays that all follow the same draft-state → editor-HTML → wire → save shape (`*PickerContext` / `*Draft` globals).

## Working in this repo

- No build/test/lint tooling — edit `index.html`/`app.js` directly. Serving needs a real HTTP origin (not `file://`) for the Supabase CDN script/fetches to work; a small local PowerShell `HttpListener` script is the fallback when Python/Node aren't installed on the machine.
- The app requires a live Supabase connection to get past the login/loading screen — there is no local-only/offline mode. `requireOnline()` gates every mutating action before any local mutation happens.
- Keep new UI consistent with the existing CSS custom-property theme in `index.html` (`--navy`, `--teal`, `--coral`, `--gold`, etc.) rather than introducing new ad hoc colors.
- Schema changes need a manual SQL migration, run by the user in the Supabase SQL editor (no migration tooling exists) — write it additive/backfill-only wherever possible, and hand it over as a file for the user to run themselves rather than executing it.
- User-facing copy says "Activity/Activities"; the underlying code, CSS classes (`.chore-card` etc.), and the `chores` table are still named `chore`/`chores` — that's intentional (a display-only rename), not an inconsistency to "fix" reflexively.
- Bump `CACHE_NAME` in `sw.js` on every shipped change.
