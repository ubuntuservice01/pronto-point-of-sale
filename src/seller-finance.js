import { cashSummary, paymentMethods } from './cash.js';
import { csvCell } from './commercial.js';

// Dates in the seller report follow the shop's local calendar (Mozambique).
export function sellerReportDay(value = new Date()) {
 const date = new Date(value);
 if (!Number.isFinite(date.getTime())) return '';
 const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit'
 }).formatToParts(date);
 const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
 return [values.year, values.month, values.day].join('-');
}

const zeroMethods = () => Object.fromEntries(paymentMethods.map(method => [method, 0]));
const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
const paymentsOf = entry => Array.isArray(entry.payments) && entry.payments.length
 ? entry.payments
 : paymentMethods.includes(entry.method) ? [{ method: entry.method, amount: entry.total }] : [];

function sellerDirectory(state, tenantId) {
 const directory = new Map();
 for (const member of [...(state.members || []), ...(state.sellerDirectory || [])]) {
  if (member.tenantId === tenantId && member.id) directory.set(member.id, member.name);
 }
 return directory;
}

// Keep sales, cash receipts and whole-shift balances separate: they are not interchangeable.
export function sellerFinancialReport(state, tenantId, options = {}) {
 const from = options.from ?? sellerReportDay();
 const to = options.to ?? from;
 const userId = options.userId || 'all';
 if (!isoDate(from) || !isoDate(to) || from > to) throw Error('seller_report_date');
 const within = item => {
  const day = sellerReportDay(item.createdAt);
  return day >= from && day <= to;
 };
 const directory = sellerDirectory(state, tenantId);
 const rows = new Map();
 const include = id => userId === 'all' || id === userId;
 const get = rawId => {
  const id = rawId || 'unknown';
  if (!include(id)) return null;
  if (!rows.has(id)) rows.set(id, {
   userId: id,
   name: directory.get(id) || (id === 'unknown' ? 'Não identificado' : 'Vendedor (' + id.slice(0, 8) + ')'),
   salesCount: 0, grossSales: 0, creditSales: 0,
   refundsCount: 0, refundsProcessed: 0,
   debtPaymentsCount: 0, debtCollections: 0,
   receivedByMethod: zeroMethods(), receiptsTotal: 0,
   shifts: [], shiftExpectedCash: 0, shiftCountedCash: 0, shiftDifferenceCash: 0,
   closedShiftCount: 0
  });
  return rows.get(id);
 };
 const addPayments = (row, payments, direction = 1) => {
  for (const p of payments) if (paymentMethods.includes(p.method)) {
   row.receivedByMethod[p.method] += direction * p.amount;
  }
 };
 for (const sale of state.sales || []) {
  if (sale.tenantId !== tenantId || !within(sale)) continue;
  const row = get(sale.userId);
  if (!row) continue;
  row.salesCount++;
  row.grossSales += sale.total;
  if (sale.method === 'credit') row.creditSales += sale.total;
  else addPayments(row, paymentsOf(sale));
 }
 for (const refund of state.refunds || []) {
  if (refund.tenantId !== tenantId || !within(refund)) continue;
  // The operator who processed the refund is responsible for the money leaving the register.
  const row = get(refund.userId);
  if (!row) continue;
  row.refundsCount++;
  row.refundsProcessed += refund.total;
  addPayments(row, paymentsOf(refund), -1);
 }
 for (const receipt of state.debtPayments || []) {
  if (receipt.tenantId !== tenantId || !within(receipt)) continue;
  const row = get(receipt.userId);
  if (!row) continue;
  row.debtPaymentsCount++;
  row.debtCollections += receipt.amount;
  addPayments(row, [{ method: receipt.method, amount: receipt.amount }]);
 }
 for (const session of state.cashSessions || []) {
  if (session.tenantId !== tenantId) continue;
  // A shift's opening day determines its inclusion; its full balance may cross midnight.
  const day = sellerReportDay(session.openedAt);
  if (day < from || day > to) continue;
  const row = get(session.userId);
  if (!row) continue;
  const closed = session.status === 'closed';
  const summary = closed && session.closingSummary ? session.closingSummary : cashSummary(state, session);
  const expectedCash = summary.expected.cash;
  const countedCash = closed ? session.counted?.cash ?? null : null;
  const differenceCash = countedCash === null ? null : countedCash - expectedCash;
  row.shifts.push({
   id: session.id, openedAt: session.openedAt, closedAt: session.closedAt || null,
   status: session.status, deviceId: session.deviceId,
   expectedCash, countedCash, differenceCash
  });
  row.shiftExpectedCash += expectedCash;
  if (closed) {
   row.closedShiftCount++;
   if (countedCash !== null) {
    row.shiftCountedCash += countedCash;
    row.shiftDifferenceCash += differenceCash;
   }
  }
 }
 if (userId !== 'all' && !rows.has(userId)) get(userId);
 const sellers = [...rows.values()].map(row => ({
  ...row, receiptsTotal: Object.values(row.receivedByMethod).reduce((a, b) => a + b, 0),
  shifts: row.shifts.sort((a, b) => a.openedAt.localeCompare(b.openedAt))
 })).sort((a, b) => b.grossSales - a.grossSales || a.name.localeCompare(b.name, 'pt'));
 const totals = {
  salesCount: 0, grossSales: 0, creditSales: 0,
  refundsProcessed: 0, debtCollections: 0, receiptsTotal: 0,
  receivedByMethod: zeroMethods()
 };
 for (const row of sellers) {
  for (const key of ['salesCount', 'grossSales', 'creditSales', 'refundsProcessed', 'debtCollections', 'receiptsTotal']) totals[key] += row[key];
  for (const method of paymentMethods) totals.receivedByMethod[method] += row.receivedByMethod[method];
 }
 return { from, to, userId, sellers, totals };
}

export function sellerFinancialCsv(report, lang = 'pt') {
 const en = lang === 'en';
 const header = en
  ? ['From (Mozambique)', 'To (Mozambique)', 'Seller', 'Sales', 'Gross sales MT', 'Credit sales MT', 'Refunds processed MT', 'Debt collections MT', 'Cash received MT', 'M-Pesa MT', 'e-Mola MT', 'Transfer MT', 'Total received MT', 'Shift expected cash MT', 'Shift counted cash MT', 'Shift difference MT']
  : ['De (Moçambique)', 'Até (Moçambique)', 'Vendedor', 'Nº vendas', 'Vendas brutas MT', 'Vendas a crédito MT', 'Devoluções processadas MT', 'Dívidas recebidas MT', 'Dinheiro recebido MT', 'M-Pesa MT', 'e-Mola MT', 'Transferência MT', 'Total recebido MT', 'Saldo esperado dos turnos MT', 'Saldo contado dos turnos fechados MT', 'Diferenças dos turnos fechados MT'];
 const money = cents => (cents / 100).toFixed(2);
 const data = report.sellers.map(s => [
  report.from, report.to, s.name, s.salesCount, money(s.grossSales), money(s.creditSales),
  money(s.refundsProcessed), money(s.debtCollections),
  ...paymentMethods.map(m => money(s.receivedByMethod[m])),
  money(s.receiptsTotal), s.shifts.length ? money(s.shiftExpectedCash) : '',
  s.closedShiftCount ? money(s.shiftCountedCash) : '',
  s.closedShiftCount ? money(s.shiftDifferenceCash) : ''
 ]);
 return '\uFEFF' + [header, ...data].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
