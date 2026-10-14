import { sellerFinancialReport, sellerFinancialCsv, sellerReportDay } from './seller-finance.js';
import { paymentMethods } from './cash.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
 '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

const filters = { seller: 'all', from: sellerReportDay(), to: sellerReportDay() };

const labels = {
 pt: {
  title: 'Resumo financeiro por vendedor',
  intro: 'Consulte o movimento de cada colaborador por data e meio de pagamento.',
  seller: 'Vendedor', all: 'Todos os vendedores', from: 'De', to: 'Até',
  today: 'Hoje', export: 'Exportar CSV', sales: 'Vendas registadas',
  transactions: 'Vendas', credit: 'Vendas a crédito', refunds: 'Devoluções processadas',
  debt: 'Dívidas recebidas', received: 'Recebimentos líquidos', cash: 'Dinheiro',
  mpesa: 'M-Pesa', emola: 'e-Mola', transfer: 'Transferência',
  methods: 'Recebimentos por meio de pagamento', shifts: 'Turnos de caixa iniciados no período',
  expected: 'Saldo físico esperado', counted: 'Contado no fecho',
  difference: 'Diferença', open: 'Aberto', closed: 'Fechado', noShifts: 'Sem turnos iniciados neste período.',
  noSales: 'Ainda não há movimentos registados para os filtros seleccionados.',
  notes: 'Vendas a crédito não contam como recebimento. Os recebimentos incluem cobranças de dívidas antigas e descontam devoluções realizadas no período. Uma devolução é atribuída ao colaborador que a processou.',
  shiftNote: 'O saldo físico esperado de cada turno inclui fundo inicial, entradas e retiradas, e abrange o turno completo, mesmo quando atravessa mais de um dia. Não corresponde apenas às vendas em dinheiro do período.',
  wallets: 'Os valores de M-Pesa e e-Mola são registos confirmados manualmente no POS; não representam consulta automática dos saldos das carteiras.',
  noNames: 'Vendedor'
 },
 en: {
  title: 'Financial summary by seller',
  intro: 'Review each employee’s payments, sales and register shifts by date.',
  seller: 'Seller', all: 'All sellers', from: 'From', to: 'Until',
  today: 'Today', export: 'Export CSV', sales: 'Recorded sales',
  transactions: 'Sales', credit: 'Credit sales', refunds: 'Refunds processed',
  debt: 'Debt collected', received: 'Net receipts', cash: 'Cash',
  mpesa: 'M-Pesa', emola: 'e-Mola', transfer: 'Bank transfer',
  methods: 'Receipts by payment method', shifts: 'Cash shifts opened in this period',
  expected: 'Expected physical cash', counted: 'Counted at closing',
  difference: 'Difference', open: 'Open', closed: 'Closed', noShifts: 'No shifts opened in this period.',
  noSales: 'No movements have been recorded for these filters.',
  notes: 'Credit sales are not cash receipts. Receipts include older debt collections and exclude refunds processed in this period. Refunds are attributed to the person processing them.',
  shiftNote: 'Expected physical cash includes the opening balance, deposits and withdrawals, and covers the entire shift even if it spans multiple days. It is not just cash sales in the selected period.',
  wallets: 'M-Pesa and e-Mola values are manually confirmed POS entries, not automatic mobile-wallet balance checks.',
  noNames: 'Seller'
 }
};
function directory(state, tenantId) {
 const persons = new Map();
 for (const member of [...(state.members || []), ...(state.sellerDirectory || [])]) {
  if (member.tenantId === tenantId && member.id) persons.set(member.id, member.name);
 }
 for (const entity of [...(state.sales || []), ...(state.refunds || []), ...(state.debtPayments || []), ...(state.cashSessions || [])]) {
  if (entity.tenantId === tenantId) {
   const id = entity.userId || 'unknown';
   if (!persons.has(id)) persons.set(id, id === 'unknown' ? 'Não identificado' : 'Vendedor (' + id.slice(0, 8) + ')');
  }
 }
 return [...persons].sort((a, b) => a[1].localeCompare(b[1], 'pt'));
}
function moneyCard(label, amount, money) {
 return '<article><small>' + escape(label) + '</small><strong>' + escape(money(amount)) + '</strong></article>';
}
function methodsHTML(amounts, l, money) {
 return '<div class="management-stats report-kpis seller-payment-grid">' + paymentMethods.map(method =>
  moneyCard(l[method], amounts[method], money)
 ).join('') + '</div>';
}
function shiftHTML(shift, l, lang, money) {
 const date = new Date(shift.openedAt).toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-GB', { timeZone: 'Africa/Maputo' });
 const state = shift.status === 'closed' ? l.closed : l.open;
 return '<div class="seller-shift">' +
  '<div><strong>' + escape(state) + '</strong><small>' + escape(date) + '</small></div>' +
  '<div><small>' + escape(l.expected) + '</small><strong>' + escape(money(shift.expectedCash)) + '</strong></div>' +
  (shift.countedCash === null ? '' : '<div><small>' + escape(l.counted) + '</small><strong>' + escape(money(shift.countedCash)) + '</strong></div>' +
   '<div><small>' + escape(l.difference) + '</small><strong>' + escape(money(shift.differenceCash)) + '</strong></div>') +
  '</div>';
}

export function sellerFinanceSection({ state, tenantId, lang = 'pt', money }) {
 const l = labels[lang] || labels.pt;
 const persons = directory(state, tenantId);
 if (filters.seller !== 'all' && !persons.some(([id]) => id === filters.seller)) filters.seller = 'all';
 const report = sellerFinancialReport(state, tenantId, {
  from: filters.from, to: filters.to, userId: filters.seller
 });
 const t = report.totals;
 const sellerCards = report.sellers.map(s => {
  return '<article class="panel seller-report-card">' +
   '<div class="seller-report-title"><div><h3>' + escape(s.name) + '</h3><small>' + s.salesCount + ' ' + escape(l.transactions.toLowerCase()) + '</small></div>' +
    '<div><small>' + escape(l.sales) + '</small><strong>' + escape(money(s.grossSales)) + '</strong></div></div>' +
   '<h4>' + escape(l.methods) + '</h4>' + methodsHTML(s.receivedByMethod, l, money) +
   '<div class="seller-additional">' +
    '<div><small>' + escape(l.credit) + '</small><strong>' + escape(money(s.creditSales)) + '</strong></div>' +
    '<div><small>' + escape(l.refunds) + '</small><strong>' + escape(money(s.refundsProcessed)) + '</strong></div>' +
    '<div><small>' + escape(l.debt) + '</small><strong>' + escape(money(s.debtCollections)) + '</strong></div>' +
    '<div><small>' + escape(l.received) + '</small><strong>' + escape(money(s.receiptsTotal)) + '</strong></div></div>' +
   '<h4>' + escape(l.shifts) + '</h4>' +
   (s.shifts.length ? s.shifts.map(shift => shiftHTML(shift, l, lang, money)).join('') :
    '<p class="info-note">' + escape(l.noShifts) + '</p>') +
   '</article>';
 }).join('');

 return '<section class="seller-finance" aria-labelledby="seller-finance-title">' +
  '<div class="page-heading"><div><p class="eyebrow">PRONTO POS · CONTROLO FINANCEIRO</p>' +
  '<h2 id="seller-finance-title">' + escape(l.title) + '</h2><p>' + escape(l.intro) + '</p></div></div>' +
  '<section class="panel report-toolbar seller-toolbar">' +
   '<label>' + escape(l.seller) + '<select id="seller-finance-user"><option value="all">' + escape(l.all) + '</option>' +
   persons.map(([id, name]) => '<option value="' + escape(id) + '"' + (id === filters.seller ? ' selected' : '') + '>' + escape(name) + '</option>').join('') +
   '</select></label>' +
   '<label>' + escape(l.from) + '<input id="seller-finance-from" type="date" value="' + escape(filters.from) + '"></label>' +
   '<label>' + escape(l.to) + '<input id="seller-finance-to" type="date" value="' + escape(filters.to) + '"></label>' +
   '<button id="seller-finance-today" class="secondary">' + escape(l.today) + '</button>' +
   '<button id="seller-finance-export" class="primary">' + escape(l.export) + '</button>' +
  '</section>' +
  '<section class="management-stats report-kpis seller-total-grid" aria-label="' + escape(l.title) + '">' +
   moneyCard(l.sales, t.grossSales, money) + moneyCard(l.received, t.receiptsTotal, money) +
   moneyCard(l.credit, t.creditSales, money) + moneyCard(l.refunds, t.refundsProcessed, money) +
  '</section>' +
  '<section class="panel"><h3>' + escape(l.methods) + '</h3>' + methodsHTML(t.receivedByMethod, l, money) + '</section>' +
  '<div class="seller-report-list">' + (sellerCards || '<section class="panel empty-state"><p>' + escape(l.noSales) + '</p></section>') + '</div>' +
  '<p class="info-note">' + escape(l.notes) + '</p><p class="info-note">' + escape(l.shiftNote) +
  '</p><p class="info-note">' + escape(l.wallets) + '</p></section>';
}

export function bindSellerFinance({ page, getState, getTenantId, lang, render, toast }) {
 if (page !== 'reports') return;
 const seller = document.getElementById('seller-finance-user');
 const from = document.getElementById('seller-finance-from');
 const to = document.getElementById('seller-finance-to');
 const today = document.getElementById('seller-finance-today');
 const exportButton = document.getElementById('seller-finance-export');
 if (seller) seller.onchange = () => { filters.seller = seller.value; render(); };
 if (from) from.onchange = () => {
  filters.from = from.value || sellerReportDay();
  if (filters.from > filters.to) filters.to = filters.from;
  render();
 };
 if (to) to.onchange = () => {
  filters.to = to.value || sellerReportDay();
  if (filters.from > filters.to) filters.from = filters.to;
  render();
 };
 if (today) today.onclick = () => { filters.from = sellerReportDay(); filters.to = filters.from; render(); };
 if (exportButton) exportButton.onclick = () => {
  try {
   const report = sellerFinancialReport(getState(), getTenantId(), {
    from: filters.from, to: filters.to, userId: filters.seller
   });
   const csv = sellerFinancialCsv(report, lang);
   const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
   const url = URL.createObjectURL(blob);
   const anchor = document.createElement('a');
   anchor.href = url;
   anchor.download = 'pronto-vendedores-' + filters.from + '-a-' + filters.to + '.csv';
   document.body.append(anchor); anchor.click(); anchor.remove();
   setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast(lang === 'pt' ? 'Não foi possível exportar o relatório.' : 'Could not export report.'); }
 };
}
