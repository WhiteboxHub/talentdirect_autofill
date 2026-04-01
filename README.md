# AutoFill Job Applications Extension

A Chrome extension (Manifest V3) that maps a [JSON Resume](https://jsonresume.org/)-style profile onto job application forms. It uses **platform-specific strategies** (Greenhouse, Lever, Workday, and many others) and falls back to a **generic** matcher with confidence scoring and optional prompts for uncertain fields.

## Key features

- **Automatic fill on load** — After the page settles, the content script runs (with debouncing). It also reacts to SPA navigation (`pushState` / `replaceState` / `popstate`) and DOM mutations when forms appear late.
- **ATS routing** — Dedicated logic where it matters; otherwise `GenericStrategy` matches labels, `name` / `id`, `autocomplete`, `aria-label`, and similar (including inputs inside **open Shadow DOM** when present).
- **Confidence & feedback** — High-confidence fields fill immediately (green highlight). Medium confidence can show an accept/reject prompt. Unmatched required fields may be highlighted in red.
- **Side panel** — Upload profiles, pick the active profile, **Force Fill Form**, **Apply now** (multi-job queue from a listings table), **Fill Summary**, and **Apply Edits** to push corrections into the page.
- **Multiple profiles** — Store several named profiles (JSON and optional PDF/DOCX metadata); the active profile syncs to `chrome.storage.local` for content scripts.
- **Custom ATS answers** — JSON key/value overrides per platform (e.g. sponsorship / EEO-style questions) under **Platform Overrides**.

## Supported pages

The autofill bundle is injected only on origins listed in `manifest.json` under `content_scripts` → `matches` (and `host_permissions` for scripting). That includes major ATS hosts (e.g. Greenhouse, Lever, Workday, LinkedIn, Indeed, and many enterprise vendors) plus **company career sites** such as `mongodb.com` where explicitly listed.

If a form is embedded in a **cross-origin iframe**, the iframe’s URL must also be covered; otherwise the script runs only in the top frame.

After changing `manifest.json`, reload the extension on `chrome://extensions` and hard-refresh the job page.

## Installation

1. Clone or download this project.
2. Open Chrome → `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `project-autofill-resume-json-extension` folder.

## Usage

1. **Prepare data** — Use a JSON Resume–compatible JSON file (see `resume.json` in the repo as a template). You can also attach a PDF/DOCX for display metadata.
2. **Open the side panel** — Click the extension icon (side panel opens).
3. **Create a profile** — **Upload resume.json** (and optionally **Upload PDF/DOCX**). Pick the profile from the dropdown to make it active.
4. **Open a job application** on a supported origin. The form should fill automatically; if not, use **Force Fill Form** (uses the active profile from storage).
5. **Review** — Check **Fill Summary**, edit cells if needed, then **Apply Edits** and submit the application yourself.

Optional: **Enable AI Fallback** is reserved for future AI-assisted answers (toggle persists in storage).

## Apply queue (“Apply now”)

On a tab that shows your **Job Listings** table (with job URLs in rows or a **Job URL** column): click **Apply now** in the side panel, or the purple **Apply Now** on the page when injected. The extension collects visible ATS-looking links, opens the first in a **new window**, then navigates that tab through the rest after each application completes (success URL / timeout / skip rules in `background.js` + `content.js`). Incomplete field fill is improved separately via `fieldRegistry` / strategies—not by removing the queue.

## Project structure

| Path | Role |
|------|------|
| `manifest.json` | MV3 manifest, content script matches, permissions |
| `background.js` | Storage hydration, programmatic injection, optional queue helpers |
| `content.js` | SPA hooks, autofill triggers, queue success detection, messaging |
| `jobListingsIntegration.js` | Optional on-page **Apply Now** + message bridge for side panel queue start |
| `sidepanel.html` / `styles.css` / `sidepanel.js` | Side panel UI, profiles, Force Fill, Apply now |
| `resumeProcessor.js` | Normalize resume JSON for strategies |
| `atsStrategies/fieldSynonyms.js` | Default keyword bundles per canonical JSON path (editable) |
| `atsStrategies/fieldRegistry.js` | Builds matchable `{ path, value, keywords }[]` from normalized data |
| `atsStrategies/` | Strategy registry and per-ATS modules (`genericStrategy.js`, etc.) |

## Roadmap / ideas

- [ ] **AI answers** — Wire **Enable AI Fallback** to Ollama or a cloud API for unstructured questions.
- [ ] **Cover letter** — Scrape JD + generate text into a textarea.
- [ ] Broader **iframe** and **closed shadow** coverage where technically possible.
