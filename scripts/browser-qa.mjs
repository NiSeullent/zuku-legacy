import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createLegacyApp } from '@zuku/legacy-core';
import { createStandaloneServer } from '../apps/server/server.mjs';
import { fixtureFetch } from '../tests/fixtures.mjs';

const port=Number(process.env.QA_PORT || 18787), origin=`http://127.0.0.1:${port}`;
const app=createLegacyApp({apiOrigin:'https://api.example.test',publicOrigin:origin,fetch:fixtureFetch});
const server=createStandaloneServer({app,publicOrigin:origin});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
const report=[];
try {
  for (const js of [true,false]) for (const width of [320,390,1024,1440]) {
    const context=await browser.newContext({javaScriptEnabled:js,viewport:{width,height:1000},userAgent:'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)'});
    const page=await context.newPage(),errors=[],requests=[];
    page.on('pageerror',err=>errors.push(err.message));page.on('request',req=>requests.push(req.url()));
    const response=await page.goto(origin+'/');assert.equal(response.status(),200);
    await page.locator('h1').filter({hasText:'가벼운 웹'}).waitFor();
    const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,nodes:document.getElementsByTagName('*').length}));
    assert.ok(dimensions.scroll<=dimensions.width,`overflow ${width} js=${js}: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.nodes<500);assert.deepEqual(errors,[]);
    assert.ok(requests.every(url=>url.startsWith(origin)), 'no third-party browser requests');
    await page.locator('#q').fill('게임');await page.getByRole('button',{name:'검색',exact:true}).click();
    await page.waitForURL(/\/search\?/);await page.getByRole('heading',{name:'“게임” 검색 결과'}).waitFor();
    await page.getByRole('link',{name:'작은 화면에 담은 넓은 세계',exact:true}).click();
    await page.waitForURL(/\/content\/cnt_demo/);await page.getByRole('heading',{name:'작은 화면에 담은 넓은 세계',exact:true}).waitFor();
    await page.getByRole('link',{name:'Thread',exact:true}).click();await page.waitForURL(/\/community$/);
    await page.getByRole('link',{name:'대화 열기'}).click();await page.waitForURL(/\/community\/pst_demo/);
    await page.goto(origin+'/?mode=text');assert.equal(await page.locator('script').count(),0);assert.equal(await page.locator('canvas').count(),0);
    await page.goto(origin+'/login');assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.locator('form[action$="/connect"]').count(),0);
    await page.goto(origin+'/');
    if(js) await page.screenshot({path:new URL(`../artifacts/legacy-${width}.png`,import.meta.url).pathname,fullPage:width===320});
    report.push({browser:'Chromium',routingUserAgent:'IE6 (routing only; not IE6 engine)',javascript:js,width,status:'passed',nodes:dimensions.nodes});
    await context.close();
  }
  await writeFile(new URL('../artifacts/browser-qa.json',import.meta.url),JSON.stringify({source:'deterministic test fixtures; canonical URLs with automatic classic routing',runtime:process.version,ie6VM:'Not exercised by this Chromium runner; see docs/ie6-vm.md for separate native IE6 evidence.',report},null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));}
