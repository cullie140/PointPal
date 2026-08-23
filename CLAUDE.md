# PointPal

A multi-child, installable PWA for tracking kids' activities (chores) and earned screen time/prizes, with a parent-gated approval flow. Supabase-backed (Postgres + Auth + Realtime) for cross-device sync — one shared family login across multiple kiosk tablets. No offline-first fallback: the app requires a live connection to boot and to make any change.

## What it does

- **Child side (per-child view; switching to another child now requires that child's own PIN — see Security below):**
  - Tap activity cards to request credit — each activity earns either points or minutes (`currency`), per its own setting. Activities can be repeatable, one-time-per-day, or follow a recurring/one-time **schedule** (daily / certain weekdays / every-other-week / monthly / one-time-only).
  - Browse a **Prizes** tab and request redemptions (spends points). A prize can optionally cap redemptions per day/week (`limitMax`/`limitPeriod`) and a child can pin one prize as a **savings goal**, shown as a progress bar on Home.
  - View a chronological **History** tab (by week or month) of everything requested/approved/denied.
  - A header meter pair shows current points and screen-time minutes as two large, high-visibility numbers, each backed by Pip artwork in its own color story (a treasure chest for points, Pip watching TV for screen time) — plus the child's own avatar next to their name. This replaced an earlier "tank" motif (a filling water tank with animated fish/bubbles), retired in favor of leaning on Pip everywhere.
  - Home shows, top to bottom when applicable: a savings-goal progress bar, **Active Punishments**, **Active Challenges**, then the activity grid.
- **Parent side (PIN-gated, default family PIN `1234`; 5-attempt lockout with a 30s cooldown, shared across every PIN attempt — parent or any child):**
  - **Approvals** tab: approve/deny any pending entry, bulk-approve all, 6-second undo toast on a single approve/deny.
  - **Activities** tab: edit label/icon/schedule/repeatable/amount/currency, delete, or add activities.
  - **Prizes** tab: edit costs/icons, delete, or add prizes; set an optional redemption limit via a picker pill (no limit / N per day / N per week).
  - **Challenges** tab: create/edit/remove challenges — each watches one activity's approvals and pays a bonus (points or minutes) once a target count is hit, either **recurring** (resets weekly, indefinite) or **one-time** (only active between an explicit start/end date; pays out once, then simply stops appearing once the end date passes, completed or not).
  - **Punishments** tab: create/edit/remove temporary blocks — each can block point-earning activities, minute-earning activities, and/or prize redemption (any combination), for a set duration (hours or days). Blocked activities/prizes show visibly dimmed/locked to the child; blocks lift automatically on expiry or can be removed early.
  - **Settings** tab (Profile / Points & Time / Manual Entries / Data sub-tabs): rename/add/remove children, pick each child's **avatar** and set their **PIN**, change the family PIN, manually adjust points/minutes, backfill past activity/prize entries (dated in the past, credited immediately, no approval needed), reset a child's data (preserves that child's avatar/PIN — only points/minutes/history clear).
- Every child-initiated request creates a `pending` entry; nothing affects the point/minute balance until a parent approves it (manual backfills in Settings are the one exception — they apply immediately).
- "Good Day at School" is **not** special-cased in code — it's an ordinary seeded activity (`id:'school'`, worth 15 min) plus a seeded recurring Challenge (`id:'default-school'`, 5×/week → +120 min) that reproduces the old hardcoded streak. Both are fully editable/removable through the normal Activities/Challenges tabs, same as anything a parent adds later.

## Security: avatars, per-child PINs, and the kiosk idle-lock

- Each child has a picked-from-a-set emoji `avatar` (`AVATAR_SET` in `app.js`, themed around dinosaurs/construction/sloths/space/science/ninjas/superheroes/gaming) and their own 4-digit `pin`, both editable in Parent Zone → Settings → Profile. New children default to a rotating avatar and the current family PIN; a data reset preserves both.
- **Every** child switch — via the Home child-switcher pills or the lock screen below — routes through the PIN pad and compares against that specific child's PIN (falling back to the family PIN if a child's own is somehow unset). `pinContext` is `{type:'parent'}` or `{type:'child', childId}`; `pressPinKey`'s success branch checks the right PIN and either calls `switchChild()` or `openParent()`.
- A single global **30-second idle timer** (`APP_IDLE_MS`, `startAppIdleWatch()`) runs for the whole app session (started once from `afterAuth()`, never stopped). After 30s of no click/input/touch anywhere, it closes any open overlay and shows a full-screen lock screen (`#kioskLockScreen`) with one large avatar tile per child plus a "Parent" tile — tapping a tile opens the PIN pad for that child or the family PIN; success hides the lock screen and either switches child or opens Parent Zone directly. This **replaced** an earlier Parent-Zone-only 2-minute idle auto-lock, which became redundant once the global 30s timer existed.
- The PIN pad (`#pinOverlay`) is deliberately given a higher z-index (1200) than everything else including the lock screen (1000), so it always layers on top and Cancel naturally reveals whatever was underneath — the lock screen if idle-triggered, or the already-unlocked app if opened manually via the header lock icon.

## File structure

Flat, no build step, no dependencies:

- `index.html` — all markup + all CSS (custom properties for the color theme, no framework). Shell (header/tank, nav bar, child-switch row, PIN overlay, Parent Zone overlay, icon/schedule/challenge/punishment/limit picker overlays, offline banner, boot/login screens, kiosk lock screen) plus an empty `#mainContent` div that `app.js` fills per view. Loads the Supabase JS CDN script before `app.js`.
- `app.js` — the entire application: Supabase client + sync, multi-child state, business logic, and hand-rolled DOM rendering (HTML strings via template literals, re-rendered wholesale on `render()`).
- `manifest.json` — PWA manifest (name, icons, theme colors, `orientation:"any"` for tablet landscape/portrait).
- `sw.js` — service worker: cache-first-with-background-refresh for the app shell only (`CACHE_NAME` = `pointpal-cache-vNN`; explicitly ignores cross-origin requests so it never intercepts Supabase traffic). **Bump `CACHE_NAME` on every shipped change** — a stale SW cache masking edits is the most common "why isn't my change showing up" during local testing; the fix is unregister service worker + clear caches + hard reload.
- `icon-192-v2.png`, `icon-512-v2.png` — favicon + web app manifest icons (renamed with a version suffix once already, to force iOS to drop its stubborn home-screen-icon cache — bump the suffix again if the icon ever needs to change and a cache-stuck report comes back).
- `apple-touch-icon-180.png` — the iOS-specific Home Screen icon, referenced via `<link rel="apple-touch-icon" sizes="180x180">`. Kept as a separate file/size from `icon-192-v2.png` because iOS ignores the manifest entirely for "Add to Home Screen" and is picky about getting an exact-sized, fully opaque (no alpha) square at Apple's own recommended 180×180 — a same-but-different-size icon reportedly got silently padded with white and shrunk.

## Data model — Supabase, not localStorage

Postgres tables, each with `user_id uuid default auth.uid()` + RLS policy `user_id = auth.uid()`. One family = one `auth.users` account, shared across all kiosks.

- `children` — `{id, user_id, name, avatar, pin, points, minutes, week_start, goal_prize_id}`
- `chores` — `{id, child_id, user_id, label, emoji, amount, currency:'points'|'minutes', repeatable, schedule jsonb}` — the activity catalog
- `prizes` — `{id, child_id, user_id, label, emoji, cost, limit_max, limit_period:'day'|'week'}`
- `challenges` — `{id, child_id, user_id, chore_id, label, target, bonus, currency, type:'recurring'|'onetime', start_date, end_date}`
- `punishments` — `{id, child_id, user_id, label, block_points, block_minutes, block_prizes, ends_at}` — `ends_at` is an absolute ms-epoch timestamp; a punishment is active purely by `Date.now() < ends_at`, no separate lifecycle state
- `entries` — append-only ledger: `{id, child_id, user_id, ts, kind:'chore'|'bonus'|'redeem', ref_id, label, emoji, currency, amount, status:'pending'|'approved'|'denied'}`
- `family_settings` — `{user_id, pin}` — the one family/parent PIN; distinct from each child's own `pin` on the `children` row

`children`/`chores`/`prizes`/`challenges`/`punishments`/`entries` are all realtime-subscribed (`subscribeRealtime()`) — a change from any other kiosk triggers a debounced full refetch (`scheduleRefetch()`). `activeChildId` (which child a given device is currently viewing) is **local-only**, kept per-device in `localStorage`, never synced.

In-memory shape (`app.js`, per child): `{id, name, avatar, pin, points, minutes, weekStart, goalPrizeId, chores[], prizes[], challenges[], punishments[], entries[]}` — camelCase (`choreId`, `startDate`, `limitMax`, `blockPoints`, etc.); conversion to/from snake_case DB rows happens in `rowsToChild()` / `insertChildFull()` / `toEntryRow()`.

All balance changes flow through `approveEntry(id)` (or the manual-backfill functions in Settings) — never mutated ad hoc elsewhere. Nothing is deleted from `entries`; denied requests stay in history with a `denied` status. Every Supabase write ends in `.throwOnError()` — the JS client resolves rather than rejects on API/DB errors by default, so omitting this silently swallows real failures.

## Challenges engine (`app.js`)

`isChallengeActive(ch, dateKey)`, `challengeProgress(child, ch)`, `challengeBonusGranted(child, ch)`, `maybeGrantChallengeBonus(child, ch, status)`, `checkChallengesForApproval(child, entry, status)` — invoked from `approveEntry` and `addPastChore` whenever a `kind:'chore'` entry is approved. A bonus entry's `refId` is the **challenge's own id** (not the underlying chore's), so multiple challenges can independently watch the same activity without colliding. `lastActionSnapshot.extraEntryIds` is an array (not singular) so undo can revert every bonus a single approval may have triggered.

## Punishments engine (`app.js`)

`isPunishmentActive(p)`, `activePunishments(c)`, `isBlocked(c, field)`, `isChoreBlocked(c, chore)` — `requestChore`/`requestPrize` check these before creating an entry and refuse (with a toast) if blocked; this is enforced at the request function, not just visually. `schedulePunishmentExpiry()` sets a one-shot `setTimeout` to the soonest active punishment's `endsAt` so a block visually lifts on its own without the child needing to tap anything.

## Rendering pattern

No framework/virtual DOM. `render()` regenerates the header stats and calls one of `homeHTML()` / `prizesHTML()` / `historyHTML()` based on the global `view`, sets `innerHTML`, then `wireMainContent()` reattaches event listeners by querying `data-*` attributes. The Parent Zone overlay follows the same pattern via `renderParentBody()` / `wireParentBody()`, keyed on `activeParentTab` (`approve` / `chores` / `prizes` / `challenges` / `punishments` / `settings`). Icon/avatar picker, schedule picker, challenge picker, punishment picker, and prize-limit picker are separate overlays that all follow the same draft-state → editor-HTML → wire → save shape (`*PickerContext` / `*Draft` globals). List-edit rows (Activities, Prizes, Challenges, Punishments, the child-rename row) share a common two-line card shape — `.item-row-main` (icon + name/primary control + trailing action button(s)) stacked above `.item-row-meta` (secondary controls, wraps via `flex-wrap`) — inside a plain `.list-edit-item` container, which is what keeps these rows from overflowing horizontally on a phone-width screen.

## Working in this repo

- No build/test/lint tooling — edit `index.html`/`app.js` directly. Serving needs a real HTTP origin (not `file://`) for the Supabase CDN script/fetches to work; a small local PowerShell `HttpListener` script is the fallback when Python/Node aren't installed on the machine.
- The app requires a live Supabase connection to get past the login/loading screen — there is no local-only/offline mode. `requireOnline()` gates every mutating action before any local mutation happens.
- Keep new UI consistent with the existing CSS custom-property theme in `index.html` (`--navy`, `--teal`, `--coral`, `--gold`, etc.) rather than introducing new ad hoc colors.
- Schema changes need a manual SQL migration, run by the user in the Supabase SQL editor (no migration tooling exists) — write it additive/backfill-only wherever possible, and hand it over as a file for the user to run themselves rather than executing it.
- User-facing copy says "Activity/Activities"; the underlying code, CSS classes (`.chore-card` etc.), and the `chores` table are still named `chore`/`chores` — that's intentional (a display-only rename), not an inconsistency to "fix" reflexively.
- The app is used both on 10.1in kiosk tablets (portrait/landscape, `@media (min-width:700px)`/`(min-width:1000px)` breakpoints) and on parents' phones for Parent Zone — narrow-width layouts matter, not just tablet ones. A useful local test technique for phone widths: embed `http://localhost:8000/` in an `<iframe>` sized to the target CSS pixel dimensions (e.g. 393×852 for iPhone 15) rather than relying on browser window resize, which doesn't reliably affect the viewport in this environment.
- Bump `CACHE_NAME` in `sw.js` on every shipped change.
