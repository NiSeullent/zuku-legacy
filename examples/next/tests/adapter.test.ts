import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHttpsOrigin, verifyHttpsIngress } from '../lib/ingress';
import { normalizeDeviceCode, tokenApproval } from '../lib/device-approval';

const key = 'ab'.repeat(32);
function request(headers: Record<string, string> = {}) {
  return new Request('http://internal.example:3000/legacy/authorize', {
    headers: { host: 'zuku.example', ...headers },
  });
}

test('HTTPS ingress requires explicit key and canonical host, ignores forwarded protocol', () => {
  assert.equal(verifyHttpsIngress(request({ 'x-forwarded-proto': 'https' }), 'https://zuku.example'), false);
  assert.equal(verifyHttpsIngress(request({ 'x-forwarded-proto': 'https' }), 'https://zuku.example', key), false);
  assert.equal(verifyHttpsIngress(request({ 'x-zuku-ingress-key': key }), 'https://zuku.example', key), true);
  assert.equal(verifyHttpsIngress(request({ 'x-zuku-ingress-key': 'cd'.repeat(32) }), 'https://zuku.example', key), false);
  assert.equal(verifyHttpsIngress(request({ 'x-zuku-ingress-key': key, host: 'attacker.example' }), 'https://zuku.example', key), false);
  assert.equal(verifyHttpsIngress(request({ 'x-zuku-ingress-key': 'short' }), 'https://zuku.example', key), false);
  assert.equal(verifyHttpsIngress(request({ 'x-zuku-ingress-key': 'x'.repeat(300) }), 'https://zuku.example', key), false);
  assert.throws(() => verifyHttpsIngress(request(), 'https://zuku.example', 'weak'), /random bytes/);
});

test('canonical origin accepts only a bare HTTPS origin', () => {
  assert.equal(canonicalHttpsOrigin('https://zuku.example:443/'), 'https://zuku.example');
  for (const origin of ['http://zuku.example', 'https://user:pass@zuku.example', 'https://zuku.example/legacy', 'https://zuku.example?x=1', 'https://zuku.example/#x']) {
    assert.throws(() => canonicalHttpsOrigin(origin));
  }
});

test('device code validation rejects nonhex and ambiguous inputs', () => {
  assert.equal(normalizeDeviceCode('abcd-1234-efab'), 'ABCD1234EFAB');
  for (const code of ['<script>x</script>', '1234', 'ABCD 1234 EFAB', 'GGGG-1234-EFAB']) assert.equal(normalizeDeviceCode(code), '');
});

test('approval is explicit, same-origin and sends bearer only in the authorize POST', async () => {
  const originalFetch = globalThis.fetch;
  let tokenCalls = 0;
  let networkCalls = 0;
  const token = 'a'.repeat(40);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { protocol: 'https:' } } });
  globalThis.fetch = async (url, init) => {
    networkCalls++;
    assert.equal(url, '/legacy/authorize');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.mode, 'same-origin');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + token);
    assert.equal(new Headers(init?.headers).get('origin'), null, 'Browser must supply Origin itself');
    assert.deepEqual(JSON.parse(String(init?.body)), { code: 'ABCD1234EFAB' });
    return Response.json({ success: true, display_name: 'ZUKU user' });
  };
  try {
    const approve = tokenApproval(() => { tokenCalls++; return token; });
    assert.equal(tokenCalls, 0);
    assert.equal(networkCalls, 0);
    assert.deepEqual(await approve('abcd-1234-efab'), { displayName: 'ZUKU user' });
    assert.equal(tokenCalls, 1);
    assert.equal(networkCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('approval fails closed on HTTP, missing host login, redirects, HTML and invalid JSON', async () => {
  const originalFetch = globalThis.fetch;
  const fakeWindow = { location: { protocol: 'http:' } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ success: true }); };
  try {
    await assert.rejects(tokenApproval(() => 'a'.repeat(40))('ABCD1234EFAB'), /HTTPS/);
    assert.equal(calls, 0);
    fakeWindow.location.protocol = 'https:';
    await assert.rejects(tokenApproval(() => null)('ABCD1234EFAB'), /로그인/);
    assert.equal(calls, 0);
    globalThis.fetch = async () => new Response('<script>alert("leak")</script>', { status: 403, headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(tokenApproval(() => 'a'.repeat(40))('ABCD1234EFAB'), (error: Error) => {
      assert.match(error.message, /보호된 연결/);
      assert.doesNotMatch(error.message, /script|leak/);
      return true;
    });
    globalThis.fetch = async () => new Response('success', { headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(tokenApproval(() => 'a'.repeat(40))('ABCD1234EFAB'), /응답/);
    globalThis.fetch = async () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(tokenApproval(() => 'a'.repeat(40))('ABCD1234EFAB'), /응답/);
    globalThis.fetch = async () => Response.json({ success: false });
    await assert.rejects(tokenApproval(() => 'a'.repeat(40))('ABCD1234EFAB'), /확인되지/);
    globalThis.fetch = async () => { throw new TypeError('redirect rejected'); };
    await assert.rejects(tokenApproval(() => 'a'.repeat(40))('ABCD1234EFAB'), /네트워크/);
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, 'window');
  }
});
