import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function toAbsoluteImageUrl(imageUrl, appBaseUrl) {
  if (!imageUrl) return imageUrl;
  const base = appBaseUrl?.replace(/\/$/, "") || "";
  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      const u = new URL(imageUrl);
      if (u.pathname.startsWith('/uploads/')) {
        return `${base}${u.pathname}`;
      }
      return imageUrl;
    } catch {
      return imageUrl;
    }
  }
  if (imageUrl.startsWith('/uploads/')) return `${base}${imageUrl}`;
  if (imageUrl.startsWith('uploads/')) return `${base}/${imageUrl}`;
  return imageUrl;
}

export const loader = async ({ request, params }) => {
  // Validate app proxy if available; skip gracefully in dev
  try { 
    await authenticate.public.appProxy(request); 
  } catch (_) {}

  const bundle = await prisma.bundle.findUnique({
    where: { id: params.bundleId },
    include: { 
      products: {
        orderBy: { createdAt: 'asc' }
      }, 
      wrappingOptions: {
        orderBy: { createdAt: 'asc' }
      },
      cards: {
        orderBy: { createdAt: 'asc' }
      }
    },
  });
  
  if (!bundle) {
    return json({ error: "Bundle not found" }, { status: 404 });
  }

  // Only return active bundles
  if (bundle.status !== 'ACTIVE') {
    return json({ error: "Bundle not available" }, { status: 404 });
  }

  const appBaseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  return json({ 
    bundle: {
      id: bundle.id,
      title: bundle.title,
      description: bundle.description,
      imageUrl: toAbsoluteImageUrl(bundle.imageUrl, appBaseUrl),
      pricingType: bundle.pricingType,
      priceValueCents: bundle.priceValueCents,
      minItems: bundle.minItems,
      maxItems: bundle.maxItems,
      allowMessage: bundle.allowMessage,
      messageCharLimit: bundle.messageCharLimit,
      personalizationFeeCents: bundle.personalizationFeeCents,
      wrapRequired: bundle.wrapRequired,
      type: bundle.type,
      products: bundle.products.map(p => {
        const variants = p.variantsJson ? JSON.parse(p.variantsJson) : (p.variantGid ? [{ id: p.variantGid, title: p.variantTitle || 'Default', priceCents: p.priceCents || 0 }] : []);
        return {
          id: p.id,
          productGid: p.productGid,
          variantGid: p.variantGid,
          variantTitle: p.variantTitle,
          imageUrl: toAbsoluteImageUrl(p.imageUrl, appBaseUrl),
          priceCents: p.priceCents,
          min: p.min,
          max: p.max,
          variants: variants
        };
      }),
      wrappingOptions: bundle.wrappingOptions.map(w => ({
        id: w.id,
        name: w.name,
        priceCents: w.priceCents,
        imageUrl: toAbsoluteImageUrl(w.imageUrl, appBaseUrl),
        shopifyVariantId: w.shopifyVariantId
      })),
      cards: (bundle.cards || []).map(c => ({
        id: c.id,
        name: c.name,
        priceCents: c.priceCents || 0,
        imageUrl: toAbsoluteImageUrl(c.imageUrl, appBaseUrl),
        shopifyVariantId: c.shopifyVariantId
      }))
    }
  }, { 
    headers: { 
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*"
    } 
  });
};

export const headers = () => ({
  "Cache-Control": "public, max-age=60",
});

export const action = async () => json({}, { status: 405 });



