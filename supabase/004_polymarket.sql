-- ============================================================
-- Spovibe — Phase A : Polymarket integration
-- Table predictions_positions : track les positions des users sur de vrais
-- marchés Polymarket (fetched live depuis l'API gamma).
-- À coller dans Supabase Dashboard → SQL Editor → New query → Run.
-- Pré-requis : 001_init.sql, 002_admin.sql, 003_arena_engagement.sql appliqués.
-- ============================================================

create table if not exists public.predictions_positions (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  account_id      uuid references public.accounts(id) on delete cascade,
  -- Snapshot Polymarket au moment de la prise de position
  market_id       text not null,                -- id Polymarket (string)
  condition_id    text,                          -- conditionId on-chain
  market_question text not null,                 -- "MicroStrategy sells any Bitcoin in 2025?"
  market_slug     text,
  market_image    text,
  event_id        text,
  event_title     text,
  category        text,                          -- catégorie principale extraite des tags
  end_date        timestamptz,                   -- end date du marché Polymarket
  -- Côté pari
  side            text not null check (side in ('Yes', 'No')),
  price_at_entry  numeric not null check (price_at_entry > 0 and price_at_entry < 1),
  stake           numeric not null check (stake > 0),
  shares          numeric not null,              -- stake / price_at_entry
  -- Résolution
  status          text not null default 'open' check (status in ('open', 'won', 'lost', 'cancelled')),
  resolved_outcome text,                          -- "Yes" / "No" / "50-50"
  payout          numeric default 0,              -- montant crédité au user si gagnant
  settled_at      timestamptz,
  opened_at       timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_predpos_user on public.predictions_positions(user_id);
create index if not exists idx_predpos_account on public.predictions_positions(account_id);
create index if not exists idx_predpos_market on public.predictions_positions(market_id);
create index if not exists idx_predpos_status on public.predictions_positions(status);
create index if not exists idx_predpos_open_market on public.predictions_positions(market_id) where status = 'open';

alter table public.predictions_positions enable row level security;

-- User : lit, insère, update ses propres positions
drop policy if exists "predpos_select_own" on public.predictions_positions;
drop policy if exists "predpos_insert_own" on public.predictions_positions;
drop policy if exists "predpos_update_own" on public.predictions_positions;
create policy "predpos_select_own" on public.predictions_positions for select using (auth.uid() = user_id);
create policy "predpos_insert_own" on public.predictions_positions for insert with check (auth.uid() = user_id);
create policy "predpos_update_own" on public.predictions_positions for update using (auth.uid() = user_id);

-- Admin : lit tout (pour analyse + résolution)
drop policy if exists "predpos_admin_select_all" on public.predictions_positions;
drop policy if exists "predpos_admin_update_all" on public.predictions_positions;
create policy "predpos_admin_select_all" on public.predictions_positions for select using (public.is_admin());
create policy "predpos_admin_update_all" on public.predictions_positions for update using (public.is_admin());

-- Trigger : maj automatique de updated_at
drop trigger if exists trg_predpos_updated_at on public.predictions_positions;
create trigger trg_predpos_updated_at
  before update on public.predictions_positions
  for each row execute procedure public.touch_updated_at();

-- ============================================================
-- Cache léger des catégories Polymarket connues (pour stats admin)
-- Optionnel : peut être rempli automatiquement lors de la 1re sync,
-- ou laissé vide (les positions ont déjà category copiée).
-- ============================================================
create table if not exists public.polymarket_categories (
  slug          text primary key,
  label         text not null,
  position_count int default 0,
  last_seen_at  timestamptz default now()
);
alter table public.polymarket_categories enable row level security;
drop policy if exists "polycat_read_all" on public.polymarket_categories;
create policy "polycat_read_all" on public.polymarket_categories for select using (true);

-- ============================================================
-- Fin du script. Vérification :
--   → 2 tables visibles : predictions_positions + polymarket_categories
--   → RLS activée sur les 2
-- ============================================================
