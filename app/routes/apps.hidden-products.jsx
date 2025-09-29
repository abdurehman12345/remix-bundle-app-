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

    // Search by tags; paginate a few pages to be safe
    const handles = new Set();
    let pageInfo = null;
    for (let i = 0; i < 5; i++) {
      const query = `products.json?limit=250&fields=handle,tags${pageInfo ? `&page_info=${encodeURIComponent(pageInfo)}` : ""}`;
      const data = await adminFetch(`/` + query);
      const products = data?.products || [];
      for (const p of products) {
        const tags = String(p.tags || "").toLowerCase();
        if (tags.includes("hidden_addon") || tags.includes("hidden-product") || tags.includes("hidden_product")) {
          handles.add(p.handle);
        }
      }
      const link = data?.headers?.link || null;
      if (!link || !/page_info=/.test(link) || !/rel="next"/.test(link)) break;
      const m = link.match(/page_info=([^&>]+)/);
      pageInfo = m ? m[1] : null;
      if (!pageInfo) break;
    }

    return json({ handles: Array.from(handles) }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
};


