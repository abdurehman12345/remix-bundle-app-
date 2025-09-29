(function(){
  'use strict';

  const TAGS_TO_HIDE = new Set(['hidden_addon','hidden-product']);

  function getConfig(){
    const el = document.querySelector('[data-addons-config]');
    const cfg = {
      productSelector: '[data-product-card], .card--product, .grid__item, [data-product-id]',
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
      const a = node.querySelector('a[href*="/products/"]');
      if(!a) return null;
      const m = a.getAttribute('href').match(/\/products\/([^\/?#]+)/);
      return m ? m[1] : null;
    }catch(_){ return null; }
  }

  async function hideTagged(root){
    const knownHidden = await getHiddenHandles();
    const cfg = getConfig();
    const selector = cfg.productSelector;
    const attr = cfg.tagsAttr;
    const cards = Array.from((root||document).querySelectorAll(selector));
    for (const card of cards){
      // Fast path: attribute contains tags
      const tagAttr = card.getAttribute(attr);
      if (tagAttr){
        const tags = String(tagAttr).toLowerCase();
        if (tags.includes('hidden_addon') || tags.includes('hidden-product') || tags.includes('hidden_product')){
          card.style.setProperty('display','none','important');
          continue;
        }
      }
      // Fallback: resolve handle and fetch tags
      const handle = getHandleFromNode(card);
      if (!handle) continue;
      if (knownHidden && knownHidden.has(handle)){
        card.style.setProperty('display','none','important');
        continue;
      }
      const tags = await fetchTagsForHandle(handle);
      if (tags.some(t => TAGS_TO_HIDE.has(t))){
        log('Hiding card for', handle);
        card.style.setProperty('display','none','important');
      }
    }
  }

  function init(){ hideTagged(document); }

  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('shopify:section:load', function(){
    try { init(); } catch(_){ }
  });

  try{
    let queued = false;
    const obs = new MutationObserver(()=>{
      if (queued) return; queued = true;
      setTimeout(()=>{ queued = false; hideTagged(document); }, 250);
    });
    obs.observe(document.documentElement, { childList:true, subtree:true });
  }catch(_){ }

  // No globals exposed to avoid inline calls
})();
