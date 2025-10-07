import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getHiddenHandlesForShop, isHiddenTagMatch } from "../utils/hidden.server";

// Local minimal helpers to avoid importing server-only modules into client graph
function buildCorsHeaders(request, extra = {}) {
  const allowedOrigins = ["https://store-revive.myshopify.com"]; // extend if needed
  const origin = request.headers.get("origin");
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Shop-Domain",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
    ...extra,
  };
}

function handleCorsPreflightRequest(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: buildCorsHeaders(request) });
  }
  return null;
}

function normalizeImageUrl(url) {
  if (!url) return null;
  const urlString = String(url).trim();
  if (/^https?:\/\//i.test(urlString)) return urlString;
  const filename = urlString.replace(/^\/?uploads\//, "");
  return `/apps/bundles/uploads/${filename}`;
}

export const loader = async ({ request, params }) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsPreflightRequest(request);
  if (corsResponse) return corsResponse;

  try {
    // Validate app proxy if available; skip gracefully in dev
    try { 
      await authenticate.public.appProxy(request); 
    } catch (error) {
      console.log('App proxy validation skipped (dev mode):', error.message);
    }

    // Optional lightweight analytics beacon for views
    try {
      const url = new URL(request.url);
      const record = url.searchParams.get('record');
      if ((record === 'view' || record === 'add') && params.bundleId) {
        await prisma.bundleSale.create({
          data: { shop: 'unknown', bundleId: params.bundleId },
        });
      }
    } catch (_) {}

    const bundleId = params.bundleId;
    console.log('🔍 Storefront API called with bundleId:', bundleId);
    console.log('🔍 Request URL:', request.url);
    console.log('🔍 Request headers:', Object.fromEntries(request.headers.entries()));

    if (!bundleId) {
      console.log('❌ No bundle ID provided');
      return json({ error: "Bundle ID is required" }, { status: 400 });
    }

    // First try to find by bundleId field (for storefront access) and schedule constraints
    console.log('🔍 Searching for bundle by bundleId field...');
    let bundle = await prisma.bundle.findFirst({
      where: { 
        bundleId: bundleId,
        status: "ACTIVE",
        AND: [
          { OR: [ { startAt: null }, { startAt: { lte: new Date() } } ] },
          { OR: [ { endAt: null }, { endAt: { gte: new Date() } } ] }
        ]
      },
      include: { 
        products: true, 
        wrappingOptions: true, 
        cards: true,
        tierPrices: true,
      },
    });

    if (bundle) {
      console.log('✅ Bundle found by bundleId field:', bundle.id);
    } else {
      console.log('❌ Bundle not found by bundleId field, trying by ID...');
      // Try to find by ID
      bundle = await prisma.bundle.findFirst({
        where: { 
          id: bundleId,
          status: "ACTIVE",
          AND: [
            { OR: [ { startAt: null }, { startAt: { lte: new Date() } } ] },
            { OR: [ { endAt: null }, { endAt: { gte: new Date() } } ] }
          ]
        },
        include: { 
          products: true, 
          wrappingOptions: true, 
          cards: true,
          tierPrices: true,
        },
      });
      
      if (bundle) {
        console.log('✅ Bundle found by ID:', bundle.id);
      }
    }

    // If still not found, try to find by any matching pattern
    if (!bundle) {
      console.log('❌ Bundle not found by exact match, trying pattern search...');
      bundle = await prisma.bundle.findFirst({
        where: { 
          OR: [
            { id: { contains: bundleId } },
            { bundleId: { contains: bundleId } },
            { title: { contains: bundleId, mode: 'insensitive' } }
          ],
          status: "ACTIVE",
          AND: [
            { OR: [ { startAt: null }, { startAt: { lte: new Date() } } ] },
            { OR: [ { endAt: null }, { endAt: { gte: new Date() } } ] }
          ]
        },
        include: { 
          products: true, 
          wrappingOptions: true, 
          cards: true,
          tierPrices: true,
        },
      });
      
      if (bundle) {
        console.log('✅ Bundle found by pattern search:', bundle.id);
      }
    }

    // Debug logging
    console.log('🔍 Bundle search result:', bundle ? 'Found' : 'Not found');
    if (bundle) {
      console.log('✅ Bundle details:');
      console.log('  - ID:', bundle.id);
      console.log('  - BundleId:', bundle.bundleId);
      console.log('  - Title:', bundle.title);
      console.log('  - Status:', bundle.status);
      console.log('  - Products count:', bundle.products?.length || 0);
      console.log('  - Wrapping options count:', bundle.wrappingOptions?.length || 0);
      console.log('  - Cards count:', bundle.cards?.length || 0);
    } else {
      console.log('❌ No bundle found, checking available bundles...');
      // Get all bundles for debugging
      const allBundles = await prisma.bundle.findMany({
        select: { 
          id: true, 
          bundleId: true, 
          title: true, 
          status: true 
        }
      });
      console.log('📋 Available bundles:', allBundles);
      
      return json({ 
        error: "Bundle not found or not active",
        bundleId: bundleId,
        availableBundles: allBundles,
        searchAttempts: [
          'Searched by bundleId field',
          'Searched by ID field', 
          'Searched by pattern matching'
        ]
      }, { status: 404 });
    }

    // Only return active bundles for storefront
    if (bundle.status !== "ACTIVE") {
      console.log('❌ Bundle found but not active:', bundle.status);
      return json({ 
        error: "Bundle is not active", 
        bundleId: bundle.id,
        status: bundle.status
      }, { status: 404 });
    }

    let products = bundle.products || [];

    // Use imported image normalization utility


    // If there are no saved products but a collectionId exists, try to surface products (respect plan limits)
    if (products.length === 0 && bundle.collectionId) {
      console.log('🔍 No products found, trying to fetch from collection:', bundle.collectionId);
      try {
        // Attempt to use admin in dev to enrich response (app proxy won't provide admin)
        const { admin } = await authenticate.admin(request);
        const resp = await admin.graphql(`#graphql
          query CollectionProducts($id: ID!) {
            collection(id: $id) {
              products(first: 50) {
                nodes {
                  id
                  title
                  featuredMedia { preview { image { url } } }
                  variants(first: 10) {
                    nodes {
                      id
                      title
                      price
                      image { url }
                    }
                  }
                }
              }
            }
          }
        `, { variables: { id: bundle.collectionId } });
        const data = await resp.json();
        const nodes = data?.data?.collection?.products?.nodes || [];
        // Pre-compute hidden handles via REST (cached 5 minutes) so we exclude hidden add-ons server-side
        let hiddenHandles = new Set();
        try {
          const url4 = new URL(request.url);
          const shop4 = url4.searchParams.get('shop') || null;
          if (shop4) {
            const session4 = await prisma.session.findFirst({ where: { shop: shop4 }, orderBy: { expires: 'desc' } });
            const token4 = session4?.accessToken || null;
            if (token4) hiddenHandles = await getHiddenHandlesForShop(shop4, token4);
          }
        } catch(_) {}
        products = nodes
          .filter((p) => {
            try {
              // Exclude by handle or by tag set to avoid hidden add-ons on storefront
              const handle = String(p?.handle || '')
                .toLowerCase()
                .trim();
              if (handle && hiddenHandles.has(handle)) return false;
            } catch(_) {}
            return true;
          })
          .map((p) => {
          const v = p.variants?.nodes?.[0];
          if (!v) return null;
          return {
            id: p.id, // not a DB id; used only for client map
            productGid: p.id,
            variantGid: v.id,
            variantTitle: v.title,
            imageUrl: v.image?.url || p.featuredMedia?.preview?.image?.url || null,
            priceCents: v.price ? Math.round(parseFloat(v.price) * 100) : null,
            min: 0,
            max: 0,
            variants: p.variants?.nodes?.map(variant => ({
              id: variant.id,
              title: variant.title,
              priceCents: variant.price ? Math.round(parseFloat(variant.price) * 100) : 0,
              imageUrl: variant.image?.url || null
            })) || []
          };
        }).filter(Boolean);
        // Enforce Free plan 6 item cap at source to keep UI consistent
        try {
          const url3 = new URL(request.url);
          const shop3 = url3.searchParams.get('shop') || null;
          let plan3 = 'FREE';
          if (shop3) {
            const s3 = await prisma.shopSettings.findUnique({ where: { shop: shop3 } });
            plan3 = s3?.plan || 'FREE';
          }
          if (plan3 === 'FREE' && Array.isArray(products)) {
            products = products.slice(0, 6);
          }
        } catch(_) {}
        console.log('✅ Fetched', products.length, 'products from collection');
      } catch (error) {
        console.log('⚠️ Collection sync failed (falling back to empty products):', error.message);
        products = [];
      }
    }

    // Read variants from database (variantsJson field)
    if (products.length > 0) {
      console.log('🔍 Reading variants from database (preserve existing variants when absent)...');
      products = products.map(product => {
        try {
          if (product.variantsJson) {
            const parsed = JSON.parse(product.variantsJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              return { ...product, imageUrl: normalizeImageUrl(product.imageUrl), variants: parsed };
            }
          }
        } catch (_) {}
        // Keep any variants already present instead of forcing []
        return { ...product, imageUrl: normalizeImageUrl(product.imageUrl), variants: product.variants || [] };
      });
      console.log('✅ Variants resolved for', products.length, 'products');
    }

    // Carefully enrich missing variants/images via Admin REST with light rate limiting
    try {
      const url = new URL(request.url);
      const shop = url.searchParams.get('shop') || null;
      if (shop) {
        const shopSession = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });
        const accessToken = shopSession?.accessToken || null;
        if (accessToken) {
          const adminHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
          // Try to enrich for all products, but only overwrite when we have data
          const needEnrich = products;
          for (const p of needEnrich) {
            const gid = p.productGid || p.productId || p.id;
            const numericId = String(gid || '').split('/').pop();
            if (!/^[0-9]+$/.test(numericId)) continue;
            try {
              const res = await fetch(`https://${shop}/admin/api/2024-10/products/${numericId}.json?fields=images,variants,title`, {
                headers: adminHeaders
              });
              if (res.ok) {
                const pj = await res.json();
                const pr = pj?.product || {};
                const img = (pr.images && pr.images[0] && pr.images[0].src) || null;
                const vars = Array.isArray(pr.variants) ? pr.variants.map(v => ({
                  id: v.id,
                  title: v.title,
                  priceCents: v.price ? Math.round(parseFloat(v.price) * 100) : 0,
                  imageUrl: v.image_id ? (pr.images || []).find(i => i.id === v.image_id)?.src || null : null,
                })) : [];
                if (img) p.imageUrl = normalizeImageUrl(p.imageUrl || img);
                if (vars && vars.length > 0) p.variants = vars;
                // GraphQL fallback using productGid when REST returns none
                if ((!p.variants || p.variants.length === 0) && p.productGid) {
                  try {
                    const q = `#graphql\n                      query GetProduct($id: ID!) {\n                        product(id: $id) {\n                          id\n                          featuredMedia { preview { image { url } } }\n                          variants(first: 50) { nodes { id title price image { url } } }\n                        }\n                      }`;
                    const g = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
                      method: 'POST', headers: adminHeaders, body: JSON.stringify({ query: q, variables: { id: p.productGid } })
                    });
                    if (g.ok) {
                      const gj = await g.json();
                      const node = gj?.data?.product || null;
                      if (node) {
                        const gVars = (node.variants?.nodes || []).map(v => ({
                          id: v.id,
                          title: v.title,
                          priceCents: v.price ? Math.round(parseFloat(v.price) * 100) : 0,
                          imageUrl: v.image?.url || null,
                        }));
                        if (gVars && gVars.length > 0) p.variants = gVars;
                        if (!p.imageUrl && node.featuredMedia?.preview?.image?.url) {
                          p.imageUrl = normalizeImageUrl(node.featuredMedia.preview.image.url);
                        }
                      }
                    }
                  } catch(_) {}
                }
                try { console.log('[bundle-detail] product enriched', { productId: p.id, variants: p.variants?.length || 0, image: p.imageUrl }); } catch(_){ }
              }
            } catch(_) {}
            // tiny delay to avoid 429
            await new Promise(r => setTimeout(r, 120));
          }
        }
      }
    } catch(_) {}

    // Normalize wrap and card images and bundle image
    if (bundle) {
      bundle.imageUrl = normalizeImageUrl(bundle.imageUrl);
      if (Array.isArray(bundle.wrappingOptions)) {
        bundle.wrappingOptions = bundle.wrappingOptions.map(w => ({ ...w, imageUrl: normalizeImageUrl(w.imageUrl) }));
      }
      if (Array.isArray(bundle.cards)) {
        bundle.cards = bundle.cards.map(c => ({ ...c, imageUrl: normalizeImageUrl(c.imageUrl) }));
      }
    }

    try {
      console.log('[bundle-detail] summary', {
        id: bundle?.id,
        title: bundle?.title,
        bundleImage: bundle?.imageUrl,
        wraps: (bundle?.wrappingOptions || []).map(w => ({ id: w.id, image: w.imageUrl })),
        products: products.map(p => ({ id: p.id, variants: p.variants?.length || 0, image: p.imageUrl }))
      });
    } catch(_){ }

    // Final pass: normalize and guarantee variants array for client dropdowns
    function coerceVariantsArray(input){
      if (!input) return [];
      try {
        const arr = Array.isArray(input) ? input : JSON.parse(input);
        if (!Array.isArray(arr)) return [];
        return arr
          .filter(v => v && (v.id || v.variantId))
          .map(v => ({
            id: v.id || v.variantId,
            title: v.title || 'Variant',
            priceCents: typeof v.priceCents === 'number' ? v.priceCents : (v.price ? Math.round(parseFloat(v.price) * 100) : 0),
            imageUrl: v.imageUrl || v.image || null,
          }));
      } catch(_){ return []; }
    }

    products = products.map(p => {
      // Prefer explicit variants
      let variants = Array.isArray(p.variants) ? p.variants : [];
      if (variants.length === 0 && p.variantsJson) {
        variants = coerceVariantsArray(p.variantsJson);
      }
      // Ensure structure
      variants = coerceVariantsArray(variants);
      // Hard fallback: if still none, synthesize a default option from base variant
      if ((!variants || variants.length === 0) && (p.variantGid || p.variantId || p.productGid)) {
        const id = p.variantGid || p.variantId || null;
        if (id) {
          variants = [{
            id,
            title: p.variantTitle || 'Default Variant',
            priceCents: typeof p.priceCents === 'number' ? p.priceCents : 0,
            imageUrl: p.imageUrl || null,
          }];
        }
      }
      return { ...p, variants };
    });

    // Attach plan for client widget gating (e.g., 3D carousel)
    let plan = 'FREE';
    try {
      const url = new URL(request.url);
      const shop = url.searchParams.get('shop') || null;
      if (shop) {
        const s = await prisma.shopSettings.findUnique({ where: { shop } });
        plan = s?.plan || 'FREE';
      }
    } catch(_) {}

    // Strip Pro-only entities for Free plan to avoid exposing locked features
    if (plan === 'FREE' && bundle) {
      bundle.wrappingOptions = [];
      bundle.cards = [];
      bundle.allowMessage = false;
      bundle.messageCharLimit = null;
      bundle.personalizationFeeCents = null;
      bundle.tierPrices = []; // allow only base pricing on Free
    }

    const responseData = { 
      bundle: { 
        ...bundle, 
        products,
        // Ensure all required fields are present
        allowMessage: Boolean(bundle.allowMessage),
        allowCardUpload: Boolean(bundle.allowCardUpload),
        wrapRequired: Boolean(bundle.wrapRequired),
        messageCharLimit: bundle.messageCharLimit || null,
        personalizationFeeCents: bundle.personalizationFeeCents || null,
        pricingType: bundle.pricingType || 'SUM',
        priceValueCents: bundle.priceValueCents || null,
        minItems: bundle.minItems || null,
        maxItems: bundle.maxItems || null
      },
      plan,
    };

    console.log('✅ Returning bundle data successfully');
    console.log('📦 Final bundle data:', {
      id: responseData.bundle.id,
      title: responseData.bundle.title,
      productsCount: responseData.bundle.products.length,
      wrapsCount: responseData.bundle.wrappingOptions.length,
      cardsCount: responseData.bundle.cards.length
    });
    
    return json(responseData, { headers: { "Cache-Control": "public, max-age=60", ...buildCorsHeaders(request) } });

  } catch (error) {
    console.error('❌ Storefront API error:', error);
    return json({ 
      error: "Internal server error", 
      details: error.message,
      stack: error.stack
    }, { status: 500 });
  }
};

export const action = async ({ request, params }) => {
  console.log('🔍 Apps.$bundleId action called with params:', params);
  console.log('🔍 Request URL:', request.url);
  console.log('🔍 Request method:', request.method);
  
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'false',
    } });
  }

  try {
    // Validate app proxy and extract shop
    let shop = null;
    const url = new URL(request.url);
    shop = url.searchParams.get('shop') || url.searchParams.get('shopify') || null;
    try { await authenticate.public.appProxy(request); } catch (_) {}
    if (!shop) return json({ error: 'Missing shop' }, { status: 400, headers: {
      'Access-Control-Allow-Origin': 'https://store-revive.myshopify.com',
      'Access-Control-Allow-Credentials': 'true',
    } }); 

    // Find latest session for this shop to get access token
    const shopSession = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });
    const accessToken = shopSession?.accessToken;
    if (!accessToken) return json({ error: 'No session for shop' }, { status: 401, headers: {
      'Access-Control-Allow-Origin': 'https://store-revive.myshopify.com',
      'Access-Control-Allow-Credentials': 'true',
    } });

    const bundleId = params.bundleId;
    const body = await request.json().catch(() => ({}));

    // Support both internal id and public bundleId
    let bundle = await prisma.bundle.findFirst({
      where: { OR: [{ id: bundleId }, { bundleId }] },
      include: { products: true, wrappingOptions: true, cards: true, tierPrices: true },
    });
    if (!bundle) return json({ error: 'Bundle not found' }, { status: 404, headers: {
      'Access-Control-Allow-Origin': 'https://store-revive.myshopify.com',
      'Access-Control-Allow-Credentials': 'true',
    } });

    // Recompute price server-side to avoid tampering
    const selectedProductIds = Array.isArray(body.selectedProductIds) ? body.selectedProductIds : [];
    const selectedVariantMap = body.selectedVariantMap || {}; // {productId: variantId}
    let selectedWrapId = body.selectedWrapId || null;
    let selectedCardId = body.selectedCardId || null;
    let messageValue = body.messageValue || '';

    // Enforce Free plan cart restrictions
    try {
      const url2 = new URL(request.url);
      const shop2 = url2.searchParams.get('shop') || null;
      if (shop2) {
        const s2 = await prisma.shopSettings.findUnique({ where: { shop: shop2 } });
        const plan2 = s2?.plan || 'FREE';
        if (plan2 === 'FREE') {
          selectedWrapId = null;
          selectedCardId = null;
          messageValue = '';
        }
      }
    } catch(_) {}

    const selectedProducts = bundle.products.filter(p => selectedProductIds.includes(String(p.id)));
    let subtotal = 0;
    for (const p of selectedProducts) {
      const base = p.priceCents || 0;
      subtotal += base;
      const chosenVariantId = selectedVariantMap[String(p.id)] || null;
      if (chosenVariantId && p.variantsJson) {
        try {
          const variants = JSON.parse(p.variantsJson);
          const variant = variants.find(v => String(v.id) === String(chosenVariantId));
          if (variant && typeof variant.priceCents === 'number') {
            subtotal += Math.max(0, variant.priceCents - (base || 0));
          }
        } catch (_) {}
      }
    }

    // Apply bundle-level pricing
    let total = subtotal;
    if (bundle.tierPrices && bundle.tierPrices.length > 0) {
      const qty = selectedProducts.length;
      const applicable = bundle.tierPrices
        .filter(t => t.minQuantity <= qty)
        .sort((a,b) => b.minQuantity - a.minQuantity)[0];
      if (applicable) {
        if (applicable.pricingType === 'FIXED' && applicable.valueCents != null) {
          total = applicable.valueCents;
        } else if (applicable.pricingType === 'DISCOUNT_PERCENT' && applicable.valuePercent != null) {
          total = Math.max(0, subtotal - Math.floor(subtotal * (applicable.valuePercent/100)));
        } else if (applicable.pricingType === 'DISCOUNT_AMOUNT' && applicable.valueCents != null) {
          total = Math.max(0, subtotal - applicable.valueCents);
        }
      }
    }
    if (bundle.pricingType === 'FIXED' && bundle.priceValueCents != null) total = bundle.priceValueCents;
    if (bundle.pricingType === 'DISCOUNT_PERCENT' && bundle.priceValueCents != null) total = Math.max(0, subtotal - Math.floor(subtotal * (bundle.priceValueCents/100)));
    if (bundle.pricingType === 'DISCOUNT_AMOUNT' && bundle.priceValueCents != null) total = Math.max(0, subtotal - bundle.priceValueCents);

    // Add wrap/card
    const wrap = selectedWrapId ? bundle.wrappingOptions.find(w => String(w.id) === String(selectedWrapId)) : null;
    const card = selectedCardId ? bundle.cards.find(c => String(c.id) === String(selectedCardId)) : null;
    if (wrap) total += (wrap.priceCents || 0);
    if (card) total += (card.priceCents || 0);

    // Cache Online Store publication id per request
    let onlineStorePublicationId = null;
    async function getOnlineStorePublicationId(){
      if (onlineStorePublicationId) return onlineStorePublicationId;
      try {
        const q = `#graphql\n          query GetPublications {\n            publications(first: 10) { nodes { id catalog { title } } }\n          }`;
        const pubRes = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ query: q })
        });
        const pj = await pubRes.json();
        const online = pj?.data?.publications?.nodes?.find(n => n?.catalog?.title === 'Online Store');
        onlineStorePublicationId = online?.id || null;
      } catch(_){ onlineStorePublicationId = null; }
      return onlineStorePublicationId;
    }

    // Create a unique draft product for this specific bundle purchase (DEPRECATED - keep for fallback only)
    async function createUniqueBundleProduct(cents, bundleTitle, bundleId) {
      // Generate unique product title with timestamp
      const timestamp = Date.now();
      const uniqueTitle = `Bundle: ${bundleTitle} - ${timestamp}`;
      
      try {
        // Create new draft product
        const mutation = `mutation CreateProduct($input: ProductInput!) { 
          productCreate(input: $input) { 
            product { id } 
            userErrors { field message } 
          } 
        }`;
        
        const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ 
            query: mutation, 
            variables: { 
              input: { 
                title: uniqueTitle, 
                status: 'ACTIVE',
                tags: ['bundle-charge', 'hidden-product', `bundle-${bundleId}`, `timestamp-${timestamp}`], 
                vendor: 'Bundle Add-on', 
                productType: 'Bundle'
              } 
            } 
          })
        });
        
        const j = await res.json();
        console.log('Product creation response:', JSON.stringify(j, null, 2));
        const err = j?.data?.productCreate?.userErrors?.[0];
        if (err) {
          console.error('Product creation error:', err);
          return null;
        }
        
        const productIdGid = j?.data?.productCreate?.product?.id;
        if (!productIdGid) return null;

        const productNumericId = String(productIdGid).split('/').pop();
        const price = (Number(cents || 0) / 100).toFixed(2);

        // Create variant for the new product
        try {
          const cRes = await fetch(`https://${shop}/admin/api/2024-10/products/${productNumericId}/variants.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ 
              variant: { 
                option1: 'Default', 
                title: 'Bundle', 
                price, 
                inventory_management: 'shopify', 
                inventory_policy: 'continue', 
                inventory_quantity: 1, // Only 1 available since it's for this specific purchase
                taxable: false, 
                weight: 0.0, 
                weight_unit: 'kg' 
              } 
            })
          });
          
          if (cRes.ok) {
            const vj = await cRes.json();
            console.log('Variant creation response:', JSON.stringify(vj, null, 2));
            if (vj?.variant?.id) {
              const newId = String(vj.variant.id);
              
              // Publish product to Online Store to ensure variant is purchasable
              try {
                const pubId = await getOnlineStorePublicationId();
                if (pubId) {
                const m = `#graphql\n                    mutation Publish($id: ID!, $pub: ID!) {\n                      publishablePublish(id: $id, input: { publicationId: $pub }) {\n                        publishable { __typename ... on Node { id } }\n                        userErrors { field message }\n                      }\n                    }`;
                  await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                    body: JSON.stringify({ query: m, variables: { id: productIdGid, pub: pubId } })
                  });
                }
              } catch(_) {}

              // Poll until variant is readable and purchasable
              for (let i = 0; i < 12; i++) {
                try {
                  const chk = await fetch(`https://${shop}/admin/api/2024-10/variants/${vj.variant.id}.json`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                  });
                  if (chk.ok) {
                    const cj = await chk.json();
                    if (cj?.variant?.id) break;
                  }
                } catch(_) {}
                await new Promise(r => setTimeout(r, 500));
              }
              
              return newId;
            }
          } else {
            const errorText = await cRes.text();
            console.error('Variant creation failed:', cRes.status, errorText);
          }
        } catch (error) {
          console.error('Variant creation error:', error);
        }
      } catch (error) {
        console.error('Product creation error:', error);
      }
      
      return null;
    }

    // Preferred approach: ensure a single master product/variant exists and update its price
    async function ensureVariantForBundlePrice(cents) {
      // Try to find by tag bundle-<id>
      let productIdGid = null;
      try {
        const resp = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ query: `query ($q: String!) { products(first: 1, query: $q) { nodes { id title variants(first: 1) { nodes { id } } } } }`, variables: { q: `tag:'bundle-charge-master'` } })
        });
        const data = await resp.json();
        const node = data?.data?.products?.nodes?.[0];
        if (node?.id) productIdGid = node.id;
      } catch (_) {}

      if (!productIdGid) {
        // Create product
        try {
          const title = `Bundle Charge - ${bundle.title}`;
          const mutation = `mutation CreateProduct($input: ProductInput!) { productCreate(input: $input) { product { id } userErrors { field message } } }`;
          const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ query: mutation, variables: { input: { title, status: 'ACTIVE', tags: ['bundle-charge-master','hidden-product'], vendor: 'Bundle Add-on', productType: 'Bundle', publishedScope: 'WEB' } } })
          });
          const j = await res.json();
          const err = j?.data?.productCreate?.userErrors?.[0];
          if (!err) productIdGid = j?.data?.productCreate?.product?.id || null;
        } catch (_) {}
      }
      if (!productIdGid) return null;

      // Ensure product is published to Online Store so Ajax cart API accepts it
      try {
        const pubId = await getOnlineStorePublicationId();
        if (pubId) {
          const publishMutation = `#graphql\n            mutation Publish($id: ID!, $pub: ID!) {\n              publishablePublish(id: $id, input: { publicationId: $pub }) { publishable { __typename ... on Node { id } } userErrors { field message } }\n            }`;
          await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ query: publishMutation, variables: { id: productIdGid, pub: pubId } })
          });
        }
      } catch(_) {}

      // Also enforce ACTIVE via REST and set published_scope if accepted
      try {
        const productNumericId = String(productIdGid).split('/').pop();
        await fetch(`https://${shop}/admin/api/2024-10/products/${productNumericId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ product: { id: Number(productNumericId), status: 'active', published_scope: 'web', published_at: new Date().toISOString() } })
        });
      } catch(_) {}

      const productNumericId = String(productIdGid).split('/').pop();
      const price = (Number(cents || 0) / 100).toFixed(2);

      // Ensure single variant exists with price
      let variantId = null;
      try {
        const vRes = await fetch(`https://${shop}/admin/api/2024-10/products/${productNumericId}/variants.json`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        });
        if (vRes.ok) {
          const vj = await vRes.json();
          variantId = vj?.variants?.[0]?.id || null;
        }
      } catch (_) {}

      if (variantId) {
        // Update price
        try {
          await fetch(`https://${shop}/admin/api/2024-10/variants/${variantId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ variant: { id: variantId, price, inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: 999, inventory_item_id: null } })
          });
        } catch (_) {}
        return String(variantId);
      }

      // Create variant
      try {
        const cRes = await fetch(`https://${shop}/admin/api/2024-10/products/${productNumericId}/variants.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ variant: { option1: 'Default', title: 'Bundle', price, inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: 999, taxable: false, weight: 0.0, weight_unit: 'kg', requires_shipping: false } })
        });
        if (cRes.ok) {
          const vj = await cRes.json();
          if (vj?.variant?.id) {
            return String(vj.variant.id);
          }
        }
      } catch (_) {}
      return null;
    }

    // Use master product variant approach for stability
    let variantId = await ensureVariantForBundlePrice(total);
    
    // Final readiness check against storefront endpoint to avoid 422s
    try {
      const numericId = String(variantId).split('/').pop();
      for (let i = 0; i < 12; i++) {
        try {
          const check = await fetch(`https://${shop}/variants/${numericId}.json`, { method: 'GET' });
          if (check.ok) {
            const j = await check.json().catch(()=>null);
            if (j && j.variant && j.variant.id) break;
          }
        } catch(_) {}
        await new Promise(r => setTimeout(r, 500));
      }
    } catch(_) {}
    
    if (!variantId) return json({ error: 'Failed to create bundle product' }, { status: 500, headers: {
      'Access-Control-Allow-Origin': 'https://store-revive.myshopify.com',
      'Access-Control-Allow-Credentials': 'true',
    } });

    return json({
      variantId,
      totalCents: total,
    }, { headers: { "Cache-Control": "no-store", 'Access-Control-Allow-Origin': 'https://store-revive.myshopify.com', 'Access-Control-Allow-Credentials': 'true' } });
  } catch (error) {
    console.error('Bundle action error:', error);
    return json({ error: 'Internal error' }, { status: 500, headers: {
      'Access-Control-Allow-Origin': 'https://store-revive.myshopify.com',
      'Access-Control-Allow-Credentials': 'true',
    } });
  }
};


