/**
 * Purpose: Minimal Admin GraphQL client using the shop's Admin token issued during OAuth.
 */
export type AdminRequest = {
  shop: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
};

export class AdminGraphQLError extends Error {
  public readonly status: number;
  public readonly errors?: { message: string; [key: string]: unknown }[];
  constructor(message: string, status: number, errors?: { message: string; [key: string]: unknown }[]) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export async function adminGraphQL<T = any>({ shop, accessToken, query, variables }: AdminRequest): Promise<T> {
  if (!shop || !accessToken) {
    throw new AdminGraphQLError("Missing shop or access token", 401);
  }
  const url = `https://${shop}/admin/api/2025-07/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new AdminGraphQLError("Unauthorized to Admin GraphQL. Refresh OAuth token.", res.status);
  }

  const json = await res.json().catch(() => ({}));
  const dataPart: unknown = (json && typeof json === "object" && (json as any).data) || {};
  const errorsPart: unknown = (json && typeof json === "object" && (json as any).errors) || undefined;

  if (Array.isArray(errorsPart) && errorsPart.length > 0) {
    const safeErrors = errorsPart.filter(e => e && typeof e === "object").map(e => ({ message: String((e as any).message || "GraphQL error") }));
    const msg = safeErrors.map(e => e.message).join(" | ");
    throw new AdminGraphQLError(msg, res.status, safeErrors);
  }

  return (dataPart || {}) as T;
}


