import { browserVary } from './cache-headers.mjs';

/** Wrap the existing Node/Bun fetch handler's final response, after Next.
 * @param {string} pathname
 * @param {Response|null|undefined} response
 * @returns {Response|null|undefined}
 */
export function applyBrowserVariation(pathname, response) {
  // Preserve upgrades/host-specific empty returns without replacing their flow.
  if (!response || response.status === 101) return response;
  const current = response.headers.get('Vary') || '';
  const vary = browserVary(pathname, current);
  if (current === vary) return response;
  const headers = new Headers(response.headers);
  headers.set('Vary', vary);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
