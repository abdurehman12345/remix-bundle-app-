(function(){
    'use strict';
    
    // Enhanced 3D Carousel Implementation
    class Enhanced3DCarousel {
      constructor(container, bundles) {
        this.container = container;
        this.bundles = bundles;
        this.currentIndex = 0;
        this.isAnimating = false;
        this.autoplayTimer = null;
        this.autoplayDelay = 5000;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.isSwiping = false;
        this.observer = null;
        this.rotationAngle = 0;
        this.cardWidth = 360;
        this.visibleCards = 5;
        
        this.init();
      }
      
      init() {
        this.render();
        this.setupEventListeners();
        this.updateNavigation();
        this.setupIntersectionObserver();
        this.startAutoplay();
        this.addProgressIndicator();
        this.initializeCardPositions();
      }
      
      render() {
        const sliderHTML = `
          <div class="bb__promo-card">
            <div class="bb__promo-icon">🎁</div>
            <h3 class="bb__promo-title">Premium 3D Collections</h3>
            <p class="bb__promo-text">Experience our revolutionary 3D carousel showcasing handpicked bundles with immersive depth, premium wrapping, and personalized touches!</p>
            <div class="bb__promo-stats">
              <div class="bb__stat">
                <span class="bb__stat-number">${this.bundles.length}</span>
                <span class="bb__stat-label">3D Collections</span>
              </div>
            </div>
          </div>
          <div class="bb__slider-wrap bb__carousel-3d">
            <div class="bb__progress-bar">
              <div class="bb__progress-fill"></div>
            </div>
            <button class="bb__nav bb__nav--left" aria-label="Previous bundles" data-direction="prev">
              <span class="bb__nav-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15,18 9,12 15,6"></polyline>
                </svg>
              </span>
            </button>
            <div class="bb__carousel-track" role="region" aria-label="3D Bundle carousel">
              ${this.bundles.map((bundle, index) => this.renderBundleCard(bundle, index)).join('')}
            </div>
            <button class="bb__nav bb__nav--right" aria-label="Next bundles" data-direction="next">
              <span class="bb__nav-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9,6 15,12 9,18"></polyline>
                </svg>
              </span>
            </button>
            <div class="bb__dots" role="tablist" aria-label="3D Bundle carousel pagination">
              ${this.bundles.map((_, i) => `
                <button class="bb__dot ${i === 0 ? 'bb__dot--active' : ''}" 
                        role="tab" 
                        aria-selected="${i===0}" 
                        aria-label="Go to slide ${i+1}" 
                        data-index="${i}">
                  <span class="bb__dot-progress"></span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
        
        this.container.innerHTML = sliderHTML;
        
        // Cache DOM elements
        this.track = this.container.querySelector('.bb__carousel-track');
        this.leftBtn = this.container.querySelector('.bb__nav--left');
        this.rightBtn = this.container.querySelector('.bb__nav--right');
        this.cards = Array.from(this.container.querySelectorAll('.bb__bundle-card'));
        this.dots = Array.from(this.container.querySelectorAll('.bb__dot'));
        this.progressBar = this.container.querySelector('.bb__progress-fill');
        
        // Enhanced card animations with 3D stagger
        this.cards.forEach((card, index) => {
          card.style.animationDelay = `${index * 200}ms`;
          card.classList.add('bb__card-animate-in');
        });
      }
      
      renderBundleCard(bundle, index) {
        const hasDiscount = bundle.originalPrice && bundle.originalPrice > bundle.finalPrice;
        const discountPercent = hasDiscount ? Math.round(((bundle.originalPrice - bundle.finalPrice) / bundle.originalPrice) * 100) : 0;
        
        return `
          <div class="bb__bundle-card bb__bundle-card--3d" data-bundle-id="${bundle.id}" data-index="${index}">
            ${hasDiscount ? `<div class="bb__discount-badge bb__discount-badge--3d">${discountPercent}% OFF</div>` : ''}
            <div class="bb__bundle-image bb__bundle-image--3d">
              ${bundle.imageUrl ? 
                `<img src="${this.makeAbsolute(bundle.imageUrl)}" alt="${bundle.title}" loading="lazy"/>` : 
                `<div class="bb__bundle-placeholder bb__bundle-placeholder--3d" aria-hidden="true">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M9 1v6m6-6v6"></path>
                  </svg>
                </div>`
              }
              <div class="bb__image-overlay bb__image-overlay--3d">
                <div class="bb__quick-view bb__quick-view--3d">3D Preview</div>
              </div>
            </div>
            <div class="bb__bundle-info bb__bundle-info--3d">
              <div class="bb__bundle-header">
                <h3 class="bb__bundle-title">${bundle.title}</h3>
              </div>
              ${bundle.description ? `<p class="bb__bundle-desc">${bundle.description}</p>` : ''}
              <div class="bb__bundle-meta bb__bundle-meta--3d" role="list">
                <span class="bb__bundle-type" role="listitem">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10"></path>
                  </svg>
                  ${bundle.type}
                </span>
                <span class="bb__bundle-products" role="listitem">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                  </svg>
                  ${bundle.productCount} items
                </span>
                ${bundle.wrapCount > 0 ? `
                  <span class="bb__bundle-wraps" role="listitem">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                    ${bundle.wrapCount} wraps
                  </span>
                ` : ''}
              </div>
              
              <button class="bb__bundle-select bb__bundle-select--3d" onclick="selectBundle('${bundle.id}')" aria-describedby="bundle-${bundle.id}-desc">
                <span class="bb__btn-text">Select 3D Bundle</span>
                <span class="bb__btn-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14m-7-7l7 7-7 7"></path>
                  </svg>
                </span>
              </button>
            </div>
          </div>
        `;
      }
      
      makeAbsolute(url) {
        if (!url) return url;
        if (/^https?:\/\//i.test(url)) return url;
        if (url.startsWith('/uploads/')) return `/apps/bundles${url}`;
        if (url.startsWith('/apps/bundles/uploads/')) return url;
        const base = (window.BUNDLE_APP_CONFIG && window.BUNDLE_APP_CONFIG.tunnelUrl) || '';
        if (url.startsWith('uploads/')) return `${base}/${url}`;
        return url;
      }
      
      initializeCardPositions() {
        this.updateCardPositions();
      }
      
      updateCardPositions() {
        const centerIndex = this.currentIndex;
        const totalCards = this.cards.length;
        
        this.cards.forEach((card, index) => {
          const offset = index - centerIndex;
          const absOffset = Math.abs(offset);
          
          // Calculate 3D positioning
          let rotateY = 0;
          let translateX = 0;
          let translateZ = 0;
          let scale = 1;
          let opacity = 1;
          
          if (offset === 0) {
            // Center card
            rotateY = 0;
            translateX = 0;
            translateZ = 80;
            scale = 1.1;
            opacity = 1;
            card.classList.add('bb__is-center');
            card.classList.remove('bb__is-left', 'bb__is-right');
          } else if (offset < 0) {
            // Left cards
            rotateY = Math.min(absOffset * 15, 45);
            translateX = offset * (this.cardWidth * 0.7);
            translateZ = -absOffset * 50;
            scale = Math.max(0.8, 1 - absOffset * 0.1);
            opacity = Math.max(0.5, 1 - absOffset * 0.2);
            card.classList.add('bb__is-left');
            card.classList.remove('bb__is-center', 'bb__is-right');
          } else {
            // Right cards
            rotateY = -Math.min(absOffset * 15, 45);
            translateX = offset * (this.cardWidth * 0.7);
            translateZ = -absOffset * 50;
            scale = Math.max(0.8, 1 - absOffset * 0.1);
            opacity = Math.max(0.5, 1 - absOffset * 0.2);
            card.classList.add('bb__is-right');
            card.classList.remove('bb__is-center', 'bb__is-left');
          }
          
          // Apply 3D transforms
          card.style.transform = `
            translateX(${translateX}px) 
            translateZ(${translateZ}px) 
            rotateY(${rotateY}deg) 
            scale(${scale})
          `;
          card.style.opacity = opacity;
          card.style.zIndex = absOffset === 0 ? 10 : Math.max(1, 10 - absOffset);
        });
      }
      
      setupEventListeners() {
        // Navigation buttons
        this.leftBtn?.addEventListener('click', () => this.navigate('prev'));
        this.rightBtn?.addEventListener('click', () => this.navigate('next'));
        
        // Keyboard navigation
        this.container?.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this.navigate('prev');
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            this.navigate('next');
          }
        });
        
        // Enhanced dots with 3D progress animation
        this.dots.forEach((dot) => {
          dot.addEventListener('click', () => {
            const idx = Number(dot.getAttribute('data-index') || 0);
            this.currentIndex = Math.max(0, Math.min(idx, this.cards.length - 1));
            this.updateCardPositions();
            this.updateNavigation();
            this.updateProgressBar();
          });
          
          dot.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              dot.click();
            }
          });
        });
        
        // Enhanced touch/swipe support for 3D
        this.setupTouchEvents();
        
        // Pause autoplay on hover/focus
        this.container.addEventListener('mouseenter', () => {
          this.stopAutoplay();
          this.container.classList.add('bb__slider-paused');
        });
        
        this.container.addEventListener('mouseleave', () => {
          this.startAutoplay();
          this.container.classList.remove('bb__slider-paused');
        });
        
        this.container.addEventListener('focusin', () => this.stopAutoplay());
        this.container.addEventListener('focusout', () => this.startAutoplay());
        
        // Mouse move for subtle 3D effects
        this.container.addEventListener('mousemove', (e) => {
          this.handleMouseMove(e);
        });
        
        // Resize handler
        window.addEventListener('resize', this.debounce(() => {
          this.updateNavigation();
          this.updateProgressBar();
          this.updateCardPositions();
        }, 250));
      }
      
      handleMouseMove(e) {
        const rect = this.container.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const mouseX = e.clientX - centerX;
        const mouseY = e.clientY - centerY;
        
        // Subtle parallax effect
        const rotateX = (mouseY / rect.height) * 5;
        const rotateY = (mouseX / rect.width) * 5;
        
        if (this.track) {
          this.track.style.transform = `rotateX(${-rotateX}deg) rotateY(${rotateY}deg)`;
        }
      }
      
      setupTouchEvents() {
        const threshold = 50;
        
        this.container?.addEventListener('touchstart', (e) => {
          if (!e.touches || e.touches.length !== 1) return;
          const touch = e.touches[0];
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;
          this.isSwiping = true;
          this.stopAutoplay();
        }, { passive: true });
        
        this.container?.addEventListener('touchmove', (e) => {
          if (!this.isSwiping || !e.touches || e.touches.length !== 1) return;
          const touch = e.touches[0];
          const deltaX = touch.clientX - this.touchStartX;
          const deltaY = touch.clientY - this.touchStartY;
          
          if (Math.abs(deltaY) > Math.abs(deltaX)) return;
          
          if (Math.abs(deltaX) > threshold) {
            this.isSwiping = false;
            if (deltaX < 0) {
              this.navigate('next');
            } else {
              this.navigate('prev');
            }
          }
        }, { passive: true });
        
        this.container?.addEventListener('touchend', () => {
          this.isSwiping = false;
          setTimeout(() => this.startAutoplay(), 2000);
        }, { passive: true });
      }
      
      setupIntersectionObserver() {
        if ('IntersectionObserver' in window) {
          this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                entry.target.classList.add('bb__card-visible');
              }
            });
          }, { threshold: 0.2 });
          
          if (this.observer) {
            this.cards.forEach(card => this.observer.observe(card));
          }
        }
      }
      
      navigate(direction) {
        if (this.isAnimating || !this.cards.length) return;
        
        this.stopAutoplay();
        this.isAnimating = true;
        
        if (direction === 'prev') {
          this.currentIndex = this.currentIndex <= 0 ? this.cards.length - 1 : this.currentIndex - 1;
        } else {
          this.currentIndex = this.currentIndex >= this.cards.length - 1 ? 0 : this.currentIndex + 1;
        }
        
        this.updateCardPositions();
        this.updateNavigation();
        this.updateProgressBar();
        
        // Add haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
        
        setTimeout(() => {
          this.isAnimating = false;
          this.startAutoplay();
        }, 800);
      }
      
      updateNavigation() {
        if (!this.leftBtn || !this.rightBtn || !this.cards.length) return;
        
        // Update ARIA labels
        this.leftBtn.setAttribute('aria-label', 'Previous 3D bundles');
        this.rightBtn.setAttribute('aria-label', 'Next 3D bundles');
  
        // Update dots state with 3D animation
        if (this.dots && this.dots.length) {
          this.dots.forEach((dot, i) => {
            const active = i === this.currentIndex;
            dot.classList.toggle('bb__dot--active', active);
            dot.setAttribute('aria-selected', String(active));
            
            // Animate dot progress with 3D effect
            const progress = dot.querySelector('.bb__dot-progress');
            if (progress) {
              if (active) {
                progress.style.transform = 'scaleX(1) translateZ(5px)';
              } else {
                progress.style.transform = 'scaleX(0) translateZ(0px)';
              }
            }
          });
        }
      }
      
      addProgressIndicator() {
        if (!this.progressBar) return;
        this.updateProgressBar();
      }
      
      updateProgressBar() {
        if (!this.progressBar || !this.cards.length) return;
        
        const progress = ((this.currentIndex + 1) / this.cards.length) * 100;
        this.progressBar.style.width = `${progress}%`;
      }
      
      startAutoplay() {
        const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced) return;
        if (this.autoplayTimer || this.cards.length <= 1) return;
        
        this.autoplayTimer = setInterval(() => {
          this.navigate('next');
        }, this.autoplayDelay);
      }
      
      stopAutoplay() {
        if (this.autoplayTimer) {
          clearInterval(this.autoplayTimer);
          this.autoplayTimer = null;
        }
      }
      
      debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      }
      
      destroy() {
        this.stopAutoplay();
        if (this.observer) {
          this.observer.disconnect();
        }
        window.removeEventListener('resize', this.updateNavigation);
      }
    }
    
    // Export for use in main bundle.js
    window.Enhanced3DCarousel = Enhanced3DCarousel;
    
  })();