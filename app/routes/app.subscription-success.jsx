import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Page, Layout, Card, Text, Button, BlockStack, InlineStack, Badge } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  
  // Get the latest subscription status
  const subscription = await prisma.shopSubscription.findUnique({
    where: { shop }
  });
  
  const settings = await prisma.shopSettings.findUnique({
    where: { shop }
  });
  
  return json({
    shop,
    subscription,
    plan: settings?.plan || "FREE"
  });
}

export default function SubscriptionSuccess() {
  const { subscription, plan } = useLoaderData();
  const isActive = subscription?.status === "ACTIVE";
  
  return (
    <Page title="Subscription Status">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingLg">Subscription Status</Text>
                <Badge tone={isActive ? "success" : "attention"}>
                  {isActive ? "Active" : subscription?.status || "Unknown"}
                </Badge>
              </InlineStack>
              
              {subscription && (
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    <strong>Plan:</strong> {subscription.planName || "Unknown"}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    <strong>Status:</strong> {subscription.status || "Unknown"}
                  </Text>
                  {subscription.trialEndsAt && (
                    <Text as="p" variant="bodyMd">
                      <strong>Trial ends:</strong> {new Date(subscription.trialEndsAt).toLocaleDateString()}
                    </Text>
                  )}
                </BlockStack>
              )}
              
              <InlineStack gap="200">
                <Link to="/app/pricing">
                  <Button>View Pricing</Button>
                </Link>
                <Link to="/app/settings/billing">
                  <Button variant="primary">Billing Settings</Button>
                </Link>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
