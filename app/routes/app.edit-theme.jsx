import { useFetcher } from "@remix-run/react";
import { Page, Layout, Card, Button, Text, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function EditThemePage() {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data;

  return (
    <Page title="Edit Theme (Hide Hidden Add-ons)">
      <TitleBar title="Edit Theme" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p">This will inject a Liquid snippet into layout/theme.liquid to hide all products tagged hidden_addon or hidden_product across the theme. Safe and idempotent.</Text>
              <fetcher.Form method="post" action="/api/edit-theme">
                <Button variant="primary" submit disabled={isSubmitting}>
                  {isSubmitting ? "Running..." : "Inject Snippet"}
                </Button>
              </fetcher.Form>
              {result && (
                <Text as="p" variant="bodyMd">
                  {result.ok ? `Done. Theme ID: ${result.themeId || "unknown"}` : `Error: ${result.error || "Unknown error"}`}
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


