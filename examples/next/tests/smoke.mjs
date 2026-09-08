import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { signBridgeRequest } from '@zuku/legacy-bridge';
import { fileURLToPath } from 'node:url';
import { browserVary } from '../integration/cache-headers.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const api = createHttpServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ success: true, data: { feeds: [], pagination: { page: 1, per_page: 12, has_next: false, has_prev: false } } }));
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const bridgeKey = randomBytes(32).toString('hex');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd,
  env: { ...process.env, ZUKU_API_ORIGIN: `http://127.0.0.1:${api.address().port}`, ZUKU_BRIDGE_KEY: bridgeKey, ZUKU_HTTPS_PROXY_SECRET: '', ZUKU_PUBLIC_ORIGIN: 'https://localhost:3000', ZUKU_MODERN_ORIGIN: 'https://localhost:3000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });
// A loopback ingress exercises the host's final response-header hook. It does
// not assert TLS trust; signed companion proofs remain independently required.
const ingress = createHttpServer((request, response) => {
  const forwarded = httpRequest({ hostname: '127.0.0.1', port, path: request.url, method: request.method, headers: request.headers }, (upstream) => {
    for (const [name, value] of Object.entries(upstream.headers)) if (value !== undefined) response.setHeader(name, value);
    const vary = browserVary(new URL(request.url, 'http://localhost').pathname, upstream.headers.vary);
    if (vary) response.setHeader('Vary', vary);
    response.writeHead(upstream.statusCode || 502);
    upstream.pipe(response);
  });
  forwarded.on('error', () => { response.writeHead(502); response.end(); });
  request.pipe(forwarded);
});
await new Promise((resolve) => ingress.listen(0, '127.0.0.1', resolve));
try {
  const directOrigin = `http://127.0.0.1:${port}`;
  const origin = `http://127.0.0.1:${ingress.address().port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Next server exited before becoming ready.');
    try { ready = (await fetch(origin + '/legacy/compatibility')).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Production Next server did not become ready.');
  const directModern = await fetch(directOrigin + '/', { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' } });
  const directModernHtml = await directModern.text();
  const page = await fetch(origin + '/legacy/compatibility');
  const classic = await page.text();
  assert.match(classic, /^<!DOCTYPE HTML PUBLIC/);
  assert.doesNotMatch(classic, /\/_next\//, 'Classic route unexpectedly contains Next hydration');
  const ie6 = { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)' };
  const publicPage = await fetch(origin + '/?mode=text', { headers: ie6, redirect: 'manual' });
  assert.equal(publicPage.status, 200);
  assert.equal(publicPage.headers.get('location'), null, 'Classic routing must not redirect the visible URL');
  assert.match(publicPage.headers.get('vary') || '', /User-Agent/i);
  assert.equal(publicPage.headers.get('x-zuku-lc-rewrite-proof'), null);
  assert.equal(publicPage.headers.get('x-middleware-request-x-zuku-lc-rewrite-proof'), null);
  const publicClassic = await publicPage.text();
  assert.match(publicClassic, /^<!DOCTYPE HTML PUBLIC/);
  assert.doesNotMatch(publicClassic, /\/_next\//);
  assert.match(publicClassic, /href="\/community\?mode=text"/, 'Classic navigation must preserve normal public URLs');
  const publicModern = await fetch(origin + '/', { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36' } });
  assert.equal(publicModern.status, 200);
  const modernHtml = await publicModern.text();
  assert.match(modernHtml, /\/_next\//, 'Modern home must retain the modern renderer');
  assert.equal(modernHtml, directModernHtml, 'Final Vary hook must not alter the modern page body');
  assert.equal(publicModern.headers.get('cache-control'), directModern.headers.get('cache-control'), 'Modern caching policy must remain unchanged');
  assert.match(publicModern.headers.get('vary') || '', /User-Agent/i);
  const loginPath = '/login?mode=text';
  const login = await fetch(origin + loginPath, { headers: { ...ie6, ...signBridgeRequest({ method: 'GET', path: loginPath, body: '', key: bridgeKey }) } });
  assert.equal(login.status, 200, 'Bridge proof must bind to the original public URL through Next rewriting');
  const loginHtml = await login.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(loginHtml)?.[1];
  assert.ok(csrf, 'Signed public login should create a connection session');
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const body = new URLSearchParams({ csrf, mode: 'text', routing: 'public' }).toString();
  const checkLogin = await fetch(origin + loginPath, {
    method: 'POST',
    headers: { ...ie6, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', ...signBridgeRequest({ method: 'POST', path: loginPath, body, key: bridgeKey }) },
    body,
  });
  assert.equal(checkLogin.status, 200, 'Signed original POST body and CSRF must survive the rewrite');
  assert.match(await checkLogin.text(), /href="\/community\?mode=text"/);
  const wrongTarget = await fetch(origin + loginPath, {
    headers: { ...ie6, ...signBridgeRequest({ method: 'GET', path: '/legacy/connect?mode=text', body: '', key: bridgeKey }) },
  });
  assert.equal(wrongTarget.status, 403, 'Signing the internal path must not authenticate a different public target');
  for (const ext of ['js', 'css']) {
    const response = await fetch(origin + '/legacy/assets/neonux-lc.' + ext);
    assert.equal(response.status, 200, `Native package asset ${ext} failed`);
    const asset = await response.text();
    assert.match(asset, /^\/\* Generated from NeonUX/);
    assert.doesNotMatch(asset, /<!DOCTYPE/);
  }
  const approval = await fetch(origin + '/legacy/approve?code=ABCD1234EFAB');
  const modern = await approval.text();
  assert.equal(approval.status, 200);
  assert.match(modern, /\/_next\//);
  assert.match(modern, /<button[^>]+disabled/);
  assert.match(modern, /ABCD.*1234.*EFAB/);
  const forged = await fetch(origin + '/legacy/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://localhost:3000', 'X-Forwarded-Proto': 'https', Authorization: 'Bearer ' + 'a'.repeat(40) },
    body: JSON.stringify({ code: 'ABCD1234EFAB' }),
  });
  assert.equal(forged.status, 403, 'Forwarded protocol forged authenticated transport');
  console.log('Next + outer-ingress production smoke passed: IE6 canonical URLs, unchanged modern body/cache policy, final Vary, original-path/body bridge proofs, assets, approval, ingress rejection.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  server.kill('SIGTERM');
  if (server.exitCode === null) await new Promise((resolve) => server.once('exit', resolve));
  await new Promise((resolve) => api.close(resolve));
  await new Promise((resolve) => ingress.close(resolve));
}
