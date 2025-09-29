import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.webhook(request);
    // Ensure orders/create webhook is registered
    await admin.rest.resources.Webhook.create({
      body: {
        webhook: {
          topic: 'orders/create',
          address: `${process.env.SHOPIFY_APP_URL || ''}/webhooks/orders_create`,
          format: 'json'
        }
      }
    });
  } catch (_){ }
  return json({ ok: true });
};
