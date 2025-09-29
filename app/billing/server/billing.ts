/**
 * Purpose: Billing domain helpers
 */
import prisma from "../../db.server";
import { adminGraphQL } from "./graphql";

export type PlanConfig = {
  name: string;
  priceAmount: number;
  priceCurrencyCode: "USD" | "EUR" | "GBP" | "AUD" | "CAD";
  interval: "EVERY_30_DAYS" | "ANNUAL";
  trialDays?: number;
};

type AppSubscriptionCreateResp = {
  appSubscriptionCreate?: {
    userErrors?: { field?: string[]; message: string }[];
    confirmationUrl?: string | null;
    appSubscription?: { id?: string; status?: string | null; name?: string | null; trialEndsAt?: string | null } | null;
  };
};

type QueryAppSubscriptions = {
  currentAppInstallation?: {
    activeSubscriptions?: { id?: string; name?: string; status?: string }[];
  };
};

const cache = new Map<string, { ts: number; hasPro: boolean; raw: any }>();
const TTL_MS = 60_000;

// Test-only helper to reset cache
export function __clearBillingCacheForTests() {
  cache.clear();
}

export async function billingCheck(shop: string, accessToken: string): Promise<{ hasPro: boolean; raw: any }> {
  const key = `check:${shop}`;
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < TTL_MS) return { hasPro: cached.hasPro, raw: cached.raw };

  const QUERY = `
    query AppActiveSubs {
      currentAppInstallation {
        activeSubscriptions { id name status }
      }
    }
  `;
  const data = await adminGraphQL<QueryAppSubscriptions>({ shop, accessToken, query: QUERY });
  const subs = data.currentAppInstallation?.activeSubscriptions || [];
  const hasPro = subs.some(s => (s?.status || "").toUpperCase() === "ACTIVE");
  const payload = subs as any;
  cache.set(key, { ts: now, hasPro, raw: payload });
  return { hasPro, raw: payload };
}

export async function createOrReplaceSubscription(opts: {
  shop: string;
  accessToken: string;
  plan: PlanConfig;
  testMode: boolean;
  replacementBehavior?: "STANDARD" | "REPLACE";
}) {
  const cfg = await prisma.adminConfig.findUnique({ where: { id: "app-admin" } }).catch(() => null);
  const appHandle = process.env.SHOPIFY_APP_HANDLE || cfg?.appHandle || "bundle-app-235";
  const resolvedReturnUrl = `https://${opts.shop}/admin/apps/${appHandle}`;
  const { raw } = await billingCheck(opts.shop, opts.accessToken);
  const hasExisting = Array.isArray(raw) && raw.length > 0;

  const replacementBehavior = hasExisting ? "REPLACE" : "STANDARD";

  const MUTATION = `
    mutation AppSubscriptionCreate(
      $name: String!,
      $lineItems: [AppSubscriptionLineItemInput!]!,
      $trialDays: Int,
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name,
        lineItems: $lineItems,
        trialDays: $trialDays,
        returnUrl: "${resolvedReturnUrl}",
        test: $test
      ) {
        confirmationUrl
        userErrors { field message }
        appSubscription { id status name }
      }
    }
  `;

  const variables = {
    name: opts.plan.name,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: opts.plan.priceAmount, currencyCode: opts.plan.priceCurrencyCode },
            interval: opts.plan.interval,
          },
        },
      },
    ],
    trialDays: opts.plan.trialDays ?? 0,
    test: !!opts.testMode,
  };

  const data = await adminGraphQL<AppSubscriptionCreateResp>({
    shop: opts.shop,
    accessToken: opts.accessToken,
    query: MUTATION,
    variables,
  });

  const resp = data.appSubscriptionCreate || {};
  if (Array.isArray(resp.userErrors) && resp.userErrors.length) {
    const msg = resp.userErrors.map(e => e.message).join("; ");
    throw new Error(`Billing error: ${msg}`);
  }

  const sub = resp.appSubscription || null;
  await prisma.shopSubscription.upsert({
    where: { shop: opts.shop },
    update: {
      subscriptionId: (sub?.id as string) ?? null,
      status: (sub?.status as string) ?? "PENDING",
      planName: (sub?.name as string) ?? opts.plan.name,
      trialEndsAt: null,
      rawPayload: sub ? (sub as any) : {},
    },
    create: {
      shop: opts.shop,
      subscriptionId: (sub?.id as string) ?? null,
      status: (sub?.status as string) ?? "PENDING",
      planName: (sub?.name as string) ?? opts.plan.name,
      trialEndsAt: null,
      rawPayload: sub ? (sub as any) : {},
    },
  });

  return { confirmationUrl: String(resp.confirmationUrl || ""), replacementBehavior };
}


