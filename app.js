// The Curiosity Atelier front end v2: no build step, no dependencies.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// text markup from the writer model: **bold** = key term, *italic* = titles / emphasis. Everything else is escaped.
const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*(?!\s)([^*]+?)(?<!\s)\*(?![*\w])/g, '$1<em>$2</em>');
const md = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${inline(p).replace(/\n/g, '<br>')}</p>`).join('');
const url = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const imgSrc = (u) => (/^data\/img\/[\w./-]+$/.test(u || '') ? esc(u) : '');
const fdate = (d) => { const t = new Date(d); return isNaN(t) ? esc(d || '') : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
const colour = (h) => (/^#[0-9a-f]{6}$/i.test(h || '') ? h : '#444');
const firstSentence = (t) => (String(t).replace(/\*/g, '').match(/^.*?[.!?](\s|$)/) || [String(t).slice(0, 180)])[0].trim();

// key, numeral, name, theme, hero layout
const HOUSES = [
  ['theology', 'I', 'Theology', 'oxblood', 'center'], ['mindcraft', 'II', 'Mindcraft', 'sky', 'center'], ['soundroom', 'III', 'Soundroom', 'crimson', 'center'],
  ['aiml', 'IV', 'AI/ML Fieldnotes', 'neon', 'center'], ['systems', 'V', 'Systems Forge', 'blue', 'center'], ['design', 'VI', 'Design Observatory', 'green', 'center'], ['frugal', '✦', 'Frugal Chic', 'tan', 'center']
];
const H = Object.fromEntries(HOUSES.map((h) => [h[0], { num: h[1], name: h[2], t: h[3], layout: h[4] }]));
const KEYS = ['capsule', ...HOUSES.map((h) => h[0]), 'puzzle'];
const LABEL = { established: '✓ established', inference: '~ inference', debate: '⇄ debate', tradition: '❝ tradition', background: '· background', unverified: '? unverified' };

const burst = (n = 34) => `<svg class="burst" width="${n}" height="${n}" viewBox="0 0 100 100" aria-hidden="true">${[...Array(12).keys()].map((i) => `<rect x="43" y="2" width="14" height="40" rx="3" transform="rotate(${i * 30} 50 50)"/>`).join('')}</svg>`;
const arrow = '<svg class="arrow" viewBox="0 0 60 12" aria-hidden="true"><path d="M0 6h57M51 1l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
// image box: generated art sits underneath, so a missing or pruned photo degrades to art, never to a broken icon
const imgBox = (img, cls = '', cap = true) => `<figure class="imgbox ${cls}"><div class="art"></div>${imgSrc(img?.src) ? `<img src="${imgSrc(img.src)}" alt="${esc(img.alt || '')}" loading="lazy" decoding="async"><i class="tint"></i>` : ''}${img && cap ? `<figcaption title="${esc(img.credit || '')}">AI illustration</figcaption>` : ''}</figure>`;

// ---------- storage (IndexedDB, with in-memory fallback) ----------
let memDB = {};
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('atelier', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function kvGet(k) { try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return memDB[k]; } }
async function kvSet(k, v) { try { const db = await idb(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch { memDB[k] = v; } }

let S = { progress: {}, bookmarks: [], notes: {}, wrong: [], board: { cards: [], links: [] }, cur: null, prefs: { size: 1, focus: false } };
let timer;
const save = () => { clearTimeout(timer); timer = setTimeout(() => kvSet('state', S), 250); };

// ---------- data ----------
let INDEX = { editions: [] };
const CACHE = {};
let GL = [];                       // glossary of the lesson on screen
async function edition(slug) {
  if (CACHE[slug]) return CACHE[slug];
  const r = await fetch(`data/editions/${slug}.json`);
  if (!r.ok) throw new Error('edition not found');
  return (CACHE[slug] = await r.json());
}
const prog = (slug) => (S.progress[slug] ||= { seen: {}, quiz: {} });
const seen = (slug, key) => { const p = prog(slug); if (!p.seen[key]) { p.seen[key] = true; save(); } };
const seenCount = (slug) => KEYS.filter((k) => prog(slug).seen[k]).length;

// ---------- small interactive helpers ----------
function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 1900); }
// wrap the first occurrence of each glossary term (in text nodes only) with a tap-to-define button
function linkGlossary(html, gl) {
  let out = html;
  (gl || []).forEach((g, i) => {
    const re = new RegExp('(^|[^\\w])(' + esc(g.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\w])', 'i');
    let hit = false, inGl = false;
    out = out.split(/(<[^>]+>)/).map((part) => {
      if (part.startsWith('<')) { if (part.startsWith('<button class="gl"')) inGl = true; else if (part === '</button>') inGl = false; return part; }
      if (hit || inGl || !re.test(part)) return part;
      hit = true;
      return part.replace(re, (m, a, b) => `${a}<button class="gl" data-act="gl" data-i="${i}">${b}</button>`);
    }).join('');
  });
  return out;
}
function showPop(btn, g) {
  const pop = $('#pop'); if (!pop) return;
  pop.innerHTML = `<b>${esc(g.term)}</b>${esc(g.definition)}`; pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.top = `${r.bottom + scrollY + 8}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left + scrollX, innerWidth - pop.offsetWidth - 12))}px`;
  const lesson = btn.closest('[data-t]'); if (lesson) { pop.style.setProperty('--panel', getComputedStyle(lesson).getPropertyValue('--bg')); pop.style.setProperty('--panel-fg', getComputedStyle(lesson).getPropertyValue('--text')); }
}
const hidePop = () => { const p = $('#pop'); if (p) p.hidden = true; };

// ---------- shared pieces ----------
const sec = (id, num, title, inner, alt) => `<section class="sec ${alt ? 'alt' : ''}" id="${id}" data-sec="${id}"><div class="wrap rv"><div class="sh"><span class="num">${String(num).padStart(2, '0')}</span>${title ? `<h2 class="display">${title}</h2>` : ''}</div>${inner}</div></section>`;
const kicker = (m, ed) => `<div class="kicker">${burst(16)}<span>House ${m.num}</span><i>·</i><span>${esc(m.name)}</span><i>·</i><span>Edition ${esc(ed.slug)}</span></div>`;

function hero(ed, key, h, stats) {
  const m = H[key], len = h.title.length;
  const text = `<div class="hero-t">${kicker(m, ed)}<h1 class="display ${len > 60 ? 'xlong' : len > 34 ? 'long' : ''}" style="margin-top:1rem">${esc(h.title)}</h1><span class="script">${esc(h.topic)}</span><p class="sub">${esc(h.hook)}</p><div class="row"><a class="btn solid" href="#read" data-act="jump" data-to="read">Read the lesson ${arrow}</a><span class="meta">${stats}</span></div></div>`;
  return m.layout === 'split'
    ? `<header class="hero split">${text}${imgBox(h.image, '', true)}</header>`
    : `<header class="hero center">${imgBox(h.image, '', true)}${text}</header>`;
}

function lessonHTML(ed, h, key) {
  const m = H[key];
  if (!h || h.unavailable) return `<div data-t="${m.t}"><section class="sec"><div class="wrap"><h1 class="display">${esc(m.name)}</h1><p>This section could not be generated for this edition. It will return in a later one.</p></div></section></div>`;
  GL = h.glossary || [];
  const p = prog(ed.slug), srcs = Object.fromEntries((h.sources || []).map((s) => [s.id, s]));
  const bm = S.bookmarks.some((b) => b.slug === ed.slug && b.key === key);
  const note = S.notes[`${ed.slug}/${key}`] || '';
  const words = `${h.core} ${h.context} ${h.realWorld}`.split(/\s+/).length, mins = Math.max(1, Math.round(words / 200));
  const stats = `${mins} min read · ${(h.sources || []).length} sources · ${h.quiz.length} questions`;
  const secs = [['read', 'Read'], ['context', 'Context'], ...(GL.length ? [['terms', 'Key terms']] : []), ['evidence', 'Evidence'], ['try', 'Try it'], ['recall', 'Recall'], ['sources', 'Sources']];
  const n = (id) => secs.findIndex((s) => s[0] === id) + 1;
  const flags = `<p><span class="badge soft">AI-generated</span><span class="badge soft">${esc(h.status || 'unreviewed')}</span><span class="badge soft">${h.grounded ? 'source-grounded' : 'not source-grounded'}</span></p>`;
  const key1 = h.keyIdea || firstSentence(h.core);
  const labels = [...new Set(h.evidence.map((e) => e.label))];
  const answered = h.quiz.filter((_, qi) => p.quiz[`${key}:${qi}`] !== undefined).length;
  const correct = h.quiz.filter((q, qi) => p.quiz[`${key}:${qi}`] === q.answer).length;
  const score = answered === h.quiz.length ? `<div class="score"><strong>${correct} of ${h.quiz.length} correct</strong><div class="bar"><i style="width:${(correct / h.quiz.length) * 100}%"></i></div><button data-act="retry" data-k="${key}">Try again</button></div>` : `<p class="meta">${answered} of ${h.quiz.length} answered</p>`;
  return `<div data-t="${m.t}" class="lesson" data-title="${esc(h.title)}">${hero(ed, key, h, stats)}
  <nav class="toc" id="toc" aria-label="Lesson sections">${secs.map(([id, t]) => `<a class="chip" href="#${id}" data-act="jump" data-to="${id}">${t}</a>`).join('')}</nav>
  ${sec('read', n('read'), 'Read', `${flags}<blockquote class="pull" style="margin-left:0"><small>The key idea</small>${esc(key1)}</blockquote><div class="prose lede">${linkGlossary(md(h.core), GL)}</div>${h.visual ? `<pre>${esc(h.visual)}</pre>` : ''}`)}
  ${sec('context', n('context'), 'Context', `<div class="cols prose"><div><h3 class="display" style="margin-top:0">The setting</h3>${linkGlossary(md(h.context), GL)}</div><div><h3 class="display" style="margin-top:0">Where you will see it</h3>${md(h.realWorld)}</div></div>`, true)}
  ${GL.length ? sec('terms', n('terms'), 'Key terms', `<p class="meta" style="margin-bottom:1rem">Tap a card to flip it. Underlined words in the text open the same definitions.</p><div class="flips">${GL.map((g) => `<button class="flip" data-act="flip"><small>Term</small><span class="f-front">${esc(g.term)}</span><span class="f-back">${esc(g.definition)}</span></button>`).join('')}</div>`) : ''}
  ${sec('evidence', n('evidence'), 'Evidence', `<div class="chips"><button class="chip on" data-act="ef" data-f="">All <b>${h.evidence.length}</b></button>${labels.map((l) => `<button class="chip" data-act="ef" data-f="${esc(l)}">${esc(LABEL[l] || l)} <b>${h.evidence.filter((e) => e.label === l).length}</b></button>`).join('')}</div><div class="evlist">${h.evidence.map((e) => `<div class="ev" data-l="${esc(e.label)}"><span class="badge">${LABEL[e.label] || esc(e.label)}</span><span>${esc(e.claim)}${e.source && srcs[e.source] ? ` <a href="${url(srcs[e.source].url)}" target="_blank" rel="noopener">[${esc(e.source)}]</a>` : ''}</span></div>`).join('')}</div>`, !GL.length)}
  ${sec('try', n('try'), 'Try it', `<div class="prose"><p>${esc(h.exercise.prompt)}</p></div>${h.exercise.answerHint ? `<details><summary>How to check</summary><p>${esc(h.exercise.answerHint)}</p></details>` : ''}${h.checklist?.length ? `<h3 class="display">Checklist</h3><ul>${h.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}`, GL.length > 0)}
  ${sec('recall', n('recall'), 'Recall', h.quiz.map((q, qi) => { const id = `${key}:${qi}`, pick = p.quiz[id]; return `<div class="quiz"><span class="q">${esc(q.q)}</span>${q.options.map((o, oi) => { const st = pick === undefined ? '' : oi === q.answer ? 'ok' : oi === pick ? 'no' : ''; return `<button class="opt ${st}" data-act="quiz" data-k="${key}" data-q="${qi}" data-o="${oi}" ${pick === undefined ? '' : 'disabled'}>${st === 'ok' ? '✓ ' : st === 'no' ? '✗ ' : ''}${esc(o)}</button>`; }).join('')}${pick === undefined ? '' : `<p class="muted">${esc(q.explanation)}</p>`}</div>`; }).join('') + score + (h.furtherQuestions?.length ? `<h3 class="display">Keep digging</h3><ul>${h.furtherQuestions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''), !GL.length)}
  ${sec('sources', n('sources'), 'Sources & notes', `${(h.sources || []).length ? `<ul>${h.sources.map((s) => `<li>[${esc(s.id)}] <a href="${url(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="muted">retrieved ${esc(s.retrievedAt || '')}</span></li>`).join('')}</ul>` : '<p>No sources were available. Treat everything here as unverified.</p>'}${h.image ? `<p class="muted">Image: ${esc(h.image.credit)}</p>` : ''}<h3 class="display">Your notes</h3><textarea rows="3" data-note="${esc(key)}" placeholder="Your own observations, kept apart from the lesson text">${esc(note)}</textarea><div class="row"><button data-act="bm" data-k="${key}" class="${bm ? 'on' : ''}">${bm ? '★ Bookmarked' : '☆ Bookmark'}</button><button data-act="clip" data-k="${key}">Clip to board</button><a class="btn" href="#/houses">All houses</a></div>`, GL.length > 0)}
  <div class="tools" role="toolbar" aria-label="Reading tools"><button data-act="size-" title="Smaller text">A−</button><button data-act="size+" title="Larger text">A+</button><button data-act="focus" class="${S.prefs.focus ? 'on' : ''}" title="Focus mode">${S.prefs.focus ? 'Exit focus' : 'Focus'}</button><button data-act="top" title="Back to top">↑</button></div>
  </div>`;
}

const tile = (ed, k) => { const m = H[k], h = ed.houses?.[k]; return `<a class="tile rv" data-t="${m.t}" href="#/house/${k}">${imgBox(h?.image, '', false)}${prog(ed.slug).seen[k] ? '<span class="tick">Explored</span>' : ''}<div class="tile-t"><div class="kicker">${burst(14)}<span>House ${m.num}</span></div><h3 class="display" style="margin-top:.5rem">${esc(m.name)}</h3><p>${esc(h?.unavailable ? 'Not available this edition' : h?.title || '')}</p></div></a>`; };
const tiles = (ed) => `<div class="tiles">${HOUSES.map((h) => tile(ed, h[0])).join('')}</div>`;

// ---------- daily capsule: a personal-dashboard bento; every tile is a link to its own full page ----------
const hexLum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const hexInk = (h) => (hexLum(h) > 0.42 ? '#000' : '#fff');
const FONT_OK = /^[A-Za-z0-9][A-Za-z0-9 ]{1,40}$/;
const loadedFonts = new Set();
function loadFont(name) {   // progressive enhancement: show the specimen in its real typeface when online; falls back to Inter Tight offline
  if (!FONT_OK.test(name || '') || loadedFonts.has(name)) return; loadedFonts.add(name);
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + name.trim().replace(/ +/g, '+') + '&display=swap'; document.head.appendChild(l);
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// one muted accent per slot: same saturation and lightness, so many hues still read as one family
const SLOTS = [
  { key: 'word', label: 'Word of the day', tone: 'blue', a: '#8EA2C9' },
  { key: 'signal', label: 'AI/ML signal', tone: 'char', a: '#C2A56B' },
  { key: 'colour', label: 'Colour pairing', tone: 'char', a: '#B88593' },
  { key: 'type', label: 'Type specimen', tone: 'char', a: '#948DBA' },
  { key: 'interface', label: 'Interface study', tone: 'blue', a: '#8EA2C9' },
  { key: 'tab', label: 'The open tab', tone: 'stone', a: '#ADADA3' },
  { key: 'challenge', label: 'Tiny challenge', tone: 'char', a: '#8FA58C' }
];
const slotData = (ed, k) => { const c = ed.capsule || {}; return { word: c.word, signal: c.aiSignal, colour: c.colour, type: c.type, interface: c.interfaceStudy, tab: c.openTab, challenge: c.challenge ? { text: c.challenge } : null }[k] || null; };
const contrastInfo = (col) => { const m = /contrast ([\d.]+):1 \(([^)]*)\)/.exec(col?.accessibility || ''); if (!m) return null; return { ratio: m[1], level: /AAA/.test(m[2]) ? 'AAA' : /large/.test(m[2]) ? 'AA LARGE' : /AA/.test(m[2]) ? 'AA' : 'FAIL' }; };
const fontStyle = (f) => (FONT_OK.test(f || '') ? `font-family:'${esc(f)}','Inter Tight',sans-serif` : '');
const LINE_ART = '<svg class="lart" viewBox="0 0 160 160" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><circle cx="160" cy="160" r="150"/><circle cx="160" cy="160" r="100"/><circle cx="160" cy="160" r="50"/><path d="M160 10L10 160M160 60L60 160M160 110L110 160"/></svg>';
const num2 = (n) => String(n + 1).padStart(2, '0');

function tileHTML(ed, s, i) {
  const d = slotData(ed, s.key), p = prog(ed.slug);
  if (!d) return `<div class="dt ghost" data-k="${s.key}"><span>${esc(s.label)}<br>not available this edition</span></div>`;
  const wrap = (cls, inner) => `<a class="dt ${cls} rv" data-k="${s.key}" href="#/capsule/${s.key}" style="--a:${s.a};--i:${i}" aria-label="Open: ${esc(s.label)}">${inner}</a>`;
  const top = `<div class="dtop"><span class="lab">${s.label}</span><span class="go" aria-hidden="true">↗</span></div>`;
  if (s.key === 'word') { const L = d.word.length; return wrap('blue', `<div>${top}<span class="pill" style="margin-top:.7rem;background:#F6F6F2;color:#2b3a56">${esc(d.pos || 'word')}</span></div><div><div class="big w ${L > 11 ? 'l2' : ''}">${esc(d.word)}</div><div class="rule" style="margin:.7rem 0 .5rem"></div><div class="row2"><span class="den">${esc(d.phonetic || '')}</span><span class="den">/ ${L} LTRS</span></div></div>`); }
  if (s.key === 'signal') return wrap('', `<div>${top}<span class="pill" style="margin-top:.7rem">${esc(d.kind)}</span></div><div class="ttl">${esc(d.title)}</div><div class="row2"><span class="den">${esc(d.feed)}</span><span class="den">${fdate(d.date)}</span></div>`);
  if (s.key === 'colour') { const ci = contrastInfo(d); return wrap('', `${top}<div class="bars">${d.hexes.map((h) => `<i style="background:${colour(h)};height:${Math.round(30 + 70 * Math.sqrt(hexLum(colour(h))))}%"></i>`).join('')}</div><div><div class="den" style="margin-bottom:.5rem">${esc(d.name)}</div><div class="row2"><div class="big">${ci ? ci.ratio : d.hexes.length}</div><span class="den">/ ${ci ? ci.level : 'HUES'}</span></div></div>`); }
  if (s.key === 'type') { loadFont(d.font); const ff = fontStyle(d.font); return wrap('', `${top}<div class="aa" style="${ff}">Aa</div><div class="row2"><span class="den" style="${ff}">${esc(d.font)}</span><span class="den">/ GOOGLE FONT</span></div>`); }
  if (s.key === 'interface') return wrap('blue', `${LINE_ART}${top}<div><div class="nm">${esc(d.pattern)}</div><div class="dots" style="margin-top:.8rem" aria-hidden="true">${SLOTS.map((_, n) => `<i class="${n === 4 ? 'on' : ''}"></i>`).join('')}</div></div>`);
  if (s.key === 'tab') return wrap('stone', `${top}<div class="nm">${esc(d.name)}</div><div class="row2"><span class="den">${esc(hostOf(d.url))}</span><span class="den">${d.verified ? '● REACHABLE' : 'UNVERIFIED'}</span></div>`);
  const done = !!p.challenge, C = 2 * Math.PI * 46;
  return wrap('chal', `<div class="l"><div>${top}</div><div class="ttl">${esc(d.text)}</div><span class="den">TAP TO OPEN</span></div><div class="ring"><svg viewBox="0 0 112 112" aria-hidden="true"><circle class="tr" cx="56" cy="56" r="46" fill="none" stroke-width="6"/><circle class="pr" cx="56" cy="56" r="46" fill="none" stroke-width="6" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${done ? 0 : C.toFixed(1)}"/></svg><b>${done ? '1/1' : '0/1'}</b><small>DONE</small></div>`);
}
function dashHead(ed) {   // real numbers from your own progress, shown the way the reference shows balances
  const p = prog(ed.slug); let total = 0, answered = 0, correct = 0;
  Object.entries(ed.houses || {}).forEach(([k, h]) => (h?.quiz || []).forEach((q, qi) => { total++; const pick = p.quiz[`${k}:${qi}`]; if (pick !== undefined) { answered++; if (pick === q.answer) correct++; } }));
  const bm = S.bookmarks.filter((b) => b.slug === ed.slug).length;
  const i = INDEX.editions.findIndex((e) => e.slug === ed.slug), prev = INDEX.editions[i + 1], next = INDEX.editions[i - 1];
  const st = (l, v) => `<div class="st"><span>${l}</span><b>${v}</b></div>`;
  return `<div class="dhead"><div class="dlogo" aria-hidden="true">${'<i></i>'.repeat(9)}</div>${st('Edition', esc(ed.slug))}${st('Published', fdate(ed.publishedAt))}<span class="sep"></span>${st('Explored', `${seenCount(ed.slug)}/${KEYS.length}`)}${st('Quiz', `${answered}/${total}`)}${st('Accuracy', answered ? Math.round((correct / answered) * 100) + '%' : '—')}${st('Bookmarks', bm)}<span class="grow"></span><div class="en">${prev ? `<a href="#/home" data-act="open" data-s="${prev.slug}">◂ ${esc(prev.slug)}</a>` : ''}${next ? `<a href="#/home" data-act="open" data-s="${next.slug}">${esc(next.slug)} ▸</a>` : ''}</div></div>`;
}
const capsuleCards = (ed) => `<div class="dash">${dashHead(ed)}<div class="dgrid">${SLOTS.map((s, i) => tileHTML(ed, s, i)).join('')}</div></div>`;

function capsuleDetailHTML(ed, key) {
  const idx = SLOTS.findIndex((s) => s.key === key); if (idx < 0) return null;
  const s = SLOTS[idx], d = slotData(ed, key), p = prog(ed.slug), n = SLOTS.length;
  const prev = SLOTS[(idx + n - 1) % n], next = SLOTS[(idx + 1) % n];
  const crumbs = `<div class="crumbs"><a href="#/home" data-act="tocapsule">← Capsule</a><div class="pg" role="navigation" aria-label="Capsule items">${SLOTS.map((x, k) => `<a href="#/capsule/${x.key}" class="${k === idx ? 'on' : ''}" aria-label="${esc(x.label)}" title="${esc(x.label)}"></a>`).join('')}</div><span>${num2(idx)} / ${num2(n - 1)}</span></div>`;
  const nx = `<div class="nx"><a href="#/capsule/${prev.key}">← ${num2((idx + n - 1) % n)} ${esc(prev.label)}</a><a href="#/capsule/${next.key}">${num2((idx + 1) % n)} ${esc(next.label)} →</a></div>`;
  const page = (hd, bd) => `<section class="sec cdet" style="min-height:80vh"><div class="wrap wide">${crumbs}<article class="dpage ${s.tone === 'char' ? '' : s.tone}" style="--a:${s.a}"><div class="hd"><div class="lab"><span>${esc(s.label)}</span><span>${num2(idx)}</span></div>${hd}</div><div class="bd">${bd}</div>${nx}</article></div></section>`;
  if (!d) return page('<h1 class="sm">Not available this edition</h1>', '<p>This part of the capsule could not be generated this time. It will be back next edition.</p>');
  if (key === 'word') return page(`<h1>${esc(d.word)}</h1><div class="sb">${esc(d.pos || '')} ${esc(d.phonetic || '')} · ${d.word.length} letters</div>`, `<div><span class="lab">Meaning</span><p>${esc(d.definition)}</p></div><p class="ex">${esc(d.example)}</p><div class="box"><span class="lab">Your turn</span><p>${esc(d.exercise)}</p></div><div class="row"><button data-act="say" data-w="${esc(d.word)}">🔊 Hear it</button></div>${d.dictionary ? '' : '<p class="muted">No dictionary entry was found, so the AI wrote this definition.</p>'}`);
  if (key === 'signal') return page(`<h1 class="sm">${esc(d.title)}</h1><div class="sb">${esc(d.kind)} · ${esc(d.feed)} · ${fdate(d.date)}</div>`, `<div class="two"><div><span class="lab">What happened</span><p>${esc(d.whatHappened)}</p></div><div><span class="lab">Why it matters</span><p>${esc(d.whyItMatters)}</p></div></div><p class="take"><span class="lab">Takeaway</span>${esc(d.takeaway)}</p><p><a href="${url(d.url)}" target="_blank" rel="noopener">Read the source</a> · <span class="muted">based on a short excerpt, so check the original</span></p>`);
  if (key === 'colour') return page(`<h1>${esc(d.name)}</h1><div class="sb">${d.hexes.map(esc).join(' · ')}</div>`, `<div class="stripes" id="stripes">${d.hexes.map((x) => `<button class="stripe" style="background:${colour(x)};color:${hexInk(colour(x))}" data-act="copyhex" data-hex="${esc(x)}" aria-label="Copy ${esc(x)}"><span>${esc(x)}</span></button>`).join('')}</div><div class="row" style="margin:0"><button data-act="swap">Reverse order</button><span class="muted">Tap a stripe to copy its hex</span></div><p>${esc(d.note)}</p><div><span class="lab">Where to use it</span><p>${esc(d.application)}</p></div><p class="muted">${esc(d.accessibility)}</p>`);
  if (key === 'type') { loadFont(d.font); const ff = fontStyle(d.font); return page(`<h1 class="sm" style="${ff}">${esc(d.font)}</h1><div class="sb">Google Fonts · open licence (check the specimen page)</div>`, `<div class="bigspec" style="${ff}">Aa</div><p style="${ff};font-size:1.7rem;line-height:1.25">The quick brown fox jumps over the lazy dog.</p><p>${esc(d.character)}</p><div><span class="lab">Best uses</span><p>${esc(d.bestUses)}</p></div><p><a href="${url(d.url)}" target="_blank" rel="noopener">See it on Google Fonts</a></p>`); }
  if (key === 'interface') return page(`<h1 class="sm">${esc(d.pattern)}</h1>`, `<div><span class="lab">Why designers use it</span><p>${esc(d.reasoning)}</p></div><div class="box"><span class="lab">Try it · about 10 minutes</span><p>${esc(d.tryIt)}</p></div>`);
  if (key === 'tab') return page(`<h1 class="sm">${esc(d.name)}</h1><div class="sb">${esc(hostOf(d.url))}</div>`, `<p>${esc(d.what)}</p><div><span class="lab">Why bookmark it</span><p>${esc(d.whyBookmark)}</p></div><div class="row"><a class="btn solid" href="${url(d.url)}" target="_blank" rel="noopener">Open it ${arrow}</a></div><p class="muted">${d.verified ? '● reachable on ' + esc(d.checkedAt) : 'not verified'}</p>`);
  return page(`<h1 class="sm">${esc(d.text)}</h1>`, `<div class="chk"><label class="rg"><input type="checkbox" data-chk="challenge" ${p.challenge ? 'checked' : ''} aria-label="Mark the challenge as done"><span class="rb">${burst(44)}</span></label><p id="chalmsg">${p.challenge ? 'Done. Nicely done.' : 'Tap the ring when you have done it.'}</p></div>`);
}

function homeHTML(ed) {
  const n = seenCount(ed.slug), older = INDEX.editions.slice(1).find((e) => seenCount(e.slug) < KEYS.length);
  const i = INDEX.editions.findIndex((e) => e.slug === ed.slug), prev = INDEX.editions[i + 1], next = INDEX.editions[i - 1];
  const nav = (prev || next) ? `<span class="nav">${prev ? `<a href="#/home" data-act="open" data-s="${prev.slug}" title="Older edition">◂ ${esc(prev.slug)}</a>` : ''}${next ? `<a href="#/home" data-act="open" data-s="${next.slug}" title="Newer edition">${esc(next.slug)} ▸</a>` : ''}</span>` : '';
  return `<header class="hero center" data-t="home">${imgBox(ed.cover, '', false)}<div class="hero-t">
    <div class="kicker">${burst(16)}<span>Edition ${esc(ed.slug)}</span><i>·</i><span>${fdate(ed.publishedAt)}</span>${nav}</div>
    <div class="lockup"><h1 class="display wordmark">Curiosity<span class="script">Atelier</span></h1>
    <div class="spread" aria-hidden="true"><span>Ideas</span><span>woven</span><span>in</span><span>wonder</span></div></div>
    <p class="lead">A learning magazine with a new edition every two days: scripture, mind, sound, code, systems, design and the art of having less.</p>
    <a class="btn" href="#capsule" data-act="jump" data-to="capsule">Enter ${arrow}</a></div></header>
  <section class="band capsule" id="capsule"><div class="wrap wide"><div class="cap-head"><div><div class="kicker">${burst(16)}<span>The daily capsule</span></div><h2 class="display">Little things<span class="script">worth knowing</span></h2></div><p class="hint">Press any tile to open it ↗</p></div>${capsuleCards(ed)}</div></section>
  <section class="band cobalt"><div class="wrap wide"><div class="kicker">${burst(16)}<span>The houses</span></div><h2 class="display" style="margin:.4rem 0 1.4rem;font-size:clamp(2rem,6vw,4rem)">Seven rooms, seven moods</h2>${tiles(ed)}</div></section>
  <section class="band cream"><div class="wrap"><div class="kicker">${burst(16)}<span>The Dispatch</span></div><h2 class="display" style="margin:.4rem 0 1rem;font-size:clamp(2rem,6vw,4rem)">Six things worth your attention</h2><ol class="heads">${(ed.dispatch?.headlines || []).map((h) => `<li><div><span class="kicker">${esc(H[h.house]?.name || h.house)}</span><b>${esc(h.text)}</b></div></li>`).join('')}</ol><div class="row"><a class="btn" href="#/dispatch">Open the briefing ${arrow}</a></div></div></section>
  <section class="band cobalt cta"><div class="wrap"><div class="bar" style="max-width:420px;margin:0 auto 1rem;color:#fff"><i style="width:${(n / KEYS.length) * 100}%"></i></div><p style="margin:0 auto 1rem">${n} of ${KEYS.length} sections explored in this edition. No deadline, no streaks.</p>${older ? `<p>Catch-up idea: <a href="#/home" data-act="open" data-s="${older.slug}">Edition ${esc(older.slug)}</a> still has ${KEYS.length - seenCount(older.slug)} unexplored sections.</p>` : ''}<h2 class="display" style="font-size:clamp(2.2rem,7vw,5rem);margin:1rem 0">Let's keep wondering</h2><a class="btn" href="#/archive">Open the archive</a></div></section>
  <footer class="foot">The Curiosity Atelier · Edition ${esc(ed.slug)}<br>Written by free AI models from cited sources · images are AI illustrations${ed.generator?.failed?.length ? '<br>Missing this time: ' + esc(ed.generator.failed.join(', ')) : ''}</footer>`;
}

function dispatchHTML(ed) {
  const d = ed.dispatch, mode = S.dmode || 'headline';
  const tabs = ['headline', 'briefing', 'deep'].map((m) => `<button data-act="dmode" data-m="${m}" class="${m === mode ? 'on' : ''}">${m === 'deep' ? 'Deep reading' : m}</button>`).join('');
  let body = '';
  if (mode === 'headline') body = `<ol class="heads">${d.headlines.map((h) => `<li><div><span class="kicker">${esc(H[h.house]?.name || h.house)}</span><b>${esc(h.text)}</b></div></li>`).join('')}</ol>`;
  if (mode === 'briefing') body = d.briefing.map((b, i) => `<details class="acc" ${i === 0 ? 'open' : ''}><summary><div><span class="kicker">${burst(14)}<span>${esc(H[b.house]?.name || b.house)}</span></span></div><h3 class="display" style="margin:.3rem 0 0">${esc(b.title)}</h3></div></summary><div class="acc-b prose"><p>${esc(b.text)}</p><p>${(b.sources || []).map((u) => `<a href="${url(u)}" target="_blank" rel="noopener">source</a> · `).join('')}<a href="#/house/${esc(b.house)}">Open the lesson</a></p></div></details>`).join('');
  if (mode === 'deep') body = tiles(ed);
  return `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">${burst(16)}<span>The Dispatch</span><i>·</i><span>Edition ${esc(ed.slug)}</span></div><h1 class="display" style="margin:.5rem 0">The Briefing</h1><div class="tabs">${tabs}</div>${body}<p class="muted" style="margin-top:2rem">${(d.plus || []).map(esc).join(' · ')}</p></div></section>`;
}

function puzzleHTML(ed) {
  const z = ed.puzzle, done = prog(ed.slug).puzzle;
  const inner = z.type === 'latin'
    ? `<p>${esc(z.prompt)}</p><div class="latin" id="latin">${z.grid.flat().map((v, i) => `<input inputmode="numeric" maxlength="1" aria-label="cell ${i + 1}" data-i="${i}" ${v ? `value="${v}" disabled` : ''}>`).join('')}</div>`
    : `<p style="font-size:1.3rem;max-width:40ch">${esc(z.prompt)}</p><input id="pans" placeholder="Your answer" autocomplete="off" style="max-width:360px">`;
  return `<section class="sec" style="min-height:80vh"><div class="wrap"><div class="kicker">${burst(16)}<span>Edition ${esc(ed.slug)}</span><i>·</i><span>Rotating puzzle</span></div><h1 class="display" style="margin:.5rem 0 1.5rem">${esc(z.title)}</h1>${inner}<div class="row"><button data-act="puz">Check</button><button data-act="reveal">Show explanation</button></div><p id="pmsg">${done ? '✔ Solved earlier.' : ''}</p><div id="pexp" hidden class="prose">${md(z.explanation)}${z.answer ? `<p><strong>Answer:</strong> ${esc(z.answer)}</p>` : ''}</div></div></section>`;
}

function archiveHTML() {
  const cards = INDEX.editions.map((e) => `<div class="arch" data-t="${['crimson', 'oxblood', 'sky', 'neon', 'blue', 'green', 'tan'][e.n % 7]}">${imgBox(e.cover ? { src: e.cover, credit: 'AI illustration' } : null, '', false)}<div class="in"><div class="kicker" style="color:inherit">${burst(14)}<span>Edition ${esc(e.slug)}</span><i>·</i><span>${fdate(e.publishedAt)}</span></div><p style="margin:0">${esc(e.theme)}</p><div class="bar" style="width:100%"><i style="width:${(seenCount(e.slug) / KEYS.length) * 100}%"></i></div><span class="muted">${seenCount(e.slug)} / ${KEYS.length} explored</span><button data-act="open" data-s="${e.slug}">${S.cur === e.slug ? 'Currently open' : 'Open'}</button></div></div>`).join('');
  const bms = S.bookmarks.map((b) => `<li><a href="#/house/${b.key}" data-act="open" data-s="${b.slug}">${esc(b.title)}</a> <span class="muted">· edition ${esc(b.slug)}</span></li>`).join('') || '<li class="muted">Nothing bookmarked yet.</li>';
  const wr = S.wrong.map((w) => `<li><strong>${esc(w.q)}</strong><br><span class="muted">Answer: ${esc(w.correct)} · edition ${esc(w.slug)}</span></li>`).join('') || '<li class="muted">No missed questions. Or none attempted yet.</li>';
  const notes = Object.entries(S.notes).filter(([, v]) => v).map(([k, v]) => `<li><span class="muted">${esc(k)}</span><br>${esc(v)}</li>`).join('') || '<li class="muted">No notes yet.</li>';
  return `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">${burst(16)}<span>Learning ledger</span></div><h1 class="display" style="margin:.5rem 0 1.5rem">Archive & review</h1><div class="archgrid">${cards}</div>
  <h2 class="display" style="margin-top:3rem">Review room</h2><div class="cols" style="margin-top:1rem"><div class="card"><h3 class="display" style="margin-top:0">Bookmarks</h3><ul>${bms}</ul></div><div class="card"><h3 class="display" style="margin-top:0">Questions to revisit</h3><ul>${wr}</ul></div></div><div class="card" style="margin-top:1.2rem"><h3 class="display" style="margin-top:0">Your notes</h3><ul>${notes}</ul></div>
  <h2 class="display" style="margin-top:3rem">Your data</h2><p class="muted">Everything lives in this browser. Export a backup now and then.</p><div class="row"><button data-act="export">Export JSON</button><button data-act="import">Import JSON</button><input type="file" id="imp" accept="application/json" hidden></div></div></section>`;
}

// ---------- mind board v2 ----------
// Cards: note, heading, quote, checklist, frame (group), image, link. Rich text (bold/italic/underline/strike/bullets/highlight),
// colours, sizes, resize, lock, duplicate, undo/redo, zoom + pan, labelled arrows, search, Markdown export. All stored in this browser.
const CARD_COLORS = [['paper', '#EDE5D4', '#2a1608'], ['butter', '#F3E8A4', '#2a2508'], ['sage', '#C7DEA4', '#1c2414'], ['sky', '#B8CCE0', '#10202e'], ['rose', '#EBB5B0', '#2e1210'], ['ink', '#1c1c1c', '#F6EEED'], ['maroon', '#8B2E44', '#F6EEED'], ['neon', '#EDFF06', '#021121']];
const HILITES = ['#FFF176', '#B9F6CA', '#FFB3C7', '#A5D8FF'];
const KIND_LABEL = { note: 'Note', heading: 'Heading', quote: 'Quote', checklist: 'List', frame: 'Frame', image: 'Image', link: 'Link' };
const RICH = new Set(['note', 'heading', 'quote', 'frame', 'image']);
const DEF = { note: { w: 230, color: 'paper' }, heading: { w: 300, color: 'ink' }, quote: { w: 270, color: 'ink' }, checklist: { w: 240, color: 'butter' }, frame: { w: 440, h: 300, color: 'ink' }, image: { w: 260, color: 'paper' }, link: { w: 250, color: 'sky' } };
const BW = 2200, BH = 1500;
let BSEL = { card: null, link: null }, BCONN = null, HIST = [], HI = -1;
const bd = () => S.board;
const cardById = (id) => bd().cards.find((c) => c.id === id);
const newId = (p = 'c') => p + Date.now().toString(36) + Math.floor(Math.random() * 999).toString(36);

// ----- sanitiser: stored board HTML is untrusted (imports, old data), so only a small safe subset is ever rendered -----
const OK_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'MARK', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN', 'A', 'SMALL']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT']);
const OK_STYLE = new Set(['background-color', 'color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line']);
function cleanStyle(st) {
  const out = [];
  String(st || '').split(';').forEach((d) => {
    const [k, ...v] = d.split(':'); const key = (k || '').trim().toLowerCase(), val = v.join(':').trim();
    if (!key || !val || !OK_STYLE.has(key) || !/^[#\w\s(),.%-]+$/.test(val) || /url|expression|javascript/i.test(val)) return;
    if (key === 'background-color' && /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i.test(val)) return;
    out.push(`${key}:${val}`);
  });
  return out.join(';');
}
function sanitize(html) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  const walk = (node) => {
    [...node.childNodes].forEach((ch) => {
      if (ch.nodeType === 3) return;
      if (ch.nodeType !== 1) { ch.remove(); return; }
      const tag = ch.tagName.toUpperCase();
      if (DROP_TAGS.has(tag)) { ch.remove(); return; }
      if (!OK_TAGS.has(tag)) { walk(ch); ch.replaceWith(...ch.childNodes); return; }
      [...ch.attributes].forEach((at) => {
        const n = at.name.toLowerCase();
        if (n === 'style') { const s = cleanStyle(at.value); if (s) ch.setAttribute('style', s); else ch.removeAttribute('style'); }
        else if (!(n === 'href' && tag === 'A' && /^https?:\/\//i.test(at.value))) ch.removeAttribute(at.name);
      });
      if (tag === 'A') { if (!ch.getAttribute('href')) { ch.replaceWith(...ch.childNodes); return; } ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener noreferrer'); }
      walk(ch);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
const imgOk = (u) => (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u || '') || /^https:\/\/[^\s"'<>]+$/i.test(u || '') ? esc(u) : '');

// ----- data: migrate v1 boards (cards with type/text, links as pairs) -----
function normBoard() {
  const b = S.board && typeof S.board === 'object' ? S.board : {};
  b.cards = (Array.isArray(b.cards) ? b.cards : []).map((c) => c.kind ? c : { id: c.id || newId(), kind: c.type === 'url' ? 'link' : 'note', x: c.x || 30, y: c.y || 30, w: 230, h: null, color: c.type === 'url' ? 'sky' : 'paper', fs: 1, locked: false, url: c.type === 'url' ? c.text : undefined, html: c.type === 'url' ? '' : esc(c.text || '').replace(/\n/g, '<br>') });
  b.links = (Array.isArray(b.links) ? b.links : []).map((l) => Array.isArray(l) ? { id: newId('l'), a: l[0], b: l[1], label: '', arrow: false } : l).filter((l) => l && l.a && l.b);
  b.zoom = b.zoom || 1; S.board = b;
}
function viewPos() {
  const b = $('#board'), z = bd().zoom || 1;
  return b ? { x: Math.round((b.scrollLeft + 40) / z), y: Math.round((b.scrollTop + 40) / z) } : { x: 40, y: 40 };
}
function freeSpot(w, h) {   // first spot, scanning from the top-left of the current view, that does not overlap an existing card
  const p = viewPos(), cs = bd().cards;
  const hit = (x, y) => cs.some((c) => x < c.x + c.w + 16 && x + w + 16 > c.x && y < c.y + (c.h || 170) + 16 && y + h + 16 > c.y);
  for (let r = 0; r < 14; r++) for (let k = 0; k < 6; k++) { const x = p.x + k * 260, y = p.y + r * 200; if (x + w < BW && y + h < BH && !hit(x, y)) return { x, y }; }
  return p;
}
function makeCard(kind, o = {}) {
  const d = DEF[kind] || DEF.note, p = o.x != null ? { x: o.x, y: o.y } : freeSpot(d.w, d.h || 170);
  const c = { id: newId(), kind, x: p.x, y: p.y, w: d.w, h: d.h || null, color: d.color, fs: 1, locked: false, html: kind === 'heading' ? 'Heading' : kind === 'frame' ? 'Group' : '', ...o };
  if (kind === 'checklist' && !c.items) c.items = [{ t: '', done: false }];
  bd().cards.push(c); return c;
}

// ----- rendering -----
function cardHTML(c) {
  const [, bg, fg] = CARD_COLORS.find((x) => x[0] === c.color) || CARD_COLORS[0];
  const style = `left:${c.x}px;top:${c.y}px;width:${c.w}px;${c.h ? `height:${c.h}px;` : ''}--bgc:${bg};--fgc:${fg};--fs:${[0.85, 1, 1.25][c.fs ?? 1]}`;
  let body;
  if (c.kind === 'checklist') body = `<div class="clist">${(c.items || []).map((it, i) => `<label class="ci"><input type="checkbox" data-ci="${i}" ${it.done ? 'checked' : ''}><span contenteditable="true" data-cit="${i}">${esc(it.t)}</span></label>`).join('')}<button class="add" data-b="ci-add" data-id="${c.id}">+ item</button></div>`;
  else if (c.kind === 'link') body = `<div class="lnk"><small>Link</small><a href="${url(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.url)}</a></div>`;
  else if (c.kind === 'image') body = `<img src="${imgOk(c.src)}" alt=""><div class="cap" contenteditable="true" data-cid="${c.id}" data-ph="Caption">${sanitize(c.html)}</div>`;
  else body = `<div class="cbody" contenteditable="true" data-cid="${c.id}" data-ph="${c.kind === 'heading' ? 'Heading' : c.kind === 'frame' ? 'Group name' : 'Type here…'}">${sanitize(c.html)}</div>`;
  return `<div class="bc ${c.locked ? 'locked' : ''} ${BSEL.card === c.id ? 'sel' : ''}" data-card="${c.id}" data-kind="${c.kind}" style="${style}"><div class="chead" data-drag="${c.id}"><span>${KIND_LABEL[c.kind] || 'Card'}${c.locked ? ' 🔒' : ''}</span><b data-b="del-id" data-id="${c.id}" title="Delete card">×</b></div>${body}<i class="rsz" data-rsz="${c.id}"></i></div>`;
}
function barHTML() {
  const sw = CARD_COLORS.map(([k, bg]) => `<button class="cs" data-b="color" data-color="${k}" style="background:${bg}" title="Card colour: ${k}" aria-label="Card colour ${k}"></button>`).join('');
  const hl = HILITES.map((h) => `<button class="cs" data-b="hl" data-v="${h}" data-needs="rich" style="background:${h}" title="Highlight" aria-label="Highlight ${h}"></button>`).join('');
  return `<div class="bbar" id="bbar">
  <div class="bg"><small>Add</small><button class="bt" data-b="add" data-kind="note">+ Note</button><button class="bt" data-b="add" data-kind="heading">+ Heading</button><button class="bt" data-b="add" data-kind="checklist">+ List</button><button class="bt" data-b="add" data-kind="frame">+ Frame</button><button class="bt" data-b="img">+ Image</button><input type="file" id="bimg" accept="image/*" hidden></div>
  <div class="bg"><input type="text" id="bnew" placeholder="Type, or paste a link, then Enter" aria-label="Quick add"><button class="bt" data-b="addtext">Add</button></div>
  <div class="bg"><small>Text</small><button class="bt" data-b="fmt" data-cmd="bold" data-needs="rich" title="Bold"><b>B</b></button><button class="bt" data-b="fmt" data-cmd="italic" data-needs="rich" title="Italic"><i>I</i></button><button class="bt" data-b="fmt" data-cmd="underline" data-needs="rich" title="Underline"><u>U</u></button><button class="bt" data-b="fmt" data-cmd="strikeThrough" data-needs="rich" title="Strikethrough"><s>S</s></button><button class="bt" data-b="fmt" data-cmd="insertUnorderedList" data-needs="rich" title="Bullet list">•</button></div>
  <div class="bg"><small>Highlight</small>${hl}<button class="bt" data-b="hl" data-v="clear" data-needs="rich" title="Remove highlight">✕</button></div>
  <div class="bg"><small>Size</small><button class="bt" data-b="fs" data-d="-1" data-needs="card">A−</button><button class="bt" data-b="fs" data-d="1" data-needs="card">A+</button></div>
  <div class="bg"><small>Colour</small>${sw}</div>
  <div class="bg"><button class="bt" data-b="dup" data-needs="card">Duplicate</button><button class="bt" data-b="lock" data-needs="card">Lock</button><button class="bt" data-b="del" data-needs="card">Delete</button></div>
  <div class="bg"><button class="bt" data-b="conn">Connect</button><span class="lk"><input type="text" id="llabel" placeholder="Label this line" aria-label="Line label"><button class="bt" data-b="larrow">Arrow</button><button class="bt" data-b="ldel">Remove line</button></span></div>
  <div class="bg"><button class="bt" data-b="undo" title="Undo (Ctrl+Z)">Undo</button><button class="bt" data-b="redo" title="Redo (Ctrl+Shift+Z)">Redo</button></div>
  <div class="bg"><button class="bt" data-b="zout" title="Zoom out">−</button><span id="zl" class="meta">100%</span><button class="bt" data-b="zin" title="Zoom in">+</button><button class="bt" data-b="fit">Fit</button></div>
  <div class="bg"><input type="search" id="bsearch" placeholder="Search cards" aria-label="Search cards"><button class="bt" data-b="md" title="Export as Markdown">Export .md</button></div>
  </div>`;
}
function boardHTML() {
  return `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">${burst(16)}<span>Mind board</span></div><h1 class="display" style="margin:.4rem 0 .2rem;font-size:clamp(2rem,5vw,3.6rem)">Where curiosity gets messy</h1>${barHTML()}<div class="board" id="board"><div class="zw" id="zw"><div class="canvas" id="canvas"></div></div></div><p class="muted hint">Double-click empty space to add a note. Drag a card by its top bar, resize from the corner, and select text to bold, italicise or highlight it. Shortcuts: Delete, Ctrl+D duplicate, Ctrl+Z undo, Esc deselect. Select text in any lesson and tap Clip to drop it here. Everything stays private in this browser.</p></div></section>`;
}
function paintBoard() {
  const cv = $('#canvas'); if (!cv) return;
  cv.innerHTML = `<svg id="lines"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--accent)"/></marker></defs></svg>` + bd().cards.map(cardHTML).join('');
  applyZoom(); drawLines(); updBar(); applySearch();
}
function repaintCard(id, focusIdx) {
  const c = cardById(id), el = $(`[data-card="${id}"]`); if (!c || !el) return paintBoard();
  el.outerHTML = cardHTML(c); drawLines();
  if (focusIdx != null) $(`[data-card="${id}"] [data-cit="${focusIdx}"]`)?.focus();
}
function applyCardStyle(c) {
  const el = $(`[data-card="${c.id}"]`); if (!el) return;
  const [, bg, fg] = CARD_COLORS.find((x) => x[0] === c.color) || CARD_COLORS[0];
  el.style.setProperty('--bgc', bg); el.style.setProperty('--fgc', fg); el.style.setProperty('--fs', [0.85, 1, 1.25][c.fs ?? 1]);
  drawLines();
}
const rectOf = (id) => { const e = $(`[data-card="${id}"]`); return e ? { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight } : null; };
function edge(r, tx, ty) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const t = Math.min((r.w / 2) / Math.abs(dx || 1e-9), (r.h / 2) / Math.abs(dy || 1e-9));
  return [cx + dx * t, cy + dy * t];
}
function drawLines() {
  const svg = $('#lines'); if (!svg) return;
  const defs = svg.querySelector('defs')?.outerHTML || '';
  svg.innerHTML = defs + bd().links.map((l) => {
    const a = rectOf(l.a), b = rectOf(l.b); if (!a || !b) return '';
    const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2], p1 = edge(a, bc[0], bc[1]), p2 = edge(b, ac[0], ac[1]);
    const d = `M${p1[0]} ${p1[1]}L${p2[0]} ${p2[1]}`, mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
    return `<path class="ln ${BSEL.link === l.id ? 'sel' : ''}" d="${d}" ${l.arrow ? 'marker-end="url(#ah)"' : ''}/><path class="hit" data-link="${l.id}" d="${d}"/>${l.label ? `<text x="${mx}" y="${my - 7}">${esc(l.label)}</text>` : ''}`;
  }).join('');
}
function applyZoom() {
  const z = bd().zoom || 1, cv = $('#canvas'), zw = $('#zw'); if (!cv) return;
  cv.style.transform = `scale(${z})`; zw.style.width = BW * z + 'px'; zw.style.height = BH * z + 'px';
  const l = $('#zl'); if (l) l.textContent = Math.round(z * 100) + '%';
}
function setZoom(z) { bd().zoom = Math.max(0.4, Math.min(1.8, Math.round(z * 100) / 100)); applyZoom(); save(); }
function fitZoom() {
  const b = $('#board'); if (!b || !bd().cards.length) return setZoom(1);
  const mx = Math.max(...bd().cards.map((c) => c.x + c.w)) + 60, my = Math.max(...bd().cards.map((c) => c.y + (c.h || 220))) + 60;
  setZoom(Math.min(1.2, b.clientWidth / mx, b.clientHeight / my)); b.scrollTo(0, 0);
}
function applySearch() {
  const q = ($('#bsearch')?.value || '').trim().toLowerCase();
  document.querySelectorAll('.bc').forEach((e) => e.classList.toggle('dim', !!q && !e.innerText.toLowerCase().includes(q)));
}
function updBar() {
  const bar = $('#bbar'); if (!bar) return;
  const c = BSEL.card && cardById(BSEL.card), l = BSEL.link && bd().links.find((x) => x.id === BSEL.link);
  bar.classList.toggle('haslink', !!l);
  bar.querySelectorAll('[data-needs=card]').forEach((e) => e.classList.toggle('off', !c));
  bar.querySelectorAll('[data-needs=rich]').forEach((e) => e.classList.toggle('off', !(c && RICH.has(c.kind))));
  bar.querySelectorAll('.cs[data-color]').forEach((e) => { e.classList.toggle('on', !!c && c.color === e.dataset.color); e.classList.toggle('off', !c); });
  bar.querySelector('[data-b=lock]')?.classList.toggle('on', !!(c && c.locked));
  const cn = bar.querySelector('[data-b=conn]');
  if (cn) { cn.classList.toggle('on', !!BCONN); cn.textContent = BCONN ? (BCONN === 'pending' ? 'Pick first card…' : 'Pick second card…') : 'Connect'; }
  bar.querySelector('[data-b=undo]')?.classList.toggle('off', HI <= 0);
  bar.querySelector('[data-b=redo]')?.classList.toggle('off', HI >= HIST.length - 1);
  if (l) { const inp = $('#llabel'); if (inp && document.activeElement !== inp) inp.value = l.label || ''; bar.querySelector('[data-b=larrow]')?.classList.toggle('on', !!l.arrow); }
}
function select(card, link) {
  BSEL = { card: card ?? null, link: link ?? null };
  document.querySelectorAll('.bc').forEach((e) => e.classList.toggle('sel', e.dataset.card === BSEL.card));
  drawLines(); updBar();
}

// ----- history -----
function snap() {
  const s = JSON.stringify(bd());
  if (HIST[HI] === s) { updBar(); return; }
  HIST = HIST.slice(0, HI + 1); HIST.push(s); if (HIST.length > 60) HIST.shift(); HI = HIST.length - 1; save(); updBar();
}
function restore(i) { const z = bd().zoom; HI = i; S.board = JSON.parse(HIST[HI]); S.board.zoom = z; BSEL = { card: null, link: null }; paintBoard(); save(); }
const undo = () => { if (HI > 0) restore(HI - 1); };
const redo = () => { if (HI < HIST.length - 1) restore(HI + 1); };

// ----- actions -----
function removeCard(id) { bd().cards = bd().cards.filter((c) => c.id !== id); bd().links = bd().links.filter((l) => l.a !== id && l.b !== id); BSEL = { card: null, link: null }; snap(); paintBoard(); }
function removeLink(id) { bd().links = bd().links.filter((l) => l.id !== id); BSEL = { card: null, link: null }; snap(); paintBoard(); }
function focusCard(id) { const el = $(`[data-card="${id}"]`); (el?.querySelector('[data-cid]') || el?.querySelector('[data-cit]'))?.focus(); }
function addFromInput() {
  const i = $('#bnew'), t = (i?.value || '').trim(); if (!t) return;
  const c = /^https?:\/\/\S+$/i.test(t) ? makeCard('link', { url: t }) : makeCard('note', { html: esc(t).replace(/\n/g, '<br>') });
  i.value = ''; snap(); BSEL.card = c.id; paintBoard();
}
function addImage(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 900 / im.width), cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      const c = makeCard('image', { src: cv.toDataURL('image/jpeg', 0.82) }); snap(); BSEL.card = c.id; paintBoard(); toast('Image added');
    };
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}
function editorFor(c) {
  const el = $(`[data-card="${c.id}"] [data-cid]`); if (!el) return null;
  const sel = getSelection();
  if (!(sel && sel.rangeCount && el.contains(sel.anchorNode)) || sel.isCollapsed) { el.focus(); document.execCommand('selectAll'); }   // nothing selected: format the whole card
  return el;
}
function fmt(cmd, c) {
  const el = editorFor(c); if (!el) return;
  document.execCommand('styleWithCSS', false, true); document.execCommand(cmd);
  el.dispatchEvent(new Event('input', { bubbles: true })); snap();
}
function highlight(v, c) {
  const el = editorFor(c); if (!el) return;
  document.execCommand('styleWithCSS', false, true);
  if (!document.execCommand('hiliteColor', false, v === 'clear' ? 'transparent' : v)) document.execCommand('backColor', false, v === 'clear' ? 'transparent' : v);
  el.dispatchEvent(new Event('input', { bubbles: true })); snap();
}
function pickConn(id) {
  if (BCONN === 'pending') { BCONN = id; updBar(); return; }
  if (BCONN && BCONN !== id) {
    if (!bd().links.some((l) => (l.a === BCONN && l.b === id) || (l.a === id && l.b === BCONN))) {
      const l = { id: newId('l'), a: BCONN, b: id, label: '', arrow: true }; bd().links.push(l); BCONN = null; snap(); select(null, l.id); $('#llabel')?.focus(); return;
    }
    toast('Those cards are already connected');
  }
  BCONN = null; updBar();
}
function htmlToMd(html) {
  const doc = new DOMParser().parseFromString('<body>' + sanitize(html) + '</body>', 'text/html');
  const w = (n) => [...n.childNodes].map((x) => {
    if (x.nodeType === 3) return x.textContent; if (x.nodeType !== 1) return '';
    const t = x.tagName, inner = w(x), st = x.getAttribute('style') || '';
    if (t === 'BR') return '\n'; if (t === 'B' || t === 'STRONG') return `**${inner}**`; if (t === 'I' || t === 'EM') return `*${inner}*`;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') return `~~${inner}~~`; if (t === 'U') return `<u>${inner}</u>`;
    if (t === 'MARK' || /background/.test(st)) return `==${inner}==`; if (t === 'LI') return `- ${inner}\n`;
    if (t === 'UL' || t === 'OL') return '\n' + inner; if (t === 'DIV' || t === 'P') return inner + '\n';
    if (t === 'A') return `[${inner}](${x.getAttribute('href')})`; return inner;
  }).join('');
  return w(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}
function exportMd() {
  const cards = [...bd().cards].sort((a, b) => a.y - b.y || a.x - b.x);
  const label = (c) => (c.kind === 'checklist' ? (c.items?.[0]?.t || 'List') : c.kind === 'link' ? c.url : htmlToMd(c.html).split('\n')[0] || KIND_LABEL[c.kind]).slice(0, 60);
  let md = `# Mind board\n\n_Exported ${new Date().toISOString().slice(0, 10)}_\n\n`;
  cards.forEach((c) => {
    if (c.kind === 'heading') md += `## ${htmlToMd(c.html)}\n\n`;
    else if (c.kind === 'frame') md += `### ▭ ${htmlToMd(c.html)}\n\n`;
    else if (c.kind === 'quote') md += htmlToMd(c.html).split('\n').map((x) => `> ${x}`).join('\n') + '\n\n';
    else if (c.kind === 'checklist') md += (c.items || []).map((i) => `- [${i.done ? 'x' : ' '}] ${i.t}`).join('\n') + '\n\n';
    else if (c.kind === 'link') md += `<${c.url}>\n\n`;
    else if (c.kind === 'image') md += `![image](embedded in board)${htmlToMd(c.html) ? `\n_${htmlToMd(c.html)}_` : ''}\n\n`;
    else md += htmlToMd(c.html) + '\n\n';
  });
  if (bd().links.length) {
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    md += '## Connections\n\n' + bd().links.filter((l) => byId[l.a] && byId[l.b]).map((l) => `- **${label(byId[l.a])}** ${l.arrow ? '→' : '—'} **${label(byId[l.b])}**${l.label ? ` (${l.label})` : ''}`).join('\n') + '\n';
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = `mind-board-${new Date().toISOString().slice(0, 10)}.md`; a.click(); toast('Exported as Markdown');
}
function barAction(t) {
  const a = t.dataset.b, c = BSEL.card && cardById(BSEL.card), l = BSEL.link && bd().links.find((x) => x.id === BSEL.link);
  if (a === 'add') { const n = makeCard(t.dataset.kind); snap(); BSEL.card = n.id; paintBoard(); focusCard(n.id); }
  else if (a === 'img') $('#bimg').click();
  else if (a === 'addtext') addFromInput();
  else if (a === 'fmt' && c && RICH.has(c.kind)) fmt(t.dataset.cmd, c);
  else if (a === 'hl' && c && RICH.has(c.kind)) highlight(t.dataset.v, c);
  else if (a === 'fs' && c) { c.fs = Math.max(0, Math.min(2, (c.fs ?? 1) + Number(t.dataset.d))); applyCardStyle(c); snap(); }
  else if (a === 'color' && c) { c.color = t.dataset.color; applyCardStyle(c); snap(); }
  else if (a === 'dup' && c) { const n = { ...JSON.parse(JSON.stringify(c)), id: newId(), x: c.x + 30, y: c.y + 30, locked: false }; bd().cards.push(n); snap(); BSEL.card = n.id; paintBoard(); }
  else if (a === 'lock' && c) { c.locked = !c.locked; snap(); repaintCard(c.id); updBar(); }
  else if (a === 'del' && c) removeCard(c.id);
  else if (a === 'conn') { BCONN = BCONN ? null : 'pending'; updBar(); }
  else if (a === 'larrow' && l) { l.arrow = !l.arrow; snap(); drawLines(); updBar(); }
  else if (a === 'ldel' && l) removeLink(l.id);
  else if (a === 'undo') undo(); else if (a === 'redo') redo();
  else if (a === 'zin') setZoom((bd().zoom || 1) + 0.1); else if (a === 'zout') setZoom((bd().zoom || 1) - 0.1); else if (a === 'fit') fitZoom();
  else if (a === 'md') exportMd();
}
function wireBoard() {
  const board = $('#board'), bar = $('#bbar'); if (!board) return;
  normBoard(); HIST = [JSON.stringify(bd())]; HI = 0; BSEL = { card: null, link: null }; BCONN = null;
  paintBoard();
  // toolbar: keep the text selection inside the card while clicking toolbar buttons
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  bar.addEventListener('click', (e) => { const t = e.target.closest('[data-b]'); if (t) barAction(t); });
  bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'bnew') { e.preventDefault(); addFromInput(); } });
  bar.addEventListener('input', (e) => {
    if (e.target.id === 'bsearch') applySearch();
    if (e.target.id === 'llabel') { const l = bd().links.find((x) => x.id === BSEL.link); if (l) { l.label = e.target.value; drawLines(); save(); } }
  });
  bar.addEventListener('change', (e) => { if (e.target.id === 'llabel') snap(); if (e.target.id === 'bimg') { addImage(e.target.files[0]); e.target.value = ''; } });
  board.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom((bd().zoom || 1) * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });
  // pointer: select, drag, resize, pan
  board.addEventListener('pointerdown', (e) => {
    const z = bd().zoom || 1, card = e.target.closest('.bc'), id = card?.dataset.card;
    const rs = e.target.closest('[data-rsz]'), dg = e.target.closest('[data-drag]');
    if (id && !e.target.closest('[data-b="del-id"]') && !BCONN) select(id, null);
    if (rs) {
      const c = cardById(id), sx = e.clientX, sy = e.clientY, w0 = c.w, h0 = c.h || card.offsetHeight;
      rs.setPointerCapture(e.pointerId);
      const mv = (ev) => { c.w = Math.max(150, Math.round(w0 + (ev.clientX - sx) / z)); c.h = Math.max(70, Math.round(h0 + (ev.clientY - sy) / z)); card.style.width = c.w + 'px'; card.style.height = c.h + 'px'; drawLines(); };
      const up = () => { rs.removeEventListener('pointermove', mv); rs.removeEventListener('pointerup', up); snap(); };
      rs.addEventListener('pointermove', mv); rs.addEventListener('pointerup', up); e.preventDefault(); return;
    }
    if (dg && !e.target.closest('[data-b]')) {
      const c = cardById(id); if (!c || c.locked) return;
      const sx = e.clientX, sy = e.clientY, ox = c.x, oy = c.y; let moved = false;
      dg.setPointerCapture(e.pointerId);
      const mv = (ev) => { moved = true; c.x = Math.max(0, Math.min(BW - c.w, Math.round(ox + (ev.clientX - sx) / z))); c.y = Math.max(0, Math.min(BH - 60, Math.round(oy + (ev.clientY - sy) / z))); card.style.left = c.x + 'px'; card.style.top = c.y + 'px'; drawLines(); };
      const up = () => { dg.removeEventListener('pointermove', mv); dg.removeEventListener('pointerup', up); if (moved) snap(); };
      dg.addEventListener('pointermove', mv); dg.addEventListener('pointerup', up); return;
    }
    if (!card && ['canvas', 'zw', 'board', 'lines'].includes(e.target.id) && e.pointerType === 'mouse') {   // empty space: deselect + pan
      if (!BCONN) select(null, null);
      const sx = e.clientX, sy = e.clientY, l0 = board.scrollLeft, t0 = board.scrollTop;
      board.setPointerCapture(e.pointerId);
      const mv = (ev) => { board.scrollLeft = l0 - (ev.clientX - sx); board.scrollTop = t0 - (ev.clientY - sy); };
      const up = () => { board.removeEventListener('pointermove', mv); board.removeEventListener('pointerup', up); };
      board.addEventListener('pointermove', mv); board.addEventListener('pointerup', up);
    }
  });
  board.addEventListener('dblclick', (e) => {
    if (!['canvas', 'zw', 'board', 'lines'].includes(e.target.id)) return;
    const z = bd().zoom || 1, r = board.getBoundingClientRect();
    const c = makeCard('note', { x: Math.round((e.clientX - r.left + board.scrollLeft) / z), y: Math.round((e.clientY - r.top + board.scrollTop) / z) });
    snap(); BSEL.card = c.id; paintBoard(); focusCard(c.id);
  });
  board.addEventListener('click', (e) => {
    const del = e.target.closest('[data-b="del-id"]'); if (del) { removeCard(del.dataset.id); return; }
    const add = e.target.closest('[data-b="ci-add"]'); if (add) { const c = cardById(add.dataset.id); c.items.push({ t: '', done: false }); snap(); repaintCard(c.id, c.items.length - 1); return; }
    const ln = e.target.closest('[data-link]'); if (ln) { select(null, ln.dataset.link); $('#llabel')?.focus(); return; }
    const card = e.target.closest('.bc'); if (card && BCONN) pickConn(card.dataset.card);
  });
  board.addEventListener('input', (e) => {
    const cb = e.target.closest('[data-cid]'); if (cb) { const c = cardById(cb.dataset.cid); if (c) { c.html = sanitize(cb.innerHTML); save(); } return; }
    const it = e.target.closest('[data-cit]'); if (it) { const c = cardById(it.closest('.bc').dataset.card); if (c) { c.items[Number(it.dataset.cit)].t = it.innerText.replace(/\n/g, ' '); save(); } }
  });
  board.addEventListener('change', (e) => { const ck = e.target.closest('[data-ci]'); if (ck) { const c = cardById(ck.closest('.bc').dataset.card); c.items[Number(ck.dataset.ci)].done = ck.checked; snap(); } });
  board.addEventListener('focusout', (e) => { if (e.target.closest('[data-cid],[data-cit]')) snap(); });
  board.addEventListener('keydown', (e) => {
    const it = e.target.closest('[data-cit]'); if (!it) return;
    const c = cardById(it.closest('.bc').dataset.card), i = Number(it.dataset.cit);
    if (e.key === 'Enter') { e.preventDefault(); c.items.splice(i + 1, 0, { t: '', done: false }); snap(); repaintCard(c.id, i + 1); }
    else if (e.key === 'Backspace' && !it.innerText.trim() && c.items.length > 1) { e.preventDefault(); c.items.splice(i, 1); snap(); repaintCard(c.id, Math.max(0, i - 1)); }
  });
}
document.addEventListener('keydown', (e) => {   // board shortcuts (only on the board, and never while typing)
  if (!$('#board')) return;
  if (e.key === 'Escape') { BCONN = null; select(null, null); return; }
  if (e.target.closest?.('input,textarea,[contenteditable="true"]')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if ((e.key === 'Delete' || e.key === 'Backspace') && BSEL.card) { e.preventDefault(); removeCard(BSEL.card); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && BSEL.link) { e.preventDefault(); removeLink(BSEL.link); }
  else if (mod && k === 'd' && BSEL.card) { e.preventDefault(); const c = cardById(BSEL.card), n = { ...JSON.parse(JSON.stringify(c)), id: newId(), x: c.x + 30, y: c.y + 30, locked: false }; bd().cards.push(n); snap(); BSEL.card = n.id; paintBoard(); }
  else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
});

// ---------- routing & render ----------
const THEME_FOR = { capsule: 'home', home: 'home', houses: 'home', dispatch: 'blue', puzzle: 'tan', board: 'home', archive: 'home' };
let io, pendingScroll = null;
function reveal() {
  io?.disconnect();
  const els = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach((e) => e.classList.add('in')); return; }
  io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
  els.forEach((e) => io.observe(e));
}
function applyPrefs(isLesson) {
  document.documentElement.style.fontSize = ['93.75%', '100%', '115%'][S.prefs.size] || '100%';
  document.body.classList.toggle('focus', !!(S.prefs.focus && isLesson));
  document.documentElement.style.setProperty('--hh', ($('.top')?.offsetHeight || 56) + 'px');
}
async function render(top = true) {
  const route = (location.hash.split('/')[1] || 'home').split('?')[0], arg = location.hash.split('/')[2];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === route || (route === 'house' && a.dataset.r === 'houses') || (route === 'capsule' && a.dataset.r === 'home')));
  const isLesson = route === 'house' && !!H[arg];
  const theme = isLesson ? H[arg].t : THEME_FOR[route] || 'home';
  document.body.dataset.t = theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#EDE5D4');
  applyPrefs(isLesson); hidePop();
  const app = $('#app');
  if (!INDEX.editions.length) { app.innerHTML = `<section class="sec"><div class="wrap"><h1 class="display">No edition yet</h1><p>The first edition is created by the scheduled GitHub Action. Open your repository, go to Actions, choose "site", and run it with force ticked. Refresh this page in a few minutes.</p></div></section>`; return; }
  if (!INDEX.editions.some((e) => e.slug === S.cur)) S.cur = INDEX.editions[0].slug;
  if (route === 'board') { app.innerHTML = boardHTML(); wireBoard(); if (top) scrollTo(0, 0); return; }
  if (route === 'archive') { app.innerHTML = archiveHTML(); reveal(); if (top) scrollTo(0, 0); return; }
  let ed;
  try { ed = await edition(S.cur); } catch { app.innerHTML = '<p class="pad">Could not load this edition. Check your connection and try again.</p>'; return; }
  if (isLesson) { seen(ed.slug, arg); app.innerHTML = lessonHTML(ed, ed.houses[arg], arg); }
  else if (route === 'houses' || route === 'house') app.innerHTML = `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">${burst(16)}<span>Edition ${esc(ed.slug)}</span></div><h1 class="display" style="margin:.5rem 0 1.5rem">The houses</h1>${tiles(ed)}</div></section>`;
  else if (route === 'capsule') { seen(ed.slug, 'capsule'); app.innerHTML = capsuleDetailHTML(ed, arg) || '<section class="sec"><div class="wrap"><h1 class="display">Not found</h1><p><a href="#/home">Back to the capsule</a></p></div></section>'; }
  else if (route === 'dispatch') app.innerHTML = dispatchHTML(ed);
  else if (route === 'puzzle') { seen(ed.slug, 'puzzle'); app.innerHTML = puzzleHTML(ed); }
  else { seen(ed.slug, 'capsule'); app.innerHTML = homeHTML(ed); }
  reveal(); onScroll();
  if (pendingScroll) { const id = pendingScroll; pendingScroll = null; requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' })); }
  else if (top) scrollTo(0, 0);
}

// ---------- scroll: reading progress, section spy, hero parallax ----------
let ticking = false;
function onScroll() {
  if (ticking) return; ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const y = scrollY, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) document.querySelectorAll('.hero .imgbox').forEach((b) => b.style.setProperty('--py', Math.min(70, y * 0.12) + 'px'));
    const toc = $('#toc'); if (!toc) return;
    const hero = $('.lesson .hero'), start = hero ? hero.offsetTop + hero.offsetHeight : 0, total = document.documentElement.scrollHeight - innerHeight - start;   // sticky elements report their stuck offset, so measure from the hero
    toc.style.setProperty('--p', total > 0 ? Math.max(0, Math.min(1, (y - start) / total)).toFixed(3) : 0);
    let cur = null; const line = ($('.top')?.offsetHeight || 56) + 90;
    document.querySelectorAll('[data-sec]').forEach((s) => { if (s.getBoundingClientRect().top < line) cur = s.dataset.sec; });
    toc.querySelectorAll('.chip').forEach((c) => { const on = c.dataset.to === cur; if (on !== c.classList.contains('on')) { c.classList.toggle('on', on); if (on) { const l = c.offsetLeft - toc.clientWidth / 2 + c.offsetWidth / 2; toc.scrollTo({ left: l, behavior: 'smooth' }); } } });
  });
}

// ---------- select text to clip ----------
let selText = '';
function checkSelection() {
  setTimeout(() => {
    const fab = $('#clipfab'), sel = getSelection(), t = sel ? sel.toString().trim() : '';
    if (!fab) return;
    const inLesson = sel && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('.lesson .prose, .lesson .pull, .lesson .ev');
    if (!t || t.length < 8 || t.length > 700 || !inLesson) { fab.hidden = true; return; }
    selText = t;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    fab.hidden = false; fab.style.left = `${r.left + scrollX + r.width / 2}px`; fab.style.top = `${r.top + scrollY - 6}px`;
  }, 15);
}

// ---------- events ----------
document.addEventListener('error', (e) => { if (e.target?.tagName === 'IMG') e.target.remove(); }, true);   // missing image -> generated art shows through
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#pop') && !e.target.closest('.gl')) hidePop();
  const t = e.target.closest('[data-act]'); if (!t) { const ln = e.target.closest('[data-link]'); if (ln) { S.board.links.splice(Number(ln.dataset.link), 1); save(); drawLines(); } return; }
  const act = t.dataset.act;
  // synchronous, no data needed
  if (act === 'tocapsule') { pendingScroll = 'capsule'; return; }
  if (act === 'jump') { e.preventDefault(); document.getElementById(t.dataset.to)?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (act === 'gl') { showPop(t, GL[Number(t.dataset.i)] || { term: '', definition: '' }); return; }
  if (act === 'flip') { t.classList.toggle('on'); return; }
  if (act === 'ef') { const list = t.closest('.sec').querySelector('.evlist'); t.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === t)); if (t.dataset.f) list.dataset.f = t.dataset.f; else delete list.dataset.f; return; }
  if (act === 'size+' || act === 'size-') { S.prefs.size = Math.max(0, Math.min(2, S.prefs.size + (act === 'size+' ? 1 : -1))); save(); applyPrefs(true); toast(['Smaller text', 'Normal text', 'Larger text'][S.prefs.size]); return; }
  if (act === 'focus') { S.prefs.focus = !S.prefs.focus; save(); const y = scrollY; await render(false); scrollTo(0, y); return; }
  if (act === 'top') { scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (act === 'copyhex') { try { await navigator.clipboard.writeText(t.dataset.hex); toast(`Copied ${t.dataset.hex}`); } catch { toast(t.dataset.hex); } return; }
  if (act === 'swap') { $('#stripes')?.classList.toggle('rev'); return; }
  if (act === 'say') { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.dataset.w); u.lang = 'en'; u.rate = .85; speechSynthesis.speak(u); } catch { toast('Speech is not available here'); } return; }
  if (act === 'clipsel') { normBoard(); makeCard('quote', { html: `${esc(selText)}<br><small>— ${esc($('.lesson')?.dataset.title || 'lesson')}</small>` }); save(); $('#clipfab').hidden = true; getSelection()?.removeAllRanges(); toast('Clipped to your board'); return; }
  const ed = await edition(S.cur).catch(() => null);
  if (act === 'quiz' && ed) {
    const h = ed.houses[t.dataset.k], qi = Number(t.dataset.q), oi = Number(t.dataset.o), q = h.quiz[qi], y = scrollY;
    prog(ed.slug).quiz[`${t.dataset.k}:${qi}`] = oi;
    if (oi !== q.answer && !S.wrong.some((w) => w.slug === ed.slug && w.key === t.dataset.k && w.qi === qi)) S.wrong.push({ slug: ed.slug, key: t.dataset.k, qi, q: q.q, correct: q.options[q.answer] });
    save(); await render(false); scrollTo(0, y);
  } else if (act === 'retry' && ed) {
    const y = scrollY; ed.houses[t.dataset.k].quiz.forEach((_, qi) => delete prog(ed.slug).quiz[`${t.dataset.k}:${qi}`]); save(); await render(false); scrollTo(0, y);
  } else if (act === 'bm' && ed) {
    const i = S.bookmarks.findIndex((b) => b.slug === ed.slug && b.key === t.dataset.k), y = scrollY;
    if (i >= 0) S.bookmarks.splice(i, 1); else S.bookmarks.push({ slug: ed.slug, key: t.dataset.k, title: ed.houses[t.dataset.k].title });
    save(); await render(false); scrollTo(0, y);
  } else if (act === 'clip' && ed) {
    const h = ed.houses[t.dataset.k]; normBoard(); makeCard('quote', { html: `<strong>${esc(h.title)}</strong><br>${esc(h.hook)}` }); const u = h.sources?.[0]?.url; if (u) makeCard('link', { url: u }); save(); toast('Clipped to your board');
  } else if (act === 'dmode') { S.dmode = t.dataset.m; save(); render(false); }
  else if (act === 'open') { S.cur = t.dataset.s; save(); if (!t.getAttribute('href') || t.getAttribute('href') === '#/home') location.hash = '#/home'; render(); }
  else if (act === 'puz' && ed) {
    const z = ed.puzzle; let ok = false;
    if (z.type === 'latin') {
      const v = [...document.querySelectorAll('#latin input')].map((i) => Number(i.value) || 0), g = [0, 1, 2, 3].map((r) => v.slice(r * 4, r * 4 + 4));
      const good = (a) => new Set(a).size === 4 && a.every((x) => x >= 1 && x <= 4);
      ok = g.every(good) && [0, 1, 2, 3].every((c) => good(g.map((r) => r[c])));
    } else ok = ($('#pans').value || '').trim().toLowerCase() === String(z.answer).toLowerCase();
    $('#pmsg').textContent = ok ? '✔ Correct. Nicely done.' : 'Not yet. Look again, or read the explanation.';
    if (ok) { prog(ed.slug).puzzle = true; save(); }
  } else if (act === 'reveal') { $('#pexp').hidden = false; }
  else if (act === 'export') {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })); a.download = `atelier-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  } else if (act === 'import') $('#imp').click();
});
document.addEventListener('input', (e) => { const n = e.target.closest('[data-note]'); if (n) { S.notes[`${S.cur}/${n.dataset.note}`] = n.value; save(); } });
document.addEventListener('change', async (e) => {
  if (e.target.matches('[data-chk]')) { prog(S.cur)[e.target.dataset.chk] = e.target.checked; save(); const m = $('#chalmsg'); if (m) m.textContent = e.target.checked ? 'Done. Nicely done.' : 'Tap the ring when you have done it.'; toast(e.target.checked ? 'Nice. Marked as done' : 'Unmarked'); return; }
  if (e.target.id !== 'imp' || !e.target.files[0]) return;
  try { const j = JSON.parse(await e.target.files[0].text()); if (j && typeof j === 'object' && confirm('Replace your current data with this backup?')) { S = { ...S, ...j }; normBoard(); await kvSet('state', S); render(); } } catch { alert('That file could not be read.'); }
});
document.addEventListener('mouseup', checkSelection);
document.addEventListener('touchend', checkSelection);
document.addEventListener('keyup', (e) => { if (e.key === 'Escape') { hidePop(); $('#clipfab') && ($('#clipfab').hidden = true); if (S.prefs.focus) { S.prefs.focus = false; save(); render(false); } } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && location.hash.startsWith('#/capsule/') && !e.target.closest?.('input,textarea,[contenteditable="true"]')) { const k = location.hash.split('/')[2], i = SLOTS.findIndex((s) => s.key === k); if (i >= 0) location.hash = `#/capsule/${SLOTS[(i + (e.key === 'ArrowRight' ? 1 : SLOTS.length - 1)) % SLOTS.length].key}`; }
  else if (e.key.startsWith('Arrow') && e.shiftKey) checkSelection(); });
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => applyPrefs(document.body.classList.contains('focus') || !!$('.lesson')));
addEventListener('hashchange', () => render());

// ---------- boot ----------
(async () => {
  const saved = await kvGet('state'); if (saved) S = { ...S, ...saved, prefs: { size: 1, focus: false, ...(saved.prefs || {}) } }; S.connect = null; normBoard();
  document.body.insertAdjacentHTML('beforeend', '<div id="pop" hidden role="dialog"></div><div id="clipfab" hidden><button data-act="clipsel" onmousedown="event.preventDefault()">Clip to board</button></div><div id="toast" role="status" aria-live="polite"></div>');
  try { INDEX = await (await fetch('data/index.json')).json(); } catch { INDEX = { editions: [] }; }
  await render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
