import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  console.log('🔍 Test route loader called');
  console.log('🔍 Request URL:', request.url);
  
  try { 
    await authenticate.public.appProxy(request); 
    console.log('✅ App proxy authentication successful');
  } catch (error) {
    console.log('⚠️ App proxy authentication failed:', error.message);
  }
  
  return json({ 
    message: "Test route working",
    url: request.url,
    method: request.method,
    timestamp: new Date().toISOString()
  });
};

export const action = async ({ request }) => {
  console.log('🔍 Test route action called');
  console.log('🔍 Request URL:', request.url);
  console.log('🔍 Request method:', request.method);
  
  try { 
    await authenticate.public.appProxy(request); 
    console.log('✅ App proxy authentication successful');
  } catch (error) {
    console.log('⚠️ App proxy authentication failed:', error.message);
  }
  
  return json({ 
    message: "Test POST route working",
    url: request.url,
    method: request.method,
    timestamp: new Date().toISOString()
  });
};
