import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, createSale } from '../src/model.js';
import { openCash, closeCash, attachCashSale } from '../src/cash.js';
import { sellerFinancialReport, sellerFinancialCsv, sellerReportDay } from '../src/seller-finance.js';
import { sellerFinanceSection } from '../src/seller-finance-ui.js';
import { createStore } from '../server/store.mjs';

const sale = (id, userId, method, total, createdAt, extra = {}) => ({
 id, tenantId: 't1', userId, method, total, createdAt, ...extra
});
const onDay = { from: '2026-10-14', to: '2026-10-14' };

test('20 000 MT of seller sales are separated between cash, M-Pesa and e-Mola', () => {
 const s = seed();
 s.sales = [
  sale('c', 'u2', 'cash', 1000000, '2026-10-14T07:00:00Z'),
  sale('m', 'u2', 'mpesa', 500000, '2026-10-14T08:00:00Z'),
  sale('e', 'u2', 'emola', 500000, '2026-10-14T09:00:00Z'),
  sale('another-user', 'u1', 'cash', 30000, '2026-10-14T09:00:00Z'),
  sale('another-store', 'u2', 'cash', 5000000, '2026-10-14T09:00:00Z', { tenantId: 't2' })
 ];
 const report = sellerFinancialReport(s, 't1', { ...onDay, userId: 'u2' });
 assert.equal(report.sellers.length, 1);
 assert.equal(report.sellers[0].name, 'Maria');
 assert.equal(report.totals.salesCount, 3);
 assert.equal(report.totals.grossSales, 2000000);
 assert.deepEqual(report.totals.receivedByMethod, {
  cash: 1000000, mpesa: 500000, emola: 500000, transfer: 0, bank: 0
 });
 assert.equal(report.totals.receiptsTotal, 2000000);
 assert.equal(report.sellers[0].shifts.length, 0);
});

test('Mozambique local date boundary includes late UTC events exactly once', () => {
 assert.equal(sellerReportDay('2026-10-13T22:30:00Z'), '2026-10-14');
 assert.equal(sellerReportDay('2026-10-14T22:00:00Z'), '2026-10-15');
 const s = seed();
 s.sales = [
  sale('start', 'u2', 'cash', 10000, '2026-10-13T22:30:00Z'),
  sale('end', 'u2', 'cash', 20000, '2026-10-14T21:59:59Z'),
  sale('next', 'u2', 'cash', 30000, '2026-10-14T22:00:00Z')
 ];
 assert.equal(sellerFinancialReport(s, 't1', onDay).totals.grossSales, 30000);
 assert.throws(() => sellerFinancialReport(s, 't1', { from: '2026-10-15', to: '2026-10-14' }), /seller_report_date/);
});

test('Split payments, credit, refunds and debt collections stay in the correct columns and operator', () => {
 const s = seed();
 s.sales = [
  sale('split', 'u2', 'mixed', 150000, '2026-10-14T12:00:00Z',
   { payments: [{ method: 'cash', amount: 50000 }, { method: 'emola', amount: 100000 }] }),
  sale('credit', 'u2', 'credit', 70000, '2026-10-14T13:00:00Z'),
  sale('original', 'u1', 'mpesa', 20000, '2026-10-10T12:00:00Z')
 ];
 s.refunds = [{
  id: 'refund', tenantId: 't1', saleId: 'original', userId: 'u2', total: 20000,
  payments: [{ method: 'mpesa', amount: 20000 }], createdAt: '2026-10-14T15:00:00Z'
 }];
 s.debtPayments = [{
  id: 'collection', tenantId: 't1', userId: 'u2', amount: 30000, method: 'transfer',
  createdAt: '2026-10-14T17:00:00Z'
 }];
 const report = sellerFinancialReport(s, 't1', { ...onDay, userId: 'u2' });
 const r = report.sellers[0];
 assert.equal(r.grossSales, 220000);
 assert.equal(r.creditSales, 70000);
 assert.equal(r.refundsProcessed, 20000);
 assert.equal(r.debtCollections, 30000);
 assert.deepEqual(r.receivedByMethod, { cash: 50000, mpesa: -20000, emola: 100000, transfer: 30000, bank: 0 });
 assert.equal(r.receiptsTotal, 160000);
 assert.equal(r.salesCount, 2);
 assert.equal(report.totals.grossSales, 220000);
 assert.equal(sellerFinancialReport(s, 't1', { ...onDay, userId: 'u1' }).totals.receiptsTotal, 0);
});

test('Cash drawer balance includes opening float and differs from cash taken from customers', () => {
 const context = { tenantId: 't1', userId: 'u2', deviceId: 'phone' };
 let s = openCash(seed(), context, 5000);
 s = createSale(s, {
  ...context, role: 'cashier', id: 'register-sale', cart: [{ productId: 'p1', quantity: 1 }],
  method: 'cash', received: 10000
 });
 s = attachCashSale(s, context, 'register-sale');
 const day = sellerReportDay();
 let row = sellerFinancialReport(s, 't1', { from: day, to: day, userId: 'u2' }).sellers[0];
 assert.equal(row.receivedByMethod.cash, 8500);
 assert.equal(row.shiftExpectedCash, 13500);
 assert.equal(row.shiftCountedCash, 0);
 assert.equal(row.shifts[0].countedCash, null);
 s = closeCash(s, context, { cash: 12500, mpesa: 0, emola: 0, transfer: 0 }, 'Diferença em investigação');
 row = sellerFinancialReport(s, 't1', { from: day, to: day, userId: 'u2' }).sellers[0];
 assert.equal(row.shiftExpectedCash, 13500);
 assert.equal(row.shiftCountedCash, 12500);
 assert.equal(row.shiftDifferenceCash, -1000);
 assert.equal(row.closedShiftCount, 1);
 assert.equal(row.shifts[0].status, 'closed');
});

test('Seller names are escaped in HTML and suspicious spreadsheet cells are neutralised', () => {
 const s = seed();
 s.sellerDirectory = [{ id: 'bad', tenantId: 't1', name: '=HYPERLINK("<script>")' }];
 s.sales = [sale('bad-sale', 'bad', 'cash', 100, new Date().toISOString())];
 const day = sellerReportDay();
 const report = sellerFinancialReport(s, 't1', { from: day, to: day });
 const html = sellerFinanceSection({ state: s, tenantId: 't1', lang: 'pt', money: String });
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));
 const csv = sellerFinancialCsv(report);
 assert.ok(csv.includes("'=HYPERLINK"));
 assert.ok(csv.includes('Dinheiro recebido MT'));
});

test('Authenticated seller directory is allowed for reporting roles, not cashier or another business', () => {
 const store = createStore(':memory:', { bootstrapUser: 'root-sellers', bootstrapPassword: 'VeryStrongBootstrap2026!', secure: false });
 try {
  const root = store.session(store.login('root-sellers', 'VeryStrongBootstrap2026!', 'root').token);
  const created = store.createBusiness(root, { name: 'Lojas A', type: 'Retail', owner: 'Ana' });
  const login = store.login(created.onboarding.username, created.onboarding.temporaryPassword, 'owner');
  store.changePassword(store.session(login.token), created.onboarding.temporaryPassword, 'NewStrongPassword2026!', login.token);
  const owner = store.session(login.token);
  const cashierCred = store.createMember(owner, { name: 'Maria', role: 'cashier' }).onboarding;
  const managerCred = store.createMember(owner, { name: 'Gerente', role: 'manager' }).onboarding;
  const cashierLogin = store.login(cashierCred.username, cashierCred.temporaryPassword, 'cash-device');
  store.changePassword(store.session(cashierLogin.token), cashierCred.temporaryPassword, 'CashPassword2026!', cashierLogin.token);
  const managerLogin = store.login(managerCred.username, managerCred.temporaryPassword, 'manager-device');
  store.changePassword(store.session(managerLogin.token), managerCred.temporaryPassword, 'ManagerPassword2026!', managerLogin.token);
  const cashier = store.snapshot(store.session(cashierLogin.token));
  const manager = store.snapshot(store.session(managerLogin.token));
  const owned = store.snapshot(owner);
  assert.deepEqual(cashier.sellerDirectory, []);
  assert.ok(manager.sellerDirectory.some(x => x.name === 'Maria'));
  assert.ok(owned.sellerDirectory.some(x => x.name === 'Maria'));
  assert.ok(owned.sellerDirectory.every(x => x.tenantId === owner.business_id));
 } finally { store.close(); }
});
