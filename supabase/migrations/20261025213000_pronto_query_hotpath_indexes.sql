-- Pronto POS: indexes for tenant/branch-scoped POS lists and operating reports.
-- Read-only query optimisation: no changes to permissions, RLS or business data.
-- Existing indexes already cover sale_items.sale_id, batches.product_id/expiry,
-- sales by seller/date, sales by business/date and idempotent writes.

-- Branch-specific sales and daily financial reports.
create index if not exists pronto_sales_business_branch_created_idx
 on public.pronto_sales (business_id, branch_id, created_at desc);

-- Product catalog by shop/branch, displayed alphabetically in stock screens.
-- Also supports the composite branch foreign-key lookups.
create index if not exists pronto_products_business_branch_name_idx
 on public.pronto_products (business_id, branch_id, lower(name), id);

-- Recent expenses and purchases, including receipts retained after reversals.
create index if not exists pronto_expenses_business_branch_created_idx
 on public.pronto_expenses (business_id, branch_id, created_at desc);
create index if not exists pronto_purchases_business_branch_created_idx
 on public.pronto_purchases (business_id, branch_id, created_at desc);

-- Stock movements grouped by product for inventory history.
create index if not exists pronto_stock_movements_business_product_created_idx
 on public.pronto_stock_movements (business_id, product_id, created_at desc);

-- COGS calculation joins sale movements to sales via reference_id.
-- Exclude non-sale movements to limit index write/storage overhead.
create index if not exists pronto_stock_movements_sale_reference_idx
 on public.pronto_stock_movements (business_id, reference_id)
 where kind = 'sale';

-- Reports filter captured payments by business and calendar period.
create index if not exists pronto_payment_allocations_business_created_idx
 on public.pronto_payment_allocations (business_id, created_at desc);
create index if not exists pronto_debt_payments_business_created_idx
 on public.pronto_debt_payments (business_id, created_at desc);
