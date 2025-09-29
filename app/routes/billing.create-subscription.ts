import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createOrReplaceSubscription } from "../billing/server/billing";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const planName = String(form.get("plan") || "Pro");
  const trialDays = Number(form.get("trialDays") || 0);
  const replace = String(form.get("replace") || "auto");
  const testMode = process.env.NODE_ENV !== "production" || process.env.SHOPIFY_BILLING_TEST === "true";

  const plan = {
    name: planName === "Pro" ? "Pro Plan" : planName,
    priceAmount: 9.99,
    priceCurrencyCode: "USD" as const,
    interval: "EVERY_30_DAYS" as const,
    trialDays,
  };

  const shopSession = await prisma.session.findFirst({ where: { shop }, orderBy: { expires: "desc" } });
  if (!shopSession?.accessToken) {
    return json({ error: "Missing admin access token. Reinstall app." }, { status: 401 });
  }

  const replacementBehavior = replace === "replace" ? "REPLACE" : replace === "standard" ? "STANDARD" : undefined;

  let confirmationUrl: string | null = null;
  try {
    const res = await createOrReplaceSubscription({
      shop,
      accessToken: shopSession.accessToken,
      plan,
      testMode,
      replacementBehavior,
    });
    confirmationUrl = res.confirmationUrl || null;
  } catch (e: any) {
    const msg = String(e?.message || "");
    // Graceful fallback for custom/private apps where Billing API is not allowed
    if (msg.includes("Apps without a public distribution cannot use the Billing API")) {
      await prisma.shopSubscription.upsert({
        where: { shop },
        update: { subscriptionId: null, status: "ACTIVE", planName: plan.name, trialEndsAt: null, rawPayload: { simulated: true } },
        create: { shop, subscriptionId: null, status: "ACTIVE", planName: plan.name, trialEndsAt: null, rawPayload: { simulated: true } },
      });
      await prisma.shopSettings.update({ where: { shop }, data: { plan: "PRO" } }).catch(() => {});
      confirmationUrl = null;
    } else {
      throw e;
    }
  }

  // If the client expects JSON (fetcher/ajax), or has ?json=1 flag, return the URL instead of redirecting
  const urlObj = new URL(request.url);
  const wantsJson = (request.headers.get("Accept") || "").includes("application/json") || urlObj.searchParams.get("json") === "1";
  if (wantsJson) {
    return json({ confirmationUrl });
  }
  if (confirmationUrl) return redirect(confirmationUrl);
  return redirect("/app/settings/billing");
}

export const loader = () => json({ ok: false }, { status: 405 });


