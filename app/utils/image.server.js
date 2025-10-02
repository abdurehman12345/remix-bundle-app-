/**
 * Image utility functions for the Bundle App
 * Handles image URL normalization and processing
 */

/**
 * Normalize image URLs to use the app proxy path
 * @param {string} url - The image URL to normalize
 * @returns {string|null} Normalized URL or null if invalid
 */
export function normalizeImageUrl(url) {
  if (!url) return null;
  
  const urlString = String(url).trim();
  
  // Already a full URL
  if (/^https?:\/\//i.test(urlString)) {
    return urlString;
  }
  
  // Convert local upload paths to app proxy paths
  const filename = urlString.replace(/^\/?uploads\//, "");
  return `/apps/bundles/uploads/${filename}`;
}

/**
 * Normalize multiple image URLs
 * @param {Array} urls - Array of image URLs
 * @returns {Array} Array of normalized URLs
 */
export function normalizeImageUrls(urls) {
  if (!Array.isArray(urls)) return [];
  return urls.map(normalizeImageUrl).filter(Boolean);
}

/**
 * Extract filename from image URL
 * @param {string} url - The image URL
 * @returns {string|null} Filename or null if not found
 */
export function extractFilename(url) {
  if (!url) return null;
  
  const urlString = String(url).trim();
  const match = urlString.match(/([^\/]+)$/);
  return match ? match[1] : null;
}

/**
 * Validate image file extension
 * @param {string} filename - The filename to validate
 * @returns {boolean} True if valid image extension
 */
export function isValidImageExtension(filename) {
  if (!filename) return false;
  
  const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
  const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return validExtensions.includes(extension);
}

/**
 * Generate responsive image srcset
 * @param {string} baseUrl - Base image URL
 * @param {Array} sizes - Array of sizes [width, height]
 * @returns {string} Srcset string
 */
export function generateSrcSet(baseUrl, sizes = [[400, 300], [800, 600], [1200, 900]]) {
  if (!baseUrl) return '';
  
  return sizes
    .map(([width, height]) => `${baseUrl}?w=${width}&h=${height} ${width}w`)
    .join(', ');
}
