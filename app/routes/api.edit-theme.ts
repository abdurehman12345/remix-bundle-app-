import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * POST /api/edit-theme
 * Edits the active theme's layout/theme.liquid to inject a global hide snippet
 * for products tagged hidden_addon or hidden_product.
 *
 * Idempotent: If the snippet exists, it won't be added again.
 */
export const loader = async () => json({ error: "Method not allowed" }, { status: 405 });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { admin } = await authenticate.admin(request);

    // 1) Find currently published (main) theme
    const themesResp: any = await admin.rest.get({ path: "themes" });
    const themes = themesResp?.body?.themes || [];
    const mainTheme = themes.find((t: any) => t.role === "main") || themes[0];
    if (!mainTheme) {
      return json({ ok: false, error: "No theme found" }, { status: 404 });
    }

    const themeId = mainTheme.id;

    // 2) Fetch layout/theme.liquid
    const assetResp: any = await admin.rest.get({
      path: `themes/${themeId}/assets`,
      query: { "asset[key]": "layout/theme.liquid" },
    });
    const content: string = assetResp?.body?.asset?.value || "";
    if (!content) {
      return json({ ok: false, error: "layout/theme.liquid not found or empty" }, { status: 404 });
    }

    const startMarker = "<!-- bundle-builder snippet start -->";
    const endMarker = "<!-- bundle-builder snippet end -->";

    // Idempotency: skip if already present
    if (content.includes(startMarker) && content.includes(endMarker)) {
      return json({ ok: true, themeId, message: "Snippet already present" });
    }

    // 3) Prepare snippet (EXACT Liquid requested)
    const snippet = `${startMarker}\n{% if product.tags contains 'hidden_addon' or product.tags contains 'hidden_product' %}\n  <style>\n    [data-product-id="{{ product.id }}"],\n    .product-card[data-product-id="{{ product.id }}"],\n    .grid__item[data-product-id="{{ product.id }}"],\n    .bundle-builder-block[data-product-id="{{ product.id }}"] {\n      display: none !important;\n    }\n  </style>\n{% endif %}\n${endMarker}`;

    // 4) Insert just before </body>, or append to end if not found
    const bodyCloseRegex = /<\s*\/\s*body\s*>/i;
    let newContent: string;
    if (bodyCloseRegex.test(content)) {
      newContent = content.replace(bodyCloseRegex, `${snippet}\n</body>`);
    } else {
      newContent = `${content}\n${snippet}`;
    }

    // 5) Write back asset
    await admin.rest.put({
      path: `themes/${themeId}/assets`,
      data: { asset: { key: "layout/theme.liquid", value: newContent } },
      type: "application/json",
    });

    return json({ ok: true, themeId });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Unknown error" }, { status: 500 });
  }
};


