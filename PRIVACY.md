# PolliStretch — Privacy Policy

**Effective date:** 2026-11-04  
**Version:** 0.1.0

## Summary

PolliStretch is a **local-first** Chrome extension. It does not collect, transmit, or store any personal data, browsing history, or page content on its own servers. All AI generation happens via **your own Pollen balance** through Pollinations' official API — you authorize once via device flow, and the extension uses your token to call `gen.pollinations.ai` directly.

## Data We Handle

| Data | Where it lives | Purpose | Retention |
|------|----------------|---------|-----------|
| **Pollinations access token** | `chrome.storage.session` (memory only, cleared on browser quit) | Authorize AI generation calls to `gen.pollinations.ai` | Session only |
| **Settings** (theme, model, depth, shortcuts) | `chrome.storage.local` | Persist your preferences | Until you clear or uninstall |
| **IndexedDB cache** (chunk results keyed by hash) | Browser IndexedDB (`polli-stretch` DB) | Avoid repeat generation = zero Pollen cost on re-activation | 7-day TTL; manual clear available |
| **Page content sent to Pollinations** | Transient in request body to `https://gen.pollinations.ai/v1/chat/completions` | Generate `kernel` + `context` for detected article paragraphs | Not stored by PolliStretch; see Pollinations' privacy policy |
| **Device flow codes** (`device_code`, `user_code`, `verification_uri`) | Transient in memory during auth | Complete BYOP authorization | Discarded after token exchange |

## What We Do NOT Do

- ❌ No telemetry, analytics, crash reporting, or usage tracking
- ❌ No account creation, no email, no identity
- ❌ No page content stored by us (only transient to Pollinations API)
- ❌ No token logging (token never written to console, storage, or network logs)
- ❌ No third-party scripts, CDNs, or remote resources in the content script
- ❌ No data sold, shared, or monetized

## BYOP (Bring Your Own Pollen) Flow

1. You click **Connect** in the popup → extension requests a device code from `https://enter.pollinations.ai/api/device/code` using your **publishable app key** (`pk_…` — registered at enter.pollinations.ai/keys; not a secret).
2. You visit the verification URL on any device, sign in to Pollinations, and approve.
3. Extension polls for the token → stores the `access_token` **only in `chrome.storage.session`**.
4. All subsequent generation calls include `Authorization: Bearer <your-token>`.
5. Token dies when you close the browser (or you click **Disconnect**).

**You pay with your own Pollen.** PolliStretch has no developer-funded fallback and no access to your Pollinations account beyond the token you authorize.

## Permissions Rationale

| Permission | Why |
|------------|-----|
| `activeTab` | Activate only on the tab you choose |
| `storage` | `local` for settings, `session` for token |
| `scripting` | Inject content script on demand |
| `tabs` | Query active tab for popup state |
| `alarms` | Device-flow polling in service worker |
| `host_permissions: https://gen.pollinations.ai/*` | AI generation endpoint |
| `host_permissions: https://enter.pollinations.ai/*` | Device authorization endpoints |

## Data Deletion

- **Token:** Click **Disconnect** in popup, or close browser (session storage cleared).
- **Settings:** Click **Clear cache & settings** in popup Settings, or uninstall extension.
- **IndexedDB cache:** Click **Clear cache** in popup Settings, or browser "Clear browsing data".

## Third-Party Services

- **Pollinations AI** (`gen.pollinations.ai`, `enter.pollinations.ai`) — receives article paragraphs you choose to transform. See [Pollinations Privacy Policy](https://pollinations.ai/privacy).

## Contact

This extension is built for **Pollinations Quest #17998**. For privacy questions, open an issue on the [Pollinations repository](https://github.com/pollinations/pollinations/issues/17998).

## Changes

Any material changes will be reflected in this file with an updated effective date. The extension does not auto-update from a remote privacy policy.