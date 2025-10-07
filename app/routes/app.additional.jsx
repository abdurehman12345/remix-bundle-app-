import {
  Card,
  Layout,
  Page,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  ResourceList,
  Checkbox,
  Divider,
  Badge,
  Thumbnail,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useEffect } from "react";
import { useLoaderData, Form, useActionData } from "@remix-run/react";
import { json, redirect } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getPlan } from "./routes";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const bundleId = url.searchParams.get("bundleId");
  if (!bundleId) {
    return json({ error: "bundleId is required" }, { status: 400 });
  }
  const bundle = await prisma.bundle.findUnique({
    where: { id: bundleId },
    include: { products: true, wrappingOptions: true, cards: true },
  });
  if (!bundle) return json({ error: "Not found" }, { status: 404 });
  const plan = await getPlan(prisma, session.shop);
  return json({ bundle, shop: session.shop, plan });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  function toAbsoluteImageUrl(urlStr) {
    if (!urlStr) return null;
    try {
      // If it's already a full URL, return as is
      if (/^https?:\/\//i.test(urlStr)) return urlStr;
      
      // If it's a Cloudflare tunnel URL, extract the path and convert to permanent URL
      if (urlStr.includes('trycloudflare.com')) {
        const url = new URL(urlStr);
        const path = url.pathname;
        const base = process.env.SHOPIFY_APP_URL || 'https://store-revive.myshopify.com';
        return `${base}${path}`;
      }
      
      // For relative paths, convert to absolute
      const base = process.env.SHOPIFY_APP_URL || 'https://store-revive.myshopify.com';
      if (urlStr.startsWith('/uploads/')) return `${base}${urlStr}`;
      if (urlStr.startsWith('uploads/')) return `${base}/${urlStr}`;
      return `${base}/${urlStr.replace(/^\//, '')}`;
    } catch {
      return urlStr;
    }
  }

  async function uploadImageToShopifyFiles(imageUrl) {
    try {
      if (!imageUrl) return null;
      const files = [{ originalSource: imageUrl, contentType: "IMAGE" }];
      const mutation = `mutation FileCreate($files: [FileCreateInput!]!) {\n        fileCreate(files: $files) {\n          files {\n            __typename\n            ... on GenericFile { id url }\n            ... on MediaImage { id image { url } }\n          }\n          userErrors { field message }\n        }\n      }`;
      const resp = await admin.graphql(mutation, { variables: { files } });
      const data = await resp.json();
      const err = data?.data?.fileCreate?.userErrors?.[0];
      if (err) { console.warn('fileCreate error:', err); return null; }
      const f = data?.data?.fileCreate?.files?.[0];
      const url = f?.url || f?.image?.url || null;
      return url;
    } catch (e) {
      console.warn('fileCreate exception:', e?.message || e);
      return null;
    }
  }

  async function validateAndCleanProduct(productId, productType) {
    try {
      // Convert GraphQL GID to numeric ID
      const productNumericId = String(productId).split('/').pop();
      
      // Test if the product exists by trying to fetch it
      const productResp = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}.json`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      });
      
      if (productResp.ok) {
        const productData = await productResp.json();
        if (productData?.product) {
          console.log(`✅ Product ${productNumericId} is valid`);
          return productId; // Return the original ID if valid
        }
      }
      
      // Product is invalid, create a new one
      console.log(`⚠️ Product ${productNumericId} is invalid, creating new ${productType}`);
      
      const title = `${productType}: ${productType === 'Bundle Wrap' ? 'Wrap' : 'Card'} - ${Date.now()}`;
      const createProductMutation = `mutation CreateProduct($input: ProductInput!) {\n        productCreate(input: $input) {\n          product { id }\n          userErrors { field message }\n        }\n      }`;
      
      const prodRes = await admin.graphql(createProductMutation, { 
        variables: { input: { title, status: 'DRAFT' } } 
      });
      
      if (prodRes.ok) {
        const prodData = await prodRes.json();
        const prodErr = prodData?.data?.productCreate?.userErrors?.[0];
        if (!prodErr) {
          const newProductId = prodData?.data?.productCreate?.product?.id || null;
          if (newProductId) {
            console.log(`✅ Created new ${productType} product: ${newProductId}`);
            
            // Configure the product as hidden but functional for cart
            await configureHiddenProduct(newProductId, productType);
            
            return newProductId;
          }
        } else {
          console.warn(`❌ Failed to create new ${productType} product:`, prodErr.message);
        }
      }
      
      return null;
    } catch (e) {
      console.warn(`❌ Product validation exception:`, e?.message || e);
      return null;
    }
  }

  async function setDefaultVariantPrice(productId, price) {
    try {
      // Always work with numeric product ID for REST endpoints
      const productNumericId = String(productId).split('/').pop();
      console.log(`🔧 Ensuring single variant for product ${productNumericId} @ price ${price}`);

      // 1) Try to fetch existing variants first
      const variantsResp = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}/variants.json`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      });

      if (variantsResp.ok) {
        const variantsJson = await variantsResp.json();
        const first = variantsJson?.variants?.[0] || null;
        if (first?.id) {
          const variantId = first.id;
          // Update price/inventory of the existing default variant
          const putResp = await fetch(`https://${session.shop}/admin/api/2024-10/variants/${variantId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
            body: JSON.stringify({ variant: { id: variantId, price, inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: 999 } })
          });
          if (!putResp.ok) {
            const txt = await putResp.text();
            console.warn('Variant update failed:', putResp.status, txt);
          } else {
            console.log(`✅ Updated existing variant ${variantId}`);
          }
          // Return numeric ID for cart operations
          return String(variantId);
        }
      } else {
        const t = await variantsResp.text();
        console.warn('Fetch variants failed:', variantsResp.status, t);
      }

      // 2) If no variants present, create exactly one
      const createVariantResp = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}/variants.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        body: JSON.stringify({ variant: { option1: 'Default', price, inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: 999, weight: 0.1, weight_unit: 'kg' } })
      });
      if (createVariantResp.ok) {
        const vj = await createVariantResp.json();
        const id = vj?.variant?.id;
        if (id) {
          console.log(`✅ Created first variant ${id}`);
          return String(id);
        }
      } else {
        const txt = await createVariantResp.text();
        console.warn('Create variant failed:', createVariantResp.status, txt);
      }

      // 3) Last chance: re-read variants and return first if any appeared
      const reread = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}/variants.json`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      });
      if (reread.ok) {
        const j = await reread.json();
        const first = j?.variants?.[0];
        if (first?.id) return String(first.id);
      }

      return null;
    } catch (e) {
      console.warn('setDefaultVariantPrice exception:', e?.message || e);
      return null;
    }
  }

  async function configureHiddenProduct(productId, productType) {
    try {
      // Configure the product to be properly hidden but functional for cart
      const updateProductMutation = `mutation productUpdate($input: ProductInput!) {\n            productUpdate(input: $input) {\n              product { id }\n              userErrors { field message }\n            }\n          }`;
      
      const updateRes = await admin.graphql(updateProductMutation, { 
        variables: { 
          input: { 
            id: productId,
            status: 'DRAFT',
            publishedAt: null, // Ensure it's not published
            vendor: 'Bundle Add-on', // Add vendor to identify as bundle item
            productType: productType, // Add product type
            tags: ['bundle-addon', 'hidden-product'] // Add tags for identification
          } 
        } 
      });
      
      if (updateRes.ok) {
        console.log(`✅ Configured ${productType} product as hidden: ${productId}`);
        return true;
      } else {
        console.warn(`⚠️ Failed to configure ${productType} product: ${productId}`);
        return false;
      }
    } catch (e) {
      console.warn(`❌ Configure hidden product exception:`, e?.message || e);
      return false;
    }
  }

  if (intent === "update-bundle-image") {
    const bundleId = String(formData.get("bundleId"));
    const imageUrl = String(formData.get("imageUrl") || "").trim() || null;
    await prisma.bundle.update({ where: { id: bundleId }, data: { imageUrl } });
    return redirect(`/app/additional?bundleId=${bundleId}`);
  }

  if (intent === "update-discount") {
    const bundleId = String(formData.get("bundleId"));
    const pricingType = String(formData.get("pricingType"));
    const priceValueCents = formData.get("priceValueCents")
      ? Number(formData.get("priceValueCents"))
      : null;
    await prisma.bundle.update({
      where: { id: bundleId },
      data: {
        pricingType: pricingType,
        priceValueCents: priceValueCents,
      },
    });
    return redirect(`/app/additional?bundleId=${bundleId}`);
  }

  if (intent === "add-wrap") {
    const bundleId = String(formData.get("bundleId"));
    const name = String(formData.get("name") || "").trim();
    const priceCents = Number(formData.get("priceCents") || 0);
    const imageUrlRaw = String(formData.get("imageUrl") || "").trim() || null;
    const imageUrl = imageUrlRaw;
    if (!name || !imageUrl) return json({ error: "Name and image are required" }, { status: 400 });
    if (priceCents < 0 || !Number.isFinite(priceCents)) return json({ error: "Price must be a non-negative number of cents" }, { status: 400 });

    const existingWraps = await prisma.wrappingOption.findMany({ where: { bundleId } });
    if (existingWraps.some(w => (w.name || '').trim().toLowerCase() === name.toLowerCase())) {
      return json({ error: `A wrap named "${name}" already exists in this bundle.` }, { status: 400 });
    }

    let shopifyProductId = null;
    let shopifyVariantId = null;
    const price = (Number(priceCents || 0) / 100).toFixed(2);
    const title = `Wrap: ${name}`;

    try {
      // First try GraphQL productCreate
      const createProductMutation = `mutation CreateProduct($input: ProductInput!) {\n        productCreate(input: $input) {\n          product { id }\n          userErrors { field message }\n        }\n      }`;
      const prodRes = await admin.graphql(createProductMutation, { variables: { input: { title, status: 'DRAFT' } } });
      const prodData = await prodRes.json();
      const prodErr = prodData?.data?.productCreate?.userErrors?.[0];
      if (!prodErr) {
        shopifyProductId = prodData?.data?.productCreate?.product?.id || null;
      } else {
        console.warn('productCreate error (wrap):', prodErr);
      }

      // REST fallback if GraphQL failed to create
      if (!shopifyProductId) {
        try {
          const restResp = await fetch(`https://${session.shop}/admin/api/2024-10/products.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
            body: JSON.stringify({ product: { title, status: 'draft', body_html: `Hidden bundle wrap: ${name}` } })
          });
          if (restResp.ok) {
            const j = await restResp.json();
            const idNum = j?.product?.id;
            if (idNum) shopifyProductId = `gid://shopify/Product/${idNum}`;
          } else {
            const txt = await restResp.text();
            console.warn('REST product create failed (wrap):', restResp.status, txt);
          }
        } catch (e) { console.warn('REST product create exception (wrap):', e?.message || e); }
      }

      if (!shopifyProductId) {
        return json({ error: 'Failed to create Shopify product for wrap. Please try again.' }, { status: 500 });
      }

      console.log(`🔍 Setting up variant for product ${shopifyProductId} with price ${price}`);
      const vId = await setDefaultVariantPrice(shopifyProductId, price);
      if (vId) {
        shopifyVariantId = vId;
        console.log(`✅ Successfully got variant ID: ${shopifyVariantId}`);
      } else {
        console.warn(`❌ Failed to get variant ID for product ${shopifyProductId}`);
      }

      // Configure the product as hidden but functional for cart
      await configureHiddenProduct(shopifyProductId, 'Bundle Wrap');

      if (imageUrl) {
        const absoluteImageUrl = toAbsoluteImageUrl(imageUrl);
        let hostedUrl = await uploadImageToShopifyFiles(absoluteImageUrl) || absoluteImageUrl;
        const imgMutation = `mutation ImageCreate($productId: ID!, $src: URL!) {\n          productImageCreate(productId: $productId, src: $src) {\n            image { id }\n            userErrors { field message }\n          }\n        }`;
        try { 
          const imgRes = await admin.graphql(imgMutation, { variables: { productId: shopifyProductId, src: hostedUrl } });
          const imgData = await imgRes.json();
          const imgErr = imgData?.data?.productImageCreate?.userErrors?.[0];
          if (imgErr) { throw new Error(imgErr.message || 'image error'); }
        } catch(_) {
          try {
            const productNumericId = shopifyProductId.split('/').pop();
            await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}/images.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
              body: JSON.stringify({ image: { src: hostedUrl } })
            });
          } catch (e) { console.warn('REST image attach failed:', e?.message || e); }
        }
      }
    } catch (e) {
      console.warn('Failed to create wrap product in Shopify:', e?.message || e);
      return json({ error: 'Unexpected error while creating wrap.' }, { status: 500 });
    }
    
    await prisma.wrappingOption.create({ 
      data: { bundleId, name, priceCents, imageUrl, shopifyProductId, shopifyVariantId }
    });
    return redirect(`/app/additional?bundleId=${bundleId}`);
  }

  if (intent === "add-card") {
    const bundleId = String(formData.get("bundleId"));
    const name = String(formData.get("name") || "").trim();
    const imageUrlRaw = String(formData.get("imageUrl") || "").trim();
    const imageUrl = imageUrlRaw;
    const priceCents = Number(formData.get("priceCents") || 0);
    if (!name || !imageUrl) return json({ error: "Name and image are required" }, { status: 400 });
    if (priceCents < 0 || !Number.isFinite(priceCents)) return json({ error: "Price must be a non-negative number of cents" }, { status: 400 });

    const existingCards = await prisma.bundleCard.findMany({ where: { bundleId } });
    if (existingCards.some(c => (c.name || '').trim().toLowerCase() === name.toLowerCase())) {
      return json({ error: `A card named "${name}" already exists in this bundle.` }, { status: 400 });
    }

    let shopifyProductId = null;
    let shopifyVariantId = null;
    const price = (Number(priceCents || 0) / 100).toFixed(2);
    const title = `Card: ${name}`;

    try {
      const createProductMutation = `mutation CreateProduct($input: ProductInput!) {\n        productCreate(input: $input) {\n          product { id }\n          userErrors { field message }\n        }\n      }`;
      const prodRes = await admin.graphql(createProductMutation, { variables: { input: { title, status: 'DRAFT' } } });
      const prodData = await prodRes.json();
      const prodErr = prodData?.data?.productCreate?.userErrors?.[0];
      if (!prodErr) {
        shopifyProductId = prodData?.data?.productCreate?.product?.id || null;
      } else {
        console.warn('productCreate error (card):', prodErr);
      }

      if (!shopifyProductId) {
        try {
          const restResp = await fetch(`https://${session.shop}/admin/api/2024-10/products.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
            body: JSON.stringify({ product: { title, status: 'draft', body_html: `Hidden bundle card: ${name}` } })
          });
          if (restResp.ok) {
            const j = await restResp.json();
            const idNum = j?.product?.id;
            if (idNum) shopifyProductId = `gid://shopify/Product/${idNum}`;
          } else {
            const txt = await restResp.text();
            console.warn('REST product create failed (card):', restResp.status, txt);
          }
        } catch (e) { console.warn('REST product create exception (card):', e?.message || e); }
      }

      if (!shopifyProductId) {
        return json({ error: 'Failed to create Shopify product for card. Please try again.' }, { status: 500 });
      }

      const vId = await setDefaultVariantPrice(shopifyProductId, price);
      if (vId) shopifyVariantId = vId;

      await configureHiddenProduct(shopifyProductId, 'Bundle Card');

      if (imageUrl) {
        const absoluteImageUrl = toAbsoluteImageUrl(imageUrl);
        let hostedUrl = await uploadImageToShopifyFiles(absoluteImageUrl) || absoluteImageUrl;
        const imgMutation = `mutation ImageCreate($productId: ID!, $src: URL!) {\n          productImageCreate(productId: $productId, src: $src) {\n            image { id }\n            userErrors { field message }\n          }\n        }`;
        try { 
          const imgRes = await admin.graphql(imgMutation, { variables: { productId: shopifyProductId, src: hostedUrl } });
          const imgData = await imgRes.json();
          const imgErr = imgData?.data?.productImageCreate?.userErrors?.[0];
          if (imgErr) { throw new Error(imgErr.message || 'image error'); }
        } catch(_) {
          try {
            const productNumericId = shopifyProductId.split('/').pop();
            await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}/images.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
              body: JSON.stringify({ image: { src: hostedUrl } })
            });
          } catch (e) { console.warn('REST image attach failed:', e?.message || e); }
        }
      }
    } catch (e) {
      console.warn('Failed to create card product in Shopify:', e?.message || e);
      return json({ error: 'Unexpected error while creating card.' }, { status: 500 });
    }
    
    await prisma.bundleCard.create({ 
      data: { bundleId, name, imageUrl, priceCents, shopifyProductId, shopifyVariantId }
    });
    return redirect(`/app/additional?bundleId=${bundleId}`);
  }

  if (intent === "backfill-products") {
    const bundleId = String(formData.get("bundleId"));
    if (!bundleId) return json({ error: "bundleId is required" }, { status: 400 });

    const bundle = await prisma.bundle.findUnique({
      where: { id: bundleId },
      include: { wrappingOptions: true, cards: true }
    });
    if (!bundle) return json({ error: "Bundle not found" }, { status: 404 });

    for (const w of bundle.wrappingOptions) {
      if (!w.shopifyProductId) {
        try {
          const title = `Wrap: ${w.name}`;
          const createProductMutation = `mutation CreateProduct($input: ProductInput!) {\n            productCreate(input: $input) {\n              product { id }\n              userErrors { field message }\n            }\n          }`;
          const prodRes = await admin.graphql(createProductMutation, { variables: { input: { title, status: 'DRAFT' } } });
          const prodData = await prodRes.json();
          const prodErr = prodData?.data?.productCreate?.userErrors?.[0];
          let productId = null; let variantId = null;
          if (!prodErr) {
            productId = prodData?.data?.productCreate?.product?.id || null;
            if (productId) {
              // Always use the fallback method since defaultVariant field is not available
              const vId = await setDefaultVariantPrice(productId, ((w.priceCents||0)/100).toFixed(2));
              if (vId) variantId = vId;
              
              // Configure the product as hidden but functional for cart
              await configureHiddenProduct(productId, 'Bundle Wrap');
              
              const imgUrl = toAbsoluteImageUrl(w.imageUrl);
              if (productId && imgUrl) {
                const hostedUrl = await uploadImageToShopifyFiles(imgUrl) || imgUrl;
                const imgMutation = `mutation ImageCreate($productId: ID!, $src: URL!) {\n                productImageCreate(productId: $productId, src: $src) {\n                  image { id }\n                  userErrors { field message }\n                }\n              }`;
                try { await admin.graphql(imgMutation, { variables: { productId, src: hostedUrl } }); } catch(_) {}
              }
            }
            await prisma.wrappingOption.update({ where: { id: w.id }, data: { shopifyProductId: productId, shopifyVariantId: variantId } });
          }
        } catch (e) { console.warn('Backfill wrap exception:', e?.message || e); }
      }
    }

    for (const c of (bundle.cards || [])) {
      if (!c.shopifyProductId) {
        try {
          const title = `Card: ${c.name}`;
          const createProductMutation = `mutation CreateProduct($input: ProductInput!) {\n            productCreate(input: $input) {\n              product { id }\n              userErrors { field message }\n            }\n          }`;
          const prodRes = await admin.graphql(createProductMutation, { variables: { input: { title, status: 'DRAFT' } } });
          const prodData = await prodRes.json();
          const prodErr = prodData?.data?.productCreate?.userErrors?.[0];
          let productId = null; let variantId = null;
          if (!prodErr) {
            productId = prodData?.data?.productCreate?.product?.id || null;
            const vId = await setDefaultVariantPrice(productId, ((c.priceCents||0)/100).toFixed(2));
            if (vId) variantId = vId;
            
            // Configure the product as hidden but functional for cart
            await configureHiddenProduct(productId, 'Bundle Card');
            
            const imgUrl = toAbsoluteImageUrl(c.imageUrl);
            if (productId && imgUrl) {
              const hostedUrl = await uploadImageToShopifyFiles(imgUrl) || imgUrl;
              const imgMutation = `mutation ImageCreate($productId: ID!, $src: URL!) {\n                productImageCreate(productId: $productId, src: $src) {\n                  image { id }\n                  userErrors { field message }\n                }\n              }`;
              try { await admin.graphql(imgMutation, { variables: { productId, src: hostedUrl } }); } catch(_) {}
            }
          }
          await prisma.bundleCard.update({ where: { id: c.id }, data: { shopifyProductId: productId, shopifyVariantId: variantId } });
        } catch (e) { console.warn('Backfill card exception:', e?.message || e); }
      }
    }

    return redirect(`/app/additional?bundleId=${bundleId}`);
  }

  if (intent === "backfill-all-products") {
    const bundles = await prisma.bundle.findMany({ include: { wrappingOptions: true, cards: true } });

    for (const b of bundles) {
      for (const w of b.wrappingOptions) {
        if (!w.shopifyProductId) {
          try {
            const title = `Wrap: ${w.name}`;
            const createProductMutation = `mutation CreateProduct($input: ProductInput!) {\n              productCreate(input: $input) {\n                product { id }\n                userErrors { field message }\n              }\n            }`;
            const prodRes = await admin.graphql(createProductMutation, { variables: { input: { title, status: 'DRAFT' } } });
            const prodData = await prodRes.json();
            const prodErr = prodData?.data?.productCreate?.userErrors?.[0];
            let productId = null; let variantId = null;
            if (!prodErr) {
              productId = prodData?.data?.productCreate?.product?.id || null;
              if (productId) {
                // Always use the fallback method since defaultVariant field is not available
                const vId = await setDefaultVariantPrice(productId, ((w.priceCents||0)/100).toFixed(2));
                if (vId) variantId = vId;
                
                // Configure the product as hidden but functional for cart
                await configureHiddenProduct(productId, 'Bundle Wrap');
              }
              const imgUrl = toAbsoluteImageUrl(w.imageUrl);
              if (productId && imgUrl) {
                const hostedUrl = await uploadImageToShopifyFiles(imgUrl) || imgUrl;
                const imgMutation = `mutation ImageCreate($productId: ID!, $src: URL!) {\n                  productImageCreate(productId: $productId, src: $src) {\n                    image { id }\n                    userErrors { field message }\n                  }\n                }`;
                try { await admin.graphql(imgMutation, { variables: { productId, src: hostedUrl } }); } catch(_) {}
              }
            }
            await prisma.wrappingOption.update({ where: { id: w.id }, data: { shopifyProductId: productId, shopifyVariantId: variantId } });
          } catch (e) { console.warn('Backfill ALL wrap exception:', e?.message || e); }
        } else if (w.shopifyVariantId && w.shopifyVariantId.includes('gid://')) {
          // Fix existing wraps that have GID format variant IDs
          try {
            const variantId = w.shopifyVariantId.split('/').pop();
            await prisma.wrappingOption.update({ 
              where: { id: w.id }, 
              data: { shopifyVariantId: variantId } 
            });
            console.log(`Fixed wrap ${w.name} variant ID from GID to numeric: ${variantId}`);
          } catch (e) { console.warn('Fix wrap variant ID exception:', e?.message || e); }
        }
      }
      for (const c of (b.cards || [])) {
        if (!c.shopifyProductId) {
          try {
            const title = `Card: ${c.name}`;
            const createProductMutation = `mutation CreateProduct($input: ProductInput!) {\n              productCreate(input: $input) {\n                product { id }\n                userErrors { field message }\n              }\n            }`;
            const prodRes = await admin.graphql(createProductMutation, { variables: { input: { title, status: 'DRAFT' } } });
            const prodData = await prodRes.json();
            const prodErr = prodData?.data?.productCreate?.userErrors?.[0];
            let productId = null; let variantId = null;
            if (!prodErr) {
              productId = prodData?.data?.productCreate?.product?.id || null;
              if (productId) {
                // Always use the fallback method since defaultVariant field is not available
                const vId = await setDefaultVariantPrice(productId, ((c.priceCents||0)/100).toFixed(2));
                if (vId) variantId = vId;
                
                // Configure the product as hidden but functional for cart
                await configureHiddenProduct(productId, 'Bundle Card');
              }
              const imgUrl = toAbsoluteImageUrl(c.imageUrl);
              if (productId && imgUrl) {
                const hostedUrl = await uploadImageToShopifyFiles(imgUrl) || imgUrl;
                const imgMutation = `mutation ImageCreate($productId: ID!, $src: URL!) {\n                  productImageCreate(productId: $productId, src: $src) {\n                    image { id }\n                    userErrors { field message }\n                  }\n                }`;
                try { await admin.graphql(imgMutation, { variables: { productId, src: hostedUrl } }); } catch(_) {}
              }
            }
            await prisma.bundleCard.update({ where: { id: c.id }, data: { shopifyProductId: productId, shopifyVariantId: variantId } });
          } catch (e) { console.warn('Backfill ALL card exception:', e?.message || e); }
        } else if (c.shopifyVariantId && c.shopifyVariantId.includes('gid://')) {
          // Fix existing cards that have GID format variant IDs
          try {
            const variantId = c.shopifyVariantId.split('/').pop();
            await prisma.bundleCard.update({ 
              where: { id: c.id }, 
              data: { shopifyVariantId: variantId } 
            });
            console.log(`Fixed card ${c.name} variant ID from GID to numeric: ${variantId}`);
          } catch (e) { console.warn('Fix card variant ID exception:', e?.message || e); }
        }
      }
    }

    return redirect(`/app/additional?bundleId=${bundles?.[0]?.id || ''}`);
  }

  if (intent === "fix-variant-ids") {
    // Fix existing wraps and cards that have GID format variant IDs
    const wraps = await prisma.wrappingOption.findMany();
    let fixedCount = 0;
    
    for (const wrap of wraps) {
      if (wrap.shopifyVariantId && wrap.shopifyVariantId.includes('gid://')) {
        try {
          const variantId = wrap.shopifyVariantId.split('/').pop();
          await prisma.wrappingOption.update({ 
            where: { id: wrap.id }, 
            data: { shopifyVariantId: variantId } 
          });
          fixedCount++;
          console.log(`Fixed wrap ${wrap.name} variant ID from GID to numeric: ${variantId}`);
        } catch (e) { console.warn('Fix wrap variant ID exception:', e?.message || e); }
      }
    }
    
    const cards = await prisma.bundleCard.findMany();
    for (const card of cards) {
      if (card.shopifyVariantId && card.shopifyVariantId.includes('gid://')) {
        try {
          const variantId = card.shopifyVariantId.split('/').pop();
          await prisma.bundleCard.update({ 
            where: { id: card.id }, 
            data: { shopifyVariantId: variantId } 
          });
          fixedCount++;
          console.log(`Fixed card ${card.name} variant ID from GID to numeric: ${variantId}`);
        } catch (e) { console.warn('Fix card variant ID exception:', e?.message || e); }
      }
    }
    
    return json({ success: `Fixed ${fixedCount} variant IDs` });
  }

  if (intent === "verify-variants") {
    // Verify that all variant IDs are valid and fix any issues
    const wraps = await prisma.wrappingOption.findMany();
    let verifiedCount = 0;
    let fixedCount = 0;
    
    for (const wrap of wraps) {
      if (wrap.shopifyProductId && wrap.shopifyVariantId) {
        try {
          const productId = wrap.shopifyProductId;
          const variantId = wrap.shopifyVariantId;
          
          console.log(`🔍 Verifying wrap: ${wrap.name} (Product: ${productId}, Variant: ${variantId})`);
          
          // First validate the product ID
          const validProductId = await validateAndCleanProduct(productId, 'Bundle Wrap');
          if (!validProductId) {
            console.warn(`⚠️ Wrap ${wrap.name}: Product is invalid, skipping verification`);
            continue;
          }
          
          // Use REST API to verify the variant exists
          const productNumericId = String(validProductId).split('/').pop();
          const variantsResp = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}/variants.json`, {
            method: 'GET',
            headers: { 
              'Content-Type': 'application/json', 
              'X-Shopify-Access-Token': session.accessToken 
            },
          });
          
          if (variantsResp.ok) {
            const variantsJson = await variantsResp.json();
            const variant = variantsJson?.variants?.find(v => v.id.toString() === variantId);
            
            if (variant) {
              verifiedCount++;
              console.log(`✅ Wrap ${wrap.name}: Variant ${variantId} verified for product ${productNumericId}`);
            } else {
              console.warn(`⚠️ Wrap ${wrap.name}: Variant ${variantId} not found, attempting to create one...`);
              
              // Try to create a variant for this product
              const price = ((wrap.priceCents || 0) / 100).toFixed(2);
              const newVariantId = await setDefaultVariantPrice(validProductId, price);
              
              if (newVariantId) {
                await prisma.wrappingOption.update({ 
                  where: { id: wrap.id }, 
                  data: { shopifyVariantId: newVariantId } 
                });
                fixedCount++;
                console.log(`🔧 Wrap ${wrap.name}: Created new variant ${newVariantId}`);
              } else {
                console.error(`❌ Wrap ${wrap.name}: Failed to create variant for product ${productNumericId}`);
              }
            }
          } else {
            console.warn(`⚠️ Wrap ${wrap.name}: Failed to verify variant ${variantId}, attempting to create one...`);
            
            // If verification fails, try to create a variant anyway
            const price = ((wrap.priceCents || 0) / 100).toFixed(2);
            const newVariantId = await setDefaultVariantPrice(validProductId, price);
            
            if (newVariantId) {
              await prisma.wrappingOption.update({ 
                where: { id: wrap.id }, 
                data: { shopifyVariantId: newVariantId } 
              });
              fixedCount++;
              console.log(`🔧 Wrap ${wrap.name}: Created variant ${newVariantId} after verification failure`);
            }
          }
        } catch (e) { 
          console.warn(`❌ Wrap ${wrap.name} verification exception:`, e?.message || e); 
        }
      }
    }
    
    const cards = await prisma.bundleCard.findMany();
    for (const card of cards) {
      if (card.shopifyProductId && card.shopifyVariantId) {
        try {
          const productId = card.shopifyProductId;
          const variantId = card.shopifyVariantId;
          
          console.log(`🔍 Verifying card: ${card.name} (Product: ${productId}, Variant: ${variantId})`);
          
          // First validate the product ID
          const validProductId = await validateAndCleanProduct(productId, 'Bundle Card');
          if (!validProductId) {
            console.warn(`⚠️ Card ${card.name}: Product is invalid, skipping verification`);
            continue;
          }
          
          // Use REST API to verify the variant exists
          const productNumericId = String(validProductId).split('/').pop();
          const variantsResp = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}/variants.json`, {
            method: 'GET',
            headers: { 
              'Content-Type': 'application/json', 
              'X-Shopify-Access-Token': session.accessToken 
            },
          });
          
          if (variantsResp.ok) {
            const variantsJson = await variantsResp.json();
            const variant = variantsJson?.variants?.find(v => v.id.toString() === variantId);
            
            if (variant) {
              verifiedCount++;
              console.log(`✅ Card ${card.name}: Variant ${variantId} verified for product ${productNumericId}`);
            } else {
              console.warn(`⚠️ Card ${card.name}: Variant ${variantId} not found, attempting to create one...`);
              
              // Try to create a variant for this product
              const price = ((card.priceCents || 0) / 100).toFixed(2);
              const newVariantId = await setDefaultVariantPrice(validProductId, price);
              
              if (newVariantId) {
                await prisma.bundleCard.update({ 
                  where: { id: card.id }, 
                  data: { shopifyVariantId: newVariantId } 
                });
                fixedCount++;
                console.log(`🔧 Card ${card.name}: Created new variant ${newVariantId}`);
              } else {
                console.error(`❌ Card ${card.name}: Failed to create variant for product ${productNumericId}`);
              }
            }
          } else {
            console.warn(`⚠️ Card ${card.name}: Failed to verify variant ${variantId}, attempting to create one...`);
            
            // If verification fails, try to create a variant anyway
            const price = ((card.priceCents || 0) / 100).toFixed(2);
            const newVariantId = await setDefaultVariantPrice(validProductId, price);
            
            if (newVariantId) {
              await prisma.bundleCard.update({ 
                where: { id: card.id }, 
                data: { shopifyVariantId: newVariantId } 
              });
              fixedCount++;
              console.log(`🔧 Card ${card.name}: Created variant ${newVariantId} after verification failure`);
            }
          }
        } catch (e) { 
          console.warn(`❌ Card ${card.name} verification exception:`, e?.message || e); 
        }
      }
    }
    
    return json({ success: `Verified ${verifiedCount} variants, fixed ${fixedCount} issues` });
  }

  if (intent === "force-create-variants") {
    // Force create variants for all wraps and cards that don't have them
    const wraps = await prisma.wrappingOption.findMany();
    let createdCount = 0;
    
    for (const wrap of wraps) {
      if (wrap.shopifyProductId && !wrap.shopifyVariantId) {
        try {
          const productId = wrap.shopifyProductId.split('/').pop();
          const price = ((wrap.priceCents || 0) / 100).toFixed(2);
          
          // Create a new variant
          const createVariantResp = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productId}/variants.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
            body: JSON.stringify({ 
              variant: { 
                price: price,
                inventory_quantity: 999,
                inventory_management: 'shopify'
              } 
            })
          });
          
          if (createVariantResp.ok) {
            const variantData = await createVariantResp.json();
            const variantId = variantData?.variant?.id;
            if (variantId) {
              await prisma.wrappingOption.update({ 
                where: { id: wrap.id }, 
                data: { shopifyVariantId: String(variantId) } 
              });
              createdCount++;
              console.log(`✅ Created variant ${variantId} for wrap ${wrap.name}`);
            }
          }
        } catch (e) { 
          console.warn(`❌ Force create variant for wrap ${wrap.name} failed:`, e?.message || e); 
        }
      }
    }
    
    const cards = await prisma.bundleCard.findMany();
    for (const card of cards) {
      if (card.shopifyProductId && !card.shopifyVariantId) {
        try {
          const productId = card.shopifyProductId.split('/').pop();
          const price = ((card.priceCents || 0) / 100).toFixed(2);
          
          // Create a new variant
          const createVariantResp = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productId}/variants.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
            body: JSON.stringify({ 
              variant: { 
                price: price,
                inventory_quantity: 999,
                inventory_management: 'shopify'
              } 
            })
          });
          
          if (createVariantResp.ok) {
            const variantData = await createVariantResp.json();
            const variantId = variantData?.variant?.id;
            if (variantId) {
              await prisma.bundleCard.update({ 
                where: { id: card.id }, 
                data: { shopifyVariantId: String(variantId) } 
              });
              createdCount++;
              console.log(`✅ Created variant ${variantId} for card ${card.name}`);
            }
          }
        } catch (e) { 
          console.warn(`❌ Force create variant for card ${card.name} failed:`, e?.message || e); 
        }
      }
    }
    
    return json({ success: `Force created ${createdCount} variants` });
  }

  if (intent === "test-api-connection") {
    // Test basic Shopify REST API connection
    try {
      const testResp = await fetch(`https://${session.shop}/admin/api/2024-10/products.json?limit=1`, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json', 
          'X-Shopify-Access-Token': session.accessToken 
        },
      });
      
      if (testResp.ok) {
        const testData = await testResp.json();
        const productCount = testData?.products?.length || 0;
        console.log(`✅ REST API connection test successful. Found ${productCount} products.`);
        return json({ success: `REST API connection successful. Found ${productCount} products.` });
      } else {
        const errorText = await testResp.text();
        console.warn(`❌ REST API connection test failed: Status ${testResp.status}, Response: ${errorText}`);
        return json({ error: `REST API connection failed: Status ${testResp.status}` });
      }
    } catch (e) {
      console.warn('REST API connection test exception:', e?.message || e);
      return json({ error: `REST API connection test exception: ${e?.message || e}` });
    }
  }

  if (intent === "delete-wrap") {
    const wrapId = String(formData.get("wrapId"));
    const wrap = await prisma.wrappingOption.findUnique({ where: { id: wrapId } });
    // Delete Shopify product if present
    try {
      const { session } = await authenticate.admin(request);
      if (wrap?.shopifyProductId) {
        const productNumericId = String(wrap.shopifyProductId).split('/').pop();
        await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}.json`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        });
      }
    } catch (e) { console.warn('Delete-wrap Shopify delete failed:', e?.message || e); }
    await prisma.wrappingOption.delete({ where: { id: wrapId } });
    return redirect(`/app/additional?bundleId=${wrap?.bundleId || ''}`);
  }

  if (intent === "delete-card") {
    const cardId = String(formData.get("cardId"));
    const card = await prisma.bundleCard.findUnique({ where: { id: cardId } });
    // Delete Shopify product if present
    try {
      const { session } = await authenticate.admin(request);
      if (card?.shopifyProductId) {
        const productNumericId = String(card.shopifyProductId).split('/').pop();
        await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}.json`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        });
      }
    } catch (e) { console.warn('Delete-card Shopify delete failed:', e?.message || e); }
    await prisma.bundleCard.delete({ where: { id: cardId } });
    return redirect(`/app/additional?bundleId=${card?.bundleId || ''}`);
  }

  if (intent === "check-status") {
    // Check the current status of all wraps and cards
    const wraps = await prisma.wrappingOption.findMany();
    const cards = await prisma.bundleCard.findMany();
    
    let status = {
      wraps: wraps.map(w => ({
        id: w.id,
        name: w.name,
        productId: w.shopifyProductId,
        variantId: w.shopifyVariantId,
        hasProduct: !!w.shopifyProductId,
        hasVariant: !!w.shopifyVariantId,
        price: w.priceCents
      })),
      cards: cards.map(c => ({
        id: c.id,
        name: c.name,
        productId: c.shopifyProductId,
        variantId: c.shopifyVariantId,
        hasProduct: !!c.shopifyProductId,
        hasVariant: !!c.shopifyVariantId,
        price: c.priceCents
      }))
    };
    
    return json({ status });
  }

  if (intent === "cleanup-invalid-products") {
    // Clean up wraps and cards with invalid Shopify product IDs
    const wraps = await prisma.wrappingOption.findMany();
    const cards = await prisma.bundleCard.findMany();
    let cleanedCount = 0;
    
    for (const wrap of wraps) {
      if (wrap.shopifyProductId) {
        try {
          console.log(`🔍 Validating wrap: ${wrap.name} (Product: ${wrap.shopifyProductId})`);
          
          // Validate and clean the product ID
          const validProductId = await validateAndCleanProduct(wrap.shopifyProductId, 'Bundle Wrap');
          
          if (validProductId && validProductId !== wrap.shopifyProductId) {
            // Product ID was replaced, update the database
            await prisma.wrappingOption.update({ 
              where: { id: wrap.id }, 
              data: { 
                shopifyProductId: validProductId,
                shopifyVariantId: null // Reset variant ID since we have a new product
              } 
            });
            cleanedCount++;
            console.log(`✅ Fixed wrap ${wrap.name}: Updated product ID to ${validProductId}`);
          } else if (!validProductId) {
            // Product is completely invalid, remove the reference
            await prisma.wrappingOption.update({ 
              where: { id: wrap.id }, 
              data: { 
                shopifyProductId: null,
                shopifyVariantId: null 
              } 
            });
            cleanedCount++;
            console.log(`✅ Cleaned wrap ${wrap.name}: Removed invalid product reference`);
          }
        } catch (e) { 
          console.warn(`❌ Cleanup wrap ${wrap.name} exception:`, e?.message || e); 
        }
      }
    }
    
    for (const card of cards) {
      if (card.shopifyProductId) {
        try {
          console.log(`🔍 Validating card: ${card.name} (Product: ${card.shopifyProductId})`);
          
          // Validate and clean the product ID
          const validProductId = await validateAndCleanProduct(card.shopifyProductId, 'Bundle Card');
          
          if (validProductId && validProductId !== card.shopifyProductId) {
            // Product ID was replaced, update the database
            await prisma.bundleCard.update({ 
              where: { id: card.id }, 
              data: { 
                shopifyProductId: validProductId,
                shopifyVariantId: null // Reset variant ID since we have a new product
              } 
            });
            cleanedCount++;
            console.log(`✅ Fixed card ${card.name}: Updated product ID to ${validProductId}`);
          } else if (!validProductId) {
            // Product is completely invalid, remove the reference
            await prisma.bundleCard.update({ 
              where: { id: card.id }, 
              data: { 
                shopifyProductId: null,
                shopifyVariantId: null 
              } 
            });
            cleanedCount++;
            console.log(`✅ Cleaned card ${card.name}: Removed invalid product reference`);
          }
        } catch (e) { 
          console.warn(`❌ Cleanup card ${card.name} exception:`, e?.message || e); 
        }
      }
    }
    
    return json({ success: `Cleaned up ${cleanedCount} invalid product references` });
  }

  if (intent === "fix-missing-variants") {
    // Fix products that exist but have no variants
    const wraps = await prisma.wrappingOption.findMany();
    const cards = await prisma.bundleCard.findMany();
    let fixedCount = 0;
    
    for (const wrap of wraps) {
      if (wrap.shopifyProductId && !wrap.shopifyVariantId) {
        try {
          const productId = wrap.shopifyProductId;
          const price = ((wrap.priceCents || 0) / 100).toFixed(2);
          
          console.log(`🔧 Fixing missing variant for wrap: ${wrap.name} (Product: ${productId})`);
          
          // Force create a variant
          const vId = await setDefaultVariantPrice(productId, price);
          if (vId) {
            await prisma.wrappingOption.update({ 
              where: { id: wrap.id }, 
              data: { shopifyVariantId: vId } 
            });
            fixedCount++;
            console.log(`✅ Fixed wrap ${wrap.name}: Created variant ${vId}`);
          } else {
            console.warn(`❌ Failed to create variant for wrap ${wrap.name}`);
          }
        } catch (e) { 
          console.warn(`❌ Fix missing variant for wrap ${wrap.name} exception:`, e?.message || e); 
        }
      }
    }
    
    for (const card of cards) {
      if (card.shopifyProductId && !card.shopifyVariantId) {
        try {
          const productId = card.shopifyProductId;
          const price = ((card.priceCents || 0) / 100).toFixed(2);
          
          console.log(`🔧 Fixing missing variant for card: ${card.name} (Product: ${productId})`);
          
          // Force create a variant
          const vId = await setDefaultVariantPrice(productId, price);
          if (vId) {
            await prisma.bundleCard.update({ 
              where: { id: card.id }, 
              data: { shopifyVariantId: vId } 
            });
            fixedCount++;
            console.log(`✅ Fixed card ${card.name}: Created variant ${vId}`);
          } else {
            console.warn(`❌ Failed to create variant for card ${card.name}`);
          }
        } catch (e) { 
          console.warn(`❌ Fix missing variant for card ${card.name} exception:`, e?.message || e); 
        }
      }
    }
    
    return json({ success: `Fixed ${fixedCount} missing variants` });
  }

  if (intent === "purge-all-wraps-cards") {
    try {
      const { session } = await authenticate.admin(request);
      // Delete all wrap products and DB records
      const wraps = await prisma.wrappingOption.findMany();
      for (const w of wraps) {
        if (w.shopifyProductId) {
          try {
            const productNumericId = String(w.shopifyProductId).split('/').pop();
            const del = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}.json`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
            });
            if (!del.ok) {
              const txt = await del.text();
              console.warn('Purge wrap product delete failed:', productNumericId, del.status, txt);
            }
          } catch (e) { console.warn('Purge wrap product delete exception:', e?.message || e); }
        }
        try { await prisma.wrappingOption.delete({ where: { id: w.id } }); } catch (e) { console.warn('Purge wrap db delete exception:', e?.message || e); }
      }
      
      // Delete all card products and DB records
      const cards = await prisma.bundleCard.findMany();
      for (const c of cards) {
        if (c.shopifyProductId) {
          try {
            const productNumericId = String(c.shopifyProductId).split('/').pop();
            const del = await fetch(`https://${session.shop}/admin/api/2024-10/products/${productNumericId}.json`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
            });
            if (!del.ok) {
              const txt = await del.text();
              console.warn('Purge card product delete failed:', productNumericId, del.status, txt);
            }
          } catch (e) { console.warn('Purge card product delete exception:', e?.message || e); }
        }
        try { await prisma.bundleCard.delete({ where: { id: c.id } }); } catch (e) { console.warn('Purge card db delete exception:', e?.message || e); }
      }

      return json({ success: 'All wraps and cards purged from Shopify and database' });
    } catch (e) {
      console.warn('purge-all-wraps-cards exception:', e?.message || e);
      return json({ error: 'Purge failed' }, { status: 500 });
    }
  }

  return json({ ok: true });
};

export default function AdditionalPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const bundle = data?.bundle;
  const plan = data?.plan || 'FREE';

  const bundleMissing = !bundle;

  const [bundleImageUrl, setBundleImageUrl] = useState(bundle?.imageUrl || "");
  const [wrapName, setWrapName] = useState("");
  const [wrapPrice, setWrapPrice] = useState("0");
  const [wrapFree, setWrapFree] = useState(true);
  const [wrapImageUrl, setWrapImageUrl] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardImageUrl, setCardImageUrl] = useState("");
  const [cardFree, setCardFree] = useState(true);
  const [cardPrice, setCardPrice] = useState("0");
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [statusData, setStatusData] = useState(null);
  const [showStatus, setShowStatus] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [pricingType, setPricingType] = useState(bundle.pricingType || 'SUM');
  const [priceValueCents, setPriceValueCents] = useState(bundle.priceValueCents ? String(bundle.priceValueCents) : "");

  useEffect(() => {
    if (actionData?.success) {
      setShowSuccess(true);
      setSuccessMessage(actionData.message || "Operation completed successfully!");
      if (actionData.action === 'add-wrap') { resetWrapForm(); }
      else if (actionData.action === 'add-card') { resetCardForm(); }
      setTimeout(() => setShowSuccess(false), 5000);
    }
    
    if (actionData?.status) {
      setStatusData(actionData.status);
      setShowStatus(true);
    }
  }, [actionData]);

  async function handleUpload(file, setter) {
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/jpg"];
    if (!allowed.includes(file.type)) { alert("PNG or JPEG only"); return; }
    const data = new FormData();
    data.append("file", file);
    const res = await fetch("/app/upload", { method: "POST", body: data });
    if (res.ok) { const j = await res.json(); setter(j.url); } else { alert("Upload failed"); }
  }

  function resetWrapForm() {
    setWrapName(""); setWrapPrice("0"); setWrapFree(true); setWrapImageUrl("");
  }
  function resetCardForm() {
    setCardName(""); setCardImageUrl(""); setCardFree(true); setCardPrice("0");
  }

  return (
    <Page>
      <TitleBar title={`Bundle Assets: ${bundle.title}`} />
      <Layout>
        {bundleMissing ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="bodyMd">Bundle not found or no bundleId provided.</Text>
                <Button url="/app/bundle-manager">Back to Bundle Manager</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}
        {/* Utilities */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h3">Automation</Text>
              <Text variant="bodySm" tone="subdued">Wraps and cards now auto-create hidden Shopify products with images and priced variants. No manual actions needed.</Text>
              <InlineStack>
                <Button onClick={() => setShowManageModal(true)} disabled={plan === 'FREE'}>Manage wraps/cards</Button>
              </InlineStack>
              {plan === 'FREE' && (
                <Text tone="subdued" variant="bodySm">Upgrade to Pro to manage wraps and cards.</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Bundle Discount/Pricing */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <div style={{ 
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                padding: '20px', borderRadius: '12px', color: 'white'
              }}>
                <Text as="h2" variant="headingLg" color="base">💸 Bundle Pricing & Discount</Text>
                <Text variant="bodyMd" color="base">Choose how the bundle price is calculated or discounted.</Text>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="update-discount" />
                <input type="hidden" name="bundleId" value={bundle.id} />
                <BlockStack gap="300">
                  <InlineStack gap="400" align="start">
                    <div style={{ minWidth: '240px' }}>
                      <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Pricing Type</label>
                      <select 
                        name="pricingType" 
                        value={pricingType} 
                        onChange={(e)=>setPricingType(e.currentTarget.value)}
                        style={{ width: '100%', padding: '10px', border: '1px solid #e5e7eb', borderRadius: 8 }}
                      >
                        <option value="SUM">Sum of selected items</option>
                        <option value="FIXED">Fixed bundle price</option>
                        <option value="DISCOUNT_PERCENT">Percent discount on sum</option>
                        <option value="DISCOUNT_AMOUNT">Amount discount on sum (cents)</option>
                      </select>
                    </div>
                    <div style={{ minWidth: '260px' }}>
                      <TextField 
                        label={pricingType === 'FIXED' ? 'Fixed price (cents)' : pricingType === 'DISCOUNT_PERCENT' ? 'Discount percent (0-100)' : pricingType === 'DISCOUNT_AMOUNT' ? 'Discount amount (cents)' : 'Value'}
                        name="priceValueCents"
                        type="number"
                        min={0}
                        value={priceValueCents}
                        onChange={setPriceValueCents}
                        autoComplete="off"
                        placeholder={pricingType === 'DISCOUNT_PERCENT' ? 'e.g., 10 for 10%' : 'e.g., 1999'}
                      />
                    </div>
                    <div style={{ alignSelf: 'end' }}>
                      <Button submit primary disabled={plan === 'FREE' && pricingType !== 'SUM'}>Save Pricing</Button>
                    </div>
                  </InlineStack>
                  <Text tone="subdued" variant="bodySm">
                    Current: {pricingType}{priceValueCents ? ` (${pricingType==='DISCOUNT_PERCENT' ? priceValueCents + '%' : priceValueCents + ' cents'})` : ''}
                  </Text>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>
        
        {/* Status Display Section */}
        {showStatus && statusData && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <div style={{ 
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', 
                  padding: '20px', 
                  borderRadius: '12px',
                  color: 'white'
                }}>
                  <Text as="h3" variant="headingMd" color="base">📊 Status Report</Text>
                  <Text variant="bodyMd" color="base">Current state of all wraps and cards</Text>
                </div>
                
                <InlineStack gap="400" align="start">
                  <Button onClick={() => setShowStatus(false)}>Close Status</Button>
                </InlineStack>
                
                {/* Wraps Status */}
                <div>
                  <Text variant="headingMd" as="h4">Gift Wraps ({statusData.wraps.length})</Text>
                  <div style={{ marginTop: '12px' }}>
                    {statusData.wraps.map((wrap) => (
                      <div key={wrap.id} style={{ 
                        padding: '12px', 
                        margin: '8px 0', 
                        border: '1px solid #e5e7eb', 
                        borderRadius: '8px',
                        background: wrap.hasProduct && wrap.hasVariant ? '#f0fdf4' : '#fef2f2'
                      }}>
                        <InlineStack gap="300" align="start">
                          <div style={{ flex: 1 }}>
                            <Text variant="bodyMd" fontWeight="medium">{wrap.name}</Text>
                            <Text variant="bodySm" tone="subdued">Price: ${(wrap.price/100).toFixed(2)}</Text>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ marginBottom: '4px' }}>
                              {wrap.hasProduct ? (
                                <Badge tone="success">✅ Product</Badge>
                              ) : (
                                <Badge tone="critical">❌ No Product</Badge>
                              )}
                            </div>
                            <div>
                              {wrap.hasVariant ? (
                                <Badge tone="success">✅ Variant</Badge>
                              ) : (
                                <Badge tone="critical">❌ No Variant</Badge>
                              )}
                            </div>
                          </div>
                        </InlineStack>
                        {wrap.hasProduct && (
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                            Product ID: {wrap.productId?.split('/').pop() || 'N/A'}
                          </div>
                        )}
                        {wrap.hasVariant && (
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>
                            Variant ID: {wrap.variantId || 'N/A'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Cards Status */}
                <div>
                  <Text variant="headingMd" as="h4">Gift Cards ({statusData.cards.length})</Text>
                  <div style={{ marginTop: '12px' }}>
                    {statusData.cards.map((card) => (
                      <div key={card.id} style={{ 
                        padding: '12px', 
                        margin: '8px 0', 
                        border: '1px solid #e5e7eb', 
                        borderRadius: '8px',
                        background: card.hasProduct && card.hasVariant ? '#f0fdf4' : '#fef2f2'
                      }}>
                        <InlineStack gap="300" align="start">
                          <div style={{ flex: 1 }}>
                            <Text variant="bodyMd" fontWeight="medium">{card.name}</Text>
                            <Text variant="bodySm" tone="subdued">Price: ${(card.price/100).toFixed(2)}</Text>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ marginBottom: '4px' }}>
                              {card.hasProduct ? (
                                <Badge tone="success">✅ Product</Badge>
                              ) : (
                                <Badge tone="critical">❌ No Product</Badge>
                              )}
                            </div>
                            <div>
                              {card.hasVariant ? (
                                <Badge tone="success">✅ Variant</Badge>
                              ) : (
                                <Badge tone="critical">❌ No Variant</Badge>
                              )}
                            </div>
                          </div>
                        </InlineStack>
                        {card.hasProduct && (
                          <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                            Product ID: {card.productId?.split('/').pop() || 'N/A'}
                          </div>
                        )}
                        {card.hasVariant && (
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>
                            Variant ID: {card.variantId || 'N/A'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
        
        {/* Bundle Image Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <div style={{ 
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                padding: '24px', 
                borderRadius: '12px',
                color: 'white'
              }}>
                <Text as="h2" variant="headingLg" color="base">🎁 Bundle Image</Text>
                <Text variant="bodyMd" color="base">Upload the main image that will be displayed for this bundle</Text>
              </div>
              
              <Form method="post">
                <input type="hidden" name="intent" value="update-bundle-image" />
                <input type="hidden" name="bundleId" value={bundle.id} />
                <BlockStack gap="400">
                  <InlineStack gap="400" align="start">
                    <div style={{ width: '300px' }}>
                      <Text variant="bodyMd" fontWeight="medium" as="label">Upload Image</Text>
                      <div style={{ marginTop: '8px' }}>
                        <input 
                          type="file" 
                          accept="image/png,image/jpeg" 
                          onChange={e => handleUpload(e.currentTarget.files?.[0], setBundleImageUrl)}
                          style={{
                            width: '100%',
                            padding: '12px',
                            border: '2px dashed #d1d5db',
                            borderRadius: '8px',
                            background: '#f9fafb'
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField 
                        label="Image URL" 
                        name="imageUrl" 
                        value={bundleImageUrl} 
                        onChange={setBundleImageUrl} 
                        autoComplete="off"
                        placeholder="Or enter image URL directly"
                      />
                    </div>
                    <div style={{ alignSelf: 'end' }}>
                      <Button submit primary size="large">Save Image</Button>
                    </div>
                  </InlineStack>
                  
                  {bundleImageUrl && (
                    <div style={{ 
                      background: '#f8fafc', 
                      padding: '20px', 
                      borderRadius: '12px',
                      border: '2px solid #e5e7eb'
                    }}>
                      <Text variant="bodyMd" fontWeight="medium" as="h3">Preview</Text>
                      <div style={{ marginTop: '12px' }}>
                        <img 
                          src={bundleImageUrl} 
                          alt="Bundle Preview" 
                          style={{ 
                            width: '320px', 
                            height: '200px', 
                            objectFit: 'cover', 
                            borderRadius: '8px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                          }} 
                        />
                      </div>
                    </div>
                  )}
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Gift Wraps Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              {showSuccess && (
                <div style={{ 
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                  padding: '16px', 
                  borderRadius: '8px',
                  color: 'white',
                  marginBottom: '16px'
                }}>
                  <Text variant="bodyMd" color="base">✅ {successMessage}</Text>
                </div>
              )}
              
              <div style={{ 
                background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)', 
                padding: '24px', 
                borderRadius: '12px',
                color: 'white'
              }}>
                <Text as="h2" variant="headingLg" color="base">🎀 Gift Wrapping Options</Text>
                <Text variant="bodyMd" color="base">Add beautiful wrapping designs for customers to choose from</Text>
              </div>
              
              <Form method="post">
                <input type="hidden" name="intent" value="add-wrap" />
                <input type="hidden" name="bundleId" value={bundle.id} />
                <input type="hidden" name="name" value={wrapName} />
                <input type="hidden" name="priceCents" value={wrapFree ? "0" : wrapPrice} />
                <input type="hidden" name="imageUrl" value={wrapImageUrl} />

                <BlockStack gap="400">
                  {/* Row 1: Name and Price */}
                  <InlineStack gap="400" align="start">
                    <div style={{ width: '300px' }}>
                      <TextField 
                        label="Wrap Name" 
                        value={wrapName} 
                        onChange={setWrapName} 
                        autoComplete="off"
                        placeholder="e.g., Elegant Gold Wrap"
                      />
                    </div>
                    <div style={{ width: '200px' }}>
                      <TextField 
                        label="Price (cents)" 
                        type="number" 
                        min={0} 
                        value={wrapFree ? "0" : wrapPrice} 
                        onChange={setWrapPrice} 
                        disabled={wrapFree}
                        placeholder="0"
                      />
                    </div>
                    <div style={{ alignSelf: 'end', marginTop: '24px' }}>
                      <Checkbox 
                        label="Free" 
                        checked={wrapFree} 
                        onChange={setWrapFree}
                      />
                    </div>
                  </InlineStack>
                  
                  {/* Row 2: Image Upload and URL */}
                  <InlineStack gap="400" align="start">
                    <div style={{ width: '300px' }}>
                      <Text variant="bodyMd" fontWeight="medium" as="label">Upload Image</Text>
                      <div style={{ marginTop: '8px' }}>
                        <input 
                          type="file" 
                          accept="image/png,image/jpeg" 
                          onChange={e => handleUpload(e.currentTarget.files?.[0], setWrapImageUrl)}
                          style={{
                            width: '100%',
                            padding: '12px',
                            border: '2px dashed #d1d5db',
                            borderRadius: '8px',
                            background: '#f9fafb'
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField 
                        label="Image URL" 
                        value={wrapImageUrl} 
                        onChange={setWrapImageUrl}
                        placeholder="Or enter image URL directly"
                      />
                    </div>
                  </InlineStack>
                  
                  <div style={{ alignSelf: 'end' }}>
                    <Button 
                      submit 
                      primary 
                      size="large"
                      disabled={plan === 'FREE' || !wrapName || !wrapImageUrl}
                    >
                      Add Wrap
                    </Button>
                  </div>
                </BlockStack>
              </Form>

              <Divider />
              
              {/* Existing Wraps */}
              <div>
                <Text variant="headingMd" as="h3">Existing Wraps ({bundle.wrappingOptions?.length || 0})</Text>
                <div style={{ marginTop: '16px' }}>
                  {bundle.wrappingOptions && bundle.wrappingOptions.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                      {bundle.wrappingOptions.map((w) => (
                        <div key={w.id} style={{ 
                          border: '2px solid #e5e7eb', 
                          borderRadius: '12px', 
                          padding: '16px',
                          background: 'white'
                        }}>
                          <InlineStack gap="300" align="start">
                            {w.imageUrl && (
                              <Thumbnail
                                source={w.imageUrl}
                                alt={w.name}
                                size="large"
                              />
                            )}
                            <div style={{ flex: 1 }}>
                              <Text variant="bodyMd" fontWeight="medium">{w.name}</Text>
                              <div style={{ marginTop: '4px' }}>
                                {w.priceCents > 0 ? (
                                  <Badge tone="success">${(w.priceCents/100).toFixed(2)}</Badge>
                                ) : (
                                  <Badge tone="info">Free</Badge>
                                )}
                              </div>
                            </div>
                            <Form method="post">
                              <input type="hidden" name="intent" value="delete-wrap" />
                              <input type="hidden" name="wrapId" value={w.id} />
                              <Button submit size="slim" tone="critical">Delete</Button>
                            </Form>
                          </InlineStack>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ 
                      textAlign: 'center', 
                      padding: '40px', 
                      background: '#f9fafb', 
                      borderRadius: '8px',
                      border: '2px dashed #d1d5db'
                    }}>
                      <Text variant="bodyMd" tone="subdued">No wraps added yet</Text>
                    </div>
                  )}
                </div>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Gift Cards Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              {showSuccess && (
                <div style={{ 
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                  padding: '16px', 
                  borderRadius: '8px',
                  color: 'white',
                  marginBottom: '16px'
                }}>
                  <Text variant="bodyMd" color="base">✅ {successMessage}</Text>
                </div>
              )}
              
              <div style={{ 
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                padding: '24px', 
                borderRadius: '12px',
                color: 'white'
              }}>
                <Text as="h2" variant="headingLg" color="base">💌 Gift Card Designs</Text>
                <Text variant="bodyMd" color="base">Add beautiful card designs for customers to include with their gifts</Text>
              </div>
              
              <Form method="post">
                <input type="hidden" name="intent" value="add-card" />
                <input type="hidden" name="bundleId" value={bundle.id} />
                <input type="hidden" name="name" value={cardName} />
                <input type="hidden" name="priceCents" value={cardFree ? "0" : cardPrice} />
                <input type="hidden" name="imageUrl" value={cardImageUrl} />

                <BlockStack gap="400">
                  {/* Row 1: Name and Price */}
                  <InlineStack gap="400" align="start">
                    <div style={{ width: '300px' }}>
                      <TextField 
                        label="Card Name" 
                        value={cardName} 
                        onChange={setCardName} 
                        autoComplete="off"
                        placeholder="e.g., Birthday Card"
                      />
                    </div>
                    <div style={{ width: '200px' }}>
                      <TextField 
                        label="Price (cents)" 
                        type="number" 
                        min={0} 
                        value={cardFree ? "0" : cardPrice} 
                        onChange={setCardPrice} 
                        disabled={cardFree}
                        placeholder="0"
                      />
                    </div>
                    <div style={{ alignSelf: 'end', marginTop: '24px' }}>
                      <Checkbox 
                        label="Free" 
                        checked={cardFree} 
                        onChange={setCardFree}
                      />
                    </div>
                  </InlineStack>
                  
                  {/* Row 2: Image Upload and URL */}
                  <InlineStack gap="400" align="start">
                    <div style={{ width: '300px' }}>
                      <Text variant="bodyMd" fontWeight="medium" as="label">Upload Image</Text>
                      <div style={{ marginTop: '8px' }}>
                        <input 
                          type="file" 
                          accept="image/png,image/jpeg" 
                          onChange={e => handleUpload(e.currentTarget.files?.[0], setCardImageUrl)}
                          style={{
                            width: '100%',
                            padding: '12px',
                            border: '2px dashed #d1d5db',
                            borderRadius: '8px',
                            background: '#f9fafb'
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField 
                        label="Image URL" 
                        value={cardImageUrl} 
                        onChange={setCardImageUrl}
                        placeholder="Or enter image URL directly"
                      />
                    </div>
                  </InlineStack>
                  
                  <div style={{ alignSelf: 'end' }}>
                    <Button 
                      submit 
                      primary 
                      size="large"
                      disabled={plan === 'FREE' || !cardName || !cardImageUrl}
                    >
                      Add Card
                    </Button>
                  </div>
                </BlockStack>
              </Form>

              <Divider />
              
              {/* Existing Cards */}
              <div>
                <Text variant="headingMd" as="h3">Existing Cards ({bundle.cards?.length || 0})</Text>
                <div style={{ marginTop: '16px' }}>
                  {bundle.cards && bundle.cards.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                      {bundle.cards.map((c) => (
                        <div key={c.id} style={{ 
                          border: '2px solid #e5e7eb', 
                          borderRadius: '12px', 
                          padding: '16px',
                          background: 'white'
                        }}>
                          <InlineStack gap="300" align="start">
                            {c.imageUrl && (
                              <Thumbnail
                                source={c.imageUrl}
                                alt={c.name}
                                size="large"
                              />
                            )}
                            <div style={{ flex: 1 }}>
                              <Text variant="bodyMd" fontWeight="medium">{c.name}</Text>
                              <div style={{ marginTop: '4px' }}>
                                {c.priceCents > 0 ? (
                                  <Badge tone="success">${(c.priceCents/100).toFixed(2)}</Badge>
                                ) : (
                                  <Badge tone="info">Free</Badge>
                                )}
                              </div>
                            </div>
                            <Form method="post">
                              <input type="hidden" name="intent" value="delete-card" />
                              <input type="hidden" name="cardId" value={c.id} />
                              <Button submit size="slim" tone="critical">Delete</Button>
                            </Form>
                          </InlineStack>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ 
                      textAlign: 'center', 
                      padding: '40px', 
                      background: '#f9fafb', 
                      borderRadius: '8px',
                      border: '2px dashed #d1d5db'
                    }}>
                      <Text variant="bodyMd" tone="subdued">No cards added yet</Text>
                    </div>
                  )}
                </div>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Manage Wraps & Cards Modal */}
      <Modal
        open={showManageModal}
        onClose={() => setShowManageModal(false)}
        title="Manage Wraps & Cards"
        primaryAction={{ content: 'Close', onAction: () => setShowManageModal(false) }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">Wraps</Text>
            {bundle.wrappingOptions?.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Image</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Name</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Price</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.wrappingOptions.map(w => (
                      <tr key={w.id}>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{w.imageUrl && (<img src={w.imageUrl} alt={w.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{w.name}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>${((w.priceCents||0)/100).toFixed(2)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete-wrap" />
                            <input type="hidden" name="wrapId" value={w.id} />
                            <Button tone="critical" variant="secondary" submit>Delete</Button>
                          </Form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Text tone="subdued">No wraps yet.</Text>
            )}

            <Divider />

            <Text as="h3" variant="headingMd">Cards</Text>
            {bundle.cards?.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Image</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Name</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Price</th>
                      <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.cards.map(c => (
                      <tr key={c.id}>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{c.imageUrl && (<img src={c.imageUrl} alt={c.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{c.name}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>${((c.priceCents||0)/100).toFixed(2)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete-card" />
                            <input type="hidden" name="cardId" value={c.id} />
                            <Button tone="critical" variant="secondary" submit>Delete</Button>
                          </Form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Text tone="subdued">No cards yet.</Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
