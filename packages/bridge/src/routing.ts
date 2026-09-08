/** Shared URL contract: both automatic routing and the companion use this map. */
export const PUBLIC_ROUTE_PAIRS: ReadonlyArray<readonly [publicPath: string, legacySuffix: string]> = [
  ['/', ''],
  ['/hype', '/hype'],
  ['/swipe', '/swipe'],
  ['/jump', '/jump'],
  ['/vive', '/vive'],
  ['/vine', '/vine'],
  ['/community', '/thread'],
  ['/search', '/search'],
  ['/login', '/connect'],
  ['/settings', '/settings'],
  ['/profile', '/account'],
  ['/bookmarks', '/bookmarks'],
  ['/messages', '/messages'],
  ['/compatibility', '/compatibility'],
];

/** Positive evidence only; unknown and supported browsers keep their host UI.
 * Floors follow Next.js 16 bundled installation docs: Chromium/Edge/Firefox111,
 * Safari16.4. Internet Explorer never meets the modern host's browser baseline.
 */
export function isClassicUserAgent(value: string | null | undefined): boolean {
  if (!value || value.length > 2048) return false;
  const msie = /\bMSIE\s+(\d+)(?:\.\d+)?\b/i.exec(value);
  if (msie) return Number(msie[1]) >= 1;
  const trident = /\bTrident\/(\d+)(?:\.\d+)?\b/i.exec(value);
  if (trident) return Number(trident[1]) >= 1;
  const edge = /\b(?:Edg|Edge|EdgA)\/(\d+)\./i.exec(value);
  if (edge) return Number(edge[1]) >= 1 && Number(edge[1]) < 111;
  const chromium = /\b(?:Chrome|Chromium)\/(\d+)\./i.exec(value);
  if (chromium) return Number(chromium[1]) >= 1 && Number(chromium[1]) < 111;
  const firefox = /\bFirefox\/(\d+)\./i.exec(value);
  if (firefox) return Number(firefox[1]) >= 1 && Number(firefox[1]) < 111;
  const safari = /\bSafari\//i.test(value) ? /\bVersion\/(\d+)\.(\d+)/i.exec(value) : null;
  return !!safari && Number(safari[1]) >= 1 && (Number(safari[1]) < 16 || Number(safari[1]) === 16 && Number(safari[2]) < 4);
}

function normalizedPath(pathname: string): string | null {
  if (!pathname.startsWith('/') || pathname.length > 2048 || /[\\?#\x00-\x20\x7f]/.test(pathname) || pathname.includes('//')) return null;
  // Accept one harmless trailing slash while refusing encoded separators/dot paths.
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return path;
}

function identifier(value: string): boolean {
  // This matches the core's bounded URL identifier contract. No paths or extensions.
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function profileIdentifier(value: string): boolean {
  let handle: string;
  try { handle = decodeURIComponent(value); } catch { return false; }
  return handle !== '.' && handle !== '..' && /^[\p{L}\p{M}\p{N}_.-]{1,80}$/u.test(handle);
}

/** Return an internal /legacy suffix, or null when this URL belongs to the host. */
export function publicToLegacyPath(pathname: string): string | null {
  const path = normalizedPath(pathname);
  if (path === null) return null;
  for (const [publicPath, suffix] of PUBLIC_ROUTE_PAIRS) if (path === publicPath) return suffix;
  const details: ReadonlyArray<readonly [string, string]> = [
    ['/content/', '/content/'],
    ['/community/', '/thread/'],
    ['/profile/', '/profile/'],
  ];
  // Community search is a host feature outside this bounded detail mapping.
  if (path === '/community/search') return null;
  for (const [prefix, suffix] of details) {
    const segment = path.slice(prefix.length);
    if (path.startsWith(prefix) && (prefix === '/profile/' ? profileIdentifier(segment) : identifier(segment))) return suffix + segment;
  }
  return null;
}

/** Canonical public navigation; internal forms/assets remain under /legacy. */
export function legacyToPublicPath(suffix: string): string {
  if (suffix === '/') return '/';
  for (const [publicPath, legacySuffix] of PUBLIC_ROUTE_PAIRS) if (suffix === legacySuffix) return publicPath;
  const details: ReadonlyArray<readonly [string, string]> = [
    ['/content/', '/content/'],
    ['/thread/', '/community/'],
    ['/profile/', '/profile/'],
  ];
  for (const [prefix, publicPrefix] of details) {
    const segment = suffix.slice(prefix.length);
    if (suffix.startsWith(prefix) && (prefix === '/profile/' ? profileIdentifier(segment) : identifier(segment))) return publicPrefix + segment;
  }
  return '/legacy' + (suffix.startsWith('/') ? suffix : '/' + suffix);
}
