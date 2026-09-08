#!/usr/bin/env node
import { startBridge } from './server.js';

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required');
  const upstreamOrigin = process.env.ZUKU_LEGACY_UPSTREAM;
  const key = process.env.ZUKU_BRIDGE_KEY;
  if (!upstreamOrigin || !key) throw new Error('Set ZUKU_LEGACY_UPSTREAM=https://your-origin and ZUKU_BRIDGE_KEY to an out-of-band provisioned hex secret');
  const port = Number(process.env.ZUKU_BRIDGE_PORT ?? '8788');
  const { server, url } = await startBridge({ upstreamOrigin, key, port });
  console.log(`ZUKU Legacy companion: ${url}`);
  console.log('Same-device loopback only. The upstream connection uses verified TLS 1.2+.');
  const close = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Bridge startup failed');
  process.exitCode = 1;
}
