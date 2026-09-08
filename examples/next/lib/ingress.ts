import { createHash, timingSafeEqual } from 'node:crypto';

export function canonicalHttpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ZUKU_PUBLIC_ORIGIN must be a bare canonical HTTPS origin.');
  }
  return url.origin;
}

/** Only an authenticated, sanitizing HTTPS ingress can set this proof. */
export function verifyHttpsIngress(request: Request, publicOrigin: string, configuredKey?: string): boolean {
  const canonical = new URL(canonicalHttpsOrigin(publicOrigin));
  if (!configuredKey) return false;
  if (!/^(?:[a-f0-9]{2}){32,128}$/i.test(configuredKey)) {
    throw new Error('ZUKU_HTTPS_PROXY_SECRET must contain 32–128 random bytes as hexadecimal.');
  }
  const supplied = request.headers.get('x-zuku-ingress-key') || '';
  if (!supplied || supplied.length > 256 || request.headers.get('host') !== canonical.host) return false;
  // Fixed-size digests permit a constant-time comparison even for malformed lengths.
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(supplied), digest(configuredKey));
}
