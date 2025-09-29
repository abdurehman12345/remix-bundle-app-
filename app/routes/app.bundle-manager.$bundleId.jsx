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
  Tabs,
  Banner,
  Divider,
  Icon,
  EmptyState,
  Modal,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const bundle = await prisma.bundle.findUnique({
    where: { id: params.bundleId },
    include: { 
      products: true, 
      wrappingOptions: true, 
      cards: true,
      tierPrices: true,
      _count: {
        select: {
          products: true,
          wrappingOptions: true,
          cards: true
        }
      }
    },
  });
  
  if (!bundle) {
    throw redirect("/app/bundle-manager");
  }

  // Fetch product details and full variants from Shopify for products missing details
  const productsWithDetails = [];
  for (const product of bundle.products) {
    if (!product.variantTitle || !product.variantGid || !product.variantsJson) {
      try {
        const resp = await admin.graphql(`#graphql
          query ProductDetails($id: ID!) {
            product(id: $id) {
              title
              featuredMedia { preview { image { url } } }
              variants(first: 50) { 
                nodes { 
                  id 
                  title 
                  price
                  image { url }
                } 
              }
            }
          }
        `, { variables: { id: product.productGid } });
        const data = await resp.json();
        const productData = data?.data?.product;
        if (productData) {
          const variant = productData.variants?.nodes?.[0];
          const variants = (productData.variants?.nodes || []).map(v => ({ id: v.id, title: v.title, priceCents: Math.round(parseFloat(v.price||'0')*100) }));
          if (variant) {
            // Update the product in the database with the fetched details
            await prisma.bundleProduct.update({
              where: { id: product.id },
              data: {
                variantGid: variant.id,
                variantTitle: variant.title,
                priceCents: Math.round(parseFloat(variant.price || "0") * 100),
                imageUrl: variant.image?.url || productData.featuredMedia?.preview?.image?.url,
                variantsJson: JSON.stringify(variants)
              },
            });
            productsWithDetails.push({
              ...product,
              variantGid: variant.id,
              variantTitle: variant.title,
              priceCents: Math.round(parseFloat(variant.price || "0") * 100),
              imageUrl: variant.image?.url || productData.featuredMedia?.preview?.image?.url,
              variantsJson: JSON.stringify(variants)
            });
          } else {
            productsWithDetails.push(product);
          }
        } else {
          productsWithDetails.push(product);
        }
      } catch (error) {
        console.error(`Failed to fetch product ${product.productGid}:`, error);
        productsWithDetails.push(product);
      }
    } else {
      productsWithDetails.push(product);
    }
  }

  return json({ bundle: { ...bundle, products: productsWithDetails } });
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "backfill-variants") {
    // Fetch bundle and iterate products to persist full variant lists
    const bundle = await prisma.bundle.findUnique({
      where: { id: params.bundleId },
      include: { products: true },
    });
    if (!bundle) return redirect("/app/bundle-manager");

    for (const product of bundle.products) {
      try {
        const resp = await admin.graphql(`#graphql
          query ProductDetails($id: ID!) {
            product(id: $id) {
              title
              featuredMedia { preview { image { url } } }
              variants(first: 50) {
                nodes { id title price image { url } }
              }
            }
          }
        `, { variables: { id: product.productGid } });
        const data = await resp.json();
        const p = data?.data?.product;
        if (!p) continue;
        const first = p.variants?.nodes?.[0];
        const variants = (p.variants?.nodes || []).map(v => ({
          id: v.id,
          title: v.title,
          priceCents: Math.round(parseFloat(v.price || "0") * 100),
        }));
        await prisma.bundleProduct.update({
          where: { id: product.id },
          data: {
            variantGid: first?.id || product.variantGid,
            variantTitle: first?.title || product.variantTitle,
            priceCents: first ? Math.round(parseFloat(first.price || "0") * 100) : product.priceCents,
            imageUrl: first?.image?.url || p.featuredMedia?.preview?.image?.url || product.imageUrl,
            variantsJson: JSON.stringify(variants),
          },
        });
      } catch (e) {
        console.error("Backfill variants error", e);
      }
    }
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "update-bundle") {
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





    console.log('Updating bundle with data:', {
      title,
      description,
      imageUrl,
      pricingType,
      priceValueCents,
      collectionId,
      minItems,
      maxItems,
      allowMessage,
      allowCardUpload,
      status,
      type,
      wrapRequired,
      messageCharLimit,
      personalizationFeeCents
    });

    await prisma.bundle.update({
      where: { id: params.bundleId },
      data: {
        title,
        description,
        imageUrl,
        collectionId,
        pricingType,
        priceValueCents: priceValueCents ? Number(priceValueCents) : null,
        minItems: minItems ? Number(minItems) : null,
        maxItems: maxItems ? Number(maxItems) : null,

        allowCardUpload,
        status,
        type,
        wrapRequired,




      },
    });
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "add-product") {
    const productGid = String(formData.get("productGid") || "").trim();
    const variantGidInput = String(formData.get("variantGid") || "").trim();
    const min = Number(formData.get("min") || 0);
    const max = Number(formData.get("max") || 0);
    if (!productGid) return json({ error: "Product GID is required" }, { status: 400 });

    let variantGid = variantGidInput || null;
    let variantTitle = null;
    let priceCents = null;
    let imageUrl = null;

    if (!variantGid) {
      try {
        const resp = await admin.graphql(`#graphql
          query DefaultVariant($id: ID!) {
            product(id: $id) {
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
        `, { variables: { id: productGid } });
        const data = await resp.json();
        const productData = data?.data?.product;
        if (productData) {
          const variant = productData.variants?.nodes?.[0];
          if (variant) {
            variantGid = variant.id;
            variantTitle = variant.title;
            priceCents = Math.round(parseFloat(variant.price || "0") * 100);
            imageUrl = variant.image?.url || productData.featuredMedia?.preview?.image?.url;
          }
        }
      } catch (error) {
        console.error("Failed to fetch product details:", error);
      }
    }

    await prisma.bundleProduct.create({
      data: { 
        bundleId: params.bundleId, 
        productGid, 
        variantGid, 
        variantTitle, 
        min, 
        max,
        priceCents,
        imageUrl,
      },
    });
    // Immediately backfill full variants for this product
    try {
      const resp = await admin.graphql(`#graphql
        query ProductDetails($id: ID!) {
          product(id: $id) {
            featuredMedia { preview { image { url } } }
            variants(first: 50) { nodes { id title price image { url } } }
          }
        }
      `, { variables: { id: productGid } });
      const data = await resp.json();
      const prod = data?.data?.product;
      if (prod) {
        const first = prod.variants?.nodes?.[0];
        const variants = (prod.variants?.nodes || []).map(v => ({ id: v.id, title: v.title, priceCents: Math.round(parseFloat(v.price||'0')*100) }));
        await prisma.bundleProduct.updateMany({
          where: { bundleId: params.bundleId, productGid },
          data: {
            variantGid: first?.id || variantGid,
            variantTitle: first?.title || variantTitle,
            priceCents: first ? Math.round(parseFloat(first.price||'0')*100) : priceCents,
            imageUrl: first?.image?.url || prod.featuredMedia?.preview?.image?.url || imageUrl,
            variantsJson: JSON.stringify(variants),
          },
        });
      }
    } catch (e) {
      console.error('Backfill after add-product failed', e);
    }
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "delete-product") {
    const id = String(formData.get("id"));
    await prisma.bundleProduct.delete({ where: { id } });
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "add-wrap") {
    const name = String(formData.get("name") || "").trim();
    const priceCents = Number(formData.get("priceCents") || 0);
    const imageUrl = String(formData.get("imageUrl") || "").trim() || null;
    if (!name) return json({ error: "Name is required" }, { status: 400 });
    
    await prisma.wrappingOption.create({
      data: { bundleId: params.bundleId, name, priceCents, imageUrl },
    });
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "delete-wrap") {
    const id = String(formData.get("id"));
    // Also delete Shopify product if available
    try {
      const wrap = await prisma.wrappingOption.findUnique({ where: { id } });
      if (wrap?.shopifyProductId) {
        const productNumericId = String(wrap.shopifyProductId).split('/').pop();
        await fetch(`https://${session.shop}/admin/api/2025-01/products/${productNumericId}.json`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        });
      }
    } catch (e) { console.warn('Bundle manager delete-wrap Shopify delete failed:', e?.message || e); }
    await prisma.wrappingOption.delete({ where: { id } });
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "add-card") {
    const name = String(formData.get("name") || "").trim();
    const imageUrl = String(formData.get("imageUrl") || "").trim();
    if (!name || !imageUrl) {
      return json({ error: "Name and image are required" }, { status: 400 });
    }
    
    await prisma.bundleCard.create({
      data: { bundleId: params.bundleId, name, imageUrl },
    });
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "delete-card") {
    const id = String(formData.get("id"));
    // Also delete Shopify product if available
    try {
      const card = await prisma.bundleCard.findUnique({ where: { id } });
      if (card?.shopifyProductId) {
        const productNumericId = String(card.shopifyProductId).split('/').pop();
        await fetch(`https://${session.shop}/admin/api/2025-01/products/${productNumericId}.json`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
        });
      }
    } catch (e) { console.warn('Bundle manager delete-card Shopify delete failed:', e?.message || e); }
    await prisma.bundleCard.delete({ where: { id } });
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "add-tier") {
    const minQuantity = Number(formData.get("minQuantity") || 0);
    const pricingType = String(formData.get("tierPricingType") || "DISCOUNT_PERCENT");
    const valueCents = formData.get("tierValueCents");
    const valuePercent = formData.get("tierValuePercent");
    await prisma.bundleTierPrice.create({
      data: {
        bundleId: params.bundleId,
        minQuantity,
        pricingType,
        valueCents: valueCents ? Number(valueCents) : null,
        valuePercent: valuePercent ? Number(valuePercent) : null,
      },
    });
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "delete-tier") {
    const id = String(formData.get("id"));
    await prisma.bundleTierPrice.delete({ where: { id } });
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  if (intent === "sync-collection") {
    const bundle = await prisma.bundle.findUnique({ where: { id: params.bundleId }, select: { id: true, collectionId: true } });
    const targetCollectionId = String(formData.get("collectionId") || bundle?.collectionId || "").trim();
    if (!bundle || !targetCollectionId) {
      return json({ error: "Missing collection id" }, { status: 400 });
    }
    
    try {
      const resp = await admin.graphql(`#graphql
        query CollectionProducts($id: ID!) {
          collection(id: $id) {
            products(first: 100) {
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
      `, { variables: { id: targetCollectionId } });
      const data = await resp.json();
      const nodes = data?.data?.collection?.products?.nodes || [];

      const toCreate = nodes.map((p) => {
        const v = p.variants?.nodes?.[0];
        if (!v) return null;
        return {
          bundleId: bundle.id,
          productGid: p.id,
          variantGid: v.id,
          variantTitle: v.title,
          imageUrl: v.image?.url || p.featuredMedia?.preview?.image?.url,
          priceCents: v.price ? Math.round(parseFloat(v.price) * 100) : null,
          min: 0,
          max: 0,
        };
      }).filter(Boolean);

      await prisma.$transaction([
        prisma.bundleProduct.deleteMany({ where: { bundleId: bundle.id } }),
        ...(toCreate.length ? [prisma.bundleProduct.createMany({ data: toCreate })] : []),
      ]);
    } catch (error) {
      console.error('Collection sync failed:', error);
      return json({ error: 'Failed to sync collection' }, { status: 500 });
    }
    return redirect(`/app/bundle-manager/${params.bundleId}`);
  }

  return json({ ok: true });
};

export default function BundleDetailManager() {
  const { bundle } = useLoaderData();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";
  
  const [selectedTab, setSelectedTab] = useState(0);
  const [title, setTitle] = useState(bundle.title || "");
  const [description, setDescription] = useState(bundle.description || "");
  const [imageUrl, setImageUrl] = useState(bundle.imageUrl || "");
  const [pricingType, setPricingType] = useState(bundle.pricingType || "SUM");
  const [priceValueCents, setPriceValueCents] = useState("");
  const [collectionId, setCollectionId] = useState(bundle.collectionId || "");
  const [minItems, setMinItems] = useState(bundle.minItems != null ? String(bundle.minItems) : "");
  const [maxItems, setMaxItems] = useState(bundle.maxItems != null ? String(bundle.maxItems) : "");

  
  const [status, setStatus] = useState(bundle.status || "DRAFT");
  const [type, setType] = useState(bundle.type || "FIXED");
  





  // State for new items
  const [newProductGid, setNewProductGid] = useState("");
  const [newProductMin, setNewProductMin] = useState("");
  const [newProductMax, setNewProductMax] = useState("");
  const [newWrapName, setNewWrapName] = useState("");
  const [newWrapPriceCents, setNewWrapPriceCents] = useState("");
  const [newWrapImageUrl, setNewWrapImageUrl] = useState("");
  const [newWrapImageFile, setNewWrapImageFile] = useState(null);
  const [newCardName, setNewCardName] = useState("");
  const [newCardImageUrl, setNewCardImageUrl] = useState("");
  const [newCardImageFile, setNewCardImageFile] = useState(null);

  // Modal states
  const [showProductModal, setShowProductModal] = useState(false);
  const [showWrapModal, setShowWrapModal] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);

  // Product search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productPage, setProductPage] = useState(1);

  // Upload states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const tabs = [
    {
      id: 'overview',
      content: 'Overview',
      accessibilityLabel: 'Bundle overview',
      panelID: 'overview-panel',
    },
    {
      id: 'products',
      content: 'Products',
      accessibilityLabel: 'Manage products',
      panelID: 'products-panel',
    },
    {
      id: 'wrapping',
      content: 'Gift Wrapping',
      accessibilityLabel: 'Manage gift wrapping',
      panelID: 'wrapping-panel',
    },
    {
      id: 'cards',
      content: 'Card Designs',
      accessibilityLabel: 'Manage card designs',
      panelID: 'cards-panel',
    },
  ];

  // Search for products
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const searchProducts = async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/products?q=${encodeURIComponent(searchQuery)}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.products || []);
        }
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    };

    const timeoutId = setTimeout(searchProducts, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Load all products for browsing
  useEffect(() => {
    const loadProducts = async () => {
      setIsLoadingProducts(true);
      try {
        const res = await fetch(`/api/products?page=${productPage}&limit=20`);
        if (res.ok) {
          const data = await res.json();
          setAllProducts(data.products || []);
        }
      } catch (error) {
        console.error('Failed to load products:', error);
      } finally {
        setIsLoadingProducts(false);
      }
    };

    loadProducts();
  }, [productPage]);

  const handleProductSelect = (product) => {
    setNewProductGid(product.id);
    setSearchQuery(product.title);
    setSearchResults([]);
  };

  const handleImageUpload = async (file, setImageUrl, setImageFile = null) => {
    if (!file) return;
    
    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      alert('Please select a PNG or JPEG image file.');
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      alert('Image file size must be less than 5MB.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    
    const data = new FormData();
    data.append('file', file);
    
    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 100);

      const res = await fetch('/app/upload', { method: 'POST', body: data });
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      
      if (res.ok) {
        const result = await res.json();
        setImageUrl(result.url);
        if (setImageFile) setImageFile(file);
        
        // Reset progress after success
        setTimeout(() => {
          setUploadProgress(0);
        }, 1000);
      } else {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert(`Image upload failed: ${error.message}. Please try again.`);
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Page
      title={`Bundle: ${bundle.title}`}
      backAction={{ content: 'Bundle Manager', url: '/app/bundle-manager' }}
    >
      <TitleBar title={`Bundle: ${bundle.title}`} />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Bundle Settings</Text>
                <InlineStack gap="200">
                  <Button onClick={() => setShowManageModal(true)}>Manage wraps/cards</Button>
                  <div style={{ 
                    padding: '4px 12px', 
                    borderRadius: '16px', 
                    backgroundColor: bundle.status === 'ACTIVE' ? '#dcfce7' : bundle.status === 'DRAFT' ? '#fef3c7' : '#fee2e2',
                    color: bundle.status === 'ACTIVE' ? '#166534' : bundle.status === 'DRAFT' ? '#92400e' : '#991b1b',
                    fontSize: '12px',
                    fontWeight: '600',
                    textTransform: 'uppercase'
                  }}>
                    {bundle.status}
                  </div>
                  <Text tone="subdued" variant="bodySm">ID: {bundle.id}</Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="backfill-variants" />
                    <Button submit primary>Backfill product variants</Button>
                  </Form>
                </InlineStack>
              </InlineStack>
              
              {/* Bundle ID for storefront */}
              <div style={{ padding: '16px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #0ea5e9' }}>
                <Text variant="bodyMd" as="h3" style={{ marginBottom: '8px', fontWeight: '600', color: '#0c4a6e' }}>
                  Storefront Access
                </Text>
                <Text variant="bodySm" as="p" style={{ marginBottom: '12px', color: '#0369a1' }}>
                  Use this ID in your theme to display this bundle:
                </Text>
                <InlineStack gap="200" align="center">
                  <Text variant="bodyMd" as="code" style={{ 
                    backgroundColor: '#e0f2fe', 
                    padding: '8px 12px', 
                    borderRadius: '4px', 
                    fontFamily: 'monospace',
                    fontSize: '14px'
                  }}>
                    {bundle.bundleId || 'Generating...'}
                  </Text>
                  <InlineStack gap="100">
                    <Button 
                      onClick={() => navigator.clipboard?.writeText(bundle.bundleId || bundle.id)}
                      size="small"
                    >
                      Copy ID
                    </Button>
                    <Button 
                      onClick={() => navigator.clipboard?.writeText(`/apps/${bundle.bundleId || bundle.id}`)}
                      size="small"
                      variant="secondary"
                    >
                      Copy URL
                    </Button>
                  </InlineStack>
                </InlineStack>
                <Text variant="bodySm" as="p" style={{ marginTop: '8px', color: '#0369a1' }}>
                  Add this to your theme: <code style={{ backgroundColor: '#e0f2fe', padding: '2px 4px', borderRadius: '2px' }}>
                    {{ 'bundle_id': '{bundle.bundleId || bundle.id}' }}
                  </code>
                </Text>
                <Text variant="bodySm" as="p" style={{ marginTop: '8px', color: '#0369a1' }}>
                  Test storefront: <a href={`/apps/${bundle.bundleId || bundle.id}`} target="_blank" style={{ color: '#0369a1', textDecoration: 'underline' }}>
                    Click here to test
                  </a>
                </Text>
                {bundle.status !== "ACTIVE" && (
                  <div style={{ 
                    marginTop: '12px', 
                    padding: '8px 12px', 
                    backgroundColor: '#fef3c7', 
                    borderRadius: '6px', 
                    border: '1px solid #f59e0b' 
                  }}>
                    <Text variant="bodySm" style={{ color: '#92400e' }}>
                      ⚠️ Bundle must be ACTIVE to appear on storefront. Change status below and save.
                    </Text>
                  </div>
                )}
              </div>

              {/* Current Bundle Image Preview */}
              {bundle.imageUrl && (
                <div style={{ 
                  padding: '16px', 
                  backgroundColor: '#f0f9ff', 
                  borderRadius: '8px',
                  marginBottom: '20px',
                  textAlign: 'center'
                }}>
                  <Text variant="bodyMd" as="h4" style={{ marginBottom: '16px', fontWeight: '600', color: '#0369a1' }}>
                    Current Bundle Image
                  </Text>
                  <img 
                    src={bundle.imageUrl} 
                    alt="Bundle Preview" 
                    style={{
                      maxWidth: '200px',
                      height: 'auto',
                      borderRadius: '8px',
                      border: '2px solid #0ea5e9'
                    }} 
                  />
                </div>
              )}

              <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                {/* Overview Tab */}
                <Card.Section>
                  {selectedTab === 0 && (
                    <BlockStack gap="400">
                      <Form method="post">
                        <input type="hidden" name="intent" value="update-bundle" />
                        <BlockStack gap="300">
                          <TextField label="Title" name="title" value={title} onChange={setTitle} autoComplete="off" />
                          <TextField label="Description" multiline name="description" value={description} onChange={setDescription} autoComplete="off" />
                          
                          <div>
                            <Text variant="bodyMd" as="label" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                              Bundle Image
                            </Text>
                            <InlineStack gap="200" align="center">
                              <TextField 
                                label="Image URL" 
                                name="imageUrl" 
                                value={imageUrl} 
                                onChange={setImageUrl} 
                                autoComplete="off" 
                              />
                              <input 
                                type="file" 
                                accept="image/png,image/jpeg" 
                                onChange={async (e) => {
                                  const file = e.currentTarget.files?.[0];
                                  if(!file) return;
                                  await handleImageUpload(file, setImageUrl);
                                }}
                                style={{ 
                                  border: '1px solid #d1d5db', 
                                  borderRadius: '6px', 
                                  padding: '8px',
                                  fontSize: '14px'
                                }}
                              />
                              {imageUrl && (
                                <img 
                                  src={imageUrl} 
                                  alt="Preview" 
                                  style={{
                                    width: '100px', 
                                    height: '100px', 
                                    objectFit: 'cover',
                                    borderRadius: '6px',
                                    border: '1px solid #d1d5db'
                                  }} 
                                />
                              )}
                            </InlineStack>
                            <input type="hidden" name="imageUrl" value={imageUrl} />
                          </div>

                          <InlineStack gap="300" alignment="center">
                            <TextField label="Collection GID (optional)" name="collectionId" value={collectionId} onChange={setCollectionId} autoComplete="off" />
                            <input type="hidden" name="collectionId" value={collectionId} />
                            <Form method="post">
                              <input type="hidden" name="intent" value="sync-collection" />
                              <input type="hidden" name="collectionId" value={collectionId} />
                              <Button submit disabled={!collectionId}>Sync products from collection</Button>
                            </Form>
                          </InlineStack>

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
                            />
                          <input type="hidden" name="pricingType" value={pricingType} />
                          </InlineStack>

                          <InlineStack gap="300">
                            <TextField label="Min items (optional)" name="minItems" type="number" min={0} value={minItems} onChange={setMinItems} />
                            <TextField label="Max items (optional)" name="maxItems" type="number" min={0} value={maxItems} onChange={setMaxItems} />
                          </InlineStack>

                          




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

                          <Button submit primary loading={isSubmitting}>Save Bundle Settings</Button>
                        </BlockStack>
                      </Form>
                    </BlockStack>
                  )}

                  {/* Products Tab */}
                  {selectedTab === 1 && (
                    <BlockStack gap="400">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingMd">Manage Products</Text>
                        <Button onClick={() => setShowProductModal(true)} primary>
                          Add Product
                        </Button>
                      </InlineStack>
                      
                      {/* Current Products */}
                      <div>
                        <Text variant="bodyMd" as="h4" style={{ marginBottom: '16px', fontWeight: '600' }}>
                          Products in Bundle ({bundle.products.length})
                        </Text>
                        
                        {bundle.products.length === 0 ? (
                          <EmptyState
                            heading="No products added"
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                          >
                            <p>Add products from your store to create this bundle.</p>
                          </EmptyState>
                        ) : (
                          <ResourceList
                            resourceName={{ singular: 'product', plural: 'products' }}
                            items={bundle.products}
                            renderItem={(p) => (
                              <ResourceList.Item id={p.id}>
                                <InlineStack align="space-between" gap="300">
                                  <InlineStack gap="300">
                                    {p.imageUrl && (
                                      <Thumbnail
                                        source={p.imageUrl}
                                        alt={p.variantTitle || p.productGid}
                                        size="small"
                                      />
                                    )}
                                    <BlockStack gap="100">
                                      <Text as="span" variant="bodyMd">{p.variantTitle || p.productGid}</Text>
                                      <Text as="span" tone="subdued" variant="bodySm">
                                        min {p.min} • max {p.max}
                                        {p.priceCents && ` • $${(p.priceCents/100).toFixed(2)}`}
                                      </Text>
                                    </BlockStack>
                                  </InlineStack>
                                  <Form method="post">
                                    <input type="hidden" name="intent" value="delete-product" />
                                    <input type="hidden" name="id" value={p.id} />
                                    <Button tone="critical" variant="secondary" submit>Remove</Button>
                                  </Form>
                                </InlineStack>
                              </ResourceList.Item>
                            )}
                          />
                        )}
                      </div>
                    </BlockStack>
                  )}

                  {/* Gift Wrapping Tab */}
                  {selectedTab === 2 && (
                    <BlockStack gap="400">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingMd">Manage Gift Wrapping</Text>
                        <Button onClick={() => setShowWrapModal(true)} primary>
                          Add Gift Wrap
                        </Button>
                      </InlineStack>
                      
                      {/* Current Wraps */}
                      <div>
                        <Text variant="bodyMd" as="h4" style={{ marginBottom: '16px', fontWeight: '600' }}>
                          Gift Wrap Options ({bundle.wrappingOptions.length})
                        </Text>
                        
                        {bundle.wrappingOptions.length === 0 ? (
                          <EmptyState
                            heading="No gift wrap options"
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                          >
                            <p>Add gift wrap options for customers to choose from.</p>
                          </EmptyState>
                        ) : (
                          <ResourceList
                            resourceName={{ singular: 'wrap', plural: 'wraps' }}
                            items={bundle.wrappingOptions}
                            renderItem={(w) => (
                              <ResourceList.Item id={w.id}>
                                <InlineStack align="space-between" gap="300">
                                  <InlineStack gap="300">
                                    {w.imageUrl && (
                                      <Thumbnail
                                        source={w.imageUrl}
                                        alt={w.name}
                                        size="small"
                                      />
                                    )}
                                    <BlockStack gap="100">
                                      <Text as="span" variant="bodyMd">{w.name}</Text>
                                      <Text as="span" tone="subdued" variant="bodySm">${(w.priceCents/100).toFixed(2)}</Text>
                                    </BlockStack>
                                  </InlineStack>
                                  <Form method="post">
                                    <input type="hidden" name="intent" value="delete-wrap" />
                                    <input type="hidden" name="id" value={w.id} />
                                    <Button tone="critical" variant="secondary" submit>Delete</Button>
                                  </Form>
                                </InlineStack>
                              </ResourceList.Item>
                            )}
                          />
                        )}
                      </div>
                    </BlockStack>
                  )}

                  {/* Cards Tab */}
                  {selectedTab === 3 && (
                    <BlockStack gap="400">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingMd">Manage Card Designs</Text>
                        <Button onClick={() => setShowCardModal(true)} primary>
                          Add Card Design
                        </Button>
                      </InlineStack>
                      
                      {/* Current Cards */}
                      <div>
                        <Text variant="bodyMd" as="h4" style={{ marginBottom: '16px', fontWeight: '600' }}>
                          Card Designs ({bundle.cards.length})
                        </Text>
                        
                        {bundle.cards.length === 0 ? (
                          <EmptyState
                            heading="No card designs"
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                          >
                            <p>Add card designs for customers to choose from when personalizing their bundle.</p>
                          </EmptyState>
                        ) : (
                          <ResourceList
                            resourceName={{ singular: 'card', plural: 'cards' }}
                            items={bundle.cards}
                            renderItem={(c) => (
                              <ResourceList.Item id={c.id}>
                                <InlineStack align="space-between" gap="300">
                                  <InlineStack gap="300">
                                    {c.imageUrl && (
                                      <Thumbnail
                                        source={c.imageUrl}
                                        alt={c.name}
                                        size="small"
                                      />
                                    )}
                                    <BlockStack gap="100">
                                      <Text as="span" variant="bodyMd">{c.name}</Text>
                                    </BlockStack>
                                  </InlineStack>
                                  <Form method="post">
                                    <input type="hidden" name="intent" value="delete-card" />
                                    <input type="hidden" name="id" value={c.id} />
                                    <Button tone="critical" variant="secondary" submit>Delete</Button>
                                  </Form>
                                </InlineStack>
                              </ResourceList.Item>
                            )}
                          />
                        )}
                      </div>
                      <Divider />
                      <Text as="h3" variant="headingMd">Tiered Pricing</Text>
                      <Form method="post">
                        <input type="hidden" name="intent" value="add-tier" />
                        <InlineStack gap="300">
                          <TextField label="Min quantity" name="minQuantity" type="number" min={1} placeholder="2" />
                          <Select
                            label="Pricing type"
                            options={[
                              {label: "Discount %", value: "DISCOUNT_PERCENT"},
                              {label: "Discount amount", value: "DISCOUNT_AMOUNT"},
                              {label: "Fixed price", value: "FIXED"},
                            ]}
                            name="tierPricingType"
                            onChange={() => {}}
                          />
                          <TextField label="Value (cents)" name="tierValueCents" type="number" min={0} placeholder="500" />
                          <TextField label="Value (%)" name="tierValuePercent" type="number" min={0} max={100} placeholder="10" />
                          <Button submit>Add tier</Button>
                        </InlineStack>
                      </Form>
                      {bundle.tierPrices?.length ? (
                        <ResourceList
                          resourceName={{ singular: 'tier', plural: 'tiers' }}
                          items={bundle.tierPrices.sort((a,b)=>a.minQuantity-b.minQuantity)}
                          renderItem={(t) => (
                            <ResourceList.Item id={t.id}>
                              <InlineStack align="space-between" gap="300">
                                <Text>
                                  Min {t.minQuantity} • {t.pricingType === 'FIXED' && t.valueCents != null ? `$${(t.valueCents/100).toFixed(2)}` : t.pricingType === 'DISCOUNT_AMOUNT' && t.valueCents != null ? `-$${(t.valueCents/100).toFixed(2)}` : t.pricingType === 'DISCOUNT_PERCENT' && t.valuePercent != null ? `-${t.valuePercent}%` : ''}
                                </Text>
                                <Form method="post">
                                  <input type="hidden" name="intent" value="delete-tier" />
                                  <input type="hidden" name="id" value={t.id} />
                                  <Button tone="critical" variant="secondary" submit>Delete</Button>
                                </Form>
                              </InlineStack>
                            </ResourceList.Item>
                          )}
                        />
                      ) : (
                        <Text tone="subdued">No tiers yet.</Text>
                      )}
                    </BlockStack>
                  )}
                </Card.Section>
              </Tabs>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Add Product Modal */}
      <Modal
        open={showProductModal}
        onClose={() => setShowProductModal(false)}
        title="Add Product to Bundle"
        primaryAction={{
          content: 'Add Product',
          onAction: () => {
            if (newProductGid) {
              const form = document.createElement('form');
              form.method = 'POST';
              form.innerHTML = `
                <input type="hidden" name="intent" value="add-product" />
                <input type="hidden" name="productGid" value="${newProductGid}" />
                <input type="hidden" name="min" value="${newProductMin}" />
                <input type="hidden" name="max" value="${newProductMax}" />
              `;
              document.body.appendChild(form);
              form.submit();
            }
          },
          disabled: !newProductGid
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowProductModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyMd">
              Search for products to add to this bundle:
            </Text>
            
            <TextField
              label="Search products"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Type product name..."
              autoComplete="off"
            />
            
            {isSearching && (
              <InlineStack align="center">
                <Spinner size="small" />
                <Text>Searching...</Text>
              </InlineStack>
            )}
            
            {searchResults.length > 0 && (
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {searchResults.map((product) => (
                  <div
                    key={product.id}
                    onClick={() => handleProductSelect(product)}
                    style={{
                      padding: '8px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '4px',
                      marginBottom: '4px',
                      cursor: 'pointer',
                      backgroundColor: newProductGid === product.id ? '#e0f2fe' : '#f9fafb'
                    }}
                  >
                    <Text variant="bodySm">{product.title}</Text>
                  </div>
                ))}
              </div>
            )}
            
            <InlineStack gap="300">
              <TextField 
                label="Min Quantity" 
                name="min" 
                type="number" 
                min={0} 
                value={newProductMin}
                onChange={setNewProductMin}
                placeholder="0"
              />
              <TextField 
                label="Max Quantity" 
                name="max" 
                type="number" 
                min={0} 
                value={newProductMax}
                onChange={setNewProductMax}
                placeholder="5"
              />
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Add Gift Wrap Modal */}
      <Modal
        open={showWrapModal}
        onClose={() => setShowWrapModal(false)}
        title="Add Gift Wrap Option"
        primaryAction={{
          content: 'Add Gift Wrap',
          onAction: () => {
            if (newWrapName && (newWrapImageUrl || newWrapImageFile)) {
              const form = document.createElement('form');
              form.method = 'POST';
              form.innerHTML = `
                <input type="hidden" name="intent" value="add-wrap" />
                <input type="hidden" name="name" value="${newWrapName}" />
                <input type="hidden" name="priceCents" value="${newWrapPriceCents}" />
                <input type="hidden" name="imageUrl" value="${newWrapImageUrl}" />
              `;
              document.body.appendChild(form);
              form.submit();
            }
          },
          disabled: !newWrapName || (!newWrapImageUrl && !newWrapImageFile)
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowWrapModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField 
              label="Gift Wrap Name" 
              name="name" 
              value={newWrapName}
              onChange={setNewWrapName}
              autoComplete="off" 
              placeholder="e.g., Elegant Gold, Festive Red"
              helpText="Give your gift wrap option a descriptive name"
            />
            
            <TextField 
              label="Price (cents)" 
              name="priceCents" 
              type="number" 
              min={0} 
              value={newWrapPriceCents}
              onChange={setNewWrapPriceCents}
              placeholder="500"
              helpText="Enter price in cents (e.g., 500 = $5.00)"
            />
            
            <div>
              <Text variant="bodyMd" as="label" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Gift Wrap Image *
              </Text>
              <Text variant="bodySm" tone="subdued" style={{ marginBottom: '16px' }}>
                Upload an image to showcase your gift wrap design. PNG or JPEG, max 5MB.
              </Text>
              
              <BlockStack gap="300">
                {/* File Upload */}
                <div style={{ 
                  border: '2px dashed #d1d5db', 
                  borderRadius: '8px', 
                  padding: '20px', 
                  textAlign: 'center',
                  backgroundColor: '#f9fafb',
                  transition: 'all 0.2s ease'
                }}>
                  <input 
                    type="file" 
                    accept="image/png,image/jpeg,image/jpg" 
                    onChange={async (e) => {
                      const file = e.currentTarget.files?.[0];
                      if(!file) return;
                      setNewWrapImageFile(file);
                      await handleImageUpload(file, setNewWrapImageUrl, setNewWrapImageFile);
                    }}
                    style={{ display: 'none' }}
                    id="wrap-image-upload"
                  />
                  <label htmlFor="wrap-image-upload" style={{ cursor: 'pointer' }}>
                    <div style={{ marginBottom: '12px' }}>
                      <Icon source="image" size="large" tone="subdued" />
                    </div>
                    <Text variant="bodyMd" style={{ marginBottom: '8px' }}>
                      {newWrapImageFile ? newWrapImageFile.name : 'Click to upload image'}
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      PNG, JPEG up to 5MB
                    </Text>
                  </label>
                </div>

                {/* Upload Progress */}
                {isUploading && (
                  <div style={{ 
                    padding: '12px', 
                    backgroundColor: '#f0f9ff', 
                    borderRadius: '6px',
                    border: '1px solid #0ea5e9'
                  }}>
                    <InlineStack align="center" gap="200">
                      <Spinner size="small" />
                      <Text variant="bodySm">Uploading... {uploadProgress}%</Text>
                    </InlineStack>
                  </div>
                )}

                {/* Image Preview */}
                {(newWrapImageUrl || newWrapImageFile) && (
                  <div style={{ 
                    padding: '16px', 
                    backgroundColor: '#f0f9ff', 
                    borderRadius: '8px',
                    border: '1px solid #0ea5e9',
                    textAlign: 'center'
                  }}>
                    <Text variant="bodyMd" style={{ marginBottom: '12px', fontWeight: '600', color: '#0c4a6e' }}>
                      Preview
                    </Text>
                    <img 
                      src={newWrapImageUrl || URL.createObjectURL(newWrapImageFile)} 
                      alt="Gift Wrap Preview" 
                      style={{
                        maxWidth: '200px',
                        maxHeight: '200px',
                        objectFit: 'contain',
                        borderRadius: '6px',
                        border: '1px solid #0ea5e9'
                      }} 
                    />
                    <div style={{ marginTop: '12px' }}>
                      <Button 
                        size="small" 
                        variant="secondary" 
                        tone="critical"
                        onClick={() => {
                          setNewWrapImageUrl("");
                          setNewWrapImageFile(null);
                        }}
                      >
                        Remove Image
                      </Button>
                    </div>
                  </div>
                )}

                {/* Manual URL Input */}
                <div style={{ 
                  padding: '16px', 
                  backgroundColor: '#f9fafb', 
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb'
                }}>
                  <Text variant="bodyMd" style={{ marginBottom: '8px', fontWeight: '500' }}>
                    Or enter image URL manually:
                  </Text>
                  <TextField 
                    label="Image URL" 
                    name="imageUrl"
                    value={newWrapImageUrl}
                    onChange={setNewWrapImageUrl}
                    autoComplete="off" 
                    placeholder="https://example.com/image.jpg"
                  />
                </div>
              </BlockStack>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Add Card Design Modal */}
      <Modal
        open={showCardModal}
        onClose={() => setShowCardModal(false)}
        title="Add Card Design"
        primaryAction={{
          content: 'Add Card Design',
          onAction: () => {
            if (newCardName && (newCardImageUrl || newCardImageFile)) {
              const form = document.createElement('form');
              form.method = 'POST';
              form.innerHTML = `
                <input type="hidden" name="intent" value="add-card" />
                <input type="hidden" name="name" value="${newCardName}" />
                <input type="hidden" name="imageUrl" value="${newCardImageUrl}" />
              `;
              document.body.appendChild(form);
              form.submit();
            }
          },
          disabled: !newCardName || (!newCardImageUrl && !newCardImageFile)
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowCardModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField 
              label="Card Design Name" 
              name="name" 
              value={newCardName}
              onChange={setNewCardName}
              autoComplete="off" 
              placeholder="e.g., Birthday Celebration, Thank You, Congratulations"
              helpText="Give your card design a descriptive name"
            />
            
            <div>
              <Text variant="bodyMd" as="label" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Card Design Image *
              </Text>
              <Text variant="bodySm" tone="subdued" style={{ marginBottom: '16px' }}>
                Upload an image to showcase your card design. PNG or JPEG, max 5MB.
              </Text>
              
              <BlockStack gap="300">
                {/* File Upload */}
                <div style={{ 
                  border: '2px dashed #d1d5db', 
                  borderRadius: '8px', 
                  padding: '20px', 
                  textAlign: 'center',
                  backgroundColor: '#f9fafb',
                  transition: 'all 0.2s ease'
                }}>
                  <input 
                    type="file" 
                    accept="image/png,image/jpeg,image/jpg" 
                    onChange={async (e) => {
                      const file = e.currentTarget.files?.[0];
                      if(!file) return;
                      setNewCardImageFile(file);
                      await handleImageUpload(file, setNewCardImageUrl, setNewCardImageFile);
                    }}
                    style={{ display: 'none' }}
                    id="card-image-upload"
                  />
                  <label htmlFor="card-image-upload" style={{ cursor: 'pointer' }}>
                    <div style={{ marginBottom: '12px' }}>
                      <Icon source="image" size="large" tone="subdued" />
                    </div>
                    <Text variant="bodyMd" style={{ marginBottom: '8px' }}>
                      {newCardImageFile ? newCardImageFile.name : 'Click to upload image'}
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      PNG, JPEG up to 5MB
                    </Text>
                  </label>
                </div>

                {/* Upload Progress */}
                {isUploading && (
                  <div style={{ 
                    padding: '12px', 
                    backgroundColor: '#f0f9ff', 
                    borderRadius: '6px',
                    border: '1px solid #0ea5e9'
                  }}>
                    <InlineStack align="center" gap="200">
                      <Spinner size="small" />
                      <Text variant="bodySm">Uploading... {uploadProgress}%</Text>
                    </InlineStack>
                  </div>
                )}

                {/* Image Preview */}
                {(newCardImageUrl || newCardImageFile) && (
                  <div style={{ 
                    padding: '16px', 
                    backgroundColor: '#f0f9ff', 
                    borderRadius: '8px',
                    border: '1px solid #0ea5e9',
                    textAlign: 'center'
                  }}>
                    <Text variant="bodyMd" style={{ marginBottom: '12px', fontWeight: '600', color: '#0c4a6e' }}>
                      Preview
                    </Text>
                    <img 
                      src={newCardImageUrl || URL.createObjectURL(newCardImageFile)} 
                      alt="Card Design Preview" 
                      style={{
                        maxWidth: '200px',
                        maxHeight: '200px',
                        objectFit: 'contain',
                        borderRadius: '6px',
                        border: '1px solid #0ea5e9'
                      }} 
                    />
                    <div style={{ marginTop: '12px' }}>
                      <Button 
                        size="small" 
                        variant="secondary" 
                        tone="critical"
                        onClick={() => {
                          setNewCardImageUrl("");
                          setNewCardImageFile(null);
                        }}
                      >
                        Remove Image
                      </Button>
                    </div>
                  </div>
                )}

                {/* Manual URL Input */}
                <div style={{ 
                  padding: '16px', 
                  backgroundColor: '#f9fafb', 
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb'
                }}>
                  <Text variant="bodyMd" style={{ marginBottom: '8px', fontWeight: '500' }}>
                    Or enter image URL manually:
                  </Text>
                  <TextField 
                    label="Image URL" 
                    name="imageUrl"
                    value={newCardImageUrl}
                    onChange={setNewCardImageUrl}
                    autoComplete="off" 
                    placeholder="https://example.com/card-design.jpg"
                  />
                </div>
              </BlockStack>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

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
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                          {w.imageUrl && <img src={w.imageUrl} alt={w.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />}
                        </td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{w.name}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>${((w.priceCents||0)/100).toFixed(2)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete-wrap" />
                            <input type="hidden" name="id" value={w.id} />
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
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                          {c.imageUrl && <img src={c.imageUrl} alt={c.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />}
                        </td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>{c.name}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>${((c.priceCents||0)/100).toFixed(2)}</td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #f1f5f9' }}>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete-card" />
                            <input type="hidden" name="id" value={c.id} />
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
