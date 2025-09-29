import { describe, it, expect, vi, beforeEach } from "vitest";
import { billingCheck, __clearBillingCacheForTests } from "../app/billing/server/billing";
import * as graphql from "../app/billing/server/graphql";

vi.spyOn(graphql, "adminGraphQL");

beforeEach(() => {
  vi.clearAllMocks();
  __clearBillingCacheForTests();
});

describe("billingCheck", () => {
  it("returns hasPro true when active subscription exists", async () => {
    (graphql.adminGraphQL as any).mockResolvedValue({
      currentAppInstallation: { activeSubscriptions: [{ id: "1", name: "Pro", status: "ACTIVE" }] }
    });
    const res = await billingCheck("test.myshopify.com", "token");
    expect(res.hasPro).toBe(true);
  });

  it("caches for 60s", async () => {
    (graphql.adminGraphQL as any).mockResolvedValueOnce({
      currentAppInstallation: { activeSubscriptions: [] }
    });
    __clearBillingCacheForTests();
    const res1 = await billingCheck("test.myshopify.com", "token");
    (graphql.adminGraphQL as any).mockResolvedValueOnce({
      currentAppInstallation: { activeSubscriptions: [{ id: "x", name: "Pro", status: "ACTIVE" }] }
    });
    const res2 = await billingCheck("test.myshopify.com", "token");
    expect((graphql.adminGraphQL as any).mock.calls.length).toBe(1);
    expect(res1.hasPro).toBe(false);
    expect(res2.hasPro).toBe(false);
  });
});


