import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': 'false',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

export const loader = async ({ request, params }) => {
  console.log('🔍 Loader called with params:', params);
  console.log('🔍 Request URL:', request.url);
  
  try { await authenticate.public.appProxy(request); } catch (_) {}

  // Support both internal id and public bundleId with more flexible matching
  const bundle = await prisma.bundle.findFirst({
    where: { 
      OR: [
        { id: params.bundleId }, 
        { bundleId: params.bundleId },
        { id: { contains: params.bundleId } },
        { bundleId: { contains: params.bundleId } }
      ] 
    },
    include: { products: true, wrappingOptions: true },
  });
  
  if (!bundle) {
    console.error('❌ Bundle not found for ID:', params.bundleId);
    // Debug: list all available bundles
    const allBundles = await prisma.bundle.findMany({
      select: { id: true, bundleId: true, title: true }
    });
    console.log('📋 Available bundles:', allBundles);
    return json({ 
      error: "Not found", 
      debug: { requestedId: params.bundleId, availableBundles: allBundles }
    }, { status: 404, headers: corsHeaders });
  }
  
  console.log('✅ Bundle found:', bundle.id, bundle.title);
  return json({ bundle }, { headers: { ...corsHeaders, "Cache-Control": "public, max-age=60" } });
};

export const action = async ({ request, params }) => {
  console.log('🔍 Action called with params:', params);
  console.log('🔍 Request URL:', request.url);
  console.log('🔍 Request method:', request.method);
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  try {
    // Validate app proxy and extract shop
    let shop = null;
    const url = new URL(request.url);
    shop = url.searchParams.get('shop') || url.searchParams.get('shopify') || null;
    try { await authenticate.public.appProxy(request); } catch (_) {}
    if (!shop) return json({ error: 'Missing shop' }, { status: 400, headers: corsHeaders });

    // Find latest session for this shop to get access token
    const shopSession = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: 'desc' } });
    const accessToken = shopSession?.accessToken;
    if (!accessToken) return json({ error: 'No session for shop' }, { status: 401, headers: corsHeaders });

    const bundleId = params.bundleId;
    const body = await request.json().catch(() => ({}));

    // Support both internal id and public bundleId with more flexible matching
    let bundle = await prisma.bundle.findFirst({
      where: { 
        OR: [
          { id: bundleId }, 
          { bundleId: bundleId },
          { id: { contains: bundleId } },
          { bundleId: { contains: bundleId } }
        ] 
      },
      include: { products: true, wrappingOptions: true, cards: true, tierPrices: true },
    });
    if (!bundle) {
      console.error('❌ Bundle not found for ID:', bundleId);
      // Debug: list all available bundles
      const allBundles = await prisma.bundle.findMany({
        select: { id: true, bundleId: true, title: true }
      });
      console.log('📋 Available bundles:', allBundles);
      return json({ error: 'Bundle not found', debug: { requestedId: bundleId, availableBundles: allBundles } }, { status: 404, headers: corsHeaders });
    }

    // Recompute price server-side to avoid tampering
    const selectedProductIds = Array.isArray(body.selectedProductIds) ? body.selectedProductIds : [];
    const selectedVariantMap = body.selectedVariantMap || {}; // {productId: variantId}
    const selectedWrapId = body.selectedWrapId || null;
    const selectedCardId = body.selectedCardId || null;
    const messageValue = body.messageValue || '';

    // Calculate total price
    let total = 0;
    let subtotal = 0;
    const selectedProducts = bundle.products.filter(p => selectedProductIds.includes(p.id));
    
    for (const product of selectedProducts) {
      const variantId = selectedVariantMap[product.id];
      if (variantId && product.variantsJson) {
        try {
          const variants = JSON.parse(product.variantsJson);
          const variant = variants.find(v => v.id === variantId);
          if (variant) {
            subtotal += variant.priceCents || (product.priceCents || 0);
            if (variant.priceCents) {
              total += variant.priceCents;
            }
          } else {
            subtotal += product.priceCents || 0;
            total += product.priceCents || 0;
          }
        } catch (_) {
          subtotal += product.priceCents || 0;
          total += product.priceCents || 0;
        }
      } else {
        subtotal += product.priceCents || 0;
        total += product.priceCents || 0;
      }
    }

    // Add wrap price if selected
    if (selectedWrapId) {
      const wrap = bundle.wrappingOptions.find(w => w.id === selectedWrapId);
      if (wrap) { subtotal += wrap.priceCents || 0; total += wrap.priceCents || 0; }
    }

    // Add card price if selected
    if (selectedCardId) {
      const card = bundle.cards.find(c => c.id === selectedCardId);
      if (card) { subtotal += card.priceCents || 0; total += card.priceCents || 0; }
    }

    // Apply bundle pricing rules to compute final total from subtotal
    // (total already reflects per-variant selection; override below if bundle pricing dictates)
    const itemsCount = selectedProducts.length;
    if (bundle.tierPrices && bundle.tierPrices.length > 0) {
      const applicable = bundle.tierPrices
        .filter(t => t.minQuantity <= itemsCount)
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
    } else {
      if (bundle.pricingType === 'FIXED' && bundle.priceValueCents != null) {
        total = bundle.priceValueCents;
      } else if (bundle.pricingType === 'DISCOUNT_PERCENT' && bundle.priceValueCents != null) {
        total = Math.max(0, subtotal - Math.floor(subtotal * (bundle.priceValueCents/100)));
      } else if (bundle.pricingType === 'DISCOUNT_AMOUNT' && bundle.priceValueCents != null) {
        total = Math.max(0, subtotal - bundle.priceValueCents);
      }
    }

    const discountCents = Math.max(0, subtotal - total);

    // If prefer=discount, return a one-time discount code to apply in cart
    const prefer = new URL(request.url).searchParams.get('prefer');

    async function cleanupBundlePriceRules(maxAgeMinutes = 10){
      try {
        const listRes = await fetch(`https://${shop}/admin/api/2025-01/price_rules.json?limit=250`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        });
        if (!listRes.ok) return;
        const lj = await listRes.json();
        const now = Date.now();
        for (const pr of (lj?.price_rules || [])) {
          const title = pr?.title || '';
          const startsAt = pr?.starts_at ? Date.parse(pr.starts_at) : 0;
          const isBundle = title.startsWith('bundle-');
          const tooOld = startsAt && (now - startsAt) > maxAgeMinutes*60*1000;
          if (isBundle && (tooOld || pr?.usage_count >= 1)) {
            try {
              await fetch(`https://${shop}/admin/api/2025-01/price_rules/${pr.id}.json`, {
                method: 'DELETE',
                headers: { 'X-Shopify-Access-Token': accessToken },
              });
            } catch(_){}
          }
        }
      } catch(_){}
    }

    if (prefer === 'discount') {
      let discountCode = null;
      let priceRuleId = null;
      const debug = { subtotalCents: subtotal, totalCents: total, discountCents, itemsCount: selectedProducts.length, entitledVariantIds: [] };

      // Rotate: remove previous bundle codes quickly before issuing a new one
      await cleanupBundlePriceRules(10);

      if (discountCents > 0) {
        try {
          // Build entitled variant IDs (only the items selected for this bundle)
          const entitledVariantIds = [];
          for (const product of selectedProducts) {
            const variantGid = selectedVariantMap[product.id] || product.variantGid || null;
            if (variantGid) {
              const numericVar = String(variantGid).split('/').pop();
              if (/^[0-9]+$/.test(numericVar)) entitledVariantIds.push(Number(numericVar));
            }
          }
          debug.entitledVariantIds = entitledVariantIds;

          // Create price rule restricted to entitled variants only and harden usage
          const prBody = {
            price_rule: {
              title: `bundle-${bundle.id}-${Date.now()}`,
              target_type: 'line_item',
              target_selection: 'entitled',
              allocation_method: 'across',
              value_type: 'fixed_amount',
              value: `-${(discountCents/100).toFixed(2)}`,
              entitled_variant_ids: entitledVariantIds,
              customer_selection: 'all',
              starts_at: new Date().toISOString(),
              ends_at: new Date(Date.now()+10*60*1000).toISOString(),
              usage_limit: 1,
              once_per_customer: true,
              combines_with: { order_discounts: false, product_discounts: false, shipping_discounts: false }
            }
          };
          const prRes = await fetch(`https://${shop}/admin/api/2025-01/price_rules.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify(prBody)
          });
          let prj = null; let prText = null;
          if (prRes.ok) {
            prj = await prRes.json();
          } else {
            try { prText = await prRes.text(); } catch(_) {}
            console.error('❌ price_rules create failed:', prRes.status, prText);
          }
          priceRuleId = prj?.price_rule?.id || null;
          console.log('✅ Created price rule:', priceRuleId, 'status:', prRes.status);
          if (!priceRuleId && prj) {
            console.warn('⚠️ price_rules response body:', JSON.stringify(prj));
          }
          if (priceRuleId) {
            const code = `BNDL-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
            const dcRes = await fetch(`https://${shop}/admin/api/2025-01/price_rules/${priceRuleId}/discount_codes.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
              body: JSON.stringify({ discount_code: { code } })
            });
            let dcj = null; let dcText = null;
            if (dcRes.ok) { dcj = await dcRes.json(); } else { try { dcText = await dcRes.text(); } catch(_) {} console.error('❌ discount_codes create failed:', dcRes.status, dcText); }
            discountCode = dcj?.discount_code?.code || null;
            console.log('✅ Created discount code:', discountCode, 'status:', dcRes.status);
          }
        } catch(err) { console.error('❌ Discount creation error:', err); }
      } else {
        console.warn('⚠️ Computed discountCents is 0. subtotal vs total:', subtotal, total);
      }

      return json({
        mode: 'discount_code',
        discountCents,
        discountCode,
        priceRuleId,
        debug
      }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
    }

    // Cache Online Store publication id per-request
    let onlineStorePublicationId = null;
    async function getOnlineStorePublicationId(){
      if (onlineStorePublicationId) return onlineStorePublicationId;
      try {
        const q = `#graphql\n          query GetPublications {\n            publications(first: 10) { nodes { id name } }\n          }`;
        const pubRes = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ query: q })
        });
        const pj = await pubRes.json();
        const online = pj?.data?.publications?.nodes?.find(n => n?.name === 'Online Store');
        onlineStorePublicationId = online?.id || null;
      } catch(_){ onlineStorePublicationId = null; }
      return onlineStorePublicationId;
    }

    async function createUniqueBundleProduct(cents, bundleTitle, bundleId) {
      // Generate unique product title with timestamp
      const timestamp = Date.now();
      const uniqueTitle = `Bundle: ${bundleTitle} - ${timestamp}`;
      
      try {
        // Create new draft product
        const mutation = `mutation CreateProduct($input: ProductInput!) { \n          productCreate(input: $input) { \n            product { id } \n            userErrors { field message } \n          } \n        }`;
        
        const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
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

        // Ensure product is active and published to web via REST as well
        try {
          await fetch(`https://${shop}/admin/api/2025-01/products/${productNumericId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ product: { id: Number(productNumericId), status: 'active', published_scope: 'web', published_at: new Date().toISOString() } })
          });
        } catch(_) {}

        // Create variant for the new product
        try {
          const cRes = await fetch(`https://${shop}/admin/api/2025-01/products/${productNumericId}/variants.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ 
              variant: { 
                option1: 'Default', 
                title: 'Bundle', 
                price, 
                inventory_management: 'shopify', 
                inventory_policy: 'continue', 
                inventory_quantity: 999,
                taxable: false, 
                weight: 0.0, 
                weight_unit: 'kg',
                requires_shipping: false 
              } 
            })
          });
          
          if (cRes.ok) {
            const vj = await cRes.json();
            console.log('Variant creation response:', JSON.stringify(vj, null, 2));
            if (vj?.variant?.id) {
              const newId = String(vj.variant.id);

              // Ensure inventory level is available at a location
              try {
                const locRes = await fetch(`https://${shop}/admin/api/2025-01/locations.json`, {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                });
                if (locRes.ok) {
                  const lj = await locRes.json();
                  const firstLocation = (lj?.locations || []).find(l => l?.id);
                  if (firstLocation && vj.variant.inventory_item_id) {
                    await fetch(`https://${shop}/admin/api/2025-01/inventory_levels/set.json`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                      body: JSON.stringify({
                        location_id: firstLocation.id,
                        inventory_item_id: vj.variant.inventory_item_id,
                        available: 999
                      })
                    });
                  }
                }
              } catch(_) {}
              
              // Publish product to Online Store so variant is purchasable
              try {
                const pubId = await getOnlineStorePublicationId();
                if (pubId) {
                  const m = `#graphql\n                    mutation Publish($id: ID!, $pub: ID!) {\n                      publishablePublish(id: $id, input: { publicationId: $pub }) {\n                        publishable { __typename ... on Node { id } }\n                        userErrors { field message }\n                      }\n                    }`;
                  await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                    body: JSON.stringify({ query: m, variables: { id: productIdGid, pub: pubId } })
                  });
                }
              } catch(_) {}

              // Poll until variant is readable and purchasable
              for (let i = 0; i < 20; i++) {
                try {
                  const chk = await fetch(`https://${shop}/admin/api/2025-01/variants/${vj.variant.id}.json`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                  });
                  if (chk.ok) {
                    const cj = await chk.json();
                    if (cj?.variant?.id) break;
                  }
                } catch(_) {}
                await new Promise(r => setTimeout(r, 800));
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

    async function ensureVariantForBundlePrice(cents) {
      // Try to find by tag bundle-<id>
      let productIdGid = null;
      try {
        const resp = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
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
          const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ query: mutation, variables: { input: { title, status: 'ACTIVE', tags: ['bundle-charge-master','hidden-product'], vendor: 'Bundle Add-on', productType: 'Bundle', publishedScope: 'WEB' } } })
          });
          const j = await res.json();
          const err = j?.data?.productCreate?.userErrors?.[0];
          if (!err) productIdGid = j?.data?.productCreate?.product?.id || null;
          else {
            console.error('❌ productCreate userError:', err);
          }
        } catch (_) {}
      }
      if (!productIdGid) return null;

      // Ensure product is published to Online Store
      try {
        const pubId = await getOnlineStorePublicationId();
        if (pubId) {
          const publishMutation = `#graphql\n            mutation Publish($id: ID!, $pub: ID!) {\n              publishablePublish(id: $id, input: { publicationId: $pub }) { publishable { __typename ... on Node { id } } userErrors { field message } }\n            }`;
          await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ query: publishMutation, variables: { id: productIdGid, pub: pubId } })
          });
        }
      } catch(_) {}

      // Also enforce ACTIVE via REST and set published_scope
      try {
        const productNumericId = String(productIdGid).split('/').pop();
        await fetch(`https://${shop}/admin/api/2025-01/products/${productNumericId}.json`, {
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
        const vRes = await fetch(`https://${shop}/admin/api/2025-01/products/${productNumericId}/variants.json`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        });
        if (vRes.ok) {
          const vj = await vRes.json();
          variantId = vj?.variants?.[0]?.id || null;
        }
      } catch (_) {}

      if (variantId) {
        // Update price and attributes
        try {
          await fetch(`https://${shop}/admin/api/2025-01/variants/${variantId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ variant: { id: variantId, price, inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: 999, inventory_item_id: null, requires_shipping: false } })
          });
        } catch (_) {}
        
        // Ensure inventory level is available
        try {
          const vGet = await fetch(`https://${shop}/admin/api/2025-01/variants/${variantId}.json`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          });
          const vj = vGet.ok ? await vGet.json() : null;
          const invItemId = vj?.variant?.inventory_item_id;
          if (invItemId) {
            const locRes = await fetch(`https://${shop}/admin/api/2025-01/locations.json`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            });
            if (locRes.ok) {
              const lj = await locRes.json();
              const firstLocation = (lj?.locations || []).find(l => l?.id);
              if (firstLocation) {
                await fetch(`https://${shop}/admin/api/2025-01/inventory_levels/set.json`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                  body: JSON.stringify({
                    location_id: firstLocation.id,
                    inventory_item_id: invItemId,
                    available: 999
                  })
                });
              }
            }
          }
        } catch(_) {}
        
        return String(variantId);
      }

      // Create variant
      try {
        const cRes = await fetch(`https://${shop}/admin/api/2025-01/products/${productNumericId}/variants.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ variant: { option1: 'Default', title: 'Bundle', price, inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: 999, taxable: false, weight: 0.0, weight_unit: 'kg', requires_shipping: false } })
        });
        if (cRes.ok) {
          const vj = await cRes.json();
          if (vj?.variant?.id) {
            // Ensure inventory level
            try {
              if (vj.variant.inventory_item_id) {
                const locRes = await fetch(`https://${shop}/admin/api/2025-01/locations.json`, {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                });
                if (locRes.ok) {
                  const lj = await locRes.json();
                  const firstLocation = (lj?.locations || []).find(l => l?.id);
                  if (firstLocation) {
                    await fetch(`https://${shop}/admin/api/2025-01/inventory_levels/set.json`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                      body: JSON.stringify({
                        location_id: firstLocation.id,
                        inventory_item_id: vj.variant.inventory_item_id,
                        available: 999
                      })
                    });
                  }
                }
              }
            } catch(_) {}
            return String(vj.variant.id);
          }
        } else {
          const txt = await cRes.text().catch(()=> '');
          console.error('❌ Variant create failed (master-product path):', cRes.status, txt);
        }
      } catch (_) {}
      return null;
    }

    // Use master product variant approach by default
    let variantId = await ensureVariantForBundlePrice(total);
    if (!variantId) {
      console.warn('⚠️ Master-product path returned null. Falling back to unique product.');
      variantId = await createUniqueBundleProduct(total, bundle.title, bundle.id);
    }

    // Final readiness check against storefront endpoint to avoid 422s
    try {
      const numericId = String(variantId).split('/').pop();
      for (let i = 0; i < 20; i++) {
        try {
          const check = await fetch(`https://${shop}/variants/${numericId}.json`, { method: 'GET' });
          if (check.ok) {
            const j = await check.json().catch(()=>null);
            if (j && j.variant && j.variant.id) break;
          }
        } catch(_) {}
        await new Promise(r => setTimeout(r, 800));
      }
    } catch(_) {}
    
    if (!variantId) return json({ error: 'Failed to create bundle product' }, { status: 500, headers: corsHeaders });

    return json({
      variantId,
      totalCents: total,
    }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });

  } catch (error) {
    console.error('❌ Bundle preparation error:', error);
    return json({ 
      error: "Internal server error", 
      details: error.message,
      stack: error.stack
    }, { 
      status: 500,
      headers: corsHeaders
    });
  }
};


