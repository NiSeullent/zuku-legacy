import 'server-only';
import { createLegacyApp } from '@zuku/legacy-core';
import { canonicalHttpsOrigin, verifyHttpsIngress } from './ingress';

type Instance = { app: ReturnType<typeof createLegacyApp>; publicOrigin: string; ingressKey?: string };
const shared = globalThis as typeof globalThis & { zukuLegacyNextExample?: Instance };

function instance(): Instance {
  if (!shared.zukuLegacyNextExample) {
    const publicOrigin = canonicalHttpsOrigin(process.env.ZUKU_PUBLIC_ORIGIN || 'https://localhost:3000');
    const modernOrigin = canonicalHttpsOrigin(process.env.ZUKU_MODERN_ORIGIN || publicOrigin);
    if (modernOrigin !== publicOrigin) throw new Error('Mount the approval page on the same modern HTTPS origin as /legacy.');
    shared.zukuLegacyNextExample = {
      app: createLegacyApp({
        apiOrigin: process.env.ZUKU_API_ORIGIN || 'http://127.0.0.1:30012',
        publicOrigin,
        modernOrigin,
        bridgeKey: process.env.ZUKU_BRIDGE_KEY || undefined,
        // Keep one worker. Scaling requires shared LegacyState AND replay/nonce
        // storage and ingress rate limiting; a shared session store alone is insufficient.
      }),
      publicOrigin,
      ingressKey: process.env.ZUKU_HTTPS_PROXY_SECRET || undefined,
    };
  }
  return shared.zukuLegacyNextExample;
}

export async function handleLegacy(request: Request): Promise<Response> {
  try {
    const { app, publicOrigin, ingressKey } = instance();
    return await app.handle(request, {
      secureTransport: verifyHttpsIngress(request, publicOrigin, ingressKey),
      // Do not copy X-Forwarded-For here. Apply per-client rate limits at ingress.
    });
  } catch {
    // Configuration errors contain no public diagnostics or secret values.
    return new Response('Legacy adapter configuration is unavailable.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
