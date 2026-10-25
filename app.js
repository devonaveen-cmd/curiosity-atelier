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
  ['theology', 'I', 'Theology', 'oxblood', 'split'], ['mindcraft', 'II', 'Mindcraft', 'sky', 'split'], ['soundroom', 'III', 'Soundroom', 'crimson', 'center'],
  ['aiml', 'IV', 'AI/ML Fieldnotes', 'neon', 'center'], ['systems', 'V', 'Systems Forge', 'blue', 'center'], ['design', 'VI', 'Design Observatory', 'green', 'split'], ['frugal', '✦', 'Frugal Chic', 'tan', 'split']
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

function capsuleCards(ed) {
  const c = ed.capsule || {}, w = c.word, s = c.aiSignal, col = c.colour, t = c.type, i = c.interfaceStudy, o = c.openTab;
  const p = prog(ed.slug);
  const card = (k, body) => `<div class="ccard rv"><div class="kicker">${burst(14)}<span>${k}</span></div>${body}</div>`;
  return `<div class="cgrid">
   ${w ? card('Word of the day', `<h3>${esc(w.word)}</h3><p class="muted">${esc(w.phonetic)} ${esc(w.pos)}</p><p>${esc(w.definition)}</p><p><em>${esc(w.example)}</em></p><p>${esc(w.exercise)}</p><div class="row" style="margin:.3rem 0 0"><button data-act="say" data-w="${esc(w.word)}">🔊 Hear it</button></div>`) : ''}
   ${s ? card('AI/ML signal', `<h3>${esc(s.title)}</h3><p><span class="badge">${esc(s.kind)}</span> <span class="muted">${esc(s.feed)} · ${fdate(s.date)}</span></p><p>${esc(s.whatHappened)}</p><p>${esc(s.whyItMatters)}</p><p><strong>Takeaway:</strong> ${esc(s.takeaway)}</p><p><a href="${url(s.url)}" target="_blank" rel="noopener">Read the source</a> · <span class="muted">based on a short excerpt</span></p>`) : ''}
   ${col ? card('Colour pairing', `<h3>${esc(col.name)}</h3><div class="pal">${col.hexes.map((x) => `<button class="sw" style="background:${colour(x)}" data-act="copyhex" data-hex="${esc(x)}" title="Copy ${esc(x)}" aria-label="Copy ${esc(x)}"></button>`).join('')}</div><div class="pv" id="pv" style="--pa:${colour(col.hexes[0])};--pb:${colour(col.hexes[1])};--pc:${colour(col.hexes[2])}"><b>Aa</b><span>Text on background</span><i></i></div><div class="row" style="margin:.2rem 0"><button data-act="swap">Swap colours</button></div><p class="muted">${col.hexes.map(esc).join(' · ')} (tap a swatch to copy)</p><p>${esc(col.note)}</p><p>${esc(col.application)}</p><p class="muted">${esc(col.accessibility)}</p>`) : ''}
   ${t ? card('Type specimen', `<h3>${esc(t.font)}</h3><p>${esc(t.character)}</p><p>${esc(t.bestUses)}</p><p><a href="${url(t.url)}" target="_blank" rel="noopener">See it on Google Fonts</a></p>`) : ''}
   ${i ? card('Interface study', `<h3>${esc(i.pattern)}</h3><p>${esc(i.reasoning)}</p><p><strong>Try:</strong> ${esc(i.tryIt)}</p>`) : ''}
   ${o ? card('The open tab', `<h3>${esc(o.name)}</h3><p>${esc(o.what)}</p><p>${esc(o.whyBookmark)}</p><p><a href="${url(o.url)}" target="_blank" rel="noopener">Open it</a> · <span class="muted">${o.verified ? 'reachable ' + esc(o.checkedAt) : 'not verified'}</span></p>`) : ''}
   ${c.challenge ? card('Tiny challenge', `<p style="font-size:1.1rem">${esc(c.challenge)}</p><label class="chk"><input type="checkbox" data-chk="challenge" ${p.challenge ? 'checked' : ''}> Mark as done</label>`) : ''}
  </div>`;
}

function homeHTML(ed) {
  const n = seenCount(ed.slug), older = INDEX.editions.slice(1).find((e) => seenCount(e.slug) < KEYS.length);
  const i = INDEX.editions.findIndex((e) => e.slug === ed.slug), prev = INDEX.editions[i + 1], next = INDEX.editions[i - 1];
  const nav = (prev || next) ? `<span class="nav">${prev ? `<a href="#/home" data-act="open" data-s="${prev.slug}" title="Older edition">◂ ${esc(prev.slug)}</a>` : ''}${next ? `<a href="#/home" data-act="open" data-s="${next.slug}" title="Newer edition">${esc(next.slug)} ▸</a>` : ''}</span>` : '';
  return `<header class="hero center" data-t="home">${imgBox(ed.cover, '', false)}<div class="hero-t">
    <div class="kicker">${burst(16)}<span>Edition ${esc(ed.slug)}</span><i>·</i><span>${fdate(ed.publishedAt)}</span>${nav}</div>
    <div class="lockup"><h1 class="display wordmark">Curiosity Atelier</h1>
    <div class="spread" aria-hidden="true"><span>Ideas</span><span>woven</span><span>in</span><span>wonder</span></div></div>
    <p class="lead">A learning magazine with a new edition every two days: scripture, mind, sound, code, systems, design and the art of having less.</p>
    <a class="btn" href="#capsule" data-act="jump" data-to="capsule">Enter ${arrow}</a></div></header>
  <section class="band tan" id="capsule"><div class="wrap wide"><div class="kicker" style="color:#22140A">${burst(16)}<span>The daily capsule</span></div><h2 class="display" style="margin:.4rem 0 1.4rem;font-size:clamp(2rem,6vw,4rem)">Little things worth knowing</h2>${capsuleCards(ed)}<p style="margin-top:1.4rem">${esc(ed.theme || '')}</p></div></section>
  <section class="band cobalt"><div class="wrap wide"><div class="kicker" style="color:#fff">${burst(16)}<span>The houses</span></div><h2 class="display" style="margin:.4rem 0 1.4rem;font-size:clamp(2rem,6vw,4rem)">Seven rooms, seven moods</h2>${tiles(ed)}</div></section>
  <section class="band cream"><div class="wrap"><div class="kicker" style="color:#402410">${burst(16)}<span>The Dispatch</span></div><h2 class="display" style="margin:.4rem 0 1rem;font-size:clamp(2rem,6vw,4rem)">Six things worth your attention</h2><ol class="heads">${(ed.dispatch?.headlines || []).map((h) => `<li><div><span class="kicker" style="color:#402410">${esc(H[h.house]?.name || h.house)}</span><b>${esc(h.text)}</b></div></li>`).join('')}</ol><div class="row"><a class="btn" href="#/dispatch">Open the briefing ${arrow}</a></div></div></section>
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
  const cards = INDEX.editions.map((e) => `<div class="arch" data-t="${['home', 'blue', 'tan'][e.n % 3]}">${imgBox(e.cover ? { src: e.cover, credit: 'AI illustration' } : null, '', false)}<div class="in"><div class="kicker" style="color:inherit">${burst(14)}<span>Edition ${esc(e.slug)}</span><i>·</i><span>${fdate(e.publishedAt)}</span></div><p style="margin:0">${esc(e.theme)}</p><div class="bar" style="width:100%"><i style="width:${(seenCount(e.slug) / KEYS.length) * 100}%"></i></div><span class="muted">${seenCount(e.slug)} / ${KEYS.length} explored</span><button data-act="open" data-s="${e.slug}">${S.cur === e.slug ? 'Currently open' : 'Open'}</button></div></div>`).join('');
  const bms = S.bookmarks.map((b) => `<li><a href="#/house/${b.key}" data-act="open" data-s="${b.slug}">${esc(b.title)}</a> <span class="muted">· edition ${esc(b.slug)}</span></li>`).join('') || '<li class="muted">Nothing bookmarked yet.</li>';
  const wr = S.wrong.map((w) => `<li><strong>${esc(w.q)}</strong><br><span class="muted">Answer: ${esc(w.correct)} · edition ${esc(w.slug)}</span></li>`).join('') || '<li class="muted">No missed questions. Or none attempted yet.</li>';
  const notes = Object.entries(S.notes).filter(([, v]) => v).map(([k, v]) => `<li><span class="muted">${esc(k)}</span><br>${esc(v)}</li>`).join('') || '<li class="muted">No notes yet.</li>';
  return `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">${burst(16)}<span>Learning ledger</span></div><h1 class="display" style="margin:.5rem 0 1.5rem">Archive & review</h1><div class="archgrid">${cards}</div>
  <h2 class="display" style="margin-top:3rem">Review room</h2><div class="cols" style="margin-top:1rem"><div class="card"><h3 class="display" style="margin-top:0">Bookmarks</h3><ul>${bms}</ul></div><div class="card"><h3 class="display" style="margin-top:0">Questions to revisit</h3><ul>${wr}</ul></div></div><div class="card" style="margin-top:1.2rem"><h3 class="display" style="margin-top:0">Your notes</h3><ul>${notes}</ul></div>
  <h2 class="display" style="margin-top:3rem">Your data</h2><p class="muted">Everything lives in this browser. Export a backup now and then.</p><div class="row"><button data-act="export">Export JSON</button><button data-act="import">Import JSON</button><input type="file" id="imp" accept="application/json" hidden></div></div></section>`;
}

// ---------- mind board ----------
function boardHTML() {
  const B = S.board;
  return `<section class="sec" style="min-height:80vh"><div class="wrap wide"><div class="kicker">${burst(16)}<span>Mind board</span></div><h1 class="display" style="margin:.5rem 0 1rem">Where curiosity gets messy</h1>
  <div class="row"><input id="bnew" placeholder="Paste a thought, quote or URL" style="flex:1;min-width:200px"><button data-act="badd">Add card</button><button data-act="bconn" class="${S.connect ? 'on' : ''}">${S.connect ? 'Pick two cards…' : 'Connect cards'}</button></div>
  <div class="board" id="board"><div class="canvas" id="canvas"><svg id="lines"></svg>
  ${B.cards.map((c) => `<div class="bc ${S.connect === c.id ? 'pick' : ''}" data-card="${c.id}" style="left:${c.x}px;top:${c.y}px"><div class="chead" data-drag="${c.id}"><span>${esc(c.type)}</span><b data-act="bdel" data-id="${c.id}" title="Delete">×</b></div><div class="cbody" ${c.type === 'url' ? '' : 'contenteditable="true"'} data-cid="${c.id}">${c.type === 'url' ? `<a href="${url(c.text)}" target="_blank" rel="noopener">${esc(c.text)}</a>` : esc(c.text)}</div></div>`).join('')}
  </div></div><p class="muted">Drag by the dark bar. Tap a line to remove a connection. Select any text in a lesson and tap "Clip" to drop it here. Cards stay private in this browser.</p></div></section>`;
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
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === route || (route === 'house' && a.dataset.r === 'houses')));
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
  else if (route === 'dispatch') app.innerHTML = dispatchHTML(ed);
  else if (route === 'puzzle') { seen(ed.slug, 'puzzle'); app.innerHTML = puzzleHTML(ed); }
  else { seen(ed.slug, 'capsule'); app.innerHTML = homeHTML(ed); }
  reveal(); onScroll();
  if (top) scrollTo(0, 0);
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
  if (act === 'jump') { e.preventDefault(); document.getElementById(t.dataset.to)?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (act === 'gl') { showPop(t, GL[Number(t.dataset.i)] || { term: '', definition: '' }); return; }
  if (act === 'flip') { t.classList.toggle('on'); return; }
  if (act === 'ef') { const list = t.closest('.sec').querySelector('.evlist'); t.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === t)); if (t.dataset.f) list.dataset.f = t.dataset.f; else delete list.dataset.f; return; }
  if (act === 'size+' || act === 'size-') { S.prefs.size = Math.max(0, Math.min(2, S.prefs.size + (act === 'size+' ? 1 : -1))); save(); applyPrefs(true); toast(['Smaller text', 'Normal text', 'Larger text'][S.prefs.size]); return; }
  if (act === 'focus') { S.prefs.focus = !S.prefs.focus; save(); const y = scrollY; await render(false); scrollTo(0, y); return; }
  if (act === 'top') { scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (act === 'copyhex') { try { await navigator.clipboard.writeText(t.dataset.hex); toast(`Copied ${t.dataset.hex}`); } catch { toast(t.dataset.hex); } return; }
  if (act === 'swap') { $('#pv')?.classList.toggle('swap'); return; }
  if (act === 'say') { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.dataset.w); u.lang = 'en'; u.rate = .85; speechSynthesis.speak(u); } catch { toast('Speech is not available here'); } return; }
  if (act === 'clipsel') { addCard(`“${selText}” — ${$('.lesson')?.dataset.title || 'lesson'}`); $('#clipfab').hidden = true; getSelection()?.removeAllRanges(); toast('Clipped to your board'); return; }
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
    const h = ed.houses[t.dataset.k]; addCard(`${h.title}: ${h.hook}`); const u = h.sources?.[0]?.url; if (u) addCard(u); toast('Clipped to your board');
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
document.addEventListener('click', (e) => {   // board connect mode: pick two cards
  const card = e.target.closest('[data-card]'); if (!card || !S.connect || e.target.closest('[data-act]') || e.target.closest('[data-drag]')) return;
  const id = card.dataset.card;
  if (S.connect === 'pending') { S.connect = id; render(false); return; }
  if (S.connect !== id && !S.board.links.some((l) => l.includes(id) && l.includes(S.connect))) S.board.links.push([S.connect, id]);
  S.connect = null; save(); render(false);
});
document.addEventListener('input', (e) => { const n = e.target.closest('[data-note]'); if (n) { S.notes[`${S.cur}/${n.dataset.note}`] = n.value; save(); } });
document.addEventListener('change', async (e) => {
  if (e.target.matches('[data-chk]')) { prog(S.cur)[e.target.dataset.chk] = e.target.checked; save(); toast(e.target.checked ? 'Nice. Marked as done' : 'Unmarked'); return; }
  if (e.target.id !== 'imp' || !e.target.files[0]) return;
  try { const j = JSON.parse(await e.target.files[0].text()); if (j && typeof j === 'object' && confirm('Replace your current data with this backup?')) { S = { ...S, ...j }; await kvSet('state', S); render(); } } catch { alert('That file could not be read.'); }
});
document.addEventListener('mouseup', checkSelection);
document.addEventListener('touchend', checkSelection);
document.addEventListener('keyup', (e) => { if (e.key === 'Escape') { hidePop(); $('#clipfab') && ($('#clipfab').hidden = true); if (S.prefs.focus) { S.prefs.focus = false; save(); render(false); } } else if (e.key.startsWith('Arrow') && e.shiftKey) checkSelection(); });
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => applyPrefs(document.body.classList.contains('focus') || !!$('.lesson')));
addEventListener('hashchange', () => render());

// ---------- boot ----------
(async () => {
  const saved = await kvGet('state'); if (saved) S = { ...S, ...saved, prefs: { size: 1, focus: false, ...(saved.prefs || {}) } }; S.connect = null;
  document.body.insertAdjacentHTML('beforeend', '<div id="pop" hidden role="dialog"></div><div id="clipfab" hidden><button data-act="clipsel" onmousedown="event.preventDefault()">Clip to board</button></div><div id="toast" role="status" aria-live="polite"></div>');
  try { INDEX = await (await fetch('data/index.json')).json(); } catch { INDEX = { editions: [] }; }
  await render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
