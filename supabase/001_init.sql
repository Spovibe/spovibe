-- ============================================================
-- Spovibe — Schéma initial Supabase
-- À coller dans Supabase Dashboard → SQL Editor → New query → Run
-- Tables : profiles, accounts, payments, contacts
-- Row Level Security activée partout
-- ============================================================

-- ============================================================
-- 1. PROFILES  (étend auth.users avec le nom complet)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null,
  created_at  timestamptz default now()
);

-- Trigger : auto-créer un profil à chaque nouveau signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 2. ACCOUNTS  (un compte par user × vertical)
-- ============================================================
create table if not exists public.accounts (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  vertical     text not null check (vertical in ('sports', 'predictions')),
  tier_id      text not null,
  tier         jsonb not null,                          -- snapshot des règles du palier
  phase        text not null default 'evaluation' check (phase in ('evaluation', 'funded')),
  status       text not null default 'active'      check (status in ('active', 'passed', 'failed', 'funded')),
  capital      numeric not null,
  balance      numeric not null,
  peak         numeric not null,
  started_at   timestamptz default now(),
  funded_at    timestamptz,
  withdrawn    numeric default 0,
  bets         jsonb default '[]'::jsonb,              -- historique complet des paris
  pending      jsonb default '[]'::jsonb,              -- paris en cours non réglés
  day_start    jsonb default '{}'::jsonb,              -- { 'yyyy-mm-dd': solde de début }
  fail_reason  text,
  updated_at   timestamptz default now(),
  unique (user_id, vertical)
);
create index if not exists idx_accounts_user on public.accounts(user_id);
create index if not exists idx_accounts_status on public.accounts(status);

-- ============================================================
-- 3. PAYMENTS  (transactions : achats challenge, payouts)
-- ============================================================
create table if not exists public.payments (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,                            -- 'Challenge' | 'Retrait'
  label      text not null,
  amount     numeric not null,
  direction  text not null check (direction in ('in', 'out')),
  at         timestamptz default now()
);
create index if not exists idx_payments_user on public.payments(user_id, at desc);

-- ============================================================
-- 4. CONTACTS  (formulaire de contact public)
-- ============================================================
create table if not exists public.contacts (
  id        uuid default gen_random_uuid() primary key,
  name      text not null,
  email     text not null,
  subject   text,
  message   text not null,
  handled   boolean default false,
  at        timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.payments enable row level security;
alter table public.contacts enable row level security;

-- PROFILES : chacun lit/édite son propre profil
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- ACCOUNTS : chacun lit/édite ses propres comptes
drop policy if exists "accounts_select_own" on public.accounts;
drop policy if exists "accounts_insert_own" on public.accounts;
drop policy if exists "accounts_update_own" on public.accounts;
drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_select_own" on public.accounts for select using (auth.uid() = user_id);
create policy "accounts_insert_own" on public.accounts for insert with check (auth.uid() = user_id);
create policy "accounts_update_own" on public.accounts for update using (auth.uid() = user_id);
create policy "accounts_delete_own" on public.accounts for delete using (auth.uid() = user_id);

-- PAYMENTS : chacun lit/écrit ses paiements
drop policy if exists "payments_select_own" on public.payments;
drop policy if exists "payments_insert_own" on public.payments;
create policy "payments_select_own" on public.payments for select using (auth.uid() = user_id);
create policy "payments_insert_own" on public.payments for insert with check (auth.uid() = user_id);

-- CONTACTS : tout le monde peut INSERT (formulaire public), personne ne peut SELECT côté client.
-- Les admins lisent les contacts via la service_role key depuis le dashboard ou une edge function.
drop policy if exists "contacts_insert_public" on public.contacts;
create policy "contacts_insert_public" on public.contacts for insert with check (true);

-- ============================================================
-- Helper : mise à jour automatique du timestamp updated_at sur accounts
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute procedure public.touch_updated_at();

-- ============================================================
-- Fin du script. Si tout s'est bien passé :
--   → 4 tables visibles dans Table Editor (profiles, accounts, payments, contacts)
--   → RLS = "Enabled" sur les 4 (cadenas vert)
--   → 1 trigger sur auth.users (visible dans Database → Triggers)
-- ============================================================
