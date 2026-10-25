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

## Design system (studied from the four reference screens)
Each subject is a "module" with its own palette, type and layout, all sampled from your references (hex values read from the PNGs).

| Module | Reference look | Palette | Type | Layout |
|---|---|---|---|---|
| Home, Archive | Silhouette | tan `#A47E5A`, cream `#EDE5D4`, cobalt `#275075`, brown `#402410` | Instrument Serif caps, DM Sans | full-bleed hero, wordmark + tagline spread to the same width, cream cards on tan, cobalt bands |
| Systems Forge (+ Dispatch) | Silhouette blue | cobalt `#275075`, deep `#1B3A57`, white | Instrument Serif caps, DM Sans | centred hero, flat bands |
| Frugal Chic (+ Puzzle, Board) | Silhouette tan | tan `#A47E5A`, cream `#EDE5D4` | Instrument Serif caps, DM Sans | split hero, cream panels |
| Theology | Luminare oxblood | `#810603`, coral `#F26B55`, cream `#F6EEED` | Alegreya Sans ExtraBold | split hero, square rectangular buttons |
| Mindcraft | Luminare sky | `#90A9C3`, teal `#24485C` | Alegreya Sans ExtraBold | split hero |
| Design Observatory | Luminare green | `#3F4D32`, lime `#C7DEA4` | Alegreya Sans ExtraBold | split hero |
| Soundroom | Crimson Thorns | black, maroon `#8B2E44`, off-white `#F6EEED` | Inter Tight (tight tracking), Pinyon Script | full-bleed hero, huge thin title + script line, film grain |
| AI/ML Fieldnotes | Wesley Taylor | navy `#021121`, acid yellow `#EDFF06`, plum `#37324A` | Space Grotesk thin caps, Mea Culpa swash initial | centred hero, sunburst glyph, pill buttons, grain |

Honest note on fonts: the exact typefaces cannot be read from a PNG. I rendered about 40 open-licence candidates next to your headlines and picked the closest. Instrument Serif and Alegreya Sans ExtraBold are close matches; DM Sans is a near-certain match for the Silhouette body text. All fonts are bundled in `fonts/` (SIL OFL), so the app works offline.
Contrast was checked for every theme (body text at least 4.5:1, large headings at least 3:1). Two heading colours are slightly lighter than in the references (oxblood coral, sky teal) so they pass.

## AI images
1. The text model writes an `imagePrompt` for each lesson (objects, places and textures only: never people, faces or text, because image models garble them).
2. The generator adds that house's style line from `generator/config.json` (for example "motion-blurred 35mm film photograph, marigold and deep green, light leak" for Soundroom) and calls FLUX.1 schnell on Cloudflare Workers AI. Cost is roughly 60 Neurons per image against a free allowance of 10,000 per day, so 8 images per edition is far below the limit.
3. Images are compressed with `sharp`, stored in `data/img/<edition>/`, and labelled "AI illustration" in the app. Images for editions older than the newest 40 are pruned (set `IMG_KEEP`), and any missing image falls back to generated grain art in the module's palette.
4. Setup: create a free Cloudflare account, copy your Account ID, create an API token with the "Workers AI" permission, and give both to `bootstrap.sh` (or add repo secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`). Without them the app still works with generated art.
5. Honesty: AI images of historical subjects are illustrations, not evidence. They are always labelled, and the prompts avoid depicting real people.

## What changed in v2: coherence, typography, interaction
**One skeleton, eight palettes.** Every module shares the same body face (DM Sans), button language, hero anatomy (kicker, title, script accent line, hook, call to action), numbered section headers, sunburst logo mark, and the same grain and palette tint on every image. Only palette, display typeface, hero layout and a corner token vary.

**Type roles.** CAPS for labels and navigation. Bold for key terms (with a highlighter underline). Italic for titles and emphasis, and for the pull-quote of each lesson's key idea. Dotted underline for glossary terms you can tap. Solid underline for links. A drop cap and small-caps opening line start every lesson. The writer model is told to use `**bold**` and `*italic*` only.

**Interactive elements.** Sticky section index with reading progress and scroll-spy. Tap-to-define glossary terms plus flip cards. Evidence filter by label. Quiz score with retry. Text size and focus mode (Esc exits). Select any lesson text and tap Clip to drop it on the mind board. Collapsible briefings. Palette card with copy-hex and a swap preview. Pronounce button for the word of the day. Challenge checkbox. Edition switcher. Hero parallax (off for reduced-motion users).

Older editions (made before v2) still display; they just lack the key idea, glossary and images until you generate a new edition.

## Honesty features
- Evidence labels: established / inference / debate / tradition / background / unverified. "Established" must point at a fetched source id, otherwise it is downgraded.
- Prices are never generated. Colour contrast and puzzles are computed by code, not the model.
- Every lesson is flagged AI-generated, `unreviewed`, and says whether it was source-grounded.
- A failed source or section degrades gracefully; if more than half fail, nothing is published.

## Tuning
Edit `generator/config.json`: topics rotate in order (one per edition), feeds, word list and the "open tab" site list live there. Add topics freely.

## Limits you should know
- Model quality varies. Theology and history lessons deserve a human read before you trust them.
- Free tiers change. Gemini free-tier inputs may be used by Google to improve its products, which is fine for public learning content, not for private notes (which never go to any model).
- GitHub may pause scheduled workflows after 60 days without repo activity; re-enable in the Actions tab.
