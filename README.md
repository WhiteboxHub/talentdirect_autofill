# AutoFill Job Applications Extension

**Version 1.2** (see `manifest.json`).

A Chromium-based browser extension (Manifest V3) that maps a [JSON Resume](https://jsonresume.org/)-style profile onto job application forms. It uses **platform-specific strategies** (Greenhouse, Lever, Workday, and many others) and falls back to a **generic** matcher with confidence scoring and optional prompts for uncertain fields. Where configured, it also uses **AI-assisted** filling (OpenAI fill plans and optional Ollama fallback for free-text answers).

## Key features

- **Automatic fill on load** — After the page settles, the content script runs (with debouncing). It also reacts to SPA navigation (`pushState` / `replaceState` / `popstate`) and DOM mutations when forms appear late.
- **OpenAI fill plan (optional)** — With an OpenAI API key saved in the side panel, the content script scrapes a **form schema** and the service worker requests a **structured JSON fill plan** from OpenAI. If there is no key or the call fails, **ATS strategies** run instead (autofill is not broken without a key).
- **AI fallback toggle** — When **Enable AI Fallback** is on (stored in `chrome.storage.local`), the generic strategy can ask the service worker for help on **unmatched required** fields: **OpenAI** first, then **Ollama** at `http://localhost:11434` for free-text answers. The side panel label may still say “(Soon)”; the behavior is implemented.
- **Context menu** — Right-click in an editable field → **Generate Answer with AI** (same backend path as `generate_ai_answer`: OpenAI, then Ollama on failure).
- **ATS routing** — Dedicated logic where it matters; otherwise `GenericStrategy` matches labels, `name` / `id`, `autocomplete`, `aria-label`, and similar (including inputs inside **open Shadow DOM** when present).
- **Confidence & feedback** — High-confidence fields fill immediately (green highlight). Medium confidence can show an accept/reject prompt. Unmatched required fields may be highlighted in red.
- **Side panel** — Upload profiles, pick the active profile, **Force Fill Form**, **Apply now** (multi-job queue from a listings table), **Fill Summary**, and **Apply Edits** to push corrections into the page.
- **Multiple profiles** — Store several named profiles (JSON and optional PDF/DOCX metadata); the active profile syncs to `chrome.storage.local` for content scripts.
- **Custom ATS answers** — JSON key/value overrides per platform (e.g. sponsorship / EEO-style questions) under **Platform Overrides**.

## Supported pages

- **Job listings helper** — `jobListingsIntegration.js` is injected on **`<all_urls>`** so job-board / listing tables can be detected and the **Apply now** queue can start from almost any tab. This script does **not** load the full autofill stack.
- **Autofill** — The ATS strategies, `content.js`, and related bundles run only on origins listed in `manifest.json` under `content_scripts` → `matches` (and `host_permissions` for scripting). That includes major ATS hosts (e.g. Greenhouse, Lever, Workday, LinkedIn, Indeed, and many enterprise vendors) plus **company career sites** such as `mongodb.com` where explicitly listed.

If a form is embedded in a **cross-origin iframe**, the iframe’s URL must also be covered; otherwise the script runs only in the top frame.

After changing `manifest.json`, reload the extension on `chrome://extensions` and hard-refresh the job page.

## Installation

1. Clone or download this project.
2. Open your Chromium-based browser → `chrome://extensions/` (or the equivalent, e.g. Edge → `edge://extensions/`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `project-autofill-resume-json-extension` folder.

## Usage

1. **Prepare data** — Use a JSON Resume–compatible JSON file. Templates: `resume.json` and `sample_resume.json` in the repo. You can also attach a PDF/DOCX for display metadata.
2. **Open the side panel** — Click the extension icon (side panel opens).
3. **Create a profile** — **Upload resume.json** (and optionally **Upload PDF/DOCX**). Pick the profile from the dropdown to make it active.
4. **Open a job application** on a supported origin. The form should fill automatically; if not, use **Force Fill Form** (uses the active profile from storage). **Force Fill** and automatic fill attempt the OpenAI fill plan first when a form is detected; without an API key, behavior is **ATS-only**.
5. **Review** — Check **Fill Summary**, edit cells if needed, then **Apply Edits** and submit the application yourself.

### AI / OpenAI

- Save an **OpenAI API key** in the side panel under **OpenAI Settings**. This is required for the **fill-plan** path (`ACTION_FILL_ALL`) and for the primary path of **Generate Answer with AI** / generic-strategy AI answers.
- Optionally run **[Ollama](https://ollama.com/)** locally on port **11434** so `generate_ai_answer` can fall back when OpenAI fails or is unavailable.
- Turn on **Enable AI Fallback** if you want the generic strategy to request AI text for unmatched required fields (in addition to the fill-plan / ATS flow).

## Apply queue (“Apply now”)

On a tab that shows your **Job Listings** table (with job URLs in rows or a **Job URL** column): click **Apply now** in the side panel, or the purple **Apply Now** on the page when injected. The extension collects visible ATS-looking links, opens the first in a **new window**, then navigates that tab through the rest after each application completes (success URL / timeout / skip rules in `background.js` + `content.js`). Incomplete field fill is improved separately via `fieldRegistry` / strategies—not by removing the queue.

## Development

From the `project-autofill-resume-json-extension` folder:

```bash
npm test
```

Runs [Node’s built-in test runner](https://nodejs.org/api/test.html) on `tests/*.test.js` (e.g. `resumeProcessor`).

## Project structure

| Path | Role |
|------|------|
| `manifest.json` | MV3 manifest, content script matches, permissions |
| `background.js` | Service worker: OpenAI/Ollama for fill plans and `generate_ai_answer`, apply queue, context menus, programmatic injection |
| `content.js` | SPA hooks, form schema scrape, OpenAI fill-plan flow + ATS fallback, autofill triggers, queue success detection, messaging |
| `jobListingsIntegration.js` | On **all URLs**: on-page **Apply Now**, listing-table helpers, message bridge for side panel queue start |
| `sidepanel.html` / `styles.css` / `sidepanel.js` | Side panel UI, profiles, OpenAI key, Force Fill, Apply now |
| `resumeProcessor.js` | Normalize resume JSON for strategies |
| `resume.json`, `sample_resume.json` | Example JSON Resume–style data |
| `tests/` | Node tests (`npm test`) |
| `atsStrategies/fieldSynonyms.js` | Default keyword bundles per canonical JSON path (editable) |
| `atsStrategies/fieldRegistry.js` | Builds matchable `{ path, value, keywords }[]` from normalized data |
| `atsStrategies/` | Strategy registry and per-ATS modules (`genericStrategy.js`, etc.) |

## Roadmap / ideas

- [ ] **UI copy** — Align side panel labels (e.g. AI fallback) with implemented behavior.
- [ ] **Cover letter** — Scrape JD + generate text into a textarea.
- [ ] Broader **iframe** and **closed shadow** coverage where technically possible.
