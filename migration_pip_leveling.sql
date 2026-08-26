-- PointPal: Pip leveling & cosmetics
-- Run this once in the Supabase SQL editor.

alter table children
  add column if not exists lifetime_points integer not null default 0,
  add column if not exists level_thresholds jsonb not null default '[250,750,1500,3000,5000]'::jsonb,
  add column if not exists equipped_cosmetics jsonb not null default '{}'::jsonb;

-- Backfill: assume each child's current spendable points is a reasonable
-- starting lifetime total (better than starting everyone at 0 and having
-- existing kids "lose" progress they'd already earned). Skip this line if
-- you'd rather everyone start fresh at level 0 instead.
update children set lifetime_points = points where lifetime_points = 0;
