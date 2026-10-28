// Try ONE image before generating a whole edition.
// Usage:  CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node generator/preview-image.mjs <house> "<scene>"
// Example: node generator/preview-image.mjs theology "an old brass key resting on a folded paper map"
// Houses: theology, mindcraft, soundroom, aiml, systems, design, frugal. The result is written to preview/<house>.jpg
import { previewImage } from './generate.mjs';
const [house, ...rest] = process.argv.slice(2);
if (!house || !rest.length) { console.error('Usage: node generator/preview-image.mjs <house> "<scene>"'); process.exit(1); }
previewImage(house, rest.join(' ')).then((f) => console.log('Saved', f)).catch((e) => { console.error(e.message); process.exit(1); });
