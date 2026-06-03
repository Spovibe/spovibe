-- ============================================================
-- Spovibe — Migration : passer au modèle balance v2 pour Polymarket
--
-- Avant : placePosition déduisait immédiatement le stake du balance.
--   → Une position ouverte de 2000€ apparaissait comme une perte (-2000€ profit).
--
-- Après : balance reste intact à l'ouverture, on déduit/ajoute UNIQUEMENT à
-- la résolution (lost: -stake, won: +profit, cancelled: ±0).
--
-- Cette migration recrédite le balance de toutes les positions actuellement
-- OUVERTES (qui étaient en old model donc déjà débitées).
--
-- À COLLER UNE SEULE FOIS dans Supabase Dashboard → SQL Editor → Run.
-- ============================================================

update public.accounts
set balance = balance + (
  select coalesce(sum((p->>'stake')::numeric), 0)
  from jsonb_array_elements(pending) p
  where p->>'kind' = 'polymarket'
),
peak = greatest(peak, balance + (
  select coalesce(sum((p->>'stake')::numeric), 0)
  from jsonb_array_elements(pending) p
  where p->>'kind' = 'polymarket'
))
where vertical = 'predictions'
  and pending is not null
  and jsonb_array_length(pending) > 0
  and exists (
    select 1 from jsonb_array_elements(pending) p
    where p->>'kind' = 'polymarket'
  );

-- ============================================================
-- Vérification : run avant/après pour comparer
--
--   select id, balance, capital, jsonb_array_length(pending) as nb_pending
--   from public.accounts
--   where vertical = 'predictions';
--
-- Si avant tu avais "balance=98000, capital=100000, 1 pending de 2000",
-- après tu dois avoir "balance=100000, capital=100000, 1 pending de 2000".
-- ============================================================
