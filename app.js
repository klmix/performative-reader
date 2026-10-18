'use strict';

/* ───────────────────────── helpers ───────────────────────── */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const EPS = 1e-6;
const r2 = (v) => Math.round(v * 100) / 100;
const keyOf = (v) => String(r2(Number(v)));
const fmt = (v) => r2(v).toFixed(2).replace(/\.?0+$/, '');
const sumOf = (a) => a.reduce((s, x) => s + x, 0);

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'style') for (const [p, x] of Object.entries(v)) e.style.setProperty(p, x);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
  return e;
}

function hashStr(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fillSelect(sel, options, value) {
  sel.replaceChildren(...options.map(([v, label]) => h('option', { value: String(v) }, label)));
  sel.value = String(value);
}

function setSeg(root, value) {
  $$('button', $(root)).forEach((b) => b.classList.toggle('active', b.dataset.v === String(value)));
}

const today = () => new Date().toISOString().slice(0, 10);

/* ───────────────────────── CSV ───────────────────────── */

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const csvCell = (v) => {
  v = v == null ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/* ───────────────────────── library import ───────────────────────── */

const COLS = {
  id: ['Book Id'],
  title: ['Title'],
  author: ['Author', 'Authors'],
  isbn: ['ISBN', 'ISBN/UID'],
  isbn13: ['ISBN13'],
  rating: ['My Rating', 'Star Rating'],
  avg: ['Average Rating'],
  year: ['Original Publication Year', 'Year Published'],
  dateRead: ['Date Read', 'Last Date Read'],
  dateAdded: ['Date Added'],
  shelf: ['Exclusive Shelf', 'Read Status'],
  perfRating: ['Performative Rating'],
  perfRank: ['Performative Rank'],
};

function colIndex(headers) {
  const norm = headers.map((x) => x.trim().toLowerCase());
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) {
    idx[k] = -1;
    for (const n of names) {
      const i = norm.indexOf(n.toLowerCase());
      if (i >= 0) { idx[k] = i; break; }
    }
  }
  return idx;
}

const cleanIsbn = (s) => {
  const d = (s || '').replace(/[^0-9Xx]/g, '');
  return d.length === 10 || d.length === 13 ? d : '';
};

function parseLibrary(text) {
  const all = parseCSV(text);
  if (all.length < 2) throw new Error('That file looks empty.');
  const headers = all[0].map((x) => x.trim());
  const rows = all.slice(1);
  const ci = colIndex(headers);
  if (ci.title < 0 || ci.rating < 0) {
    throw new Error('Couldn’t find “Title” and “My Rating” columns — is this a Goodreads export?');
  }
  const get = (row, k) => (ci[k] >= 0 ? (row[ci[k]] ?? '').trim() : '');
  const books = [];
  const seen = new Set();
  let skipped = 0;
  rows.forEach((row, rowIndex) => {
    if (ci.shelf >= 0 && get(row, 'shelf').toLowerCase() !== 'read') { skipped++; return; }
    const title = get(row, 'title') || 'Untitled';
    const author = get(row, 'author');
    let id = get(row, 'id') || 'h' + hashStr(title + '|' + author).toString(36);
    while (seen.has(id)) id += '_';
    seen.add(id);
    const gr = parseFloat(get(row, 'rating')) || 0;
    const perf = parseFloat(get(row, 'perfRating')) || 0;
    const rank = parseInt(get(row, 'perfRank'), 10);
    books.push({
      id, rowIndex, title, author,
      isbn: cleanIsbn(get(row, 'isbn13')) || cleanIsbn(get(row, 'isbn')),
      avg: parseFloat(get(row, 'avg')) || 0,
      year: get(row, 'year'),
      dateRead: get(row, 'dateRead'),
      dateAdded: get(row, 'dateAdded'),
      original: gr,
      start: perf || gr || null,
      rank: Number.isFinite(rank) && rank > 0 ? rank : null,
    });
  });
  return { headers, rows, books, skipped };
}

/* ───────────────────────── scales ───────────────────────── */

const STEP_MINS = { 1: [1], 0.5: [0.5, 1], 0.25: [0.25, 0.5, 0.75, 1] };
const STEP_MAXES = { 1: [5, 6], 0.5: [5, 5.5], 0.25: [5, 5.25, 5.5, 5.75] };

function scalePoints({ step, min, max }) {
  const out = [];
  for (let i = 0; i < 100; i++) {
    const v = r2(min + i * step);
    if (v > max + EPS) break;
    out.push(v);
  }
  return out;
}

function fitScale(scale) {
  const { step } = scale;
  const min = STEP_MINS[step].includes(scale.min) ? scale.min : 1;
  const max = STEP_MAXES[step].filter((m) => m <= scale.max + EPS).pop() ?? 5;
  return { step, min, max };
}

function inferScale(values) {
  let step = 1;
  for (const v of values) {
    if (Math.abs(v * 2 - Math.round(v * 2)) > EPS) step = 0.25;
    else if (step === 1 && Math.abs(v - Math.round(v)) > EPS) step = 0.5;
  }
  const lo = Math.min(1, ...values), hi = Math.max(5, ...values);
  const min = STEP_MINS[step].filter((m) => m <= lo + EPS).pop() ?? STEP_MINS[step][0];
  const max = STEP_MAXES[step].find((m) => m >= hi - EPS) ?? STEP_MAXES[step].at(-1);
  return { step, min, max };
}

function tierStyle(v) {
  if (v > 5 + EPS) return { '--tier': 'var(--gold)', '--tier-ink': '#3a2800' };
  const t = Math.min(1, Math.max(0, (5 - v) / 4));
  const hue = 25 + t * 235;
  return { '--tier': `oklch(0.8 0.12 ${hue})`, '--tier-ink': `oklch(0.27 0.06 ${hue})` };
}

/* ───────────────────────── distribution math ───────────────────────── */

function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = (x, mu, sd) => 0.5 * (1 + erf((x - mu) / (sd * Math.SQRT2)));
const normalBin = (p, mu, sd, step) => Math.max(0, normCdf(p + step / 2, mu, sd) - normCdf(p - step / 2, mu, sd));

/**
 * Split n books across rating points (ascending) proportionally to weights,
 * honouring per-point rules: {mode: 'max'|'min'|'exact', n}.
 */
function allocate(pts, weights, n, rules) {
  const k = pts.length;
  const counts = new Array(k).fill(0);
  const fixed = new Array(k).fill(false);
  const rule = (i) => rules[keyOf(pts[i])];
  let warning = '';

  for (let i = 0; i < k; i++) {
    if (rule(i)?.mode === 'exact') { counts[i] = rule(i).n; fixed[i] = true; }
  }

  for (let guard = 0; guard <= k + 1; guard++) {
    const free = [];
    for (let i = 0; i < k; i++) if (!fixed[i]) free.push(i);
    if (!free.length) break;
    const remaining = n - sumOf(counts.filter((_, i) => fixed[i]));
    if (remaining <= 0) { free.forEach((i) => (counts[i] = 0)); break; }

    const W = sumOf(free.map((i) => weights[i]));
    const raw = new Map(free.map((i) => [i, W > 0 ? (remaining * weights[i]) / W : remaining / free.length]));

    let changed = false;
    for (const i of free) {
      const c = rule(i);
      if (!c) continue;
      if ((c.mode === 'max' && raw.get(i) > c.n + EPS) || (c.mode === 'min' && raw.get(i) < c.n - EPS)) {
        counts[i] = c.n; fixed[i] = true; changed = true;
      }
    }
    if (changed) continue;

    // largest-remainder rounding
    let used = 0;
    const fractions = [];
    for (const i of free) {
      const f = Math.floor(raw.get(i));
      counts[i] = f;
      used += f;
      fractions.push([raw.get(i) - f, i]);
    }
    fractions.sort((a, b) => b[0] - a[0] || weights[b[1]] - weights[a[1]]);
    for (let j = 0; j < remaining - used; j++) counts[fractions[j % fractions.length][1]]++;
    break;
  }

  let total = sumOf(counts);
  if (total > n) {
    warning = `Your rules ask for ${total} books, but only ${n} are ranked — trimmed from the bottom tiers.`;
    for (let i = 0; i < k && total > n; i++) {
      const d = Math.min(counts[i], total - n);
      counts[i] -= d;
      total -= d;
    }
  } else if (total < n) {
    warning = `Your rules only leave room for ${total} of ${n} books — the rest go where the curve wants them anyway.`;
    const order = [...counts.keys()].sort((a, b) => weights[b] - weights[a]);
    for (let j = 0; total < n; j++, total++) counts[order[j % order.length]]++;
  }
  return { counts, warning };
}

function ratingMap(st) {
  const m = new Map();
  for (const [k, ids] of Object.entries(st.placement)) for (const id of ids) m.set(id, Number(k));
  return m;
}

function rankedIds(st) {
  return Object.keys(st.placement).map(Number).sort((a, b) => b - a).flatMap((v) => st.placement[keyOf(v)]);
}

function ruleFor(v) {
  return state.dist.rules[keyOf(v)] || (v > 5 + EPS ? { mode: 'max', n: 1 } : { mode: 'auto', n: 0 });
}

function describe(values) {
  const n = values.length;
  if (!n) return { mean: 0, sd: 0 };
  const mean = sumOf(values) / n;
  const sd = Math.sqrt(sumOf(values.map((v) => (v - mean) ** 2)) / n);
  return { mean, sd };
}

function computeProposal(st) {
  const d = st.dist;
  const pts = scalePoints(d);
  const ids = rankedIds(st);
  const result = new Map();
  let warning = '';

  const assignFromTop = (list, points, counts) => {
    let pos = 0;
    for (let i = points.length - 1; i >= 0; i--) for (let c = 0; c < counts[i]; c++) result.set(list[pos++], points[i]);
  };

  if (d.method === 'refine') {
    const tiers = Object.keys(st.placement).map(Number).sort((a, b) => b - a);
    for (const v of tiers) {
      const tierIds = st.placement[keyOf(v)];
      if (!tierIds.length) continue;
      let sub = pts.filter((p) => Math.abs(p - v) <= d.spread + EPS);
      if (!sub.length) sub = [pts.reduce((best, p) => (Math.abs(p - v) < Math.abs(best - v) ? p : best), pts[0])];
      // tiny bias towards the tier's own value so small tiers don't drift on ties
      const w = sub.map((p) => (d.shape === 'bell' ? normalBin(p, v, d.spread * 0.55, d.step) : 1) - 1e-9 * Math.abs(p - v));
      assignFromTop(tierIds, sub, allocate(sub, w, tierIds.length, {}).counts);
    }
    // overlapping ranges could invert neighbours; keep the ranking monotone
    const vals = ids.map((id) => result.get(id)).sort((a, b) => b - a);
    ids.forEach((id, i) => result.set(id, vals[i]));
  } else {
    const w = pts.map((p) => (d.method === 'flat' ? 1 : normalBin(p, d.mean, d.sd, d.step)));
    const rules = {};
    for (const p of pts) {
      const r = ruleFor(p);
      if (r.mode !== 'auto') rules[keyOf(p)] = r;
    }
    const alloc = allocate(pts, w, ids.length, rules);
    warning = alloc.warning;
    assignFromTop(ids, pts, alloc.counts);
  }
  return { pts, ids, result, warning };
}

/* ───────────────────────── persistence ───────────────────────── */

const idb = (() => {
  let dbp;
  const open = () =>
    (dbp ??= new Promise((res, rej) => {
      const r = indexedDB.open('performative-reader', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(req.result);
      tx.onerror = () => rej(tx.error);
    });
  };
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)),
    del: (k) => run('readwrite', (s) => s.delete(k)),
  };
})();

const defaultDist = () => ({ method: 'normal', step: 0.5, min: 1, max: 5, mean: 3.5, sd: 0.9, spread: 0.25, shape: 'even', rules: {}, onlyChanged: true });
const defaultExport = () => ({ rating: 'exact', round: 'nearest', extra: true, others: true });
const defaultUi = () => ({ view: 'tiers', cardMode: 'covers', hideEmpty: false });

let state = null;

function sanitize(st) {
  if (!st || typeof st !== 'object' || !st.books || !st.placement) throw new Error('That doesn’t look like a Performative Reader backup.');
  st.unrated ||= [];
  st.scale = fitScale({ step: 1, min: 1, max: 5, ...st.scale });
  st.dist = { ...defaultDist(), ...st.dist };
  st.dist.rules ||= {};
  st.exp = { ...defaultExport(), ...st.exp };
  st.ui = { ...defaultUi(), ...st.ui };
  // drop ids that don't exist, add books that aren't placed anywhere
  const placed = new Set();
  for (const k of Object.keys(st.placement)) {
    st.placement[k] = st.placement[k].filter((id) => st.books[id] && !placed.has(id) && placed.add(id));
  }
  st.unrated = st.unrated.filter((id) => st.books[id] && !placed.has(id) && placed.add(id));
  for (const id of Object.keys(st.books)) if (!placed.has(id)) st.unrated.push(id);
  return st;
}

async function saveNow() {
  if (!state) return;
  try {
    await idb.set('state', state);
  } catch (e) {
    console.warn(e);
    toast('Couldn’t save to browser storage — download a backup to be safe.');
  }
}
const save = debounce(saveNow, 300);

async function loadState() {
  try {
    const s = await idb.get('state');
    return s ? sanitize(s) : null;
  } catch (e) {
    console.warn(e);
    return null;
  }
}

/* ───────────────────────── state building ───────────────────────── */

function freshState(lib, prev) {
  const st = {
    v: 1,
    headers: lib.headers,
    rows: lib.rows,
    books: {},
    placement: {},
    unrated: [],
    scale: inferScale(lib.books.filter((b) => b.start).map((b) => b.start)),
    dist: prev?.dist || defaultDist(),
    exp: prev?.exp || defaultExport(),
    ui: { ...defaultUi(), ...prev?.ui, view: 'tiers' },
  };
  const ordered = [...lib.books].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  for (const b of ordered) {
    const { start, rank, ...book } = b;
    st.books[b.id] = book;
    if (start) (st.placement[keyOf(start)] ||= []).push(b.id);
    else st.unrated.push(b.id);
  }
  return st;
}

function mergeState(old, lib) {
  const st = freshState(lib, old);
  const ids = new Set(Object.keys(st.books));
  const placement = {};
  for (const [k, list] of Object.entries(old.placement)) {
    const kept = list.filter((id) => ids.has(id));
    if (kept.length) placement[k] = kept;
  }
  const unrated = old.unrated.filter((id) => ids.has(id));
  const known = new Set([...Object.values(placement).flat(), ...unrated]);
  let added = 0;
  for (const id of ids) if (!known.has(id)) { unrated.push(id); added++; }
  const removed = Object.keys(old.books).filter((id) => !ids.has(id)).length;
  Object.assign(st, { placement, unrated, scale: old.scale });
  return { st, added, removed };
}

/* ───────────────────────── history ───────────────────────── */

const history = { past: [], future: [] };
const snapshot = () => JSON.stringify({ placement: state.placement, unrated: state.unrated, scale: state.scale });

function pushHistory(snap = snapshot()) {
  history.past.push(snap);
  if (history.past.length > 80) history.past.shift();
  history.future = [];
  updateUndoButtons();
}
function clearHistory() {
  history.past = [];
  history.future = [];
  updateUndoButtons();
}
function restoreSnap(s) {
  Object.assign(state, JSON.parse(s));
  save();
  showView(state.ui.view);
}
function undo() {
  if (!history.past.length) return;
  history.future.push(snapshot());
  restoreSnap(history.past.pop());
}
function redo() {
  if (!history.future.length) return;
  history.past.push(snapshot());
  restoreSnap(history.future.pop());
}
function updateUndoButtons() {
  $('#undoBtn').disabled = !history.past.length;
  $('#redoBtn').disabled = !history.future.length;
}

/* ───────────────────────── covers ───────────────────────── */

const covers = (() => {
  const KEY = 'performative-reader:covers';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* storage blocked */ }
  const persist = debounce(() => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* full */ } }, 1500);
  const queue = [];
  const waiters = new Map();
  const loaded = new Set(); // image URLs the browser already holds this session
  let active = 0;

  const cacheKey = (b) => b.isbn || `${b.title}|${b.author}`.toLowerCase();
  const url = (id, size = 'S') => `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`;

  async function lookup(b) {
    const title = b.title.replace(/\s*\([^)]*#[^)]*\)\s*$/, '').replace(/:.*$/, '').trim();
    const author = b.author.split(',')[0];
    const tries = [];
    if (b.isbn) tries.push(`isbn=${b.isbn}`);
    tries.push(`title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);
    for (const q of tries) {
      const r = await fetch(`https://openlibrary.org/search.json?${q}&fields=cover_i&limit=5`);
      if (!r.ok) throw new Error(`Open Library ${r.status}`);
      const hit = (await r.json()).docs?.find((doc) => doc.cover_i);
      if (hit) return hit.cover_i;
    }
    return 0;
  }

  function pump() {
    while (active < 3 && queue.length) {
      const b = queue.shift();
      const k = cacheKey(b);
      active++;
      lookup(b)
        .then((id) => { cache[k] = id; persist(); return id; }, () => 0)
        .then((id) => {
          waiters.get(k)?.forEach((fn) => fn(id));
          waiters.delete(k);
          active--;
          pump();
        });
    }
  }

  function request(b, fn) {
    const k = cacheKey(b);
    if (k in cache) return fn(cache[k]);
    if (waiters.has(k)) return waiters.get(k).push(fn);
    waiters.set(k, [fn]);
    queue.push(b);
    pump();
  }

  // URL of a cover that has already loaded this session, so it can be shown without waiting.
  function readyUrl(b, size = 'S') {
    const id = cache[cacheKey(b)];
    const u = id ? url(id, size) : null;
    return u && loaded.has(u) ? u : null;
  }

  return { request, url, readyUrl, loaded };
})();

function attachCover(box, book, size = 'S') {
  if (!box || !book || box.querySelector('img')) return;
  const ready = covers.readyUrl(book, size);
  if (ready) return box.append(h('img', { alt: '', src: ready }));
  covers.request(book, (id) => {
    if (!id) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => {
      covers.loaded.add(img.src);
      if (!box.querySelector('img')) box.append(img);
    };
    img.src = covers.url(id, size);
  });
}

const coverIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    coverIO.unobserve(e.target);
    attachCover(e.target.querySelector('.cover'), state?.books[e.target.dataset.id]);
  }
}, { rootMargin: '400px 0px' });

/* ───────────────────────── views ───────────────────────── */

function renderAll() {
  const has = !!state;
  $('#tabs').hidden = !has;
  $('#topActions').hidden = !has;
  if (!has) {
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-landing'));
    return;
  }
  showView(state.ui.view || 'tiers');
}

function showView(name) {
  state.ui.view = name;
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + name));
  $$('#tabs .tab').forEach((t) => {
    const on = t.dataset.view === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  if (name === 'tiers') renderTiers();
  else if (name === 'curve') renderCurve();
  else if (name === 'export') renderExport();
  updateUndoButtons();
  save();
}

/* ── tier list ── */

let sortables = [];
let dragSnap = null;
let justDragged = false;

function tierValues(st) {
  const set = new Set(scalePoints(st.scale).map(keyOf));
  for (const [k, ids] of Object.entries(st.placement)) if (ids.length) set.add(k);
  return [...set].map(Number).sort((a, b) => b - a);
}

const shortTitle = (t) => t.replace(/\s*\([^)]*#[^)]*\)\s*$/, '');

function cardFor(id) {
  const b = state.books[id];
  if (!b) return null;
  const card = h('div', { class: 'card', dataset: { id }, title: `${b.title} — ${b.author}`, tabindex: '0', style: { '--h': String(hashStr(b.title) % 360) } },
    h('div', { class: 'cover' },
      h('span', { class: 'fallback' }, h('span', { class: 'fb-title' }, shortTitle(b.title)), h('span', { class: 'fb-author' }, b.author))),
    h('span', { class: 'meta' }, h('span', { class: 'm-title' }, shortTitle(b.title)), h('span', { class: 'm-author' }, b.author)),
    b.original ? h('span', { class: 'orig', title: 'Original rating' }, fmt(b.original) + '★') : null);
  if (state.ui.cardMode === 'covers') {
    if (covers.readyUrl(b)) attachCover(card.querySelector('.cover'), b);
    else coverIO.observe(card);
  }
  return card;
}

function renderTiers() {
  const st = state;
  $('#tlStep').value = String(st.scale.step);
  fillSelect($('#tlMax'), STEP_MAXES[st.scale.step].map((v) => [v, fmt(v) + '★']), st.scale.max);
  setSeg('#cardMode', st.ui.cardMode);
  $('#hideEmpty').checked = st.ui.hideEmpty;

  sortables.forEach((s) => s.destroy());
  sortables = [];
  const wrap = $('#tiers');
  const scrollY = window.scrollY;
  wrap.replaceChildren();
  wrap.classList.toggle('mode-titles', st.ui.cardMode === 'titles');

  for (const v of tierValues(st)) {
    const k = keyOf(v);
    wrap.append(
      h('section', { class: 'tier', dataset: { key: k }, style: tierStyle(v) },
        h('div', { class: 'tier-label' + (v > 5 + EPS ? ' bonus' : '') },
          h('span', { class: 'tier-value' }, fmt(v), h('span', { class: 'star' }, '★')),
          h('span', { class: 'tier-count' })),
        h('div', { class: 'tier-items', dataset: { key: k } }, (st.placement[k] || []).map(cardFor))));
  }
  wrap.append(
    h('section', { class: 'tier pool', dataset: { key: 'unrated' } },
      h('div', { class: 'pool-head' },
        h('strong', {}, 'Unrated'),
        h('p', { class: 'hint' }, 'Drag books up into a tier. New books from a merged import land here.'),
        h('button', { class: 'btn small ghost', id: 'autoPlace', onclick: autoPlace }, 'Place by original stars')),
      h('div', { class: 'tier-items', dataset: { key: 'unrated' } }, st.unrated.map(cardFor))));

  if (window.Sortable) {
    for (const list of $$('.tier-items', wrap)) {
      sortables.push(Sortable.create(list, {
        group: 'books',
        animation: 150,
        delay: 150,
        delayOnTouchOnly: true,
        onStart() {
          dragSnap = snapshot();
          document.body.classList.add('is-dragging');
        },
        onEnd(evt) {
          document.body.classList.remove('is-dragging');
          justDragged = true;
          setTimeout(() => (justDragged = false), 60);
          if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
          syncFromDom();
          pushHistory(dragSnap);
          refreshTierMeta();
          save();
        },
      }));
    }
  }
  refreshTierMeta();
  applySearch();
  window.scrollTo(0, scrollY);
}

function syncFromDom() {
  const placement = {};
  let unrated = [];
  for (const list of $$('#tiers .tier-items')) {
    const ids = [...list.children].map((c) => c.dataset.id).filter(Boolean);
    if (list.dataset.key === 'unrated') unrated = ids;
    else if (ids.length) placement[list.dataset.key] = ids;
  }
  state.placement = placement;
  state.unrated = unrated;
}

function refreshTierMeta() {
  for (const sec of $$('#tiers .tier')) {
    const n = sec.querySelector('.tier-items').children.length;
    sec.classList.toggle('empty', n === 0);
    const c = sec.querySelector('.tier-count');
    if (c) c.textContent = n ? `${n} book${n === 1 ? '' : 's'}` : '';
  }
  $('#tiers').classList.toggle('hide-empty', state.ui.hideEmpty);
  $('#autoPlace').hidden = !state.unrated.some((id) => state.books[id]?.original);
  const values = [...ratingMap(state).values()];
  const { mean, sd } = describe(values);
  $('#stats').textContent = values.length
    ? `${values.length} ranked · average ${mean.toFixed(2)}★ · spread ${sd.toFixed(2)} · ${state.unrated.length} unrated · drag to reorder, click a book for details`
    : `Nothing ranked yet — drag books from Unrated into a tier.`;
}

function applySearch() {
  const q = $('#search').value.trim().toLowerCase();
  let first = null;
  for (const card of $$('#tiers .card')) {
    const b = state.books[card.dataset.id];
    const hit = !!q && `${b.title} ${b.author}`.toLowerCase().includes(q);
    card.classList.toggle('match', hit);
    card.classList.toggle('dim', !!q && !hit);
    if (hit && !first) first = card;
  }
  return first;
}

function autoPlace() {
  pushHistory();
  const pts = scalePoints(state.scale);
  const keep = [];
  for (const id of state.unrated) {
    const o = state.books[id].original;
    if (!o) { keep.push(id); continue; }
    const v = pts.reduce((best, p) => (Math.abs(p - o) < Math.abs(best - o) ? p : best), pts[0]);
    (state.placement[keyOf(v)] ||= []).push(id);
  }
  const placed = state.unrated.length - keep.length;
  state.unrated = keep;
  save();
  renderTiers();
  toast(`Placed ${placed} book${placed === 1 ? '' : 's'} at the end of their tiers.`);
}

function sortTiers(by) {
  const B = state.books;
  const lastName = (a) => (a || '').trim().split(/\s+/).pop().toLowerCase();
  const cmp = {
    dateRead: (a, b) => (B[b].dateRead || '').localeCompare(B[a].dateRead || ''),
    avg: (a, b) => (B[b].avg || 0) - (B[a].avg || 0),
    title: (a, b) => B[a].title.localeCompare(B[b].title),
    author: (a, b) => lastName(B[a].author).localeCompare(lastName(B[b].author)),
  }[by];
  pushHistory();
  for (const ids of [...Object.values(state.placement), state.unrated]) {
    if (by === 'shuffle') {
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    } else ids.sort(cmp);
  }
  save();
  renderTiers();
  toast('Sorted every tier.');
}

function moveBook(id, toKey, where) {
  pushHistory();
  for (const k of Object.keys(state.placement)) state.placement[k] = state.placement[k].filter((x) => x !== id);
  state.unrated = state.unrated.filter((x) => x !== id);
  const list = toKey === 'unrated' ? state.unrated : (state.placement[toKey] ||= []);
  if (where === 'top') list.unshift(id); else list.push(id);
  save();
  renderTiers();
}

function openBook(id) {
  const b = state.books[id];
  const rm = ratingMap(state);
  const cur = rm.get(id);
  const ranked = rankedIds(state);
  const currentKey = cur == null ? 'unrated' : keyOf(cur);

  const move = h('select', { 'aria-label': 'Move to tier' },
    tierValues(state).map((v) => h('option', { value: keyOf(v) }, fmt(v) + '★')),
    h('option', { value: 'unrated' }, 'Unrated'));
  move.value = currentKey;
  move.onchange = () => { $('#bookDialog').close(); moveBook(id, move.value, 'end'); };

  const cover = h('div', { class: 'cover', style: { '--h': String(hashStr(b.title) % 360) } },
    h('span', { class: 'fallback' }, h('span', { class: 'fb-title' }, shortTitle(b.title)), h('span', { class: 'fb-author' }, b.author)));
  attachCover(cover, b, 'M');

  const facts = [
    ['Performative', cur == null ? 'unrated' : `${fmt(cur)}★ · #${ranked.indexOf(id) + 1} of ${ranked.length}`],
    ['Original rating', b.original ? fmt(b.original) + '★' : '—'],
    ['Community avg', b.avg ? b.avg.toFixed(2) + '★' : null],
    ['Published', b.year || null],
    ['Read', b.dateRead || null],
  ].filter(([, v]) => v);

  $('#bookBody').replaceChildren(
    h('div', { class: 'book' },
      cover,
      h('div', {},
        h('h2', {}, b.title),
        h('p', { class: 'by' }, b.author),
        h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        h('label', { class: 'field' }, 'Move to ', move),
        h('div', { class: 'btn-row' },
          currentKey !== 'unrated' ? h('button', { class: 'btn small', onclick: () => { $('#bookDialog').close(); moveBook(id, currentKey, 'top'); } }, '⇤ Best in tier') : null,
          currentKey !== 'unrated' ? h('button', { class: 'btn small', onclick: () => { $('#bookDialog').close(); moveBook(id, currentKey, 'end'); } }, 'Worst in tier ⇥') : null,
          /^\d+$/.test(id) ? h('a', { class: 'btn small ghost', href: `https://www.goodreads.com/book/show/${id}`, target: '_blank', rel: 'noopener' }, 'Goodreads ↗') : null))));
  $('#bookDialog').showModal();
}

/* ── curve ── */

const METHOD_HINTS = {
  normal: 'Ratings follow a bell curve. Your top-ranked books claim the top ratings, so the drag order is what counts. Add rules to ration your 5★s.',
  flat: 'Every rating gets the same number of books.',
  refine: 'Keeps every book near its current tier and uses your drag order to split it — the best of your 4★s become 4.25★, the worst 3.75★.',
};

function renderCurve() {
  const d = state.dist;
  if (!STEP_MINS[d.step]) d.step = 0.5;
  Object.assign(d, fitScale(d));
  setSeg('#method', d.method);
  setSeg('#dStep', d.step);
  setSeg('#shape', d.shape);
  fillSelect($('#dMin'), STEP_MINS[d.step].map((v) => [v, fmt(v) + '★']), d.min);
  fillSelect($('#dMax'), STEP_MAXES[d.step].map((v) => [v, fmt(v) + '★' + (v > 5 ? ' — bonus' : '')]), d.max);

  const spreads = [0.25, 0.5].filter((s) => s >= d.step - EPS);
  if (!spreads.includes(d.spread)) d.spread = spreads.at(-1) ?? 0.5;
  fillSelect($('#spread'), spreads.map((s) => [s, `±${fmt(s)}★`]), d.spread);

  const mean = $('#mean');
  mean.min = d.min;
  mean.max = d.max;
  mean.value = d.mean;
  $('#sd').value = d.sd;
  $('#meanOut').textContent = Number(d.mean).toFixed(2) + '★';
  $('#sdOut').textContent = Number(d.sd).toFixed(2);
  $('#onlyChanged').checked = d.onlyChanged;

  $('#normalControls').hidden = d.method !== 'normal';
  $('#refineControls').hidden = d.method !== 'refine';
  $('#methodHint').textContent = d.method === 'refine' && !spreads.length
    ? 'Refining needs half or quarter stars — pick a finer precision.'
    : METHOD_HINTS[d.method];
  renderProposal();
}

function countBy(values) {
  const m = new Map();
  for (const v of values) m.set(keyOf(v), (m.get(keyOf(v)) || 0) + 1);
  return m;
}

function renderProposal() {
  const d = state.dist;
  const p = computeProposal(state);
  const rm = ratingMap(state);
  const refineBlocked = d.method === 'refine' && d.step === 1;
  const n = p.ids.length;

  const keys = new Set(p.pts.map(keyOf));
  for (const v of rm.values()) keys.add(keyOf(v));
  const rows = [...keys].map(Number).sort((a, b) => b - a);
  const cur = countBy(rm.values());
  const prop = refineBlocked ? cur : countBy(p.result.values());
  const maxC = Math.max(1, ...cur.values(), ...prop.values());
  const showRules = d.method !== 'refine';

  // remember focus so typing in a rule box survives the re-render
  const active = document.activeElement;
  const focusKey = active?.closest?.('.cons')?.dataset.key;
  const focusCls = active?.classList?.[0];

  const table = $('#distTable');
  table.classList.toggle('no-cons', !showRules);
  table.replaceChildren(
    h('div', { class: 'dt-head' },
      h('span', {}, 'Rating'),
      h('span', {}, h('i', { class: 'key cur' }), 'now', h('i', { class: 'key new' }), 'proposed'),
      h('span', { class: 'num' }, 'Books'),
      showRules ? h('span', {}, 'Rule') : null),
    ...rows.map((v) => {
      const k = keyOf(v);
      const c = cur.get(k) || 0, nw = prop.get(k) || 0;
      const onScale = p.pts.some((x) => keyOf(x) === k);
      const bonus = v > 5 + EPS ? ' bonus' : '';
      return h('div', { class: 'dt-row' + (onScale ? '' : ' off'), style: tierStyle(v) },
        h('span', { class: 'dt-label' + bonus }, fmt(v) + '★'),
        h('span', { class: 'dt-bars' },
          h('span', { class: 'bar cur', style: { width: (c / maxC) * 100 + '%' } }),
          h('span', { class: 'bar new' + bonus, style: { width: (nw / maxC) * 100 + '%' } })),
        h('span', { class: 'num' }, h('span', { class: 'muted' }, c), ' → ', h('b', {}, nw)),
        showRules ? (onScale ? ruleEditor(v, nw) : h('span')) : null);
    }));

  if (focusKey && focusCls) {
    const el = $(`.cons[data-key="${focusKey}"] .${focusCls}`, table);
    if (el) el.focus();
  }

  const now = describe([...rm.values()]);
  const next = describe([...p.result.values()]);
  $('#curveStats').textContent = n
    ? `${n} ranked books · now avg ${now.mean.toFixed(2)}★ (spread ${now.sd.toFixed(2)}) → proposed avg ${next.mean.toFixed(2)}★ (spread ${next.sd.toFixed(2)})`
    : 'Rank some books on the tier list first.';

  const warn = $('#curveWarning');
  warn.hidden = !p.warning;
  warn.textContent = p.warning;

  // who moves
  const list = $('#changeList');
  const items = [];
  let changed = 0;
  p.ids.forEach((id, i) => {
    const old = rm.get(id);
    const nu = refineBlocked ? old : p.result.get(id);
    const diff = r2(nu - old);
    if (diff !== 0) changed++;
    if (d.onlyChanged && diff === 0) return;
    if (items.length >= 400) return;
    const b = state.books[id];
    items.push(h('li', { class: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same' },
      h('span', { class: 'rank' }, '#' + (i + 1)),
      h('span', { class: 'ct', title: `${b.title} — ${b.author}` }, shortTitle(b.title), h('small', {}, b.author)),
      h('span', { class: 'delta' }, `${fmt(old)}★ → `, h('b', {}, `${fmt(nu)}★`))));
  });
  const shown = d.onlyChanged ? changed : n;
  if (shown > items.length) items.push(h('li', {}, h('span', { class: 'more' }, `…and ${shown - items.length} more`)));
  list.replaceChildren(...items);
  $('#changeCount').textContent = `(${changed} of ${n} change)`;
  $('#applyBtn').disabled = !n || !changed || refineBlocked;
}

const renderProposalSoon = debounce(renderProposal, 200);

function ruleEditor(v, proposed) {
  const k = keyOf(v);
  const r = ruleFor(v);
  const mode = h('select', { class: 'cons-mode', 'aria-label': `Rule for ${fmt(v)} stars` },
    [['auto', 'follow curve'], ['max', 'at most'], ['min', 'at least'], ['exact', 'exactly']].map(([val, label]) => h('option', { value: val }, label)));
  mode.value = r.mode;
  const num = h('input', { class: 'cons-n', type: 'number', min: '0', step: '1', value: String(r.n ?? 0), 'aria-label': `Books at ${fmt(v)} stars`, hidden: r.mode === 'auto' });
  const commit = (soon) => {
    state.dist.rules[k] = { mode: mode.value, n: Math.max(0, parseInt(num.value, 10) || 0) };
    save();
    soon ? renderProposalSoon() : renderProposal();
  };
  mode.onchange = () => {
    if (r.mode === 'auto' && mode.value !== 'auto') num.value = String(proposed);
    commit(false);
  };
  num.oninput = () => commit(true);
  return h('span', { class: 'cons', dataset: { key: k } }, mode, num);
}

function applyProposal() {
  const d = state.dist;
  const p = computeProposal(state);
  if (!p.ids.length) return;
  const rm = ratingMap(state);
  const changed = p.ids.filter((id) => r2(rm.get(id)) !== r2(p.result.get(id))).length;
  pushHistory();
  const placement = {};
  for (const id of p.ids) (placement[keyOf(p.result.get(id))] ||= []).push(id);
  state.placement = placement;
  state.scale = { step: d.step, min: d.min, max: d.max };
  toast(`Applied — ${changed} book${changed === 1 ? '' : 's'} re-rated.`);
  showView('tiers');
}

/* ── export ── */

function roundStars(v, mode) {
  const f = mode === 'down' ? Math.floor(v + EPS) : mode === 'up' ? Math.ceil(v - EPS) : Math.floor(v + 0.5);
  return Math.min(5, Math.max(1, f));
}

function buildCsv(st) {
  const o = st.exp;
  const headers = [...st.headers];
  const ci = colIndex(headers);
  const rm = ratingMap(st);
  const ranks = new Map(rankedIds(st).map((id, i) => [id, i + 1]));
  const unratedValue = headers[ci.rating].trim().toLowerCase() === 'my rating' ? '0' : '';
  let pr = ci.perfRating, rk = ci.perfRank;
  if (o.extra) {
    if (pr < 0) { pr = headers.length; headers.push('Performative Rating'); }
    if (rk < 0) { rk = headers.length; headers.push('Performative Rank'); }
  }
  const byRow = new Map(Object.values(st.books).map((b) => [b.rowIndex, b]));
  const out = [headers];
  st.rows.forEach((row, i) => {
    const b = byRow.get(i);
    if (!b && !o.others) return;
    const r = [...row];
    while (r.length < headers.length) r.push('');
    if (b) {
      const v = rm.get(b.id);
      if (o.rating === 'exact') r[ci.rating] = v == null ? unratedValue : fmt(v);
      else if (o.rating === 'rounded') r[ci.rating] = v == null ? unratedValue : String(roundStars(v, o.round));
      if (pr >= 0) r[pr] = v == null ? '' : fmt(v);
      if (rk >= 0) r[rk] = v == null ? '' : String(ranks.get(b.id));
    }
    out.push(r);
  });
  return toCSV(out);
}

function shareText(st) {
  const lines = [`My ratings (${rankedIds(st).length} books)`, ''];
  for (const v of tierValues(st)) {
    const ids = st.placement[keyOf(v)] || [];
    if (!ids.length) continue;
    lines.push(`${fmt(v)}★ — ${ids.map((id) => shortTitle(st.books[id].title)).join(' · ')}`);
  }

  return lines.join('\n');
}

function renderExport() {
  const o = state.exp;
  $$('input[name=expRating]').forEach((r) => (r.checked = r.value === o.rating));
  $('#expRound').value = o.round;
  $('#roundField').hidden = o.rating !== 'rounded';
  $('#expExtra').checked = o.extra;
  $('#expOthers').checked = o.others;
  const csv = buildCsv(state);
  $('#csvPreview').textContent = csv.split('\n').slice(0, 8).map((l) => (l.length > 220 ? l.slice(0, 220) + '…' : l)).join('\n');
  $('#shareText').value = shareText(state);
}

/* ───────────────────────── import flow ───────────────────────── */

function askImport(lib) {
  return new Promise((resolve) => {
    const d = $('#importDialog');
    $('#importInfo').textContent =
      `This file has ${lib.books.length} read books. Merge keeps your current order and ratings, removes books that are gone, and drops new ones into Unrated. Replace starts over from the file.`;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue), { once: true });
    d.showModal();
  });
}

async function importCsvText(text) {
  let lib;
  try { lib = parseLibrary(text); } catch (e) { toast(e.message, 6000); return; }
  if (!lib.books.length) { toast('No books on the “read” shelf in that file.'); return; }

  if (state && Object.keys(state.books).length) {
    const choice = await askImport(lib);
    if (choice === 'merge') {
      const { st, added, removed } = mergeState(state, lib);
      state = st;
      toast(`Merged: ${added} new book${added === 1 ? '' : 's'} in Unrated${removed ? `, ${removed} removed` : ''}.`, 5000);
    } else if (choice === 'replace') {
      state = freshState(lib, state);
      toast(`Imported ${lib.books.length} read books.`);
    } else return;
  } else {
    state = freshState(lib);
    const ranked = lib.books.some((b) => b.rank);
    toast(`Imported ${lib.books.length} read books${ranked ? ' with your saved ranking' : ''}${lib.skipped ? ` (skipped ${lib.skipped} unread)` : ''}.`, 5000);
  }
  clearHistory();
  save();
  renderAll();
}

function restoreBackup(text) {
  try {
    state = sanitize(JSON.parse(text));
  } catch (e) {
    toast(e.message.startsWith('That') ? e.message : 'That backup file couldn’t be read.', 5000);
    return;
  }
  clearHistory();
  save();
  renderAll();
  toast('Backup restored.');
}

async function handleFile(file) {
  if (!file) return;
  let text;
  try { text = await file.text(); } catch { toast('Couldn’t read that file.'); return; }
  if (/\.json$/i.test(file.name) || text.trimStart().startsWith('{')) restoreBackup(text);
  else importCsvText(text);
}

function demoCsv() {
  const headers = ['Book Id', 'Title', 'Author', 'Author l-f', 'Additional Authors', 'ISBN', 'ISBN13', 'My Rating', 'Average Rating', 'Publisher', 'Binding', 'Number of Pages', 'Year Published', 'Original Publication Year', 'Date Read', 'Date Added', 'Bookshelves', 'Bookshelves with positions', 'Exclusive Shelf', 'My Review', 'Spoiler', 'Private Notes', 'Read Count', 'Owned Copies'];
  const books = [
    ['Piranesi', 'Susanna Clarke', 5, 4.2, 2020], ['Middlemarch', 'George Eliot', 5, 4.0, 1871], ['Circe', 'Madeline Miller', 5, 4.3, 2018],
    ['The Left Hand of Darkness', 'Ursula K. Le Guin', 5, 4.1, 1969], ['Never Let Me Go', 'Kazuo Ishiguro', 5, 3.9, 2005], ['Beloved', 'Toni Morrison', 5, 3.9, 1987],
    ['Project Hail Mary', 'Andy Weir', 5, 4.5, 2021], ['The Secret History', 'Donna Tartt', 5, 4.1, 1992], ['Jane Eyre', 'Charlotte Brontë', 5, 4.1, 1847],
    ['Dune', 'Frank Herbert', 5, 4.3, 1965], ['The Remains of the Day', 'Kazuo Ishiguro', 4, 4.1, 1989], ['Pride and Prejudice', 'Jane Austen', 4, 4.3, 1813],
    ['Frankenstein', 'Mary Shelley', 4, 3.9, 1818], ['A Wizard of Earthsea', 'Ursula K. Le Guin', 4, 4.0, 1968], ['Station Eleven', 'Emily St. John Mandel', 4, 4.0, 2014],
    ['The Hobbit', 'J.R.R. Tolkien', 4, 4.3, 1937], ['Gideon the Ninth (The Locked Tomb, #1)', 'Tamsyn Muir', 4, 4.1, 2019], ['Rebecca', 'Daphne du Maurier', 4, 4.2, 1938],
    ['The Road', 'Cormac McCarthy', 4, 4.0, 2006], ['Crime and Punishment', 'Fyodor Dostoevsky', 4, 4.3, 1866], ['Persuasion', 'Jane Austen', 4, 4.1, 1817],
    ['Mrs Dalloway', 'Virginia Woolf', 4, 3.8, 1925], ['Jonathan Strange & Mr Norrell', 'Susanna Clarke', 4, 3.8, 2004], ['The Name of the Wind (The Kingkiller Chronicle, #1)', 'Patrick Rothfuss', 4, 4.5, 2007],
    ['The Martian', 'Andy Weir', 4, 4.4, 2011], ['Wuthering Heights', 'Emily Brontë', 4, 3.9, 1847], ['Brave New World', 'Aldous Huxley', 4, 4.0, 1932],
    ['Dracula', 'Bram Stoker', 3, 4.0, 1897], ['The Great Gatsby', 'F. Scott Fitzgerald', 3, 3.9, 1925], ['Moby-Dick', 'Herman Melville', 3, 3.5, 1851],
    ['Gone Girl', 'Gillian Flynn', 3, 4.1, 2012], ['Little Women', 'Louisa May Alcott', 3, 4.1, 1868], ['The Picture of Dorian Gray', 'Oscar Wilde', 3, 4.1, 1890],
    ['Great Expectations', 'Charles Dickens', 3, 3.8, 1861], ['Blood Meridian', 'Cormac McCarthy', 3, 4.2, 1985], ['To the Lighthouse', 'Virginia Woolf', 3, 3.8, 1927],
    ['Infinite Jest', 'David Foster Wallace', 2, 4.3, 1996], ['Ulysses', 'James Joyce', 2, 3.7, 1922], ['The Alchemist', 'Paulo Coelho', 2, 3.9, 1988],
    ['Fifty Shades of Grey (Fifty Shades, #1)', 'E.L. James', 1, 3.7, 2011], ['The Brothers Karamazov', 'Fyodor Dostoevsky', 0, 4.4, 1880],
  ];
  const toRead = [['War and Peace', 'Leo Tolstoy', 4.2, 1869], ['Don Quixote', 'Miguel de Cervantes', 3.9, 1605]];
  const row = (vals) => headers.map((col) => vals[col] ?? '');
  const lf = (a) => { const parts = a.split(' '); const last = parts.pop(); return `${last}, ${parts.join(' ')}`; };
  const rows = books.map(([title, author, rating, avg, year], i) => {
    const d = new Date(Date.UTC(2025, 8, 1) - i * 9 * 864e5).toISOString().slice(0, 10).replace(/-/g, '/');
    return row({ 'Book Id': `demo-${i + 1}`, Title: title, Author: author, 'Author l-f': lf(author), 'My Rating': rating, 'Average Rating': avg, 'Original Publication Year': year, 'Date Read': d, 'Date Added': d, Bookshelves: '', 'Exclusive Shelf': 'read', 'Read Count': 1, 'Owned Copies': 0 });
  });
  toRead.forEach(([title, author, avg, year], i) =>
    rows.push(row({ 'Book Id': `demo-tr-${i + 1}`, Title: title, Author: author, 'Author l-f': lf(author), 'My Rating': 0, 'Average Rating': avg, 'Original Publication Year': year, 'Date Added': '2025/09/10', Bookshelves: 'to-read', 'Bookshelves with positions': `to-read (#${i + 1})`, 'Exclusive Shelf': 'to-read', 'Read Count': 0, 'Owned Copies': 0 })));
  return toCSV([headers, ...rows]);
}

/* ───────────────────────── wiring ───────────────────────── */

function bind() {
  const pick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { handleFile(e.target.files[0]); e.target.value = ''; };
  $('#dropzone').onclick = pick;
  $('#dropzone').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
  $('#importBtn').onclick = pick;
  $('#landingRestore').onclick = pick;
  $('#restoreBtn').onclick = pick;
  $('#demoBtn').onclick = () => importCsvText(demoCsv());
  $('#brand').onclick = (e) => { e.preventDefault(); if (state) showView('tiers'); };

  // file drag & drop anywhere (ignore Sortable's in-page drags)
  let dragDepth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; dragDepth++; $('#dropOverlay').classList.add('show'); });
  window.addEventListener('dragleave', (e) => { if (!isFileDrag(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.remove('show'); } });
  window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('#dropOverlay').classList.remove('show');
    handleFile(e.dataTransfer.files[0]);
  });

  $$('#tabs .tab').forEach((t) => (t.onclick = () => showView(t.dataset.view)));
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  document.addEventListener('keydown', (e) => {
    if (!state || e.target.closest('input, textarea, select') || $('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

  // tier list
  const tiers = $('#tiers');
  tiers.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card && !justDragged) openBook(card.dataset.id);
  });
  tiers.addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && e.key === 'Enter') openBook(card.dataset.id);
  });
  $('#search').oninput = () => applySearch();
  $('#search').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    applySearch()?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $('#tlStep').onchange = (e) => {
    pushHistory();
    state.scale = fitScale({ ...state.scale, step: Number(e.target.value) });
    save();
    renderTiers();
  };
  $('#tlMax').onchange = (e) => {
    pushHistory();
    state.scale.max = Number(e.target.value);
    save();
    renderTiers();
  };
  $('#sortTiers').onchange = (e) => {
    if (e.target.value) sortTiers(e.target.value);
    e.target.value = '';
  };
  $$('#cardMode button').forEach((b) => (b.onclick = () => { state.ui.cardMode = b.dataset.v; save(); renderTiers(); }));
  $('#hideEmpty').onchange = (e) => { state.ui.hideEmpty = e.target.checked; save(); refreshTierMeta(); };

  // curve
  const d = () => state.dist;
  $$('#method button').forEach((b) => (b.onclick = () => { d().method = b.dataset.v; save(); renderCurve(); }));
  $$('#dStep button').forEach((b) => (b.onclick = () => { d().step = Number(b.dataset.v); save(); renderCurve(); }));
  $$('#shape button').forEach((b) => (b.onclick = () => { d().shape = b.dataset.v; save(); renderCurve(); }));
  $('#dMin').onchange = (e) => { d().min = Number(e.target.value); save(); renderCurve(); };
  $('#dMax').onchange = (e) => { d().max = Number(e.target.value); save(); renderCurve(); };
  $('#spread').onchange = (e) => { d().spread = Number(e.target.value); save(); renderCurve(); };
  $('#mean').oninput = (e) => { d().mean = Number(e.target.value); $('#meanOut').textContent = d().mean.toFixed(2) + '★'; save(); renderProposal(); };
  $('#sd').oninput = (e) => { d().sd = Number(e.target.value); $('#sdOut').textContent = d().sd.toFixed(2); save(); renderProposal(); };
  $('#matchBtn').onclick = () => {
    const { mean, sd } = describe([...ratingMap(state).values()]);
    d().mean = r2(Math.min(d().max, Math.max(d().min, mean || 3.5)));
    d().sd = r2(Math.min(2.5, Math.max(0.2, sd || 0.9)));
    save();
    renderCurve();
  };
  $('#onlyChanged').onchange = (e) => { d().onlyChanged = e.target.checked; save(); renderProposal(); };
  $('#applyBtn').onclick = applyProposal;

  // export
  $$('input[name=expRating]').forEach((r) => (r.onchange = () => { state.exp.rating = r.value; save(); renderExport(); }));
  $('#expRound').onchange = (e) => { state.exp.round = e.target.value; save(); renderExport(); };
  $('#expExtra').onchange = (e) => { state.exp.extra = e.target.checked; save(); renderExport(); };
  $('#expOthers').onchange = (e) => { state.exp.others = e.target.checked; save(); renderExport(); };
  $('#downloadCsv').onclick = () => {
    download(`goodreads_library_export_performative_${today()}.csv`, buildCsv(state), 'text/csv;charset=utf-8');
    toast('CSV downloaded.');
  };
  $('#copyShare').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('#shareText').value);
      toast('Copied.');
    } catch {
      $('#shareText').select();
      toast('Press Ctrl+C to copy.');
    }
  };
  $('#backupBtn').onclick = () => download(`performative-reader-backup-${today()}.json`, JSON.stringify(state), 'application/json');
  $('#resetBtn').onclick = () => {
    const dlg = $('#confirmDialog');
    dlg.returnValue = '';
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue !== 'yes') return;
      state = null;
      clearHistory();
      try { await idb.del('state'); } catch { /* ignore */ }
      renderAll();
      toast('All data cleared.');
    }, { once: true });
    dlg.showModal();
  };
}

(async function init() {
  bind();
  if (!window.Sortable) toast('Drag and drop couldn’t load (offline?) — click a book to move it instead.', 6000);
  state = await loadState();
  renderAll();
})();
