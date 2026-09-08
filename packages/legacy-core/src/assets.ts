import { createHash } from 'node:crypto';
import { CLASSIC_CSS, CLASSIC_JS } from '@zuku/neonux-lc/server-assets';

/** Compute once on the server; classic browsers only receive the resulting URL. */
export function assetRevision(css: string, js: string): string {
  return createHash('sha256').update(css).update('\0').update(js).digest('hex');
}

// These are the same generated values served by the core asset handler.
export const CLASSIC_ASSET_REVISION = assetRevision(CLASSIC_CSS, CLASSIC_JS);
