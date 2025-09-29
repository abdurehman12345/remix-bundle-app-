import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { adminGraphQL } from "../billing/server/graphql";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    // Get current subscription
    const subscription = await prisma.shopSubscription.findUnique({
      where: { shop }
    });

    if (!subscription?.subscriptionId) {
      return json({ error: "No active subscription found" }, { status: 404 });
    }

    // Get access token
    const shopSession = await prisma.session.findFirst({ 
      where: { shop }, 
      orderBy: { expires: "desc" } 
    });
    
    if (!shopSession?.accessToken) {
      return json({ error: "Missing admin access token" }, { status: 401 });
    }

    // Cancel subscription via GraphQL
    const MUTATION = `
      mutation AppSubscriptionCancel($id: ID!) {
        appSubscriptionCancel(id: $id) {
          appSubscription {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const data = await adminGraphQL({
      shop,
      accessToken: shopSession.accessToken,
      query: MUTATION,
      variables: { id: subscription.subscriptionId }
    });

    const result = data.appSubscriptionCancel || {};
    
    if (result.userErrors?.length) {
      const msg = result.userErrors.map((e: any) => e.message).join("; ");
      return json({ error: `Cancel failed: ${msg}` }, { status: 400 });
    }

    // Update local database
    await prisma.shopSubscription.update({
      where: { shop },
      data: {
        status: "CANCELLED",
        rawPayload: { ...subscription.rawPayload, cancelled: true }
      }
    });

    // Downgrade to FREE plan
    await prisma.shopSettings.update({
      where: { shop },
      data: { plan: "FREE" }
    });

    // Enforce FREE plan limits
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
      
      if (ops.length) await prisma.$transaction(ops);
    } catch (_) {
      // Best effort, non-fatal
    }

    return json({ success: true, message: "Subscription cancelled successfully" });
    
  } catch (error: any) {
    console.error("Cancel subscription error:", error);
    return json({ error: "Failed to cancel subscription" }, { status: 500 });
  }
}

export const loader = () => json({ ok: false }, { status: 405 });
