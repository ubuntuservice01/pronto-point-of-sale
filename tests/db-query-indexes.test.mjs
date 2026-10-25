import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261025213000_pronto_query_hotpath_indexes.sql',import.meta.url),'utf8').toLowerCase();

test('hot-path indexes all have tenant-leading business_id keys',()=>{
 const statements=sql.match(/create index if not exists[\s\S]*?;/g)||[];
 assert.equal(statements.length,8);
 for(const statement of statements){
  assert.match(statement,/on public\.pronto_\w+\s*\(business_id\s*,/);
  assert.doesNotMatch(statement,/\b(drop|delete|update|truncate|alter)\b/);
 }
});

test('branch sales, catalog, expenses, purchases and stock movements use relevant composite keys',()=>{
 for(const pattern of [
  /on public\.pronto_sales\s*\(business_id, branch_id, created_at desc\)/,
  /on public\.pronto_products\s*\(business_id, branch_id, lower\(name\), id\)/,
  /on public\.pronto_expenses\s*\(business_id, branch_id, created_at desc\)/,
  /on public\.pronto_purchases\s*\(business_id, branch_id, created_at desc\)/,
  /on public\.pronto_stock_movements\s*\(business_id, product_id, created_at desc\)/,
 ])assert.match(sql,pattern);
});

test('sale reference index is partial and payment indexes are date-aware',()=>{
 assert.match(sql,/on public\.pronto_stock_movements\s*\(business_id, reference_id\)\s*where kind = 'sale'/);
 assert.match(sql,/on public\.pronto_payment_allocations\s*\(business_id, created_at desc\)/);
 assert.match(sql,/on public\.pronto_debt_payments\s*\(business_id, created_at desc\)/);
});
