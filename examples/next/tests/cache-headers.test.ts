import test from 'node:test';
import assert from 'node:assert/strict';
import { browserVary } from '../integration/cache-headers.mjs';
import { applyBrowserVariation } from '../integration/response-hook.mjs';

test('outer ingress adds UA variation once only to the shared public route set', () => {
  assert.equal(browserVary('/', 'rsc, Accept-Encoding'), 'rsc, Accept-Encoding, User-Agent');
  assert.equal(browserVary('/community/id', ['rsc', 'User-Agent']), 'rsc, User-Agent');
  assert.equal(browserVary('/hype', 'user-agent'), 'user-agent');
  assert.equal(browserVary('/profile/' + encodeURIComponent('주쿠'), ''), 'User-Agent');
  assert.equal(browserVary('/', '*'), '*');
  for (const path of ['/api/v1/feed', '/_next/static/chunk.js', '/admin', '/legacy/approve']) {
    assert.equal(browserVary(path, 'Accept-Encoding'), 'Accept-Encoding');
  }
});

test('fetch-compatible final response hook preserves modern body, status, cookies and cache policy', async () => {
  const body = '<html><body>Existing modern renderer</body></html>';
  const original = new Response(body, { status: 202, headers: { Vary: 'rsc', 'Cache-Control': 'public, max-age=120', 'Set-Cookie': 'existing_session=x; HttpOnly; Secure' } });
  const response = applyBrowserVariation('/', original)!;
  assert.equal(response.status, 202);
  assert.equal(await response.text(), body);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=120');
  assert.equal(response.headers.get('Set-Cookie'), 'existing_session=x; HttpOnly; Secure');
  assert.equal(response.headers.get('Vary'), 'rsc, User-Agent');
  const asset = new Response('asset');
  assert.equal(applyBrowserVariation('/_next/static/file.js', asset), asset);
  assert.equal(applyBrowserVariation('/', undefined), undefined);
});
