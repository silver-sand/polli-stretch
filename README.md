# PolliStretch

**Read less. Understand more. Explore anything.**

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

A Manifest V3 Chrome extension that brings Ted Nelson's **StretchText** (progressive disclosure) to any webpage. PolliStretch transforms article text into a hierarchical reading experience — **Kernel** (essential meaning) → **Context** (supporting detail) → **Full** (original text) — with inline expansion, powered by your own Pollen via **BYOP** (Bring Your Own Pollen) device authorization.

## Features

- **Hierarchical progressive disclosure** — One AI call per chunk returns `kernel` + `context`; `full` is always the exact original HTML (zero hallucination, 100% faithful restoration).
- **BYOP device authorization** — Reader pays with their own Pollen. Uses Pollinations' RFC 8628-style device flow (`enter.pollinations.ai`). Token stored only in `chrome.storage.session` (cleared on browser quit).
- **Faithful DOM restoration** — Original paragraph subtrees cloned before mutation; restore replaces by reference, preserving node identity. No full-document re-serialization.
- **Inline editorial UX** — Subtle chevrons after expanded paragraphs; click to expand in place (kernel → context → full). Floating toolbar: Expand All / Collapse All / Restore Original / Deactivate.
- **Popup control center** — Depth slider, page actions, account connect/disconnect, settings (theme, model, shortcuts, cache clear).
- **Keyboard shortcut** — `Alt+Shift+P` (default) activates on the current page; `Ctrl+Shift+P` opens the popup.
- **CSP-safe, dependency-free content script** — Scoped `.polli*` styles, no remote imports, survives page CSP.
- **IndexedDB caching** — Keyed by chunk hash + model; identical re-activation is free (zero Pollen). TTL 7 days, manual clear.

## Installation (Load Unpacked)

```bash
cd polli-stretch
npm install
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder

## Architecture

```
polli-stretch/
├── manifest.json                 # MV3: service worker, content script, action popup
├── build.mjs                     # esbuild: SW (ESM), content/popup (IIFE), copies assets
├── vitest.config.ts              # jsdom environment
├── src/
│   ├── types.ts                  # Shared contracts
│   ├── lib/
│   │   ├── extract.ts            # Article detection (candidate scoring, p-density)
│   │   ├── cache.ts              # IndexedDB + in-memory (test) implementations
│   │   ├── chunk.ts              # Paragraph chunking under maxChars (6000 default)
│   │   ├── prompt.ts             # Single hierarchical prompt + strict JSON schema
│   │   ├── parser.ts             # Defensive JSON parsing, fence stripping, fallbacks
│   │   └── dom.ts                # Snapshot/restore, mutation guard, teardown
│   ├── api/
│   │   ├── pollinations.ts       # Fetch wrapper: Bearer token, retry/backoff, timeouts
│   │   └── device.ts             # BYOP device flow: request code, poll for token
│   ├── sw/background.ts          # Service worker: messaging hub, device-flow polling
│   ├── content/
│   │   ├── index.ts              # Entry, message router, activation lifecycle
│   │   ├── ui.ts                 # Inline chevrons, toolbar, toasts (scoped styles)
│   │   └── themes.ts             # Light/dark editorial tokens
│   └── popup/
│       ├── popup.tsx             # React: state, BYOP connect, settings, page actions
│       ├── popup.html            # Mount point
│       └── popup.css             # Scoped styles
└── tests/
    └── lib/                      # vitest: cache, chunk, parser, prompt, dom
```

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| Single AI call per chunk, full hierarchy returned | 3× cheaper than per-level calls; `full` is never generated (restored locally) |
| Article extraction first, conservative transforms | Only transform detected article body; never touch nav/footer/forms |
| DOM restoration via cloned snapshots + element map | Preserves node identity for external references; no doc re-serialization |
| React + Motion popup; vanilla content script | Content script must survive page CSP; popup gets rich UX |
| BYOP device flow (RFC 8628-style) | Reader pays; no developer-funded fallback; token in `session` storage only |
| IndexedDB cache keyed by FNV-1a hash of (model + paragraphs) | Identical re-activation = zero Pollen; TTL 7 days |

## Commands

```bash
npm install         # Install dependencies
npm test            # Run vitest suite (92 tests)
npm run typecheck   # TypeScript check (noEmit)
npm run build       # Build to dist/ (esbuild)
```

## Testing

- **Environment:** vitest + jsdom
- **Coverage:** 99 tests across `cache`, `chunk`, `parser`, `prompt`, `dom`, `pollinations`, and `generation-response`
- **Mocks:** `fetch`, `IndexedDB`, `chrome.*` APIs, `MutationObserver`

## Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Activate on current tab only |
| `storage` | Settings (local), tokens (session) |
| `scripting` | Inject content script programmatically |
| `tabs` | Query tab for popup state |
| `alarms` | Device-flow polling in SW |
| `host_permissions: https://gen.pollinations.ai/*` | AI generation calls |
| `host_permissions: https://enter.pollinations.ai/*` | Device authorization flow |

## Privacy

See [PRIVACY.md](PRIVACY.md) — no telemetry, no analytics, tokens never logged, BYOP means your Pollen pays.

## Store Listing

See [STORE_LISTING.md](STORE_LISTING.md) for Chrome Web Store submission assets.

## Quest

Built for **Pollinations Quest #17998**.

## License

MIT