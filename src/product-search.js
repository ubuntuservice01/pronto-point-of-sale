// Pure, accent-insensitive product filtering used by the cashier and barcode search.
const normalise = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();

export function matchesSaleProduct(product, query = '', category = '') {
 if (!product || product.active === false || (category && product.category !== category)) return false;
 const term = normalise(query);
 if (!term) return true;
 return normalise(product.name).includes(term) || normalise(product.code).includes(term);
}

export function productByExactCode(products, query) {
 const code = normalise(query);
 if (!code) return null;
 return (products || []).find(product => product && product.active !== false && normalise(product.code) === code) || null;
}
