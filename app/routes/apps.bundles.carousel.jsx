import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function buildCorsHeaders(request) {
  const origin = request.headers.get('origin') || '*';
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-Shopify-Shop-Domain",
    "Cache-Control": "no-store",
  };
}

export const loader = async ({ request }) => json({ error: "Method not allowed" }, { status: 405, headers: buildCorsHeaders(request) });

export const action = async ({ request }) => {
  const corsHeaders = buildCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    let shop = url.searchParams.get("shop") || url.searchParams.get("shopify") || null;
    try { await authenticate.public.appProxy(request); } catch (_) {}
    if (!shop) {
      shop = request.headers.get('x-shopify-shop-domain') || null;
    }
    if (!shop) return json({ ok: false, error: "Missing shop" }, { status: 400, headers: corsHeaders });

    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    if (!settings || settings.plan !== "PRO") {
      // Allow saving even on FREE so choices persist, but they only apply partially
    }

    const form = await request.formData();
    const next = {
      style: String(form.get("style") || "slide"),
      cardStyle: String(form.get("cardStyle") || "minimal"),
      autoplay: String(form.get("autoplay") || "off") === "on",
      speedMs: Number(form.get("speedMs") || 3500) || 3500,
      buttonBg: (form.get("buttonBg") ? String(form.get("buttonBg")) : undefined) || undefined,
      badgeBg: (form.get("badgeBg") ? String(form.get("badgeBg")) : undefined) || undefined,
      containerBg: (form.get("containerBg") ? String(form.get("containerBg")) : undefined) || undefined,
    };

    // Persist inside languageJson to avoid a schema migration; namespaced under "carousel"
    let payload = {};
    try { payload = settings?.languageJson ? JSON.parse(settings.languageJson) : {}; } catch (_) {}
    payload.carousel = next;

    await prisma.shopSettings.upsert({
      where: { shop },
      update: { languageJson: JSON.stringify(payload) },
      create: { shop, languageJson: JSON.stringify(payload) }
    });
    return json({ ok: true, saved: next, ts: Date.now() }, { headers: corsHeaders });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("/apps/bundles/carousel save error", error);
    return json({ ok: false }, { status: 500, headers: buildCorsHeaders(request) });
  }
};


