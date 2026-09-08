import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createLegacyApp } from '../packages/legacy-core/src/index.js';
import { assetRevision, CLASSIC_ASSET_REVISION } from '../packages/legacy-core/src/assets.js';
import { CLASSIC_CSS, CLASSIC_JS } from '@zuku/neonux-lc/server-assets';

const ORIGIN = 'http://zuku.example.test';
const OLD_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.2)';

test('SSR asset URLs share a revision of the exact served CSS and JS, including text mode', async () => {
  const app = createLegacyApp({
    apiOrigin: 'https://api.example.test', publicOrigin: ORIGIN,
    fetch: async () => { throw new Error('Local compatibility pages and assets must not call the API'); },
  });
  const request = (path: string, method = 'GET') => new Request(ORIGIN + path, { method, headers: { 'user-agent': OLD_UA } });
  const page = await app.handle(request('/compatibility'));
  assert.equal(page.status, 200);
  const html = await page.text();
  const cssPath = html.match(/<link[^>]+href="([^"]+\.css\?v=[a-f0-9]{64})"/)?.[1];
  const jsPath = html.match(/<script[^>]+src="([^"]+\.js\?v=[a-f0-9]{64})"/)?.[1];
  assert.ok(cssPath);
  assert.ok(jsPath);
  const bodies: string[] = [];
  for (const [path, kind] of [[cssPath, 'css'], [jsPath, 'js']] as const) {
    const url = new URL(path, ORIGIN);
    assert.equal(url.pathname, `/legacy/assets/neonux-lc.${kind}`);
    assert.equal(url.search, '?v=' + CLASSIC_ASSET_REVISION);
    const asset = await app.handle(request(path));
    assert.equal(asset.status, 200);
    bodies.push(await asset.text());
    const head = await app.handle(request(path, 'HEAD'));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-type'), asset.headers.get('content-type'));
  }
  assert.deepEqual(bodies, [CLASSIC_CSS, CLASSIC_JS]);
  assert.equal(CLASSIC_ASSET_REVISION, createHash('sha256').update(bodies.join('\0')).digest('hex'));
  const textPage = await app.handle(request('/compatibility?mode=text'));
  const textHtml = await textPage.text();
  assert.ok(textHtml.includes(`href="${cssPath}"`));
  assert.ok(!textHtml.includes('<script'));
});

test('a change in either compiled asset changes the revision without a manual version bump', () => {
  assert.equal(assetRevision(CLASSIC_CSS, CLASSIC_JS), CLASSIC_ASSET_REVISION);
  assert.notEqual(assetRevision(CLASSIC_CSS + '\n/* CSS update */', CLASSIC_JS), CLASSIC_ASSET_REVISION);
  assert.notEqual(assetRevision(CLASSIC_CSS, CLASSIC_JS + '\n/* JS update */'), CLASSIC_ASSET_REVISION);
  assert.notEqual(assetRevision('ab', 'c'), assetRevision('a', 'bc'));
});
