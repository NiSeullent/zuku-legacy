# Next.js host adapter

This runnable Next.js 16 example automatically serves the classic ZUKU client
at normal public URLs when it positively identifies an old browser. Its proxy
internally selects `@zuku/legacy-core` under `/legacy`; the visible URL stays
`/`, `/hype`, `/community`, `/content/id`, or another supported public route.
Modern and unknown browsers keep the existing modern route. A separate
**modern-browser-only** device approval page lives at `/legacy/approve`.
The classic route returns the core's plain HTML response;
Next layouts, React hydration and the modern approval stylesheet do not wrap it.
The approval page is deliberately disconnected from authentication until the
existing host's login is integrated.

## Run

From the repository root, with Node.js 22.13 or newer:

```sh
npm install
npm run build
npm install --prefix examples/next
cp examples/next/.env.example examples/next/.env.local
npm run dev --prefix examples/next
```

Open `http://127.0.0.1:3000/` in the target browser. IE6 automatically receives
the classic client; a modern browser receives the example host's modern home.
`/legacy` remains an internal/debug mount and is not the user entrypoint.
Configure `ZUKU_API_ORIGIN` to a reachable
ZUKU API first; the default is the local development API at port 30012. Without
it, upstream failures are displayed rather than replaced with mock content.
Plain HTTP is public/read-only. The approval page displays a setup message and
a disabled confirmation button; it never asks for a password or a pasted token.

Production build and validation:

```sh
npm run build --prefix examples/next
npm run typecheck --prefix examples/next
npm test --prefix examples/next
npm run smoke --prefix examples/next
npm start --prefix examples/next
```

The example pins Next 16.3.4 and React 19.2.8 and uses the default Next bundler.
The existing modern host's build pipeline does not need a bundler change.
NeonUX-LC generates a server asset module from the same CSS/ES3 output, so the
core can deliver those assets through ordinary module imports without runtime
filesystem resolution or a second asset source. The modern host can be updated
independently of the classic browser output.
Deploy the three local packages with their generated `dist` directories; build
the repository packages before building or starting this example.

## Integrate into the existing ZUKU host

1. Add the three package dependencies shown in `package.json`, preserving the
   existing host's Next/React versions, package manager and build pipeline.
2. Copy `app/legacy/[[...path]]/route.ts`, `lib/legacy-server.ts` and
   `lib/ingress.ts` into corresponding host locations. All Legacy endpoints use
   this one handler and one shared application instance.
   Merge the logic in `proxy.ts` into the existing host proxy before product
   rewrites; Next supports one proxy file. Do not replace the host's existing
   modern routing logic. Continue that logic when this step does not rewrite.
   Copy `lib/rewrite-proof.ts` with it.
   Install `integration/cache-headers.mjs` at the existing outer server/ingress
   response hook; apply `browserVary(pathname, response.headers.get('Vary'))`
   after Next produces the response. This preserves the modern body and cache
   policy while separating browser representations.
3. Copy `components/DeviceApproval.tsx` and `lib/device-approval.ts`. The
   reusable client component accepts `approve(code)`; it never owns a login
   store. Copy and adapt `integration/ZukuApproval.tsx.example` to the host's
   component directory and use `integration/approve-page.tsx.example` for its
   modern approval page. Adjust relative imports to their final locations.
4. The ZUKU template imports `hydrateAuthStore` and `getAccessToken` from
   `@/lib/auth`. These are a host integration seam, not an implementation copied
   into this public repository. If the host uses `authFetch` or a different
   token accessor, supply an equivalent `approve` callback. A host API wrapper
   must target this exact same-origin `/legacy/authorize` route, must not rewrite
   it to the upstream API, and must reject redirects before sending credentials.
5. Add `'/legacy'` to the host router's `SHARED_PATH_PREFIXES`. This preserves
   the internal route, its assets and the static `/legacy/approve` page before
   product-specific routing/rewrite rules. Keep `/legacy/approve` on the same
   modern HTTPS origin as `/legacy/authorize`.
6. Merge the approval styles into existing NeonUX components or use the modern
   example stylesheet. Do not add the example root layout to the existing host.
   Keep its existing login UI and host security headers, including frame and
   referrer protections on the approval page.

`DeviceApproval` shows the normalized code and requires an explicit click.
Only then does `tokenApproval` read the existing authenticated session and issue
`POST /legacy/authorize` with `Authorization: Bearer …` and JSON `{code}`.
The token is never placed in a URL, input field, browser storage, logs or the
rendered page. Browser-controlled `Origin` and the core's exact-origin check
protect the approval route. Redirects fail rather than forwarding credentials.
HTML error responses are mapped to safe messages, never inserted into the DOM.

The existing modern login handles missing or expired sessions. This package
does not introduce a second auth flow or refresh-token store. The standalone
page does not include an `approve` callback; integrating the provided host
template is necessary for device connection to work.

## Automatic browser selection and shared URLs

`@zuku/legacy-core/routing` re-exports the pure route contract shared with the
bridge. Its source lives in `packages/bridge/src/routing.ts`; adapters do not
maintain separate URL maps. `publicToLegacyPath` returns an internal route suffix
or `null`; `legacyToPublicPath` generates canonical visible links. For example,
`/community/post_1` internally maps to `/legacy/thread/post_1`, while links and
the address bar continue to use `/community/post_1`. Korean profile handles are
decoded once for validation and retain their original encoded path segment.

Positive browser detection covers Internet Explorer (MSIE and Trident),
Chrome/Chromium/Edge below 111, Firefox below 111, and Safari below 16.4. Those
floors follow the Next 16 bundled installation documentation. IE6 remains the
classic runtime's primary compatibility target; old browsers receive the same
server HTML and ES3 asset rather than separate browser-specific applications.
An absent, unfamiliar or supported browser UA never triggers a rewrite. UA
detection selects a representation only; it cannot authorize account access.

The allowlist includes `/`, product roots, `/community`, `/search`, `/login`,
`/settings`, `/profile`, `/bookmarks`, `/messages`, `/compatibility`, and bounded
content/community/profile detail paths. Classic `/login` selects the existing
device connection flow. API routes, assets, admin routes, auth callbacks,
registration, modern approval, and unsupported product/editor routes remain
under host control. Modern `/login` and every modern page are untouched.

The proxy strips a browser-supplied `x-zuku-lc-original-path`. On a classic
rewrite it replaces the header with the exact original pathname and query.
Next may invoke the proxy again for the rewritten path. A ten-second HMAC marker
created with an in-memory server key distinguishes that second pass from forged
browser headers; it is bound to method, original/target paths and queries, and
user agent. The marker is removed before handing the request to the core. It
authenticates only the routing claim and never grants account permissions.
The core validates that they map to the internal route and verifies any bridge
proof against that original target. The browser sees an internal rewrite,
never a redirect to `/legacy`. Classic links continue at normal public URLs;
implementation-only assets and form action endpoints retain the internal mount.
Both selected representations vary by `User-Agent`; classic responses also use
`private, no-store`. Keep this behavior in any external cache to prevent mixing
the classic and modern representations.

**Next 16.3.4 cached App Router pages overwrite custom `Vary` supplied by both
Proxy and `next.config.headers`.** The proxy/config hooks are useful for classic
and uncached responses, but are insufficient for static modern pages. Apply
the provided shared-route-aware `browserVary` helper to the final response at
the existing Node/Bun ingress, or append `User-Agent` in the equivalent external
reverse-proxy response hook for these public routes. Keep any existing Next
`Vary` fields. This is required before enabling a shared cache for automatic
selection. Do not disable or rebuild the modern renderer to work around it.

A concrete Node/Bun fetch-handler hook is provided in
`integration/response-hook.mjs`; wrap the existing handler's final result:

```javascript
import { applyBrowserVariation } from './integration/response-hook.mjs';

async function fetch(request) {
  const response = await existingModernHandler(request);
  return applyBrowserVariation(new URL(request.url).pathname, response);
}
```

The helper preserves the streamed body, status, cookies, cache policy, and
upgrade/empty-return flows; it only adds the missing `Vary` field on shared
public routes. Install it at the existing outer host or equivalent reverse
proxy, after Next's response handling. The runnable `npm run smoke` example
demonstrates the same final-header policy on a loopback HTTP ingress.

Before enabling automatic rewrites in production, invalidate previously cached
HTML for affected public URLs, or bypass shared HTML caching until those entries
expire. Existing modern responses cached without `Vary: User-Agent` can otherwise
bypass selection entirely. Install the final response hook before enabling the
rewrite and ensure any cache in front of it includes the selected representation
in its key. This requirement concerns shared HTML caching; asset delivery and
the modern client renderer remain unchanged.

## HTTPS ingress trust

Next Route Handlers do not expose a trustworthy accepted-socket TLS flag. This
adapter therefore passes `secureTransport: false` unless **both** are true:

- The request `Host` exactly matches `ZUKU_PUBLIC_ORIGIN`, which must be
  a bare HTTPS origin and must match `ZUKU_MODERN_ORIGIN`.
- `x-zuku-ingress-key` matches a configured `ZUKU_HTTPS_PROXY_SECRET` using a
  constant-time comparison of fixed-size SHA-256 digests. The key must represent
  at least 32 randomly generated bytes in hexadecimal.

`X-Forwarded-Proto`, a request URL containing `https`, and browser-supplied
headers alone do not grant authenticated access. The optional signed local
bridge is verified independently by the core, even when HTTPS ingress proof
is disabled. Never expose the ingress key to client code or `NEXT_PUBLIC_*`.

The trusted ingress must terminate and verify HTTPS, overwrite any incoming
`x-zuku-ingress-key`, set the canonical Host, and forward only to the loopback
Next server. Its HTTP listener must redirect to HTTPS without injecting the
proof header. A Caddy deployment shape is:

```caddyfile
zuku.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up Host zuku.example.com
        header_up X-Zuku-Ingress-Key {env.ZUKU_HTTPS_PROXY_SECRET}
    }
}
```

Configure the same random ingress key in the proxy and server environment.
Keep the application port private. A trusted ingress must sanitize the header
even if the application port is private; do not merely append a second value.
No key configured means the adapter stays read-only except for independently
authenticated bridge requests. Direct development HTTPS does not automatically
enable account access; the proof-bearing ingress is the explicit trust boundary.

## Shared state and deployment limits

The `globalThis` singleton keeps connection codes, sessions and replay tracking
together in **one Node process**, including development module reloads. It does
not synchronize Next workers, serverless functions or separate hosts. For more
than one process, provide a shared `LegacyState` implementation with expiry,
capacity bounds and atomic `takePair`, and enforce ingress rate limiting and
shared replay protection (or route all Legacy requests to one process). The
core's in-memory replay cache and rate limiter are also process-local. Do not
claim that a shared session store alone makes bridge replay protection global.

The example intentionally does not trust `X-Forwarded-For`; without an
adapter-derived address, the core conservatively shares its unauthenticated
rate-limit bucket. Configure per-client ingress rate limiting for deployment.
Restarting the single process invalidates its pending codes and sessions.

## Verification scope

Tests exercise ingress forgery/missing-proof rejection, HTTPS origin validation,
explicit approval dispatch, exact same-origin transport, and safe handling of
HTML errors and invalid JSON. Build/type checking verifies the concrete Next
route/page arrangement. The production smoke check starts an isolated local
Next server behind a loopback ingress using the final Vary helper, verifies
real CSS/JS reads, canonical IE6 URLs, signed public-path GET/POST requests,
and the HTML4/modern split. It compares the modern body and caching policy with
direct Next output and checks the final `Vary`, then stops both servers. This
does not claim that native Next static responses preserve custom Vary unaided.
The `.example` templates require host integration and
are intentionally excluded from standalone type checking. None of these tests
claim that Microsoft IE6 can execute the modern approval page; approval happens
on an already-authenticated modern device.
