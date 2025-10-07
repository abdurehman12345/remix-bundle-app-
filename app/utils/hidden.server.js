// Lightweight in-memory cache for hidden product handles per shop
// TTL: 5 minutes

const HIDDEN_TAGS = [
  'hidden_addon',
  'hidden-product',
  'hidden_product',
  'bundle-addon',
  'bundle_addon',
];

const cacheByShop = new Map(); // shop -> { set: Set<string>, expiresAt: number }

export function isHiddenTagMatch(tagsStringOrArray) {
  try {
    if (!tagsStringOrArray) return false;
    const list = Array.isArray(tagsStringOrArray)
      ? tagsStringOrArray.map((t) => String(t || '').toLowerCase())
      : String(tagsStringOrArray || '')
          .split(',')
          .map((t) => t.trim().toLowerCase());
    return HIDDEN_TAGS.some((t) => list.some((x) => x.includes(t)));
  } catch (_) { return false; }
}

export async function getHiddenHandlesForShop(shop, accessToken) {
  if (!shop || !accessToken) return new Set();
  const now = Date.now();
  const hit = cacheByShop.get(shop);
  if (hit && hit.expiresAt > now) return hit.set;

  try {
    const url = `https://${shop}/admin/api/2024-10/products.json?limit=250&fields=handle,tags`;
    let nextLink = url;
    const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
    const handles = new Set();

    for (let i = 0; i < 20 && nextLink; i++) {
      const res = await fetch(nextLink, { headers });
      if (!res.ok) break;
      const data = await res.json();
      const products = data?.products || [];
      for (const p of products) {
        if (isHiddenTagMatch(p?.tags)) handles.add(p.handle);
      }
      // Handle pagination via Link header
      const link = res.headers.get('link') || res.headers.get('Link');
      if (!link || !/rel="next"/i.test(link)) { nextLink = null; break; }
      const m = link.match(/<([^>]+)>;\s*rel="next"/i);
      nextLink = m ? m[1] : null;
    }

    const entry = { set: handles, expiresAt: now + 5 * 60 * 1000 };
    cacheByShop.set(shop, entry);
    return handles;
  } catch (_) {
    return new Set();
  }
}

export { HIDDEN_TAGS };


