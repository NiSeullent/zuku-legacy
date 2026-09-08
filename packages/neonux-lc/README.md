# NeonUX-LC

An ES3 runtime and compiled CSS2 presentation adapter for the same NeonUX
semantic tokens used by modern ZUKU. Server-rendered links, forms, headings and
text are the application. The runtime adds small, optional graphics without
replacing content or adding a client-side state, router, authentication stack,
API client, or duplicate business logic.

This is an **IE6-targeted initial implementation**, not a claim that an automated
modern-browser test proves IE6 compatibility. Actual IE6/7/8 virtual-machine
verification, including VML behavior, fonts, input controls and screen readers,
is a release gate. VML is optional and may be disabled by browser policy. The
plain document remains usable when scripts, VML, canvas or styling are absent.

## Consume

Serve `@zuku/neonux-lc/style.css` and `@zuku/neonux-lc/runtime.js` as local static
assets through the existing framework. No CDN, downloaded font, image format,
XHR, `fetch`, JSON parser, modern JavaScript polyfill or browser storage is
required. The runtime has no network access and does not provide cryptography.

```html
<link rel="stylesheet" type="text/css" href="/legacy/assets/neonux-lc.css">
<!-- Real content is delivered in this first response. -->
<div class="lc-panel">
  <div class="lc-panel-header"><h2 class="lc-panel-title">Connection</h2></div>
  <div class="lc-panel-body">
    <div data-lc-surface="status"><p>Connected through the secure bridge.</p></div>
  </div>
</div>
<script type="text/javascript" src="/legacy/assets/neonux-lc.js"></script>
```

`data-lc-*` attributes are optional progressive-enhancement metadata; they are
not valid declared attributes under the strict HTML4 DTD, but are readable with
classic DOM `getAttribute`. For strict HTML4 validation, omit them and call the
surface API against an existing element ID. Do not generate essential state
only into a graphic. A visual status indicator must have equivalent adjacent
text before the script runs; this package deliberately never creates or infers
that status text.

### Markup contract

| Class | Purpose |
| --- | --- |
| `lc-page`, `lc-shell` | Body theme, fluid page wrapper |
| `lc-header`, `lc-brand`, `lc-brand-mark`, `lc-header-meta` | Product header |
| `lc-layout`, `lc-sidebar`, `lc-nav`, `lc-active`, `lc-main` | Navigation and content |
| `lc-eyebrow`, `lc-intro`, `lc-muted`, `lc-small` | Supporting text |
| `lc-panel`, `lc-panel-header`, `lc-panel-title`, `lc-panel-body` | Content sections |
| `lc-card-grid`, `lc-card`, `lc-card-index` | Linked module cards |
| `lc-button`, `lc-button-primary`, `lc-label`, `lc-input` | Native links/form controls |
| `lc-badge`, `lc-badge-accent`, `lc-notice`, `lc-status` | Status text and messages |
| `lc-list`, `lc-data`, `lc-footer`, `lc-skip` | Lists, data tables, footer, visible skip link |

Use real `a`, `button`, `label`, `input` and heading elements. The CSS baseline
uses ordinary block flow and works in narrow viewports without media queries.
Newer browsers receive a sidebar float at 760px; IE6 keeps the stacked layout.
No fixed minimum viewport, layout table, flexbox, CSS grid or CSS custom property
is required. Corners are square; system fonts avoid a font download. The primary
button uses the upstream darker accent for readable white text.

## Runtime contract

```javascript
var support = window.NeonUXLC.detect();
// { dom: true, canvas: true|false, vml: true|false, renderer: 'canvas'|'vml'|'dom' }
var result = window.NeonUXLC.init(document, { mode: 'low-power' });
// { mode: 'low-power', enhanced: 0 }
var graphic = window.NeonUXLC.surface(document.getElementById('status'), 160, 36);
graphic.rect(0, 4, 12, 20, '#e91e63');
graphic.line(20, 16, 150, 16, '#9e9e9e', 1);
graphic.clear();
graphic.destroy();
```

- The script initializes once on window load using `addEventListener` or
  `attachEvent`. Applications can also call `init` explicitly; it is idempotent.
- Set `<body data-lc-mode="text">` or `"low-power"` on the **server response**
  to disable graphics before any canvas allocation or VML stylesheet creation.
  Pass the same preference explicitly to `init`/`surface` if avoiding custom
  attributes. A body preference takes priority over individual calls. Preserve
  this preference in normal server links/forms; no browser storage is required.
- `init` examines at most the first 600 `div` nodes and enhances up to four
  `data-lc-surface="status"` elements. It draws a decorative mark, not telemetry.
- Native canvas is preferred when an actual 2D context can be created. Otherwise
  IE's built-in VML behavior is probed, then plain DOM is retained. VML never
  loads an external `.htc` or other executable resource.
- Each page is limited to four live surfaces, each at most 320 × 160 pixels and
  64 primitives between clears. No animation loop, polling, timers or resize
  observer runs. A VML primitive creates exactly one bounded DOM node.
- Coordinates must be finite integer numbers within the surface; rectangle
  sizes must be positive; line weights are 1–4 pixels. Colors must be six-digit
  hexadecimal strings. Invalid operations return `false`; text is untouched.
- Unsupported/disabled rendering returns a no-op API with `renderer: 'dom'`.
  Graphics are marked `aria-hidden` and contain no focusable controls. Older
  assistive technology need not understand ARIA because the real text remains.
- `destroy()` removes only the graphic, releases its slot and is idempotent.
  Switching an initialized status marker to text/low-power destroys its graphic.

Direct callers are responsible for destroying their surfaces when removing
their containing document nodes. DOM scanning and graphics are bounded; content
pagination and total response limits belong in the shared server adapter.

## Shared token provenance and synchronization

The exact source commit, file paths and theme are in `vendor/source.json`.
Unmodified snapshots of NeonUX Core's token contract and slate theme are stored
with the Apache-2.0 license. `scripts/build.mjs` resolves the base contract plus
slate dark overrides and substitutes only used semantic values into CSS2 and
ES3. Unsupported modern expressions fail the build instead of silently creating
a divergent fallback palette. `dist/token-map.json` records every used value.

```sh
node packages/neonux-lc/scripts/build.mjs
node packages/neonux-lc/scripts/build.mjs --check
# Network operation: refresh the exact public commit through GitHub CLI.
node packages/neonux-lc/scripts/sync-tokens.mjs
```

To follow an upstream change, explicitly update the 40-character commit in
`vendor/source.json`, sync, review the token diff and rerun checks. Shared token
names remain the integration boundary; React components and an independent
design system are not copied. Build/sync scripts run on current Node.js; only
`dist/neonux-lc.js` runs in a classic browser.

## Verification and limits

`tests/neonux-lc.test.mjs` parses the shipped runtime as ECMAScript 3, exercises
canvas/VML/DOM selection, retained accessible text, preference and resource
bounds, unsafe primitive rejection, build reproducibility and the CSS baseline.
VML tests use an API stub; they do **not** execute Microsoft's rendering engine.
Record real-browser/VM evidence separately before announcing compatibility.

Suggested manual matrix: IE6/XP, IE7/XP, IE8/Windows 7, a browser without canvas,
current Firefox/Chromium, 320px viewport, keyboard-only navigation, scripts off,
CSS off, text mode, VML disabled, and a low-memory virtual machine. The initial
release makes no claim about IE for Mac, embedded engines or every classic OS.
