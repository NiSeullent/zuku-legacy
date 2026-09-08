import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyApp } from '../packages/legacy-core/src/index.js';
import { MemoryLegacyState, newSession, type Session } from '../packages/legacy-core/src/state.js';
import { signBridgeRequest } from '@zuku/legacy-bridge';

const PUBLIC = 'https://legacy.example.test';
const TOKEN = 'canonical-access-token-' + 'a'.repeat(40);
const SECOND_TOKEN = 'canonical-access-token-' + 'b'.repeat(40);
const BRIDGE_KEY = '7f'.repeat(32);
const SECURE = { secureTransport: true, clientAddress: '192.0.2.1' };
const pagination = { page: 1, per_page: 12, total: 0, total_pages: 1, has_next: false, has_prev: false, next_cursor: null, prev_cursor: null };
type UpstreamCall = { url: URL; init: RequestInit; headers: Headers };

function ok(data: unknown) { return Response.json({ success: true, data }); }
function harness(handler?: (call: UpstreamCall) => Promise<Response> | Response, state = new MemoryLegacyState()) {
  const calls: UpstreamCall[] = [];
  const app = createLegacyApp({
    publicOrigin: PUBLIC, modernOrigin: PUBLIC, apiOrigin: 'https://api.example.test', bridgeKey: BRIDGE_KEY, state,
    fetch: async (input, init = {}) => {
      const call = { url: new URL(String(input)), init, headers: new Headers(init.headers) };
      calls.push(call);
      if (handler) return handler(call);
      if (call.url.pathname === '/api/v1/auth/me') return ok({ user: { id: 'usr_1', display_name: '연결 사용자', handle: 'zuku' } });
      if (call.url.pathname.startsWith('/api/v1/thread/') || call.url.pathname.endsWith('/thread')) return ok({ posts: [], next_cursor: null });
      if (call.url.pathname.startsWith('/api/v1/creators/')) return ok({ creator: { id: 'usr_1', display_name: '주전자', handle: '주전자' } });
      if (call.init.method === 'POST' || call.init.method === 'DELETE') return ok({ post: { id: 'post_created' } });
      return ok({ feeds: [], pagination, results: [], query: '' });
    },
  });
  return { ...app, state, calls };
}

function request(path: string, init: RequestInit = {}) { return new Request(PUBLIC + '/legacy' + path, init); }
function formRequest(path: string, fields: Record<string, string>, cookie?: string, extra: Record<string, string> = {}) {
  return request(path, {
    method: 'POST', body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: PUBLIC, ...(cookie ? { cookie } : {}), ...extra },
  });
}
function authorization(code: string, token = TOKEN, extra: Record<string, string> = {}) {
  return request('/authorize', {
    method: 'POST', body: JSON.stringify({ code }),
    headers: { 'content-type': 'application/json', origin: PUBLIC, authorization: `Bearer ${token}`, ...extra },
  });
}
function sessionCookie(session: Session) { return 'zuku_lc_session=' + session.id; }
async function connectedSession(state: MemoryLegacyState) {
  const session = newSession();
  session.token = TOKEN;
  session.user = { id: 'usr_1', username: 'zuku', display_name: '연결 사용자' };
  await state.putSession(session);
  return session;
}
async function pairing(app: ReturnType<typeof harness>, address = SECURE.clientAddress) {
  const response = await app.handle(request('/connect'), { ...SECURE, clientAddress: address });
  assert.equal(response.status, 200);
  const body = await response.text();
  const id = response.headers.get('set-cookie')?.match(/zuku_lc_session=([a-f0-9]{64})/)?.[1];
  assert.ok(id, 'connect provides an opaque HttpOnly session cookie');
  const session = await app.state.getSession(id);
  assert.ok(session?.pairCode);
  assert.ok(body.includes(session.pairCode.match(/.{4}/g)!.join('-')));
  return { response, body, session, code: session.pairCode, cookie: sessionCookie(session) };
}

test('unprotected requests ignore session cookies, bearer, claimed HTTPS URLs and proxy headers', async () => {
  const app = harness();
  const session = await connectedSession(app.state);
  const headers = { cookie: sessionCookie(session), authorization: `Bearer ${TOKEN}`, 'x-forwarded-proto': 'https', forwarded: 'proto=https', 'x-forwarded-for': '127.0.0.1' };
  const feed = await app.handle(request('', { headers }));
  assert.equal(feed.status, 200);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0]!.headers.has('authorization'), false);
  assert.equal(app.calls[0]!.headers.has('cookie'), false);
  const body = await feed.text();
  assert.ok(body.includes('HTTP · 공개 열람'));
  assert.ok(!body.includes('연결 사용자'));
  assert.ok(!body.includes(TOKEN));
  assert.equal(feed.headers.has('set-cookie'), false);
  const connect = await app.handle(request('/connect', { headers }));
  assert.equal(connect.headers.has('set-cookie'), false);
  const write = await app.handle(formRequest('/actions/post', { csrf: session.csrf, body: 'spoofed' }, sessionCookie(session), headers));
  assert.equal(write.status, 403);
  const approve = await app.handle(authorization('AABBCCDDEEFF'));
  assert.equal(approve.status, 403);
  assert.equal(app.calls.length, 1);
});

test('forged bridge headers fail closed; a signed path/query proof works exactly once', async () => {
  const app = harness();
  const fake = await app.handle(request('/connect', { headers: { 'x-zuku-bridge-signature': 'a'.repeat(64) } }));
  assert.equal(fake.status, 403);
  const path = '/legacy/connect?mode=text';
  const proof = signBridgeRequest({ method: 'GET', path, body: '', key: BRIDGE_KEY });
  const valid = await app.handle(new Request(PUBLIC + path, { headers: proof }));
  assert.equal(valid.status, 200);
  assert.ok(valid.headers.get('set-cookie')?.includes('HttpOnly'));
  assert.ok((await valid.text()).includes('보안 브리지 연결'));
  const replay = await app.handle(new Request(PUBLIC + path, { headers: proof }));
  assert.equal(replay.status, 403);
});

test('pairing requires protected same-origin modern approval and canonical identity verification', async () => {
  const app = harness();
  const pair = await pairing(app);
  assert.match(pair.response.headers.get('set-cookie') || '', /HttpOnly; SameSite=Strict/);
  assert.ok(pair.response.headers.get('set-cookie')?.includes('Secure'));
  assert.equal((await app.handle(authorization(pair.code, TOKEN, { origin: 'https://evil.test' }), SECURE)).status, 403);
  assert.equal((await app.handle(authorization(pair.code, ''), SECURE)).status, 401);
  assert.equal(app.calls.length, 0);
  const approved = await app.handle(authorization(pair.code), SECURE);
  assert.equal(approved.status, 200);
  assert.equal(app.calls[0]!.url.pathname, '/api/v1/auth/me');
  assert.equal(app.calls[0]!.headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(app.calls[0]!.headers.has('cookie'), false);
  assert.deepEqual(await approved.json(), { success: true, display_name: '연결 사용자' });
  assert.equal(approved.headers.get('cache-control'), 'no-store, private');
  assert.equal((await app.handle(authorization(pair.code), SECURE)).status, 400);
  const claim = await app.handle(formRequest('/connect', { csrf: pair.session.csrf }, pair.cookie), SECURE);
  assert.equal(claim.status, 303);
  assert.equal(claim.headers.get('location'), '/legacy/account');
  const freshId = claim.headers.get('set-cookie')?.match(/zuku_lc_session=([a-f0-9]{64})/)?.[1];
  assert.ok(freshId && freshId !== pair.session.id, 'authentication rotates the browser session');
  assert.equal(await app.state.getSession(pair.session.id), undefined);
  assert.equal(await app.state.getPair(pair.code), undefined);
  assert.equal((await app.state.getSession(freshId))?.token, TOKEN);
  let returnedHeaders = '';
  claim.headers.forEach((value, name) => { returnedHeaders += `${name}: ${value}\n`; });
  assert.ok(!returnedHeaders.includes(TOKEN));
  const account = await app.handle(request('/account', { headers: { cookie: 'zuku_lc_session=' + freshId } }), SECURE);
  const accountBody = await account.text();
  assert.equal(account.status, 200);
  assert.ok(accountBody.includes('연결 사용자'));
  assert.ok(!accountBody.includes(TOKEN));
  assert.ok(!accountBody.includes('refresh_token'));
});

test('a pairing claim is bound to its original session and one-time transition', async () => {
  const app = harness();
  const owner = await pairing(app, '192.0.2.1');
  const other = await pairing(app, '192.0.2.2');
  await app.handle(authorization(owner.code), SECURE);
  assert.equal(await app.state.takePair(owner.code, other.session.id), undefined);
  const stolenCsrf = await app.handle(formRequest('/connect', { csrf: owner.session.csrf, code: owner.code }, other.cookie), SECURE);
  assert.equal(stolenCsrf.status, 403);
  const wrongSession = await app.handle(formRequest('/connect', { csrf: other.session.csrf, code: owner.code }, other.cookie), SECURE);
  assert.equal(wrongSession.status, 200);
  assert.equal((await app.state.getSession(other.session.id))?.token, undefined);
  const claim = await app.handle(formRequest('/connect', { csrf: owner.session.csrf }, owner.cookie), SECURE);
  assert.equal(claim.status, 303);
  assert.equal((await app.handle(formRequest('/connect', { csrf: owner.session.csrf }, owner.cookie), SECURE)).status, 403);
});

test('CSRF, cross-origin and shadow-cookie failures never reach a canonical write', async () => {
  const app = harness();
  const session = await connectedSession(app.state);
  const cookie = sessionCookie(session);
  const invalidFields: Record<string, string>[] = [{ body: 'x' }, { csrf: 'wrong', body: 'x' }, { csrf: '가'.repeat(64), body: 'x' }];
  for (const fields of invalidFields) {
    const response = await app.handle(formRequest('/actions/post', fields, cookie), SECURE);
    assert.equal(response.status, 403);
  }
  assert.equal((await app.handle(formRequest('/actions/post', { csrf: session.csrf, body: 'x' }, cookie, { origin: 'https://evil.test' }), SECURE)).status, 403);
  assert.equal((await app.handle(formRequest('/actions/post', { csrf: session.csrf, body: 'x' }, cookie + '; ' + cookie), SECURE)).status, 403);
  const duplicate = request('/actions/post', { method: 'POST', body: `csrf=${session.csrf}&csrf=${session.csrf}&body=x`, headers: { cookie, origin: PUBLIC, 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal((await app.handle(duplicate, SECURE)).status, 400);
  assert.equal(app.calls.length, 0);
});

test('a full session store still permits atomic pairing rotation', async () => {
  const app = harness(undefined, new MemoryLegacyState(1));
  const pair = await pairing(app);
  assert.equal((await app.handle(authorization(pair.code), SECURE)).status, 200);
  const claim = await app.handle(formRequest('/connect', { csrf: pair.session.csrf }, pair.cookie), SECURE);
  assert.equal(claim.status, 303);
  const freshId = claim.headers.get('set-cookie')?.match(/zuku_lc_session=([a-f0-9]{64})/)?.[1];
  assert.ok(freshId);
  assert.equal((await app.state.getSession(freshId))?.token, TOKEN);
  assert.equal(await app.state.getSession(pair.session.id), undefined);
  assert.equal(await app.state.getPair(pair.code), undefined);
  assert.equal(await app.state.rotateSession(pair.session.id, newSession()), false);
});

test('malformed Referer is rejected as an invalid origin without touching upstream', async () => {
  const app = harness();
  const session = await connectedSession(app.state);
  const req = formRequest('/actions/post', { csrf: session.csrf, body: 'x' }, sessionCookie(session));
  req.headers.delete('origin');
  req.headers.set('referer', 'not a URL');
  assert.equal((await app.handle(req, SECURE)).status, 403);
  assert.equal(app.calls.length, 0);
});

test('content visibility flags prevent rendering full body or protected media links', async () => {
  for (const flags of [{ can_view_full: false }, { body_masked: true }]) {
    const app = harness((call) => call.url.pathname.endsWith('/comments') ? ok({ comments: [], pagination }) : ok({
      content: {
        id: 'cnt_locked', category: 'hype', type: 'horizontal_media', title: '잠긴 작품',
        creator: { display_name: '작가' }, description: 'PRIVATE_FULL_BODY_MARKER',
        media_url: 'https://cdn.example.test/PRIVATE_MEDIA_MARKER.mp4',
        thumbnail_url: 'https://cdn.example.test/public-preview.jpg', locked: true, ...flags,
      },
    }));
    const response = await app.handle(request('/content/cnt_locked'));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(!body.includes('PRIVATE_MEDIA_MARKER'), 'protected media URL must not enter the HTML');
    assert.ok(!body.includes('PRIVATE_FULL_BODY_MARKER'), 'masked full description must not enter the HTML');
    assert.ok(body.includes('잠긴 작품'));
  }
});

test('malformed paths, oversized forms and unsupported methods fail with client status codes', async () => {
  const app = harness();
  for (const path of ['/content/%E0%A4%A', '/thread/%FF', '/profile/%']) {
    assert.equal((await app.handle(request(path), SECURE)).status, 400);
  }
  assert.equal((await app.handle(request('/thread?cursor=' + encodeURIComponent('bad\nvalue')), SECURE)).status, 400);
  assert.equal((await app.handle(request('/search?q=' + 'a'.repeat(4100)), SECURE)).status, 414);
  assert.equal((await app.handle(request('/actions/post', { method: 'PUT' }), SECURE)).status, 405);
  for (const declared of [false, true]) {
    const response = await app.handle(request('/actions/post', { method: 'POST', body: 'x'.repeat(17000), headers: { ...(declared ? { 'content-length': '17000' } : {}), 'content-type': 'application/x-www-form-urlencoded' } }), SECURE);
    assert.equal(response.status, 413);
  }
  assert.equal(app.calls.length, 0);
});

test('canonical Korean handles remain reachable through encoded public profile URLs', async () => {
  const app = harness();
  const response = await app.handle(request('/profile/' + encodeURIComponent('주전자')));
  assert.equal(response.status, 200);
  assert.equal(app.calls[0]!.url.pathname, '/api/v1/creators/' + encodeURIComponent('주전자'));
  assert.ok((await response.text()).includes('주전자'));
});

test('public upstream failures remain visible and escaped instead of synthetic successful feeds', async () => {
  const app = harness(() => Response.json({ success: false, error: { code: 'FEED_UNAVAILABLE', message: '<script>alert(1)</script>' } }, { status: 503 }));
  const response = await app.handle(request(''));
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!body.includes('<script>alert(1)</script>'));
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('expired canonical sessions are cleared after an upstream 401', async () => {
  const app = harness(() => Response.json({ success: false, error: { code: 'UNAUTHORIZED', message: '세션 만료' } }, { status: 401 }));
  const session = await connectedSession(app.state);
  const response = await app.handle(request('/account', { headers: { cookie: sessionCookie(session) } }), SECURE);
  assert.equal(response.status, 401);
  assert.equal(await app.state.getSession(session.id), undefined);
  assert.ok(!(await response.text()).includes(TOKEN));
});

test('concurrent modern approvals cannot overwrite the user who approved first', async () => {
  let releaseFirst!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const app = harness(async (call) => {
    if (call.headers.get('authorization') === `Bearer ${TOKEN}`) { started(); await firstGate; }
    return ok({ user: { id: call.headers.get('authorization') === `Bearer ${TOKEN}` ? 'usr_1' : 'usr_2', display_name: '승인 사용자', handle: 'user' } });
  });
  const pair = await pairing(app);
  const slowApproval = app.handle(authorization(pair.code, TOKEN), SECURE);
  await firstStarted;
  const fastApproval = await app.handle(authorization(pair.code, SECOND_TOKEN), { ...SECURE, clientAddress: '192.0.2.2' });
  releaseFirst();
  const lateApproval = await slowApproval;
  assert.equal(fastApproval.status, 200);
  assert.equal(lateApproval.status, 400);
  assert.equal((await app.state.getPair(pair.code))?.approved?.token, SECOND_TOKEN);
});

test('a consumed pairing cannot be resurrected by an approval already waiting upstream', async () => {
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const app = harness(async (call) => {
    if (call.headers.get('authorization') === `Bearer ${TOKEN}`) { started(); await gate; }
    return ok({ user: { id: 'usr_2', display_name: '승인 사용자', handle: 'user2' } });
  });
  const pair = await pairing(app);
  const pending = app.handle(authorization(pair.code, TOKEN), SECURE);
  await firstStarted;
  assert.equal((await app.handle(authorization(pair.code, SECOND_TOKEN), SECURE)).status, 200);
  assert.equal((await app.handle(formRequest('/connect', { csrf: pair.session.csrf }, pair.cookie), SECURE)).status, 303);
  release();
  assert.equal((await pending).status, 400);
  assert.equal(await app.state.getPair(pair.code), undefined);
});

test('concurrent copies of one CSRF form perform at most one canonical mutation', async () => {
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  const app = harness(async () => {
    writes += 1;
    if (writes === 1) { started(); await gate; }
    return ok({ post: { id: 'post_created' } });
  });
  const session = await connectedSession(app.state);
  const fields = { csrf: session.csrf, body: '한 번만 작성' };
  const first = app.handle(formRequest('/actions/post', fields, sessionCookie(session)), SECURE);
  await firstStarted;
  const second = await app.handle(formRequest('/actions/post', fields, sessionCookie(session)), SECURE);
  release();
  const firstResponse = await first;
  assert.equal(firstResponse.status, 303);
  assert.equal(second.status, 403);
  assert.equal(writes, 1);
  assert.notEqual((await app.state.getSession(session.id))?.csrf, session.csrf);
});

test('anonymous connect allocation is rate limited before exhausting pairing state', async () => {
  const app = harness();
  const statuses: number[] = [];
  for (let i = 0; i < 50; i += 1) statuses.push((await app.handle(request('/connect'), SECURE)).status);
  assert.ok(statuses.includes(429), 'one source must be throttled before filling the global session store');
  const other = await app.handle(request('/connect'), { ...SECURE, clientAddress: '192.0.2.254' });
  assert.equal(other.status, 200);
  assert.equal(app.calls.length, 0);
});
