import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import {
  BridgeCookieJar, BridgeReplayCache, bridgeKeyBytes, isLegacyPath,
  signBridgeRequest, startBridge, validateUpstreamOrigin, validLocalHeaders, verifyBridgeRequest,
} from '../packages/bridge/src/index.js';

const key = randomBytes(32).toString('hex');
const now = 1_800_000_000_000;
const signed = (overrides = {}) => signBridgeRequest({ method: 'POST', path: '/legacy/action?a=1', body: 'csrf=test&value=1', key, now, ...overrides });
const verify = (headers: Record<string, string | string[] | undefined>, overrides = {}, replay = new BridgeReplayCache(), clock = now) =>
  verifyBridgeRequest({ method: 'POST', url: '/legacy/action?a=1', headers, ...overrides }, 'csrf=test&value=1', key, replay, clock);

test('bridge proof binds the exact method, path, query, body and key', () => {
  const headers = signed();
  assert.equal(verify(headers), true);
  assert.equal(verify(headers, { method: 'GET' }), false);
  assert.equal(verify(headers, { url: '/legacy/action?a=2' }), false);
  assert.equal(verify(headers, { url: '/legacy/action?a=%31' }), false);
  assert.equal(verifyBridgeRequest({ method: 'POST', url: '/legacy/action?a=1', headers }, 'csrf=test&value=2', key, new BridgeReplayCache(), now), false);
  assert.equal(verifyBridgeRequest({ method: 'POST', url: '/legacy/action?a=1', headers }, 'csrf=test&value=1', randomBytes(32), new BridgeReplayCache(), now), false);
  assert.equal(verify({ ...headers, 'x-zuku-bridge-signature': '0'.repeat(64) }), false);
});

test('proof timestamps, malformed headers, duplicate headers and replay fail closed', () => {
  const headers = signed();
  const replay = new BridgeReplayCache();
  assert.equal(verify(headers, {}, replay), true);
  assert.equal(verify(headers, {}, replay), false);
  assert.equal(verify(headers, {}, new BridgeReplayCache(), now + 61_000), false);
  assert.equal(verify(headers, {}, new BridgeReplayCache(), now - 61_000), false);
  assert.equal(verify(headers, {}, new BridgeReplayCache(), now + 60_000), true);
  assert.equal(verify({ ...headers, 'x-zuku-bridge-nonce': undefined }), false);
  assert.equal(verify({ ...headers, 'x-zuku-bridge-timestamp': ['1800000000', '1800000000'] }), false);
  assert.equal(verify({ ...headers, 'X-Zuku-Bridge-Signature': headers['x-zuku-bridge-signature'] }), false);
  assert.equal(verify({ 'x-forwarded-proto': 'https' }), false);
  assert.throws(() => bridgeKeyBytes('password'));
  assert.throws(() => signBridgeRequest({ method: 'POST\nGET', path: '/legacy', body: '', key }));
});

test('replay storage remains bounded and never evicts a usable nonce', () => {
  const cache = new BridgeReplayCache(1);
  assert.equal(verify(signed({ nonce: 'a'.repeat(48) }), {}, cache), true);
  assert.equal(verify(signed({ nonce: 'b'.repeat(48) }), {}, cache), false);
  assert.equal(verify(signed({ nonce: 'a'.repeat(48) }), {}, cache, now + 60_000), false);
  assert.equal(cache.size, 1);
  assert.equal(verify(signed({ now: now + 61_000, nonce: 'b'.repeat(48) }), {}, cache, now + 61_000), true);
  assert.equal(cache.size, 1);
});

test('proxy targets reject traversal, parser differentials and foreign routes', () => {
  for (const path of ['/legacy', '/legacy/', '/legacy/feed?page=2', '/legacy/search?q=a%2Fb']) assert.equal(isLegacyPath(path), true, path);
  for (const path of ['/legacyx', '/admin', '//evil.test/legacy', 'https://evil.test/legacy', '/legacy/../admin', '/legacy/%2e%2e/admin', '/legacy/%2fadmin', '/legacy/%252e%252e/admin', '/legacy\\admin', '/legacy#fragment', '/legacy/%00', '/legacy/%ZZ']) assert.equal(isLegacyPath(path), false, path);
  for (const origin of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/legacy', 'https://example.test/?q=1']) assert.throws(() => validateUpstreamOrigin(origin));
  assert.equal(validateUpstreamOrigin('https://example.test:8443').origin, 'https://example.test:8443');
});

test('Host and browser origin rules block DNS rebinding and cross-site calls, support absent IE6 Origin', () => {
  const host = '127.0.0.1:8788';
  const origin = `http://${host}`;
  assert.equal(validLocalHeaders({ host }, origin), true);
  assert.equal(validLocalHeaders({ host, referer: `${origin}/legacy`, origin }, origin), true);
  for (const headers of [{ host: 'evil.test:8788' }, { host: 'localhost:8788' }, { host, origin: 'null' }, { host, origin: 'https://evil.test' }, { host, referer: 'http://evil.test/legacy' }, { host, 'sec-fetch-site': 'cross-site' }, { host, 'sec-fetch-site': 'same-site' }]) assert.equal(validLocalHeaders(headers, origin), false);
});

test('remote cookie jars isolate browsers, respect paths and expiration, and reject foreign domains', () => {
  const first = new BridgeCookieJar('example.test', 2);
  const second = new BridgeCookieJar('example.test');
  first.absorb(['session=secret; Path=/legacy; HttpOnly; Secure', 'foreign=bad; Domain=evil.test', 'admin=private; Path=/legacy/admin'], '/legacy/login', now);
  assert.equal(first.header('/legacy/feed', now), 'session=secret');
  assert.equal(first.header('/legacy/admin', now), 'admin=private; session=secret');
  assert.equal(first.header('/legacyx', now), '');
  assert.equal(second.header('/legacy', now), '');
  assert.throws(() => first.absorb(['third=value; Path=/legacy'], '/legacy', now), /capacity/);
  first.absorb(['session=gone; Path=/legacy; Max-Age=0'], '/legacy', now);
  assert.equal(first.header('/legacy', now), '');
  first.absorb(['brief=one; Path=/legacy; Max-Age=1'], '/legacy', now);
  assert.equal(first.header('/legacy', now + 1001), '');
});

function request(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(url, { method: options.method ?? 'GET', headers: options.headers }, incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', chunk => chunks.push(chunk));
      incoming.on('end', () => resolve({ status: incoming.statusCode!, headers: incoming.headers, body: Buffer.concat(chunks).toString() }));
    });
    outgoing.once('error', reject);
    outgoing.end(options.body);
  });
}

test('loopback listener rejects spoofed hosts, unsafe methods, missing sessions and oversized bodies before proxying', async t => {
  const { server, url } = await startBridge({ upstreamOrigin: 'https://example.invalid', key, port: 0, maxRequestBytes: 8 });
  t.after(() => { server.close(); server.closeAllConnections(); });
  assert.equal((await request(url, { headers: { host: 'evil.test' } })).status, 403);
  assert.equal((await request(url, { headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request(new URL('/admin',url).href)).status, 404);
  assert.equal((await request(url, { method: 'DELETE' })).status, 405);
  assert.equal((await request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 415);
  assert.equal((await request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' })).status, 403);
  assert.equal((await request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '9' }, body: '123456789' })).status, 413);
});

test('verified HTTPS integration: cookie isolation, proof generation, redirect limits and invalid certificates', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zuku-bridge-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const certPath = join(directory, 'certificate.pem');
  const keyPath = join(directory, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  const tlsOptions = { cert: await readFile(certPath), key: await readFile(keyPath) };
  const seen: Array<{ path: string; cookie: string | undefined; body: string; proof: boolean; forwarded: string | undefined }> = [];
  const replay = new BridgeReplayCache();
  let remoteSessionCount = 0;
  const upstream = createHttpsServer(tlsOptions, async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    seen.push({ path: incoming.url!, cookie: incoming.headers.cookie, body: body.toString(), proof: verifyBridgeRequest({ method: incoming.method!, url: incoming.url!, headers: incoming.headers }, body, key, replay), forwarded: incoming.headers['x-forwarded-proto'] as string | undefined });
    if (incoming.url === '/legacy/escape') { response.writeHead(302, { location: 'https://evil.test/legacy' }); response.end(); return; }
    if (incoming.url === '/legacy/redirect') { response.writeHead(302, { location: '/legacy/feed?page=2' }); response.end(); return; }
    if (incoming.url === '/legacy/large') { response.end('x'.repeat(2048)); return; }
    if (!incoming.headers.cookie) response.setHeader('set-cookie', `zuku_lc_session=remote-${++remoteSessionCount}; Path=/; HttpOnly; Secure`);
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<form action="/legacy/action" method="post"><input name="csrf" value="test"></form>');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.close(); upstream.closeAllConnections(); });
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const upstreamOrigin = `https://localhost:${address.port}`;

  // NODE_EXTRA_CA_CERTS is read at process startup. This trusts only this test CA;
  // it does not disable certificate or hostname verification.
  const moduleUrl = new URL('../packages/bridge/dist/index.js', import.meta.url).href;
  const code = `import {startBridge} from ${JSON.stringify(moduleUrl)}; const {server,url}=await startBridge({upstreamOrigin:process.env.TEST_UPSTREAM,key:process.env.TEST_BRIDGE_KEY,port:0,maxResponseBytes:1024}); console.log(url); process.on('SIGTERM',()=>{server.close();server.closeAllConnections()});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath, TEST_UPSTREAM: upstreamOrigin, TEST_BRIDGE_KEY: key },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bridge test child failed to start')), 10_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.once('data', data => { clearTimeout(timer); resolve(String(data).trim()); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Bridge child exited ${code}`)); });
  });
  const first = await request(url, { headers: { 'x-forwarded-proto': 'https', 'x-zuku-bridge-signature': 'attacker' } });
  assert.equal(first.status, 200);
  const cookie = first.headers['set-cookie']?.[0]?.split(';')[0];
  assert.ok(cookie?.startsWith('zuku_lc_bridge='));
  assert.equal(cookie.includes('remote-'), false);
  assert.match(first.headers['set-cookie']![0]!, /HttpOnly; SameSite=Strict/);
  assert.equal(seen[0]!.path, '/');
  assert.equal(seen[0]!.proof, true);
  assert.equal(seen[0]!.forwarded, undefined);
  await request(url, { headers: { cookie } });
  assert.equal(seen.at(-1)!.cookie, 'zuku_lc_session=remote-1');
  await request(url);
  assert.equal(seen.at(-1)!.cookie, undefined);
  const posted = await request(new URL('/legacy/action',url).href, { method: 'POST', headers: { cookie, referer: url, 'content-type': 'application/x-www-form-urlencoded' }, body: 'csrf=test&text=hello' });
  assert.equal(posted.status, 200);
  assert.equal(seen.at(-1)!.body, 'csrf=test&text=hello');
  assert.equal(seen.at(-1)!.proof, true);
  assert.equal((await request(new URL('/legacy/escape',url).href, { headers: { cookie } })).status, 502);
  const redirected = await request(new URL('/legacy/redirect',url).href, { headers: { cookie } });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.location, '/legacy/feed?page=2');
  assert.equal((await request(new URL('/legacy/large',url).href, { headers: { cookie } })).status, 502);
  assert.equal((await request(new URL('/legacy/action',url).href, { method: 'POST', headers: { cookie, origin: 'https://evil.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'csrf=test' })).status, 403);

  // The same untrusted certificate must fail without the explicitly provisioned CA.
  const untrusted = await startBridge({ upstreamOrigin, key, port: 0 });
  t.after(() => { untrusted.server.close(); untrusted.server.closeAllConnections(); });
  assert.equal((await request(untrusted.url)).status, 502);
});
