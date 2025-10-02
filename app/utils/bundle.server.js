/**
 * Bundle utility functions for the Bundle App
 * Centralized bundle operations and calculations
 */

import { normalizeImageUrl } from './image.server.js';

/**
 * Normalize bundle data for consistent output
 * @param {Object} bundle - Raw bundle data from database
 * @returns {Object} Normalized bundle data
 */
export function normalizeBundleData(bundle) {
  if (!bundle) return null;

  return {
    ...bundle,
    imageUrl: normalizeImageUrl(bundle.imageUrl),
    allowMessage: Boolean(bundle.allowMessage),
    allowCardUpload: Boolean(bundle.allowCardUpload),
    wrapRequired: Boolean(bundle.wrapRequired),
    messageCharLimit: bundle.messageCharLimit || null,
    personalizationFeeCents: bundle.personalizationFeeCents || null,
    pricingType: bundle.pricingType || 'SUM',
    priceValueCents: bundle.priceValueCents || null,
    minItems: bundle.minItems || null,
    maxItems: bundle.maxItems || null,
    wrappingOptions: (bundle.wrappingOptions || []).map(w => ({
      ...w,
      imageUrl: normalizeImageUrl(w.imageUrl)
    })),
    cards: (bundle.cards || []).map(c => ({
      ...c,
      imageUrl: normalizeImageUrl(c.imageUrl)
    })),
    products: (bundle.products || []).map(p => ({
      ...p,
      imageUrl: normalizeImageUrl(p.imageUrl),
      variants: normalizeVariants(p.variants || p.variantsJson)
    }))
  };
}

/**
 * Normalize product variants data
 * @param {Array|string} variants - Variants array or JSON string
 * @returns {Array} Normalized variants array
 */
export function normalizeVariants(variants) {
  if (!variants) return [];
  
  try {
    const variantsArray = Array.isArray(variants) ? variants : JSON.parse(variants);
    if (!Array.isArray(variantsArray)) return [];
    
    return variantsArray
      .filter(v => v && (v.id || v.variantId))
      .map(v => ({
        id: v.id || v.variantId,
        title: v.title || 'Variant',
        priceCents: typeof v.priceCents === 'number' ? v.priceCents : 
                   (v.price ? Math.round(parseFloat(v.price) * 100) : 0),
        imageUrl: normalizeImageUrl(v.imageUrl || v.image)
      }));
  } catch (error) {
    console.error('Error normalizing variants:', error);
    return [];
  }
}

/**
 * Calculate bundle pricing based on selected products and options
 * @param {Object} bundle - Bundle configuration
 * @param {Array} selectedProducts - Selected products with variants
 * @param {Object} options - Additional options (wrap, card, etc.)
 * @returns {Object} Pricing breakdown
 */
export function calculateBundlePrice(bundle, selectedProducts = [], options = {}) {
  const { selectedVariantMap = {}, selectedWrapId, selectedCardId } = options;
  
  // Calculate base product prices
  let subtotal = 0;
  for (const product of selectedProducts) {
    const basePrice = product.priceCents || 0;
    subtotal += basePrice;
    
    // Add variant price delta
    const chosenVariantId = selectedVariantMap[String(product.id)];
    if (chosenVariantId && product.variantsJson) {
      try {
        const variants = JSON.parse(product.variantsJson);
        const variant = variants.find(v => String(v.id) === String(chosenVariantId));
        if (variant && typeof variant.priceCents === 'number') {
          subtotal += Math.max(0, variant.priceCents - basePrice);
        }
      } catch (error) {
        console.error('Error calculating variant price:', error);
      }
    }
  }
  
  // Apply bundle-level pricing
  let total = subtotal;
  
  // Apply tier pricing if available
  if (bundle.tierPrices && bundle.tierPrices.length > 0) {
    const quantity = selectedProducts.length;
    const applicableTier = bundle.tierPrices
      .filter(t => t.minQuantity <= quantity)
      .sort((a, b) => b.minQuantity - a.minQuantity)[0];
      
    if (applicableTier) {
      total = applyPricingType(subtotal, applicableTier.pricingType, {
        valueCents: applicableTier.valueCents,
        valuePercent: applicableTier.valuePercent
      });
    }
  }
  
  // Apply bundle pricing
  if (bundle.pricingType && bundle.pricingType !== 'SUM') {
    total = applyPricingType(subtotal, bundle.pricingType, {
      valueCents: bundle.priceValueCents,
      valuePercent: bundle.priceValueCents // Assuming percent is stored in same field
    });
  }
  
  // Add wrap and card costs
  const wrapCost = selectedWrapId ? 
    (bundle.wrappingOptions?.find(w => String(w.id) === String(selectedWrapId))?.priceCents || 0) : 0;
  const cardCost = selectedCardId ? 
    (bundle.cards?.find(c => String(c.id) === String(selectedCardId))?.priceCents || 0) : 0;
  
  total += wrapCost + cardCost;
  
  return {
    subtotal,
    wrapCost,
    cardCost,
    total: Math.max(0, total),
    breakdown: {
      products: subtotal,
      bundleDiscount: subtotal - (total - wrapCost - cardCost),
      addOns: wrapCost + cardCost
    }
  };
}

/**
 * Apply pricing type calculation
 * @param {number} baseAmount - Base amount to apply pricing to
 * @param {string} pricingType - Type of pricing (FIXED, DISCOUNT_PERCENT, DISCOUNT_AMOUNT)
 * @param {Object} values - Pricing values
 * @returns {number} Calculated amount
 */
function applyPricingType(baseAmount, pricingType, values) {
  switch (pricingType) {
    case 'FIXED':
      return values.valueCents || 0;
    case 'DISCOUNT_PERCENT':
      const percent = values.valuePercent || 0;
      return Math.max(0, baseAmount - Math.floor(baseAmount * (percent / 100)));
    case 'DISCOUNT_AMOUNT':
      return Math.max(0, baseAmount - (values.valueCents || 0));
    default:
      return baseAmount;
  }
}

/**
 * Filter bundle features based on plan
 * @param {Object} bundle - Bundle data
 * @param {string} plan - User's plan (FREE or PRO)
 * @returns {Object} Filtered bundle data
 */
export function filterBundleByPlan(bundle, plan) {
  if (plan === 'PRO') {
    return bundle;
  }
  
  // Free plan restrictions
  return {
    ...bundle,
    wrappingOptions: [],
    cards: [],
    allowMessage: false,
    messageCharLimit: null,
    personalizationFeeCents: null,
    tierPrices: [],
    products: bundle.products?.slice(0, 6) || [] // Limit to 6 products on free plan
  };
}

/**
 * Validate bundle configuration
 * @param {Object} bundle - Bundle configuration
 * @returns {Object} Validation result
 */
export function validateBundle(bundle) {
  const errors = [];
  
  if (!bundle.title?.trim()) {
    errors.push('Bundle title is required');
  }
  
  if (!bundle.products || bundle.products.length === 0) {
    errors.push('At least one product is required');
  }
  
  if (bundle.pricingType === 'FIXED' && (!bundle.priceValueCents || bundle.priceValueCents <= 0)) {
    errors.push('Fixed price must be greater than 0');
  }
  
  if (bundle.minItems && bundle.maxItems && bundle.minItems > bundle.maxItems) {
    errors.push('Minimum items cannot be greater than maximum items');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
