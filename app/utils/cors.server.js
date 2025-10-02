/**
 * CORS utility functions for the Bundle App
 * Centralized CORS handling to avoid duplication
 */

const ALLOWED_ORIGINS = [
  'https://store-revive.myshopify.com',
  // Add more origins as needed
];

/**
 * Build CORS headers for responses
 * @param {Request} request - The incoming request
 * @param {Object} options - Additional options
 * @returns {Object} CORS headers object
 */
export function buildCorsHeaders(request, options = {}) {
  const origin = request.headers.get('origin');
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Shopify-Shop-Domain',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    ...options
  };
}

/**
 * Handle CORS preflight requests
 * @param {Request} request - The incoming request
 * @returns {Response|null} CORS response or null if not OPTIONS
 */
export function handleCorsPreflightRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: buildCorsHeaders(request),
    });
  }
  return null;
}

/**
 * Create a JSON response with CORS headers
 * @param {any} data - Response data
 * @param {Object} options - Response options (status, additional headers)
 * @param {Request} request - The original request for CORS headers
 * @returns {Response} JSON response with CORS headers
 */
export function jsonWithCors(data, options = {}, request) {
  const { status = 200, headers: additionalHeaders = {} } = options;
  const corsHeaders = buildCorsHeaders(request, additionalHeaders);
  
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}
