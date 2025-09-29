import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "false",
};

export const loader = async () => json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  try {
    // Validate app proxy and extract shop from query
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || url.searchParams.get("shopify") || null;
    try { await authenticate.public.appProxy(request); } catch (_) {}
    if (!shop) return json({ ok: false, error: "Missing shop" }, { status: 400, headers: corsHeaders });

    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    if (!settings || settings.plan !== "PRO") {
      return json({ ok: false, error: "Upgrade to Pro to customize the hero." }, { status: 403, headers: corsHeaders });
    }

    const form = await request.formData();
    await prisma.shopSettings.update({ where: { shop }, data: {
      heroEnabled: String(form.get("heroEnabled") || "") === "on",
      heroTitle: String(form.get("heroTitle") || ""),
      heroSubtitle: String(form.get("heroSubtitle") || ""),
      heroEmoji: String(form.get("heroEmoji") || ""),
      heroColorStart: String(form.get("heroColorStart") || ""),
      heroColorEnd: String(form.get("heroColorEnd") || ""),
    }});

    return json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("/apps/hero save error", error);
    return json({ ok: false }, { status: 500, headers: corsHeaders });
  }
};


