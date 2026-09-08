import { publicToLegacyPath } from '@zuku/legacy-core/routing';

/** Apply at the outer ingress AFTER Next has produced its final response headers.
 * Next's cached App Router pages can replace Vary from Proxy/config headers.
 * This preserves modern response bodies and caching policy, adding only the
 * representation key required by automatic classic-browser selection.
 * @param {string} pathname
 * @param {string|string[]|undefined} [existing]
 * @returns {string}
 */
export function browserVary(pathname, existing = '') {
  const value = Array.isArray(existing) ? existing.join(', ') : String(existing || '');
  if (publicToLegacyPath(pathname) === null || value.trim() === '*') return value;
  const fields = value.split(',').map((field) => field.trim()).filter(Boolean);
  if (!fields.some((field) => field.toLowerCase() === 'user-agent')) fields.push('User-Agent');
  return fields.join(', ');
}
