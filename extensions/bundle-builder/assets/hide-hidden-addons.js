(function(){
'use strict';
/* global Shopify */
  'use strict';

  const TAGS_TO_HIDE = new Set(['hidden_addon','hidden-product','hidden_product','bundle-addon','bundle_addon']);

  function log(...args){ if(window.ENABLE_ADDON_DEBUG) console.log('[HideAddons]',...args); }

  function getConfig(){
    const el = document.querySelector('[data-addons-config]');
    return {
      productSelector: el?.getAttribute('data-product-selector') ||
        '[data-product-card], .card--product, .grid__item, [data-product-id], .product-item, .product-card, .product, .product-block, [data-product], .product-grid-item, .product-list-item, .collection-item, .search-item',
      tagsAttr: el?.getAttribute('data-tags-attr') || 'data-product-tags',
      debug: el?.getAttribute('data-debug') === 'true'
    };
  }

  // Early synchronous hiding: run immediately, before DOM ready
  function hideImmediately(root=document){
    const cfg = getConfig();
    const cards = root.querySelectorAll(cfg.productSelector);
    cards.forEach(card => {
      const tagAttr = card.getAttribute(cfg.tagsAttr);
      if (!tagAttr) return;
      const tags = String(tagAttr).toLowerCase();
      if ([...TAGS_TO_HIDE].some(t => tags.includes(t))) {
        // Exception: Allow in cart & bundles
        if (card.closest('[data-cart], .cart-drawer, .bb__bundle-card')) return;
        // Prefer DOM removal to avoid reflow/flash
        try { card.remove(); } catch(_) { card.style.setProperty('display','none','important'); }
      }
    });
  }
  hideImmediately(); // run instantly

  // Fallback async hiding (uses server + product fetch)
  async function hideTagged(root=document){
    const knownHidden = await getHiddenHandles();
    const cfg = getConfig();
    const cards = root.querySelectorAll(cfg.productSelector);
    for (const card of cards){
      if (card.closest('[data-cart], .cart-drawer, .bb__bundle-card')) continue;

      const tagAttr = card.getAttribute(cfg.tagsAttr);
      if (tagAttr){
        const tags = String(tagAttr).toLowerCase();
        if ([...TAGS_TO_HIDE].some(t => tags.includes(t))) {
          try { card.remove(); } catch(_) { card.style.setProperty('display','none','important'); }
          continue;
        }
      }

      const handle = getHandleFromNode(card);
      if (handle && knownHidden && knownHidden.has(handle)){
        try { card.remove(); } catch(_) { card.style.setProperty('display','none','important'); }
        continue;
      }

      const tags = await fetchTagsForHandle(handle);
      if (tags.some(t => TAGS_TO_HIDE.has(t))){
        try { card.remove(); } catch(_) { card.style.setProperty('display','none','important'); }
      }
    }
  }

  // ---- Utility functions ----
  async function fetchTagsForHandle(handle){
    if (!handle) return [];
    try{
      const res = await fetch(`/products/${handle}.js`, { credentials:'same-origin' });
      if(!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data.tags)?data.tags:data.tags.split(','))
        .map(s=>s.toLowerCase().trim()).filter(Boolean);
    }catch{ return []; }
  }

  async function getHiddenHandles(){
    if (window.__HIDDEN_ADDONS instanceof Set) return window.__HIDDEN_ADDONS;
    try{
      const shop = (window.Shopify && Shopify.shop) || '';
      const base = (window.BUNDLE_APP_CONFIG?.apiBase) || '/apps';
      const endpoint = `${String(base).replace(/\/$/, '')}/hidden-products?shop=${shop}`;
      const res = await fetch(endpoint, { credentials: 'omit' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && Array.isArray(data.handles)) {
        window.__HIDDEN_ADDONS = new Set(data.handles);
        return window.__HIDDEN_ADDONS;
      }
    }catch{ return null; }
  }

  function getHandleFromNode(node){
    try{
      let a = node.querySelector('a[href*="/products/"]') || node.closest('a[href*="/products/"]');
      if (!a && node.tagName === 'A' && node.href.includes('/products/')) a = node;
      if (!a){
        const handle = node.getAttribute('data-product-handle') || node.getAttribute('data-handle');
        if (handle) return handle;
      }
      if (!a) return null;
      const m = a.getAttribute('href').match(/\/products\/([^\/?#]+)/);
      return m ? m[1] : null;
    }catch{ return null; }
  }

  // Lifecycle hooks
  function init(){ hideTagged(document); }
  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('shopify:section:load', init);
  document.addEventListener('shopify:section:reorder', init);
  document.addEventListener('shopify:section:select', init);
  document.addEventListener('shopify:section:deselect', init);
  document.addEventListener('shopify:block:select', init);
  document.addEventListener('shopify:block:deselect', init);
  window.addEventListener('load', init);
  window.addEventListener('pageshow', init);

  if(window.history && window.history.pushState) {
    const orig = window.history.pushState;
    window.history.pushState = function(){
      orig.apply(window.history, arguments);
      setTimeout(init, 100);
    };
  }

  // MutationObserver for AJAX loads
  const obs = new MutationObserver(()=>{ hideImmediately(); hideTagged(); });
  obs.observe(document.documentElement, { childList:true, subtree:true });
})();
