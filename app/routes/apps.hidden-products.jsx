import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Returns a minimal payload of product handles tagged hidden_addon or hidden_product
export const loader = async ({ request }) => {
  try {
    // Validate app proxy; don't fail storefront if proxy strictness changes
    try { await authenticate.public.appProxy(request); } catch (_) {}

    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    if (!shop) return json({ error: "Missing shop" }, { status: 400 });

    // Use the latest session to call Admin REST
    const shopSession = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: "desc" } });
    const accessToken = shopSession?.accessToken;
    if (!accessToken) return json({ error: "No admin session" }, { status: 401 });

    const adminFetch = async (path) => {
      const res = await fetch(`https://${shop}/admin/api/2024-10${path}`, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`Admin ${path} -> ${res.status}`);
      return res.json();
    };

    // Include persisted hidden product GIDs if saved previously and the current plan
    let savedProductGids = [];
    let plan = "FREE";
    try {
      const settings = await prisma.shopSettings.findUnique({ where: { shop } });
      if (settings?.plan) plan = settings.plan;
      if (settings?.languageJson) {
        const payload = JSON.parse(settings.languageJson || "{}") || {};
        const hp = payload.hiddenProducts || {};
        if (Array.isArray(hp.productGids)) savedProductGids = hp.productGids.filter(Boolean);
      }
    } catch (_) {}

    return json({ plan, savedProductGids }, { headers: { "Cache-Control": "public, max-age=10" } });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
};

export const action = async ({ request }) => {
  // Support CORS preflight for app proxy/editor
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Requested-With" } });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const url = new URL(request.url);
    let shop = url.searchParams.get("shop") || url.searchParams.get("shopify") || null;
    // Validate via app proxy when possible; do not hard-fail in editor
    try { await authenticate.public.appProxy(request); } catch (_) {}
    if (!shop) {
      shop = request.headers.get("x-shopify-shop-domain") || null;
    }
    if (!shop) return json({ ok: false, error: "Missing shop" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });

    // Check if shop has PRO plan - only PRO users can save hidden products
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    const plan = settings?.plan || "FREE";
    if (plan !== "PRO") {
      return json({ ok: false, error: "PRO plan required for product hiding feature" }, { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    let productGids = [];
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      if (Array.isArray(body.productGids)) productGids = body.productGids.filter(Boolean);
    } else {
      const form = await request.formData();
      const raw = form.get("productGids");
      if (raw) {
        try {
          const parsed = JSON.parse(String(raw));
          if (Array.isArray(parsed)) productGids = parsed.filter(Boolean);
        } catch (_) {
          productGids = String(raw).split(",").map(s => s.trim()).filter(Boolean);
        }
      }
    }

    let payload = {};
    try { payload = settings?.languageJson ? JSON.parse(settings.languageJson) : {}; } catch (_) { payload = {}; }
    payload.hiddenProducts = { productGids };

    await prisma.shopSettings.upsert({
      where: { shop },
      update: { languageJson: JSON.stringify(payload) },
      create: { shop, languageJson: JSON.stringify(payload) }
    });

    return json({ ok: true, savedCount: productGids.length }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("/apps/hidden-products save error", error);
    return json({ ok: false, error: "Save failed" }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
};


