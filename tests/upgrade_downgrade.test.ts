import { it, expect, vi, beforeAll } from "vitest";
import { createOrReplaceSubscription } from "../app/billing/server/billing";
import * as graphql from "../app/billing/server/graphql";
import prisma from "../app/db.server";

vi.spyOn(graphql, "adminGraphQL");
vi.mock("../app/db.server", () => ({
  default: {
    shopSubscription: { upsert: vi.fn() },
  },
}));

beforeAll(() => {
  process.env.SHOPIFY_APP_URL = "https://example.test";
});

it("uses REPLACE when existing active subscription", async () => {
  (graphql.adminGraphQL as any)
    .mockResolvedValueOnce({ currentAppInstallation: { activeSubscriptions: [{ id: "1", status: "ACTIVE", name: "Pro" }] } })
    .mockResolvedValueOnce({ appSubscriptionCreate: { userErrors: [], confirmationUrl: "https://confirm", appSubscription: { id: "gid/1", status: "PENDING", name: "Pro", trialEndsAt: null } } });

  const res = await createOrReplaceSubscription({
    shop: "test.myshopify.com",
    accessToken: "token",
    testMode: true,
    plan: { name: "Pro Plan", priceAmount: 9.99, priceCurrencyCode: "USD", interval: "EVERY_30_DAYS" },
  });
  expect(res.confirmationUrl).toContain("https://confirm");
});


