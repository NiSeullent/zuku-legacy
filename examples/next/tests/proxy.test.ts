import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { signRewrite, verifyRewrite } from '../lib/rewrite-proof';

const classicUA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)';
function request(path: string, ua = classicUA, extras: Record<string, string> = {}) {
  return new NextRequest('https://zuku.example' + path, { headers: { 'user-agent': ua, ...extras } });
}

test('classic normal URL rewrites internally with exact original path/query and no redirect', () => {
  const response = proxy(request('/community/post_1?mode=text&q=a%2Bb', classicUA, { 'x-zuku-lc-original-path': '/admin' }));
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://zuku.example/legacy/thread/post_1?mode=text&q=a%2Bb');
  assert.equal(response.headers.get('x-middleware-request-x-zuku-lc-original-path'), '/community/post_1?mode=text&q=a%2Bb');
  assert.equal(response.headers.get('location'), null);
  assert.match(response.headers.get('vary') || '', /User-Agent/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('modern and unknown browsers preserve the original route', () => {
  for (const ua of ['Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36', 'unknown browser', '']) {
    const response = proxy(request('/', ua, { 'x-zuku-lc-original-path': '/community/forged' }));
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(response.headers.get('x-middleware-rewrite'), null);
    assert.equal(response.headers.get('x-middleware-request-x-zuku-lc-original-path'), null);
    assert.match(response.headers.get('vary') || '', /User-Agent/);
  }
});

test('classic detection never captures auth, API, assets, admin or internal Legacy paths', () => {
  for (const path of ['/api/v1/auth/login', '/auth/callback', '/admin', '/_next/static/chunk.js', '/legacy/approve', '/legacy/actions/comment', '/legacy/assets/neonux-lc.js']) {
    const response = proxy(request(path));
    assert.equal(response.headers.get('x-middleware-rewrite'), null, path);
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
  }
});

test('internal second pass preserves only a fresh proxy-generated original-path proof', () => {
  const first = proxy(request('/community/post_1?mode=text'));
  const original = first.headers.get('x-middleware-request-x-zuku-lc-original-path')!;
  const proof = first.headers.get('x-middleware-request-x-zuku-lc-rewrite-proof')!;
  const second = proxy(request('/legacy/thread/post_1?mode=text', classicUA, {
    'x-zuku-lc-original-path': original, 'x-zuku-lc-rewrite-proof': proof,
  }));
  assert.equal(second.headers.get('x-middleware-request-x-zuku-lc-original-path'), original);
  assert.equal(second.headers.get('x-middleware-request-x-zuku-lc-rewrite-proof'), null);
  for (const supplied of ['', proof.slice(0, -1) + (proof.endsWith('a') ? 'b' : 'a')]) {
    const forged = proxy(request('/legacy/thread/post_1?mode=text', classicUA, {
      'x-zuku-lc-original-path': original, 'x-zuku-lc-rewrite-proof': supplied,
    }));
    assert.equal(forged.headers.get('x-middleware-request-x-zuku-lc-original-path'), null);
  }
  const expired = signRewrite('GET', original, '/legacy/thread/post_1?mode=text', classicUA, Date.now() - 11_000);
  assert.equal(verifyRewrite(expired, 'GET', original, '/legacy/thread/post_1?mode=text', classicUA), false);
  assert.equal(verifyRewrite(proof, 'POST', original, '/legacy/thread/post_1?mode=text', classicUA), false);
  assert.equal(verifyRewrite(proof, 'GET', original, '/legacy/thread/post_2?mode=text', classicUA), false);
});
