-- Migration: Add priority strategy columns for views-based distribution
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS on index)
-- Default 'least_usage' preserves current behavior for existing campaigns/loops

-- distribute_campaigns: strategy + seed for deterministic assignment
ALTER TABLE public.distribute_campaigns
  ADD COLUMN IF NOT EXISTS priority_strategy text NOT NULL DEFAULT 'least_usage',
  ADD COLUMN IF NOT EXISTS distribution_seed text;

-- loops: strategy + seed for deterministic assignment
ALTER TABLE public.loops
  ADD COLUMN IF NOT EXISTS priority_strategy text NOT NULL DEFAULT 'least_usage',
  ADD COLUMN IF NOT EXISTS distribution_seed text;

-- Index for efficient views-based ranking queries within a folder
CREATE INDEX IF NOT EXISTS idx_videos_library_folder_views
  ON public.videos_library(folder_id, views DESC);