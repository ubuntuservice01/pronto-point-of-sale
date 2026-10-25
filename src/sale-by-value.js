// All prices are integer centavos and all stock quantities have at most three decimals.
// Never alter the amount requested by a customer to hide a rounding difference.
export const DISCRETE_SALE_UNITS = ['un', 'caixa', 'pacote', 'saco', 'rolo', 'par', 'conjunto'];

export function allowsFractionalSale(product) {
  if (!product) return false;
  if (DISCRETE_SALE_UNITS.includes(product.unit)) return false;
  // Existing catalogues did not store this field: preserve their prior behaviour.
  return product.allowFractional ?? !DISCRETE_SALE_UNITS.includes(product.unit);
}

export function validateSaleQuantity(product, quantity, available = product?.stock) {
  if (!product || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 ||
    !Number.isFinite(available) || quantity > available + 0.0000001 ||
    Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001 ||
    (!allowsFractionalSale(product) && !Number.isInteger(quantity))) {
    throw Error('quantity_invalid');
  }
  return quantity;
}

export function quantityFromValueCents({priceCents, amountCents, product, available = product?.stock}) {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0 ||
    !Number.isSafeInteger(amountCents) || amountCents <= 0) throw Error('amount_invalid');
  const raw = amountCents / priceCents;
  const quantity = allowsFractionalSale(product) ? Math.round(raw * 1000) / 1000 : Math.round(raw);
  if (!quantity || Math.round(priceCents * quantity) !== amountCents) {
    throw Error('amount_unrepresentable');
  }
  validateSaleQuantity(product, quantity, available);
  return quantity;
}

export function saleQuantityLabel(quantity, unit) {
  const text = new Intl.NumberFormat('pt-MZ', {maximumFractionDigits: 3}).format(quantity);
  if (unit === 'kg' && quantity < 1) return `${text} kg (${Math.round(quantity * 1000)} g)`;
  if (unit === 'l' && quantity < 1) return `${text} l (${Math.round(quantity * 1000)} ml)`;
  return `${text} ${unit}`;
}
