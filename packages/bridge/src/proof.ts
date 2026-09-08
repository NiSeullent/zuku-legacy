import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type BridgeKey = string | Uint8Array;
type HeaderBag = Headers | Record<string, string | string[] | undefined>;
export interface BridgeProofRequest { method: string; url: string; headers: HeaderBag }
export interface BridgeSignOptions {
  method: string;
  path: string;
  body: string | Uint8Array;
  /** A hex-encoded secret (at least 32 random bytes), provisioned out of band. */
  key: BridgeKey;
  /** Epoch milliseconds. */
  now?: number;
  nonce?: string;
}

const WINDOW_SECONDS = 60;

export function bridgeKeyBytes(key: BridgeKey): Buffer {
  if (typeof key === 'string') {
    if (!/^(?:[a-fA-F0-9]{2}){32,}$/.test(key) || key.length > 1024) {
      throw new Error('ZUKU_BRIDGE_KEY must contain 32–512 random bytes encoded as hex');
    }
    return Buffer.from(key, 'hex');
  }
  if (key.byteLength < 32 || key.byteLength > 512) throw new Error('Bridge key must be 32–512 bytes');
  return Buffer.from(key);
}

/** Never evicts a still-valid nonce to make room: saturation fails closed. */
export class BridgeReplayCache {
  private readonly entries = new Map<string, number>();
  constructor(readonly capacity = 10_000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid replay capacity');
  }
  consume(nonce: string, expiresAt: number, now = Date.now()): boolean {
    for (const [id, expiration] of this.entries) if (expiration <= now) this.entries.delete(id);
    if (this.entries.has(nonce) || this.entries.size >= this.capacity || expiresAt <= now) return false;
    this.entries.set(nonce, expiresAt);
    return true;
  }
  get size(): number { return this.entries.size; }
}

function header(headers: HeaderBag, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  return matches.length === 1 && typeof matches[0]![1] === 'string' ? matches[0]![1] : undefined;
}

function validTarget(method: string, path: string): boolean {
  return /^[A-Z]{1,16}$/.test(method) && path.length <= 4096 && path.startsWith('/') &&
    !path.startsWith('//') && !/[\u0000-\u0020\u007f#\\]/.test(path);
}

function digest(method: string, path: string, body: string | Uint8Array, timestamp: string, nonce: string, key: Buffer): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', key)
    .update(['ZUKU-LEGACY-BRIDGE-1', method, path, bodyHash, timestamp, nonce].join('\n'))
    .digest('hex');
}

export function signBridgeRequest(options: BridgeSignOptions): Record<string, string> {
  const { method, path, body } = options;
  if (!validTarget(method, path)) throw new Error('Invalid bridge request target');
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now) || now < 0) throw new Error('Invalid bridge timestamp');
  const timestamp = String(Math.floor(now / 1000));
  const nonce = options.nonce ?? randomBytes(24).toString('hex');
  if (!/^[a-f0-9]{32,128}$/.test(nonce)) throw new Error('Invalid bridge nonce');
  return {
    'x-zuku-bridge-timestamp': timestamp,
    'x-zuku-bridge-nonce': nonce,
    'x-zuku-bridge-signature': digest(method, path, body, timestamp, nonce, bridgeKeyBytes(options.key)),
  };
}

/** Authenticate before trusting any bridge transport assertion. A proof is one-use. */
export function verifyBridgeRequest(
  request: BridgeProofRequest,
  body: string | Uint8Array,
  key: BridgeKey,
  replayCache: BridgeReplayCache,
  now = Date.now(),
): boolean {
  try {
    if (!validTarget(request.method, request.url) || !Number.isFinite(now)) return false;
    const timestamp = header(request.headers, 'x-zuku-bridge-timestamp');
    const nonce = header(request.headers, 'x-zuku-bridge-nonce');
    const signature = header(request.headers, 'x-zuku-bridge-signature');
    if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !nonce || !/^[a-f0-9]{32,128}$/.test(nonce) ||
      !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
    const seconds = Number(timestamp);
    if (Math.abs(Math.floor(now / 1000) - seconds) > WINDOW_SECONDS) return false;
    const expected = digest(request.method, request.url, body, timestamp, nonce, bridgeKeyBytes(key));
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return false;
    return replayCache.consume(nonce, (seconds + WINDOW_SECONDS + 1) * 1000, now);
  } catch {
    return false;
  }
}
