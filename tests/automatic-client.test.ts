import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyApp } from '../packages/legacy-core/src/index.js';
import { MemoryLegacyState, newSession } from '../packages/legacy-core/src/state.js';
import { signBridgeRequest } from '@zuku/legacy-bridge';

const ORIGIN = 'https://zuku.example.test';
const OLD_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)';
const MODERN_UA = 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36';
const KEY = 'c9'.repeat(32);
const TOKEN = 'modern-account-token-' + 'f'.repeat(40);
const SECURE = { secureTransport: true, clientAddress: '192.0.2.25' };
const pagination = { page: 1, per_page: 12, total: 24, total_pages: 2, has_next: true, has_prev: false, next_cursor: 'next_item', prev_cursor: null };
const content = {
  id: 'cnt_one', category: 'hype', type: 'photo_media', title: '함께 쓰는 작품', description: '같은 콘텐츠와 주소',
  creator: { id: 'usr_one', handle: 'zuku_user', display_name: '작가', avatar_url: '', is_verified: false },
  stats: { like_count: 1, comment_count: 0, view_count: 2, bookmark_count: 0, share_count: 0 },
  created_at: '2026-09-08T00:00:00Z',
};
const post = { id: 'post_one', author: content.creator, body: '같은 대화', like_count: 1, reply_count: 0, is_liked: false, created_at: content.created_at };

function ok(data: unknown) { return Response.json({ success: true, data }); }
function appFixture(handle = 'zuku_user') {
  const calls: { url: URL; method: string; authorization: string | null; body: unknown }[] = [];
  const state = new MemoryLegacyState();
  const app = createLegacyApp({
    apiOrigin: 'https://api.example.test', publicOrigin: ORIGIN, modernOrigin: ORIGIN, bridgeKey: KEY, state,
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push({ url, method: init.method || 'GET', authorization: new Headers(init.headers).get('authorization'), body: init.body });
      const item = { ...content, creator: { ...content.creator, handle } };
      if (url.pathname === '/api/v1/auth/me') return ok({ user: { id: 'usr_one', handle, display_name: '연결 사용자' } });
      if (url.pathname === '/api/v1/posts' || init.method === 'POST') return ok({ post });
      if (url.pathname.startsWith('/api/v1/creators/')) return ok({ creator: { ...item.creator, bio: '작가 소개' } });
      if (url.pathname.endsWith('/comments')) return ok({ comments: [], pagination });
      if (url.pathname.startsWith('/api/v1/contents/')) return ok({ content: item });
      if (url.pathname === '/api/v1/search') return ok({ results: [item], query: url.searchParams.get('q'), pagination });
      if (url.pathname === '/api/v1/thread/posts' || url.pathname.endsWith('/thread')) return ok({ posts: [post], next_cursor: 'post_next' });
      return ok({ feeds: [item], pagination });
    },
  });
  return { ...app, state, calls };
}

function req(path: string, init: RequestInit = {}, ua = OLD_UA): Request {
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', ua);
  return new Request(ORIGIN + path, { ...init, headers });
}
function anchors(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(match => match[1]!.replace(/&amp;/g, '&'));
}
function noInternalNavigation(html: string) {
  for (const href of anchors(html)) assert.ok(!href.startsWith('/legacy'), `ordinary navigation must stay canonical: ${href}`);
}
function form(path: string, fields: Record<string, string>, cookie: string): Request {
  return req(path, {
    method: 'POST', body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, cookie },
  });
}

test('IE6 opens the ordinary homepage with canonical navigation and internal enhancement assets', async () => {
  const app = appFixture();
  const response = await app.handle(req('/'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('vary'), 'User-Agent');
  const html = await response.text();
  assert.ok(html.includes('ZUKU Legacy'));
  assert.ok(html.includes('href="/content/cnt_one"'));
  assert.ok(html.includes('href="/community"'));
  assert.ok(html.includes('href="/login"'));
  assert.ok(html.includes('action="/search"'));
  noInternalNavigation(html);
  assert.match(html, /<link[^>]+href="\/legacy\/assets\/neonux-lc\.css"/);
  assert.match(html, /<script[^>]+src="\/legacy\/assets\/neonux-lc\.js"/);
  assert.equal(app.calls[0]!.url.pathname, '/api/v1/feeds');
  assert.equal(app.calls[0]!.authorization, null);
  for (const path of ['/legacy/assets/neonux-lc.css', '/legacy/assets/neonux-lc.js']) {
    const asset = await app.handle(req(path, {}, MODERN_UA));
    assert.equal(asset.status, 200);
  }
  assert.equal(app.calls.length, 1);
});

test('search, community, content, profiles and pagination retain canonical URLs', async () => {
  const app = appFixture();
  const cases: [string, string, string][] = [
    ['/search?q=hello&mode=text', '/api/v1/search', '/search?mode=text&q=hello&page=2'],
    ['/community', '/api/v1/thread/posts', '/community/post_one'],
    ['/community/post_one', '/api/v1/posts/post_one/thread', '/community/post_one?cursor=post_next'],
    ['/content/cnt_one', '/api/v1/contents/cnt_one', '/content/cnt_one?page=2'],
    ['/profile/zuku_user', '/api/v1/creators/zuku_user', '/community'],
  ];
  for (const [path, upstream, expectedLink] of cases) {
    const initialCalls = app.calls.length;
    const response = await app.handle(req(path));
    assert.equal(response.status, 200, path);
    const html = await response.text();
    noInternalNavigation(html);
    assert.ok(anchors(html).includes(expectedLink), expectedLink);
    assert.equal(app.calls[initialCalls]!.url.pathname, upstream);
    if (path.includes('mode=text')) assert.ok(!html.includes('<script'));
  }
});

test('encoded Korean profile handles stay canonical in both rendered links and requests', async () => {
  const app = appFixture('주전자');
  const canonical = '/profile/' + encodeURIComponent('주전자');
  const home = await app.handle(req('/'));
  const html = await home.text();
  assert.ok(anchors(html).includes(canonical));
  noInternalNavigation(html);
  const profile = await app.handle(req(canonical));
  assert.equal(profile.status, 200);
  assert.equal(app.calls.at(-1)!.url.pathname, '/api/v1/creators/' + encodeURIComponent('주전자'));
});

test('modern and unknown browsers remain the host renderer responsibility without API calls', async () => {
  const app = appFixture();
  for (const ua of [MODERN_UA, 'curl/8.0', '']) {
    for (const path of ['/', '/search?q=hello', '/community', '/content/cnt_one', '/login']) {
      const response = await app.handle(req(path, {}, ua));
      assert.equal(response.status, 404, `${ua}: ${path}`);
      assert.equal(response.headers.get('vary'), 'User-Agent');
      assert.equal(response.headers.has('set-cookie'), false);
      assert.ok(!(await response.text()).includes('ZUKU Legacy'));
    }
  }
  assert.equal(app.calls.length, 0);
});

test('matching host rewrites select canonical rendering without granting secure transport', async () => {
  const app = appFixture();
  const session = newSession();
  session.token = TOKEN;
  await app.state.putSession(session);
  const response = await app.handle(req('/legacy/search?q=hello', { headers: {
    'x-zuku-lc-original-path': '/search?q=hello', 'x-forwarded-proto': 'https',
    cookie: 'zuku_lc_session=' + session.id,
  } }));
  assert.equal(response.status, 200);
  const html = await response.text();
  noInternalNavigation(html);
  assert.ok(html.includes('HTTP · 공개 열람'));
  assert.equal(app.calls[0]!.authorization, null);
  const modern = await app.handle(req('/legacy/search?q=hello', { headers: { 'x-zuku-lc-original-path': '/search?q=hello' } }, MODERN_UA));
  assert.equal(modern.status, 404);
  assert.equal(app.calls.length, 1);
});

test('fake or mismatched original-path headers fail before reaching the API', async () => {
  const app = appFixture();
  for (const [internal, original] of [
    ['/legacy/search?q=hello', '/community?q=hello'],
    ['/legacy/search?q=hello', '/search?q=other'],
    ['/legacy/search', 'https://evil.test/search'],
    ['/legacy/search', '//evil.test/search'],
    ['/legacy/search', '/search#fragment'],
    ['/search?q=hello', '/search?q=hello'],
  ]) {
    const response = await app.handle(req(internal!, { headers: { 'x-zuku-lc-original-path': original! } }));
    assert.ok([400, 403].includes(response.status), `${internal} <- ${original}`);
  }
  assert.equal(app.calls.length, 0);
});

test('bridge proof authenticates the original canonical target across an internal rewrite once', async () => {
  const app = appFixture();
  const original = '/community?cursor=post_next';
  const proof = signBridgeRequest({ method: 'GET', path: original, body: '', key: KEY });
  const headers = { ...proof, 'x-zuku-lc-original-path': original };
  const response = await app.handle(req('/legacy/thread?cursor=post_next', { headers }, MODERN_UA));
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes('보안 브리지 연결'));
  assert.equal(app.calls[0]!.url.pathname, '/api/v1/thread/posts');
  assert.equal(app.calls[0]!.url.searchParams.get('cursor'), 'post_next');
  const replay = await app.handle(req('/legacy/thread?cursor=post_next', { headers }, MODERN_UA));
  assert.equal(replay.status, 403);
  assert.equal(app.calls.length, 1);
});

test('rewritten bridge proofs cannot change signed method, original path or query', async () => {
  const app = appFixture();
  const signedTarget = '/community?cursor=post_one';
  const proof = signBridgeRequest({ method: 'GET', path: signedTarget, body: '', key: KEY });
  const cases: [string, string, RequestInit][] = [
    ['/legacy/thread?cursor=post_one', signedTarget, { method: 'HEAD' }],
    ['/legacy/search?cursor=post_one', '/search?cursor=post_one', {}],
    ['/legacy/thread?cursor=post_two', '/community?cursor=post_two', {}],
    ['/legacy/thread?cursor=post_one', signedTarget, { method: 'POST', body: 'modified=1' }],
  ];
  for (const [internal, original, init] of cases) {
    const response = await app.handle(req(internal, { ...init, headers: { ...proof, 'x-zuku-lc-original-path': original } }));
    assert.equal(response.status, 403);
  }
  // Invalid attempts never consume a legitimate proof or change the canonical operation.
  const legitimate = await app.handle(req('/legacy/thread?cursor=post_one', { headers: { ...proof, 'x-zuku-lc-original-path': signedTarget } }));
  assert.equal(legitimate.status, 200);
  assert.equal(app.calls.length, 1);
});

test('rewritten canonical POST proofs bind the body without consuming CSRF on tampering', async () => {
  const app = appFixture();
  const session = newSession();
  await app.state.putSession(session);
  const original = '/login?mode=text';
  const body = new URLSearchParams({ csrf: session.csrf, routing: 'public', mode: 'text' }).toString();
  const proof = signBridgeRequest({ method: 'POST', path: original, body, key: KEY });
  const headers = {
    ...proof, 'x-zuku-lc-original-path': original,
    cookie: 'zuku_lc_session=' + session.id, 'content-type': 'application/x-www-form-urlencoded',
  };
  const tampered = await app.handle(req('/legacy/connect?mode=text', { method: 'POST', body: body + '&changed=1', headers }));
  assert.equal(tampered.status, 403);
  assert.equal((await app.state.getSession(session.id))?.csrf, session.csrf);
  const valid = await app.handle(req('/legacy/connect?mode=text', { method: 'POST', body, headers }));
  assert.equal(valid.status, 200);
  assert.ok((await valid.text()).includes('승인 대기'));
  assert.notEqual((await app.state.getSession(session.id))?.csrf, session.csrf);
  const replay = await app.handle(req('/legacy/connect?mode=text', { method: 'POST', body, headers }));
  assert.equal(replay.status, 403);
  assert.equal(app.calls.length, 0);
});

test('public pairing and internal action forms keep the same visible account and community URLs', async () => {
  const app = appFixture();
  const login = await app.handle(req('/login'), SECURE);
  assert.equal(login.status, 200);
  const cookieHeader = login.headers.get('set-cookie') || '';
  assert.match(cookieHeader, /^zuku_lc_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict;/);
  assert.ok(!cookieHeader.includes('Path=/legacy'));
  const sessionId = cookieHeader.match(/^zuku_lc_session=([a-f0-9]{64})/)?.[1];
  assert.ok(sessionId);
  const session = await app.state.getSession(sessionId);
  assert.ok(session?.pairCode);
  const loginHtml = await login.text();
  assert.ok(loginHtml.includes('action="/legacy/connect"'));
  assert.ok(loginHtml.includes('name="routing" value="public"'));
  const approve = await app.handle(req('/legacy/authorize', {
    method: 'POST', body: JSON.stringify({ code: session.pairCode }),
    headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: 'Bearer ' + TOKEN },
  }, MODERN_UA), SECURE);
  assert.equal(approve.status, 200);
  const claim = await app.handle(form('/legacy/connect', { csrf: session.csrf, routing: 'public' }, 'zuku_lc_session=' + session.id), SECURE);
  assert.equal(claim.status, 303);
  assert.equal(claim.headers.get('location'), '/profile');
  const freshId = claim.headers.get('set-cookie')?.match(/^zuku_lc_session=([a-f0-9]{64})/)?.[1];
  assert.ok(freshId);
  const cookie = 'zuku_lc_session=' + freshId;
  const account = await app.handle(req('/profile', { headers: { cookie } }), SECURE);
  assert.equal(account.status, 200);
  assert.ok((await account.text()).includes('name="routing" value="public"'));
  const community = await app.handle(req('/community', { headers: { cookie } }), SECURE);
  const html = await community.text();
  assert.ok(html.includes('action="/legacy/actions/post"'));
  assert.ok(html.includes('name="routing" value="public"'));
  noInternalNavigation(html);
  const fresh = await app.state.getSession(freshId);
  assert.ok(fresh);
  const posted = await app.handle(form('/legacy/actions/post', { csrf: fresh.csrf, body: '이어지는 글', routing: 'public', mode: 'text' }, cookie), SECURE);
  assert.equal(posted.status, 303);
  assert.equal(posted.headers.get('location'), '/community?mode=text');
  assert.equal(app.calls.at(-1)!.url.pathname, '/api/v1/posts');
  assert.equal(app.calls.at(-1)!.authorization, 'Bearer ' + TOKEN);
  const current = await app.state.getSession(freshId);
  assert.ok(current);
  const logout = await app.handle(form('/legacy/logout', { csrf: current.csrf, routing: 'public' }, cookie), SECURE);
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get('location'), '/');
  assert.match(logout.headers.get('set-cookie') || '', /^zuku_lc_session=; Path=\/;/);
  assert.equal(await app.state.getSession(freshId), undefined);
});

test('public authenticated destinations redirect guests to normal login URLs', async () => {
  const app = appFixture();
  for (const path of ['/profile', '/bookmarks']) {
    const response = await app.handle(req(path));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login');
  }
  assert.equal(app.calls.length, 0);
});
