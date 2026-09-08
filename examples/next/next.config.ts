import type { NextConfig } from 'next';
import { PUBLIC_ROUTE_PAIRS } from '@zuku/legacy-core/routing';

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [...PUBLIC_ROUTE_PAIRS.map(([source]) => ({ source, headers: [{ key: 'Vary', value: 'User-Agent' }] })),
      ...['/content/:id', '/community/:id', '/profile/:handle'].map((source) => ({ source, headers: [{ key: 'Vary', value: 'User-Agent' }] })), {
      source: '/legacy/approve',
      headers: [
        { key: 'Cache-Control', value: 'no-store, private' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ],
    }];
  },
};

export default config;
