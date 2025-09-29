import { json } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import { Page, Card, Layout, Text, Button, InlineStack, BlockStack, Badge } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: { request: Request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const sub = await prisma.shopSubscription.findUnique({ where: { shop } }).catch(() => null);
  const settings = await prisma.shopSettings.findUnique({ where: { shop } }).catch(() => null);
  return json({
    shop,
    planSetting: settings?.plan || "FREE",
    subscription: sub ? {
      id: sub.subscriptionId,
      status: sub.status,
      planName: sub.planName,
      trialEndsAt: sub.trialEndsAt?.toISOString() || null,
      updatedAt: sub.updatedAt.toISOString(),
    } : null
  });
}

export default function BillingSettings() {
  const data = useLoaderData<typeof loader>();
  const active = data.subscription?.status === "ACTIVE";
  return (
    <Page title="Billing">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Status</Text>
              <InlineStack gap="200">
                <Badge tone={active ? "success" : "attention"}>{active ? "Pro (active)" : "Free"}</Badge>
                {data.subscription?.trialEndsAt ? (
                  <Text as="span" tone="subdued">Trial ends {new Date(data.subscription.trialEndsAt).toLocaleDateString()}</Text>
                ) : null}
              </InlineStack>
              {!active ? (
                <Form method="post" action="/billing/create-subscription">
                  <input type="hidden" name="plan" value="Pro" />
                  <input type="hidden" name="trialDays" value="7" />
                  <Button submit variant="primary">Subscribe to Pro</Button>
                </Form>
              ) : (
                <Text as="p" tone="subdued">Your subscription is active.</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Free</Text>
              <Text as="p">Core features, up to 3 bundles.</Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Pro</Text>
              <Text as="p">Unlimited bundles, advanced features.</Text>
              <Form method="post" action="/billing/create-subscription">
                <input type="hidden" name="plan" value="Pro" />
                <input type="hidden" name="trialDays" value="7" />
                <Button submit variant="primary">Upgrade</Button>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


