import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

// CORS headers function
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // Allow all origins for development
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'false', // Must be false when using wildcard origin
    'Access-Control-Max-Age': '86400',
  };
}

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

export const loader = async ({ request }) => {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: getCorsHeaders(),
    });
  }

  try {
    // Validate app proxy if available; skip gracefully in dev
    try { 
      await authenticate.public.appProxy(request); 
    } catch (error) {
      console.log('App proxy validation skipped (dev mode):', error.message);
    }

    const appBaseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

    // Get all active bundles for listing
    const now = new Date();
    const bundles = await prisma.bundle.findMany({
      where: { 
        status: "ACTIVE",
        AND: [
          { OR: [ { startAt: null }, { startAt: { lte: now } } ] },
          { OR: [ { endAt: null }, { endAt: { gte: now } } ] }
        ]
      },
      include: {
        BundleProduct: {
          select: {
            id: true,
            productGid: true,
            variantGid: true,
            variantTitle: true,
            imageUrl: true,
            priceCents: true,
            min: true,
            max: true
          }
        },
        WrappingOption: {
          select: {
            id: true,
            name: true,
            priceCents: true,
            imageUrl: true
          }
        },
        BundleCard: {
          select: {
            id: true,
            name: true,
            imageUrl: true,
            priceCents: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log('Bundles listing API called, found:', bundles.length);

    // Read plan for the requesting shop if provided
    let plan = 'FREE';
    let hero = null;
    let carousel = null;
    try {
      const url = new URL(request.url);
      const shop = url.searchParams.get('shop') || null;
      if (shop) {
        const s = await prisma.shopSettings.findUnique({ where: { shop } });
        plan = s?.plan || 'FREE';
        // Always return saved hero settings, regardless of plan, so storefront reflects persisted values
        hero = {
          enabled: s?.heroEnabled ?? true,
          title: s?.heroTitle || 'Premium Collection',
          subtitle: s?.heroSubtitle || 'Special bundles curated with care for our customers.',
          emoji: s?.heroEmoji || '🎁',
          colorStart: s?.heroColorStart || '#6366f1',
          colorEnd: s?.heroColorEnd || '#8b5cf6',
        };
        // Load carousel settings from languageJson.carousel if present
        try {
          const payload = s?.languageJson ? JSON.parse(s.languageJson) : null;
          const c = payload && payload.carousel ? payload.carousel : null;
          if (c) {
            carousel = {
              style: c.style || 'slide',
              cardStyle: c.cardStyle || 'minimal',
              autoplay: Boolean(c.autoplay),
              speedMs: Number(c.speedMs || 3500),
              buttonBg: (typeof c.buttonBg === 'string' ? c.buttonBg : null),
              badgeBg: (typeof c.badgeBg === 'string' ? c.badgeBg : null),
              containerBg: (typeof c.containerBg === 'string' ? c.containerBg : null)
            };
          }
        } catch(_) {}
      }
    } catch(_) {}

    // For FREE plan, trim products per bundle to 6 in this list response as a soft cap for UI summaries
    return json({ 
      plan,
      hero,
      carousel,
      bundles: bundles.map(bundle => ({
        ...bundle,
        imageUrl: toAbsoluteImageUrl(bundle.imageUrl, appBaseUrl),
        allowMessage: Boolean(bundle.allowMessage),
        allowCardUpload: Boolean(bundle.allowCardUpload),
        wrapRequired: Boolean(bundle.wrapRequired),
        productCount: bundle.BundleProduct?.length || 0,
        wrapCount: bundle.WrappingOption?.length || 0,
        cardCount: bundle.BundleCard?.length || 0,
        products: (plan === 'FREE' ? (bundle.BundleProduct || []).slice(0,6) : (bundle.BundleProduct || [])).map(p => ({
          ...p,
          imageUrl: toAbsoluteImageUrl(p.imageUrl, appBaseUrl)
        })),
        wrappingOptions: (bundle.WrappingOption || []).map(w => ({
          ...w,
          imageUrl: toAbsoluteImageUrl(w.imageUrl, appBaseUrl)
        })),
        cards: (bundle.BundleCard || []).map(c => ({
          ...c,
          imageUrl: toAbsoluteImageUrl(c.imageUrl, appBaseUrl)
        }))
      }))
    }, { 
      headers: { 
        "Cache-Control": "public, max-age=60",
        ...getCorsHeaders()
      } 
    });

  } catch (error) {
    console.error('Bundles listing API error:', error);
    return json({ 
      error: "Internal server error", 
      details: error.message 
    }, { 
      status: 500,
      headers: getCorsHeaders()
    });
  }
};
