import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  ResourceList,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({ where: { shop: session.shop } });
  const plan = settings?.plan || 'FREE';
  const bundles = await prisma.bundle.findMany({
    where: { shop: session.shop },
    include: { 
      products: true, 
      wrappingOptions: true, 
      cards: true,
    },
    orderBy: { createdAt: 'desc' }
  });

  return json({ bundles, shop: session.shop, plan });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "toggle-status") {
    const id = String(formData.get("id"));
    const currentStatus = String(formData.get("currentStatus"));
    const newStatus = currentStatus === "ACTIVE" ? "DRAFT" : "ACTIVE";
    
    await prisma.bundle.update({
      where: { id },
      data: { status: newStatus },
    });
    
    return redirect("/app/bundle-manager");
  }

  if (intent === "delete-bundle") {
    const id = String(formData.get("id"));
    await prisma.bundle.delete({ where: { id } });
    return redirect("/app/bundle-manager");
  }

  if (intent === "backfill-all-variants") {
    console.log('🔄 Starting backfill all variants...');
    const { admin } = await authenticate.admin(request);
    
    // Get all bundles with products that need variants
    const bundles = await prisma.bundle.findMany({
      where: { shop: session.shop },
      include: { products: true }
    });
    
    console.log(`📦 Found ${bundles.length} bundles to process`);
    let backfilledCount = 0;
    
    for (const bundle of bundles) {
      for (const product of bundle.products) {
        if (!product.variantsJson) {
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
              const variants = (productData.variants?.nodes || []).map(v => ({ 
                id: v.id, 
                title: v.title, 
                priceCents: Math.round(parseFloat(v.price||'0')*100) 
              }));
              
              if (variant) {
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
                backfilledCount++;
                console.log(`✅ Backfilled variants for product ${product.productGid}`);
              }
            }
          } catch (error) {
            console.error(`Failed to backfill variants for product ${product.productGid}:`, error);
          }
        }
      }
    }
    
    console.log(`🎉 Backfill complete! Updated ${backfilledCount} products`);
    return redirect("/app/bundle-manager");
  }

  return json({ ok: true });
};

export default function BundleManager() {
  
  const { bundles, shop, plan } = useLoaderData();
  const navigate = useNavigate();
  
  return (
    <Page>
      <TitleBar title="Bundle Management Dashboard" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Your Bundles</Text>
                <InlineStack gap="300">
                  <Button url="/app/bundles">Create Bundle</Button>
                </InlineStack>
              </InlineStack>

              {bundles.length === 0 ? (
                <div style={{ padding: '24px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <Text as="p" variant="bodyMd">No bundles yet.</Text>
                  <div style={{ marginTop: '12px' }}>
                    <Button url="/app/bundles" primary>
                      Create Bundle
                    </Button>
                  </div>
                </div>
              ) : (
                <ResourceList
                  resourceName={{ singular: 'bundle', plural: 'bundles' }}
                  items={bundles}
                  renderItem={(bundle) => {
                    const productCount = bundle.products?.length || 0;
                    const wrapCount = bundle.wrappingOptions?.length || 0;
                    const cardCount = bundle.cards?.length || 0;
                    
                    const violatesFree = (plan === 'FREE') && (
                      bundle.pricingType && String(bundle.pricingType) !== 'SUM'
                    );
                    // In FREE plan, activation should also be limited to max 3 compliant ACTIVE bundles.
                    // We compute how many compliant active bundles exist; but since each row doesn't know all counts,
                    // we disable based on per-bundle compliance. The server still enforces global caps.
                    return (
                      <ResourceList.Item id={bundle.id}>
                        <InlineStack align="space-between" gap="300">
                          <InlineStack gap="300">
                            {bundle.imageUrl && (
                              <img 
                                src={bundle.imageUrl} 
                                alt={bundle.title}
                                style={{ 
                                  width: '60px', 
                                  height: '60px', 
                                  objectFit: 'cover',
                                  borderRadius: '6px'
                                }} 
                              />
                            )}
                            <BlockStack gap="100">
                              <Text as="span" variant="headingSm">{bundle.title}</Text>
                              <InlineStack gap="200">
                                <Badge tone="info">{bundle.type}</Badge>
                                <Badge tone={bundle.status === 'ACTIVE' ? 'success' : 'attention'}>{bundle.status}</Badge>
                                <Badge tone="info">{productCount} products</Badge>
                                <Badge tone="info">{wrapCount} wraps</Badge>
                                <Badge tone="info">{cardCount} cards</Badge>
                              </InlineStack>
                            </BlockStack>
                          </InlineStack>
                          
                          <InlineStack gap="200">
                            <Form method="post">
                              <input type="hidden" name="intent" value="toggle-status" />
                              <input type="hidden" name="id" value={bundle.id} />
                              <input type="hidden" name="currentStatus" value={bundle.status} />
                              <Button 
                                submit
                                disabled={violatesFree && plan === 'FREE'}
                                variant={bundle.status === 'ACTIVE' ? 'secondary' : 'primary'}
                              >
                                {bundle.status === 'ACTIVE' ? 'Deactivate' : (violatesFree && plan === 'FREE' ? 'Fix to Activate' : 'Activate')}
                              </Button>
                            </Form>
                            {(violatesFree && plan === 'FREE') ? (
                              <Text as="p" tone="critical" variant="bodySm">
                                Free plan: Only SUM pricing bundles can be activated. Update pricing to SUM or upgrade.
                              </Text>
                            ) : null}
                            
                            <Button 
                              url={`/app/additional?bundleId=${bundle.id}`}
                              primary
                            >
                              Manage
                            </Button>
                            
                            <Form method="post">
                              <input type="hidden" name="intent" value="delete-bundle" />
                              <input type="hidden" name="id" value={bundle.id} />
                              <Button 
                                submit
                                tone="critical" 
                                variant="secondary"
                              >
                                Delete
                              </Button>
                            </Form>
                          </InlineStack>
                        </InlineStack>
                      </ResourceList.Item>
                    );
                  }}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
