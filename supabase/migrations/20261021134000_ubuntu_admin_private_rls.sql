-- Defence in depth; sensitive audit and receipts remain callable only via guarded RPCs.
alter table pronto_private.admin_control_log enable row level security;
alter table pronto_private.platform_payments enable row level security;
