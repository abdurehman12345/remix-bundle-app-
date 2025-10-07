import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function buildCorsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, X-Shopify-Shop-Domain",
    "Cache-Control": "no-store",
  };
}

export const loader = async ({ request }) =>
  json({ error: "Method not allowed" }, { status: 405, headers: buildCorsHeaders(request) });

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
    // Validate via app proxy when possible, but don't hard-fail in editor/dev
    try { await authenticate.public.appProxy(request); } catch (_) {}
    if (!shop) {
      shop = request.headers.get("x-shopify-shop-domain") || null;
    }
    if (!shop) return json({ ok: false, error: "Missing shop" }, { status: 400, headers: corsHeaders });

    // Find current settings; allow saving even on FREE so choices persist.
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });

    const form = await request.formData();
    const op = settings ? 'update' : 'create';
    const args = settings ? { where: { shop }, data: {
      heroEnabled: String(form.get("heroEnabled") || "") === "on",
      heroTitle: String(form.get("heroTitle") || ""),
      heroSubtitle: String(form.get("heroSubtitle") || ""),
      heroEmoji: String(form.get("heroEmoji") || ""),
      heroColorStart: String(form.get("heroColorStart") || ""),
      heroColorEnd: String(form.get("heroColorEnd") || ""),
    }} : { data: {
      shop,
      heroEnabled: String(form.get("heroEnabled") || "") === "on",
      heroTitle: String(form.get("heroTitle") || ""),
      heroSubtitle: String(form.get("heroSubtitle") || ""),
      heroEmoji: String(form.get("heroEmoji") || ""),
      heroColorStart: String(form.get("heroColorStart") || ""),
      heroColorEnd: String(form.get("heroColorEnd") || ""),
    }};
    // @ts-ignore - dynamic method name
    await prisma.shopSettings[op](args);

    return json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("/apps/bundles/hero save error", error);
    return json({ ok: false }, { status: 500, headers: corsHeaders });
  }
};


