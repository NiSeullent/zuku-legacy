import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLegacyApp} from '@zuku/legacy-core';
test('a stalled streamed form is cancelled before tying up a Next handler indefinitely',async()=>{
  let cancelled=false;
  const app=createLegacyApp({apiOrigin:'https://api.example.test',publicOrigin:'https://zuku.example.test',requestBodyTimeoutMs:10,fetch:async()=>{throw new Error('Must not call API');}});
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('csrf='));},cancel(){cancelled=true;}});
  const request=new Request('https://zuku.example.test/legacy/actions/post',{method:'POST',body,duplex:'half',headers:{'content-type':'application/x-www-form-urlencoded'}});
  const response=await app.handle(request,{secureTransport:true});
  assert.equal(response.status,408);assert.equal(cancelled,true);
});
