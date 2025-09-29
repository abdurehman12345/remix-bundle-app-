import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { json } from "@remix-run/node";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: false,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

// Update AdminConfig on server start (best-effort)
(async () => {
  try {
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const webhooksVersion = (await import("../shopify.app.toml", { with: { type: "json" } }).catch(() => ({ default: {} }))).default?.webhooks?.api_version || process.env.SHOPIFY_WEBHOOKS_API_VERSION || "2025-07";
    const appHandle = process.env.SHOPIFY_APP_HANDLE || "";
    const envWhatsapp = process.env.APP_WHATSAPP_NUMBER || null;
    const envEmail = process.env.APP_CONTACT_EMAIL || null;
    // Read existing config so we don't overwrite DB values with env on every boot
    const existing = await prisma.adminConfig.findUnique({ where: { id: "app-admin" } }).catch(() => null);
    const whatsappNumber = existing?.whatsappNumber ?? envWhatsapp;
    const email = existing?.email ?? envEmail;
    await prisma.adminConfig.upsert({
      where: { id: "app-admin" },
      update: { appUrl, webhooksVersion, appHandle, whatsappNumber, email },
      create: { id: "app-admin", appUrl, webhooksVersion, appHandle, whatsappNumber, email },
    });
  } catch (_) {}
})();

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || "";

    // Fetch active bundles for the shop (adjust fields/filters as needed)
    const rows = await prisma.bundle.findMany({
      where: { shop, status: "ACTIVE" },
      include: { products: true, wrappingOptions: true, cards: true },
      orderBy: { createdAt: "desc" },
    });

    const bundles = rows.map(b => ({
      id: b.id,
      title: b.title,
      description: b.description || "",
      imageUrl: b.imageUrl || "",
      type: b.type || "FIXED",
      productCount: (b.products || []).length,
      wrapCount: (b.wrappingOptions || []).length,
      cardCount: (b.cards || []).length,
    }));

    return json({ bundles }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return json({ error: "Failed to load bundles" }, { status: 500 });
  }
}
