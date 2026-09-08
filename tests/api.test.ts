import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, API_PAGE_SIZE, ZukuApi } from '../packages/legacy-core/src/api.js';

function envelope(data: unknown, status = 200): Response {
  return Response.json({ success: true, data, meta: { version: 'v1' } }, { status });
}

function recordingApi(data: unknown = {}) {
  const calls: { url: URL; init: RequestInit; headers: Headers }[] = [];
  const api = new ZukuApi({
    origin: 'https://api.example.test',
    fetch: async (input, init = {}) => {
      calls.push({ url: new URL(String(input)), init, headers: new Headers(init.headers) });
      return envelope(data);
    },
  });
  return { api, calls };
}

const pagination = {
  page: 1, per_page: API_PAGE_SIZE, total: 0, total_pages: 1,
  has_next: false, has_prev: false, next_cursor: null, prev_cursor: null,
};

test('guest feeds use canonical API and a bounded page without forwarding ambient credentials', async () => {
  const { api, calls } = recordingApi({ feeds: [], pagination });
  assert.deepEqual(await api.feed('hype', 2), { feeds: [], pagination });
  const call = calls[0]!;
  assert.equal(call.url.pathname, '/api/v1/feeds/hype');
  assert.equal(call.url.searchParams.get('page'), '2');
  assert.equal(call.url.searchParams.get('per_page'), '12');
  assert.equal(call.url.searchParams.get('sort'), 'hot');
  assert.equal(call.headers.has('authorization'), false);
  assert.equal(call.headers.has('cookie'), false);
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.redirect, 'manual');
  assert.equal(call.init.cache, 'no-store');
  assert.ok(call.init.signal);
});

test('Vive/Vine pagination is projected without reordering or filtering server content', async () => {
  const items = [{ id: 'vive_1', title: '서버 순서' }];
  const { api } = recordingApi({ items, page: 2, per_page: 12, total: 30, has_more: true, sort: 'hot' });
  const result = await api.feed('vive', 2);
  assert.deepEqual(result.feeds, items);
  assert.deepEqual(result.pagination, {
    page: 2, per_page: 12, total: 30, total_pages: 3,
    has_next: true, has_prev: true, next_cursor: null, prev_cursor: null,
  });
});

test('queries and opaque cursors cannot introduce paths or extra API parameters', async () => {
  const { api, calls } = recordingApi({ results: [], pagination, query: 'a&category=jump' });
  await api.search('a&category=jump', 'hype', 3);
  await api.thread('thr_1&limit=500');
  await api.postThread('thr_abc', 'post_1?admin=true');
  assert.equal(calls[0]!.url.searchParams.get('q'), 'a&category=jump');
  assert.deepEqual(calls[0]!.url.searchParams.getAll('category'), ['hype']);
  assert.equal(calls[1]!.url.pathname, '/api/v1/thread/posts');
  assert.equal(calls[1]!.url.searchParams.get('cursor'), 'thr_1&limit=500');
  assert.equal(calls[1]!.url.searchParams.get('limit'), '12');
  assert.equal(calls[2]!.url.searchParams.get('after'), 'post_1?admin=true');
  assert.equal(calls[2]!.url.searchParams.has('admin'), false);
});

test('existing content, comments, profiles and game detail wrapper fields are respected', async () => {
  const content = { id: 'cnt_1' };
  const creator = { id: 'usr_1', display_name: '주전자', handle: 'zuku' };
  const { api, calls } = recordingApi({ content, creator, comments: [], pagination, games: [] });
  assert.deepEqual(await api.content('cnt_1', 'session-token'), content);
  await api.comments('cnt_1', 2);
  assert.deepEqual(await api.profile('주전자'), creator);
  await api.games(2);
  assert.deepEqual(await api.game('cnt_1'), content);
  assert.deepEqual(calls.map((call) => call.url.pathname), [
    '/api/v1/contents/cnt_1', '/api/v1/contents/cnt_1/comments',
    '/api/v1/creators/%EC%A3%BC%EC%A0%84%EC%9E%90', '/api/v1/jump/games', '/api/v1/jump/games/cnt_1',
  ]);
  assert.equal(calls[0]!.headers.get('authorization'), 'Bearer session-token');
  assert.equal(calls[1]!.headers.has('authorization'), false);
});

test('writes delegate canonical payloads, author identity and like semantics to the backend', async () => {
  const { api, calls } = recordingApi();
  await api.createPost('글 본문', 'access-token');
  await api.reply('post_1', '답글', 'access-token');
  await api.likePost('post_1', 'access-token');
  await api.likePost('post_1', 'access-token', false);
  await api.likeContent('cnt_1', 'access-token');
  await api.bookmarkContent('cnt_1', 'access-token');
  await api.comment('cnt_1', '댓글', 'access-token', 'comment_1');
  assert.deepEqual(calls.map(({ url, init }) => [init.method, url.pathname]), [
    ['POST', '/api/v1/posts'], ['POST', '/api/v1/posts/post_1/replies'],
    ['POST', '/api/v1/posts/post_1/like'], ['DELETE', '/api/v1/posts/post_1/like'],
    ['POST', '/api/v1/contents/cnt_1/like'], ['POST', '/api/v1/contents/cnt_1/bookmark'],
    ['POST', '/api/v1/contents/cnt_1/comments'],
  ]);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { body: '글 본문' });
  assert.deepEqual(JSON.parse(String(calls[6]!.init.body)), { body: '댓글', parent_id: 'comment_1' });
  for (const call of calls) assert.equal(call.headers.get('authorization'), 'Bearer access-token');
});

test('me unwraps actual data.user and bookmarks remain scoped to the current bearer', async () => {
  const user = { id: 'usr_9', display_name: '사용자', handle: 'user9' };
  const { api, calls } = recordingApi({ user });
  assert.deepEqual(await api.me('access-token'), user);
  await api.bookmarks('access-token', 2);
  assert.equal(calls[0]!.url.pathname, '/api/v1/auth/me');
  assert.equal(calls[1]!.url.pathname, '/api/v1/users/me/bookmarks');
  assert.equal(calls[1]!.url.searchParams.get('page'), '2');
  assert.equal(calls[1]!.headers.get('authorization'), 'Bearer access-token');
  const invalid = recordingApi(user).api;
  await assert.rejects(invalid.me('access-token'), { code: 'INVALID_RESPONSE' });
});

test('missing or malformed bearer tokens never issue a request', async () => {
  const { api, calls } = recordingApi();
  await assert.rejects(api.createPost('body', ''), { code: 'AUTH_REQUIRED', status: 401 });
  await assert.rejects(api.me('token\r\nX-Admin: yes'), { code: 'AUTH_REQUIRED' });
  assert.throws(() => api.bookmarks(''), { code: 'AUTH_REQUIRED' });
  assert.equal(calls.length, 0);
});

test('API destination requires TLS or exact loopback, and identifiers cannot traverse routes', async () => {
  for (const origin of [
    'http://api.example.test', 'http://localhost.evil.test', 'ftp://127.0.0.1',
    'https://user:secret@api.example.test', 'https://api.example.test/api/v1',
    'https://api.example.test/?target=evil', 'https://api.example.test/#fragment',
  ]) assert.throws(() => new ZukuApi({ origin }), TypeError);
  for (const origin of ['https://api.example.test', 'http://127.0.0.1:30012', 'http://[::1]:30012']) {
    assert.ok(new ZukuApi({ origin }));
  }
  const { api, calls } = recordingApi();
  for (const id of ['..', '.', 'a/b', 'a\\b', 'bad\nheader', '']) {
    await assert.rejects(api.content(id), TypeError);
  }
  await assert.rejects(api.feed('unknown' as never), TypeError);
  await assert.rejects(api.feed(undefined, 0), TypeError);
  assert.equal(calls.length, 0);
});

test('upstream errors retain their status/code without treating error pages as data', async () => {
  const api = new ZukuApi({ origin: 'https://api.example.test', fetch: async () => Response.json({
    success: false, error: { code: 'UNAUTHORIZED', message: '세션이 만료되었습니다.' },
  }, { status: 401 }) });
  await assert.rejects(api.me('old-token'), { code: 'UNAUTHORIZED', status: 401 });
  const broken = new ZukuApi({ origin: 'https://api.example.test', fetch: async () => new Response('<html>bad gateway</html>', { status: 502 }) });
  await assert.rejects(broken.thread(), { code: 'INVALID_RESPONSE', status: 502 });
  const wrong = new ZukuApi({ origin: 'https://api.example.test', fetch: async () => envelope({ user: {} }, 403) });
  await assert.rejects(wrong.me('access-token'), { code: 'UPSTREAM_ERROR', status: 403 });
});

test('redirects are refused before they can forward a bearer to another origin', async () => {
  const calls: RequestInit[] = [];
  const api = new ZukuApi({ origin: 'https://api.example.test', fetch: async (_input, init = {}) => {
    calls.push(init);
    return new Response(null, { status: 307, headers: { Location: 'https://evil.test/steal' } });
  } });
  await assert.rejects(api.me('access-token'), { code: 'UPSTREAM_REDIRECT' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.redirect, 'manual');
});

test('chunked and advertised responses are bounded to one MiB', async () => {
  for (const advertised of [false, true]) {
    let cancelled = false;
    const api = new ZukuApi({ origin: 'https://api.example.test', fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(700000)); controller.enqueue(new Uint8Array(700000)); },
      cancel() { cancelled = true; },
    }), { headers: advertised ? { 'content-length': '1400000' } : {} }) });
    await assert.rejects(api.thread(), { code: 'RESPONSE_TOO_LARGE', status: 502 });
    assert.equal(cancelled, true);
  }
});

test('unresponsive upstream times out and aborts the request', async () => {
  let signal: AbortSignal | null | undefined;
  const api = new ZukuApi({ origin: 'https://api.example.test', timeoutMs: 10, fetch: async (_input, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => undefined);
  } });
  await assert.rejects(api.thread(), (error: unknown) => error instanceof ApiError && error.code === 'UPSTREAM_TIMEOUT' && error.status === 504);
  assert.equal(signal?.aborted, true);
});
