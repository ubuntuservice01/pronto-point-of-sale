-- When a branch elects optional cashier opening, a sale can have no physical drawer.
-- The cash-policy RPC, tenant-scoped sales RPC and idempotency still validate every write.
-- Existing sale rows are unchanged. NULL session_id means "not reconciled to drawer".
alter table public.pronto_sales alter column session_id drop not null;
