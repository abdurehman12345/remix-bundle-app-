import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Text, Card, Button, BlockStack, List, InlineStack, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const admin = await prisma.adminConfig.findUnique({ where: { id: "app-admin" } }).catch(() => null);
  return {
    contact: {
      whatsappNumber: admin?.whatsappNumber || null,
      email: admin?.email || null,
    },
  };
};

export const action = async () => null;

export default function Index() {
  const { contact } = useLoaderData();
  const [open, setOpen] = useState({ s1: true, s2: false, s3: false, s4: false, s5: false });

  return (
    <Page title="Welcome to Bundle App" subtitle="Create product bundles that boost your sales">
      {!(contact.whatsappNumber || contact.email) ? (
        <Banner tone="warning" title="Support contacts not configured">
          <p>Set APP_WHATSAPP_NUMBER or APP_CONTACT_EMAIL to enable in-app support.</p>
        </Banner>
      ) : null}

      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <Text as="h2" variant="headingLg">🚀 Quick Setup Guide</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Follow these steps to get your bundle app running on your store in minutes.
              </Text>
              
              <BlockStack gap="400">
                <Card sectioned>
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingMd">Step 1: Create Your First Bundle</Text>
                    <Button size="slim" onClick={() => setOpen((o) => ({ ...o, s1: !o.s1 }))}>{open.s1 ? "▲" : "▼"}</Button>
                  </InlineStack>
                  {open.s1 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 1: Create Your First Bundle</Text>
                    <Text as="p" variant="bodyMd">
                      Start by creating a product bundle that customers can purchase together at a discount.
                    </Text>
                    <List type="number">
                      <List.Item>Click "Open Bundle Manager" below</List.Item>
                      <List.Item>Click "Create New Bundle"</List.Item>
                      <List.Item>Give your bundle a name (e.g., "Summer Essentials")</List.Item>
                      <List.Item>Add 2-6 products from your store</List.Item>
                      <List.Item>Set a discount (percentage or fixed amount)</List.Item>
                      <List.Item>Upload a bundle image (optional but recommended)</List.Item>
                      <List.Item>Click "Save & Activate"</List.Item>
                    </List>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      💡 <strong>Tip:</strong> Start with popular products that complement each other for best results.
                    </Text>
                    <Button url="/app/bundle-manager" variant="primary">Open Bundle Manager</Button>
                  </BlockStack>
                  )}
                </Card>

                <Card sectioned>
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingMd">Step 2: Customize in Theme Editor (Hero bar + Widget)</Text>
                    <Button size="slim" onClick={() => setOpen((o) => ({ ...o, s2: !o.s2 }))}>{open.s2 ? "▲" : "▼"}</Button>
                  </InlineStack>
                  {open.s2 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 2: Customize in Theme Editor (Hero bar + Widget)</Text>
                    <Text as="p" variant="bodyMd">
                      Use Shopify's Theme Editor to place and style the bundle hero bar and the bundle widget where you want them to appear.
                    </Text>
                    <List type="number">
                      <List.Item>In Shopify Admin, go to Online Store → Themes → Customize</List.Item>
                      <List.Item>Open the template where you want bundles (e.g., Product page)</List.Item>
                      <List.Item>Click “Add section” or “Add block” and search for <strong>Bundle Builder</strong></List.Item>
                      <List.Item>Add the <strong>Hero Bar</strong> block to show a promotional header for your bundles</List.Item>
                      <List.Item>Add the <strong>Bundle Widget</strong> block/section to display the actual bundle offers</List.Item>
                      <List.Item>Adjust colors, titles, layout, and visibility directly in the block settings</List.Item>
                      <List.Item>Save your theme changes</List.Item>
                    </List>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      🎨 <strong>Pro tip:</strong> Position the Hero Bar above content to draw attention, and place the Bundle Widget near the add-to-cart area for best conversions.
                    </Text>
                    <Button url="/app/pricing" variant="secondary">Pricing & Settings</Button>
                  </BlockStack>
                  )}
                </Card>

                <Card sectioned>
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingMd">Step 3: Add Widget to Your Store Pages</Text>
                    <Button size="slim" onClick={() => setOpen((o) => ({ ...o, s3: !o.s3 }))}>{open.s3 ? "▲" : "▼"}</Button>
                  </InlineStack>
                  {open.s3 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 3: Add Widget to Your Store Pages</Text>
                    <Text as="p" variant="bodyMd">
                      Install the widget on your product pages so customers can see and purchase bundles.
                    </Text>
                    <List type="number">
                      <List.Item>Go to your Shopify Admin → Online Store → Themes</List.Item>
                      <List.Item>Click "Customize" on your active theme</List.Item>
                      <List.Item>Navigate to a product page template</List.Item>
                      <List.Item>Add a new section and search for "Bundle Widget"</List.Item>
                      <List.Item>Position the widget where you want it (recommended: after product description)</List.Item>
                      <List.Item>Save and publish your changes</List.Item>
                    </List>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      📍 <strong>Best placement:</strong> Add to high-traffic product pages for maximum visibility and sales.
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      🔧 <strong>Need help?</strong> Contact our support team if you need assistance with theme integration.
                    </Text>
                  </BlockStack>
                  )}
                </Card>

                <Card sectioned>
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingMd">Step 4: Test Your Setup</Text>
                    <Button size="slim" onClick={() => setOpen((o) => ({ ...o, s4: !o.s4 }))}>{open.s4 ? "▲" : "▼"}</Button>
                  </InlineStack>
                  {open.s4 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 4: Test Your Setup</Text>
                    <Text as="p" variant="bodyMd">
                      Make sure everything works correctly before going live.
                    </Text>
                    <List type="number">
                      <List.Item>Visit your store's product pages</List.Item>
                      <List.Item>Check that the bundle widget appears</List.Item>
                      <List.Item>Test adding a bundle to cart</List.Item>
                      <List.Item>Verify the discount is applied correctly</List.Item>
                      <List.Item>Complete a test purchase (you can cancel the order)</List.Item>
                    </List>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      ✅ <strong>Success indicators:</strong> Widget displays, bundles add to cart, discounts apply automatically.
                    </Text>
                  </BlockStack>
                  )}
                </Card>

                <Card sectioned>
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingMd">Step 5: Upgrade to Pro (Optional)</Text>
                    <Button size="slim" onClick={() => setOpen((o) => ({ ...o, s5: !o.s5 }))}>{open.s5 ? "▲" : "▼"}</Button>
                  </InlineStack>
                  {open.s5 && (
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Step 5: Upgrade to Pro (Optional)</Text>
                    <Text as="p" variant="bodyMd">
                      Unlock advanced features to maximize your bundle sales potential.
                    </Text>
                    <List type="number">
                      <List.Item>Go to "Pricing & Settings"</List.Item>
                      <List.Item>Click "Subscribe to Pro" (7-day free trial)</List.Item>
                      <List.Item>Complete the payment setup</List.Item>
                      <List.Item>Access unlimited bundles and advanced features</List.Item>
                    </List>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      🚀 <strong>Pro features:</strong> Unlimited bundles, tiered pricing, gift wrapping, 3D carousel, custom themes, and analytics.
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      🎁 <strong>Free trial:</strong> Try Pro free for 7 days with no commitment. Cancel anytime.
                    </Text>
                    <Button url="/app/pricing" variant="primary">View Pro Features</Button>
                  </BlockStack>
                  )}
                </Card>
              </BlockStack>

              <Card sectioned>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">🔧 Troubleshooting</Text>
                  <Text as="p" variant="bodyMd">
                    Common issues and quick solutions to get you back on track.
                  </Text>
                  <List type="bullet">
                    <List.Item><strong>Widget not showing:</strong> Make sure you've added the Bundle Widget section to your theme and published changes</List.Item>
                    <List.Item><strong>Bundles not appearing:</strong> Check that your bundles are active and contain products that are in stock</List.Item>
                    <List.Item><strong>Discount not applying:</strong> Verify your bundle pricing rules are set correctly in Bundle Manager</List.Item>
                    <List.Item><strong>Theme compatibility:</strong> Some themes may need manual integration - contact support for assistance</List.Item>
                  </List>
                </BlockStack>
              </Card>

              <Card sectioned>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">📚 Need Help?</Text>
                  <Text as="p" variant="bodyMd">
                    Our support team is here to help you succeed. Get assistance with setup, customization, or any questions you have.
                  </Text>
                  <InlineStack gap="300">
                    <Button url="/app/support" variant="tertiary">Contact Support</Button>
                    <Button url="/app/bundles" variant="plain">View All Bundles</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
