// Internal codes are unique within a shop and remain stable after registration.
// Keep a per-shop high-water mark so edited or removed products cannot recycle codes.
const format = value => 'PR-' + String(value).padStart(6, '0');
const internal = /^PR-(\d{6,})$/i;
export function nextProductCode(state, tenantId) {
 if (!tenantId) throw Error('tenant');
 const products = (state.products || []).filter(p => p.tenantId === tenantId);
 let sequence = Number.isSafeInteger(state.productCodeSequences?.[tenantId])
  ? state.productCodeSequences[tenantId] : 0;
 const occupied = new Set();
 for (const product of products) {
  const code = String(product.code || '').trim().toUpperCase();
  if (!code) continue;
  occupied.add(code);
  const match = code.match(internal);
  if (match && Number.isSafeInteger(Number(match[1]))) sequence = Math.max(sequence, Number(match[1]));
 }
 do { sequence++; } while (occupied.has(format(sequence)) && sequence < Number.MAX_SAFE_INTEGER);
 if (!Number.isSafeInteger(sequence)) throw Error('code_limit');
 return { code: format(sequence), sequence };
}
export function allocateProductCode(state, tenantId, desired = '') {
 const requested = String(desired ?? '').trim();
 if (requested.length > 80) throw Error('code');
 const occupied = (state.products || []).filter(p => p.tenantId === tenantId);
 if (requested && occupied.some(p => String(p.code || '').trim().toUpperCase() === requested.toUpperCase())) throw Error('code');
 const suggested = nextProductCode(state, tenantId);
 const code = requested || suggested.code;
 const match = code.toUpperCase().match(internal);
 const sequence = match && Number.isSafeInteger(Number(match[1]))
  ? Math.max(suggested.sequence - 1, Number(match[1]))
  : suggested.sequence - 1;
 return { code, productCodeSequences: { ...(state.productCodeSequences || {}), [tenantId]: sequence } };
}
