-- Pronto POS: harden default debt ledger privileges (20/10/2026).
-- Preserve existing RLS and legitimate authenticated SELECT.
-- All commercial writes must continue through authorised server-side RPCs.
REVOKE ALL PRIVILEGES ON TABLE public.pronto_debt_ledger FROM anon, authenticated;
GRANT SELECT ON TABLE public.pronto_debt_ledger TO authenticated;
