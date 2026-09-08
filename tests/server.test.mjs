import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStandaloneServer} from '../apps/server/server.mjs';
import {request as httpRequest} from 'node:http';

test('standalone adapter derives trust from socket/authenticated ingress and rejects foreign Host',async()=>{
  const calls=[];const origin='http://127.0.0.1:18789';
  const server=createStandaloneServer({publicOrigin:origin,app:{handle:async(req,ctx)=>{calls.push(ctx);return new Response('OK');}}});
  await new Promise(r=>server.listen(18789,'127.0.0.1',r));
  try {
    let response=await fetch(origin+'/legacy',{headers:{'x-forwarded-proto':'https','x-zuku-ingress-key':'a'.repeat(64)}});
    assert.equal(response.status,200);assert.equal(calls[0].secureTransport,false);
    const foreign=await new Promise((resolve,reject)=>{const request=httpRequest(origin+'/legacy',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});request.on('error',reject);request.end();});
    assert.equal(foreign,421);assert.equal(calls.length,1);
    const modern=await fetch(origin+'/',{redirect:'manual',headers:{'user-agent':'Mozilla/5.0 Chrome/140.0.0.0'}});
    assert.equal(modern.status,302);assert.equal(modern.headers.get('location'),'https://www.zuzunza.com/');assert.equal(calls.length,1);
    response=await fetch(origin+'/legacy',{method:'POST',body:'x'.repeat(17000)});assert.equal(response.status,413);assert.equal(calls.length,1);
  } finally {await new Promise(r=>server.close(r));}
});

test('dedicated classic host keeps modern user agents and products on canonical paths',async()=>{
  const calls=[];const origin='http://127.0.0.1:18790';
  const server=createStandaloneServer({publicOrigin:origin,forceClassic:true,app:{handle:async(req,ctx)=>{
    calls.push({url:req.url,ctx});return new Response('<a href="/hype">Hype</a><a href="/swipe">Swipe</a><a href="/vine">Vine</a><a href="/vive">Vive</a>',{headers:{'content-type':'text/html'}});
  }}});
  await new Promise(r=>server.listen(18790,'127.0.0.1',r));
  try {
    for (const path of ['/','/hype','/swipe','/vine','/vive']) {
      const response=await fetch(origin+path,{redirect:'manual',headers:{'user-agent':'Mozilla/5.0 Chrome/140.0.0.0'}});
      assert.equal(response.status,200,path);assert.equal(response.headers.get('location'),null,path);
      const html=await response.text();
      for (const product of ['hype','swipe','vine','vive']) assert.ok(html.includes(`href="/${product}"`));
    }
    assert.equal(calls.length,5);
    assert.ok(calls.every(call=>call.ctx.forceClassicView===true));
    assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/','/hype','/swipe','/vine','/vive']);
  } finally {await new Promise(r=>server.close(r));}
});
