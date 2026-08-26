-- PointPal: Pip leveling, part 2 — per-child enable switch, no default thresholds
-- Run this once in the Supabase SQL editor (after migration_pip_leveling.sql).

alter table children
  add column if not exists leveling_enabled boolean not null default false;

-- The first migration's column default backfilled every existing child with
-- the example ladder [250,750,1500,3000,5000]. That's no longer wanted as a
-- silent default — clear it back to "not configured" for everyone. Anyone
-- who already deliberately set their own thresholds via the app (unlikely
-- before this point, but just in case) keeps them.
update children set level_thresholds = '[]'::jsonb
where level_thresholds = '[250,750,1500,3000,5000]'::jsonb;

-- Change the column's own default going forward too, so a newly-added child
-- starts with no thresholds instead of silently inheriting the example
-- ladder.
alter table children alter column level_thresholds set default '[]'::jsonb;
