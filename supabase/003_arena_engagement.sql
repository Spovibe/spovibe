-- ============================================================
-- Spovibe — Migration Arena engagement tracking
-- À coller dans Supabase Dashboard → SQL Editor → New query → Run
-- Pré-requis : 001_init.sql + 002_admin.sql déjà appliqués
-- ============================================================

-- Ajoute une colonne timestamp sur profiles : "première interaction Arena"
-- (null = jamais touché Arena, sinon date du premier engagement).
alter table public.profiles
  add column if not exists arena_engaged_at timestamptz;

-- Policy update pour que les users puissent maj leur propre arena_engaged_at
-- (la policy "profiles_update_own" du 001_init.sql suffit déjà, mais on
-- s'assure qu'elle existe explicitement pour cette opération).
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- Index pour les requêtes analytics qui filtrent sur cette colonne
create index if not exists idx_profiles_arena_engaged on public.profiles(arena_engaged_at) where arena_engaged_at is not null;
