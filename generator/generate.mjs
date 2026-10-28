// The Curiosity Atelier: edition generator. Node 20+, zero dependencies.
// Run: node generator/generate.mjs   (see README.md for env vars)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const E = process.env;
const MOCK = E.MOCK === '1';
const FORCE = E.FORCE === '1';
const MIN_HOURS = Number(E.MIN_HOURS || 47);
const DELAY = Number(E.CALL_DELAY_MS || 7000);
const T0 = Date.now();
const BUDGET_MS = Number(E.MAX_MINUTES || 38) * 60000;      // generator stops starting new work after this, then publishes what it has
const timeLeft = () => BUDGET_MS - (Date.now() - T0);
const UA = 'CuriosityAtelier/1.0 (personal learning project)';
const GEMINI_BASE = E.GEMINI_BASE || 'https://generativelanguage.googleapis.com';
const HOUSES = ['theology', 'mindcraft', 'soundroom', 'aiml', 'systems', 'design'];
const LABELS = ['established', 'inference', 'debate', 'tradition', 'background', 'unverified'];

const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'generator/config.json'), 'utf8'));
const log = (...a) => console.log('[atelier]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };

// ---------- HTTP ----------
async function http(url, opts = {}, { tries = 3, timeout = 30000, quiet = false } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { ...opts, headers: { 'user-agent': UA, ...(opts.headers || {}) }, signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) return r;
      const body = (await r.text().catch(() => '')).slice(0, 200);
      err = new Error(`HTTP ${r.status} ${body}`);
      err.status = r.status;
      if (![429, 500, 502, 503, 504].includes(r.status)) throw err;
    } catch (e) {
      clearTimeout(t);
      err = e;
      if (e.status && ![429, 500, 502, 503, 504].includes(e.status)) throw e;
    }
    if (i < tries - 1) await sleep(err.status === 429 ? 8000 * (i + 1) : 1500 * (i + 1));
  }
  if (!quiet) log('request failed:', url.slice(0, 90), String(err.message).slice(0, 120));
  throw err;
}

// ---------- Grounding sources ----------
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ').trim();
const tag = (s, t) => { const m = s.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };

export function parseFeed(xml, limit = 8) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.slice(0, limit).map((b) => {
    let url = tag(b, 'link');
    const href = b.match(/<link[^>]*href="([^"]+)"/i);
    if (!/^https?:/.test(url) && href) url = href[1];
    if (!/^https?:/.test(url)) url = tag(b, 'id');
    return { title: tag(b, 'title'), url, date: tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published'), summary: (tag(b, 'description') || tag(b, 'summary')).slice(0, 500) };
  }).filter((x) => x.title && /^https?:/.test(x.url));
}

async function feedItems(list) {
  const out = [];
  for (const f of list) {
    try {
      const r = await http(f.url, {}, { tries: 2, timeout: 20000 });
      for (const it of parseFeed(await r.text(), 6)) out.push({ ...it, feed: f.name });
    } catch { /* source down: skip */ }
  }
  return out;
}

async function wiki(title) {
  const r = await http(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, {}, { tries: 2, timeout: 15000, quiet: true });
  const j = await r.json();
  if (!j.extract) throw new Error('no extract');
  return { title: `Wikipedia: ${j.title}`, url: j.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, kind: 'wikipedia', text: j.extract.slice(0, 1800) };
}

async function bible(ref) {
  const r = await http(`https://bible-api.com/${encodeURIComponent(ref)}?translation=web`, {}, { tries: 2, timeout: 15000, quiet: true });
  const j = await r.json();
  if (!j.text) throw new Error('no text');
  return { title: `${j.reference} (${j.translation_name || 'WEB'})`, url: `https://bible-api.com/${encodeURIComponent(ref)}`, kind: 'scripture', text: j.text.replace(/\s+/g, ' ').trim().slice(0, 2600) };
}

async function dictionary(word) {
  const r = await http(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {}, { tries: 2, timeout: 15000, quiet: true });
  const j = (await r.json())[0];
  const m = j.meanings?.[0];
  const d = m?.definitions?.[0];
  return { phonetic: j.phonetic || j.phonetics?.find((p) => p.text)?.text || '', pos: m?.partOfSpeech || '', definition: d?.definition || '', example: d?.example || '', url: `https://api.dictionaryapi.dev/api/v2/entries/en/${word}` };
}

// ---------- Providers (all free-tier friendly, models auto-discovered) ----------
const used = new Set();
const rank = (ids, prefs) => {
  const score = (id) => { const i = prefs.findIndex((re) => re.test(id)); return i < 0 ? 99 : i; };
  return [...ids].sort((a, b) => score(a) - score(b));
};

const gemini = {
  name: 'gemini', enabled: !!E.GEMINI_API_KEY, models: null,
  async list() {
    if (E.GEMINI_MODEL) return [E.GEMINI_MODEL];
    const r = await http(`${GEMINI_BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': E.GEMINI_API_KEY } });
    const names = (await r.json()).models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /flash/.test(m.name) && !/(image|tts|live|audio|embed|robot|computer|exp|learnlm)/.test(m.name))
      .map((m) => m.name.replace('models/', ''));
    const ver = (n) => parseFloat((n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    const pre = (n) => (/preview|exp|latest/.test(n) ? 1 : 0);
    return names.sort((a, b) => pre(a) - pre(b) || ver(b) - ver(a) || (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0));
  },
  async call(system, user) {
    this.models ||= await this.list();
    this.bad ||= {};                                                   // models that keep failing are skipped for the rest of the run
    let cands = this.models.filter((m) => (this.bad[m] || 0) < 2).slice(0, 4);
    if (!cands.length) { this.bad = {}; cands = this.models.slice(0, 4); }
    let last;
    for (const m of cands) {
      try {
        const r = await http(`${GEMINI_BASE}/v1beta/models/${m}:generateContent`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': E.GEMINI_API_KEY },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.6 } })
        }, { tries: 1, timeout: 60000 });
        const j = await r.json();
        const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
        if (!text) throw new Error('empty response');
        used.add(`gemini/${m}`);
        this.bad[m] = 0;
        return text;
      } catch (e) { this.bad[m] = (this.bad[m] || 0) + 1; last = e; log(`gemini ${m} failed: ${String(e.message).slice(0, 100)}`); }
    }
    throw last;
  }
};

function openaiLike(name, base, keyEnv, modelEnv, prefs, filter, extraHeaders = {}) {
  return {
    name, enabled: !!E[keyEnv], models: null,
    async list() {
      if (E[modelEnv]) return [E[modelEnv]];
      const r = await http(`${base}/models`, { headers: { authorization: `Bearer ${E[keyEnv]}`, ...extraHeaders } });
      const ids = (await r.json()).data.map((m) => m.id).filter(filter);
      return rank(ids, prefs);
    },
    async call(system, user) {
      this.models ||= await this.list();
      let last;
      for (const m of this.models.slice(0, 4)) {
        for (const json of [true, false]) {
          try {
            const body = { model: m, temperature: 0.6, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
            if (json) body.response_format = { type: 'json_object' };
            const r = await http(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${E[keyEnv]}`, ...extraHeaders }, body: JSON.stringify(body) }, { tries: 2, timeout: 90000 });
            const text = (await r.json()).choices?.[0]?.message?.content;
            if (!text) throw new Error('empty response');
            used.add(`${name}/${m}`);
            return text;
          } catch (e) { last = e; if (!(json && e.status === 400)) { log(`${name} ${m} failed: ${String(e.message).slice(0, 100)}`); break; } }
        }
      }
      throw last;
    }
  };
}

const groq = openaiLike('groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', 'GROQ_MODEL',
  [/gpt-oss-120b/, /llama-3\.3-70b/, /qwen.*32b/, /llama-3\.1-8b/], (id) => !/(whisper|guard|tts|playai|distil|allam|prompt)/.test(id));
const openrouter = openaiLike('openrouter', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL',
  [/llama-3\.3-70b/, /gpt-oss-120b/, /qwen.*(72|32)b/, /gemma/, /deepseek/, /mistral/], (id) => id.endsWith(':free') && !/(vision|image|embed)/.test(id),
  { 'HTTP-Referer': 'https://github.com', 'X-Title': 'Curiosity Atelier' });

const ollama = {
  name: 'ollama', enabled: E.USE_OLLAMA === '1',
  async call(system, user) {
    const m = E.OLLAMA_MODEL || 'qwen2.5:1.5b';
    const r = await http(`${E.OLLAMA_URL || 'http://localhost:11434'}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: m, stream: false, format: 'json', options: { num_ctx: 4096, temperature: 0.5 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    }, { tries: 1, timeout: 600000 });
    used.add(`ollama/${m}`);
    return (await r.json()).message.content;
  }
};

// Order = preference. Add keys for more than one to get automatic fallback.
const PROVIDERS = [gemini, groq, openrouter, ollama].filter((p) => p.enabled);

function extractJSON(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object found');
  return JSON.parse(t.slice(a, b + 1));
}

async function askJSON({ system, user, validate, mock }) {
  if (MOCK) return validate(mock());
  if (!PROVIDERS.length) throw new Error('No provider configured. Set GEMINI_API_KEY (or GROQ_API_KEY / OPENROUTER_API_KEY / USE_OLLAMA=1).');
  let note = '', lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const p of PROVIDERS) {
      if (timeLeft() < 0) throw new Error('time budget exhausted');
      try {
        const text = await p.call(system, user + note);
        await sleep(DELAY);
        return validate(extractJSON(text));
      } catch (e) { lastErr = e; log(`${p.name} attempt ${attempt + 1}: ${String(e.message).slice(0, 140)}`); await sleep(/429|RESOURCE_EXHAUSTED|503|UNAVAILABLE/.test(String(e.message)) ? 20000 : DELAY); }
    }
    note = `\n\nYour previous reply was rejected: ${String(lastErr.message).slice(0, 200)}. Return ONLY one valid JSON object that follows the schema exactly.`;
  }
  throw lastErr;
}

// ---------- Validation ----------
const str = (v, min, name, max = 4000) => {
  if (typeof v !== 'string' || v.trim().length < min) throw new Error(`"${name}" missing or too short`);
  return v.trim().slice(0, max);
};
const hex = (h) => {
  if (typeof h !== 'string') throw new Error('bad hex');
  let x = h.trim();
  if (/^#[0-9a-f]{3}$/i.test(x)) x = '#' + [...x.slice(1)].map((c) => c + c).join('');
  if (!/^#[0-9a-f]{6}$/i.test(x)) throw new Error(`bad hex ${h}`);
  return x.toUpperCase();
};

function validateLesson(l, sources) {
  const ids = new Set(sources.map((s) => s.id));
  const evidence = (Array.isArray(l.evidence) ? l.evidence : []).map((e) => {
    let label = LABELS.includes(e?.label) ? e.label : 'unverified';
    const source = ids.has(e?.source) ? e.source : null;
    if (label === 'established' && !source) label = 'unverified';
    return { claim: str(e?.claim, 8, 'evidence.claim', 400), label, source };
  }).slice(0, 8);
  if (!evidence.length) throw new Error('"evidence" needs at least one item');
  const quiz = (Array.isArray(l.quiz) ? l.quiz : []).map((q) => {
    const options = (q.options || []).map(String);
    if (options.length !== 4 || new Set(options).size !== 4) throw new Error('quiz options must be 4 distinct strings');
    const answer = Number(q.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) throw new Error('quiz answer must be 0-3');
    return { q: str(q.q, 8, 'quiz.q', 300), options, answer, explanation: str(q.explanation, 8, 'quiz.explanation', 500) };
  }).slice(0, 3);
  if (!quiz.length) throw new Error('"quiz" needs at least one question');
  return {
    title: str(l.title, 3, 'title', 140), hook: str(l.hook, 10, 'hook', 400), core: str(l.core, 150, 'core', 5000),
    context: str(l.context, 30, 'context', 2500), evidence,
    visual: typeof l.visual === 'string' ? l.visual.slice(0, 1200) : '',
    realWorld: str(l.realWorld, 20, 'realWorld', 1500),
    exercise: { prompt: str(l.exercise?.prompt, 15, 'exercise.prompt', 900), answerHint: typeof l.exercise?.answerHint === 'string' ? l.exercise.answerHint.slice(0, 700) : '' },
    quiz,
    checklist: Array.isArray(l.checklist) ? l.checklist.map(String).slice(0, 8) : [],
    furtherQuestions: Array.isArray(l.furtherQuestions) ? l.furtherQuestions.map(String).slice(0, 4) : [],
    imagePrompt: str(l.imagePrompt, 15, 'imagePrompt', 300).replace(/[\u0000-\u001f]/g, ' '),
    keyIdea: typeof l.keyIdea === 'string' ? l.keyIdea.trim().slice(0, 300) : '',
    glossary: (Array.isArray(l.glossary) ? l.glossary : [])
      .map((g) => ({ term: String(g?.term || '').trim().slice(0, 60), definition: String(g?.definition || '').trim().slice(0, 240) }))
      .filter((g) => g.term.length > 1 && g.definition.length > 8 && String(l.core).toLowerCase().includes(g.term.toLowerCase()))   // a term must really appear in the text
      .slice(0, 6)
  };
}

// ---------- Prompts ----------
const SYSTEM = `You write lessons for "The Curiosity Atelier", a personal learning magazine for a curious beginner (first-year computing student): warm, direct, no fluff, no hype.
HARD RULES
1. Output ONLY one JSON object. No markdown fences, no commentary.
2. Factual claims about people, dates, texts, products or research must come from the SOURCES provided. Cite them by id ("S1", "S2"...).
3. Never invent quotes, citations, URLs, dates, statistics or prices. If sources do not support something, either leave it out or label it "background".
4. Explain jargon. State prerequisites. Prefer one concrete example over three abstract ones.
5. Evidence labels: "established" (directly supported by a given source), "inference" (reasonable reconstruction), "debate" (credible interpretations differ), "tradition" (limited or uncertain basis), "background" (general knowledge, not from a source).
6. Text formatting inside text fields: **bold** marks a key term the first time it appears; *italics* mark titles, foreign words and gentle emphasis. Use nothing else: no headings, no lists, no other markdown.`;

const SCHEMA = `{
 "title": "short lesson title",
 "hook": "1-2 sentences: why this is worth attention",
 "core": "150-260 words of explanation, paragraphs separated by blank lines, **bold** allowed",
 "context": "history, practical setting or prerequisites (60-120 words)",
 "evidence": [{"claim":"one specific claim","label":"established|inference|debate|tradition|background","source":"S1 or null"}],
 "visual": "small ASCII diagram, labelled steps, or empty string",
 "realWorld": "how this appears outside the lesson (40-90 words)",
 "exercise": {"prompt":"a beginner-sized task using free tools","answerHint":"how to check the result"},
 "quiz": [{"q":"question","options":["a","b","c","d"],"answer":0,"explanation":"why"}],
 "checklist": ["optional short items, used for buying/decision checklists"],
 "furtherQuestions": ["two good next questions"],
 "keyIdea": "ONE sentence (max 30 words) that captures the single most important idea of the lesson",
 "glossary": [{"term":"a term that appears VERBATIM in core","definition":"plain-English definition, max 25 words"}],
 "imagePrompt": "ONE concrete scene to photograph for this lesson: objects, places, textures or materials (15-35 words). Never real people or faces, never text, letters or diagrams."
}
Give 3-6 evidence items, exactly 2 quiz questions with 4 distinct options each, and 3-5 glossary terms.`;

const srcBlock = (sources) => sources.map((s) => `[${s.id}] ${s.title} (${s.url})\n${s.text || s.summary || ''}`).join('\n\n');

function mockLesson(label, sources) {
  const s = sources[0]?.id || null;
  return {
    title: `Mock lesson: ${label}`, hook: 'This is mock content used only for testing the pipeline.',
    core: '**Lorem ipsum** dolor sit amet, consectetur adipiscing *elit*. '.repeat(6) + '\n\n' + 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(3),
    context: 'Mock context paragraph for pipeline testing, nothing here is real information.',
    evidence: [{ claim: 'Mock claim supported by the first source.', label: 'established', source: s }, { claim: 'Mock debated claim for UI testing.', label: 'debate', source: null }],
    visual: '[A] --> [B] --> [C]', realWorld: 'Mock real-world connection used to test layout and spacing.',
    exercise: { prompt: 'Mock exercise: write two sentences explaining the topic.', answerHint: 'Compare with the core text.' },
    quiz: [0, 1].map((i) => ({ q: `Mock question ${i + 1} about ${label}?`, options: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer: i, explanation: 'Mock explanation.' })),
    checklist: ['Mock checklist item one', 'Mock checklist item two'], furtherQuestions: ['What would you ask next?', 'Where could you test this?'],
    imagePrompt: `Still life of objects that represent ${label} on a textured backdrop in soft light`,
    keyIdea: 'This is a mock key idea sentence used only to test the pull-quote layout.',
    glossary: [{ term: 'consectetur', definition: 'A mock glossary term used to test the definition popover.' }, { term: 'Sed do eiusmod', definition: 'Another mock term, shown on the flip card.' }]
  };
}

// ---------- Images (Cloudflare Workers AI, FLUX.1 schnell, free daily allowance) ----------
const CF_ID = E.CLOUDFLARE_ACCOUNT_ID, CF_TOKEN = E.CLOUDFLARE_API_TOKEN;
const CF_BASE = E.CF_BASE || 'https://api.cloudflare.com';
const CF_MODEL = E.CF_IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell';
const IMAGES_ON = MOCK || (!!CF_ID && !!CF_TOKEN && E.NO_IMAGES !== '1');
const IMG_CREDIT = 'AI-generated illustration (FLUX.1 schnell, Cloudflare Workers AI). Not a photograph of the real subject.';
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { /* optional: raw output is stored if sharp is absent */ }

// Every image is graded in code so the set looks like one family: 16:10 crop, darker, slightly desaturated,
// tinted toward the house palette (multiply + soft-light) and vignetted. Film grain is NOT baked in (the app adds it with CSS, which keeps files small).
async function gradeImage(buf, tint) {
  if (!sharp) return buf;
  if (E.GRADE === '0') return sharp(buf).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  const W = 1024, Hh = 640, hex = /^#[0-9a-f]{6}$/i.test(tint || '') ? tint : '#275075';
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lift = rgb.map((v) => Math.round(v + (255 - v) * 0.4));          // a lightened tint, multiplied in: shadows go to black, mid-tones take the house colour
  const solid = (c, alpha) => ({ create: { width: W, height: Hh, channels: 4, background: { r: c[0], g: c[1], b: c[2], alpha } } });
  const base = await sharp(buf).resize(W, Hh, { fit: 'cover', position: 'attention' }).modulate({ brightness: 0.8, saturation: 0.6 }).linear(1.12, -8).toBuffer();
  const vignette = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}"><defs><radialGradient id="v" cx="50%" cy="48%" r="75%"><stop offset="40%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".75"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`);
  return sharp(base).composite([{ input: solid(lift, 0.7), blend: 'multiply' }, { input: solid(rgb, 0.25), blend: 'soft-light' }, { input: vignette }]).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
}

async function makeImage(slug, key, scene, style, alt, tint) {
  if (!IMAGES_ON) return null;
  const dir = path.join(DATA, 'img', slug);
  await fs.mkdir(dir, { recursive: true });
  try {
    if (MOCK) {
      const hue = [...key].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><defs><radialGradient id="g" cx="30%" cy="30%"><stop offset="0" stop-color="hsl(${hue},60%,65%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},50%,25%)"/></radialGradient></defs><rect width="800" height="800" fill="url(#g)"/></svg>`;
      await fs.writeFile(path.join(dir, `${key}.svg`), svg);
      return { src: `data/img/${slug}/${key}.svg`, alt, prompt: scene, credit: IMG_CREDIT, aiGenerated: true };
    }
    const prompt = `${scene}. Style: ${style}. ${cfg.imageBase}. ${cfg.imageSuffix}`.slice(0, 900);
    const r = await http(`${CF_BASE}/client/v4/accounts/${CF_ID}/ai/run/${CF_MODEL}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${CF_TOKEN}` },
      body: JSON.stringify({ prompt, steps: Number(E.FLUX_STEPS || 4) })
    }, { tries: 2, timeout: 120000 });
    const j = await r.json();
    const b64 = j?.result?.image;
    if (!b64) throw new Error('no image in response');
    let buf = Buffer.from(b64, 'base64');
    buf = await gradeImage(buf, tint);
    await fs.writeFile(path.join(dir, `${key}.jpg`), buf);
    await sleep(800);
    return { src: `data/img/${slug}/${key}.jpg`, alt, prompt, credit: IMG_CREDIT, aiGenerated: true };
  } catch (e) { log('image failed', key, String(e.message).slice(0, 120)); return null; }
}

// Used by generator/preview-image.mjs: render a single image into preview/ so you can judge the look before a full run.
export async function previewImage(houseKey, scene) {
  const house = cfg.houses[houseKey]; if (!house) throw new Error(`Unknown house "${houseKey}". Use one of: ${Object.keys(cfg.houses).join(', ')}`);
  if (!(CF_ID && CF_TOKEN)) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN first.');
  const r = await makeImage('_preview', houseKey, scene, house.imageStyle, 'preview', house.imageTint);
  if (!r) throw new Error('Image generation failed (see the message above).');
  const dest = path.join(ROOT, 'preview'); await fs.mkdir(dest, { recursive: true });
  const out = path.join(dest, `${houseKey}.jpg`); await fs.copyFile(path.join(ROOT, r.src), out); await fs.rm(path.join(DATA, 'img', '_preview'), { recursive: true, force: true });
  return out;
}

async function pruneImages(index) {
  const keep = new Set(index.editions.slice(0, Number(E.IMG_KEEP || 40)).map((e) => e.slug));
  try {
    for (const d of await fs.readdir(path.join(DATA, 'img'))) if (!keep.has(d)) { await fs.rm(path.join(DATA, 'img', d), { recursive: true, force: true }); log('pruned images of edition', d); }
  } catch { /* no img dir yet */ }
}

// ---------- Section builders ----------
async function gather(house, topic, n) {
  const jobs = [];
  if (topic.bible) jobs.push(bible(topic.bible));
  for (const w of topic.wiki || []) jobs.push(wiki(w));
  const res = await Promise.allSettled(jobs);
  const now = new Date().toISOString().slice(0, 10);
  const sources = res.filter((r) => r.status === 'fulfilled').map((r) => ({ ...r.value, retrievedAt: now }));
  if (house.feeds && cfg.feeds[house.feeds]) {
    const items = (await feedItems(cfg.feeds[house.feeds])).slice(0, 4);
    for (const it of items) sources.push({ title: `${it.feed}: ${it.title}`, url: it.url, kind: 'feed', text: it.summary, date: it.date, retrievedAt: now });
  }
  sources.forEach((s, i) => { s.id = `S${i + 1}`; });
  return sources;
}

async function buildLesson(key, n, slug) {
  const house = cfg.houses[key];
  const topic = house.topics[(n - 1) % house.topics.length];
  const sources = MOCK ? [] : await gather(house, topic, n);
  const grounded = sources.length > 0;
  const user = `HOUSE: ${house.name}
TOPIC: ${topic.label}
BRIEF: ${house.brief}
${grounded ? 'SOURCES:\n' + srcBlock(sources) : 'SOURCES: none could be fetched this time. Mark every claim "background" or "unverified" and say in the context field that this lesson is not source-grounded.'}

Return JSON matching this schema:
${SCHEMA}`;
  const lesson = await askJSON({ system: SYSTEM, user, validate: (j) => validateLesson(j, sources), mock: () => mockLesson(topic.label, sources.length ? sources : [{ id: 'S1' }]) });
  const image = await makeImage(slug, key, lesson.imagePrompt, house.imageStyle, `Illustration for: ${lesson.title}`, house.imageTint);
  return { house: key, houseName: house.name, topic: topic.label, ...lesson, image, grounded, aiGenerated: true, status: 'unreviewed',
    sources: sources.map(({ id, title, url, kind, retrievedAt, date }) => ({ id, title, url, kind, retrievedAt, ...(date ? { date } : {}) })) };
}

// colour maths (accessibility is computed, never trusted from the model)
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function accessibility(hexes) {
  let best = { r: 0 };
  for (let i = 0; i < hexes.length; i++) for (let j = i + 1; j < hexes.length; j++) { const r = contrast(hexes[i], hexes[j]); if (r > best.r) best = { r, a: hexes[i], b: hexes[j] }; }
  const lvl = best.r >= 7 ? 'AAA' : best.r >= 4.5 ? 'AA' : best.r >= 3 ? 'AA for large text only' : 'fails WCAG for text';
  return `Strongest pair: ${best.a} with ${best.b}, contrast ${best.r.toFixed(2)}:1 (${lvl}). Computed by code.`;
}

async function buildCapsule(n) {
  const w = cfg.words[(n - 1) % cfg.words.length];
  let dict = null;
  if (!MOCK) { try { dict = await dictionary(w); } catch { /* model fills in */ } }
  const user = `Create the "Daily Capsule" extras for Edition ${n}.
WORD: ${w}
${dict ? `DICTIONARY DATA (trusted): part of speech "${dict.pos}", definition "${dict.definition}".` : 'No dictionary data was available: provide a plain definition yourself.'}
Return JSON:
{
 "word": {"definition":"plain-English definition","example":"an original example sentence using the word","exercise":"a tiny task: use the word in your own sentence about X"},
 "colour": {"name":"palette name","hexes":["#RRGGBB","#RRGGBB","#RRGGBB"],"note":"why these work together (30-50 words)","application":"where to use this palette, concretely"},
 "type": {"font":"ONE real Google Fonts family name","character":"what it feels like and why","bestUses":"where it works and where it does not"},
 "interfaceStudy": {"pattern":"a UI pattern or style name","reasoning":"why designers use it (40-70 words)","tryIt":"a 10-minute exercise"},
 "challenge": "one tiny challenge that makes the learner use something from today"
}`;
  const j = await askJSON({
    system: SYSTEM.split('HARD RULES')[0] + 'Output ONLY one JSON object. Do not invent facts.', user,
    validate: (j) => {
      const hexes = (j.colour?.hexes || []).map(hex);
      if (hexes.length !== 3) throw new Error('colour.hexes must have 3 colours');
      return {
        word: { definition: dict?.definition || str(j.word?.definition, 8, 'word.definition', 400), example: dict?.example || str(j.word?.example, 8, 'word.example', 300), exercise: str(j.word?.exercise, 8, 'word.exercise', 300) },
        colour: { name: str(j.colour?.name, 2, 'colour.name', 60), hexes, note: str(j.colour?.note, 10, 'colour.note', 400), application: str(j.colour?.application, 10, 'colour.application', 300), accessibility: accessibility(hexes) },
        type: { font: str(j.type?.font, 2, 'type.font', 60), character: str(j.type?.character, 10, 'type.character', 400), bestUses: str(j.type?.bestUses, 10, 'type.bestUses', 400) },
        interfaceStudy: { pattern: str(j.interfaceStudy?.pattern, 3, 'interfaceStudy.pattern', 100), reasoning: str(j.interfaceStudy?.reasoning, 20, 'interfaceStudy.reasoning', 600), tryIt: str(j.interfaceStudy?.tryIt, 10, 'interfaceStudy.tryIt', 400) },
        challenge: str(j.challenge, 10, 'challenge', 400)
      };
    },
    mock: () => ({ word: { definition: 'Mock definition of the word.', example: 'A mock example sentence.', exercise: 'Use it in a sentence.' }, colour: { name: 'Mock Dusk', hexes: ['#762E3A', '#F0E6D5', '#376C66'], note: 'Mock note about the palette used for pipeline testing only.', application: 'Mock application text.' }, type: { font: 'Lora', character: 'A mock description of a serif typeface.', bestUses: 'Mock best uses text.' }, interfaceStudy: { pattern: 'Card grid', reasoning: 'Mock reasoning about card grids used for testing layout only.', tryIt: 'Mock ten-minute exercise.' }, challenge: 'Mock challenge for testing the layout.' })
  });
  const font = j.type.font;
  return {
    word: { word: w, phonetic: dict?.phonetic || '', pos: dict?.pos || '', ...j.word, dictionary: !!dict, aiGenerated: !dict },
    colour: { ...j.colour, aiGenerated: true },
    type: { ...j.type, url: `https://fonts.google.com/specimen/${encodeURIComponent(font).replace(/%20/g, '+')}`, note: 'Google Fonts families are open-licensed; confirm on the specimen page.', aiGenerated: true },
    interfaceStudy: { ...j.interfaceStudy, aiGenerated: true }, challenge: j.challenge
  };
}

async function buildSignal() {
  if (MOCK) return { title: 'Mock research story', url: 'https://example.com', date: '2026-01-01', kind: 'research', whatHappened: 'Mock text.', whyItMatters: 'Mock text.', takeaway: 'Mock text.', feed: 'mock' };
  const items = (await feedItems(cfg.feeds.ai)).slice(0, 12);
  if (!items.length) throw new Error('no AI feed items reachable');
  const list = items.map((it, i) => `[${i}] (${it.feed}, ${it.date}) ${it.title}\n${it.summary}`).join('\n\n');
  const user = `Pick the ONE item most useful for a first-year student to understand, and explain it using only its title and summary.
ITEMS:
${list}

Return JSON: {"pick": <item number>, "kind": "research|product|benchmark|marketing", "whatHappened":"2 sentences","whyItMatters":"2 sentences","takeaway":"one thing a first-year student should learn from it"}
Be explicit about uncertainty: you only have a short summary.`;
  const j = await askJSON({
    system: SYSTEM.split('HARD RULES')[0] + 'Output ONLY one JSON object. Do not invent facts.', user,
    validate: (j) => {
      const it = items[Number(j.pick)];
      if (!it) throw new Error('pick must be a valid item number');
      return { title: it.title, url: it.url, date: it.date, feed: it.feed, kind: ['research', 'product', 'benchmark', 'marketing'].includes(j.kind) ? j.kind : 'research', whatHappened: str(j.whatHappened, 20, 'whatHappened', 600), whyItMatters: str(j.whyItMatters, 20, 'whyItMatters', 600), takeaway: str(j.takeaway, 10, 'takeaway', 400) };
    }, mock: () => ({ pick: 0, kind: 'research' })
  });
  return j;
}

async function buildOpenTab(n) {
  const url = cfg.openTabs[(n - 1) % cfg.openTabs.length];
  if (MOCK) return { url, name: 'Mock site', what: 'Mock description.', whyBookmark: 'Mock reason.', verified: false };
  let title = url, desc = '';
  const r = await http(url, {}, { tries: 2, timeout: 15000, quiet: true });   // throws if the site is down
  const html = (await r.text()).slice(0, 60000);
  title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, url])[1]).slice(0, 120);
  desc = decode((html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) || [, ''])[1]).slice(0, 400);
  const user = `Write a short "Open Tab" card about a free learning website using ONLY this page data.
URL: ${url}
PAGE TITLE: ${title}
PAGE DESCRIPTION: ${desc || '(none)'}
Return JSON: {"what":"what it is, 1-2 sentences","whyBookmark":"the specific reason a beginner should bookmark it, 1-2 sentences"}`;
  const j = await askJSON({ system: SYSTEM.split('HARD RULES')[0] + 'Output ONLY one JSON object. Do not invent facts.', user, validate: (j) => ({ what: str(j.what, 10, 'what', 400), whyBookmark: str(j.whyBookmark, 10, 'whyBookmark', 400) }), mock: () => ({}) });
  return { url, name: title, ...j, verified: true, checkedAt: new Date().toISOString().slice(0, 10) };
}

// ---------- Puzzles (generated by code, so answers are always correct) ----------
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function makePuzzle(n) {
  const R = rng(n * 7919), ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const kind = ['sequence', 'cipher', 'latin'][(n - 1) % 3];
  if (kind === 'sequence') {
    const t = ri(0, 3); let seq = [], rule = '';
    if (t === 0) { const a = ri(2, 9), d = ri(3, 9); seq = [0, 1, 2, 3, 4, 5].map((i) => a + i * d); rule = `add ${d} each time`; }
    if (t === 1) { const a = ri(1, 4), r = ri(2, 3); seq = [0, 1, 2, 3, 4, 5].map((i) => a * r ** i); rule = `multiply by ${r} each time`; }
    if (t === 2) { const o = ri(1, 4); seq = [0, 1, 2, 3, 4, 5].map((i) => (i + o) ** 2); rule = 'these are consecutive square numbers'; }
    if (t === 3) { const a = ri(1, 4), b = ri(2, 6); seq = [a, b]; while (seq.length < 6) seq.push(seq[seq.length - 1] + seq[seq.length - 2]); rule = 'each number is the sum of the two before it'; }
    const answer = seq[5];
    return { type: 'sequence', title: 'Logic day: what comes next?', prompt: `${seq.slice(0, 5).join(', ')}, ?`, answer: String(answer), explanation: `The rule: ${rule}.` };
  }
  if (kind === 'cipher') {
    const w = cfg.words[ri(0, cfg.words.length - 1)], k = ri(2, 12);
    const enc = [...w].map((c) => String.fromCharCode(((c.charCodeAt(0) - 97 + k) % 26) + 97)).join('');
    return { type: 'cipher', title: 'Language day: crack the cipher', prompt: `Each letter was moved ${k} places forward in the alphabet. Decode: ${enc.toUpperCase()}`, answer: w, explanation: `Shift every letter back by ${k}. The word is "${w}".` };
  }
  const base = [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]];
  const rows = [0, 1, 2, 3].sort(() => R() - 0.5), perm = [1, 2, 3, 4].sort(() => R() - 0.5);
  const sol = rows.map((r) => base[r].map((v) => perm[v - 1]));
  const grid = sol.map((r) => [...r]);
  const cells = [...Array(16).keys()].sort(() => R() - 0.5).slice(0, 8);
  cells.forEach((c) => { grid[Math.floor(c / 4)][c % 4] = 0; });
  return { type: 'latin', title: 'Logic day: mini sudoku', prompt: 'Fill the 4x4 grid so every row and every column contains 1, 2, 3 and 4 exactly once.', grid, solution: sol, explanation: 'Start with the row or column that has the most numbers filled in.' };
}

// ---------- Dispatch (derived from the lessons, no extra model call) ----------
const firstSentence = (t) => (t.replace(/\*\*/g, '').match(/^.*?[.!?](\s|$)/) || [t.slice(0, 160)])[0].trim();
function makeDispatch(houses, capsule, signal, puzzle) {
  const items = [...HOUSES, 'frugal'].map((k) => houses[k]).filter((h) => h && !h.unavailable);
  return {
    headlines: items.map((h) => ({ house: h.house, text: h.title })),
    briefing: items.map((h) => ({ house: h.house, title: h.title, text: `${h.hook} ${firstSentence(h.core)}`, sources: h.sources.slice(0, 2).map((s) => s.url) })),
    plus: [`Word: ${capsule?.word?.word || '-'}`, `Puzzle: ${puzzle.title}`, signal ? `AI/ML signal: ${signal.title}` : null].filter(Boolean)
  };
}

// ---------- Main ----------
async function main() {
  await fs.mkdir(path.join(DATA, 'editions'), { recursive: true });
  const idxPath = path.join(DATA, 'index.json');
  const index = await readJSON(idxPath, { editions: [] });
  const last = index.editions[0];
  if (last && !FORCE && Date.now() - Date.parse(last.publishedAt) < MIN_HOURS * 3600e3) {
    log(`Edition ${last.slug} is only ${((Date.now() - Date.parse(last.publishedAt)) / 3600e3).toFixed(1)}h old. Nothing to do.`);
    return;
  }
  const n = (last?.n || 0) + 1, slug = String(n).padStart(3, '0');
  log(`Generating edition ${slug} with: ${MOCK ? 'MOCK' : PROVIDERS.map((p) => p.name).join(' > ') || 'NO PROVIDER'}`);
  const step = async (name, fn) => { try { const v = await fn(); log('ok  ', name); return v; } catch (e) { log('FAIL', name, '-', String(e.message).slice(0, 160)); return null; } };
  const jobs = [['capsule', () => buildCapsule(n)], ['aiSignal', buildSignal], ['openTab', () => buildOpenTab(n)],
    ...[...HOUSES, 'frugal'].map((k) => [`house:${k}`, () => buildLesson(k, n, slug)])];
  const got = {};
  for (let pass = 1; pass <= 2; pass++) {
    const todo = jobs.filter(([name]) => !got[name]);
    if (!todo.length) break;
    if (pass === 2) { if (timeLeft() < 120000) break; log(`Retrying ${todo.length} failed section(s) after a pause`); await sleep(MOCK ? 0 : Number(E.RETRY_PAUSE_MS ?? 45000)); }
    for (const [name, fn] of todo) {
      if (timeLeft() < 0) { log('SKIP', name, '- time budget used up'); continue; }
      got[name] = await step(name, fn);
    }
  }
  const failed = jobs.map(([name]) => name).filter((name) => !got[name]);
  const capsuleExtras = got.capsule, signal = got.aiSignal, openTab = got.openTab;
  const houses = {};
  for (const k of [...HOUSES, 'frugal']) houses[k] = got[`house:${k}`] || { house: k, houseName: cfg.houses[k].name, unavailable: true, title: 'Not available this edition', sources: [] };
  const puzzle = makePuzzle(n);

  const total = 3 + HOUSES.length + 1;
  if (failed.length > total / 2) throw new Error(`Too many failures (${failed.join(', ')}). Edition not published.`);

  const cover = await makeImage(slug, 'cover', cfg.cover.prompt, cfg.cover.style, 'Cover illustration', cfg.cover.tint);
  const capsule = capsuleExtras ? { ...capsuleExtras, aiSignal: signal, openTab } : { aiSignal: signal, openTab };
  const edition = {
    n, slug, publishedAt: new Date().toISOString(),
    theme: HOUSES.map((k) => houses[k].topic).filter(Boolean).slice(0, 3).join(' · '),
    generator: { providers: MOCK ? ['mock'] : [...used], failed },
    cover, capsule, houses, puzzle, dispatch: makeDispatch(houses, capsuleExtras, signal, puzzle)
  };
  await fs.writeFile(path.join(DATA, 'editions', `${slug}.json`), JSON.stringify(edition, null, 1));
  index.editions.unshift({ n, slug, publishedAt: edition.publishedAt, theme: edition.theme, failed, cover: cover?.src || null });
  await fs.writeFile(idxPath, JSON.stringify(index, null, 1));
  await pruneImages(index);
  log(`Published edition ${slug}${failed.length ? ` (missing: ${failed.join(', ')})` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('[atelier] FATAL', e.message); process.exit(1); });
}
