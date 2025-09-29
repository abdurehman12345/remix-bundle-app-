## Gift Services Fee - Cart Transform Function

Purpose: Adds a priced app line at checkout for gift wrap and card charges using `cart.attributes.additional_charges_cents` set by the bundle builder.

How it works:
- Reads `additional_charges_cents` and optional `gift_wrap_name`, `gift_card_name` from the cart attributes.
- When the value is > 0, inserts one app-priced line titled "Gift services (wrap + card)".
- This ensures checkout totals collect the wrap/card fee without creating Shopify products.

Deploy steps (once Shopify CLI is authenticated):
1. Install dependencies in this extension folder:
   - `cd extensions/gift-services-fee`
   - `npm install`
2. Build and deploy the app:
   - `cd ../../`
   - `shopify app deploy`
3. Connect and enable the function in your store if prompted:
   - `shopify app function connect`
4. Test:
   - Add a bundle with wrap/card that sets `additional_charges_cents`.
   - Open cart and proceed to checkout; an extra line should appear with the fee.

Notes:
- The storefront UI (`cart-total-updater.js` and `cart-additional-charges.liquid`) still shows a clear breakdown.
- The function will run on every cart recalculation to keep the fee line in sync.


