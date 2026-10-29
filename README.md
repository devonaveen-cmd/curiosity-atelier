# The Curiosity Atelier

A personal learning magazine. A new edition (daily capsule, six knowledge houses, Frugal Chic, a puzzle, a newsletter-style dispatch) is generated every ~48 hours by a free AI model, committed to this repo as JSON, and served as an installable offline-capable PWA on GitHub Pages. No server, no paid API, no build step.

## How it works
GitHub Actions (daily check) -> `generator/generate.mjs` fetches REAL sources (Wikipedia, bible-api.com WEB text, arXiv, Hugging Face / Google Research / LWN feeds, the dictionary API) -> asks a free model to write lessons ONLY from those sources -> validates the JSON -> writes `data/editions/NNN.json` -> deploys `_site/` to Pages. The app just reads that JSON. Your notes, bookmarks and mind board live in your browser (IndexedDB) and never leave it.

## Setup (3 things only you can do)
1. Create a free Gemini API key: https://aistudio.google.com/apikey
2. Install GitHub CLI and log in: `sudo dnf install gh` (Fedora) then `gh auth login`
3. From this folder run: `GEMINI_API_KEY=your_key ./bootstrap.sh`

The script creates the repo, stores the key as an encrypted secret (never in the browser), enables Pages, pushes, and triggers the first edition. App URL: `https://<you>.github.io/curiosity-atelier/`

## Providers (automatic fallback, in this order)
| Secret / env | Provider | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini Flash (free tier) | Newest eligible Flash model is auto-discovered, so retired model names do not break it. Exact limits: AI Studio > rate limits. |
| `GROQ_API_KEY` | Groq | Free tier, open models |
| `OPENROUTER_API_KEY` | OpenRouter `:free` models | Availability changes often |
| `USE_OLLAMA=1` | Local Ollama | Local runs only (not on GitHub Actions) |

Image generation uses `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (see AI images below). Add extra keys as repo secrets (Settings > Secrets > Actions) for fallback. Override a model with `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `OLLAMA_MODEL`.

## Running locally with ~2 GB of RAM
```
sudo dnf install nodejs     # Node 20+
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:1.5b    # ~1 GB; gemma3:1b is another option
USE_OLLAMA=1 FORCE=1 node generator/generate.mjs
python3 -m http.server 8000   # then open http://localhost:8000
```
Small local models write weaker lessons and are slow on CPU. Treat Ollama as an offline fallback, not the main engine. Test the pipeline without any model: `MOCK=1 FORCE=1 node generator/generate.mjs` (writes placeholder text; delete `data/editions/*.json` and reset `data/index.json` to `{ "editions": [] }` afterwards).

## Design system (v3: one look, eight palettes)
Every page is pure black (`#000`). Every house uses the Soundroom look: thin, tightly tracked headlines (Inter Tight), a large script accent line (Pinyon Script), a full-bleed grainy hero, pill buttons and tracked-caps labels. Only the palette changes per module:

| Module | Panel colour (alternate sections, tiles) | Accent (script line, buttons, highlights) |
|---|---|---|
| Home, Archive, Board | `#161616` | cream `#F6EEED` |
| Soundroom | maroon `#8B2E44` | cream `#F6EEED` |
| Theology | oxblood `#810603` | coral `#F26B55` |
| Mindcraft | teal `#2D5366` | sky `#90A9C3` |
| AI/ML Fieldnotes | plum `#37324A` | acid yellow `#EDFF06` |
| Systems Forge, Dispatch | cobalt `#275075` | light blue `#9CC3EA` |
| Design Observatory | olive `#3F4D32` | lime `#C7DEA4` |
| Frugal Chic, Puzzle | umber `#6B4E34` | sand `#DDB892` |

Fonts (all SIL OFL, bundled in `fonts/`, so the app works offline): Inter Tight for text, Instrument Serif for the logo and italic quotes, Pinyon Script for the accent line, Azeret Mono for the capsule dashboard. All text/background pairs were checked for contrast.

## AI images
1. The text model writes an `imagePrompt` for each lesson (objects, places and textures only: never people, faces or text, because image models garble them).
2. The generator adds that house's style line from `generator/config.json` (for example "motion-blurred 35mm film photograph, marigold and deep green, light leak" for Soundroom) and calls FLUX.1 schnell on Cloudflare Workers AI. Cost is roughly 60 Neurons per image against a free allowance of 10,000 per day, so 8 images per edition is far below the limit.
3. Every image is then graded in code so the set looks like one family: cropped to 16:10, darkened, partly desaturated, tinted toward that house's palette (`imageTint` in `generator/config.json`) and vignetted. Set `GRADE=0` to turn the grade off. Images are compressed with `sharp`, stored in `data/img/<edition>/`, and labelled "AI illustration" in the app. Images for editions older than the newest 40 are pruned (set `IMG_KEEP`), and any missing image falls back to generated grain art in the module's palette.
4. Setup: create a free Cloudflare account, copy your Account ID, create an API token with the "Workers AI" permission, and give both to `bootstrap.sh` (or add repo secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`). Without them the app still works with generated art.
5. Honesty: AI images of historical subjects are illustrations, not evidence. They are always labelled, and the prompts avoid depicting real people.

## What changed in v2: coherence, typography, interaction
**One skeleton, eight palettes.** Every module shares the same body face (DM Sans), button language, hero anatomy (kicker, title, script accent line, hook, call to action), numbered section headers, sunburst logo mark, and the same grain and palette tint on every image. Only palette, display typeface, hero layout and a corner token vary.

**Type roles.** CAPS for labels and navigation. Bold for key terms (with a highlighter underline). Italic for titles and emphasis, and for the pull-quote of each lesson's key idea. Dotted underline for glossary terms you can tap. Solid underline for links. A drop cap and small-caps opening line start every lesson. The writer model is told to use `**bold**` and `*italic*` only.

**Interactive elements.** Sticky section index with reading progress and scroll-spy. Tap-to-define glossary terms plus flip cards. Evidence filter by label. Quiz score with retry. Text size and focus mode (Esc exits). Select any lesson text and tap Clip to drop it on the mind board. Collapsible briefings. Palette card with copy-hex and a swap preview. Pronounce button for the word of the day. Challenge checkbox. Edition switcher. Hero parallax (off for reduced-motion users).

**Mind board v2.** Seven card kinds (note, heading, quote, checklist, frame, image, link). Rich text with bold, italic, underline, strikethrough, bullets and four highlight colours (select text first, or format the whole card). Eight card colours, three text sizes, drag, corner-resize, lock, duplicate. Connect cards with arrows and labels. Undo/redo (60 steps), zoom and fit, pan by dragging empty space, double-click to add a note, search that dims non-matching cards, and Markdown export. Old boards are migrated automatically, and stored card HTML is sanitised before it is ever shown.

Older editions (made before v2) still display; they just lack the key idea, glossary and images until you generate a new edition.

## Daily capsule (personal-dashboard bento)
Styled after your dashboard reference, with every grey turned into pure black (`#000000`): black tiles separated by hairlines in each tile's own accent colour, two slate-blue accent tiles, Azeret Mono labels and big numerals, thin rules and round ↗ buttons. A stats strip along the top shows real numbers from your own progress (edition, date, sections explored, quiz answered, accuracy, bookmarks) plus an edition switcher.

The seven slots are compact tiles, and each one is a real link to its own full page (`#/capsule/word`, `/signal`, `/colour`, `/type`, `/interface`, `/tab`, `/challenge`), so the home page stays short. On an item page you get the full content, 01 to 07 position dots, previous/next links, left/right arrow keys, and a back link that returns you to the dashboard (not the top of the page). The colour tile draws the palette as bars and shows the computed contrast ratio; the type tile shows the font in its own face when online; the challenge tile is a progress ring that fills when you finish it. A slot that failed to generate shows as a dashed placeholder instead of breaking the layout.

## Try one image before a full run
```
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node generator/preview-image.mjs theology "an old brass key resting on a folded paper map"
```
This writes `preview/theology.jpg` so you can judge the look (and adjust `imageStyle` / `imageTint` in the config) before spending a whole edition.

## Honesty features
- Evidence labels: established / inference / debate / tradition / background / unverified. "Established" must point at a fetched source id, otherwise it is downgraded.
- Prices are never generated. Colour contrast and puzzles are computed by code, not the model.
- Every lesson is flagged AI-generated, `unreviewed`, and says whether it was source-grounded.
- A failed source or section degrades gracefully; if more than half fail, nothing is published.

## Tuning
Edit `generator/config.json`: topics rotate in order (one per edition), feeds, word list and the "open tab" site list live there. Add topics freely.

## Limits you should know
- The capsule's type specimen loads the featured font from Google Fonts when you are online. It is the only third-party request the app makes (Google can see that the page was opened). Offline, or if it fails, the specimen falls back to Inter Tight.
- Model quality varies. Theology and history lessons deserve a human read before you trust them.
- Free tiers change. Gemini free-tier inputs may be used by Google to improve its products, which is fine for public learning content, not for private notes (which never go to any model).
- GitHub may pause scheduled workflows after 60 days without repo activity; re-enable in the Actions tab.
