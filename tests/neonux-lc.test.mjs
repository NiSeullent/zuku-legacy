import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = readFileSync(new URL('../packages/neonux-lc/dist/neonux-lc.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../packages/neonux-lc/dist/neonux-lc.css', import.meta.url), 'utf8');

function browser(renderer = 'dom', body = '<div id="status"><p>Service online</p></div>', bodyMode = '') {
  const page = new JSDOM(`<!DOCTYPE html><html><body data-lc-mode="${bodyMode}">${body}</body></html>`, { runScripts: 'outside-only' });
  const { window } = page;
  const { document } = window;
  const calls = [];
  const context = {};
  for (const method of ['fillRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke']) {
    context[method] = (...args) => calls.push([method, ...args]);
  }
  window.HTMLCanvasElement.prototype.getContext = function () {
    calls.push(['getContext']);
    if (renderer === 'broken-canvas') throw new Error('Unavailable renderer');
    return renderer === 'canvas' ? context : null;
  };
  if (renderer === 'vml' || renderer === 'broken-vml') {
    document.namespaces = { add(name, urn) { this[name] = urn; } };
    document.createStyleSheet = () => {
      if (renderer === 'broken-vml') throw new Error('Disabled by browser policy');
      return { addRule: (...args) => calls.push(['addRule', ...args]) };
    };
    const create = document.createElement.bind(document);
    document.createElement = function (tag) {
      const node = create(tag);
      if (tag === 'nxlc:shape') node.adj = {};
      return node;
    };
  }
  window.JSON = undefined;
  window.fetch = undefined;
  window.XMLHttpRequest = undefined;
  window.eval(runtime);
  return { page, window, document, api: window.NeonUXLC, calls, context };
}

test('shipped runtime parses as ECMAScript 3 and avoids modern/network APIs', () => {
  assert.doesNotThrow(() => parse(runtime, { ecmaVersion: 3 }));
  assert.doesNotMatch(runtime, /\b(?:fetch|XMLHttpRequest|ActiveXObject|JSON|Promise|Map|Set|eval|setTimeout|setInterval|requestAnimationFrame)\s*[.(]/);
  assert.doesNotMatch(runtime, /\.(?:querySelector|querySelectorAll|forEach|includes|classList|textContent|innerHTML)\b/);
  assert.ok(Buffer.byteLength(runtime) < 16_384, 'Uncompressed runtime exceeds 16 KiB budget');
});

test('plain DOM fallback preserves original content without allocating graphics', () => {
  const { page, document, api } = browser();
  try {
    const status = document.getElementById('status');
    const before = status.innerHTML;
    assert.equal(api.detect().renderer, 'dom');
    const graphic = api.surface(status, 160, 36);
    assert.equal(graphic.renderer, 'dom');
    assert.equal(graphic.rect(0, 0, 1, 1, '#ffffff'), false);
    assert.equal(status.innerHTML, before);
  } finally { page.window.close(); }
});

test('canvas primitives enforce bounds, safe colors, count budget and retained text', () => {
  const { page, document, api, calls } = browser('canvas');
  try {
    const status = document.getElementById('status');
    const graphic = api.surface(status, 160, 36);
    assert.equal(graphic.renderer, 'canvas');
    assert.equal(status.querySelector('p').textContent, 'Service online');
    assert.equal(status.querySelector('canvas').getAttribute('aria-hidden'), 'true');
    for (const args of [[-1, 0, 2, 2, '#ffffff'], [0, 0, Infinity, 1, '#ffffff'], [0.5, 0, 2, 2, '#ffffff'], [0, 0, 161, 1, '#ffffff'], [0, 0, 2, 2, 'url(javascript:alert(1))'], [0, 0, 0, 1, '#ffffff']]) {
      assert.equal(graphic.rect(...args), false);
    }
    assert.equal(graphic.line(0, 0, 161, 20, '#ffffff'), false);
    assert.equal(graphic.line(0, 0, 20, 20, '#ffffff', 5), false);
    assert.equal(calls.filter(([name]) => name === 'fillRect').length, 0);
    for (let i = 0; i < 64; i++) assert.equal(graphic.rect(0, 0, 1, 1, '#abcdef'), true);
    assert.equal(graphic.rect(0, 0, 1, 1, '#abcdef'), false);
    graphic.clear();
    assert.equal(graphic.line(0, 0, 160, 36, '#ABCDEF', 4), true);
    graphic.destroy();
    graphic.destroy();
    assert.equal(graphic.rect(0, 0, 1, 1, '#abcdef'), false);
    assert.equal(status.children.length, 1);
  } finally { page.window.close(); }
});

test('surface dimensions, page-wide live allocation and destruction are bounded', () => {
  const { page, document, api } = browser('canvas');
  try {
    const status = document.getElementById('status');
    for (const [width, height] of [[321, 1], [1, 161], [0, 10], ['160', 36], [NaN, 10]]) {
      assert.equal(api.surface(status, width, height).renderer, 'dom');
    }
    const surfaces = [];
    for (let i = 0; i < 4; i++) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      surfaces.push(api.surface(host, 320, 160));
    }
    assert.equal(api.surface(status, 160, 36).renderer, 'dom');
    surfaces[0].destroy();
    assert.equal(api.surface(status, 160, 36).renderer, 'canvas');
    assert.equal(document.getElementsByTagName('canvas').length, 4);
  } finally { page.window.close(); }
});

test('VML fallback uses bounded nodes, explicit attributes and an internal behavior', () => {
  const { page, document, api, calls } = browser('vml');
  try {
    const status = document.getElementById('status');
    const graphic = api.surface(status, 100, 50);
    assert.equal(graphic.renderer, 'vml');
    assert.equal(graphic.rect(2, 3, 20, 10, '#abcdef'), true);
    assert.equal(graphic.line(0, 0, 80, 40, '#123456', 2), true);
    const wrapper = status.lastChild;
    assert.equal(wrapper.children.length, 2);
    assert.equal(wrapper.firstChild.nodeName, 'NXLC:RECT');
    assert.equal(wrapper.firstChild.style.width, '20px');
    assert.equal(wrapper.firstChild.fillcolor, '#abcdef');
    assert.equal(wrapper.lastChild.to, '80,40');
    assert.equal(status.querySelector('p').textContent, 'Service online');
    assert.equal(calls.filter(([name]) => name === 'addRule').length, 1);
    assert.match(calls.find(([name]) => name === 'addRule')[2], /url\(#default#VML\)/);
    graphic.clear();
    assert.equal(wrapper.children.length, 0);
    graphic.destroy();
    assert.equal(status.children.length, 1);
  } finally { page.window.close(); }
});

test('renderer initialization failure falls back to retained DOM', () => {
  for (const renderer of ['broken-canvas', 'broken-vml']) {
    const { page, document, api } = browser(renderer);
    try {
      assert.equal(api.surface(document.getElementById('status'), 160, 36).renderer, 'dom');
      assert.equal(document.getElementById('status').children.length, 1);
    } finally { page.window.close(); }
  }
});

test('text and low-power preferences avoid probes and remove existing enhancements', () => {
  for (const mode of ['text', 'low-power']) {
    const { page, document, api, calls } = browser('canvas', '<div id="status" data-lc-surface="status"><p>Online</p></div>', mode);
    try {
      assert.equal(api.init(document).enhanced, 0);
      assert.equal(api.surface(document.getElementById('status'), 160, 36, { mode: 'auto' }).renderer, 'dom');
      assert.equal(calls.length, 0);
      document.body.setAttribute('data-lc-mode', 'auto');
      assert.equal(api.init(document).enhanced, 1);
      assert.equal(api.init(document).enhanced, 1);
      assert.equal(document.getElementsByTagName('canvas').length, 1);
      assert.equal(api.init(document, { mode }).enhanced, 0);
      assert.equal(document.getElementsByTagName('canvas').length, 0);
      assert.equal(document.getElementById('status').textContent, 'Online');
    } finally { page.window.close(); }
  }
});

test('automatic enhancement scans a bounded number of divs', () => {
  const { page, document, api } = browser('canvas', `${'<div></div>'.repeat(600)}<div id="status" data-lc-surface="status"><p>Online</p></div>`);
  try {
    assert.equal(api.init(document).enhanced, 0);
    assert.equal(document.getElementsByTagName('canvas').length, 0);
  } finally { page.window.close(); }
});

test('attachEvent load path works without modern event listeners', () => {
  const { page, window, document } = browser('dom');
  try {
    let handler;
    window.addEventListener = undefined;
    window.attachEvent = (event, fn) => { assert.equal(event, 'onload'); handler = fn; };
    window.eval(runtime);
    assert.equal(typeof handler, 'function');
    assert.doesNotThrow(() => handler());
    assert.equal(document.getElementById('status').textContent, 'Service online');
  } finally { page.window.close(); }
});

test('compiled CSS uses literal shared tokens and a block baseline', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(withoutComments, /var\(|--neon-|\{\{|display:\s*(?:flex|grid)|@import|expression\(|@font-face/);
  assert.match(withoutComments, /\.lc-shell\s*\{[^}]*max-width:/);
  assert.doesNotMatch(withoutComments.split('@media')[0], /(?:min-width|float):/);
  assert.ok(Buffer.byteLength(css) < 12_288, 'Uncompressed CSS exceeds 12 KiB budget');
  const map = JSON.parse(readFileSync(new URL('../packages/neonux-lc/dist/token-map.json', import.meta.url), 'utf8'));
  assert.equal(map.tokens['neon-canvas'], '#0f1115');
  assert.equal(map.tokens['neon-accent'], '#e91e63');
  assert.equal(map.source.commit, 'fbb3840af0076c580680fe9d8b90cf50a639ddc7');
});

test('generated assets match pinned semantic source snapshots', () => {
  execFileSync(process.execPath, ['packages/neonux-lc/scripts/build.mjs', '--check'], { cwd: root });
  assert.ok(statSync(new URL('../packages/neonux-lc/vendor/LICENSE', import.meta.url)).size > 10_000);
});
