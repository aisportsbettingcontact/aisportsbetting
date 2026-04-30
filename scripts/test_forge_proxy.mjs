/**
 * test_forge_proxy.mjs
 * Tests if the Manus Forge API can proxy the Action Network API request
 */

import { config } from 'dotenv';
config();

const forgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;

console.log('[TEST] Forge URL:', forgeApiUrl ? 'SET' : 'NOT SET');
console.log('[TEST] Forge Key:', forgeApiKey ? 'SET (len=' + forgeApiKey.length + ')' : 'NOT SET');

if (!forgeApiUrl || !forgeApiKey) {
  console.error('[ERROR] Forge credentials not set in environment');
  process.exit(1);
}

const baseUrl = forgeApiUrl.endsWith('/') ? forgeApiUrl : forgeApiUrl + '/';
const fullUrl = new URL('webdevtoken.v1.WebDevService/CallApi', baseUrl).toString();
console.log('[TEST] Full URL:', fullUrl);

// Test 1: Try ActionNetwork/scoreboard as an API ID
try {
  const resp = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      'authorization': 'Bearer ' + forgeApiKey,
    },
    body: JSON.stringify({
      apiId: 'ActionNetwork/scoreboard',
      query: { sport: 'mlb', bookIds: '30,68', date: '20260412', periods: 'event' },
    }),
  });
  console.log('[TEST1] Status:', resp.status);
  const text = await resp.text();
  console.log('[TEST1] Body:', text.slice(0, 500));
} catch (e) {
  console.error('[TEST1] Error:', e.message);
}

// Test 2: Try a generic fetch proxy endpoint
try {
  const targetUrl = 'https://api.actionnetwork.com/web/v2/scoreboard/mlb?bookIds=30,68&date=20260412&periods=event';
  const proxyUrl = baseUrl + 'v1/proxy?url=' + encodeURIComponent(targetUrl);
  console.log('[TEST2] Proxy URL:', proxyUrl);
  const resp = await fetch(proxyUrl, {
    headers: {
      'authorization': 'Bearer ' + forgeApiKey,
    },
  });
  console.log('[TEST2] Status:', resp.status);
  const text = await resp.text();
  console.log('[TEST2] Body:', text.slice(0, 300));
} catch (e) {
  console.error('[TEST2] Error:', e.message);
}
