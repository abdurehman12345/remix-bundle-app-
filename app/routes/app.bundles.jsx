import { useState, useEffect } from "react";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  InlineStack,
  ResourceList,
  Badge,
  Checkbox,
  Select,
  Thumbnail,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { PLAN, getPlan } from "./routes";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const plan = await getPlan(prisma, shop);

  const bundles = await prisma.bundle.findMany({
    where: { shop },
    include: { wrappingOptions: true, products: true },
    orderBy: { createdAt: "desc" },
  });

  const ids = bundles.map(b => b.id);
  const sales = ids.length
    ? await prisma.bundleSale.findMany({
        where: { bundleId: { in: ids }, shop },
        select: { bundleId: true },
      })
    : [];
  const salesCount = sales.reduce((acc, s) => {
    acc[s.bundleId] = (acc[s.bundleId] || 0) + 1;
    return acc;
  }, {});

  // Fetch available collections for selection
  let collections = [];
  try {
    const resp = await admin.graphql(`#graphql
      query Collections {
        collections(first: 50) {
          nodes {
            id
            title
            description
            image { url }
          }
        }
      }
    `);
    const data = await resp.json();
    collections = data?.data?.collections?.nodes || [];
  } catch (error) {
    console.error("Failed to fetch collections:", error);
  }

  return json({ bundles, shop, salesCount, collections, plan });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const plan = await getPlan(prisma, session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "create");

  if (intent === "delete") {
    const id = String(formData.get("id"));
    await prisma.bundle.delete({ where: { id } });
    return redirect("/app/bundles");
  }
  if (intent === "duplicate") {
    const id = String(formData.get("id"));
    const source = await prisma.bundle.findUnique({
      where: { id },
      include: { products: true, wrappingOptions: true, collections: true, tierPrices: true, globalWraps: true },
    });
    if (source) {
      await prisma.bundle.create({
        data: {
          shop: session.shop,
          title: `${source.title} (Copy)`,
          description: source.description,
          imageUrl: source.imageUrl,
          collectionId: source.collectionId,
          pricingType: source.pricingType,
          priceValueCents: source.priceValueCents,
          minItems: source.minItems,
          maxItems: source.maxItems,

          allowCardUpload: source.allowCardUpload,


          wrapRequired: source.wrapRequired,
          status: source.status,
          type: source.type,
          products: { create: source.products.map(p => ({ productGid: p.productGid, variantGid: p.variantGid, variantTitle: p.variantTitle, min: p.min, max: p.max, priceCents: p.priceCents, imageUrl: p.imageUrl })) },
          wrappingOptions: { create: source.wrappingOptions.map(w => ({ name: w.name, priceCents: w.priceCents, imageUrl: w.imageUrl })) },
          collections: { create: source.collections.map(c => ({ collectionGid: c.collectionGid })) },
          tierPrices: { create: source.tierPrices.map(t => ({ minQuantity: t.minQuantity, pricingType: t.pricingType, valueCents: t.valueCents, valuePercent: t.valuePercent })) },
          globalWraps: { create: source.globalWraps.map(g => ({ wrapId: g.wrapId })) },
        },
      });
    }
    return redirect("/app/bundles");
  }

  // Enforce caps for Free plan
  if (intent === 'create' || intent === 'update' || intent === 'create-update'){
    if (plan === PLAN.FREE) {
      const count = await prisma.bundle.count({ where: { shop: session.shop } });
      if (intent !== 'update' && count >= 3) {
        return json({ error: 'Free plan limit reached: 3 bundles. Upgrade to create more.' }, { status: 403 });
      }
    }
  }

  // create
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const imageUrl = String(formData.get("imageUrl") || "").trim() || null;
  const pricingType = String(formData.get("pricingType") || "SUM");
  const priceValueCents = formData.get("priceValueCents");
  const collectionId = String(formData.get("collectionId") || "").trim() || null;
  const minItems = formData.get("minItems");
  const maxItems = formData.get("maxItems");

  const allowCardUpload = Boolean(formData.get("allowCardUpload"));
  const status = String(formData.get("status") || "DRAFT");
  const type = String(formData.get("type") || "FIXED");
  const wrapRequired = Boolean(formData.get("wrapRequired"));

  // Server-side plan enforcement (Free plan restrictions)
  if (plan === 'FREE') {
    // Enforce limits at write time
    if (pricingType !== 'SUM') {
      return json({ error: 'Free plan supports only SUM pricing.' }, { status: 403 });
    }
  }

  if (!title) {
    return json({ error: "Title is required" }, { status: 400 });
  }

  // Process selected products from form data
  const selectedProductIds = [];
  let productIndex = 0;
  while (formData.get(`selectedProducts[${productIndex}][id]`)) {
    const productId = String(formData.get(`selectedProducts[${productIndex}][id]`));
    if (productId) {
      selectedProductIds.push(productId);
    }
    productIndex++;
  }

  const created = await prisma.bundle.create({
    data: {
      shop: session.shop,
      bundleId: `bundle_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      title,
      description,
      imageUrl,
      collectionId,
      pricingType: plan === 'FREE' ? 'SUM' : pricingType,
      priceValueCents: plan === 'FREE' ? null : (priceValueCents ? Number(priceValueCents) : null),
      minItems: minItems ? Number(minItems) : null,
      maxItems: maxItems ? Number(maxItems) : null,

      allowCardUpload: plan === 'FREE' ? false : allowCardUpload,
      status,
      type,
      wrapRequired: plan === 'FREE' ? false : wrapRequired,




    },
    select: { id: true, collectionId: true, bundleId: true },
  });

  // If a collection is set, pre-fill products from that collection (first 50)
  if (created.collectionId) {
    try {
      const resp = await admin.graphql(`#graphql
        query CollectionProducts($id: ID!) {
          collection(id: $id) {
            products(first: 50) {
              nodes {
                id
                title
                featuredMedia { preview { image { url } } }
                variants(first: 1) {
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
      `, { variables: { id: created.collectionId } });
      const data = await resp.json();
      const nodes = data?.data?.collection?.products?.nodes || [];
      const toCreate = nodes.map((p) => {
        const v = p.variants?.nodes?.[0];
        if (!v) return null;
        return {
          bundleId: created.id,
          productGid: p.id,
          variantGid: v.id,
          variantTitle: v.title,
          imageUrl: v.image?.url || p.featuredMedia?.preview?.image?.url,
          priceCents: v.price ? Math.round(parseFloat(v.price) * 100) : null,
          min: 0,
          max: 0,
        };
      }).filter(Boolean);
      if (toCreate.length) {
        await prisma.bundleProduct.createMany({ data: toCreate });
      }
    } catch (err) {
      console.error('Collection sync on create failed:', err);
    }
  }

  // Auto backfill variants for products attached to this bundle (including those added from collection)
  try {
    const bundle = await prisma.bundle.findUnique({
      where: { id: created.id },
      include: { products: true },
    });
    if (bundle?.products?.length) {
      for (const p of bundle.products) {
        try {
          const resp = await admin.graphql(`#graphql
            query ProductDetails($id: ID!) {
              product(id: $id) {
                featuredMedia { preview { image { url } } }
                variants(first: 50) { nodes { id title price image { url } } }
              }
            }
          `, { variables: { id: p.productGid } });
          const data = await resp.json();
          const prod = data?.data?.product;
          if (!prod) continue;
          const first = prod.variants?.nodes?.[0];
          const variants = (prod.variants?.nodes || []).map(v => ({ id: v.id, title: v.title, priceCents: Math.round(parseFloat(v.price||'0')*100) }));
          await prisma.bundleProduct.update({
            where: { id: p.id },
            data: {
              variantGid: first?.id || p.variantGid,
              variantTitle: first?.title || p.variantTitle,
              priceCents: first ? Math.round(parseFloat(first.price||'0')*100) : p.priceCents,
              imageUrl: first?.image?.url || prod.featuredMedia?.preview?.image?.url || p.imageUrl,
              variantsJson: JSON.stringify(variants),
            },
          });
        } catch (e) {
          console.error('Auto-backfill variants error', e);
        }
      }
    }
  } catch (e) {
    console.error('Auto-backfill wrapper error', e);
  }

  // Add selected individual products to the bundle
  if (selectedProductIds.length > 0) {
    try {
      // Fetch product details from Shopify
      const productDetailsPromises = selectedProductIds.map(async (productId) => {
        try {
          const resp = await admin.graphql(`#graphql
            query GetProduct($id: ID!) {
              product(id: $id) {
                id
                title
                featuredMedia { preview { image { url } } }
                variants(first: 1) {
                  nodes {
                    id
                    title
                    price
                    image { url }
                  }
                }
              }
            }
          `, { variables: { id: productId } });
          
          const data = await resp.json();
          const product = data?.data?.product;
          
          if (product && product.variants?.nodes?.length > 0) {
            const variant = product.variants.nodes[0];
            return {
              productGid: product.id,
              variantGid: variant.id,
              variantTitle: variant.title,
              imageUrl: variant.image?.url || product.featuredMedia?.preview?.image?.url,
              priceCents: variant.price ? Math.round(parseFloat(variant.price) * 100) : 0,
              min: 1,
              max: 5
            };
          }
        } catch (error) {
          console.error(`Failed to fetch product ${productId}:`, error);
        }
        return null;
      });

      const productDetails = (await Promise.all(productDetailsPromises)).filter(Boolean);

      if (productDetails.length > 0) {
        // Free plan enforcement: limit to 6 products total
        const finalProducts = plan === 'FREE' ? productDetails.slice(0, 6) : productDetails;
        
        await prisma.bundleProduct.createMany({
          data: finalProducts.map(product => ({
            bundleId: created.id,
            ...product
          }))
        });
      }
    } catch (error) {
      console.error("Failed to add selected products:", error);
    }
  }

  throw redirect("/app/bundles");
};

export default function BundlesIndex() {
  const { bundles, shop, salesCount, collections, plan } = useLoaderData();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";
  const [title, setTitle] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [pricingType, setPricingType] = useState("SUM");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [minItems, setMinItems] = useState("");
  const [maxItems, setMaxItems] = useState("");

  
  const [status, setStatus] = useState("DRAFT");
  const [type, setType] = useState("FIXED");
  
  // Collection selection state
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [showCollectionModal, setShowCollectionModal] = useState(false);

  // Product selection state
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Load all products for selection
  const loadAllProducts = async () => {
    setIsLoadingProducts(true);
    try {
      const res = await fetch(`/api/products?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setAvailableProducts(data.products || []);
      }
    } catch (error) {
      console.error("Failed to load products:", error);
    } finally {
      setIsLoadingProducts(false);
    }
  };
  // Search products
  const searchProducts = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    setIsSearching(true);
    try {
      const res = await fetch(`/api/products?q=${encodeURIComponent(query)}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.products || []);
      }
    } catch (error) {
      console.error("Failed to search products:", error);
    } finally {
      setIsSearching(false);
    }
  };

  // Load products for selected collection
  const loadCollectionProducts = async (collectionId) => {
    if (!collectionId) return;
    setIsLoadingProducts(true);
    try {
      const res = await fetch(`/api/products?collection=${collectionId}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setAvailableProducts(data.products || []);
      }
    } catch (error) {
      console.error("Failed to load collection products:", error);
    } finally {
      setIsLoadingProducts(false);
    }
  };

  // Handle collection selection
  const handleCollectionSelect = (collection) => {
    setSelectedCollection(collection);
    setCollectionId(collection.id);
    loadCollectionProducts(collection.id);
  };

  // Handle product selection
  const handleProductSelect = (product, isSelected) => {
    if (isSelected) {
      setSelectedProducts(prev => {
        if (!prev.find(p => p.id === product.id)) {
          return [...prev, product];
        }
        return prev;
      });
    } else {
      setSelectedProducts(prev => prev.filter(p => p.id !== product.id));
    }
  };

  // Handle search input change with debouncing
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchProducts(productSearchQuery);
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [productSearchQuery]);

  // Load all products when product modal opens
  useEffect(() => {
    if (showProductModal && availableProducts.length === 0) {
      loadAllProducts();
    }
  }, [showProductModal]);

  return (
    <Page>
      <TitleBar title="Bundles" />
      <Layout>
        <Layout.Section>
          <Card>
            <InlineStack align="space-between">
              <Text as="p" variant="bodyMd">Plan: {plan}</Text>
              {plan === 'FREE' && (
                <InlineStack gap="200" align="center">
                  <Badge tone="attention">Pro features locked</Badge>
                  <Button url="/app/pricing" variant="primary">Upgrade to Pro</Button>
                </InlineStack>
              )}
            </InlineStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Create bundle</Text>
              {plan === 'FREE' && (
                <Text tone="subdued" variant="bodySm">Free plan: up to 3 bundles, 6 products per bundle, basic pricing.</Text>
              )}
              <Form method="post">
                <BlockStack gap="300">
                  <TextField label="Title" name="title" value={title} onChange={setTitle} autoComplete="off" />
                  <TextField label="Description" multiline name="description" value={description} onChange={setDescription} autoComplete="off" />
                  <InlineStack gap="300" alignment="center">
                    <TextField label="Image URL" name="imageUrl" value={imageUrl} onChange={setImageUrl} autoComplete="off" />
                    <input type="file" accept="image/png,image/jpeg" onChange={async (e) => {
                      const file = e.currentTarget.files?.[0];
                      if(!file) return;
                      const data = new FormData();
                      data.append('file', file);
                      const res = await fetch('/app/upload', { method: 'POST', body: data });
                      if(res.ok){ const j = await res.json(); setImageUrl(j.url); }
                    }} />
                    {imageUrl && <img src={imageUrl} alt="Preview" style={{width: '100px', height: '100px', objectFit: 'cover'}} />}
                  </InlineStack>
                  
                  {/* Collection and Product Selection */}
                  <div style={{ padding: '16px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #0ea5e9' }}>
                    <Text variant="bodyMd" as="h3" style={{ marginBottom: '16px', fontWeight: '600', color: '#0c4a6e' }}>
                      Select Products for Bundle
                    </Text>
                    
                    {/* Collection Selection */}
                    <BlockStack gap="300">
                      <InlineStack gap="300" align="end">
                        <Select
                          label="Choose Collection (Optional)"
                          options={collections.map(c => ({label: c.title, value: c.id}))}
                          value={collectionId}
                          onChange={setCollectionId}
                          placeholder="Select a collection"
                        />
                        {/* Ensure the selected collection is submitted */}
                        <input type="hidden" name="collectionId" value={collectionId} />
                        <Button 
                          onClick={() => setShowCollectionModal(true)}
                          variant="secondary"
                        >
                          Browse Collections
                        </Button>
                      </InlineStack>
                      
                      {/* Product Selection */}
                      <InlineStack gap="300" align="start">
                        <div style={{ flex: 1 }}>
                          <Text variant="bodyMd" fontWeight="medium">Or Select Individual Products:</Text>
                          <Text variant="bodySm" tone="subdued">
                            Choose specific products from your store to include in this bundle.
                          </Text>
                        </div>
                        <Button 
                          onClick={() => setShowProductModal(true)}
                          variant="primary"
                          tone="success"
                        >
                          Select Products
                        </Button>
                      </InlineStack>
                      
                      {/* Selected Products Summary */}
                      {selectedProducts.length > 0 && (
                        <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                          <Text variant="bodySm" fontWeight="medium" tone="success">
                            {selectedProducts.length} product{selectedProducts.length !== 1 ? 's' : ''} selected:
                          </Text>
                          <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {selectedProducts.map((product, index) => (
                              <div key={product.id} style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '6px', 
                                padding: '4px 8px', 
                                backgroundColor: 'rgba(16, 185, 129, 0.15)', 
                                borderRadius: '4px', 
                                fontSize: '12px' 
                              }}>
                                {product.imageUrl && (
                                  <img 
                                    src={product.imageUrl} 
                                    alt={product.title}
                                    style={{ width: '16px', height: '16px', borderRadius: '2px', objectFit: 'cover' }}
                                  />
                                )}
                                <span>{product.title}</span>
                                <button
                                  type="button"
                                  onClick={() => handleProductSelect(product, false)}
                                  style={{ 
                                    background: 'none', 
                                    border: 'none', 
                                    cursor: 'pointer', 
                                    color: '#059669',
                                    fontWeight: 'bold',
                                    padding: '0 2px'
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                          {/* Hidden inputs for selected products */}
                          {selectedProducts.map((product, index) => (
                            <input 
                              key={product.id}
                              type="hidden" 
                              name={`selectedProducts[${index}][id]`} 
                              value={product.id} 
                            />
                          ))}
                        </div>
                      )}
                      
                      {collectionId && (
                        <div style={{ marginTop: '12px' }}>
                          <Text variant="bodySm" tone="subdued">
                            Products from the selected collection will be automatically added to your bundle.
                          </Text>
                        </div>
                      )}
                      
                      {plan === 'FREE' && (
                        <Text tone="subdued" variant="bodySm">
                          Free plan tip: keep product count ≤ 6 per bundle. Upgrade for unlimited.
                        </Text>
                      )}
                    </BlockStack>
                  </div>

                  <InlineStack gap="300">
                    <Select
                      label="Pricing type"
                      options={[
                        {label: "Sum of products", value: "SUM"},
                        {label: "Fixed price", value: "FIXED"},
                        {label: "Discount percentage", value: "DISCOUNT_PERCENT"},
                        {label: "Discount amount", value: "DISCOUNT_AMOUNT"}
                      ]}
                      value={pricingType}
                      onChange={setPricingType}
                      disabled={plan === 'FREE' && pricingType !== 'SUM'}
                    />
                    {/* Ensure value posts since Polaris Select doesn't include a native input */}
                    <input type="hidden" name="pricingType" value={pricingType} />
                  </InlineStack>
                  {plan === 'FREE' && pricingType !== 'SUM' && (
                    <Text tone="critical" variant="bodySm">Pro only pricing modes. Upgrade to use.</Text>
                  )}
                  <InlineStack gap="300">
                    <TextField label="Min items (optional)" name="minItems" type="number" min={0} value={minItems} onChange={setMinItems} />
                    <TextField label="Max items (optional)" name="maxItems" type="number" min={0} value={maxItems} onChange={setMaxItems} />
                  </InlineStack>
                  
                  {/* Pro Features (locked on Free) */}
                  <div style={{ padding: '16px', border: '1px dashed #e5e7eb', borderRadius: '8px' }}>
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingSm">Pro features</Text>
                      {plan === 'FREE' && (
                        <InlineStack gap="200" align="center">
                          <Badge tone="attention">Locked</Badge>
                          <Button url="/app/pricing" variant="primary">Upgrade to Pro</Button>
                        </InlineStack>
                      )}
                    </InlineStack>
                    <BlockStack gap="300">
                      <Checkbox label="Require gift wrap" name="wrapRequired" checked={false} disabled={plan === 'FREE'} onChange={() => {}} />
                      <Checkbox label="Allow gift card add-on" name="allowCardUpload" checked={false} disabled={plan === 'FREE'} onChange={() => {}} />
                      <Text tone="subdued" variant="bodySm">Pro unlocks tiered pricing and gift wrap & gift card add-ons.</Text>
                    </BlockStack>
                  </div>



                  <InlineStack gap="300">
                    <Select
                      label="Status"
                      options={[
                        {label: "Draft", value: "DRAFT"},
                        {label: "Active", value: "ACTIVE"},
                        {label: "Archived", value: "ARCHIVED"}
                      ]}
                      value={status}
                      onChange={setStatus}
                    />
                    {/* Hidden mirrors so values submit */}
                    <input type="hidden" name="status" value={status} />
                    <Select
                      label="Type"
                      options={[
                        {label: "Fixed", value: "FIXED"},
                        {label: "Mix & Match", value: "MIX_MATCH"},
                        {label: "Build a Box", value: "BUILD_A_BOX"}
                      ]}
                      value={type}
                      onChange={setType}
                    />
                    <input type="hidden" name="type" value={type} />
                    
                  </InlineStack>
                  <Button submit primary loading={isSubmitting}>Save bundle</Button>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Existing bundles</Text>
              <ResourceList
                resourceName={{ singular: 'bundle', plural: 'bundles' }}
                items={bundles}
                renderItem={(item) => {
                  const wrapCount = item.wrappingOptions?.length || 0;
                  const productCount = item.products?.length || 0;
                  const sold = salesCount?.[item.id] || 0;
                  return (
                    <ResourceList.Item id={item.id}>
                      <InlineStack align="space-between" gap="300">
                        <InlineStack gap="300">
                          {item.imageUrl && (
                            <Thumbnail
                              source={item.imageUrl}
                              alt={item.title}
                              size="small"
                            />
                          )}
                          <BlockStack gap="100">
                            <Text as="span" variant="bodyMd">{item.title}</Text>
                            <Text as="span" tone="subdued" variant="bodySm">ID: {item.id}</Text>
                            <InlineStack gap="200" align="center">
                              <Text as="span" tone="subdued" variant="bodySm">
                                {item.type} • {item.pricingType}
                                {item.priceValueCents != null ? ` • $${(item.priceValueCents/100).toFixed(2)}` : ''}
                              </Text>
                              <div style={{ 
                                padding: '2px 8px', 
                                borderRadius: '12px', 
                                backgroundColor: item.status === 'ACTIVE' ? '#dcfce7' : item.status === 'DRAFT' ? '#fef3c7' : '#fee2e2',
                                color: item.status === 'ACTIVE' ? '#166534' : item.status === 'DRAFT' ? '#92400e' : '#991b1b',
                                fontSize: '10px',
                                fontWeight: '600',
                                textTransform: 'uppercase'
                              }}>
                                {item.status}
                              </div>
                            </InlineStack>
                            <Text as="span" tone="subdued" variant="bodySm">
                              {productCount} products{wrapCount ? ` • ${wrapCount} wraps` : ''} • Sales: {sold}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <InlineStack gap="300">
                          <Badge tone="info">{productCount} products</Badge>
                          {wrapCount ? <Badge tone="info">{wrapCount} wraps</Badge> : null}
                          <Form method="post">
                            <input type="hidden" name="intent" value="duplicate" />
                            <input type="hidden" name="id" value={item.id} />
                            <Button submit>Duplicate</Button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={item.id} />
                            <Button tone="critical" variant="secondary" submit>Delete</Button>
                          </Form>
                          <Button url={`https://${shop}/apps/bundles/${item.id}`} target="_blank">Preview</Button>
                          {/* Manage + Copy URL removed per request */}
                          {item.status !== 'ACTIVE' && (
                            <div style={{ 
                              padding: '4px 8px', 
                              backgroundColor: '#fef3c7', 
                              borderRadius: '4px', 
                              fontSize: '10px',
                              color: '#92400e',
                              whiteSpace: 'nowrap'
                            }}>
                              Set ACTIVE to show on storefront
                            </div>
                          )}
                        </InlineStack>
                      </InlineStack>
                    </ResourceList.Item>
                  );
                }}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Collection Selection Modal */}
      <Modal
        open={showCollectionModal}
        onClose={() => setShowCollectionModal(false)}
        title="Select Collection"
        primaryAction={{
          content: 'Select Collection',
          onAction: () => {
            if (selectedCollection) {
              handleCollectionSelect(selectedCollection);
              setShowCollectionModal(false);
            }
          },
          disabled: !selectedCollection
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowCollectionModal(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text>Choose a collection to automatically add all its products to your bundle:</Text>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  onClick={() => setSelectedCollection(collection)}
                  style={{
                    padding: '16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    marginBottom: '12px',
                    cursor: 'pointer',
                    backgroundColor: selectedCollection?.id === collection.id ? '#f0f9ff' : 'white',
                    borderColor: selectedCollection?.id === collection.id ? '#0ea5e9' : '#e5e7eb'
                  }}
                >
                  <InlineStack gap="300">
                    {collection.image?.url && (
                      <Thumbnail
                        source={collection.image.url}
                        alt={collection.title}
                        size="small"
                      />
                    )}
                    <BlockStack gap="100">
                      <Text variant="bodyMd" fontWeight="600">{collection.title}</Text>
                      {collection.description && (
                        <Text variant="bodySm" tone="subdued">{collection.description}</Text>
                      )}
                    </BlockStack>
                  </InlineStack>
                </div>
              ))}
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Product Selection Modal */}
      <Modal
        open={showProductModal}
        onClose={() => setShowProductModal(false)}
        title="Select Products"
        primaryAction={{
          content: `Add ${selectedProducts.length} Product${selectedProducts.length !== 1 ? 's' : ''}`,
          onAction: () => {
            setShowProductModal(false);
          },
          disabled: selectedProducts.length === 0
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowProductModal(false)
          }
        ]}
        large
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text>Choose products from your store to include in this bundle:</Text>
            
            {/* Search Input */}
            <TextField
              label="Search products"
              value={productSearchQuery}
              onChange={setProductSearchQuery}
              placeholder="Type to search products..."
              clearButton
              onClearButtonClick={() => setProductSearchQuery("")}
              autoComplete="off"
            />
            
            {/* Loading State */}
            {(isLoadingProducts || isSearching) && (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Text tone="subdued">Loading products...</Text>
              </div>
            )}            
            {/* Products Grid */}
            {!isLoadingProducts && !isSearching && (
              <div style={{ 
                maxHeight: '500px', 
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '16px',
                padding: '8px'
              }}>
                {(productSearchQuery.trim() ? searchResults : availableProducts).map((product) => {
                  const isSelected = selectedProducts.some(p => p.id === product.id);
                  return (
                    <div
                      key={product.id}
                      onClick={() => handleProductSelect(product, !isSelected)}
                      style={{
                        padding: '12px',
                        border: `2px solid ${isSelected ? '#10b981' : '#e5e7eb'}`,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        backgroundColor: isSelected ? '#f0fdf4' : '#ffffff',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}
                    >
                      <Checkbox
                        checked={isSelected}
                        onChange={() => {}}
                      />                      
                      {product.imageUrl ? (
                        <Thumbnail
                          source={product.imageUrl}
                          alt={product.title}
                          size="small"
                        />
                      ) : (
                        <div style={{
                          width: '40px',
                          height: '40px',
                          backgroundColor: '#f3f4f6',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#9ca3af',
                          fontSize: '12px'
                        }}>
                          No Image
                        </div>
                      )}
                      
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text as="span" variant="bodyMd" fontWeight="medium">
                          {product.title}
                        </Text>
                        {product.variant && (
                          <div style={{ marginTop: '4px' }}>
                            <Text as="span" tone="subdued" variant="bodySm">
                              ${product.variant.price}
                            </Text>
                          </div>
                        )}
                      </div>
                      
                      {isSelected && (
                        <div style={{
                          width: '20px',
                          height: '20px',
                          backgroundColor: '#10b981',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}>
                          ✓
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* No Results */}
            {!isLoadingProducts && !isSearching && (
              productSearchQuery.trim() ? searchResults.length === 0 : availableProducts.length === 0
            ) && (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <Text tone="subdued">
                  {productSearchQuery.trim() ? 'No products found matching your search.' : 'No products available.'}
                </Text>
              </div>
            )}
            
            {/* Selected Products Count */}
            {selectedProducts.length > 0 && (
              <div style={{
                padding: '12px',
                backgroundColor: '#f0fdf4',
                borderRadius: '6px',
                border: '1px solid #bbf7d0'
              }}>
                <Text variant="bodySm" fontWeight="medium" tone="success">
                  {selectedProducts.length} product{selectedProducts.length !== 1 ? 's' : ''} selected
                </Text>
              </div>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}


