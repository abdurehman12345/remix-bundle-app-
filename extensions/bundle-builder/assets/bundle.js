(function(){
'use strict';
/* global Shopify, Swiper */
  'use strict';
  
  // Utility functions
  const utils = {
    money: (cents) => (cents / 100).toFixed(2),
    
    makeAbsolute: (url) => {
      if (!url) return url;
      if (/^https?:\/\//i.test(url)) return url;
      if (url.startsWith('/uploads/')) return `/apps/bundles${url}`;
      if (url.startsWith('/apps/bundles/uploads/')) return url;
      const base = (window.BUNDLE_APP_CONFIG && window.BUNDLE_APP_CONFIG.tunnelUrl) || '';
      if (url.startsWith('uploads/')) return `${base}/${url}`;
      return url;
    },
    
    debounce: (func, wait) => {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },
    
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    
    easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    
    createIntersectionObserver: (callback, options = {}) => {
      const defaultOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1,
        ...options
      };
      
      if ('IntersectionObserver' in window) {
        return new IntersectionObserver(callback, defaultOptions);
      }
      return null;
    }
  };

  // Enhanced loading screen with 3D animation
  function showEnhancedLoading(root, message = 'Loading bundles...') {
    root.innerHTML = `
      <div class="bb__loading bb__loading--3d" role="status" aria-live="polite">
        <div class="bb__loading-container">
          <div class="bb__loading-spinner--3d" aria-hidden="true">
            <div class="bb__spinner-ring bb__spinner-ring--outer"></div>
            <div class="bb__spinner-ring bb__spinner-ring--middle"></div>
            <div class="bb__spinner-ring bb__spinner-ring--inner"></div>
            <div class="bb__spinner-core"></div>
          </div>
          <div class="bb__loading-content">
            <h3>Loading Premium Collections</h3>
            <p>${message}</p>
            <div class="bb__loading-progress">
              <div class="bb__progress-bar">
                <div class="bb__progress-fill--3d"></div>
              </div>
              <div class="bb__progress-text">Preparing your experience...</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Keep existing BundleBuilder class unchanged for compatibility
  class BundleBuilder {
    constructor(root, bundle) {
      this.root = root;
      this.bundle = bundle;
      this.selected = new Map();
      this.selectedWrap = null;
      this.selectedCard = null;
      // personalization removed
      this.productVariants = new Map();
      
      this.init();
    }
    
    init() {
      this.render();
      this.attachEventListeners();
      this.setupFormValidation();
    }
    
    // ... rest of BundleBuilder implementation remains the same as original
    calculatePrice() {
      const items = Array.from(this.selected.values());
      let subtotal = 0;
      
      items.forEach(item => {
        const basePrice = item.priceCents || 0;
        subtotal += basePrice;
        const chosenVariantId = this.productVariants.get(String(item.id)) || null;
        if (chosenVariantId) {
          const product = (this.bundle.products || []).find(p => String(p.id) === String(item.id));
          if (product) {
            let variants = Array.isArray(product.variants) ? product.variants : [];
            if ((!variants || variants.length === 0) && product.variantsJson) {
              try {
                const arr = JSON.parse(product.variantsJson);
                if (Array.isArray(arr)) variants = arr;
              } catch(_) {}
            }
            const variant = variants.find(v => String(v.id) === String(chosenVariantId));
            const variantPrice = variant && typeof variant.priceCents === 'number' ? variant.priceCents : null;
            if (variantPrice != null && variantPrice !== basePrice) {
              subtotal += Math.max(0, variantPrice - basePrice);
            }
          }
        }
      });
      
      let price = subtotal;
      if (this.bundle.tierPrices && this.bundle.tierPrices.length > 0) {
        const qty = items.length;
        const applicable = this.bundle.tierPrices
          .filter(t => t.minQuantity <= qty)
          .sort((a, b) => b.minQuantity - a.minQuantity)[0];          
        if (applicable) {
          if (applicable.pricingType === 'FIXED' && applicable.valueCents != null) {
            price = applicable.valueCents;
          } else if (applicable.pricingType === 'DISCOUNT_PERCENT' && applicable.valuePercent != null) {
            price = Math.max(0, subtotal - Math.floor(subtotal * (applicable.valuePercent / 100)));
          } else if (applicable.pricingType === 'DISCOUNT_AMOUNT' && applicable.valueCents != null) {
            price = Math.max(0, subtotal - applicable.valueCents);
          }
        }
      }
      if (this.bundle.pricingType === 'FIXED' && this.bundle.priceValueCents != null) {
        price = this.bundle.priceValueCents;
      }
      if (this.bundle.pricingType === 'DISCOUNT_PERCENT' && this.bundle.priceValueCents != null) {
        price = Math.max(0, subtotal - Math.floor(subtotal * (this.bundle.priceValueCents / 100)));
      }
      if (this.bundle.pricingType === 'DISCOUNT_AMOUNT' && this.bundle.priceValueCents != null) {
        price = Math.max(0, subtotal - this.bundle.priceValueCents);
      }
      
      if (this.selectedWrap) price += (this.selectedWrap.priceCents || 0);
      if (this.selectedCard) price += (this.selectedCard.priceCents || 0);
      
      return price;
    }
    
    render() {
      const price = this.calculatePrice();
      const hasImage = this.bundle.imageUrl;
      
      this.root.innerHTML = `
        <div class="bb">
          <div class="bb__header ${hasImage ? 'bb__header--detail' : ''}">
            <div class="bb__header-left">
              <h2 class="bb__title">${this.bundle.title}</h2>
              ${this.bundle.description ? `<p class="bb__desc">${this.bundle.description}</p>` : ''}
            </div>
            ${hasImage ? `
              <div class="bb__header-center">
                <img class="bb__image" src="${utils.makeAbsolute(this.bundle.imageUrl)}" alt="${this.bundle.title}" loading="lazy" onerror="this.style.display='none'"/>
              </div>
            ` : ''}
            <div class="bb__header-right">
              <button class="bb__back-btn" onclick="showAllBundles()" aria-label="Back to all bundles">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5m7-7l-7 7 7 7"></path>
                </svg>
                <span>Back to Collections</span>
              </button>
            </div>
          </div>          
          ${this.renderProducts()}
          ${this.renderWrappingOptions()}
          ${this.renderCardOptions()}
          ${this.renderSummary(price)}
        </div>
      `;
    }
    
    // ... rest of the methods remain the same as original bundle.js
    renderProducts() {
      if (!this.bundle.products || this.bundle.products.length === 0) {
        return `
          <div class="bb__products">
            <h4>Products</h4>
            <div class="bb__empty-state">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
              </svg>
              <p>No products available at the moment</p>
            </div>
          </div>
        `;
      }
      
      return `
        <div class="bb__products">
          <div class="bb__section-header">
            <h4>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="9" cy="21" r="1"></circle>
                <circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
              </svg>
              Select Products
            </h4>
            <span class="bb__selection-count">${this.selected.size} of ${this.bundle.products.length} selected</span>
          </div>
          <p class="bb__section-desc">Choose the products you'd like to include in your bundle:</p>
          <div class="bb__products-grid">
            ${this.bundle.products.map(product => this.renderProduct(product)).join('')}
          </div>
        </div>
      `;
    }
    
    renderProduct(product) {
      const isSelected = this.selected.has(product.id);
      const selectedVariant = this.productVariants.get(product.id);
      
      let variants = Array.isArray(product.variants) ? product.variants : [];
      if ((!variants || variants.length === 0) && product.variantsJson) {
        try {
          const arr = JSON.parse(product.variantsJson);
          if (Array.isArray(arr)) {
            variants = arr.map(v => ({
              id: v.id || v.variantId,
              title: v.title || 'Variant',
              priceCents: typeof v.priceCents === 'number' ? v.priceCents : (v.price ? Math.round(parseFloat(v.price) * 100) : 0),
              imageUrl: v.imageUrl || v.image || null,
            })).filter(v => v && v.id);
          }
        } catch(_) { /* ignore */ }
      }
      const hasVariants = Array.isArray(variants) && variants.length > 0;
      
      return `
        <div class="bb__prod-container ${isSelected ? 'bb__prod-container--selected' : ''}">
          <label class="bb__prod">
            <input type="checkbox" data-pid="${product.id}" ${isSelected ? 'checked' : ''} 
                   aria-describedby="product-${product.id}-info"/>
            <div class="bb__prod-content">
              <div class="bb__prod-image">
                ${product.imageUrl ? 
                  `<img class="bb__prod-img" src="${utils.makeAbsolute(product.imageUrl)}" 
                       alt="${product.variantTitle || product.productGid}" loading="lazy"/>` : 
                  `<div class="bb__prod-img bb__prod-img--placeholder" aria-hidden="true">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <polyline points="21,15 16,10 5,21"></polyline>
                    </svg>
                  </div>`
                }
                <div class="bb__prod-overlay">
                  <div class="bb__check-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20,6 9,17 4,12"></polyline>
                    </svg>
                  </div>
                </div>
              </div>
              <div class="bb__prod-info" id="product-${product.id}-info">
                <span class="bb__prod-title">${product.variantTitle || product.productGid}</span>
                ${product.priceCents ? `<span class="bb__prod-price">$${utils.money(product.priceCents)}</span>` : ''}
                <div class="bb__prod-features">
                  <span class="bb__feature">Premium Quality</span>
                  <span class="bb__feature">Fast Shipping</span>
                </div>
              </div>
            </div>
          </label>
          ${hasVariants ? `
            <div class="bb__variant-selector ${isSelected ? 'bb__variant-selector--visible' : ''}">
              <label for="variant-${product.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                </svg>
                Select Variant:
              </label>
              <select class="bb__variant-select" data-pid="${product.id}" id="variant-${product.id}">
                <option value="">Default Variant</option>
                ${variants.map(variant => `
                  <option value="${variant.id}" ${selectedVariant === variant.id ? 'selected' : ''}>
                    ${variant.title || 'Variant'}${variant.priceCents != null ? ` - $${utils.money(variant.priceCents)}` : ''}
                  </option>
                `).join('')}
              </select>
            </div>
          ` : ''}
        </div>
      `;
    }
    
    renderWrappingOptions() {
      if (!this.bundle.wrappingOptions || this.bundle.wrappingOptions.length === 0) {
        return '';
      }
      
      return `
        <div class="bb__wraps">
          <div class="bb__section-header">
            <h4>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
              Gift Wrapping Options
            </h4>
            ${this.selectedWrap ? `<span class="bb__selection-indicator">Selected: ${this.selectedWrap.name}</span>` : ''}
          </div>
          <p class="bb__section-desc">Choose how you'd like your bundle to be wrapped:</p>
          <div class="bb__wraps-grid" role="radiogroup" aria-labelledby="wrapping-heading">
            ${this.bundle.wrappingOptions.map(wrap => `
              <label class="bb__wrap ${this.selectedWrap && this.selectedWrap.id === wrap.id ? 'bb__wrap--selected' : ''}">
                <input type="radio" name="wrap" data-wid="${wrap.id}" 
                       ${this.selectedWrap && this.selectedWrap.id === wrap.id ? 'checked' : ''}
                       aria-describedby="wrap-${wrap.id}-info"/>
                <div class="bb__wrap-content">
                  <div class="bb__wrap-image">
                    ${wrap.imageUrl ? 
                      `<img class="bb__wrap-img" src="${utils.makeAbsolute(wrap.imageUrl)}" 
                           alt="${wrap.name}" loading="lazy" onerror="this.style.display='none'"/>` : 
                      `<div class="bb__wrap-placeholder">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                      </div>`
                    }
                    <div class="bb__selection-overlay">
                      <div class="bb__check-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div class="bb__wrap-info" id="wrap-${wrap.id}-info">
                    <span class="bb__wrap-name">${wrap.name}</span>
                    <span class="bb__wrap-price">+$${utils.money(wrap.priceCents)}</span>
                    <div class="bb__wrap-features">
                      <span class="bb__feature">Premium Materials</span>
                      <span class="bb__feature">Eco-Friendly</span>
                    </div>
                  </div>
                </div>
              </label>
            `).join('')}
          </div>
          ${this.bundle.wrapRequired ? '<p class="bb__required">* Gift wrapping is required for this bundle</p>' : ''}
        </div>
      `;
    }
    
    renderCardOptions() {
      if (!this.bundle.cards || this.bundle.cards.length === 0) {
        return '';
      }
      
      return `
        <div class="bb__cards">
          <div class="bb__section-header">
            <h4>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14,2 14,8 20,8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10,9 9,9 8,9"></polyline>
              </svg>
              Gift Card Design
            </h4>
            ${this.selectedCard ? `<span class="bb__selection-indicator">Selected: ${this.selectedCard.name}</span>` : ''}
          </div>
          <p class="bb__section-desc">Select a card design to include with your gift:</p>
          <div class="bb__cards-grid" role="radiogroup" aria-labelledby="cards-heading">
            ${this.bundle.cards.map(card => `
              <label class="bb__card ${this.selectedCard && this.selectedCard.id === card.id ? 'bb__card--selected' : ''}">
                <input type="radio" name="card" data-cid="${card.id}" 
                       ${this.selectedCard && this.selectedCard.id === card.id ? 'checked' : ''}
                       aria-describedby="card-${card.id}-info"/>
                <div class="bb__card-content">
                  <div class="bb__card-image">
                    ${card.imageUrl ? 
                      `<img class="bb__card-img" src="${utils.makeAbsolute(card.imageUrl)}" 
                           alt="${card.name}" loading="lazy"/>` : 
                      `<div class="bb__card-placeholder">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14,2 14,8 20,8"></polyline>
                        </svg>
                      </div>`
                    }
                    <div class="bb__selection-overlay">
                      <div class="bb__check-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                      </div>
                    </div>
                  </div>
                  <div class="bb__card-info" id="card-${card.id}-info">
                    <span class="bb__card-name">${card.name}</span>
                    <span class="bb__card-price">${(card.priceCents || 0) > 0 ? `+$${utils.money(card.priceCents)}` : 'Free'}</span>
                    <div class="bb__card-features">
                      <span class="bb__feature">Premium Paper</span>
                      <span class="bb__feature">Custom Message</span>
                    </div>
                  </div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    }
    
    renderMessageSection() { return ''; }
    
    renderSummary(price) {
      const canAddToCart = this.selected.size > 0 || this.selectedWrap || this.selectedCard;
      const savings = this.calculateSavings();
      
      return `
        <div class="bb__summary">
          <div class="bb__summary-header">
            <h4>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              Order Summary
            </h4>
          </div>
          <div class="bb__price-breakdown">
            ${savings > 0 ? `
              <div class="bb__savings">
                <span>You Save: $${utils.money(savings)}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M7 17L17 7M17 7H7M17 7V17"></path>
                </svg>
              </div>
            ` : ''}
            <div class="bb__price">
              <span class="bb__price-label">Total:</span>
              <span class="bb__price-value">$${utils.money(price)}</span>
            </div>
          </div>
          <div class="bb__rules">
            ${this.bundle.minItems ? `<div class="bb__rule">Minimum ${this.bundle.minItems} item${this.bundle.minItems > 1 ? 's' : ''} required</div>` : ''}
            ${this.bundle.maxItems ? `<div class="bb__rule">Maximum ${this.bundle.maxItems} item${this.bundle.maxItems > 1 ? 's' : ''} allowed</div>` : ''}
            <div class="bb__guarantee">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              30-day satisfaction guarantee
            </div>
          </div>
        </div>
        
        <button class="bb__add ${!canAddToCart ? 'bb__add--disabled' : ''}" 
                ${!canAddToCart ? 'disabled' : ''} 
                aria-describedby="add-to-cart-info">
          <span class="bb__btn-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="9" cy="21" r="1"></circle>
              <circle cx="20" cy="21" r="1"></circle>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>
            <span>Add to Cart</span>
          </span>
          <div class="bb__btn-loading">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 11-6.219-8.56"></path>
            </svg>
          </div>
        </button>
      `;
    }
    
    calculateSavings() {
      const items = Array.from(this.selected.values());
      const individualTotal = items.reduce((sum, item) => sum + (item.priceCents || 0), 0);
      const bundlePrice = this.calculatePrice();
      return Math.max(0, individualTotal - bundlePrice);
    }
    
    setupFormValidation() {
      this.root.addEventListener('change', () => {
        this.validateForm();
      });
    }
    
    validateForm() {
      const addBtn = this.root.querySelector('.bb__add');
      const canAddToCart = this.selected.size > 0 || this.selectedWrap || this.selectedCard;
      
      if (addBtn) {
        addBtn.disabled = !canAddToCart;
        addBtn.classList.toggle('bb__add--disabled', !canAddToCart);
      }
    }
    
    attachEventListeners() {
      // Product selection with enhanced feedback
      this.root.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
          const pid = e.target.dataset.pid;
          const product = this.bundle.products.find(p => String(p.id) === String(pid));
          const container = e.target.closest('.bb__prod-container');
          
          if (e.target.checked) {
            this.selected.set(pid, {
              id: pid,
              variantGid: product.variantGid,
              priceCents: product.priceCents || null,
              title: product.variantTitle || product.productGid
            });
            container?.classList.add('bb__prod-container--selected');
          } else {
            this.selected.delete(pid);
            this.productVariants.delete(pid);
            container?.classList.remove('bb__prod-container--selected');
          }
          
          this.updateSelectionCounter();
          this.render();
          this.attachEventListeners();
        });
      });
      
      // Variant selection
      this.root.querySelectorAll('.bb__variant-select').forEach(select => {
        select.addEventListener('change', (e) => {
          const pid = e.target.dataset.pid;
          const variantId = e.target.value;
          
          if (variantId) {
            this.productVariants.set(pid, variantId);
          } else {
            this.productVariants.delete(pid);
          }
          
          this.render();
          this.attachEventListeners();
        });
      });
      
      // Wrapping selection with enhanced feedback
      this.root.querySelectorAll('input[name="wrap"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          const wrapId = e.target.dataset.wid;
          this.selectedWrap = this.bundle.wrappingOptions.find(w => String(w.id) === wrapId);
          
          // Update visual selection
          this.root.querySelectorAll('.bb__wrap').forEach(wrap => {
            wrap.classList.remove('bb__wrap--selected');
          });
          e.target.closest('.bb__wrap').classList.add('bb__wrap--selected');
          
          this.render();
          this.attachEventListeners();
        });
      });
      
      // Card selection with enhanced feedback
      this.root.querySelectorAll('input[name="card"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          const cardId = e.target.dataset.cid;
          this.selectedCard = this.bundle.cards.find(c => String(c.id) === cardId);
          
          // Update visual selection
          this.root.querySelectorAll('.bb__card').forEach(card => {
            card.classList.remove('bb__card--selected');
          });
          e.target.closest('.bb__card').classList.add('bb__card--selected');
          
          this.render();
          this.attachEventListeners();
        });
      });
      
      // personalization inputs removed
      
      // Add to cart button with loading state
      const addBtn = this.root.querySelector('.bb__add');
      if (addBtn) {
        addBtn.addEventListener('click', () => this.handleAddToCart());
      }
    }
    
    updateSelectionCounter() {
      const counter = this.root.querySelector('.bb__selection-count');
      if (counter) {
        counter.textContent = `${this.selected.size} of ${this.bundle.products.length} selected`;
      }
    }
    
    async handleAddToCart() {
      const addBtn = this.root.querySelector('.bb__add');
      if (!addBtn) return;
      
      // Show loading state
      addBtn.classList.add('bb__add--loading');
      addBtn.disabled = true;
      
      try {
        // Validation
        if (this.bundle.wrapRequired && !this.selectedWrap) {
          this.showNotification('Please select a wrapping option', 'warning');
          return;
        }
        
        
        
        if (this.bundle.minItems && this.selected.size < this.bundle.minItems) {
          this.showNotification(`Please select at least ${this.bundle.minItems} item${this.bundle.minItems > 1 ? 's' : ''}`, 'warning');
          return;
        }
        
        if (this.bundle.maxItems && this.selected.size > this.bundle.maxItems) {
          this.showNotification(`Please select no more than ${this.bundle.maxItems} item${this.bundle.maxItems > 1 ? 's' : ''}`, 'warning');
          return;
        }
        
        // Prepare bundle data
        const selectedProductIds = Array.from(this.selected.keys());
        const selectedVariantMap = {};
        for (const [pid, vid] of this.productVariants.entries()) {
          selectedVariantMap[pid] = vid;
        }
        
        // Get API configuration
        const tunnel = (window.BUNDLE_APP_CONFIG && window.BUNDLE_APP_CONFIG.tunnelUrl) || '';
        const qs = `shop=${encodeURIComponent(Shopify.shop)}&prefer=discount`;
        
        let prepareRes;
        if (tunnel) {
          prepareRes = await fetch(`${tunnel}/apps/bundles/${this.bundle.id}?${qs}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selectedProductIds,
              selectedVariantMap,
              selectedWrapId: this.selectedWrap ? this.selectedWrap.id : null,
              selectedCardId: this.selectedCard ? this.selectedCard.id : null
            })
          });
        } else {
          prepareRes = await fetch(`/apps/bundles/${this.bundle.id}?${qs}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selectedProductIds,
              selectedVariantMap,
              selectedWrapId: this.selectedWrap ? this.selectedWrap.id : null,
              selectedCardId: this.selectedCard ? this.selectedCard.id : null
            })
          });
        }
        
        if (!prepareRes.ok) {
          const err = await prepareRes.json().catch(() => ({}));
          const errorMsg = err.error || `HTTP ${prepareRes.status}`;
          this.showNotification(`Failed to prepare bundle: ${errorMsg}`, 'error');
          return;
        }
        
        const prep = await prepareRes.json();
        
        // Build cart items
        const cartItems = [];
        
        // Add selected products
        for (const pid of selectedProductIds) {
          const product = this.bundle.products.find(p => String(p.id) === String(pid));
          let variantGid = this.productVariants.get(pid) || product?.variantGid;
          if (!variantGid) continue;
          
          let numericId = String(variantGid).split('/').pop();
          if (!/^[0-9]+$/.test(numericId)) continue;
          
          cartItems.push({
            id: String(numericId),
            quantity: 1,
            properties: {
              'Type': 'Bundle Item',
              'Bundle ID': this.bundle.id,
              'Bundle Name': this.bundle.title
            }
          });
        }
        
        // Add gift wrap
        if (this.selectedWrap && this.selectedWrap.shopifyVariantId) {
          let wrapVariantId = String(this.selectedWrap.shopifyVariantId).split('/').pop();
          if (/^[0-9]+$/.test(wrapVariantId)) {
            cartItems.push({
              id: String(wrapVariantId),
              quantity: 1,
              properties: {
                'Type': 'Bundle Add-on',
                'Bundle ID': this.bundle.id,
                'Bundle Name': this.bundle.title,
                'Add-on Type': 'Gift Wrap',
                'Add-on Name': this.selectedWrap.name
              }
            });
          }
        }
        
        // Add gift card
        if (this.selectedCard && this.selectedCard.shopifyVariantId) {
          let cardVariantId = String(this.selectedCard.shopifyVariantId).split('/').pop();
          if (/^[0-9]+$/.test(cardVariantId)) {
            cartItems.push({
              id: String(cardVariantId),
              quantity: 1,
              properties: {
                'Type': 'Bundle Add-on',
                'Bundle ID': this.bundle.id,
                'Bundle Name': this.bundle.title,
                'Add-on Type': 'Gift Card',
                'Add-on Name': this.selectedCard.name
              }
            });
          }
        }
        
        if (cartItems.length === 0) {
          this.showNotification('Nothing to add. Please select at least one product, wrap or card.', 'warning');
          return;
        }
        
        // Add to cart
        const payload = { items: cartItems };
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        
        if (response.ok) {
          this.showNotification('Bundle added to cart successfully!', 'success');
          
          // Apply discount code if available
          const discountCode = prep?.discountCode;
          if (discountCode) {
            window.location.href = `/checkout?discount=${encodeURIComponent(discountCode)}`;
          } else {
            window.location.href = '/cart';
          }
        } else {
          const errorData = await response.json().catch(() => ({ description: 'Unknown error' }));
          this.showNotification(`Failed to add to cart: ${errorData.description}`, 'error');
        }
        
      } catch (error) {
        console.error('Add to cart error:', error);
        this.showNotification('Failed to add to cart. Please try again.', 'error');
      } finally {
        // Remove loading state
        addBtn.classList.remove('bb__add--loading');
        addBtn.disabled = false;
      }
    }
    
    showNotification(message, type = 'info') {
      // Create and show notification
      const notification = document.createElement('div');
      notification.className = `bb__notification bb__notification--${type}`;
      notification.innerHTML = `
        <div class="bb__notification-content">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${type === 'success' ? '<polyline points="20,6 9,17 4,12"></polyline>' :
              type === 'error' ? '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>' :
              type === 'warning' ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>' :
              '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>'}
          </svg>
          <span>${message}</span>
        </div>
        <button class="bb__notification-close" aria-label="Close notification">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `;
      
      document.body.appendChild(notification);
      
      // Auto-remove after 5 seconds
      setTimeout(() => {
        notification.classList.add('bb__notification--removing');
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }, 5000);
      
      // Close button
      notification.querySelector('.bb__notification-close').addEventListener('click', () => {
        notification.classList.add('bb__notification--removing');
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      });
    }
  }

  // Main initialization function
  async function init(root) {
    const bundleId = root.dataset.bundleId;
    let apiBase = (root.dataset.apiUrl || '').trim();
    
    if (!apiBase) {
      apiBase = (window.BUNDLE_APP_CONFIG && window.BUNDLE_APP_CONFIG.apiBase) || '/apps/bundles';
    }
    
    if (apiBase.length > 1 && apiBase.endsWith('/')) {
      apiBase = apiBase.slice(0, -1);
    }

    // Global functions for navigation
    window.selectBundle = function(bundleId) {
      const detailBase = (window.BUNDLE_APP_CONFIG && window.BUNDLE_APP_CONFIG.apiBase) || '/apps';
      showSpecificBundle(root, bundleId, detailBase);
    };
    
    window.showAllBundles = function() {
      const base = (window.BUNDLE_APP_CONFIG && window.BUNDLE_APP_CONFIG.apiBase) || '/apps';
      const bundlesUrl = base.endsWith('/bundles') ? base : (base + '/bundles');
      showAllBundles(root, bundlesUrl);
    };

    try {
    if (!bundleId) {
        const listUrl = apiBase.endsWith('/bundles') ? apiBase : (apiBase + '/bundles');
        await showAllBundles(root, listUrl);
      } else {
        await showSpecificBundle(root, bundleId, apiBase.replace(/\/bundles$/, ''));
      }
    } catch (error) {
      console.error('Bundle initialization error:', error);
      showError(root, 'Failed to load bundles', 'Please try refreshing the page or contact support.');
    }
  }

  async function showAllBundles(root, apiBase) {
    try {
      // Show enhanced loading screen
      showEnhancedLoading(root, 'Discovering premium collections...');
      // Show enhanced loading screen
      showEnhancedLoading(root, 'Discovering premium collections...');
      
      const shopDomain = (window.Shopify && Shopify.shop) ? String(Shopify.shop) : '';
      const ts = Date.now();
      const withShop = shopDomain ? `${apiBase}?shop=${encodeURIComponent(shopDomain)}&_t=${ts}` : `${apiBase}?_t=${ts}`;
      let response = await fetch(withShop, {
        method: 'GET',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok && !String(apiBase).startsWith('/')) {
        const fallback = shopDomain ? `/apps/bundles?shop=${encodeURIComponent(shopDomain)}&_t=${Date.now()}` : `/apps/bundles?_t=${Date.now()}`;
        response = await fetch(fallback, { cache: 'no-store' });
      }
      if (!response.ok) {
        try { response = await fetch(`${apiBase}?_t=${Date.now()}`, { method: 'GET', mode: 'cors', headers: { 'Accept': 'application/json' }, cache: 'no-store' }); } catch(_) {}
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch bundles: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.bundles || data.bundles.length === 0) {
        showEmpty(root);
        return;
      }
      
      try { 
        if (!window.ENHANCED_BUNDLE_CONFIG) window.ENHANCED_BUNDLE_CONFIG = {}; 
        window.ENHANCED_BUNDLE_CONFIG.plan = data.plan || 'FREE'; 
        window.ENHANCED_BUNDLE_CONFIG.hero = data.hero || null;
        // Seed carousel config from server if provided
        if (data.carousel) {
          const c = data.carousel;
          window.ENHANCED_BUNDLE_CONFIG.carouselStyle = c.style || window.ENHANCED_BUNDLE_CONFIG.carouselStyle;
          window.ENHANCED_BUNDLE_CONFIG.cardStyle = c.cardStyle || window.ENHANCED_BUNDLE_CONFIG.cardStyle;
          window.ENHANCED_BUNDLE_CONFIG.enableAutoplay = (c.autoplay != null ? !!c.autoplay : window.ENHANCED_BUNDLE_CONFIG.enableAutoplay);
          window.ENHANCED_BUNDLE_CONFIG.autoplaySpeed = (c.speedMs != null ? Number(c.speedMs) : window.ENHANCED_BUNDLE_CONFIG.autoplaySpeed);
          if (c.buttonBg != null) window.ENHANCED_BUNDLE_CONFIG.buttonBg = c.buttonBg;
          if (c.badgeBg != null) window.ENHANCED_BUNDLE_CONFIG.badgeBg = c.badgeBg;
          if (c.containerBg != null) window.ENHANCED_BUNDLE_CONFIG.containerBg = c.containerBg;
        }
        // Apply persisted colors to container on initial load
        try {
          const cfg = window.ENHANCED_BUNDLE_CONFIG;
          const rs = root.style;
          if (cfg.buttonBg) rs.setProperty('--bb-button-bg', cfg.buttonBg); else rs.removeProperty('--bb-button-bg');
          if (cfg.badgeBg) rs.setProperty('--bb-badge-bg', cfg.badgeBg); else rs.removeProperty('--bb-badge-bg');
          if (cfg.containerBg) rs.background = cfg.containerBg; else rs.background = '';
        } catch(_) {}
      } catch(_) {}

      // cache bundles on the root so we can re-render header on setting changes without refetch
      try { root.__bb_bundles = data.bundles; } catch(_) { /* ignore */ }
      renderBundleGrid(root, data.bundles);
    } catch (error) {
      console.error('Failed to show all bundles:', error);
      throw error;
    }
  }

  async function showSpecificBundle(root, bundleId, apiBase) {
    try {
      // Show enhanced loading for specific bundle
      showEnhancedLoading(root, 'Loading bundle details...');
      // Show enhanced loading for specific bundle
      showEnhancedLoading(root, 'Loading bundle details...');
      
      const shop = (window.Shopify && Shopify.shop) || '';
      const url = `/apps/bundles/${bundleId}?shop=${shop}&_t=${Date.now()}`;
      const response = await fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
      if (!response.ok) throw new Error(`Failed to fetch bundle: ${response.status}`);
      
      const data = await response.json();
      
      if (!data.bundle) {
        throw new Error('No bundle data received');
      }
      
      // cache array form for consistency with grid
      try { root.__bb_bundles = [data.bundle]; } catch(_) { /* ignore */ }
      new BundleBuilder(root, data.bundle);
      
    } catch (error) {
      console.error('Failed to show specific bundle:', error);
      throw error;
    }
  }

  function renderBundleGrid(root, bundles) {
    const planVal = (window.ENHANCED_BUNDLE_CONFIG && window.ENHANCED_BUNDLE_CONFIG.plan) || 'FREE';
    const cfg = (window.ENHANCED_BUNDLE_CONFIG && window.ENHANCED_BUNDLE_CONFIG.hero) || null;
    // Also accept per-section data attributes as fallback when global is missing
    try {
      if (!window.ENHANCED_BUNDLE_CONFIG) window.ENHANCED_BUNDLE_CONFIG = {};
      const cfg = window.ENHANCED_BUNDLE_CONFIG;
      const ds = root.dataset || {};
      if (cfg.carouselStyle == null && ds.carouselStyle) cfg.carouselStyle = ds.carouselStyle;
      if (cfg.enableAutoplay == null && ds.enableAutoplay) cfg.enableAutoplay = (String(ds.enableAutoplay) === 'true' || ds.enableAutoplay === 'on' || ds.enableAutoplay === '1');
      if (cfg.autoplaySpeed == null && ds.autoplaySpeed) cfg.autoplaySpeed = Number(ds.autoplaySpeed) * 1000; // section gives seconds
      if (cfg.keyboardNav == null && ds.keyboardNav) cfg.keyboardNav = (String(ds.keyboardNav) === 'true' || ds.keyboardNav === 'on' || ds.keyboardNav === '1');
      if (cfg.touchGestures == null && ds.touchGestures) cfg.touchGestures = (String(ds.touchGestures) === 'true' || ds.touchGestures === 'on' || ds.touchGestures === '1');
    } catch(_) {}
    const heroEnabled = !cfg || cfg.enabled !== false;
    const heroEmoji = (cfg && cfg.emoji) || '🎁';
    const heroTitle = (cfg && cfg.title) || 'Premium Collection';
    const heroSubtitle = (cfg && cfg.subtitle) || 'Special bundles curated with care for our customers.';
    const heroStart = (cfg && cfg.colorStart) || '#6366f1';
    const heroEnd = (cfg && cfg.colorEnd) || '#8b5cf6';
    const headerHTML = `
      <div class="bb">
        ${heroEnabled ? `
        <div class="bb__header" style="background: linear-gradient(135deg, ${heroStart} 0%, ${heroEnd} 100%);">
          <div class="bb__hero-icons" aria-hidden="true">${heroEmoji}</div>
          <h2 class="bb__title">${heroTitle}</h2>
          <p class="bb__desc">${heroSubtitle}</p>
        </div>` : ''}
        <div class="bb__swiper swiper" role="region" aria-label="Bundle carousel">
          <div class="swiper-wrapper">
            ${bundles.map((b) => `
              <div class="swiper-slide">
                ${renderCardForSwiper(b)}
              </div>
            `).join('')}
          </div>
          <div class="swiper-pagination" role="tablist" aria-label="Bundle pagination"></div>
          <button class="bb__nav bb__nav--left swiper-button-prev" aria-label="Previous bundle"></button>
          <button class="bb__nav bb__nav--right swiper-button-next" aria-label="Next bundle"></button>
        </div>
        
      </div>
    `;

    root.innerHTML = headerHTML;

    ensureSwiperAssets().then(() => {
      const cfgAll = (window.ENHANCED_BUNDLE_CONFIG || {});
      const plan = cfgAll.plan || 'FREE';
      const style = cfgAll.carouselStyle || 'coverflow';
      const isPro = plan === 'PRO';
      const isCube = style === 'cube' || style === 'cube-modern';

  const totalSlides = (bundles && bundles.length) ? bundles.length : 0;
  // Loop any style when more than one slide to keep pagination continuous
  const enableLoop = totalSlides > 1;
  // Autoplay from config (default ON). Works for all styles including cube
  const enableAutoplay = (cfgAll.enableAutoplay !== false);
  const autoplayDelayMs = Number(cfgAll.autoplaySpeed || 3500);

      const chosenEffect = (() => {
        if (!isPro) return 'slide';
        if (style === 'cube-modern') return 'cube';
        if (style === 'flip') return 'flip';
        if (style === 'slide') return 'slide';
        if (style === 'motion') return 'slide';
        return 'coverflow';
      })();

      const modules = [];
      if (chosenEffect === 'cube' && window.Swiper.EffectCube) {
        modules.push(window.Swiper.EffectCube);
      }
      if (chosenEffect === 'flip' && window.Swiper.EffectFlip) {
        modules.push(window.Swiper.EffectFlip);
      }
      if (chosenEffect === 'coverflow' && window.Swiper.EffectCoverflow) {
        modules.push(window.Swiper.EffectCoverflow);
      }
      if (window.Swiper.Navigation) modules.push(window.Swiper.Navigation);
      if (window.Swiper.Pagination) modules.push(window.Swiper.Pagination);
      if (window.Swiper.Keyboard) modules.push(window.Swiper.Keyboard);
      if (window.Swiper.A11y) modules.push(window.Swiper.A11y);

  const el = root.querySelector('.bb__swiper');
  
  // Add CSS class for the chosen style on both container and swiper so CSS matches
  try {
    const bbContainer = root.querySelector('.bb');
    const STYLE_FLAGS = ['bb--cube','bb--cube-modern','bb--flip','bb--coverflow','bb--classic','bb--loop','bb--motion'];
    const CARD_STYLE_FLAGS = ['bb--card-minimal','bb--card-modern','bb--card-glass','bb--card-premium','bb--card-premium-gradient','bb--card-neumorph','bb--card-outline','bb--card-image-dominant','bb--card-depth','bb--card-flip'];
    
    if (bbContainer) {
      STYLE_FLAGS.forEach(c => bbContainer.classList.remove(c));
      bbContainer.classList.add(`bb--${style}`);
      
      // Apply card style class
      const cardStyle = cfgAll.cardStyle || 'modern';
      CARD_STYLE_FLAGS.forEach(c => bbContainer.classList.remove(c));
      bbContainer.classList.add(`bb--card-${cardStyle}`);
    }
    if (el) {
      STYLE_FLAGS.forEach(c => el.classList.remove(c));
      el.classList.add(`bb--${style}`);
      
      // Apply card style class to swiper as well
      const cardStyle = cfgAll.cardStyle || 'modern';
      CARD_STYLE_FLAGS.forEach(c => el.classList.remove(c));
      el.classList.add(`bb--card-${cardStyle}`);
    }
  } catch(_) {}
  
  const swiper = new Swiper(el, {
        modules,
        effect: chosenEffect,
        grabCursor: true,
        roundLengths: true,
        centeredSlides: isCube ? true : isPro,
        slidesPerView: isCube ? 1 : 'auto',
        spaceBetween: isCube ? 0 : 16,
    loop: isCube ? false : enableLoop,   // ✅ cube runs without Swiper loop to avoid overlap
    rewind: true,
        cubeEffect: isCube ? {
          shadow: true,
          shadowOffset: 40,
          shadowScale: 0.7,
          slideShadows: (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? false : true
        } : undefined,
        coverflowEffect: chosenEffect === 'coverflow' ? {
          rotate: 30,
          stretch: 0,
          depth: 140,
          modifier: 1,
          slideShadows: true,
        } : undefined,
        flipEffect: chosenEffect === 'flip' ? {
          slideShadows: true,
          limitRotation: true,
        } : undefined,
        pagination: { 
          el: el.querySelector('.swiper-pagination'), 
          clickable: true,
          bulletActiveClass: 'swiper-pagination-bullet-active',
          renderBullet: function (index, className) {
            return `<span class="${className}" role="tab" aria-label="Go to slide ${index + 1}"></span>`;
          }
        },
        navigation: { 
          nextEl: el.querySelector('.swiper-button-next'), 
          prevEl: el.querySelector('.swiper-button-prev') 
        },
        keyboard: {
          enabled: cfgAll.keyboardNav !== false,
          onlyInViewport: true,
        },
        a11y: {
          enabled: true,
          prevSlideMessage: 'Previous slide',
          nextSlideMessage: 'Next slide',
          firstSlideMessage: 'This is the first slide',
          lastSlideMessage: 'This is the last slide',
        },
    autoplay: enableAutoplay ? { delay: autoplayDelayMs, disableOnInteraction: false, pauseOnMouseEnter: true } : false,
    watchOverflow: true,
    resistanceRatio: 0.85,
    speed: isCube ? 700 : 500,
    on: {
      afterInit(s) {
        try {
          s.updateSlides();
          // Map any extra slides to the 4 cube faces by index, prevents drift
          s.slides.forEach((slide, idx) => {
            slide.style.transformStyle = 'preserve-3d';
            slide.style.backfaceVisibility = 'hidden';
            // Normalize any residual scale/translate
            if (slide.style && slide.style.transform) {
              slide.style.transform = slide.style.transform.replace(/scale\([^)]+\)/, 'scale(1)');
            }
            // No hard transforms set here; Swiper handles faces. This ensures CSS baseline.
          });
          if (enableAutoplay && s.autoplay) s.autoplay.start();
        } catch(_) {}
      },
      resize(s) { try { s.updateSlides(); } catch(_) {} },
      slideChangeTransitionEnd(s) {
        if (!isCube) return;
        try {
          const slides = Array.from(s.slides || []);
          const total = slides.length;
          // Reassert 3D context and normalize transforms each transition
          slides.forEach((slide, i) => {
            slide.style.transformStyle = 'preserve-3d';
            slide.style.backfaceVisibility = 'hidden';
            slide.style.marginLeft = 'auto';
            slide.style.marginRight = 'auto';
            if (slide.style.transform) {
              slide.style.transform = slide.style.transform.replace(/scale\([^)]+\)/, 'scale(1)');
            }
          });
          // Modulo mapping hint (no manual transform override; Swiper keeps cube) to avoid overlaps
          const active = s.activeIndex % total;
          if (Number.isFinite(active)) {
            const activeSlide = slides[active];
            if (activeSlide) {
              activeSlide.style.marginLeft = 'auto';
              activeSlide.style.marginRight = 'auto';
            }
          }
        } catch(_) {}
      }
    }
      });
    }).catch(() => {/* ignore asset load errors */});

    // Pro-only: live hero editor in Theme Editor or with query flag
    try {
      const isThemeEditor = typeof Shopify !== 'undefined' && Shopify && Shopify.designMode;
      const debugFlag = /[?&]bbHeroEditor=1(&|$)/.test(location.search);
      const isProPlan = (window.ENHANCED_BUNDLE_CONFIG && window.ENHANCED_BUNDLE_CONFIG.plan) === 'PRO';
      if ((isThemeEditor || debugFlag) && isProPlan) {
        attachHeroEditor(root);
      }
      // Always attach carousel editor in editor/debug for live preview
      if (isThemeEditor || /[?&]bbCarouselEditor=1(&|$)/.test(location.search)) {
        attachCarouselEditor(root);
      }
    } catch(_) { /* no-op */ }
  }

  function attachHeroEditor(root){
    try {
      const cfg = (window.ENHANCED_BUNDLE_CONFIG && window.ENHANCED_BUNDLE_CONFIG.hero) || {};
      const panel = document.createElement('div');
      panel.className = 'bb__editor';
      panel.style.zIndex = '60';
      panel.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, { passive: true });
      panel.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
      panel.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
      panel.addEventListener('click', (e) => { e.stopPropagation(); });
      panel.style.zIndex = '60';
      panel.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, { passive: true });
      panel.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: true });
      panel.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
      panel.addEventListener('click', (e) => { e.stopPropagation(); });
      panel.innerHTML = (
        '<div class="bb__editor-title">Hero Editor (live preview)</div>'+
        '<label class="bb__editor-row"><input type="checkbox" class="bbE-enabled"> Show hero</label>'+
        '<label class="bb__editor-row">Emoji <input class="bbE-emoji" type="text" maxlength="4" style="width:4em"></label>'+
        '<label class="bb__editor-row">Title <input class="bbE-title" type="text"></label>'+
        '<label class="bb__editor-row">Subtitle <input class="bbE-sub" type="text" placeholder="Leave empty to hide"></label>'+
        '<div class="bb__editor-grid">'+
          '<label>Start <input class="bbE-c1" type="color"></label>'+
          '<label>End <input class="bbE-c2" type="color"></label>'+
        '</div>'+
        '<div class="bb__editor-row" style="justify-content:flex-end; gap:8px">'+
          '<button type="button" class="bbE-save" style="padding:6px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#111827;color:#fff;cursor:pointer">Save</button>'+
          '<span class="bbE-status" style="font-size:12px;color:#6b7280"></span>'+
        '</div>'+
        '<div class="bb__editor-help">Changes preview immediately. Saving writes to App → Pricing → Hero Customization.</div>'
      );
      root.appendChild(panel);

      const enabled = panel.querySelector('.bbE-enabled');
      const emoji = panel.querySelector('.bbE-emoji');
      const title = panel.querySelector('.bbE-title');
      const sub = panel.querySelector('.bbE-sub');
      const c1 = panel.querySelector('.bbE-c1');
      const c2 = panel.querySelector('.bbE-c2');
      const saveBtn = panel.querySelector('.bbE-save');
      const statusEl = panel.querySelector('.bbE-status');

      enabled.checked = cfg.enabled !== false;
      emoji.value = cfg.emoji || '🎁';
      title.value = (cfg.title ?? '');
      if (!title.value) title.value = 'Premium Collection';
      sub.value = (cfg.subtitle ?? '');
      c1.value = toColor((cfg.colorStart ?? '#6366f1'));
      c2.value = toColor((cfg.colorEnd ?? '#8b5cf6'));

      const update = () => {
        try {
          if (!window.ENHANCED_BUNDLE_CONFIG) window.ENHANCED_BUNDLE_CONFIG = {};
          window.ENHANCED_BUNDLE_CONFIG.hero = {
            enabled: enabled.checked,
            emoji: emoji.value || '🎁',
            title: title.value || 'Premium Collection',
            // IMPORTANT: allow empty subtitle (no fallback)
            subtitle: (sub.value ?? ''),
            colorStart: c1.value || '#6366f1',
            colorEnd: c2.value || '#8b5cf6',
          };
          // Re-render only the header area for speed
          const bb = root.querySelector('.bb');
          if (!bb) return;
          const header = bb.querySelector('.bb__header');
          if (header) header.remove();
          const cfg2 = window.ENHANCED_BUNDLE_CONFIG.hero;
          if (cfg2.enabled !== false){
            const headerEl = document.createElement('div');
            headerEl.className = 'bb__header';
            headerEl.style.background = `linear-gradient(135deg, ${cfg2.colorStart} 0%, ${cfg2.colorEnd} 100%)`;
            const hasSubtitle = !!(cfg2.subtitle && String(cfg2.subtitle).trim().length);
            headerEl.innerHTML = (
              `<div class="bb__hero-icons" aria-hidden="true">${cfg2.emoji || '🎁'}</div>`+
              `<h2 class="bb__title">${cfg2.title || ''}</h2>`+
              (hasSubtitle ? `<p class="bb__desc">${cfg2.subtitle}</p>` : '')
            );
            bb.prepend(headerEl);
          }
        } catch(_) {}
      };
      ['change','input'].forEach(evt => {
        enabled.addEventListener(evt, update);
        emoji.addEventListener(evt, update);
        title.addEventListener(evt, update);
        sub.addEventListener(evt, update);
        c1.addEventListener(evt, update);
        c2.addEventListener(evt, update);
      });

      // Save to admin route (App → Pricing → Hero Customization)
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          try {
            statusEl.textContent = 'Saving…';
            const form = new FormData();
            form.set('intent', 'hero');
            form.set('heroEnabled', enabled.checked ? 'on' : 'off');
            form.set('heroTitle', title.value || '');
            form.set('heroSubtitle', sub.value || '');
            form.set('heroEmoji', emoji.value || '');
            form.set('heroColorStart', c1.value || '');
            form.set('heroColorEnd', c2.value || '');
            // Save via app proxy endpoint so it works from storefront/theme editor
            const urlParams = new URLSearchParams(location.search);
            const shopFromQuery = urlParams.get('shop') || urlParams.get('shopify') || '';
            const shopFromGlobal = (window.Shopify && Shopify.shop) ? String(Shopify.shop) : '';
            const shop = shopFromGlobal || shopFromQuery || (root && root.dataset && root.dataset.shop) || '';
            const shopParam = shop ? `?shop=${encodeURIComponent(shop)}` : '';
            // Use app proxy path under /apps/bundles/* per app proxy config
            const res = await fetch(`/apps/bundles/hero${shopParam}`, { method: 'POST', body: form, credentials: 'include', cache: 'no-store' });
            if (res.ok) {
              statusEl.textContent = 'Saved';
              setTimeout(() => statusEl.textContent = '', 2000);
            } else {
              statusEl.textContent = 'Save failed';
            }
          } catch(_) {
            statusEl.textContent = 'Save failed';
          }
        });
      }
    } catch(_) { /* no-op */ }
  }

  function attachCarouselEditor(root){
    try {
      const isThemeEditor = typeof Shopify !== 'undefined' && Shopify && Shopify.designMode;
      const debugFlag = /[?&]bbCarouselEditor=1(&|$)/.test(location.search);
      const isProPlan = (window.ENHANCED_BUNDLE_CONFIG && window.ENHANCED_BUNDLE_CONFIG.plan) === 'PRO';
      if (!(isThemeEditor || debugFlag)) return;

      const cfg = (window.ENHANCED_BUNDLE_CONFIG || {});
      const panel = document.createElement('div');
      panel.className = 'bb__editor';
      panel.innerHTML = (
        '<div class="bb__editor-title">Carousel Editor (live preview)</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        '<label class="bb__editor-row">Style '+
          '<select class="bbC-style">'+
            '<option value="slide">Classic Slide</option>'+
            '<option value="coverflow">Coverflow (Swiper)</option>'+
          '<option value="cube-modern">Cube (Modern)</option>'+
          '<option value="motion">Center Pop (Custom)</option>'+
          '</select>'+
        '</label>'+
        '<label class="bb__editor-row">Card style '+
          '<select class="bbC-card">'+
            '<option value="modern">Modern Glassmorphism</option>'+
            '<option value="premium-gradient">Premium Gradient</option>'+
            '<option value="minimal">Minimal Clean</option>'+
            '<option value="glass">Enhanced Glass</option>'+
            '<option value="neumorph">Neumorphism</option>'+
            '<option value="outline">Bordered / Outline</option>'+
            '<option value="image-dominant">Image-Dominant</option>'+
            '<option value="depth">Card with Depth</option>'+
            '<option value="flip">Flip Effect</option>'+
          '</select>'+
        '</label>'+
        '<label class="bb__editor-row">Button color <input class="bbC-btncolor" type="color"/></label>'+
        '<label class="bb__editor-row">Badge color <input class="bbC-badgecolor" type="color"/></label>'+
        '<label class="bb__editor-row">Container background <input class="bbC-bg" type="color"/></label>'+
        '<label class="bb__editor-row"><input type="checkbox" class="bbC-autoplay"> Enable autoplay</label>'+
        '<label class="bb__editor-row">Speed (ms) <input type="number" class="bbC-speed" min="500" step="100" style="width:8em"></label>'+
        '</div>'+
        '<div class="bb__editor-row" style="justify-content:flex-end; gap:8px">'+
          '<button type="button" class="bbC-save" style="padding:6px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#111827;color:#fff;cursor:pointer">Save</button>'+
          '<span class="bbC-status" style="font-size:12px;color:#6b7280"></span>'+
        '</div>'
      );
      root.appendChild(panel);

      const selStyle = panel.querySelector('.bbC-style');
      const selCard = panel.querySelector('.bbC-card');
      const chkAuto = panel.querySelector('.bbC-autoplay');
      const numSpeed = panel.querySelector('.bbC-speed');
      const inpBtn = panel.querySelector('.bbC-btncolor');
      const inpBadge = panel.querySelector('.bbC-badgecolor');
      const inpBg = panel.querySelector('.bbC-bg');

      // Normalize and set initial values
      const initialStyle = String(cfg.carouselStyle || 'coverflow');
      if (selStyle.querySelector(`option[value="${initialStyle}"]`)) {
        selStyle.value = initialStyle;
      } else {
        selStyle.value = 'slide';
      }
      selCard.value = (String(cfg.cardStyle || 'modern').toLowerCase().replace(/\s+/g,'-'));
      chkAuto.checked = !!(cfg.enableAutoplay ?? true);
      numSpeed.value = Number(cfg.autoplaySpeed || 3500);
      try { inpBtn.value = toColor(cfg.buttonBg || '#6366f1'); } catch(_) {}
      try { inpBadge.value = toColor(cfg.badgeBg || '#8b5cf6'); } catch(_) {}
      try { inpBg.value = toColor(cfg.containerBg || (getComputedStyle(root).backgroundColor || '#0f172a')); } catch(_) {}

      const applyColors = () => {
        try {
          if (!window.ENHANCED_BUNDLE_CONFIG) window.ENHANCED_BUNDLE_CONFIG = {};
          const rs = root.style;
          const btn = (inpBtn.value || '').trim();
          const badge = (inpBadge.value || '').trim();
          const bg = (inpBg.value || '').trim();
          window.ENHANCED_BUNDLE_CONFIG.buttonBg = btn || undefined;
          window.ENHANCED_BUNDLE_CONFIG.badgeBg = badge || undefined;
          window.ENHANCED_BUNDLE_CONFIG.containerBg = bg || undefined;
          if (btn) rs.setProperty('--bb-button-bg', btn); else rs.removeProperty('--bb-button-bg');
          if (badge) rs.setProperty('--bb-badge-bg', badge); else rs.removeProperty('--bb-badge-bg');
          if (bg) { rs.background = bg; } else { rs.background = ''; }
        } catch(_) {}
      };

      const apply = () => {
        try {
          if (!window.ENHANCED_BUNDLE_CONFIG) window.ENHANCED_BUNDLE_CONFIG = {};
          window.ENHANCED_BUNDLE_CONFIG.carouselStyle = selStyle.value;
          window.ENHANCED_BUNDLE_CONFIG.cardStyle = selCard.value;
          window.ENHANCED_BUNDLE_CONFIG.enableAutoplay = chkAuto.checked;
          window.ENHANCED_BUNDLE_CONFIG.autoplaySpeed = Number(numSpeed.value || 3500);
          // Keep latest colors without forcing rerender
          applyColors();
          // Re-render carousel with cached bundles
          const bundles = root.__bb_bundles;
          if (Array.isArray(bundles) && bundles.length) {
            renderBundleGrid(root, bundles);
          }
        } catch(_) {}
      };

      // Changes that require re-render
      ['change','input'].forEach(evt => {
        selStyle.addEventListener(evt, apply);
        selCard.addEventListener(evt, apply);
        chkAuto.addEventListener(evt, apply);
        numSpeed.addEventListener(evt, apply);
      });
      // Color pickers: only update variables to avoid panel losing focus
      ['change','input'].forEach(evt => {
        inpBtn.addEventListener(evt, applyColors);
        inpBadge.addEventListener(evt, applyColors);
        inpBg.addEventListener(evt, applyColors);
      });

      // Disable advanced effects on FREE
      if (!isProPlan) {
        ['cube','cube-modern','flip','coverflow','motion','loop'].forEach(v => {
          const opt = selStyle.querySelector(`option[value="${v}"]`);
          if (opt && v !== 'slide') opt.disabled = true;
        });
        selStyle.value = 'slide';
      }

      // Save handler (persist choices via app proxy)
      const saveBtn = panel.querySelector('.bbC-save');
      const statusEl = panel.querySelector('.bbC-status');
      if (saveBtn) {
        saveBtn.addEventListener('click', async (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          try {
            statusEl.textContent = 'Saving…';
            const form = new FormData();
            form.set('style', selStyle.value);
            form.set('cardStyle', selCard.value);
            form.set('autoplay', chkAuto.checked ? 'on' : 'off');
            form.set('speedMs', String(Number(numSpeed.value || 3500)));
            form.set('buttonBg', (inpBtn.value || ''));
            form.set('badgeBg', (inpBadge.value || ''));
            form.set('containerBg', (inpBg.value || ''));
            const urlParams = new URLSearchParams(location.search);
            const shopFromQuery = urlParams.get('shop') || urlParams.get('shopify') || '';
            const shopFromGlobal = (window.Shopify && Shopify.shop) ? String(Shopify.shop) : '';
            const shop = shopFromGlobal || shopFromQuery || (root && root.dataset && root.dataset.shop) || '';
            const shopParam = shop ? `?shop=${encodeURIComponent(shop)}` : '';
            const res = await fetch(`/apps/bundles/carousel${shopParam}`, { method: 'POST', body: form, credentials: 'include', cache: 'no-store' });
            let body = null; try { body = await res.json(); } catch(_) {}
            if (res.ok && body && body.ok) {
              statusEl.textContent = 'Saved';
              try {
                // Immediately update in-memory config and container bg to avoid refresh loops
                if (!window.ENHANCED_BUNDLE_CONFIG) window.ENHANCED_BUNDLE_CONFIG = {};
                window.ENHANCED_BUNDLE_CONFIG.carouselStyle = selStyle.value;
                window.ENHANCED_BUNDLE_CONFIG.cardStyle = selCard.value;
                window.ENHANCED_BUNDLE_CONFIG.enableAutoplay = chkAuto.checked;
                window.ENHANCED_BUNDLE_CONFIG.autoplaySpeed = Number(numSpeed.value || 3500);
                window.ENHANCED_BUNDLE_CONFIG.buttonBg = (inpBtn.value || '');
                window.ENHANCED_BUNDLE_CONFIG.badgeBg = (inpBadge.value || '');
                window.ENHANCED_BUNDLE_CONFIG.containerBg = (inpBg.value || '');
                const rs = root.style; const bg = (inpBg.value || '').trim();
                if (bg) rs.background = bg; else rs.background = '';
              } catch(_) {}
              setTimeout(() => statusEl.textContent = '', 2000);
            } else {
              statusEl.textContent = 'Save failed';
              console.warn('[BundleApp] carousel save failed', res.status, body);
            }
          } catch(err) {
            statusEl.textContent = 'Save failed';
            console.error('[BundleApp] carousel save error', err);
          }
        });
      }
    } catch(_) { /* no-op */ }
  }

  function toColor(v){
    try {
      if (!v) return '#000000';
      if (/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v)) return v;
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = v;
      return ctx.fillStyle || '#000000';
    } catch(_) { return '#000000'; }
  }

  // hero header removed

  function renderCardForSwiper(bundle) {
          const hasDiscount = bundle.originalPrice && bundle.originalPrice > bundle.finalPrice;
          const discountPercent = hasDiscount ? Math.round(((bundle.originalPrice - bundle.finalPrice) / bundle.originalPrice) * 100) : 0;
          return `
            <div class="bb__bundle-card" role="article" tabindex="0" aria-labelledby="bundle-${bundle.id}-title">
              ${hasDiscount ? `<div class="bb__discount-badge" aria-label="${discountPercent}% discount">${discountPercent}% OFF</div>` : ''}
              <div class="bb__bundle-image">
                ${bundle.imageUrl ? `<img src="${utils.makeAbsolute(bundle.imageUrl)}" alt="${bundle.title}" loading="lazy"/>` : ''}
              </div>
              <div class="bb__bundle-info">
                <div class="bb__bundle-header">
            <h3 class="bb__bundle-title" id="bundle-${bundle.id}-title">${bundle.title}</h3>
          </div>
          ${bundle.description ? `<p class="bb__bundle-desc">${bundle.description}</p>` : ''}
          <div class="bb__bundle-meta" role="list" aria-label="Bundle details">
            <span class="bb__bundle-type" role="listitem">${bundle.type}</span>
            <span class="bb__bundle-products" role="listitem">${bundle.productCount} items</span>
            <span class="bb__bundle-wraps" role="listitem">${bundle.wrapCount ?? 0} wraps</span>
          </div>
          <button class="bb__bundle-select" onclick="selectBundle('${bundle.id}')" aria-describedby="bundle-${bundle.id}-title">
            <span class="bb__btn-text">Select Bundle</span>
          </button>
        </div>
      </div>`;
  }
 
  function ensureSwiperAssets() {
    return new Promise((resolve, reject) => {
      try {
        // CSS
        if (!document.querySelector('link[data-bb-swiper]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css';
          link.setAttribute('data-bb-swiper', '1');
          document.head.appendChild(link);
        }
        // JS
        if (window.Swiper) { resolve(); return; }
        if (!document.querySelector('script[data-bb-swiper]')) {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js';
          s.async = true;
          s.setAttribute('data-bb-swiper', '1');
          s.onload = () => {
            // Ensure modules are available
            if (window.Swiper && window.Swiper.EffectCube) {
              resolve();
            } else {
              reject(new Error('Swiper modules not loaded'));
            }
          };
          s.onerror = () => reject();
          document.body.appendChild(s);
        } else {
          // wait a tick for existing script to load
          const check = () => {
            if (window.Swiper && window.Swiper.EffectCube) {
              resolve();
            } else {
              setTimeout(check, 50);
            }
          };
          check();
        }
      } catch (e) { reject(e); }
    });
  }

  function showError(root, title, message) {
    root.innerHTML = `
      <div class="bb bb__error" role="alert">
        <div class="bb__error-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        </div>
        <h3>${title}</h3>
        <p>${message}</p>
        <button onclick="location.reload()" class="bb__retry">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23,4 23,10 17,10"></polyline>
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"></path>
          </svg>
          Try Again
        </button>
      </div>
    `;
  }

  function showEmpty(root) {
    root.innerHTML = `
      <div class="bb bb__empty">
        <div class="bb__empty-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"></path>
          </svg>
        </div>
        <h3>No Bundles Available</h3>
        <p>We're working on some amazing new 3D ring collections. Check back soon for exciting bundle offers!</p>
        <div class="bb__empty-features">
          <div class="bb__feature">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
              <polyline points="22,4 12,14.01 9,11.01"></polyline>
            </svg>
            <span>Premium Quality</span>
          </div>
          <div class="bb__feature">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
            <span>Thoughtful Curation</span>
          </div>
          <div class="bb__feature">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>Personal Touch</span>
          </div>
        </div>
      </div>
    `;
  }

  // Initialize when DOM is ready
  function start(){
    document.querySelectorAll('[id^="bundle-builder-"]').forEach(init);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Re-initialize when the section is reloaded in the Theme Editor
  document.addEventListener('shopify:section:load', (event) => {
    try {
      const section = event && event.target ? event.target : null;
      if (!section) return;
      const container = section.querySelector('[id^="bundle-builder-"]');
      if (container) init(container);
    } catch(_) { /* no-op */ }
  });

  // Also respond to select/deselect events in the theme editor for immediate feedback
  ['shopify:section:select','shopify:section:deselect','shopify:section:unload'].forEach((evt) => {
    document.addEventListener(evt, (event) => {
      try {
        const section = event && event.target ? event.target : null;
        if (!section) return;
        const container = section.querySelector('[id^="bundle-builder-"]');
        if (!container) return;
        // If we have cached bundles, re-render header immediately
        const bundles = container.__bb_bundles;
        if (Array.isArray(bundles) && bundles.length) {
          renderBundleGrid(container, bundles);
        } else {
          // fall back to a fresh init
          init(container);
        }
      } catch(_) { /* no-op */ }
    });
  });

  // Removed: hero attribute observer (feature disabled)
  const heroAttrObserver = { observe: function(){}, disconnect: function(){} };

  // No attribute observing needed
  // Global error handler
  window.addEventListener('error', function(e) {
    try {
      const targetScript = e && e.filename && typeof e.filename === 'string' && e.filename.includes('bundle.js');
      if (!targetScript) return;
      const containers = document.querySelectorAll('[id^="bundle-builder-"]');
      containers.forEach((container) => {
        if (!container) return;
        container.innerHTML = (
          '<div class="bb__error" role="alert">' +
          '<div class="bb__error-icon">' +
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<circle cx="12" cy="12" r="10"></circle>' +
          '<line x1="15" y1="9" x2="9" y2="15"></line>' +
          '<line x1="9" y1="9" x2="15" y2="15"></line>' +
          '</svg>' +
          '</div>' +
          '<h3>Unable to Load Bundle Builder</h3>' +
          '<p>There was a problem loading the bundle interface. Please refresh the page or try again later.</p>' +
          '<button class="bb__retry">Refresh Page</button>' +
          '</div>'
        );
        const btn = container.querySelector('.bb__retry');
        if (btn) btn.addEventListener('click', function(){ location.reload(); });
      });
    } catch(_) { /* no-op */ }
  });

})();