import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, Text, Button, BlockStack, InlineStack, Badge, List, Banner } from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session?.shop;

  // Defensive: if a subscription is ACTIVE, ensure ShopSettings.plan is PRO
  try {
    const sub = await prisma.shopSubscription.findUnique({ where: { shop } });
    if (sub && String(sub.status || '').toUpperCase() === 'ACTIVE') {
      await prisma.shopSettings.upsert({
        where: { shop },
        update: { plan: 'PRO' },
        create: { shop, plan: 'PRO' }
      });
    }
    // Fallback: verify with Admin GraphQL in case webhook hasn't fired yet
    try {
      const q = `#graphql\nquery { appInstallation { activeSubscriptions { name status } } }`;
      const resp = await admin.graphql(q);
      if (resp?.ok) {
        const data = await resp.json();
        const active = Array.isArray(data?.data?.appInstallation?.activeSubscriptions)
          ? data.data.appInstallation.activeSubscriptions
          : [];
        const hasActive = active.some(s => String(s?.status || '').toUpperCase() === 'ACTIVE');
        if (hasActive) {
          await prisma.shopSettings.upsert({
            where: { shop },
            update: { plan: 'PRO' },
            create: { shop, plan: 'PRO' }
          });
          await prisma.shopSubscription.upsert({
            where: { shop },
            update: { status: 'ACTIVE', planName: 'Pro Plan' },
            create: { shop, status: 'ACTIVE', planName: 'Pro Plan', subscriptionId: null, trialEndsAt: null }
          });
        } else {
          await prisma.shopSettings.upsert({
            where: { shop },
            update: { plan: 'FREE' },
            create: { shop, plan: 'FREE' }
          });
          await prisma.shopSubscription.upsert({
            where: { shop },
            update: { status: 'CANCELLED', planName: null },
            create: { shop, status: 'CANCELLED', planName: null, subscriptionId: null, trialEndsAt: null }
          });
        }
      }
    } catch (_) {}
  } catch (_) {}

  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) settings = await prisma.shopSettings.create({ data: { shop } });
  return json({ plan: settings.plan, settings });
};

export const action = async ({ request }) => {
  const form = await request.formData();
  const { session } = await authenticate.admin(request);
  const shop = session?.shop;
  const intent = String(form.get("intent") || "plan");
  if (intent === 'plan') {
    const target = form.get("plan");
    if (!shop || (target !== "FREE" && target !== "PRO")) return json({ ok:false }, { status: 400 });
    await prisma.shopSettings.upsert({ where: { shop }, update: { plan: target }, create: { shop, plan: target } });

    // When downgrading to FREE, enforce Free plan limits by disabling extras
    if (target === 'FREE') {
      try {
        const all = await prisma.bundle.findMany({
          where: { shop },
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, pricingType: true }
        });
        // Keep at most 3 ACTIVE bundles that comply with FREE rules (pricingType === 'SUM')
        let kept = 0;
        const ops = [];
        for (const b of all) {
          const isCompliant = String(b.pricingType) === 'SUM';
          const shouldKeepActive = isCompliant && kept < 3;
          if (shouldKeepActive) {
            kept += 1;
            // If it was not ACTIVE, do not automatically activate it; just keep as-is
            continue;
          }
          // Disable any extra or non-compliant ACTIVE bundle
          if (b.status === 'ACTIVE') {
            ops.push(prisma.bundle.update({ where: { id: b.id }, data: { status: 'DRAFT' } }));
          }
        }
        if (ops.length) await prisma.$transaction(ops);
      } catch (_) {
        // best-effort, non-fatal
      }
    }
    return json({ ok:true });
  }
  if (intent === 'hero') {
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    if (!settings || settings.plan !== 'PRO') return json({ ok:false, error: 'Upgrade to Pro to customize the hero.' }, { status: 403 });
    await prisma.shopSettings.update({ where: { shop }, data: {
      heroEnabled: form.get('heroEnabled') === 'on',
      heroTitle: String(form.get('heroTitle') || ''),
      heroSubtitle: String(form.get('heroSubtitle') || ''),
      heroEmoji: String(form.get('heroEmoji') || ''),
      heroColorStart: String(form.get('heroColorStart') || ''),
      heroColorEnd: String(form.get('heroColorEnd') || ''),
    }});
    return json({ ok:true });
  }
  return json({ ok:false }, { status: 400 });
};

export default function Pricing() {
  const { plan, settings } = useLoaderData();
  const fetcher = useFetcher();
  const app = useAppBridge();

  useEffect(() => {
    const url = fetcher.data?.confirmationUrl;
    if (!url) return;
    try {
      const redirect = Redirect.create(app);
      redirect.dispatch(Redirect.Action.REMOTE, url);
    } catch (_) {
      // Fallback
      if (typeof window !== 'undefined') window.top.location.href = url;
    }
  }, [fetcher.data, app]);

  return (
    <Page title="Pricing & Settings" subtitle="Upgrade to unlock advanced features">
      <Layout>
        <Layout.Section>
          <Banner title="7-day free trial" tone="success">
            <p>Try Pro free for 7 days. You can cancel anytime from this page.</p>
          </Banner>
        </Layout.Section>
        <Layout.Section oneHalf>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingLg">Free</Text>
                {plan === 'FREE' ? <Badge tone="success">Current plan</Badge> : null}
              </InlineStack>
              <Text as="p" variant="bodyMd">Core bundle features for small catalogs.</Text>
              <List type="bullet">
                <List.Item>Up to 3 bundles</List.Item>
                <List.Item>Up to 6 products per bundle</List.Item>
                <List.Item>Single discount (fixed or percent)</List.Item>
                <List.Item>Static hero header, default style</List.Item>
              </List>
              <form method="post">
                <input type="hidden" name="intent" value="plan" />
                <input type="hidden" name="plan" value="FREE" />
                <Button submit disabled={plan === 'FREE'}>Switch to Free</Button>
              </form>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section oneHalf>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingLg">Pro</Text>
                {plan === 'PRO' ? <Badge tone="success">Current plan</Badge> : <Badge tone="new">Popular</Badge>}
              </InlineStack>
              <Text as="p" variant="bodyMd">Advanced merchandising, customization, and analytics for growing stores.</Text>
              <List type="bullet">
                <List.Item>Unlimited bundles & products</List.Item>
                <List.Item>Tiered pricing rules</List.Item>
                <List.Item>Gift wrap & gift card add-ons</List.Item>
                <List.Item>3D carousel styles, themes, and color customization</List.Item>
                <List.Item>Hero bar editor (live preview in Theme Editor)</List.Item>
                <List.Item>Hide Shopify products from storefront (GID-based) while staying purchasable in bundles/cart</List.Item>
              </List>
              {plan === 'PRO' ? (
                <BlockStack gap="200">
                  <Text tone="subdued">Your subscription is active.</Text>
                  <fetcher.Form method="post" action="/billing/cancel-subscription">
                    <Button submit variant="tertiary" tone="critical">Cancel Subscription</Button>
                  </fetcher.Form>
                </BlockStack>
              ) : (
                <fetcher.Form method="post" action="/billing/create-subscription?json=1">
                  <input type="hidden" name="plan" value="Pro" />
                  <input type="hidden" name="trialDays" value="7" />
                  <Button submit primary>Subscribe to Pro</Button>
                </fetcher.Form>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {null}
      </Layout>
    </Page>
  );
}


