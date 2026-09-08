import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Next can invoke Proxy again after an internal rewrite. This process-local key
// distinguishes that second pass from browser-supplied routing headers. It is
// never an account credential; core transport/auth checks remain independent.
const shared = globalThis as typeof globalThis & { zukuLegacyRoutingKey?: Buffer };
function key(): Buffer { return shared.zukuLegacyRoutingKey ||= randomBytes(32); }
function mac(method: string, original: string, target: string, ua: string, timestamp: string): Buffer {
  return createHmac('sha256', key()).update(JSON.stringify([method, original, target, ua, timestamp])).digest();
}

export function signRewrite(method: string, original: string, target: string, ua: string, now = Date.now()): string {
  const timestamp = String(now);
  return timestamp + '.' + mac(method, original, target, ua, timestamp).toString('hex');
}

export function verifyRewrite(proof: string, method: string, original: string, target: string, ua: string, now = Date.now()): boolean {
  const parts = /^([0-9]{13})\.([a-f0-9]{64})$/.exec(proof);
  if (!parts || Number(parts[1]) > now + 1000 || now - Number(parts[1]) > 10_000) return false;
  return timingSafeEqual(Buffer.from(parts[2]!, 'hex'), mac(method, original, target, ua, parts[1]!));
}
