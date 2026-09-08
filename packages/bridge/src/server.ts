import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Readable } from 'node:stream';
import { publicToLegacyPath } from './routing.js';
import { BridgeCookieJar } from './cookies.js';
import { bridgeKeyBytes, signBridgeRequest, type BridgeKey } from './proof.js';

export interface BridgeOptions {
  /** Exact HTTPS origin, provisioned by the operator; no arbitrary proxy targets. */
  upstreamOrigin: string;
  key: BridgeKey;
  port?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
  maxSessions?: number;
}

interface BrowserSession { jar: BridgeCookieJar; touched: number }
interface UpstreamResponse { status: number; headers: IncomingMessage['headers']; body: Buffer }
class BridgeError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const COOKIE_NAME = 'zuku_lc_bridge';
const SESSION_LIFETIME = 60 * 60 * 1000;

/** Reject parser differentials, traversal, absolute-form URLs and non-legacy routes. */
export function isLegacyPath(path: string): boolean {
  if (path.length > 4096 || /[^\x21-\x7e]|[\\#]/.test(path) || !path.startsWith('/') || path.startsWith('//')) return false;
  try {
    const pathname = path.split('?')[0]!;
    const parsed = new URL(path, 'https://legacy.invalid');
    if (parsed.pathname !== pathname || /%(?:2f|5c|25)/i.test(pathname)) return false;
    const decoded = decodeURIComponent(pathname);
    if (/[\u0000-\u0020\u007f\\]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) return false;
    return pathname === '/legacy' || pathname.startsWith('/legacy/') || publicToLegacyPath(pathname) !== null;
  } catch { return false; }
}

export function validateUpstreamOrigin(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Upstream must be an HTTPS origin without credentials, path, query, or fragment');
  }
  return url;
}

/** Absence is allowed for IE6; authenticated mutations still need the upstream CSRF token. */
export function validLocalHeaders(headers: IncomingMessage['headers'], localOrigin: string): boolean {
  if (headers.host !== new URL(localOrigin).host) return false;
  if (headers.origin !== undefined && headers.origin !== localOrigin) return false;
  if (headers['sec-fetch-site'] === 'cross-site' || headers['sec-fetch-site'] === 'same-site') return false;
  if (headers.referer !== undefined) {
    try {
      const referer = new URL(headers.referer);
      if (referer.origin !== localOrigin || referer.username || referer.password) return false;
    } catch { return false; }
  }
  return true;
}

function bodyOf(stream: Readable, limit: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => finish(new BridgeError(408, 'Request timed out')), timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      // Keep the one-time error handler: aborted streams can emit an error after
      // their abort event, including after this promise has already rejected.
      stream.off('aborted', onAborted);
      if (error) { stream.pause(); reject(error); } else resolve(Buffer.concat(chunks, size));
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) finish(new BridgeError(413, 'Body exceeds bridge limit'));
      else chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);
    const onAborted = () => finish(new Error('Request aborted'));
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.once('aborted', onAborted);
  });
}

function positive(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('Bridge limits must be positive integers');
  return result;
}

function failure(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'connection': 'close',
  });
  response.end(message);
}

export function createBridgeServer(options: BridgeOptions): Server {
  const upstream = validateUpstreamOrigin(options.upstreamOrigin);
  const key = bridgeKeyBytes(options.key);
  const maxRequest = positive(options.maxRequestBytes, 64 * 1024);
  const maxResponse = positive(options.maxResponseBytes, 2 * 1024 * 1024);
  const timeout = positive(options.timeoutMs, 15_000);
  const maxSessions = positive(options.maxSessions, 128);
  const sessions = new Map<string, BrowserSession>();
  let active = 0;

  function upstreamRequest(request: IncomingMessage, body: Buffer, session: BrowserSession): Promise<UpstreamResponse> {
    return new Promise((resolve, reject) => {
      const path = request.url!;
      const headers: Record<string, string> = {
        ...signBridgeRequest({ method: request.method!, path, body, key }),
        'accept': 'text/html, text/css, application/javascript, image/*;q=0.8, */*;q=0.1',
        'accept-encoding': 'identity',
        // Entering the companion explicitly chooses the classic renderer, even on a modern low-power browser.
        'user-agent': 'Mozilla/4.0 (compatible; MSIE 6.0; ZUKU-Legacy-Bridge/0.1)',
      };
      const cookie = session.jar.header(path.split('?')[0]!);
      if (cookie) headers.cookie = cookie;
      if (request.method === 'POST') {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        headers['content-length'] = String(body.byteLength);
      }
      // Explicit TLS options cannot be disabled by NODE_TLS_REJECT_UNAUTHORIZED.
      const outgoing = httpsRequest(new URL(path, upstream), {
        method: request.method, headers, minVersion: 'TLSv1.2', rejectUnauthorized: true,
        agent: false, maxHeaderSize: 16 * 1024,
      }, incoming => {
        if (incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') {
          incoming.destroy(); reject(new BridgeError(502, 'Unexpected upstream encoding')); return;
        }
        void bodyOf(incoming, maxResponse, timeout).then(body => {
          resolve({ status: incoming.statusCode ?? 502, headers: incoming.headers, body });
        }, error => { incoming.destroy(); reject(error); });
      });
      const timer = setTimeout(() => outgoing.destroy(new Error('Upstream timeout')), timeout);
      outgoing.once('close', () => clearTimeout(timer));
      outgoing.once('error', reject);
      outgoing.end(body);
    });
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // This check also fails closed if an embedder accidentally binds a public interface.
    if (request.socket.remoteAddress !== '127.0.0.1' || request.socket.localAddress !== '127.0.0.1') {
      throw new BridgeError(403, 'Bridge requires the same-device loopback interface');
    }
    const localOrigin = `http://127.0.0.1:${request.socket.localPort}`;
    if (!validLocalHeaders(request.headers, localOrigin)) throw new BridgeError(403, 'Invalid local origin or Host');
    if (!request.url || !isLegacyPath(request.url)) throw new BridgeError(404, 'Only ZUKU classic routes are available');
    if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'HEAD') throw new BridgeError(405, 'Method not allowed');
    if (request.method === 'POST' && !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
      throw new BridgeError(415, 'Only URL-encoded legacy forms are supported');
    }
    const contentLength = request.headers['content-length'];
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxRequest)) throw new BridgeError(413, 'Body exceeds bridge limit');
    const now = Date.now();
    for (const [id, session] of sessions) if (now - session.touched >= SESSION_LIFETIME) sessions.delete(id);
    const matches = (request.headers.cookie ?? '').split(';').map(pair => pair.trim()).filter(pair => pair.startsWith(`${COOKIE_NAME}=`));
    const candidate = matches.length === 1 ? matches[0]!.slice(COOKIE_NAME.length + 1) : '';
    let id = /^[a-f0-9]{64}$/.test(candidate) ? candidate : '';
    let session = sessions.get(id);
    let fresh = false;
    if (!session) {
      if (request.method === 'POST') throw new BridgeError(403, 'Open the ZUKU home page before submitting a form');
      if (sessions.size >= maxSessions) throw new BridgeError(503, 'Bridge session limit reached');
      id = randomBytes(32).toString('hex');
      session = { jar: new BridgeCookieJar(upstream.hostname), touched: now };
      sessions.set(id, session);
      fresh = true;
    }
    session.touched = now;
    const body = await bodyOf(request, maxRequest, timeout);
    if (request.method !== 'POST' && body.length) throw new BridgeError(400, 'GET and HEAD bodies are not supported');
    let remote: UpstreamResponse;
    try { remote = await upstreamRequest(request, body, session); }
    catch { throw new BridgeError(502, 'Verified HTTPS upstream unavailable'); }
    const responseHeaders: Record<string, string> = {
      'cache-control': 'no-store', 'pragma': 'no-cache', 'expires': '0',
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
    };
    for (const name of ['content-type', 'content-language', 'content-security-policy']) {
      const value = remote.headers[name];
      if (typeof value === 'string') responseHeaders[name] = value;
    }
    if (remote.headers.location) {
      const destination = new URL(remote.headers.location, new URL(request.url, upstream));
      const target = destination.pathname + destination.search;
      if (destination.origin !== upstream.origin || destination.username || destination.password || !isLegacyPath(target)) {
        throw new BridgeError(502, 'Upstream redirect leaves the allowed origin or route');
      }
      responseHeaders.location = target + destination.hash;
    }
    session.jar.absorb(remote.headers['set-cookie'] ?? [], request.url.split('?')[0]!);
    if (fresh) responseHeaders['set-cookie'] = `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Strict`;
    responseHeaders['content-length'] = String(remote.body.byteLength);
    response.writeHead(remote.status, responseHeaders);
    response.end(request.method === 'HEAD' ? undefined : remote.body);
  }

  const server = createServer({
    maxHeaderSize: 8192, requestTimeout: timeout, headersTimeout: Math.min(timeout, 10_000),
    connectionsCheckingInterval: 1000,
  }, (request, response) => {
    if (active >= 16) { failure(response, 503, 'Bridge is busy'); return; }
    active += 1;
    void handle(request, response).catch(error => {
      failure(response, error instanceof BridgeError ? error.status : 502,
        error instanceof BridgeError ? error.message : 'Bridge request failed');
    }).finally(() => { active -= 1; });
  });
  server.maxHeadersCount = 64;
  server.maxConnections = 64;
  server.keepAliveTimeout = 1000;
  server.on('connect', (_request, socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  return server;
}

export async function startBridge(options: BridgeOptions): Promise<{ server: Server; url: string }> {
  const port = options.port ?? 8788;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Invalid bridge port');
  const server = createBridgeServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Bridge failed to bind loopback');
  return { server, url: `http://127.0.0.1:${address.port}/` };
}
