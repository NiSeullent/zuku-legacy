// Geometry stress test for the CSS baseline, with every media query removed.
// Chromium checks layout invariants; the separate IE6 VM verifies Microsoft's engine.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const css = await readFile(new URL('../packages/neonux-lc/dist/neonux-lc.css', import.meta.url), 'utf8');
const baseline = css.slice(0, css.indexOf('@media screen'));
assert.ok(baseline.length > 1000);
const longWord = 'a'.repeat(240);
const markup = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd"><html lang="ko"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>${baseline}</style></head><body class="lc-page">
<a class="lc-skip" href="#main">본문 바로가기</a><div class="lc-shell"><div class="lc-header"><a class="lc-brand" href="/"><span class="lc-brand-mark">Z</span> ZUKU <span class="lc-badge">LEGACY</span></a><p class="lc-muted">Swipe, Jump, Hype! 다시 만난 우리 세계로.</p><p class="lc-header-actions"><a class="lc-button" href="/settings">화면 설정</a></p></div>
<div class="lc-layout"><div class="lc-sidebar"><p class="lc-eyebrow">ZUKU NETWORK</p><ul class="lc-nav">${['둘러보기','Thread','Hype','Swipe','Jump','Vive','Vine'].map((name) => `<li><a href="/">${name}</a></li>`).join('')}</ul></div>
<div class="lc-main" id="main"><form class="lc-search"><label class="lc-label" for="q">ZUKU 검색</label><input class="lc-input" id="q" name="q" type="text" value="${longWord}"><button class="lc-button lc-button-primary" type="submit">검색</button></form><div class="lc-hero"><h1>가벼운 웹, 넓은 세계.</h1><p>창작물과 이야기, 모두 같은 ZUKU에서 만나요.</p></div>
<div class="lc-card"><h2>Long content / 긴 콘텐츠</h2><p>${longWord}</p></div><div class="lc-panel"><div class="lc-panel-body"><a class="lc-button" href="/">텍스트 모드 — 효과 없이 편안하게 읽기</a><form><label class="lc-label" for="comment">댓글</label><textarea class="lc-input" id="comment" rows="4" cols="35">${longWord}</textarea><button class="lc-button" type="submit">댓글 남기기</button></form><table class="lc-table" summary="Compatibility"><tr><th>지원 기능</th><th>설명</th></tr><tr><td>플랫폼</td><td>${longWord}</td></tr></table></div></div></div></div><div class="lc-footer"><p>ZUKU Web Client (Legacy)</p></div></div></body></html>`;

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const results = [];
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
try {
  for (const width of [320, 480, 1024]) for (const baseFontSize of [16, 24, 32]) {
    const page = await browser.newPage({ viewport: { width, height: 768 } });
    await page.setContent(markup);
    await page.evaluate((size) => { document.documentElement.style.fontSize = size + 'px'; }, baseFontSize);
    const layout = await page.evaluate(() => {
      const bounds = (selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height }; };
      return {
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        nav: bounds('.lc-nav'),
        tabs: Array.from(document.querySelectorAll('.lc-nav a')).map((node) => {
          const style = getComputedStyle(node);
          return { label: node.textContent, height: node.getBoundingClientRect().height,
            singleLineHeight: parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth) };
        }),
        main: bounds('.lc-main'),
        title: bounds('h1'),
        controls: Array.from(document.querySelectorAll('input, textarea, button, .lc-panel-body a.lc-button')).map((node) => ({ right: node.getBoundingClientRect().right, left: node.getBoundingClientRect().left })),
      };
    });
    assert.ok(layout.scrollWidth <= layout.width, `Baseline overflow: ${JSON.stringify({ width, baseFontSize, layout })}`);
    assert.ok(layout.main.top >= layout.nav.bottom, 'Floated navigation must remain contained above content');
    for (const tab of layout.tabs) assert.ok(Math.abs(tab.height - tab.singleLineHeight) <= 1, `Navigation labels must wrap as whole tabs: ${JSON.stringify({ width, baseFontSize, tab })}`);
    for (const control of layout.controls) assert.ok(control.right <= width && control.left >= 0, `Control outside viewport: ${JSON.stringify({ width, baseFontSize, control })}`);
    if (width === 1024 && baseFontSize === 16) {
      assert.ok(layout.nav.height < 60, `Navigation tabs should fit one compact desktop row: ${layout.nav.height}`);
      assert.ok(layout.title.top < 650, `Primary content must be visible in a 768px desktop window: ${layout.title.top}`);
      await page.screenshot({ path: new URL('../artifacts/legacy-baseline-no-media-1024.png', import.meta.url).pathname });
    }
    results.push({ width, baseFontSize, navHeight: layout.nav.height, titleTop: layout.title.top, horizontalOverflow: false });
    await page.close();
  }
  await writeFile(new URL('../artifacts/legacy-layout-baseline.json', import.meta.url), JSON.stringify({ engine: 'Chromium; all media queries removed; no application JavaScript', results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
