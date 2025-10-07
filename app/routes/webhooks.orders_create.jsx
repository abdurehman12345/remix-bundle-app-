import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  // Validate webhook signature
  try { await authenticate.webhook(request); } catch (err) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let payload = null;
  try { payload = await request.json(); } catch (_) {}
  if (!payload || !payload.order_number) {
    return json({ ok: true });
  }

  const shop = request.headers.get('x-shopify-shop-domain');
  if (!shop) return json({ ok: true });

  try {
    // Find access token for shop
    const shopSession = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });
    const accessToken = shopSession?.accessToken;
    if (!accessToken) return json({ ok: true });

    const discounts = Array.isArray(payload.discount_applications) ? payload.discount_applications : [];
    const codes = discounts
      .filter(d => (d.type === 'discount_code' || d.code) && typeof d.code === 'string')
      .map(d => d.code)
      .filter(code => code && code.startsWith('BNDL-'));

    for (const code of codes) {
      try {
        // Lookup price rule by code
        const lookupRes = await fetch(`https://${shop}/admin/api/2024-10/discount_codes/lookup.json?code=${encodeURIComponent(code)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        });
        if (!lookupRes.ok) continue;
        const lj = await lookupRes.json();
        const priceRuleId = lj?.discount_code?.price_rule_id;
        if (!priceRuleId) continue;

        // Delete the price rule to invalidate any future use
        await fetch(`https://${shop}/admin/api/2024-10/price_rules/${priceRuleId}.json`, {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': accessToken },
        });
      } catch (_) {}
    }
  } catch (_) {}

  return json({ ok: true });
};
