import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isClassicUserAgent, publicToLegacyPath } from '@zuku/legacy-core/routing';
import { createLegacyApp } from '@zuku/legacy-core';

const LIMIT = 16 * 1024;
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-f0-9]{64,1024}$/i.test(b)) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
/** The adapter, not the request URL, decides whether the accepted transport is HTTPS. */
export function createStandaloneServer({app, publicOrigin, tls, ingressKey, modernOrigin='https://www.zuzunza.com', forceClassic=false}) {
  const origin = new URL(publicOrigin);
  let active = 0;
  async function serve(req, res) {
    const reject = (status, message) => { res.writeHead(status, {'Content-Type':'text/plain; charset=utf-8','Connection':'close'}); res.end(message); };
    if (req.headers.host !== origin.host) return reject(421,'Unexpected Host');
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || /[\\\x00-\x20]/.test(req.url)) return reject(400,'Invalid request target');
    if (req.url === '/healthz' && req.method === 'GET') { res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end('{"status":"ok","service":"zuku-legacy"}'); return; }
    const parsed = new URL(req.url,origin);
    if (!forceClassic && publicToLegacyPath(parsed.pathname) !== null && !isClassicUserAgent(req.headers['user-agent']) && !req.headers['x-zuku-bridge-signature'] && ['GET','HEAD'].includes(req.method)) {
      const destination = new URL(parsed.pathname+parsed.search,modernOrigin);
      if (destination.origin === origin.origin) return reject(503,'Mount the modern renderer on this origin before enabling standalone handoff');
      res.writeHead(302,{'Location':destination.href,'Content-Length':'0','Vary':'User-Agent','Cache-Control':'no-store'});res.end();return;
    }
    const length = req.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length) > LIMIT)) return reject(413,'Request too large');
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > LIMIT) return reject(413,'Request too large');
      chunks.push(chunk);
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && size) return reject(400,'GET/HEAD body is not supported');
    const headers = new Headers();
    for (const [name,value] of Object.entries(req.headers)) {
      if (value !== undefined && !['host','connection','transfer-encoding','content-length'].includes(name)) headers.set(name,Array.isArray(value) ? value.join(', ') : value);
    }
    const request = new Request(new URL(req.url,origin),{method:req.method,headers,...(size ? {body:Buffer.concat(chunks)} : {})});
    const response = await app.handle(request,{
      secureTransport: req.socket.encrypted === true || (origin.protocol === 'https:' && equal(req.headers['x-zuku-ingress-key'],ingressKey)),
      clientAddress: req.socket.remoteAddress,
      forceClassicView: forceClassic,
    });
    const responseBody = req.method === 'HEAD' ? null : Buffer.from(await response.arrayBuffer());
    const outgoing = Object.fromEntries(response.headers);
    if (response.headers.getSetCookie().length) outgoing['set-cookie'] = response.headers.getSetCookie();
    outgoing['content-length'] = String(responseBody?.length || 0);
    res.writeHead(response.status,outgoing);
    res.end(responseBody);
  }
  const handler = (req,res) => {
    if (active >= 64) { res.writeHead(503,{'Connection':'close'}); res.end('Server busy'); return; }
    active++;
    serve(req,res).catch(() => { if (!res.headersSent) res.writeHead(500,{'Content-Type':'text/plain','Connection':'close'}); res.end('Request failed'); }).finally(()=>active--);
  };
  const config={maxHeaderSize:16*1024,headersTimeout:10_000,requestTimeout:15_000,connectionsCheckingInterval:1000};
  const server = tls ? httpsServer({...config,...tls,minVersion:'TLSv1.2'},handler) : httpServer(config,handler);
  server.maxConnections=128;
  server.keepAliveTimeout=1000;
  server.maxHeadersCount=64;
  server.on('connect',(_req,socket)=>socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  return server;
}

export async function main() {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const certPath=process.env.ZUKU_TLS_CERT, keyPath=process.env.ZUKU_TLS_KEY;
  if (!!certPath !== !!keyPath) throw new Error('Set both ZUKU_TLS_CERT and ZUKU_TLS_KEY');
  const publicOrigin=process.env.ZUKU_PUBLIC_ORIGIN || `${certPath ? 'https' : 'http'}://127.0.0.1:${port}`;
  const forceClassic=process.env.ZUKU_FORCE_CLASSIC === '1';
  const app=createLegacyApp({apiOrigin:process.env.ZUKU_API_ORIGIN || 'http://127.0.0.1:30012',publicOrigin,modernOrigin:process.env.ZUKU_MODERN_ORIGIN,bridgeKey:process.env.ZUKU_BRIDGE_KEY});
  const tls=certPath && keyPath ? {cert:await readFile(certPath),key:await readFile(keyPath)} : undefined;
  const server=createStandaloneServer({app,publicOrigin,tls,ingressKey:process.env.ZUKU_HTTPS_PROXY_SECRET,modernOrigin:process.env.ZUKU_MODERN_ORIGIN,forceClassic});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  console.log(`ZUKU Legacy: ${publicOrigin}/ (${forceClassic ? 'dedicated classic host' : 'classic browsers selected automatically'})`);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
