-- Supabase keeps database timestamps in UTC. The four transactional functions
-- below use CURRENT_DATE to decide whether dated stock is valid for sale,
-- return or transfer. In Mozambique, midnight is 22:00 UTC; without a
-- function-local timezone, lots expiring today can remain sellable for two
-- hours after local midnight.
--
-- Keep the database/session default UTC. PostgreSQL restores each caller's
-- timezone when the function exits, and its existing grants, RLS and body stay
-- unchanged. Apply again if a later migration replaces these functions.
alter function pronto_private.merchant_action(text,jsonb)
  set timezone to 'Africa/Maputo';
alter function pronto_private.credit_action(text,jsonb)
  set timezone to 'Africa/Maputo';
alter function pronto_private.return_action(text,jsonb)
  set timezone to 'Africa/Maputo';
alter function pronto_private.transfer_action(text,jsonb)
  set timezone to 'Africa/Maputo';
