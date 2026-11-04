# PolliStretch — Chrome Web Store Listing

**Quest:** #17998  
**Version:** 0.1.0  
**Manifest:** V3  
**Package:** `dist/` (load unpacked) or zipped for CWS upload

---

## Store Metadata

### Name
**PolliStretch** (30 char limit — fits)

### Short Description (132 chars max)
**Read less. Understand more. Explore anything.** Progressive-disclosure reading for any webpage — powered by your own Pollen.

### Detailed Description

**PolliStretch brings Ted Nelson's StretchText to the modern web.**

Ever wish you could skim an article for the essential meaning, then expand only the sections you care about — without losing the original text? PolliStretch does exactly that, using AI-powered progressive disclosure that runs on **your own Pollen balance** (BYOP — Bring Your Own Pollen).

#### How it works
1. **Activate** on any article page (`Alt+Shift+P` or click the toolbar button)
2. **PolliStretch detects** the article body and splits it into paragraphs
3. **One AI call per chunk** returns **Kernel** (essential meaning) + **Context** (supporting detail)
4. **Click any chevron** to expand inline: Kernel → Context → Full (original text, never regenerated)
5. **Toolbar** gives you Expand All / Collapse All / Restore Original / Deactivate

#### Why it's different
- **Full hierarchy in one call** — 3× cheaper than per-level expansion
- **Zero hallucination on restore** — "Full" is always your exact original HTML, cached before transformation
- **You pay, you control** — BYOP device auth means your Pollen, your token, stored only in session memory
- **Faithful restoration** — DOM snapshots preserve node identity; external references stay intact
- **Editorial-quality UX** — Subtle inline chevrons, floating toolbar, React popup with depth slider, themes, model picker

#### Perfect for
- Researchers skimming papers
- Developers reading docs
- Students reviewing long-form content
- Anyone who wants to **read less, understand more**

---

## Screenshots Checklist (1280×800 or 640×400)

| # | Scene | Description |
|---|-------|-------------|
| 1 | Article before activation | Original page, PolliStretch icon in toolbar |
| 2 | Article after activation (kernel view) | Paragraphs compressed to kernel, chevrons visible |
| 3 | Inline expansion | One paragraph expanded to context level |
| 4 | Full expansion | Paragraph at full (original) level |
| 5 | Toolbar | Expand All / Collapse All / Restore / Deactivate |
| 6 | Popup — main view | Depth slider, page actions, connection status |
| 7 | Popup — settings | Theme, model, shortcuts, cache clear |
| 8 | BYOP connect flow | Device code + verification URL in popup |
| 9 | Connected state | Pollen balance (if exposed), disconnect button |
| 10 | Dark mode | Same article, dark theme tokens applied |

---

## Promo Assets

### Small Promo Tile (440×280)
**Headline:** Read less. Understand more.  
**Subtext:** Progressive disclosure for any webpage — powered by your Pollen.  
**Visual:** Split view — left: dense article; right: kernel chevrons with one expanded

### Large Promo Tile (920×680)
**Headline:** StretchText for the modern web  
**Subtext:** Activate → Skim kernels → Expand what matters → Restore original instantly  
**Visual:** Three-panel progression (Kernel → Context → Full) with toolbar + popup

### Marquee (1400×560) — optional
**Headline:** PolliStretch — Your Pollen. Your pace.  
**Visual:** Full-page article with inline chevrons, floating toolbar, popup open

---

## Category
**Productivity** → **Reading & Writing**

---

## Tags (max 5)
`reading`, `productivity`, `ai`, `summarization`, `progressive-disclosure`

---

## Permissions Justification (for CWS review)

| Permission | User-facing reason |
|------------|-------------------|
| `activeTab` | "Activate on this page only when you choose" |
| `storage` | "Remember your settings; keep your auth token for this session only" |
| `scripting` | "Inject the reading engine on demand" |
| `tabs` | "Show the correct state in the popup for the active tab" |
| `alarms` | "Complete the device authorization flow in the background" |
| `host_permissions: https://gen.pollinations.ai/*` | "Call the AI generation API with your token" |
| `host_permissions: https://enter.pollinations.ai/*` | "Run the device authorization flow (BYOP)" |

**No broad host permissions** — only the two Pollinations endpoints.

---

## Privacy Declaration (CWS)

- **Single purpose:** Progressive-disclosure reading transformation
- **No telemetry / analytics / tracking**
- **Token in `chrome.storage.session` only** — cleared on browser quit
- **Page content sent only to `gen.pollinations.ai`** at user initiation
- **See PRIVACY.md for full policy**

---

## Testing Notes for Reviewers

1. **Load unpacked** from `dist/`
2. **Navigate to any article** (e.g., Wikipedia, blog post, documentation)
3. **Press `Alt+Shift+P`** → page transforms to kernel view
4. **Click a chevron** → expands to context, click again → full original
5. **Click toolbar "Restore Original"** → page returns to exact original state
6. **Open popup** → Connect via BYOP (device flow) → generate with your Pollen
7. **Settings** → change theme, model, clear cache

---

## Known Limitations (documented)

- **Article detection** is heuristic (main/article/[itemprop=articleBody]/p-density); low-confidence pages show a notice; user can force-activate
- **Single AI call returns full hierarchy** — per-sentence granularity and per-level calls are out of scope
- **BYOP required** — no developer-funded Pollen fallback
- **Chrome 116+** (MV3 service worker, `chrome.storage.session`)

---

## Support / Contact

**Repository:** https://github.com/pollinations/pollinations/issues/17998  
**Issues:** File in the Pollinations repo with label `polli-stretch`  
**Privacy Policy:** `PRIVACY.md` (bundled, also hosted at repo)

---

## Release Checklist

- [x] `npm test` — 99 tests pass
- [x] `npm run typecheck` — clean
- [x] `npm run build` — `dist/` produced
- [ ] Load unpacked `dist/` → manual smoke test (activate, expand, restore, BYOP connect, popup)
- [x] Icons present in `dist/icons/` (16, 32, 48, 128 PNG)
- [x] `manifest.json` in `dist/` matches source
- [x] Zip `dist/` for CWS upload
- [ ] Upload screenshots + promo tiles
- [ ] Fill CWS form with metadata above
- [ ] Submit via the Pollinations app submission form (platform `browser-ext`, Quest `#17998`)