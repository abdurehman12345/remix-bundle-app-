(function(){
  'use strict';

  const TAGS_TO_HIDE = new Set(['hidden_addon','hidden-product','hidden_product','bundle-addon','bundle_addon']);

  function getConfig(){
    const el = document.querySelector('[data-addons-config]');
    const cfg = {
      productSelector: '[data-product-card], .card--product, .grid__item, [data-product-id], .product-item, .product-card, .product, .product-block, [data-product], .product-grid-item, .product-list-item, .collection-item, .search-item',
      tagsAttr: 'data-product-tags',
      debug: false
    };
    if (!el) return cfg;
    const sel = el.getAttribute('data-product-selector');
    const attr = el.getAttribute('data-tags-attr');
    const dbg = el.getAttribute('data-debug');
    if (sel) cfg.productSelector = sel;
    if (attr) cfg.tagsAttr = attr;
    if (dbg != null) cfg.debug = String(dbg) === 'true';
    return cfg;
  }

  function log(){
    try{ const cfg = getConfig(); if (cfg.debug) console.debug.apply(console, ['[Add-on Hider]'].concat([].slice.call(arguments))); }catch(_){ }
  }

  async function fetchTagsForHandle(handle){
    try{
      const res = await fetch('/products/' + handle + '.js', { credentials:'same-origin' });
      if(!res.ok) return [];
      const data = await res.json();
      const list = Array.isArray(data.tags) ? data.tags : (typeof data.tags === 'string' ? data.tags.split(',') : []);
      return list.map(s => (s||'').toLowerCase().trim()).filter(Boolean);
    }catch(_){ return []; }
  }

  async function getHiddenHandles(){
    if (window.__HIDE_ADDONS_HANDLES instanceof Set) return window.__HIDE_ADDONS_HANDLES;
    if (window.__HIDE_ADDONS_HANDLES_PROMISE) return window.__HIDE_ADDONS_HANDLES_PROMISE;
    try{
      const shop = (window.Shopify && Shopify.shop) || '';
      const base = (window.BUNDLE_APP_CONFIG && window.BUNDLE_APP_CONFIG.apiBase) || '/apps';
      const endpoint = (String(base).replace(/\/$/, '')) + '/hidden-products';
      const url = new URL(endpoint, window.location.origin);
      if (!url.searchParams.has('shop') && shop) url.searchParams.set('shop', shop);
      window.__HIDE_ADDONS_HANDLES_PROMISE = fetch(url.toString(), { credentials: 'omit' })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data && Array.isArray(data.handles)) {
            window.__HIDE_ADDONS_HANDLES = new Set(data.handles);
            return window.__HIDE_ADDONS_HANDLES;
          }
          return null;
        })
        .catch(() => null);
      const resSet = await window.__HIDE_ADDONS_HANDLES_PROMISE;
      window.__HIDE_ADDONS_HANDLES_PROMISE = null;
      return resSet;
    }catch(_){ return null; }
  }

  function getHandleFromNode(node){
    try{
      // Try multiple methods to find the product handle
      let a = node.querySelector('a[href*="/products/"]');
      if(!a) a = node.closest('a[href*="/products/"]');
      if(!a && node.tagName === 'A' && node.href && node.href.includes('/products/')) a = node;
      if(!a) {
        // Check for data attributes
        const handle = node.getAttribute('data-product-handle') || node.getAttribute('data-handle');
        if(handle) return handle;
      }
      if(!a) return null;
      const m = a.getAttribute('href').match(/\/products\/([^\/?#]+)/);
      return m ? m[1] : null;
    }catch(_){ return null; }
  }

  // Phase 1: INSTANT hiding based on immediate detection
  function hideTaggedImmediate(root){
    const cfg = getConfig();
    const selector = cfg.productSelector;
    const attr = cfg.tagsAttr;
    const cards = Array.from((root||document).querySelectorAll(selector));
    let hiddenCount = 0;
    
    for (const card of cards){
      let shouldHide = false;
      
      // Method 1: Check tag attributes (instant)
      const tagAttr = card.getAttribute(attr) || card.getAttribute('data-tags') || card.getAttribute('data-product-tags');
      if (tagAttr){
        const tags = String(tagAttr).toLowerCase();
        if (tags.includes('hidden_addon') || tags.includes('hidden-product') || tags.includes('hidden_product') || tags.includes('bundle-addon') || tags.includes('bundle_addon')){
          shouldHide = true;
        }
      }
      
      // Method 2: Check URL patterns (instant)
      if (!shouldHide) {
        const handle = getHandleFromNode(card);
        if (handle && (handle.includes('hidden-') || handle.includes('bundle-addon') || handle.includes('addon-'))) {
          shouldHide = true;
        }
      }
      
      // Method 3: Check data attributes (instant)
      if (!shouldHide) {
        const handle = card.getAttribute('data-product-handle') || card.getAttribute('data-handle');
        if (handle && (handle.includes('hidden-') || handle.includes('bundle-addon') || handle.includes('addon-'))) {
          shouldHide = true;
        }
      }
      
      if (shouldHide) {
        card.style.setProperty('display','none','important');
        card.setAttribute('data-addon-hidden', 'immediate');
        hiddenCount++;
        log('Immediately hiding card for', getHandleFromNode(card) || 'unknown');
      }
    }
    
    log(`Phase 1: Immediately hidden ${hiddenCount} products`);
    
    // Phase 2: Background verification for remaining products
    setTimeout(() => hideTaggedBackground(root), 0);
  }
  
  // Phase 2: Background API verification (non-blocking)
  async function hideTaggedBackground(root){
    try {
      const knownHidden = await getHiddenHandles();
      const cfg = getConfig();
      const selector = cfg.productSelector;
      const cards = Array.from((root||document).querySelectorAll(selector + ':not([data-addon-hidden])'));
      let additionalHidden = 0;
      
      for (const card of cards){
        const handle = getHandleFromNode(card);
        if (!handle) continue;
        
        // Check server-side hidden list
        if (knownHidden && knownHidden.has(handle)){
          card.style.setProperty('display','none','important');
          card.setAttribute('data-addon-hidden', 'api');
          additionalHidden++;
          log('Background hiding via API:', handle);
          continue;
        }
        
        // Individual product fetch (lowest priority)
        const tags = await fetchTagsForHandle(handle);
        if (tags.some(t => TAGS_TO_HIDE.has(t))){
          card.style.setProperty('display','none','important');
          card.setAttribute('data-addon-hidden', 'fetch');
          additionalHidden++;
          log('Background hiding via fetch:', handle);
        }
      }
      
      if (additionalHidden > 0) {
        log(`Phase 2: Background hidden ${additionalHidden} additional products`);
      }
    } catch (error) {
      log('Background hiding error:', error);
    }
  }

  function init(){ 
    log('Initializing IMMEDIATE hidden addon hiding');
    hideTaggedImmediate(document); 
  }
  
  // Multiple event listeners for comprehensive coverage
  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('shopify:section:load', init);
  document.addEventListener('shopify:section:reorder', init);
  document.addEventListener('shopify:section:select', init);
  document.addEventListener('shopify:section:deselect', init);
  document.addEventListener('shopify:block:select', init);
  document.addEventListener('shopify:block:deselect', init);
  
  // Additional events for AJAX loading
  window.addEventListener('load', init);
  window.addEventListener('pageshow', init);
  
  // For SPA-like behavior
  if(window.history && window.history.pushState) {
    const originalPushState = window.history.pushState;
    window.history.pushState = function() {
      originalPushState.apply(window.history, arguments);
      setTimeout(init, 100);
    };
  }
  try{
    let queued = false;
    const obs = new MutationObserver(()=>{
      if (queued) return; queued = true;
      setTimeout(()=>{ queued = false; hideTaggedImmediate(document); }, 50);
    });
    obs.observe(document.documentElement, { childList:true, subtree:true });
  }catch(_){ }
  // No globals exposed to avoid inline calls
})();
