import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: async () => ({ session: { shop: "test.myshopify.com" } }) },
}));

vi.mock("../app/db.server", () => ({
  default: {
    session: { findFirst: vi.fn() },
    shopSubscription: { upsert: vi.fn() },
  },
}));

vi.mock("../app/billing/server/graphql", () => ({
  adminGraphQL: vi.fn(),
}));

process.env.SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || "https://example.test";

const { default: prisma } = await import("../app/db.server");
const { adminGraphQL } = await import("../app/billing/server/graphql");
const { action: createAction } = await import("../app/routes/billing.create-subscription");

function makeRequest(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return new Request("https://app.test/billing/create-subscription", { method: "POST", body });
}

describe("create-subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.session.findFirst as any).mockResolvedValue({ accessToken: "admintoken", shop: "test.myshopify.com" });
    (prisma.shopSubscription.upsert as any).mockResolvedValue({});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("redirects to confirmationUrl on success", async () => {
    (adminGraphQL as any).mockImplementation(({ query }: any) => {
      if (String(query).includes("activeSubscriptions")) {
        return Promise.resolve({ currentAppInstallation: { activeSubscriptions: [] } });
      }
      return Promise.resolve({
        appSubscriptionCreate: {
          userErrors: [],
          confirmationUrl: "https://confirm.example",
          appSubscription: { id: "gid://shopify/AppSubscription/1", status: "PENDING", name: "Pro Plan", trialEndsAt: null }
        }
      });
    });
    const res = await createAction({ request: makeRequest({ plan: "Pro" }) } as any);
    expect((res as Response).headers.get("Location")).toContain("https://confirm.example");
  });

  it("throws on GraphQL userErrors", async () => {
    (adminGraphQL as any).mockImplementation(({ query }: any) => {
      if (String(query).includes("activeSubscriptions")) {
        return Promise.resolve({ currentAppInstallation: { activeSubscriptions: [] } });
      }
      return Promise.resolve({ appSubscriptionCreate: { userErrors: [{ message: "Plan invalid" }], confirmationUrl: null, appSubscription: { id: "gid://shopify/AppSubscription/err", status: null, name: null, trialEndsAt: null } } });
    });
    try {
      await createAction({ request: makeRequest({ plan: "Pro" }) } as any);
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(String(e.message)).toMatch(/Plan invalid/);
    }
  });
});


