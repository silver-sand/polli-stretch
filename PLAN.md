# PolliStretch — Implementation Plan (quest #17998)

**Positioning:** "Read less. Understand more. Explore anything." A StretchText engine that turns
articles into a hierarchical, meaning-preserving reading experience with inline progressive
expansion — powered by the reader's own Pollen via BYOP device auth.

## Architecture (MV3, vanilla TS, no build-dep bloat)

```
polli-stretch/
  manifest.json            MV3: action, background service worker, content script,
                           permissions: activeTab, storage, scripting, alarms
                           host_permissions: https://gen.pollinations.ai/*,
                                            https://enter.pollinations.ai/*
  src/
    types.ts               shared contracts
    lib/
      extract.ts           article detection (candidate scoring: main/article/[itemprop=articleBody],
                           p-density, nav/header/footer/aside exclusion, confidence)
      cache.ts             IndexedDB wrapper (structured results keyed by content hash)
      chunk.ts             paragraph-chunking under maxChars, stable ids p1..pn
      prompt.ts            single-hierarchical prompt + strict JSON schema
      parser.ts            response validation (schema-check, id mapping, fallbacks,
                           kernel<=context<=full length sanity)
      dom.ts               DOM snapshot/restore (cloned nodes + element map, no doc re-serialize),
                           transforms, MutationObserver guard, teardown, idempotency
    api/
      pollinations.ts      fetch wrapper: auth via storage token, AbortController, retries,
                           429/5xx backoff, timeouts, error classification
      device.ts            BYOP device flow: /api/device/code, poll /api/device/token,
                           statuses pending/slow_down/expired/denied/ok, token persistence
    sw/background.ts       service worker: messaging hub, device-flow polling (alarms +
                           immediate loop), token storage, alarms
    content/
      index.ts             entry, message router, activation/deactivation
      ui.ts                subtle inline chevrons, toolbar, toasts (scoped, high z,
                           page-safe CSS with .polli* prefixes)
      themes.ts            light/dark editorial tokens, page-adaptive default
    popup/
      popup.html/.ts/.css  React: state, connect/disconnect, expand/collapse/restore,
                           settings sheet (sliders, model picker, theme, cache clear)
  test/                    vitest: extract, cache, chunk, prompt, parser, dom, device-flow,
                           pollinations client, activation lifecycle
  README.md, PRIVACY.md, STORE_LISTING.md, screenshots checklists
```

**Key decisions**
1. **Single AI call, full hierarchy per chunk** — one request per ~5–8k-char chunk returns
   `[{id, kernel, context}]`; `full` is always the exact original HTML (never generated →
   zero hallucination on restoration, saves Pollen). Per-level calls are slower and 3× cost;
   per-sentence splitting is out of scope (documented limitation).
2. **Extraction-first, conservative transforms** — transform only the detected article body
   (article/main/[itemprop=articleBody]/p-density heuristic); never touch nav/footer/forms/
   editors. Low-confidence pages get a clear notice; user can force-activate.
3. **Restore via cloned snapshots + element map** — original subtrees cloned into
   `chrome.storage.session` before mutation; restore replaces by reference, preserving
   identity for any external references. No full-document re-serialization.
4. **Popup UI in React + Motion** (inertial, accessible, design-quality); content-side UI is
   dependency-free (must survive page CSP; scoped styles; no page-JS interference).
5. **BYOP device flow** per official docs: `POST https://enter.pollinations.ai/api/device/code`
   with `client_id=publishable app key`; poll `.../api/device/token` with `device_code` at the
   returned interval; store `access_token` (JSON, no log); Bearer on
   `https://gen.pollinations.ai/text` (chat-style JSON response).
6. **Cache in IndexedDB** keyed by chunk hash + model; identical re-activation is free
   (zero Pollen); TTL 7 days; manual clear.
7. **Model:** configurable; default to a fast mid-tier text model from
   `gen.pollinations.ai/text/models` (decided at build time after doc read).

## UX
- **Inline:** subtle chevron after expanded paragraphs (kernel state); click expands in place
  (kernel → context → full, one depth per click, with a small breadcrumb affordance showing
  level). Hover-only affordance; keyboard: Enter/Space on focused segment.
- **Toolbar:** floating slim bar (bottom, page-adaptive theme): word-savings, Expand all,
  Collapse all, Restore original, Deactivate. Never overlays text.
- **Popup:** one glance — page state, depth control (slider), expand/collapse/restore,
  account (connect/disconnect, balance if exposed), settings (theme, default depth, model,
  shortcuts), cache.
- **Shortcut:** Alt+Shift+P activates (configurable in Settings via
  `commands`/`actions`-style remap where MV3 allows; document Chrome limitation).
- **Onboarding:** first-run sheet in popup: explain Pollen, BYOP, data sent to Pollinations,
  connect CTA.

## Safety / security
- Token: `chrome.storage.session`-scoped for tokens (survives SW restart, dies on browser
  quit); settings in `local`. No token in URLs/logs. App key is publishable, only in
  device-code request.
- Message validation: every message tagged with a shared magic + type; content script
  ignores unknown senders; no `window.postMessage` bridge to page.
- CSP-safe content styles: no remote imports; scoped class names.
- Unsupported pages: browser internals / WebStore / about: → graceful notice in popup, no
  injection.

## Build / test
- `npm i && npm test` (vitest, mocked fetch + IndexedDB)
- `npm run build` → esbuild bundles (sw, content, popup react); output `dist/`
- Load unpacked: `dist/` in chrome://extensions

## Phasing
P1 scaffold+types+extract/parser/prompt tests → P2 dom transform+restore tests → P3 API
client+device flow tests → P4 SW+content+popup wiring → P5 polish, docs, screenshot
checklist → P6 final build+test+report.
