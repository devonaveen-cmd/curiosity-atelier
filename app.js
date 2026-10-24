// The Curiosity Atelier front end: no build step, no dependencies.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`).join('');
const url = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const imgSrc = (u) => (/^data\/img\/[\w./-]+$/.test(u || '') ? esc(u) : '');
const fdate = (d) => { const t = new Date(d); return isNaN(t) ? esc(d || '') : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
const colour = (h) => (/^#[0-9a-f]{6}$/i.test(h || '') ? h : '#444');

// key, numeral, name, theme, hero layout
const HOUSES = [
  ['theology', 'I', 'Theology', 'oxblood', 'split'], ['mindcraft', 'II', 'Mindcraft', 'sky', 'split'], ['soundroom', 'III', 'Soundroom', 'crimson', 'center'],
  ['aiml', 'IV', 'AI/ML Fieldnotes', 'neon', 'center'], ['systems', 'V', 'Systems Forge', 'blue', 'center'], ['design', 'VI', 'Design Observatory', 'green', 'split'], ['frugal', '✦', 'Frugal Chic', 'tan', 'split']
];
const H = Object.fromEntries(HOUSES.map((h) => [h[0], { num: h[1], name: h[2], t: h[3], layout: h[4] }]));
const KEYS = ['capsule', ...HOUSES.map((h) => h[0]), 'puzzle'];
const LABEL = { established: '✓ established', inference: '~ inference', debate: '⇄ debate', tradition: '❝ tradition', background: '· background', unverified: '? unverified' };

const burst = (n = 34) => `<svg class="burst" width="${n}" height="${n}" viewBox="0 0 100 100" aria-hidden="true">${[...Array(12).keys()].map((i) => `<rect x="43" y="2" width="14" height="40" rx="3" transform="rotate(${i * 30} 50 50)"/>`).join('')}</svg>`;
const arrow = '<svg class="arrow" viewBox="0 0 60 12" aria-hidden="true"><path d="M0 6h57M51 1l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
// image box: generated art sits underneath, so a missing or pruned photo degrades to art, never to a broken icon
const imgBox = (img, cls = '', cap = true) => `<figure class="imgbox ${cls}"><div class="art"></div>${imgSrc(img?.src) ? `<img src="${imgSrc(img.src)}" alt="${esc(img.alt || '')}" loading="lazy" decoding="async">` : ''}${img && cap ? `<figcaption title="${esc(img.credit || '')}">AI illustration</figcaption>` : ''}</figure>`;

// ---------- storage (IndexedDB, with in-memory fallback) ----------
let memDB = {};
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('atelier', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function kvGet(k) { try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch { return memDB[k]; } }
async function kvSet(k, v) { try { const db = await idb(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch { memDB[k] = v; } }

let S = { progress: {}, bookmarks: [], notes: {}, wrong: [], board: { cards: [], links: [] }, cur: null };
let timer;
const save = () => { clearTimeout(timer); timer = setTimeout(() => kvSet('state', S), 250); };

// ---------- data ----------
let INDEX = { editions: [] };
const CACHE = {};
async function edition(slug) {
  if (CACHE[slug]) return CACHE[slug];
  const r = await fetch(`data/editions/${slug}.json`);
  if (!r.ok) throw new Error('edition not found');
  return (CACHE[slug] = await r.json());
}
const prog = (slug) => (S.progress[slug] ||= { seen: {}, quiz: {} });
const seen = (slug, key) => { const p = prog(slug); if (!p.seen[key]) { p.seen[key] = true; save(); } };
const seenCount = (slug) => KEYS.filter((k) => prog(slug).seen[k]).length;

// ---------- shared pieces ----------
const sec = (id, title, inner, alt) => `<section class="sec ${alt ? 'alt' : ''}" ${id ? `id="${id}"` : ''}><div class="wrap">${title ? `<h2 class="display">${title}</h2>` : ''}${inner}</div></section>`;

function hero(ed, key, h) {
  const m = H[key];
  const kick = `<div class="kicker">${m.t === 'neon' ? burst(26) : ''}<span>House ${m.num} · ${esc(m.name)}</span><span>Edition ${esc(ed.slug)}</span></div>`;
  const script = m.t === 'crimson' ? `<span class="script">${esc(h.topic)}</span>` : '';
  const text = `<div class="hero-t">${kick}<h1 class="display" style="margin-top:1rem">${esc(h.title)}${script}</h1><p class="sub">${esc(h.hook)}</p><a class="btn ${m.layout === 'split' ? 'solid' : ''}" href="#read" data-act="jump" data-to="read">Read the lesson ${arrow}</a></div>`;
  return m.layout === 'split'
    ? `<header class="hero split">${text}${imgBox(h.image, 'grain')}</header>`
    : `<header class="hero center">${imgBox(h.image, 'grain', true)}${text}</header>`;
}

function lessonHTML(ed, h, key) {
  const m = H[key];
  if (!h || h.unavailable) return `<div data-t="${m.t}"><section class="sec"><div class="wrap"><h1 class="display">${esc(m.name)}</h1><p>This section could not be generated for this edition. It will return in a later one.</p></div></section></div>`;
  const p = prog(ed.slug), srcs = Object.fromEntries((h.sources || []).map((s) => [s.id, s]));
  const bm = S.bookmarks.some((b) => b.slug === ed.slug && b.key === key);
  const note = S.notes[`${ed.slug}/${key}`] || '';
  const flags = `<p><span class="badge soft">AI-generated</span><span class="badge soft">${esc(h.status || 'unreviewed')}</span><span class="badge soft">${h.grounded ? 'source-grounded' : 'not source-grounded'}</span></p>`;
  return `<div data-t="${m.t}">${hero(ed, key, h)}
  ${sec('read', '', `${flags}<div class="lede">${md(h.core)}</div>${h.visual ? `<pre>${esc(h.visual)}</pre>` : ''}`)}
  ${sec('', '', `<div class="cols"><div><h2 class="display">Context</h2>${md(h.context)}</div><div><h2 class="display">Where you will see it</h2>${md(h.realWorld)}</div></div>`, true)}
  ${sec('', 'Evidence', h.evidence.map((e) => `<div class="ev"><span class="badge">${LABEL[e.label] || esc(e.label)}</span><span>${esc(e.claim)}${e.source && srcs[e.source] ? ` <a href="${url(srcs[e.source].url)}" target="_blank" rel="noopener">[${esc(e.source)}]</a>` : ''}</span></div>`).join(''))}
  ${sec('', 'Try it', `<p>${esc(h.exercise.prompt)}</p>${h.exercise.answerHint ? `<details><summary>How to check</summary><p>${esc(h.exercise.answerHint)}</p></details>` : ''}${h.checklist?.length ? `<h3 class="display">Checklist</h3><ul>${h.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}`, true)}
  ${sec('', 'Recall', h.quiz.map((q, qi) => { const id = `${key}:${qi}`, pick = p.quiz[id]; return `<div class="quiz"><strong>${esc(q.q)}</strong>${q.options.map((o, oi) => { const st = pick === undefined ? '' : oi === q.answer ? 'ok' : oi === pick ? 'no' : ''; return `<button class="opt ${st}" data-act="quiz" data-k="${key}" data-q="${qi}" data-o="${oi}" ${pick === undefined ? '' : 'disabled'}>${st === 'ok' ? '✓ ' : st === 'no' ? '✗ ' : ''}${esc(o)}</button>`; }).join('')}${pick === undefined ? '' : `<p class="muted">${esc(q.explanation)}</p>`}</div>`; }).join('') + (h.furtherQuestions?.length ? `<h3 class="display">Keep digging</h3><ul>${h.furtherQuestions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''))}
  ${sec('', 'Sources & notes', `${(h.sources || []).length ? `<ul>${h.sources.map((s) => `<li>[${esc(s.id)}] <a href="${url(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="muted">retrieved ${esc(s.retrievedAt || '')}</span></li>`).join('')}</ul>` : '<p>No sources were available. Treat everything here as unverified.</p>'}${h.image ? `<p class="muted">Image: ${esc(h.image.credit)}</p>` : ''}<h3 class="display">Your notes</h3><textarea rows="3" data-note="${esc(key)}" placeholder="Your own observations, kept apart from the lesson text">${esc(note)}</textarea><div class="row"><button data-act="bm" data-k="${key}" class="${bm ? 'on' : ''}">${bm ? '★ Bookmarked' : '☆ Bookmark'}</button><button data-act="clip" data-k="${key}">Clip to board</button><a class="btn" href="#/houses">All houses</a></div>`, true)}
  </div>`;
}

const tile = (ed, k) => { const m = H[k], h = ed.houses?.[k]; return `<a class="tile rv" data-t="${m.t}" href="#/house/${k}">${imgBox(h?.image, '', false)}${prog(ed.slug).seen[k] ? '<span class="tick">Explored</span>' : ''}<div class="tile-t"><div class="kicker">House ${m.num}</div><h3 class="display">${esc(m.name)}</h3><p>${esc(h?.unavailable ? 'Not available this edition' : h?.title || '')}</p></div></a>`; };
const tiles = (ed) => `<div class="tiles">${HOUSES.map((h) => tile(ed, h[0])).join('')}</div>`;

function capsuleCards(ed) {
  const c = ed.capsule || {}, w = c.word, s = c.aiSignal, col = c.colour, t = c.type, i = c.interfaceStudy, o = c.openTab;
  const card = (k, body) => `<div class="ccard rv"><div class="kicker">${k}</div>${body}</div>`;
  return `<div class="cgrid">
   ${w ? card('Word of the day', `<h3>${esc(w.word)}</h3><p class="muted">${esc(w.phonetic)} ${esc(w.pos)}</p><p>${esc(w.definition)}</p><p><em>${esc(w.example)}</em></p><p>${esc(w.exercise)}</p>`) : ''}
   ${s ? card('AI/ML signal', `<h3>${esc(s.title)}</h3><p><span class="badge">${esc(s.kind)}</span> <span class="muted">${esc(s.feed)} · ${fdate(s.date)}</span></p><p>${esc(s.whatHappened)}</p><p>${esc(s.whyItMatters)}</p><p><strong>Takeaway:</strong> ${esc(s.takeaway)}</p><p><a href="${url(s.url)}" target="_blank" rel="noopener">Read the source</a> · <span class="muted">based on a short excerpt</span></p>`) : ''}
   ${col ? card('Colour pairing', `<h3>${esc(col.name)}</h3><p>${col.hexes.map((x) => `<span class="sw" style="background:${colour(x)}" title="${esc(x)}"></span>`).join('')}</p><p class="muted">${col.hexes.map(esc).join(' · ')}</p><p>${esc(col.note)}</p><p>${esc(col.application)}</p><p class="muted">${esc(col.accessibility)}</p>`) : ''}
   ${t ? card('Type specimen', `<h3>${esc(t.font)}</h3><p>${esc(t.character)}</p><p>${esc(t.bestUses)}</p><p><a href="${url(t.url)}" target="_blank" rel="noopener">See it on Google Fonts</a></p>`) : ''}
   ${i ? card('Interface study', `<h3>${esc(i.pattern)}</h3><p>${esc(i.reasoning)}</p><p><strong>Try:</strong> ${esc(i.tryIt)}</p>`) : ''}
   ${o ? card('The open tab', `<h3>${esc(o.name)}</h3><p>${esc(o.what)}</p><p>${esc(o.whyBookmark)}</p><p><a href="${url(o.url)}" target="_blank" rel="noopener">Open it</a> · <span class="muted">${o.verified ? 'reachable ' + esc(o.checkedAt) : 'not verified'}</span></p>`) : ''}
   ${c.challenge ? card('Tiny challenge', `<p style="font-size:1.1rem">${esc(c.challenge)}</p>`) : ''}
  </div>`;
}

function homeHTML(ed) {
  const n = seenCount(ed.slug), older = INDEX.editions.slice(1).find((e) => seenCount(e.slug) < KEYS.length);
  return `<header class="hero center" data-t="home">${imgBox(ed.cover, 'grain', false)}<div class="hero-t">
    <div class="kicker">Edition ${esc(ed.slug)} · ${fdate(ed.publishedAt)}</div>
    <div class="lockup"><h1 class="display wordmark">Curiosity Atelier</h1>
    <div class="spread" aria-hidden="true"><span>Ideas</span><span>woven</span><span>in</span><span>wonder</span></div></div>
    <p class="lead">A learning magazine with a new edition every two days: scripture, mind, sound, code, systems, design and the art of having less.</p>
    <a class="btn" href="#capsule" data-act="jump" data-to="capsule">Enter ${arrow}</a></div></header>
  <section class="band tan" id="capsule"><div class="wrap wide"><div class="kicker" style="color:#22140A">The daily capsule</div><h2 class="display" style="margin:.4rem 0 1.4rem;font-size:clamp(2rem,6vw,4rem)">Little things worth knowing</h2>${capsuleCards(ed)}<p style="margin-top:1.4rem">${esc(ed.theme || '')}</p></div></section>
  <section class="band cobalt"><div class="wrap wide"><div class="kicker" style="color:#fff">The houses</div><h2 class="display" style="margin:.4rem 0 1.4rem;font-size:clamp(2rem,6vw,4rem)">Seven rooms, seven moods</h2>${tiles(ed)}</div></section>
  <section class="band cream"><div class="wrap"><div class="kicker" style="color:#402410">The Dispatch</div><h2 class="display" style="margin:.4rem 0 1rem;font-size:clamp(2rem,6vw,4rem)">Six things worth your attention</h2><ol class="heads">${(ed.dispatch?.headlines || []).map((h) => `<li><div><span class="kicker" style="color:#402410">${esc(H[h.house]?.name || h.house)}</span><b>${esc(h.text)}</b></div></li>`).join('')}</ol><div class="row"><a class="btn" href="#/dispatch">Open the briefing ${arrow}</a></div></div></section>
  <section class="band cobalt cta"><div class="wrap"><div class="bar" style="max-width:420px;margin:0 auto 1rem;color:#fff"><i style="width:${(n / KEYS.length) * 100}%"></i></div><p style="margin:0 auto 1rem">${n} of ${KEYS.length} sections explored in this edition. No deadline, no streaks.</p>${older ? `<p>Catch-up idea: <a href="#/home" data-act="open" data-s="${older.slug}">Edition ${esc(older.slug)}</a> still has ${KEYS.length - seenCount(older.slug)} unexplored sections.</p>` : ''}<h2 class="display" style="font-size:clamp(2.2rem,7vw,5rem);margin:1rem 0">Let's keep wondering</h2><a class="btn" href="#/archive">Open the archive</a></div></section>
  <footer class="foot">The Curiosity Atelier · Edition ${esc(ed.slug)}<br>Written by free AI models from cited sources · images are AI illustrations${ed.generator?.failed?.length ? '<br>Missing this time: ' + esc(ed.generator.failed.join(', ')) : ''}</footer>`;
}

function dispatchHTML(ed) {
  const d = ed.dispatch, mode = S.dmode || 'headline';
  const tabs = ['headline', 'briefing', 'deep'].map((m) => `<button data-act="dmode" data-m="${m}" class="${m === mode ? 'on' : ''}">${m === 'deep' ? 'Deep reading' : m}</button>`).join('');
  let body = '';
  if (mode === 'headline') body = `<ol class="heads">${d.headlines.map((h) => `<li><div><span class="kicker">${esc(H[h.house]?.name || h.house)}</span><b>${esc(h.text)}</b></div></li>`).join('')}</ol>`;
  if (mode === 'briefing') body = d.briefing.map((b) => `<div class="card" style="margin-bottom:1rem"><div class="kicker">${esc(H[b.house]?.name || b.house)}</div><h3 class="display">${esc(b.title)}</h3><p>${esc(b.text)}</p>${(b.sources || []).map((u) => `<a href="${url(u)}" target="_blank" rel="noopener">source</a> `).join('')}</div>`).join('');
  if (mode === 'deep') body = tiles(ed);
  return `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">The Dispatch · Edition ${esc(ed.slug)}</div><h1 class="display" style="margin:.5rem 0">The Briefing</h1><div class="tabs">${tabs}</div>${body}<p class="muted" style="margin-top:2rem">${(d.plus || []).map(esc).join(' · ')}</p></div></section>`;
}

function puzzleHTML(ed) {
  const z = ed.puzzle, done = prog(ed.slug).puzzle;
  const inner = z.type === 'latin'
    ? `<p>${esc(z.prompt)}</p><div class="latin" id="latin">${z.grid.flat().map((v, i) => `<input inputmode="numeric" maxlength="1" aria-label="cell ${i + 1}" data-i="${i}" ${v ? `value="${v}" disabled` : ''}>`).join('')}</div>`
    : `<p style="font-size:1.3rem;max-width:40ch">${esc(z.prompt)}</p><input id="pans" placeholder="Your answer" autocomplete="off" style="max-width:360px">`;
  return `<section class="sec" style="min-height:80vh"><div class="wrap"><div class="kicker">Edition ${esc(ed.slug)} · rotating puzzle</div><h1 class="display" style="margin:.5rem 0 1.5rem">${esc(z.title)}</h1>${inner}<div class="row"><button data-act="puz">Check</button><button data-act="reveal">Show explanation</button></div><p id="pmsg">${done ? '✔ Solved earlier.' : ''}</p><div id="pexp" hidden>${md(z.explanation)}${z.answer ? `<p><strong>Answer:</strong> ${esc(z.answer)}</p>` : ''}</div></div></section>`;
}

function archiveHTML() {
  const cards = INDEX.editions.map((e) => `<div class="arch" data-t="${['home', 'blue', 'tan'][e.n % 3]}">${imgBox(e.cover ? { src: e.cover, credit: 'AI illustration' } : null, '', false)}<div class="in"><div class="kicker" style="color:inherit">Edition ${esc(e.slug)} · ${fdate(e.publishedAt)}</div><p style="margin:0">${esc(e.theme)}</p><div class="bar" style="width:100%"><i style="width:${(seenCount(e.slug) / KEYS.length) * 100}%"></i></div><span class="muted">${seenCount(e.slug)} / ${KEYS.length} explored</span><button data-act="open" data-s="${e.slug}">${S.cur === e.slug ? 'Currently open' : 'Open'}</button></div></div>`).join('');
  const bms = S.bookmarks.map((b) => `<li><a href="#/house/${b.key}" data-act="open" data-s="${b.slug}">${esc(b.title)}</a> <span class="muted">· edition ${esc(b.slug)}</span></li>`).join('') || '<li class="muted">Nothing bookmarked yet.</li>';
  const wr = S.wrong.map((w) => `<li><strong>${esc(w.q)}</strong><br><span class="muted">Answer: ${esc(w.correct)} · edition ${esc(w.slug)}</span></li>`).join('') || '<li class="muted">No missed questions. Or none attempted yet.</li>';
  const notes = Object.entries(S.notes).filter(([, v]) => v).map(([k, v]) => `<li><span class="muted">${esc(k)}</span><br>${esc(v)}</li>`).join('') || '<li class="muted">No notes yet.</li>';
  return `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">Learning ledger</div><h1 class="display" style="margin:.5rem 0 1.5rem">Archive & review</h1><div class="archgrid">${cards}</div>
  <h2 class="display" style="margin-top:3rem">Review room</h2><div class="cols"><div class="card"><h3 class="display">Bookmarks</h3><ul>${bms}</ul></div><div class="card"><h3 class="display">Questions to revisit</h3><ul>${wr}</ul></div></div><div class="card" style="margin-top:1.2rem"><h3 class="display">Your notes</h3><ul>${notes}</ul></div>
  <h2 class="display" style="margin-top:3rem">Your data</h2><p class="muted">Everything lives in this browser. Export a backup now and then.</p><div class="row"><button data-act="export">Export JSON</button><button data-act="import">Import JSON</button><input type="file" id="imp" accept="application/json" hidden></div></div></section>`;
}

// ---------- mind board ----------
function boardHTML() {
  const B = S.board;
  return `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">Mind board</div><h1 class="display" style="margin:.5rem 0 1rem">Where curiosity gets messy</h1>
  <div class="row"><input id="bnew" placeholder="Paste a thought, quote or URL" style="flex:1;min-width:200px"><button data-act="badd">Add card</button><button data-act="bconn" class="${S.connect ? 'on' : ''}">${S.connect ? 'Pick two cards…' : 'Connect cards'}</button></div>
  <div class="board" id="board"><div class="canvas" id="canvas"><svg id="lines"></svg>
  ${B.cards.map((c) => `<div class="bc ${S.connect === c.id ? 'pick' : ''}" data-card="${c.id}" style="left:${c.x}px;top:${c.y}px"><div class="chead" data-drag="${c.id}"><span>${esc(c.type)}</span><b data-act="bdel" data-id="${c.id}" title="Delete">×</b></div><div class="cbody" ${c.type === 'url' ? '' : 'contenteditable="true"'} data-cid="${c.id}">${c.type === 'url' ? `<a href="${url(c.text)}" target="_blank" rel="noopener">${esc(c.text)}</a>` : esc(c.text)}</div></div>`).join('')}
  </div></div><p class="muted">Drag by the dark bar. Tap a line to remove a connection. Cards are private to this browser.</p></div></section>`;
}
function drawLines() {
  const svg = $('#lines'); if (!svg) return;
  const c = (id) => { const e = $(`[data-card="${id}"]`); return e ? [e.offsetLeft + e.offsetWidth / 2, e.offsetTop + e.offsetHeight / 2] : null; };
  svg.innerHTML = S.board.links.map((l, i) => { const a = c(l[0]), b = c(l[1]); if (!a || !b) return ''; const d = `x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"`; return `<line ${d}/><line class="hit" data-link="${i}" ${d}/>`; }).join('');
}
function wireBoard() {
  const board = $('#board'); if (!board) return;
  drawLines();
  board.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-drag]'); if (!h || e.target.closest('[data-act]')) return;
    const el = h.parentElement, c = S.board.cards.find((x) => x.id === h.dataset.drag);
    const sx = e.clientX, sy = e.clientY, ox = c.x, oy = c.y;
    h.setPointerCapture(e.pointerId);
    const mv = (ev) => { c.x = Math.max(0, ox + ev.clientX - sx); c.y = Math.max(0, oy + ev.clientY - sy); el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; drawLines(); };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); save(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
  });
  board.addEventListener('input', (e) => { const b = e.target.closest('[data-cid]'); if (!b) return; const c = S.board.cards.find((x) => x.id === b.dataset.cid); if (c) { c.text = b.innerText; save(); } });
}
const addCard = (text, x, y) => { const t = text.trim(); if (!t) return; const n = S.board.cards.length; S.board.cards.push({ id: 'c' + Date.now() + Math.floor(Math.random() * 99), type: /^https?:\/\//i.test(t) ? 'url' : 'note', text: t, x: x ?? 30 + (n % 4) * 240, y: y ?? 30 + Math.floor(n / 4) * 170 }); save(); };

// ---------- routing & render ----------
const THEME_FOR = { home: 'home', houses: 'home', dispatch: 'blue', puzzle: 'tan', board: 'tan', archive: 'home' };
let io;
function reveal() {
  io?.disconnect();
  const els = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}
async function render(top = true) {
  const route = (location.hash.split('/')[1] || 'home').split('?')[0], arg = location.hash.split('/')[2];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === route || (route === 'house' && a.dataset.r === 'houses')));
  const theme = route === 'house' && H[arg] ? H[arg].t : THEME_FOR[route] || 'home';
  document.body.dataset.t = theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#EDE5D4');
  const app = $('#app');
  if (!INDEX.editions.length) { app.innerHTML = `<section class="sec"><div class="wrap"><h1 class="display">No edition yet</h1><p>The first edition is created by the scheduled GitHub Action. Open your repository, go to Actions, choose "site", and run it with force ticked. Refresh this page in a few minutes.</p></div></section>`; return; }
  if (!INDEX.editions.some((e) => e.slug === S.cur)) S.cur = INDEX.editions[0].slug;
  if (route === 'board') { app.innerHTML = boardHTML(); wireBoard(); if (top) scrollTo(0, 0); return; }
  if (route === 'archive') { app.innerHTML = archiveHTML(); if (top) scrollTo(0, 0); return; }
  let ed;
  try { ed = await edition(S.cur); } catch { app.innerHTML = '<p class="pad">Could not load this edition. Check your connection and try again.</p>'; return; }
  if (route === 'house' && H[arg]) { seen(ed.slug, arg); app.innerHTML = lessonHTML(ed, ed.houses[arg], arg); }
  else if (route === 'houses' || route === 'house') app.innerHTML = `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">Edition ${esc(ed.slug)}</div><h1 class="display" style="margin:.5rem 0 1.5rem">The houses</h1>${tiles(ed)}</div></section>`;
  else if (route === 'dispatch') app.innerHTML = dispatchHTML(ed);
  else if (route === 'puzzle') { seen(ed.slug, 'puzzle'); app.innerHTML = puzzleHTML(ed); }
  else { seen(ed.slug, 'capsule'); app.innerHTML = homeHTML(ed); }
  reveal();
  if (top) scrollTo(0, 0);
}

// ---------- events ----------
document.addEventListener('error', (e) => { if (e.target?.tagName === 'IMG') e.target.remove(); }, true);   // missing image -> generated art shows through
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]'); if (!t) { const ln = e.target.closest('[data-link]'); if (ln) { S.board.links.splice(Number(ln.dataset.link), 1); save(); drawLines(); } return; }
  const act = t.dataset.act, ed = await edition(S.cur).catch(() => null);
  if (act === 'jump') { e.preventDefault(); document.getElementById(t.dataset.to)?.scrollIntoView({ behavior: 'smooth' }); }
  else if (act === 'quiz' && ed) {
    const h = ed.houses[t.dataset.k], qi = Number(t.dataset.q), oi = Number(t.dataset.o), q = h.quiz[qi], y = scrollY;
    prog(ed.slug).quiz[`${t.dataset.k}:${qi}`] = oi;
    if (oi !== q.answer && !S.wrong.some((w) => w.slug === ed.slug && w.key === t.dataset.k && w.qi === qi)) S.wrong.push({ slug: ed.slug, key: t.dataset.k, qi, q: q.q, correct: q.options[q.answer] });
    save(); await render(false); scrollTo(0, y);
  } else if (act === 'bm' && ed) {
    const i = S.bookmarks.findIndex((b) => b.slug === ed.slug && b.key === t.dataset.k), y = scrollY;
    if (i >= 0) S.bookmarks.splice(i, 1); else S.bookmarks.push({ slug: ed.slug, key: t.dataset.k, title: ed.houses[t.dataset.k].title });
    save(); await render(false); scrollTo(0, y);
  } else if (act === 'clip' && ed) {
    const h = ed.houses[t.dataset.k]; addCard(`${h.title}: ${h.hook}`); const u = h.sources?.[0]?.url; if (u) addCard(u); t.textContent = 'Clipped ✓';
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
  else if (act === 'badd') { const i = $('#bnew'); addCard(i.value); render(false); }
  else if (act === 'bconn') { S.connect = S.connect ? null : 'pending'; render(false); }
  else if (act === 'bdel') { const id = t.dataset.id; S.board.cards = S.board.cards.filter((c) => c.id !== id); S.board.links = S.board.links.filter((l) => !l.includes(id)); save(); render(false); }
  else if (act === 'export') {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })); a.download = `atelier-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  } else if (act === 'import') $('#imp').click();
});
document.addEventListener('click', (e) => {   // connect mode: pick two cards
  const card = e.target.closest('[data-card]'); if (!card || !S.connect || e.target.closest('[data-act]') || e.target.closest('[data-drag]')) return;
  const id = card.dataset.card;
  if (S.connect === 'pending') { S.connect = id; render(false); return; }
  if (S.connect !== id && !S.board.links.some((l) => l.includes(id) && l.includes(S.connect))) S.board.links.push([S.connect, id]);
  S.connect = null; save(); render(false);
});
document.addEventListener('input', (e) => { const n = e.target.closest('[data-note]'); if (n) { S.notes[`${S.cur}/${n.dataset.note}`] = n.value; save(); } });
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'imp' || !e.target.files[0]) return;
  try { const j = JSON.parse(await e.target.files[0].text()); if (j && typeof j === 'object' && confirm('Replace your current data with this backup?')) { S = { ...S, ...j }; await kvSet('state', S); render(); } } catch { alert('That file could not be read.'); }
});
addEventListener('hashchange', () => render());

// ---------- boot ----------
(async () => {
  const saved = await kvGet('state'); if (saved) S = { ...S, ...saved }; S.connect = null;
  try { INDEX = await (await fetch('data/index.json')).json(); } catch { INDEX = { editions: [] }; }
  await render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
