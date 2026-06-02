-- ============================================================
-- Spovibe — Migration Admin (Phase 2b)
-- À coller dans Supabase Dashboard → SQL Editor → New query → Run
-- AVANT d'ajouter quoi que ce soit, fais d'abord 001_init.sql.
-- ============================================================

-- 1. Table des admins (whitelist par UUID auth)
create table if not exists public.admins (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  added_at    timestamptz default now()
);

alter table public.admins enable row level security;

-- 2. Fonction helper : auth.uid() est-il dans la whitelist ?
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admins where id = auth.uid());
$$;

-- 3. Policies admin : lecture globale sur tout
drop policy if exists "admins_select_admins" on public.admins;
create policy "admins_select_admins" on public.admins for select using (public.is_admin());

drop policy if exists "profiles_admin_select_all" on public.profiles;
create policy "profiles_admin_select_all" on public.profiles for select using (public.is_admin());

drop policy if exists "accounts_admin_select_all" on public.accounts;
create policy "accounts_admin_select_all" on public.accounts for select using (public.is_admin());

drop policy if exists "payments_admin_select_all" on public.payments;
create policy "payments_admin_select_all" on public.payments for select using (public.is_admin());

drop policy if exists "contacts_admin_select_all" on public.contacts;
create policy "contacts_admin_select_all" on public.contacts for select using (public.is_admin());

-- ============================================================
-- Étape MANUELLE — ajoute ton propre user_id à la whitelist :
--   1. Crée d'abord ton compte normal via /signup.html (déjà fait normalement).
--   2. Va dans Supabase Dashboard → Authentication → Users → copie ton UUID.
--   3. Reviens ici dans SQL Editor → New Query → exécute :
--
--        insert into public.admins (id, email)
--        values ('TON-UUID-COPIE-ICI', 'thibautjordan1993@gmail.com');
--
--   4. Désormais, depuis ton login, tu peux requêter accounts/payments/profiles
--      de TOUS les users (via /admin.html section "Utilisateurs").
-- ============================================================
