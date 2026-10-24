// Downloads the open-licence (SIL OFL) font subsets used by the design and writes fonts.css.
// Only needed if the fonts/ folder is missing (for example when rebuilding from the master spec).
// Usage: node fetch-fonts.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WANT = [
  ['instrument-serif', 'Instrument Serif', [[400, 'normal'], [400, 'italic']]],
  ['dm-sans', 'DM Sans', [[400, 'normal'], [500, 'normal'], [700, 'normal'], [400, 'italic']]],
  ['alegreya-sans', 'Alegreya Sans', [[400, 'normal'], [800, 'normal'], [400, 'italic']]],
  ['space-grotesk', 'Space Grotesk', [[300, 'normal'], [400, 'normal'], [700, 'normal']]],
  ['mea-culpa', 'Mea Culpa', [[400, 'normal']]],
  ['pinyon-script', 'Pinyon Script', [[400, 'normal']]],
  ['inter-tight', 'Inter Tight', [[300, 'normal'], [400, 'normal'], [700, 'normal'], [400, 'italic']]]
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-fonts-'));
execSync('npm init -y', { cwd: tmp, stdio: 'ignore' });
execSync(`npm install --silent --no-audit --no-fund ${WANT.map((w) => '@fontsource/' + w[0]).join(' ')}`, { cwd: tmp, stdio: 'inherit' });
fs.mkdirSync('fonts', { recursive: true });
let css = '/* Self-hosted subsets (latin). Fonts are open-licensed (SIL OFL) via Fontsource. */\n';
let n = 0;
for (const [pkg, fam, variants] of WANT) {
  for (const [w, st] of variants) {
    const src = path.join(tmp, 'node_modules', '@fontsource', pkg, 'files', `${pkg}-latin-${w}-${st}.woff2`);
    if (!fs.existsSync(src)) { console.warn('missing', src); continue; }
    fs.copyFileSync(src, path.join('fonts', `${pkg}-${w}-${st}.woff2`));
    css += `@font-face{font-family:'${fam}';font-style:${st};font-weight:${w};font-display:swap;src:url('fonts/${pkg}-${w}-${st}.woff2') format('woff2')}\n`;
    n++;
  }
}
fs.writeFileSync('fonts.css', css);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Wrote ${n} font files and fonts.css`);
