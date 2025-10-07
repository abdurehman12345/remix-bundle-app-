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
  Combobox,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const bundle = await prisma.bundle.findUnique({
    where: { id: params.bundleId },
    include: { BundleProduct: true, WrappingOption: true, BundleCard: true, BundleTierPrice: true },
  });
  if (!bundle) {
    throw redirect("/app/bundles");
  }

  // Fetch product details from Shopify for products that don't have variant titles
  const productsWithDetails = [];
  for (const product of bundle.BundleProduct) {
    if (!product.variantTitle || !product.variantGid) {
      try {
        const resp = await admin.graphql(`#graphql
          query ProductDetails($id: ID!) {
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
        `, { variables: { id: product.productGid } });
        const data = await resp.json();
        const productData = data?.data?.product;
        if (productData) {
          const variant = productData.variants?.nodes?.[0];
          if (variant) {
            // Update the product in the database with the fetched details
            await prisma.bundleProduct.update({
              where: { id: product.id },
              data: {
                variantGid: variant.id,
                variantTitle: variant.title,
                priceCents: Math.round(parseFloat(variant.price || "0") * 100),
                imageUrl: variant.image?.url || productData.featuredMedia?.preview?.image?.url,
              },
            });
            productsWithDetails.push({
              ...product,
              variantGid: variant.id,
              variantTitle: variant.title,
              priceCents: Math.round(parseFloat(variant.price || "0") * 100),
              imageUrl: variant.image?.url || productData.featuredMedia?.preview?.image?.url,
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

  if (intent === "add-wrap") {
    const name = String(formData.get("name") || "").trim();
    const priceCents = Number(formData.get("priceCents") || 0);
    const imageUrl = String(formData.get("imageUrl") || "").trim() || null;
    if (!name) return json({ error: "Name is required" }, { status: 400 });
    await prisma.wrappingOption.create({
      data: { bundleId: params.bundleId, name, priceCents, imageUrl },
    });
    return redirect(`/app/bundles/${params.bundleId}`);
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
    return redirect(`/app/bundles/${params.bundleId}`);
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
          imageUrl: v.image?.url || p.featuredMedia?.preview?.image?.url || null,
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
    return redirect(`/app/bundles/${params.bundleId}`);
  }

  if (intent === "delete-wrap") {
    const id = String(formData.get("id"));
    await prisma.wrappingOption.delete({ where: { id } });
    return redirect(`/app/bundles/${params.bundleId}`);
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
    return redirect(`/app/bundles/${params.bundleId}`);
  }

  if (intent === "delete-card") {
    const id = String(formData.get("id"));
    await prisma.bundleCard.delete({ where: { id } });
    return redirect(`/app/bundles/${params.bundleId}`);
  }

  if (intent === "delete-product") {
    const id = String(formData.get("id"));
    await prisma.bundleProduct.delete({ where: { id } });
    return redirect(`/app/bundles/${params.bundleId}`);
  }

  if (intent === "activate-bundle") {
    await prisma.bundle.update({
      where: { id: params.bundleId },
      data: { status: "ACTIVE" },
    });
    return redirect(`/app/bundles/${params.bundleId}`);
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





    // Ensure bundleId is set for existing bundles
    const updateData = {
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




    };

    // Keep existing bundleId if present; do not modify here

    await prisma.bundle.update({
      where: { id: params.bundleId },
      data: updateData,
    });
    return redirect(`/app/bundles/${params.bundleId}`);
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
    return redirect(`/app/bundles/${params.bundleId}`);
  }

  if (intent === "delete-tier") {
    const id = String(formData.get("id"));
    await prisma.bundleTierPrice.delete({ where: { id } });
    return redirect(`/app/bundles/${params.bundleId}`);
  }

  return json({ ok: true });
};

export default function BundleDetail() {
  const { bundle } = useLoaderData();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";
  const [title, setTitle] = useState(bundle.title || "");
  const [collectionId, setCollectionId] = useState(bundle.collectionId || "");
  const [pricingType, setPricingType] = useState(bundle.pricingType || "SUM");
  const [description, setDescription] = useState(bundle.description || "");
  const [imageUrl, setImageUrl] = useState(bundle.imageUrl || "");
  const [minItems, setMinItems] = useState(
    bundle.minItems != null ? String(bundle.minItems) : ""
  );
  const [maxItems, setMaxItems] = useState(
    bundle.maxItems != null ? String(bundle.maxItems) : ""
  );

  
  const [status, setStatus] = useState(bundle.status || "DRAFT");
  const [type, setType] = useState(bundle.type || "FIXED");
  





  // State for new product form
  const [newProductGid, setNewProductGid] = useState("");
  const [newProductMin, setNewProductMin] = useState("");
  const [newProductMax, setNewProductMax] = useState("");

  // State for new wrap form
  const [newWrapName, setNewWrapName] = useState("");
  const [newWrapPriceCents, setNewWrapPriceCents] = useState("");
  const [newWrapImageUrl, setNewWrapImageUrl] = useState("");

  // Product search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Browse all products state
  const [allProducts, setAllProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productPage, setProductPage] = useState(1);

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
        console.error("Search error:", error);
      } finally {
        setIsSearching(false);
      }
    };

    const timeoutId = setTimeout(searchProducts, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Load all products
  const loadAllProducts = async (page = 1) => {
    setIsLoadingProducts(true);
    try {
      const res = await fetch(`/api/products?q=&limit=20&page=${page}`);
      if (res.ok) {
        const data = await res.json();
        setAllProducts(data.products || []);
        setProductPage(page);
      }
    } catch (error) {
      console.error("Load products error:", error);
    } finally {
      setIsLoadingProducts(false);
    }
  };

  // Load products on component mount
  useEffect(() => {
    loadAllProducts();
  }, []);

  const handleProductSelect = (product) => {
    setNewProductGid(product.id);
    setSearchQuery(product.title);
    setSearchResults([]);
  };

  const handleQuickAdd = (product) => {
    setNewProductGid(product.id);
    setNewProductMin("1");
    setNewProductMax("5");
    // Auto-submit the form
    const form = document.querySelector('form[data-intent="add-product"]');
    if (form) {
      const submitEvent = new Event('submit', { bubbles: true });
      form.dispatchEvent(submitEvent);
    }
  };

  return (
    <Page>
      <TitleBar title={bundle.title} />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Bundle settings</Text>
                <InlineStack gap="200">
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
                  <Button onClick={() => navigator.clipboard?.writeText(bundle.id)}>Copy ID</Button>
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
                {bundle.status !== "ACTIVE" && (
                  <div style={{ 
                    marginTop: '12px', 
                    padding: '8px 12px', 
                    backgroundColor: '#fef3c7', 
                    borderRadius: '6px', 
                    border: '1px solid #f59e0b' 
                  }}>
                    <Text variant="bodySm" style={{ color: '#92400e' }}>
                      ⚠️ Bundle must be ACTIVE to appear on storefront. Use the "Activate Bundle" button above.
                    </Text>
                  </div>
                )}
              </div>
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
                          const data = new FormData();
                          data.append('file', file);
                          try {
                            const res = await fetch('/app/upload', { method: 'POST', body: data });
                            if(res.ok){ 
                              const j = await res.json(); 
                              setImageUrl(j.url); 
                            } else {
                              console.error('Upload failed:', res.statusText);
                            }
                          } catch (error) {
                            console.error('Upload error:', error);
                          }
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
                  </div>
                  <InlineStack gap="300" alignment="center">
                    <TextField label="Collection GID (optional)" name="collectionId" value={collectionId} onChange={setCollectionId} autoComplete="off" />
                    {/* Ensure collectionId is posted */}
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
                  <InlineStack gap="200">
                    <Button submit primary loading={isSubmitting}>Save</Button>
                    {bundle.status !== "ACTIVE" && (
                      <Form method="post" style={{ display: 'inline' }}>
                        <input type="hidden" name="intent" value="activate-bundle" />
                        <Button submit variant="secondary">
                          🚀 Activate Bundle
                        </Button>
                      </Form>
                    )}
                  </InlineStack>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Products</Text>
              
              {/* Product Browser - Show live products from store */}
              <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f6f6f7', borderRadius: '8px' }}>
                <Text variant="bodyMd" as="h3" style={{ marginBottom: '16px', fontWeight: '600' }}>
                  Browse Products from Your Store
                </Text>
                
                {/* Product Search */}
                <div style={{ marginBottom: '16px' }}>
                  <Text variant="bodyMd" as="p" style={{ marginBottom: '8px' }}>
                    Search for products to add to this bundle:
                  </Text>
                  <Combobox
                    options={searchResults.map(p => ({
                      label: p.title,
                      value: p.id,
                      image: p.imageUrl
                    }))}
                    selected={[]}
                    textField={
                      <TextField
                        label="Search products"
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Type product name..."
                        autoComplete="off"
                      />
                    }
                    onSelect={handleProductSelect}
                    listTitle="Search Results"
                    loading={isSearching}
                  />
                </div>

                {/* Quick Add Form */}
                <Form method="post" data-intent="add-product">
                  <input type="hidden" name="intent" value="add-product" />
                  <InlineStack gap="300" align="end">
                    <TextField 
                      label="Product GID" 
                      name="productGid" 
                      value={newProductGid}
                      onChange={setNewProductGid}
                      autoComplete="off" 
                      placeholder="gid://shopify/Product/123..."
                    />
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
                    <Button submit disabled={!newProductGid} primary>
                      Add to Bundle
                    </Button>
                  </InlineStack>
                </Form>
              </div>

              {/* Browse All Products */}
              <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#fef3c7', borderRadius: '8px', border: '1px solid #f59e0b' }}>
                <Text variant="bodyMd" as="h3" style={{ marginBottom: '16px', fontWeight: '600', color: '#92400e' }}>
                  Browse All Available Products
                </Text>
                
                {isLoadingProducts ? (
                  <div style={{ textAlign: 'center', padding: '20px' }}>
                    <Text>Loading products...</Text>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                    {allProducts.map((product) => (
                      <div key={product.id} style={{ 
                        padding: '16px', 
                        border: '1px solid #e5e7eb', 
                        borderRadius: '8px', 
                        backgroundColor: 'white',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                      }}>
                        {product.imageUrl && (
                          <img 
                            src={product.imageUrl} 
                            alt={product.title}
                            style={{ 
                              width: '100%', 
                              height: '120px', 
                              objectFit: 'cover', 
                              borderRadius: '6px' 
                            }} 
                          />
                        )}
                        <div>
                          <Text variant="bodyMd" as="h4" style={{ fontWeight: '600', marginBottom: '4px' }}>
                            {product.title}
                          </Text>
                          {product.variant && (
                            <Text variant="bodySm" as="p" tone="subdued" style={{ marginBottom: '8px' }}>
                              {product.variant.title} • ${product.variant.price}
                            </Text>
                          )}
                          <Button 
                            size="small" 
                            onClick={() => handleQuickAdd(product)}
                            primary
                          >
                            + Add to Bundle
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div style={{ marginTop: '16px', textAlign: 'center' }}>
                  <InlineStack gap="200">
                    <Button 
                      disabled={productPage <= 1} 
                      onClick={() => loadAllProducts(productPage - 1)}
                      variant="secondary"
                    >
                      ← Previous
                    </Button>
                    <Text variant="bodySm">Page {productPage}</Text>
                    <Button 
                      onClick={() => loadAllProducts(productPage + 1)}
                      variant="secondary"
                    >
                      Next →
                    </Button>
                  </InlineStack>
                </div>
              </div>

              {/* Collection Sync */}
              {bundle.collectionId && (
                <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f0f9ff', borderRadius: '8px', border: '1px solid #0ea5e9' }}>
                  <Text variant="bodyMd" as="h3" style={{ marginBottom: '8px', fontWeight: '600', color: '#0c4a6e' }}>
                    Collection Sync Available
                  </Text>
                  <Text variant="bodySm" as="p" style={{ marginBottom: '16px', color: '#0369a1' }}>
                    This bundle is linked to a collection. Click below to automatically import all products from that collection.
                  </Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="sync-collection" />
                    <input type="hidden" name="collectionId" value={bundle.collectionId} />
                    <Button submit size="large" primary>
                      🚀 Sync Products from Collection
                    </Button>
                  </Form>
                </div>
              )}
              
              {/* Current Products in Bundle */}
              <div style={{ marginBottom: '16px' }}>
                <Text variant="bodyMd" as="h3" style={{ marginBottom: '16px', fontWeight: '600' }}>
                  Products Currently in Bundle ({bundle.products.length})
                </Text>
              </div>
              
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
              
              {bundle.products.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
                  <Text variant="bodyMd" as="p">
                    No products added yet. Use the search above or sync from collection to add products.
                  </Text>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Card templates (shown to customers when upload is enabled)</Text>
              <Text as="p" tone="subdued">Tiered pricing rules (optional)</Text>
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
              ) : null}
              <Form method="post">
                <input type="hidden" name="intent" value="add-card" />
                <BlockStack gap="300">
                  <InlineStack gap="300">
                    <TextField 
                      label="Name" 
                      name="name" 
                      autoComplete="off" 
                    />
                  </InlineStack>
                  <div>
                    <Text variant="bodyMd" as="label" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                      Card Image
                    </Text>
                    <InlineStack gap="200" align="center">
                      <TextField 
                        label="Image URL" 
                        name="imageUrl"
                        autoComplete="off" 
                      />
                      <input 
                        type="file" 
                        accept="image/png,image/jpeg" 
                        onChange={async (e) => {
                          const input = e.currentTarget;
                          const file = input.files?.[0];
                          if(!file) return;
                          const data = new FormData();
                          data.append('file', file);
                          const res = await fetch('/app/upload', { method: 'POST', body: data });
                          if(res.ok){ 
                            const j = await res.json();
                            const hidden = input.form?.querySelector('input[name="imageUrl"]');
                            if(hidden) hidden.value = j.url;
                          }
                        }}
                      />
                    </InlineStack>
                  </div>
                  <Button submit primary>Add card</Button>
                </BlockStack>
              </Form>
              <ResourceList
                resourceName={{ singular: 'card', plural: 'cards' }}
                items={bundle.cards || []}
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
              <Text as="h2" variant="headingMd">Gift wrapping</Text>
              <Form method="post">
                <input type="hidden" name="intent" value="add-wrap" />
                <BlockStack gap="300">
                  <InlineStack gap="300">
                    <TextField 
                      label="Name" 
                      name="name" 
                      value={newWrapName}
                      onChange={setNewWrapName}
                      autoComplete="off" 
                    />
                    <TextField 
                      label="Price (cents)" 
                      name="priceCents" 
                      type="number" 
                      min={0} 
                      value={newWrapPriceCents}
                      onChange={setNewWrapPriceCents}
                    />
                  </InlineStack>
                  
                  <div>
                    <Text variant="bodyMd" as="label" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                      Gift Wrap Image
                    </Text>
                    <InlineStack gap="200" align="center">
                      <input 
                        type="file" 
                        accept="image/png,image/jpeg" 
                        onChange={async (e) => {
                          const file = e.currentTarget.files?.[0];
                          if(!file) return;
                          const data = new FormData();
                          data.append('file', file);
                          try {
                            const res = await fetch('/app/upload', { method: 'POST', body: data });
                            if(res.ok){ 
                              const j = await res.json(); 
                              setNewWrapImageUrl(j.url); 
                            } else {
                              console.error('Upload failed:', res.statusText);
                            }
                          } catch (error) {
                            console.error('Upload error:', error);
                          }
                        }}
                        style={{ 
                          border: '1px solid #d1d5db', 
                          borderRadius: '6px', 
                          padding: '8px',
                          fontSize: '14px'
                        }}
                      />
                      {newWrapImageUrl && (
                        <img 
                          src={newWrapImageUrl} 
                          alt="Preview" 
                          style={{
                            width: '60px', 
                            height: '60px', 
                            objectFit: 'cover',
                            borderRadius: '4px',
                            border: '1px solid #d1d5db'
                          }} 
                        />
                      )}
                    </InlineStack>
                    <input type="hidden" name="imageUrl" value={newWrapImageUrl} />
                  </div>
                  
                  <Button submit disabled={!newWrapName || !newWrapImageUrl} primary>
                    Add Gift Wrap Option
                  </Button>
                </BlockStack>
              </Form>
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
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


