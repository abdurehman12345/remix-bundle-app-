import { json } from "@remix-run/node";

export const loader = async ({ request }) => {
  try {
    console.log('🌐 HTML test route called');
    console.log('🌐 Request URL:', request.url);
    console.log('🌐 Request headers:', Object.fromEntries(request.headers.entries()));

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bundle App Test Page</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .test-section { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
        .test-button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
        .test-button:hover { background: #005a8b; }
        .result { margin-top: 10px; padding: 10px; background: #f9f9f9; border-radius: 3px; white-space: pre-wrap; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎁 Bundle App Storefront Test</h1>
            <p>Test the storefront functionality and debug any issues</p>
        </div>

        <div class="test-section">
            <h3>🧪 Basic API Tests</h3>
            <button class="test-button" onclick="testAPI('/apps')">Test Main API</button>
            <button class="test-button" onclick="testAPI('/apps/bundles')">Test Bundles List</button>
            <button class="test-button" onclick="testAPI('/apps/debug')">Test Debug Route</button>
            <div id="api-result" class="result"></div>
        </div>

        <div class="test-section">
            <h3>🔍 Bundle Lookup Test</h3>
            <input type="text" id="bundle-id" placeholder="Enter bundle ID or bundleId" style="padding: 8px; margin-right: 10px; width: 200px;">
            <button class="test-button" onclick="testBundle()">Test Bundle</button>
            <div id="bundle-result" class="result"></div>
        </div>

        <div class="test-section">
            <h3>📊 Current Status</h3>
            <div id="status-result" class="result">Click "Test Main API" to see current status</div>
        </div>

        <div class="test-section">
            <h3>🔧 Troubleshooting</h3>
            <ul>
                <li><strong>404 Bundle Not Found:</strong> Check if bundle exists and is ACTIVE</li>
                <li><strong>App Proxy Error:</strong> Verify app is deployed and proxy is configured</li>
                <li><strong>Database Issues:</strong> Check if bundles have bundleId field set</li>
                <li><strong>CORS Issues:</strong> Verify headers are set correctly</li>
            </ul>
        </div>
    </div>

    <script>
        async function testAPI(endpoint) {
            const resultDiv = document.getElementById('api-result');
            resultDiv.textContent = 'Testing...';
            resultDiv.className = 'result';
            
            try {
                const response = await fetch(endpoint);
                const data = await response.json();
                
                if (response.ok) {
                    resultDiv.textContent = '✅ Success: ' + JSON.stringify(data, null, 2);
                    resultDiv.className = 'result success';
                } else {
                    resultDiv.textContent = '❌ Error ' + response.status + ': ' + JSON.stringify(data, null, 2);
                    resultDiv.className = 'result error';
                }
            } catch (error) {
                resultDiv.textContent = '❌ Network Error: ' + error.message;
                resultDiv.className = 'result error';
            }
        }

        async function testBundle() {
            const bundleId = document.getElementById('bundle-id').value.trim();
            if (!bundleId) {
                alert('Please enter a bundle ID');
                return;
            }
            
            const resultDiv = document.getElementById('bundle-result');
            resultDiv.textContent = 'Testing bundle...';
            resultDiv.className = 'result';
            
            try {
                const response = await fetch('/apps/' + bundleId);
                const data = await response.json();
                
                if (response.ok) {
                    resultDiv.textContent = '✅ Bundle Found: ' + JSON.stringify(data, null, 2);
                    resultDiv.className = 'result success';
                } else {
                    resultDiv.textContent = '❌ Bundle Error ' + response.status + ': ' + JSON.stringify(data, null, 2);
                    resultDiv.className = 'result error';
                }
            } catch (error) {
                resultDiv.textContent = '❌ Network Error: ' + error.message;
                resultDiv.className = 'result error';
            }
        }

        // Auto-test main API on page load
        window.onload = function() {
            testAPI('/apps');
        };
    </script>
</body>
</html>
    `;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (error) {
    console.error('❌ HTML test route error:', error);
    return new Response(`<h1>Error</h1><p>${error.message}</p>`, {
      status: 500,
      headers: { "Content-Type": "text/html" }
    });
  }
};
