## Billing (Shopify AppSubscriptionCreate)

This app implements Shopify-managed billing using Admin GraphQL.

### Environment variables
- `SHOPIFY_API_KEY` – from Partner Dashboard
- `SHOPIFY_API_SECRET` – from Partner Dashboard
- `SHOPIFY_SCOPES` – include the app scopes you already use
- `SHOPIFY_BILLING_TEST` – set `true` in dev to use test charges
- `SHOPIFY_APP_URL` – your public app URL
- `DATABASE_URL` – Prisma connection string

### DB migration
```
npx prisma migrate dev --name add_shop_subscription
```

### Routes added
- `POST /billing/create-subscription` – creates subscription and redirects to `confirmationUrl`
- `POST /webhooks/app_subscriptions_update` – updates local subscription record (HMAC verified)
- `POST /webhooks/app_uninstalled` – locks features and clears subscription
- `GET /app/settings/billing` – simple admin UI to start subscription

### Webhooks
Subscribe to:
- `APP_SUBSCRIPTIONS_UPDATE`
- `APP_UNINSTALLED`

Set delivery URLs to the endpoints above. Ensure your app URL matches `SHOPIFY_APP_URL`.

### Test locally
1. Set `SHOPIFY_BILLING_TEST=true` in `.env`.
2. Install on a dev store.
3. Visit `/app/settings/billing` and click Subscribe.
4. Approve the test charge in Shopify; the webhook will mark the subscription `ACTIVE`.

### Gating features
Use `billingCheck(shop, token)` from `app/billing/server/billing.ts` in loaders to verify Pro status.

### Upgrade/downgrade
`createOrReplaceSubscription` chooses `REPLACE` when an active subscription exists, so switching plans is atomic.

### Tests
Run unit tests:
```
npx vitest
```

Bundle App – Shopify Extension

Overview
This repository contains a Shopify app built with Remix and a theme app extension named `bundle-builder`. It renders bundle listings and a detailed bundle builder on Online Store pages, with gift wrap, card options, and personalized messages. The app is CSP-compliant (no inline scripts/eval) and supports variant-aware pricing.

Key Features
- Bundle listing carousel and bundle detail builder.
- Per-product variant dropdowns with price deltas reflected in totals.
- Optional gift wrap and card add-ons, plus personalized message with fee.
- Robust data sourcing for variants: database `variantsJson`, Shopify Admin REST/GraphQL fallbacks.
- CSP-safe extension (no inline JS; `defer` scripts; no eval or string timers).

Project Structure
- `app/`: Remix server/app routes (e.g., `routes/apps.$bundleId.jsx`).
- `extensions/bundle-builder/`: Theme app extension assets and blocks.
  - `blocks/bundle-builder.liquid`: Section that mounts the builder.
  - `blocks/app-embed.liquid`: App embed for hiding hidden add-ons; uses data-* config.
  - `assets/bundle.js`: Main storefront JS (error handling, slider, builder UI).
  - `assets/bundle.css`: Styling.
  - `assets/hide-hidden-addons.js`: Hides products tagged as hidden add-ons.
  - `assets/config.js`: Static config for app proxy base.
- `prisma/`: Prisma schema and migrations.
- `public/uploads/`: Uploaded images used in bundles.

Local Development
1) Install dependencies:
   npm install

2) Set environment variables (SHOPIFY_APP_URL, database, etc.).

3) Run database migrations:
   npm run setup

4) Start the app with Shopify CLI:
   npm run shopify:dev

5) Alternatively, start Vite/Remix directly for local server:
   npm run dev

Important Routes
- App proxy storefront data and actions:
  - GET `/apps/bundles/:bundleId` – returns bundle detail, products, variants, images.
  - POST `/apps/bundles/:bundleId` – prepares cart, returns purchasable variant for checkout.

CSP Compliance Notes
- No inline scripts in Liquid blocks; configuration is passed via data attributes.
- No `eval`, `new Function`, or string-based timers.
- Source maps should not rely on eval.

Variant Handling
- Server (`app/routes/apps.$bundleId.jsx`) normalizes `product.variants` from:
  1) `variantsJson` in DB if present
  2) Admin REST/GraphQL enrichment
  3) Synthesized default from base `variantGid` when all else fails
- Client (`extensions/.../bundle.js`) falls back to `variantsJson` if the array is missing.

Common Tasks
- Update extension assets: edit files under `extensions/bundle-builder/assets` and redeploy with Shopify CLI.
- Update server logic: modify `app/routes/apps.$bundleId.jsx`.

Housekeeping
- Test/dev-only files have been removed to keep the repo clean. If you need historical helpers, retrieve them from git history.

License
Proprietary – for the Store Revive project use only.


