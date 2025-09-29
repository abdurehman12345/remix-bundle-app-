import { it, expect, vi, beforeAll } from "vitest";
import crypto from "crypto";
import { action as subAction } from "../app/routes/webhooks.app_subscriptions_update";
vi.mock("../app/shopify.server", () => ({ authenticate: { admin: async () => ({}) } }));
import prisma from "../app/db.server";

vi.mock("../app/db.server", () => ({
  default: {
    shopSubscription: { upsert: vi.fn() },
    shopSettings: { update: vi.fn() },
  },
}));

function sign(body: string) {
  const secret = process.env.SHOPIFY_API_SECRET || "shhhhh";
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "shhhhh";
});

it("accepts valid webhook", async () => {
  (prisma.shopSubscription.upsert as any).mockResolvedValue({});
  (prisma.shopSettings.update as any).mockResolvedValue({});
  const body = JSON.stringify({ app_subscription: { id: 1, status: "ACTIVE", name: "Pro" } });
  const req = new Request("https://app.test/webhooks/app_subscriptions_update", {
    method: "POST",
    body,
    headers: { "X-Shopify-Hmac-Sha256": sign(body), "X-Shopify-Shop-Domain": "test.myshopify.com" },
  });
  const res = await subAction({ request: req } as any);
  expect(res.status).toBe(200);
});


