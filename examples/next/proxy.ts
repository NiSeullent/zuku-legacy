import { NextResponse, type NextRequest } from 'next/server';
import { isClassicUserAgent, publicToLegacyPath } from '@zuku/legacy-core/routing';
import { signRewrite, verifyRewrite } from './lib/rewrite-proof';

/** Merge this step before host/product rewrites in an existing Next proxy. */
export function proxy(request: NextRequest) {
  // A browser cannot assert the original path of an internal rewrite.
  const headers = new Headers(request.headers);
  const original = headers.get('x-zuku-lc-original-path') || '';
  const proof = headers.get('x-zuku-lc-rewrite-proof') || '';
  const ua = headers.get('user-agent') || '';
  headers.delete('x-zuku-lc-original-path');
  headers.delete('x-zuku-lc-rewrite-proof');
  if ((request.nextUrl.pathname === '/legacy' || request.nextUrl.pathname.startsWith('/legacy/')) && original &&
      verifyRewrite(proof, request.method, original, request.nextUrl.pathname + request.nextUrl.search, ua)) {
    // Preserve only a routing claim created by this proxy on the first pass.
    // Core independently validates the public/internal path and query mapping.
    headers.set('x-zuku-lc-original-path', original);
    return NextResponse.next({ request: { headers } });
  }
  const suffix = publicToLegacyPath(request.nextUrl.pathname);
  if (suffix !== null && isClassicUserAgent(ua) && ['GET', 'HEAD', 'POST'].includes(request.method)) {
    const originalPath = request.nextUrl.pathname + request.nextUrl.search;
    headers.set('x-zuku-lc-original-path', originalPath);
    const target = request.nextUrl.clone();
    target.pathname = '/legacy' + suffix;
    headers.set('x-zuku-lc-rewrite-proof', signRewrite(request.method, originalPath, target.pathname + target.search, ua));
    const response = NextResponse.rewrite(target, { request: { headers } });
    response.headers.set('Vary', 'User-Agent');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  // Preserve the modern renderer and route. Strip only our reserved header.
  const response = NextResponse.next({ request: { headers } });
  // Public routes vary even when the selected representation is the modern one.
  if (suffix !== null) response.headers.set('Vary', 'User-Agent');
  return response;
}

export const config = { matcher: '/:path*' };
