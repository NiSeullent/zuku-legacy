# ZUKU Legacy

Keep one product contract: all domain operations go through the existing ZUKU `/api/v1` backend. Never fork account storage, permissions, moderation, or ranking here. New endpoints need an adapter entry and a behavior test.

Server TypeScript may use modern APIs. `packages/neonux-lc/src/*.js` must parse as ECMAScript 3 and work without canvas, JSON, XHR, DOM query selectors, or JavaScript at all. Keep semantic HTML navigable without the enhancement script. Do not claim actual IE6 verification from modern browser tests.

Unprotected HTTP must remain anonymous and read-only. Do not add client-side cryptography marketed as a TLS substitute, skip certificate verification, accept arbitrary proxy headers as transport authentication, or expose upstream bearer/refresh tokens. Device pairing requires explicit approval in an authenticated modern host. Preserve E2EE: never send plaintext to messaging endpoints.

Run `npm run check` for changes and `npm run test:browser` for UI work. Native IE6/Windows testing is a separate release gate recorded in docs/compatibility.md. Never publish secrets, backend snapshots, or private production configuration.
