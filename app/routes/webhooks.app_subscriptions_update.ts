import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import prisma from "../db.server";

function verifyHmac(headers: Headers, rawBody: string): boolean {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const hmac = headers.get("X-Shopify-Hmac-Sha256") || headers.get("x-shopify-hmac-sha256") || "";
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return Buffer.byteLength(hmac) > 0 && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest));
}

export async function action({ request }: ActionFunctionArgs) {
  const raw = await request.text();
  if (!verifyHmac(request.headers, raw)) {
    console.error("Webhook HMAC verification failed");
    return json({ ok: false }, { status: 401 });
  }

  try {
    const payload = JSON.parse(raw);
    const shop = request.headers.get("X-Shopify-Shop-Domain") || request.headers.get("x-shopify-shop-domain") || "";
    const appSub = payload?.app_subscription ?? payload;

    console.log(`Webhook received for shop: ${shop}, status: ${appSub?.status}`);

    // Update subscription record
    await prisma.shopSubscription.upsert({
      where: { shop },
      update: {
        subscriptionId: appSub?.admin_graphql_api_id ?? appSub?.id ?? null,
        status: appSub?.status || "UNKNOWN",
        planName: appSub?.name || null,
        trialEndsAt: appSub?.trial_ends_at ? new Date(appSub.trial_ends_at) : null,
        rawPayload: payload,
      },
      create: {
        shop,
        subscriptionId: appSub?.admin_graphql_api_id ?? appSub?.id ?? null,
        status: appSub?.status || "UNKNOWN",
        planName: appSub?.name || null,
        trialEndsAt: appSub?.trial_ends_at ? new Date(appSub.trial_ends_at) : null,
        rawPayload: payload,
      },
    });

    // Update shop plan based on subscription status
    const status = (appSub?.status || "").toUpperCase();
    const isActive = status === "ACTIVE";
    
    const newPlan = isActive ? "PRO" : "FREE";
    
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { plan: newPlan },
      create: { shop, plan: newPlan }
    });

    // Keep planName in sync when downgrading or upgrading
    await prisma.shopSubscription.update({
      where: { shop },
      data: { planName: isActive ? (appSub?.name || 'Pro Plan') : null }
    }).catch(() => {});

    console.log(`Updated shop ${shop} plan to: ${newPlan} (status: ${status})`);

    // If downgrading to FREE, enforce limits
    if (!isActive) {
      try {
        const allBundles = await prisma.bundle.findMany({
          where: { shop },
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, pricingType: true }
        });

        let kept = 0;
        const ops = [];
        
        for (const bundle of allBundles) {
          const isCompliant = String(bundle.pricingType) === 'SUM';
          const shouldKeepActive = isCompliant && kept < 3;
          
          if (shouldKeepActive) {
            kept += 1;
            continue;
          }
          
          if (bundle.status === 'ACTIVE') {
            ops.push(prisma.bundle.update({ 
              where: { id: bundle.id }, 
              data: { status: 'DRAFT' } 
            }));
          }
        }
        
        if (ops.length) {
          await prisma.$transaction(ops);
          console.log(`Downgraded ${ops.length} bundles to DRAFT for shop ${shop}`);
        }
      } catch (error) {
        console.error("Error enforcing FREE plan limits:", error);
      }
    }

    return json({ ok: true });
  } catch (e) {
    console.error("Webhook processing error:", e);
    return json({ ok: false }, { status: 500 });
  }
}

export const loader = () => json({ ok: false }, { status: 405 });


