import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'false',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // Validate app proxy if available; skip gracefully in dev
    try { 
      await authenticate.public.appProxy(request); 
    } catch (error) {
      console.log('App proxy validation skipped (dev mode):', error.message);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    
    console.log('🔍 Apps route called with pathname:', pathname);

    // If this is the root /apps path OR /apps/bundles, return bundle listing
    if (pathname === '/apps' || pathname === '/apps/' || pathname === '/apps/bundles') {
      console.log('📋 Returning bundle listing for path:', pathname);
      
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
        select: {
          id: true,
          bundleId: true,
          title: true,
          description: true,
          imageUrl: true,
          pricingType: true,
          priceValueCents: true,
          type: true,
          allowMessage: true,
          allowCardUpload: true,
          wrapRequired: true,
          _count: {
            select: {
              products: true,
              wrappingOptions: true,
              cards: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      console.log('📋 Found', bundles.length, 'active bundles');

      return json({ 
        bundles: bundles.map(bundle => ({
          ...bundle,
          allowMessage: Boolean(bundle.allowMessage),
          allowCardUpload: Boolean(bundle.allowCardUpload),
          wrapRequired: Boolean(bundle.wrapRequired),
          productCount: bundle._count.products,
          wrapCount: bundle._count.wrappingOptions,
          cardCount: bundle._count.cards,
          // simple upsell flag if has paid wraps or many cards
          hasPremiumWrap: (bundle._count.wrappingOptions || 0) > 0,
          hasCardDesigns: (bundle._count.cards || 0) > 0,
        }))
      }, { 
        headers: { 
          "Cache-Control": "public, max-age=60",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Credentials": "false"
        } 
      });
    }

    // For other paths, return basic API info
    return json({ 
      message: "Bundle App Storefront API is working!",
      timestamp: new Date().toISOString(),
      currentPath: pathname,
      endpoints: {
        root: "/apps - List all active bundles",
        bundles: "/apps/bundles - Alternative bundle listing",
        bundle: "/apps/{bundleId} - Get specific bundle data",
        debug: "/apps/debug - Debug information",
        test: "/apps/test - Test API endpoints"
      }
    }, { 
      headers: { 
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": "false"
      } 
    });

  } catch (error) {
    console.error('❌ Apps route error:', error);
    return json({ 
      error: "Internal server error", 
      details: error.message,
      stack: error.stack
    }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'false'
      }
    });
  }
};
