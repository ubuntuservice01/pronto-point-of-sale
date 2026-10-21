-- Private arithmetic helper must never be executable by merchant JWT roles.
-- It is called only from the privileged, tenant-scoped cash-control function.
revoke all on function pronto_private.cash_totals(uuid,uuid) from public, anon, authenticated;
