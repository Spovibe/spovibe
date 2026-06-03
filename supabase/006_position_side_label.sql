-- ============================================================
-- Spovibe — Ajouter side_label aux positions Polymarket
--
-- Aujourd'hui : on stocke uniquement side = "Yes" ou "No".
-- → Affichage "Pari sur Yes" alors que l'user a parié sur "Auger-Aliassime".
--
-- Après : on stocke aussi side_label (ex "Auger-Aliassime" / "Cobolli" pour
-- les matchs binaires, "Up" / "Down" pour BTC 5min, sinon "Oui" / "Non").
-- L'affichage devient lisible.
--
-- À COLLER UNE SEULE FOIS dans Supabase Dashboard → SQL Editor → Run.
-- ============================================================

alter table public.predictions_positions
  add column if not exists side_label text;

-- ============================================================
-- Vérification :
--   select id, side, side_label from public.predictions_positions
--   order by opened_at desc limit 10;
--
-- Les anciennes lignes auront side_label = NULL.
-- Les nouvelles lignes (placées après ce push) auront le bon label.
-- ============================================================
