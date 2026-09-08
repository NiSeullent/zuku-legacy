import test from 'node:test';
import assert from 'node:assert/strict';
import { isClassicUserAgent, publicToLegacyPath, legacyToPublicPath, PUBLIC_ROUTE_PAIRS } from '../packages/bridge/src/routing.ts';

test('positive old browser versions receive classic routing without changing modern or unknown UAs', () => {
  for (const ua of [
    'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)',
    'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1)',
    'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.0; Trident/4.0)',
    'Mozilla/5.0 (Windows NT 6.0; Trident/4.0)',
    'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)',
    'Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0)',
    'Mozilla/5.0 Chrome/110.0.0.0 Safari/537.36',
    'Mozilla/5.0 Chrome/42.0.2311.135 Safari/537.36 Edge/12.246',
    'Mozilla/5.0 Firefox/110.0',
    'Mozilla/5.0 AppleWebKit/605.1.15 Version/16.3 Safari/605.1.15',
  ]) assert.equal(isClassicUserAgent(ua), true, ua);
  for (const ua of [
    '', null, undefined, 'curl/8.0', 'unknown browser',
    'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 Firefox/140.0',
    'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 Chrome/111.0.0.0 Safari/537.36',
    'Mozilla/5.0 Firefox/111.0',
    'Mozilla/5.0 Chrome/111.0.0.0 Edg/111.0.0.0',
    'Mozilla/5.0 AppleWebKit/605.1.15 Version/16.4 Safari/605.1.15',
    'Mozilla/5.0 Chrome/130.0.0.0 Edg/130.0.0.0',
    'MSIE 0.0', 'x'.repeat(2049) + ' MSIE 6.0',
  ]) assert.equal(isClassicUserAgent(ua), false, String(ua));
});

test('public canonical navigation shares one round-trip route manifest', () => {
  for (const [path, suffix] of PUBLIC_ROUTE_PAIRS) {
    assert.equal(publicToLegacyPath(path), suffix);
    assert.equal(legacyToPublicPath(suffix), path);
    if (path !== '/') assert.equal(publicToLegacyPath(path + '/'), suffix);
  }
  for (const [path, suffix] of [['/content/item-123', '/content/item-123'], ['/community/post_1', '/thread/post_1'], ['/profile/username', '/profile/username']]) {
    assert.equal(publicToLegacyPath(path!), suffix);
    assert.equal(legacyToPublicPath(suffix!), path);
  }
  assert.equal(legacyToPublicPath('/actions/comment'), '/legacy/actions/comment');
  assert.equal(legacyToPublicPath('/assets/neonux-lc.js'), '/legacy/assets/neonux-lc.js');
  const korean = '/profile/' + encodeURIComponent('주쿠.사용자');
  assert.equal(publicToLegacyPath(korean), korean);
  assert.equal(legacyToPublicPath(korean), korean);
});

test('host API, assets, administration, auth callbacks and modern approval stay untouched', () => {
  for (const path of ['/api/v1/feed', '/_next/static/chunk.js', '/admin', '/admin/users', '/auth/callback', '/api/auth/callback', '/legacy', '/legacy/approve', '/signup', '/reset-password', '/studio', '/hype/upload', '/community/search', '/messages/thread123', '/favicon.ico']) {
    assert.equal(publicToLegacyPath(path), null, path);
  }
});

test('route mapping refuses ambiguous paths and unbounded identifiers', () => {
  for (const path of ['https://attacker.example/', '//attacker.example', '/content/a/b', '/content/..', '/content/%2fsecret', '/content/%2e%2e', '/content/item.js', '/profile/user?token=x', '/profile/user#x', '/profile/%2e%2e', '/profile/%252fadmin', '/profile/%zz', '/profile/' + '가'.repeat(81), '/community/hello world', '/community/hello\nworld', '/content/' + 'a'.repeat(129), '/content\\secret']) {
    assert.equal(publicToLegacyPath(path), null, path);
  }
});
