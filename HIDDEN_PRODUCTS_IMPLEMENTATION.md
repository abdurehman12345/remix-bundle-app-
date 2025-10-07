# Hidden Products Implementation - Zero Flash Solution

## Overview

This implementation provides **server-side filtering** combined with **client-side fallback** to ensure hidden products never appear on the storefront, eliminating the "flash of unstyled content" (FOUC) issue.

## Architecture

### 1. Server-Side Filtering (Primary Defense)

**Routes with Server-Side Filtering:**
- `/api/products` - Product search and collection endpoints
- `/apps/$bundleId` - Individual bundle product fetching
- `/apps/hidden-products` - Returns list of hidden product handles

**How it works:**
1. App proxy routes fetch hidden product handles using `getHiddenHandlesForShop()`
2. Products are filtered server-side before being returned to the client
3. Hidden products never reach the browser, eliminating flash

### 2. Client-Side Fallback (Safety Net)

**App Embed (`app-embed.liquid`):**
- CSS pre-hide rules for immediate visual blocking
- Inline JavaScript for synchronous DOM removal
- Dynamic CSS injection based on fetched hidden handles
- MutationObserver for dynamic content
- Deferred external script as final fallback

## Implementation Details

### Server-Side Filtering

```javascript
// In app/routes/api.products.jsx
const hiddenHandles = await getHiddenHandlesForShop(shop, session.accessToken);
const visibleProducts = products.filter(p => {
  const handle = p.id.split('/').pop();
  return !hiddenHandles.has(handle);
});
```

### Client-Side Pre-Hiding

```liquid
<!-- CSS pre-hide guard -->
<style id="bb-hide-prepaint">
[data-product-tags*="hidden_addon"],
[data-product-tags*="hidden-product"],
[data-product-tags*="bundle-addon"] {
  display: none !important;
  visibility: hidden !important;
}
</style>

<!-- Inline synchronous removal -->
<script>
(function(){
  // Immediate DOM pass to remove hidden products
  hidePrepaintNodes(document);
  
  // Fetch hidden handles and inject CSS
  preloadHiddenHandles().then(() => {
    hideNodesByHandleSet();
  });
  
  // Watch for dynamic content
  installMutationObserver();
})();
</script>
```

## Tag Configuration

**Default Hidden Tags:**
- `hidden_addon`
- `hidden-product` 
- `hidden_product`
- `bundle-addon`
- `bundle_addon`

**Custom Tags:**
Merchants can add custom tags via Theme Customizer in the app embed settings.

## Exception Handling

**Products are NOT hidden in:**
- Cart pages (`template contains 'cart'`)
- Bundle components (`.bb__bundle-card`, `.bb__bundle-wraps`)
- App proxy routes (`request.path contains '/apps/'`)

## Performance Optimizations

1. **Server-Side Caching:** Hidden handles cached for 5 minutes
2. **CSS Pre-Hiding:** Immediate visual blocking before JavaScript execution
3. **Synchronous Removal:** DOM manipulation during HTML parsing
4. **Minimal Network Calls:** Single fetch for hidden handles per page

## Testing

### Verification Steps:

1. **Server-Side Filtering:**
   ```bash
   curl "https://your-app.com/api/products?shop=your-shop.myshopify.com"
   # Should not return products with hidden tags
   ```

2. **Client-Side Fallback:**
   ```javascript
   // In browser console
   console.log(window.__HIDDEN_ADDONS); // Should show Set of hidden handles
   console.log(document.getElementById('bb-hidden-handles')); // Should exist
   ```

3. **Exception Testing:**
   - Hidden products should appear in cart
   - Hidden products should appear in bundle components
   - Hidden products should NOT appear in collections/search

## Files Modified

### Server-Side:
- `app/routes/api.products.jsx` - Added server-side filtering
- `app/utils/hidden.server.js` - Existing utility (no changes needed)
- `app/routes/apps.hidden-products.jsx` - Existing endpoint (no changes needed)

### Client-Side:
- `extensions/bundle-builder/blocks/app-embed.liquid` - Enhanced with comprehensive pre-hiding
- `extensions/bundle-builder/assets/hide-hidden-addons.js` - Fallback script (no changes needed)

## Benefits

1. **Zero Flash:** Hidden products never render visually
2. **Performance:** Reduced DOM manipulation and reflows
3. **Reliability:** Multiple layers of protection
4. **Flexibility:** Merchant-configurable tags
5. **Compatibility:** Preserves cart and bundle functionality

## Troubleshooting

### Common Issues:

1. **Products still flashing:**
   - Check if app embed is enabled in Theme Customizer
   - Verify `/apps/hidden-products` endpoint returns handles
   - Check browser console for JavaScript errors

2. **Hidden products missing from cart:**
   - Verify cart pages are excluded from filtering
   - Check if cart uses different product selectors

3. **Performance issues:**
   - Monitor server-side caching effectiveness
   - Check for excessive DOM queries in client-side script

## Future Enhancements

1. **Liquid-level filtering:** For themes that support it
2. **Advanced caching:** Redis-based caching for high-traffic stores
3. **Analytics:** Track hidden product effectiveness
4. **Bulk operations:** Merchant tools for managing hidden products
