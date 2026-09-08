# ZUKU Legacy local companion

This optional Node.js 22+ process lets a browser without current TLS support use
ZUKU's normal public paths through a **same-device** loopback connection. Classic
rendering is selected automatically; users do not need a separate `/legacy` entry.
The process connects to one provisioned HTTPS origin with certificate and hostname
verification and TLS 1.2 or newer. It has no plaintext upstream or insecure TLS mode.

```text
IE / low-power browser       Local companion          Existing ZUKU services
http://127.0.0.1:8788/     → verified HTTPS /        → existing APIs and identity
     same device only       TLS 1.2+ + HMAC proof
```

Build at repository root with `npm install && npm run build`, then run:

```sh
export ZUKU_LEGACY_UPSTREAM=https://your-legacy-origin.example
# Provision the SAME secret to the legacy server and this trusted companion.
# Generate once: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
export ZUKU_BRIDGE_KEY=YOUR_64_HEX_CHARACTER_SECRET
npm run bridge
```

Visit the exact printed `http://127.0.0.1:8788/` address. `localhost`, alternate
Host names, remote interfaces and cross-origin browser requests are rejected.
`ZUKU_BRIDGE_PORT` optionally changes the port. A private deployment CA can be
provisioned using Node's `NODE_EXTRA_CA_CERTS` before process startup; never disable
certificate verification. Secrets must be distributed through an already trusted
channel, never an HTTP page or query parameter. Do not commit real secrets.

The local cookie is a random HttpOnly handle to a memory-only upstream cookie jar.
It uses `Path=/` to serve the canonical public paths. Remote session cookies and
tokens stay in the process. Only GET, HEAD and URL-encoded POST requests on the
shared public-route allowlist or internal `/legacy` routes are forwarded. The
companion rejects off-origin or non-allowlisted redirects, untrusted forwarded headers, encoded path
traversal and bodies over 64 KiB; responses are capped at 2 MiB. Sixteen in-flight
requests, 128 idle-expiring browser sessions and request deadlines bound resources.
This deliberately supports form actions and bounded pages; large uploads and
streaming APIs must use a separate supported client.

The legacy server must verify a one-use `HMAC-SHA256` proof before trusting bridge
transport. `signBridgeRequest` and `verifyBridgeRequest` bind the method, exact raw
path and query, SHA-256 body hash, timestamp and random nonce. The validity window
is 60 seconds in either direction; clocks must be synchronized. `BridgeReplayCache`
rejects reuse and fails closed at capacity. A multi-process server needs a shared
atomic nonce store or one designated bridge-verification process; separate memory
caches would allow replay between instances. Neither proof headers nor
`X-Forwarded-Proto` are an encryption mechanism.

Browsers without Origin/SameSite support are supported by the application's CSRF
tokens: **every state-changing upstream form must verify its session-bound CSRF
token**, including when a bridge proof is valid. The companion strips local Origin
and Referer upstream after checking them; the server can use the verified proof
for transport/origin classification, but must still validate the form token.
Authenticated HTML uses relative public URLs for navigation (`/`, `/community`,
`/login`, `/profile`, product and content paths). Assets, form actions and approval
APIs remain on internal `/legacy` paths. This is an application endpoint, not a
generic content-rewriting proxy. Explicit `/legacy` URLs remain for debugging.

Opening the companion explicitly selects the classic renderer, including on a
modern browser on a low-power device. The companion sends a fixed classic UA for
this purpose; direct requests to the modern site remain untouched. UA selection
does not authenticate the caller: the server independently verifies the signed
transport proof and the form CSRF token.
Responses that vary by browser must preserve `Vary: User-Agent` at the host/cache.

The shared pure routing helpers are exported from `@zuku/legacy-bridge/routing`
and re-exported by `@zuku/legacy-core/routing`: `isClassicUserAgent`,
`publicToLegacyPath` and `legacyToPublicPath`. The proxy and companion use the same
path map rather than maintaining separate public URL contracts.

## Support boundary

**This is not TLS implemented in JavaScript, and ordinary network HTTP is not
protected.** An HTTP-delivered script cannot establish a trustworthy bootstrap
against an active attacker who can replace that script. Direct HTTP remains guest
only. The bridge secret authenticates a trusted companion; TLS supplies network
confidentiality, integrity and server authentication.

Node.js 22 does **not** run on Windows XP or original IE6-era operating systems.
This implementation is usable where a maintained native runtime can run on the
same device as the legacy browser (for example a supported OS using a classic
browser for compatibility testing). It is not an XP-native companion and has not
been certified in an original IE6/XP environment. An XP deployment needs an
independently maintained native companion or an already secured last hop; putting
this bridge on a LAN device and using LAN HTTP does not satisfy this design.

Loopback does not protect against malware, another privileged local process, old
browser vulnerabilities, shared-user browser profiles, or a service already
controlling local cookies. Treat the browser/OS and companion host as trusted.
Restarting the companion clears all remote sessions. A fleet requires per-device
secret provisioning, rotation and revocation before production deployment.

Implementation references: [Node HTTPS](https://nodejs.org/api/https.html),
[Node TLS verification](https://nodejs.org/api/tls.html),
[Node crypto HMAC and constant-time comparison](https://nodejs.org/api/crypto.html).
