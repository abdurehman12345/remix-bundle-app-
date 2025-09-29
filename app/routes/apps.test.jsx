import { json } from "@remix-run/node";

export const loader = async ({ request }) => {
  try {
    console.log('🧪 Test route called');
    console.log('🧪 Request URL:', request.url);
    console.log('🧪 Request method:', request.method);
    console.log('🧪 Request headers:', Object.fromEntries(request.headers.entries()));

    return json({ 
      message: "Test route is working!",
      timestamp: new Date().toISOString(),
      requestInfo: {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries())
      }
    }, { 
      headers: { 
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      } 
    });

  } catch (error) {
    console.error('❌ Test route error:', error);
    return json({ 
      error: "Test route error", 
      details: error.message
    }, { status: 500 });
  }
};
