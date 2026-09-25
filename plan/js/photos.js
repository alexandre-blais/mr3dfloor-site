// Photo tab: gallery + iOS-Photos-like viewer (zoom / pan / swipe / filmstrip / info / annotations).
//
//   createPhotoView(container) -> { activate(), deactivate(), open(photoId) }
//   addPhotoFiles(files, at?)  -> Promise<string[]>  new photo ids
//
// Photo records live in store.plan.photos; user images are Blobs in IndexedDB keyed by photo id
// (see photoBlobs / photoURL in store.js). Annotations are stored in photo.marks as
//   { kind: 'arrow'|'pen'|'line'|'text', pts: [[u, v], ...], text?, color }
// with u, v normalised to the unrotated image (0..1).

import { store, photoBlobs, photoURL } from './store.js';
import { t, lang } from './i18n.js';
import { uid, computeRooms, planBounds, openingGeom } from './model.js';
import { pointInPolygon } from './geometry.js';
import { fmtLen } from './units.js';

// ---------------------------------------------------------------- local strings

const LOCAL = {
  en: {
    back: 'Photos', addShort: 'Add', camera: 'Take photo', dropHere: 'Drop images to add them',
    confirmDelete: 'Delete this photo? The image file will be removed.', taken: 'Taken', fov: 'Field of view',
    pen: 'Draw', arrow: 'Arrow', lineTool: 'Measure line', textTool: 'Text', color: 'Colour', undoMark: 'Undo last mark',
    done: 'Done', noImage: 'Image not available', labelPh: 'Label, e.g. 1.20 m', textPh: 'Text…', notePh: 'Add a note…',
    marks: 'annotations', photoCount: (n) => (n === 1 ? '1 photo' : `${n} photos`), untitled: 'Photo', dropHint: 'or drop images here',
    noRoom: 'Not in a room', planOf: 'Location',
  },
  fr: {
    back: 'Photos', addShort: 'Ajouter', camera: 'Prendre une photo', dropHere: 'Déposez des images pour les ajouter',
    confirmDelete: 'Supprimer cette photo ? Le fichier image sera effacé.', taken: 'Prise le', fov: 'Champ de vision',
    pen: 'Dessin', arrow: 'Flèche', lineTool: 'Ligne de cote', textTool: 'Texte', color: 'Couleur', undoMark: 'Annuler la dernière annotation',
    done: 'Terminé', noImage: 'Image non disponible', labelPh: 'Étiquette, ex. 1,20 m', textPh: 'Texte…', notePh: 'Ajouter une note…',
    marks: 'annotations', photoCount: (n) => (n <= 1 ? `${n} photo` : `${n} photos`), untitled: 'Photo', dropHint: 'ou déposez des images ici',
    noRoom: 'Hors pièce', planOf: 'Emplacement',
  },
};
const T = (k) => LOCAL[lang()][k] ?? LOCAL.en[k] ?? t(k);

// ---------------------------------------------------------------- icons (24×24 stroke icons, currentColor)

const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  annotate: '<path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>',
  rotate: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  exitFs: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  pen: '<path d="M3 17c3-6 5-9 7-9s1 6 3 6 3-5 5-5 2 2 3 3"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  line: '<path d="M4 20L20 4M2.5 15.5l6 6M15.5 2.5l6 6"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>',
  dirArrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  mark: '<path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/>',
};
const icon = (n, cls = '') => `<svg class="pv-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff'];

// ---------------------------------------------------------------- helpers

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function h(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
  }
  if (html) e.innerHTML = html;
  return e;
}
/** Icon button with a localisable aria-label (data-al) and tooltip. */
function btn(iconName, key, cls = '') {
  const b = h('button', { type: 'button', class: `pv-btn ${cls}`, 'data-al': key, 'aria-label': T(key), title: T(key) }, icon(iconName));
  return b;
}
const photos = () => store.plan.photos || [];
const photoById = (id) => photos().find((p) => p.id === id);

function fmtDate(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const loc = lang() === 'fr' ? 'fr-CA' : 'en-CA';
  try { return new Intl.DateTimeFormat(loc, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(d); } catch { return d.toLocaleString(); }
}
const pct = (z) => `${Math.round(z * 100)}${lang() === 'fr' ? ' %' : '%'}`;
const localISO = (d) => { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; };
const normDeg = (d) => ((Math.round(d) % 360) + 360) % 360;

// room name lookup, memoised per plan snapshot
let roomMemo = { plan: null, n: -1, faces: [] };
let planRev = 0;
store.on('change', () => { planRev++; });
function roomOf(p) {
  if (roomMemo.plan !== store.plan || roomMemo.n !== planRev) {
    let faces = [];
    try { faces = computeRooms(store.plan); } catch { /* malformed plan */ }
    roomMemo = { plan: store.plan, n: planRev, faces };
  }
  const f = roomMemo.faces.find((f) => f.room && pointInPolygon(p, f.pts));
  return f ? f.room.name : '';
}

// ---------------------------------------------------------------- image + thumbnail caches

const urlMemo = new Map();      // photo id -> resolved URL (sync access once known)
async function urlFor(p) {
  const key = p.id + '|' + (p.src || '');
  if (urlMemo.has(key)) return urlMemo.get(key);
  const u = await photoURL(p);
  if (u) urlMemo.set(key, u);
  return u;
}
const urlSync = (p) => urlMemo.get(p.id + '|' + (p.src || '')) || null;

function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image load failed'));
    im.src = url;
  });
}

// decoded full-size images kept for instant swaps (small LRU)
const imgCache = new Map();     // url -> Promise<HTMLImageElement>
function preload(p) {
  if (!p) return;
  urlFor(p).then((u) => {
    if (!u) return;
    if (imgCache.has(u)) { const v = imgCache.get(u); imgCache.delete(u); imgCache.set(u, v); return; }
    const pr = loadImage(u).then(async (im) => { try { await im.decode(); } catch { /* ok */ } return im; });
    pr.catch(() => imgCache.delete(u));
    imgCache.set(u, pr);
    while (imgCache.size > 7) imgCache.delete(imgCache.keys().next().value);
  });
}

const thumbCache = new Map();   // id|src -> Promise<url|null>
function thumbFor(p) {
  const key = p.id + '|' + (p.src || '');
  if (!thumbCache.has(key)) {
    thumbCache.set(key, (async () => {
      const u = await urlFor(p);
      if (!u) return null;
      try {
        const im = await loadImage(u);
        const S = 360, m = Math.min(im.naturalWidth, im.naturalHeight);
        if (m <= S * 1.3) return u;
        const k = S / m, c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(im, 0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
        return blob ? URL.createObjectURL(blob) : u;
      } catch { return u; }
    })());
  }
  return thumbCache.get(key);
}
function forgetPhoto(p) {
  const key = p.id + '|' + (p.src || '');
  urlMemo.delete(key);
  const tp = thumbCache.get(key);
  thumbCache.delete(key);
  if (tp) tp.then((u) => { if (u && u.startsWith('blob:') && u !== urlSync(p)) URL.revokeObjectURL(u); });
}

// lazily fill <img data-thumb=id> when it approaches the viewport
const thumbIO = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((ents) => {
  for (const e of ents) {
    if (!e.isIntersecting) continue;
    thumbIO.unobserve(e.target);
    fillThumb(e.target);
  }
}, { rootMargin: '300px' }) : null;
function fillThumb(img) {
  const p = photoById(img.dataset.thumb);
  if (!p) return;
  thumbFor(p).then((u) => {
    if (!u) { img.closest('.pv-thumb')?.classList.add('pv-missing'); return; }
    img.onload = () => img.classList.add('pv-loaded');
    img.src = u;
  });
}
function lazyThumb(img) { if (thumbIO) thumbIO.observe(img); else fillThumb(img); }

// ---------------------------------------------------------------- adding photos

/** Store image files as blobs and create photo records. Returns the new ids. */
export async function addPhotoFiles(files, at) {
  const list = Array.from(files || []).filter((f) => f && (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|avif)$/i.test(f.name || '')));
  if (!list.length) return [];
  let base = at;
  if (!base) {
    try {
      const b = planBounds(store.plan);
      base = b && isFinite(b.minX) ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
    } catch { base = { x: 0, y: 0 }; }
    if (!isFinite(base.x) || !isFinite(base.y)) base = { x: 0, y: 0 };
  }
  const recs = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const id = uid('ph');
    await photoBlobs.put(id, f);
    const off = at ? 0 : i * 0.25;
    recs.push({
      id, name: (f.name || T('untitled')).replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || T('untitled'),
      x: +(base.x + off).toFixed(3), y: +(base.y + off).toFixed(3), dir: 0, fov: 70,
      note: '', taken: localISO(new Date(f.lastModified || Date.now())), marks: [],
    });
  }
  store.commit(t('addPhoto'), (plan) => { plan.photos.push(...recs); });
  return recs.map((r) => r.id);
}

// ---------------------------------------------------------------- view

export function createPhotoView(container) {
  const root = h('div', { class: 'pv' });
  container.appendChild(root);

  // ---------- gallery
  const gallery = h('section', { class: 'pv-gallery' });
  const gHead = h('header', { class: 'pv-ghead' });
  const gTitle = h('div', { class: 'pv-gtitle' }, `<h2 data-tx="photos">${esc(t('photos'))}</h2><span class="pv-count"></span>`);
  const gActions = h('div', { class: 'pv-gactions' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  const camBtn = btn('camera', 'camera', 'pv-cam');
  const addBtn = h('button', { type: 'button', class: 'pv-add' }, `${icon('add')}<span data-tx="addPhoto">${esc(t('addPhoto'))}</span>`);
  gActions.append(camBtn, addBtn, fileIn, camIn);
  gHead.append(gTitle, gActions);
  const grid = h('div', { class: 'pv-grid', role: 'list' });
  const empty = h('div', { class: 'pv-empty' });
  const dropOverlay = h('div', { class: 'pv-drop', 'aria-hidden': 'true' }, `<div>${icon('photo')}<span data-tx="dropHere">${esc(T('dropHere'))}</span></div>`);
  gallery.append(gHead, grid, empty);

  // ---------- viewer
  const viewer = h('section', { class: 'pv-viewer', hidden: true, 'aria-roledescription': 'photo viewer' });
  const top = h('header', { class: 'pv-top' });
  const backBtn = h('button', { type: 'button', class: 'pv-btn pv-back', 'data-al': 'back', 'aria-label': T('back'), title: T('back') }, `${icon('back')}<span class="pv-back-t" data-tx="back">${esc(T('back'))}</span>`);
  const titleBox = h('div', { class: 'pv-title' }, '<b></b><small></small>');
  const tools = h('div', { class: 'pv-tools' });
  const rotBtn = btn('rotate', 'rotateL');
  const annBtn = btn('annotate', 'annotate');
  const infoBtn = btn('info', 'info');
  const fsBtn = btn('fullscreen', 'fullscreen');
  const delBtn = btn('trash', 'delete', 'pv-danger');
  annBtn.setAttribute('aria-pressed', 'false'); infoBtn.setAttribute('aria-pressed', 'false');
  tools.append(rotBtn, annBtn, infoBtn, delBtn, fsBtn);
  top.append(backBtn, titleBox, tools);

  const main = h('div', { class: 'pv-main' });
  const stage = h('div', { class: 'pv-stage', tabindex: '0' });
  const track = h('div', { class: 'pv-track' });
  const slotPrev = h('div', { class: 'pv-slot' }), slotCur = h('div', { class: 'pv-slot pv-cur' }), slotNext = h('div', { class: 'pv-slot' });
  const prevImg = h('img', { class: 'pv-side', alt: '', draggable: 'false' });
  const nextImg = h('img', { class: 'pv-side', alt: '', draggable: 'false' });
  slotPrev.append(prevImg); slotNext.append(nextImg);
  const xf = h('div', { class: 'pv-xf' });
  const img = h('img', { class: 'pv-img', alt: '', draggable: 'false' });
  const SVGNS = 'http://www.w3.org/2000/svg';
  const marksSvg = document.createElementNS(SVGNS, 'svg');
  marksSvg.setAttribute('class', 'pv-marks');
  const marksG = document.createElementNS(SVGNS, 'g'), previewG = document.createElementNS(SVGNS, 'g');
  marksSvg.append(marksG, previewG);
  xf.append(img, marksSvg);
  const spinner = h('div', { class: 'pv-spin', 'aria-hidden': 'true' });
  const missing = h('div', { class: 'pv-missing-msg', hidden: true }, `${icon('photo')}<span data-tx="noImage">${esc(T('noImage'))}</span>`);
  slotCur.append(xf, spinner, missing);
  track.append(slotPrev, slotCur, slotNext);

  const navPrev = btn('chevL', 'prev', 'pv-nav pv-nav-prev');
  const navNext = btn('chevR', 'next', 'pv-nav pv-nav-next');
  const zoomBar = h('div', { class: 'pv-zoombar pv-ctl', role: 'group' });
  const zOut = btn('minus', 'zoomOut'), zIn = btn('plus', 'zoomIn'), zFit = btn('fit', 'fit');
  const zLbl = h('output', { class: 'pv-zlbl', 'aria-live': 'polite' }, '100%');
  zoomBar.append(zOut, zLbl, zIn, zFit);

  // annotation toolbar
  const annBar = h('div', { class: 'pv-annbar pv-ctl', role: 'toolbar', hidden: true });
  const toolBtns = {};
  const toolRow = h('div', { class: 'pv-annrow' });
  for (const [k, ic, key] of [['pen', 'pen', 'pen'], ['arrow', 'arrow', 'arrow'], ['line', 'line', 'lineTool'], ['text', 'text', 'textTool']]) {
    const b = btn(ic, key, 'pv-tool'); b.dataset.tool = k; b.setAttribute('aria-pressed', 'false'); toolBtns[k] = b; toolRow.append(b);
  }
  const undoMarkBtn = btn('undo', 'undoMark');
  const doneBtn = h('button', { type: 'button', class: 'pv-done' }, `<span data-tx="done">${esc(T('done'))}</span>`);
  toolRow.append(h('span', { class: 'pv-sep' }), undoMarkBtn, doneBtn);
  const colorRow = h('div', { class: 'pv-annrow pv-colors', role: 'radiogroup', 'data-al': 'color', 'aria-label': T('color') });
  const colorBtns = COLORS.map((c) => {
    const b = h('button', { type: 'button', class: 'pv-color', role: 'radio', 'aria-checked': 'false', 'aria-label': c, style: `--c:${c}` }, '<i></i>');
    b.dataset.color = c; colorRow.append(b); return b;
  });
  annBar.append(toolRow, colorRow);
  const textInput = h('input', { class: 'pv-textin', type: 'text', hidden: true, enterkeyhint: 'done', autocomplete: 'off' });

  stage.append(track, navPrev, navNext, zoomBar, annBar, textInput);

  // info panel
  const info = h('aside', { class: 'pv-info', hidden: true, 'aria-label': t('info') });
  info.innerHTML = `
    <div class="pv-grab" aria-hidden="true"></div>
    <label class="pv-field"><span data-tx="name">${esc(t('name'))}</span><input class="pv-in-name" type="text" maxlength="80"></label>
    <label class="pv-field"><span data-tx="note">${esc(t('note'))}</span><textarea class="pv-in-note" rows="2"></textarea></label>
    <dl class="pv-meta">
      <div class="pv-wide"><dt data-tx="taken">${esc(T('taken'))}</dt><dd class="pv-m-date"></dd></div>
      <div><dt data-tx="room">${esc(t('room'))}</dt><dd class="pv-m-room"></dd></div>
      <div><dt data-tx="position">${esc(t('position'))}</dt><dd class="pv-m-pos"></dd></div>
      <div><dt data-tx="direction">${esc(t('direction'))}</dt><dd class="pv-m-dir"></dd></div>
      <div><dt data-tx="fov">${esc(T('fov'))}</dt><dd class="pv-m-fov"></dd></div>
    </dl>
    <div class="pv-minimap-wrap"><svg class="pv-minimap" role="img"></svg></div>
    <button type="button" class="pv-showplan">${icon('map')}<span data-tx="showOnPlan">${esc(t('showOnPlan'))}</span></button>`;
  const inName = info.querySelector('.pv-in-name'), inNote = info.querySelector('.pv-in-note');
  const miniSvg = info.querySelector('.pv-minimap');
  inNote.placeholder = T('notePh');

  main.append(stage, info);
  const film = h('div', { class: 'pv-film', role: 'listbox', 'aria-label': t('photos') });
  viewer.append(top, main, film);
  root.append(gallery, viewer, dropOverlay);

  // ---------------------------------------------------------------- state
  const S = {
    active: false, open: false, id: null,
    W: 1, H: 1, nw: 0, nh: 0, loaded: false,
    cx: 0, cy: 0, s: 1, rot: 0,
    info: false, annot: false, tool: 'arrow', color: COLORS[0],
    chrome: true, navBusy: false,
  };
  const rotations = new Map(); // photo id -> view rotation (degrees, cumulative)
  const GAP = 24;
  const curPhoto = () => photoById(S.id);
  const curIndex = () => photos().findIndex((p) => p.id === S.id);

  // ---------------------------------------------------------------- gallery rendering
  function renderGallery() {
    const list = photos();
    gTitle.querySelector('.pv-count').textContent = list.length ? T('photoCount')(list.length) : '';
    empty.hidden = list.length > 0;
    grid.hidden = list.length === 0;
    if (!list.length) {
      empty.innerHTML = `<div class="pv-empty-ic">${icon('photo')}</div><p>${esc(t('noPhotos'))}</p>
        <button type="button" class="pv-add pv-add-big">${icon('add')}<span>${esc(t('addPhoto'))}</span></button><small>${esc(T('dropHint'))}</small>`;
      empty.querySelector('button').onclick = () => fileIn.click();
      grid.textContent = '';
      return;
    }
    // reuse tiles by id to keep loaded thumbnails
    const old = new Map([...grid.children].map((c) => [c.dataset.id, c]));
    const frag = document.createDocumentFragment();
    for (const p of list) {
      let tile = old.get(p.id);
      const key = p.id + '|' + (p.src || '');
      if (!tile || tile.dataset.key !== key) {
        tile = h('button', { type: 'button', class: 'pv-tile', role: 'listitem' });
        tile.dataset.id = p.id; tile.dataset.key = key;
        tile.innerHTML = `<span class="pv-thumb"><img alt="" loading="lazy" decoding="async" draggable="false"><span class="pv-badge" hidden>${icon('mark')}</span></span>
          <span class="pv-cap"><b></b><small></small></span>`;
        const im = tile.querySelector('img'); im.dataset.thumb = p.id; lazyThumb(im);
      }
      const room = roomOf(p);
      tile.querySelector('b').textContent = p.name || T('untitled');
      tile.querySelector('small').textContent = [room, fmtDate(p.taken)].filter(Boolean).join(' · ');
      tile.querySelector('.pv-badge').hidden = !(p.marks && p.marks.length);
      tile.setAttribute('aria-label', `${p.name || T('untitled')}${room ? ', ' + room : ''}`);
      frag.append(tile);
    }
    grid.replaceChildren(frag);
  }
  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.pv-tile');
    if (tile) openViewer(tile.dataset.id, true);
  });

  // add buttons, camera, drag & drop
  addBtn.onclick = () => fileIn.click();
  camBtn.onclick = () => camIn.click();
  const onFiles = async (inp) => {
    const files = [...inp.files]; inp.value = '';
    if (files.length) await addPhotoFiles(files);
  };
  fileIn.onchange = () => onFiles(fileIn);
  camIn.onchange = () => onFiles(camIn);
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  root.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; root.classList.add('pv-dragging'); });
  root.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  root.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove('pv-dragging'); } });
  root.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; root.classList.remove('pv-dragging');
    const ids = await addPhotoFiles(e.dataTransfer.files);
    if (ids.length && S.open) openViewer(ids[0]);
  });

  // ---------------------------------------------------------------- transform
  const odd = () => Math.abs(Math.round(S.rot / 90)) % 2 === 1;
  const box = () => (odd() ? [S.nh, S.nw] : [S.nw, S.nh]);
  const fitS = () => { const [bw, bh] = box(); return bw && bh ? Math.min(S.W / bw, S.H / bh) : 1; };
  const zoom = () => S.s / fitS();
  const maxZ = () => clamp(Math.max(5, 4 / fitS()), 5, 40);

  function clampC(cx, cy, s = S.s) {
    const [bw, bh] = box();
    const dw = bw * s, dh = bh * s;
    const x = dw <= S.W ? S.W / 2 : clamp(cx, S.W - dw / 2, dw / 2);
    const y = dh <= S.H ? S.H / 2 : clamp(cy, S.H - dh / 2, dh / 2);
    return [x, y];
  }
  const rubber = (v, target) => target + (v - target) * 0.35;

  let liveTimer = 0;
  function apply(anim = false) {
    xf.classList.toggle('pv-anim', !!anim);
    xf.classList.add('pv-live');
    clearTimeout(liveTimer);
    // drop will-change after motion stops so the browser re-rasterises crisply at the new scale
    liveTimer = setTimeout(() => xf.classList.remove('pv-live'), anim ? 420 : 180);
    xf.style.transform = `translate(${S.cx}px,${S.cy}px) rotate(${S.rot}deg) scale(${S.s}) translate(${-S.nw / 2}px,${-S.nh / 2}px)`;
    const z = zoom();
    zLbl.textContent = pct(z);
    zOut.disabled = z <= 1.001; zIn.disabled = z >= maxZ() - 0.001;
    stage.classList.toggle('pv-zoomed', z > 1.01);
  }
  function fit(anim = false) {
    S.s = fitS(); S.cx = S.W / 2; S.cy = S.H / 2; apply(anim);
  }
  /** Zoom to relative zoom z around stage point (px, py). */
  function zoomAt(z, px, py, anim = false, hard = true) {
    const f = fitS();
    const nz = hard ? clamp(z, 1, maxZ()) : z;
    const ns = f * nz;
    let cx = px + (S.cx - px) * (ns / S.s), cy = py + (S.cy - py) * (ns / S.s);
    if (hard) [cx, cy] = clampC(cx, cy, ns);
    S.s = ns; S.cx = cx; S.cy = cy; apply(anim);
  }
  function settle(anim = true) {
    const f = fitS(), z = S.s / f;
    if (z < 1) return fit(anim);
    if (z > maxZ()) { zoomAt(maxZ(), S.W / 2, S.H / 2, anim); return; }
    const [x, y] = clampC(S.cx, S.cy);
    if (Math.abs(x - S.cx) > 0.5 || Math.abs(y - S.cy) > 0.5 || anim) { S.cx = x; S.cy = y; apply(anim); }
  }
  /** stage px -> normalised image coordinates */
  function toUV(px, py) {
    const r = -S.rot * Math.PI / 180;
    let dx = (px - S.cx) / S.s, dy = (py - S.cy) / S.s;
    const x = dx * Math.cos(r) - dy * Math.sin(r), y = dx * Math.sin(r) + dy * Math.cos(r);
    return [(x + S.nw / 2) / S.nw, (y + S.nh / 2) / S.nh];
  }
  function fromUV(u, v) {
    const r = S.rot * Math.PI / 180;
    const x = (u - 0.5) * S.nw * S.s, y = (v - 0.5) * S.nh * S.s;
    return [S.cx + x * Math.cos(r) - y * Math.sin(r), S.cy + x * Math.sin(r) + y * Math.cos(r)];
  }

  // stage size
  const ro = new ResizeObserver(() => {
    const r = { width: stage.clientWidth, height: stage.clientHeight };
    if (r.width < 2 || r.height < 2) return;
    const wasZ = S.loaded ? zoom() : 1;
    const relX = (S.cx - S.W / 2) / (S.s || 1), relY = (S.cy - S.H / 2) / (S.s || 1);
    S.W = r.width; S.H = r.height;
    layoutTrack();
    if (!S.loaded) return;
    if (wasZ <= 1.01) fit(false);
    else { S.s = fitS() * wasZ; [S.cx, S.cy] = clampC(S.W / 2 + relX * S.s, S.H / 2 + relY * S.s); apply(false); }
  });
  ro.observe(stage);

  function layoutTrack() {
    slotPrev.style.transform = `translateX(${-(S.W + GAP)}px)`;
    slotNext.style.transform = `translateX(${S.W + GAP}px)`;
  }

  // ---------------------------------------------------------------- viewer open / navigation
  function setSide(imgEl, p) {
    imgEl.removeAttribute('src');
    imgEl.style.transform = '';
    if (!p) return;
    const u = urlSync(p);
    const set = (url) => { if (url) { imgEl.src = url; const r = rotations.get(p.id) || 0; imgEl.style.transform = r ? `rotate(${r}deg)` : ''; imgEl.classList.toggle('pv-odd', Math.abs(Math.round(r / 90)) % 2 === 1); } };
    if (u) set(u); else urlFor(p).then((url) => { if (imgEl.dataset.pid === p.id) set(url); });
    imgEl.dataset.pid = p.id;
  }

  let loadToken = 0;
  function showCurrent() {
    const p = curPhoto();
    if (!p) return;
    const tok = ++loadToken;
    S.rot = rotations.get(p.id) || 0;
    S.loaded = false;
    xf.style.visibility = 'hidden';
    missing.hidden = true;
    spinner.hidden = false;
    const onReady = (w, hgt) => {
      if (tok !== loadToken) return;
      S.nw = w; S.nh = hgt; S.loaded = true;
      xf.style.width = w + 'px'; xf.style.height = hgt + 'px';
      marksSvg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
      marksSvg.setAttribute('width', w); marksSvg.setAttribute('height', hgt);
      renderMarks();
      fit(false);
      xf.style.visibility = '';
      spinner.hidden = true;
    };
    const go = (u) => {
      if (tok !== loadToken) return;
      if (!u) { spinner.hidden = true; missing.hidden = false; img.removeAttribute('src'); return; }
      img.onload = () => onReady(img.naturalWidth, img.naturalHeight);
      img.onerror = () => { if (tok === loadToken) { spinner.hidden = true; missing.hidden = false; } };
      if (img.getAttribute('src') !== u) img.src = u;
      if (img.complete && img.naturalWidth) onReady(img.naturalWidth, img.naturalHeight);
    };
    const u = urlSync(p);
    if (u) go(u); else urlFor(p).then(go);

    const list = photos(), i = curIndex();
    setSide(prevImg, list[i - 1]); setSide(nextImg, list[i + 1]);
    navPrev.disabled = i <= 0; navNext.disabled = i >= list.length - 1;
    for (const k of [-1, 1, -2, 2]) preload(list[i + k]);
    renderTitle(); renderFilm(); renderInfo();
  }

  function openViewer(id, fromGallery = false) {
    const p = photoById(id);
    if (!p) return;
    const wasOpen = S.open;
    S.open = true; S.id = id;
    gallery.hidden = true; viewer.hidden = false;
    if (!wasOpen && fromGallery) { viewer.classList.remove('pv-enter'); void viewer.offsetWidth; viewer.classList.add('pv-enter'); }
    track.style.transition = 'none'; track.style.transform = '';
    slotCur.style.transform = ''; viewer.style.removeProperty('--pv-dim');
    setAnnot(false);
    // measure now so the first fit is right even before ResizeObserver fires
    const r = { width: stage.clientWidth, height: stage.clientHeight };
    if (r.width > 1) { S.W = r.width; S.H = r.height; layoutTrack(); }
    showCurrent();
    try { if (store.selection?.kind !== 'photo' || store.selection.id !== id) store.select({ kind: 'photo', id }); } catch { /* ignore */ }
    if (S.active) stage.focus({ preventScroll: true });
  }

  function closeViewer() {
    if (!S.open) return;
    commitText(false);
    setAnnot(false);
    S.open = false;
    if (isFs()) exitFs();
    viewer.classList.remove('pv-pseudo-fs'); updateFsBtn();
    viewer.hidden = true; gallery.hidden = false;
    renderGallery();
    const tile = grid.querySelector(`[data-id="${CSS.escape(S.id || '')}"]`);
    if (tile) { tile.scrollIntoView({ block: 'nearest' }); tile.focus({ preventScroll: true }); }
  }

  function nav(delta) {
    if (S.navBusy) return;
    const list = photos(), i = curIndex(), j = i + delta;
    commitText(false);
    if (j < 0 || j >= list.length) {
      // bounce
      track.style.transition = 'transform .18s ease-out';
      track.style.transform = `translateX(${-delta * 36}px)`;
      setTimeout(() => { track.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)'; track.style.transform = ''; }, 180);
      return;
    }
    S.navBusy = true;
    if (zoom() > 1.01) fit(false);
    track.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1)';
    track.style.transform = `translateX(${-delta * (S.W + GAP)}px)`;
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      S.id = list[j].id;
      track.style.transition = 'none';
      showCurrent();
      track.style.transform = '';
      S.navBusy = false;
      try { store.select({ kind: 'photo', id: S.id }); } catch { /* ignore */ }
    };
    track.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 380);
  }

  // ---------------------------------------------------------------- title, filmstrip
  function renderTitle() {
    const p = curPhoto(); if (!p) return;
    const list = photos();
    titleBox.querySelector('b').textContent = p.name || T('untitled');
    titleBox.querySelector('small').textContent = [roomOf(p), fmtDate(p.taken, true), `${curIndex() + 1}/${list.length}`].filter(Boolean).join(' · ');
  }
  function renderFilm() {
    const list = photos();
    const old = new Map([...film.children].map((c) => [c.dataset.id, c]));
    const frag = document.createDocumentFragment();
    for (const p of list) {
      let b = old.get(p.id);
      const key = p.id + '|' + (p.src || '');
      if (!b || b.dataset.key !== key) {
        b = h('button', { type: 'button', class: 'pv-fthumb', role: 'option' }, '<img alt="" draggable="false" decoding="async">');
        b.dataset.id = p.id; b.dataset.key = key;
        const im = b.querySelector('img'); im.dataset.thumb = p.id; lazyThumb(im);
      }
      const on = p.id === S.id;
      b.classList.toggle('pv-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('aria-label', p.name || T('untitled'));
      frag.append(b);
    }
    film.replaceChildren(frag);
    const cur = film.querySelector('.pv-on');
    if (cur) requestAnimationFrame(() => {
      const left = cur.offsetLeft - film.clientWidth / 2 + cur.offsetWidth / 2;
      film.scrollTo({ left, behavior: film.dataset.ready ? 'smooth' : 'auto' });
      film.dataset.ready = '1';
    });
  }
  film.addEventListener('click', (e) => {
    const b = e.target.closest('.pv-fthumb'); if (!b || b.dataset.id === S.id) return;
    const d = photos().findIndex((p) => p.id === b.dataset.id) - curIndex();
    if (Math.abs(d) === 1) nav(d); else { S.id = b.dataset.id; if (zoom() > 1.01) fit(); showCurrent(); }
  });

  // ---------------------------------------------------------------- info panel
  function renderInfo() {
    const p = curPhoto(); if (!p || !S.info) return;
    if (document.activeElement !== inName) inName.value = p.name || '';
    if (document.activeElement !== inNote) inNote.value = p.note || '';
    const units = store.settings.units;
    info.querySelector('.pv-m-date').textContent = fmtDate(p.taken, true) || '—';
    info.querySelector('.pv-m-room').textContent = roomOf(p) || T('noRoom');
    info.querySelector('.pv-m-pos').textContent = `${fmtLen(p.x, { units, forceM: true })}, ${fmtLen(p.y, { units, forceM: true })}`;
    const d = normDeg(p.dir || 0);
    info.querySelector('.pv-m-dir').innerHTML = `<span class="pv-dir-ic" style="transform:rotate(${d}deg)">${icon('dirArrow')}</span>${d}°`;
    info.querySelector('.pv-m-fov').textContent = `${Math.round(p.fov || 70)}°`;
    renderMiniMap(p);
  }
  function renderMiniMap(p) {
    const plan = store.plan;
    const nodes = Object.values(plan.nodes || {});
    const pts = nodes.concat(photos());
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of pts) { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); }
    if (!isFinite(minX)) { minX = p.x - 2; maxX = p.x + 2; minY = p.y - 2; maxY = p.y + 2; }
    const pad = 0.7;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = Math.max(maxX - minX, 2), hh = Math.max(maxY - minY, 2);
    miniSvg.setAttribute('viewBox', `${minX} ${minY} ${w} ${hh}`);
    miniSvg.setAttribute('aria-label', `${T('planOf')}: ${p.name || ''}`);
    let s = '';
    try {
      for (const f of computeRooms(plan)) s += `<polygon class="mm-room${pointInPolygon(p, f.pts) ? ' mm-here' : ''}" points="${f.pts.map((q) => `${q.x},${q.y}`).join(' ')}"/>`;
    } catch { /* ignore */ }
    for (const wl of plan.walls || []) {
      const a = plan.nodes[wl.a], b = plan.nodes[wl.b]; if (!a || !b) continue;
      s += wl.kind === 'virtual'
        ? `<line class="mm-virtual" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`
        : `<line class="mm-wall" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${Math.max(wl.thickness || 0.15, 0.09)}"/>`;
    }
    for (const o of plan.openings || []) {
      try {
        const g = openingGeom(plan, o), th = (g.wall.thickness || 0.15) + 0.03;
        s += `<line class="mm-gap" x1="${g.p0.x}" y1="${g.p0.y}" x2="${g.p1.x}" y2="${g.p1.y}" stroke-width="${th}"/>`;
        if (o.type === 'window') s += `<line class="mm-window" x1="${g.p0.x}" y1="${g.p0.y}" x2="${g.p1.x}" y2="${g.p1.y}"/>`;
      } catch { /* ignore */ }
    }
    for (const q of photos()) {
      if (q.id === p.id) continue;
      s += `<circle class="mm-other" data-id="${esc(q.id)}" cx="${q.x}" cy="${q.y}" r="0.16"><title>${esc(q.name || '')}</title></circle>`;
    }
    const R = clamp(Math.min(w, hh) * 0.2, 1.1, 2.4);
    const fov = clamp(p.fov || 70, 5, 170), a0 = ((p.dir || 0) - fov / 2) * Math.PI / 180, a1 = ((p.dir || 0) + fov / 2) * Math.PI / 180;
    const x0 = p.x + R * Math.cos(a0), y0 = p.y + R * Math.sin(a0), x1 = p.x + R * Math.cos(a1), y1 = p.y + R * Math.sin(a1);
    s += `<defs><radialGradient id="pvcone" gradientUnits="userSpaceOnUse" cx="${p.x}" cy="${p.y}" r="${R}"><stop offset="0" class="mm-cone-a"/><stop offset="1" class="mm-cone-b"/></radialGradient></defs>`;
    s += `<path class="mm-cone" d="M${p.x} ${p.y}L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z" fill="url(#pvcone)"/>`;
    s += `<circle class="mm-pin" cx="${p.x}" cy="${p.y}" r="0.2"/>`;
    miniSvg.innerHTML = s;
  }
  miniSvg.addEventListener('click', (e) => {
    const c = e.target.closest('.mm-other');
    if (c) openViewer(c.dataset.id);
  });
  const commitField = (field, el) => {
    const p = curPhoto(); if (!p) return;
    const v = field === 'name' ? el.value.trim() : el.value;
    if ((p[field] ?? '') === v) return;
    store.commit(field === 'name' ? t('rename') : t('note'), (plan) => {
      const q = plan.photos.find((x) => x.id === p.id); if (q) q[field] = v;
    });
  };
  inName.addEventListener('change', () => commitField('name', inName));
  inNote.addEventListener('change', () => commitField('note', inNote));
  inName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inName.blur(); } });
  info.querySelector('.pv-showplan').onclick = () => {
    if (S.id) store.emit('navigate', { tab: 'plan', focus: { kind: 'photo', id: S.id } });
  };
  function setInfo(on) {
    S.info = on;
    info.hidden = !on;
    infoBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    viewer.classList.toggle('pv-info-open', on);
    if (on) renderInfo();
  }

  // ---------------------------------------------------------------- annotations
  function markSvg(m, preview = false) {
    const W = S.nw, H = S.nh, base = Math.max(W, H);
    const sw = base * 0.0045, P = (q) => [q[0] * W, q[1] * H];
    const col = esc(m.color || COLORS[0]);
    const pts = (m.pts || []).map(P);
    if (!pts.length) return '';
    const halo = `stroke="rgba(0,0,0,.35)" stroke-width="${sw * 2.2}"`;
    const cls = preview ? 'mk mk-preview' : 'mk';
    if (m.kind === 'pen') {
      if (pts.length < 2) pts.push([pts[0][0] + 0.1, pts[0][1] + 0.1]);
      const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('');
      return `<g class="${cls}"><path d="${d}" fill="none" ${halo} stroke-linecap="round" stroke-linejoin="round" opacity=".45"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    }
    if (m.kind === 'text') {
      const fs = base * 0.03;
      return `<text class="${cls} mk-text" x="${pts[0][0]}" y="${pts[0][1]}" font-size="${fs}" fill="${col}" stroke="rgba(0,0,0,.55)" stroke-width="${fs * 0.14}" paint-order="stroke" stroke-linejoin="round" dominant-baseline="middle">${esc(m.text || '')}</text>`;
    }
    const [a, b] = [pts[0], pts[1] || pts[0]];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    if (m.kind === 'arrow') {
      const hl = Math.min(base * 0.035, L * 0.45), hw = hl * 0.6;
      const bx = b[0] - ux * hl, by = b[1] - uy * hl;
      const head = `${b[0]},${b[1]} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`;
      return `<g class="${cls}"><line x1="${a[0]}" y1="${a[1]}" x2="${bx}" y2="${by}" ${halo} stroke-linecap="round" opacity=".45"/><polygon points="${head}" fill="rgba(0,0,0,.35)" stroke="rgba(0,0,0,.35)" stroke-width="${sw}" stroke-linejoin="round"/>
        <line x1="${a[0]}" y1="${a[1]}" x2="${bx + ux * 1}" y2="${by + uy * 1}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/><polygon points="${head}" fill="${col}" stroke="${col}" stroke-width="${sw * 0.4}" stroke-linejoin="round"/></g>`;
    }
    // measurement line: line with end ticks and an optional label
    const tk = base * 0.014, nx = -uy * tk, ny = ux * tk;
    const seg = (p1, p2, extra) => `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" ${extra}/>`;
    const geo = (extra) => seg(a, b, extra) + seg([a[0] + nx, a[1] + ny], [a[0] - nx, a[1] - ny], extra) + seg([b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], extra);
    let s = `<g class="${cls}">${geo(`${halo} stroke-linecap="round" opacity=".45"`)}${geo(`stroke="${col}" stroke-width="${sw}" stroke-linecap="round"`)}`;
    if (m.text) {
      const fs = base * 0.024;
      let ang = Math.atan2(dy, dx) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const off2 = fs * 1.05, lx = mx + Math.sin(ang * Math.PI / 180) * off2, ly = my - Math.cos(ang * Math.PI / 180) * off2;
      const tw = [...m.text].length * fs * 0.6 + fs * 0.9, th = fs * 1.5;
      const ink = /^#(ffcc00|34c759)$/i.test(m.color || '') ? '#111' : '#fff';
      s += `<g transform="rotate(${ang} ${lx} ${ly})"><rect x="${lx - tw / 2}" y="${ly - th / 2}" width="${tw}" height="${th}" rx="${th / 2}" fill="${col}" stroke="rgba(0,0,0,.25)" stroke-width="${fs * 0.06}"/>
        <text x="${lx}" y="${ly}" font-size="${fs}" fill="${ink}" text-anchor="middle" dominant-baseline="central" font-weight="700" class="mk-text">${esc(m.text)}</text></g>`;
    }
    return s + '</g>';
  }
  function renderMarks() {
    const p = curPhoto();
    if (!p || !S.loaded) { marksG.innerHTML = ''; return; }
    marksG.innerHTML = (p.marks || []).map((m) => markSvg(m)).join('');
    undoMarkBtn.disabled = !(p.marks && p.marks.length);
  }
  function setPreview(m) { previewG.innerHTML = m ? markSvg(m, true) : ''; }
  function addMark(m) {
    const p = curPhoto(); if (!p) return;
    const r = (v) => Math.round(v * 10000) / 10000;
    m.pts = m.pts.map(([u, v]) => [r(u), r(v)]);
    store.commit(t('annotate'), (plan) => {
      const q = plan.photos.find((x) => x.id === p.id); if (!q) return;
      if (!Array.isArray(q.marks)) q.marks = [];
      q.marks.push(m);
    });
  }
  function undoMark() {
    const p = curPhoto(); if (!p || !p.marks?.length) return;
    store.commit(t('undo'), (plan) => { const q = plan.photos.find((x) => x.id === p.id); if (q?.marks?.length) q.marks.pop(); });
  }
  function setAnnot(on) {
    if (!on) commitText(false);
    S.annot = on;
    annBar.hidden = !on;
    viewer.classList.toggle('pv-annot', on);
    annBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    setPreview(null);
    if (on) { setTool(S.tool); setColor(S.color); }
  }
  function setTool(k) {
    commitText(true);
    S.tool = k;
    for (const [n, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', n === k ? 'true' : 'false');
  }
  function setColor(c) {
    S.color = c;
    for (const b of colorBtns) b.setAttribute('aria-checked', b.dataset.color === c ? 'true' : 'false');
    annBar.style.setProperty('--pv-ink', c);
  }
  toolRow.addEventListener('click', (e) => { const b = e.target.closest('.pv-tool'); if (b) setTool(b.dataset.tool); });
  colorRow.addEventListener('click', (e) => { const b = e.target.closest('.pv-color'); if (b) setColor(b.dataset.color); });
  undoMarkBtn.onclick = undoMark;
  doneBtn.onclick = () => setAnnot(false);

  // text entry (text tool, or label of a measurement line)
  let pendingText = null; // { mark }
  function beginText(mark, px, py) {
    pendingText = { mark };
    textInput.hidden = false;
    textInput.value = mark.text || '';
    textInput.placeholder = mark.kind === 'line' ? T('labelPh') : T('textPh');
    textInput.style.setProperty('--c', mark.color);
    const w = Math.min(240, S.W - 24);
    textInput.style.left = `${clamp(px - (mark.kind === 'line' ? w / 2 : 12), 12, S.W - w - 12)}px`;
    textInput.style.top = `${clamp(py - 22, 8, S.H - 52)}px`;
    textInput.style.width = `${w}px`;
    if (mark.kind === 'line') setPreview(mark);
    textInput.focus({ preventScroll: true });
  }
  function commitText(save = true) {
    if (!pendingText) return;
    const { mark } = pendingText; pendingText = null;
    const txt = textInput.value.trim();
    textInput.hidden = true; textInput.value = '';
    setPreview(null);
    if (!save) { if (mark.kind === 'line') addMark(mark); return; }
    if (mark.kind === 'text') { if (txt) addMark({ ...mark, text: txt.slice(0, 120) }); }
    else addMark(txt ? { ...mark, text: txt.slice(0, 40) } : mark);
  }
  textInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitText(true); stage.focus({ preventScroll: true }); }
    else if (e.key === 'Escape') { e.preventDefault(); commitText(false); stage.focus({ preventScroll: true }); }
  });
  textInput.addEventListener('blur', () => commitText(true));

  // ---------------------------------------------------------------- pointer gestures
  const ptrs = new Map();
  let g = null;           // active gesture
  let lastTap = null, tapTimer = 0;
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const isCtl = (e) => e.target.closest('.pv-ctl, .pv-nav, .pv-textin');

  function startPinch() {
    const [a, b] = [...ptrs.values()];
    g = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: [(a.x + b.x) / 2, (a.y + b.y) / 2], s0: S.s, c0: [S.cx, S.cy] };
  }
  function cancelSingle() {
    if (!g) return;
    if (g.type === 'draw') setPreview(null);
    if (g.type === 'swipe') { track.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)'; track.style.transform = ''; }
    if (g.type === 'dismiss') resetDismiss();
  }
  function resetDismiss() {
    slotCur.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)';
    slotCur.style.transform = '';
    viewer.style.removeProperty('--pv-dim');
    setTimeout(() => { slotCur.style.transition = ''; }, 260);
  }

  stage.addEventListener('pointerdown', (e) => {
    if (isCtl(e)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pendingText) { commitText(true); }
    const [x, y] = rel(e);
    ptrs.set(e.pointerId, { x, y });
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (ptrs.size === 2) { cancelSingle(); if (S.loaded) startPinch(); else g = null; return; }
    if (ptrs.size > 2) return;
    const now = performance.now();
    g = { type: 'pending', x0: x, y0: y, t0: now, c0: [S.cx, S.cy], samples: [[x, y, now]], ptype: e.pointerType };
    if (S.annot && S.loaded && S.tool !== 'text') {
      const uv = toUV(x, y);
      if (uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1) g = { ...g, type: 'draw', mark: { kind: S.tool, pts: [uv], color: S.color }, moved: false };
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const [x, y] = rel(e);
    ptrs.set(e.pointerId, { x, y });
    if (!g) return;
    const now = performance.now();
    if (g.type === 'pinch') {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const f = fitS(), mz = maxZ();
      let ns = g.s0 * d / g.d0, z = ns / f;
      if (z < 1) z = 1 - (1 - z) * 0.45; // rubber-band below fit
      if (z > mz) z = mz + (z - mz) * 0.25;
      ns = z * f;
      S.s = ns; S.cx = m[0] + (g.c0[0] - g.m0[0]) * (ns / g.s0); S.cy = m[1] + (g.c0[1] - g.m0[1]) * (ns / g.s0);
      apply(false);
      return;
    }
    const dx = x - g.x0, dy = y - g.y0;
    g.samples.push([x, y, now]);
    while (g.samples.length > 2 && now - g.samples[0][2] > 100) g.samples.shift();
    if (g.type === 'draw') {
      const uv = toUV(x, y).map((v) => clamp(v, 0, 1));
      if (Math.hypot(dx, dy) > 3) g.moved = true;
      if (g.mark.kind === 'pen') {
        const last = g.mark.pts[g.mark.pts.length - 1], [lx, ly] = fromUV(last[0], last[1]);
        if (Math.hypot(x - lx, y - ly) >= 2.5) g.mark.pts.push(uv);
      } else g.mark.pts[1] = uv;
      if (g.moved) setPreview(g.mark);
      return;
    }
    if (g.type === 'pending') {
      if (Math.hypot(dx, dy) < 7) return;
      if (!S.loaded) g.type = Math.abs(dx) >= Math.abs(dy) ? 'swipe' : 'none';
      else if (zoom() > 1.01) g.type = 'pan';
      else if (Math.abs(dx) >= Math.abs(dy)) g.type = 'swipe';
      else if (dy > 0) g.type = 'dismiss';
      else g.type = 'none';
      clearTimeout(tapTimer); lastTap = null;
      stage.classList.add('pv-grabbing');
    }
    if (g.type === 'pan') {
      let cx = g.c0[0] + dx, cy = g.c0[1] + dy;
      const [tx, ty] = clampC(cx, cy);
      S.cx = cx === tx ? cx : rubber(cx, tx); S.cy = cy === ty ? cy : rubber(cy, ty);
      apply(false);
    } else if (g.type === 'swipe') {
      const i = curIndex(), n = photos().length;
      let ox = dx;
      if ((dx > 0 && i <= 0) || (dx < 0 && i >= n - 1)) ox = dx * 0.3;
      track.style.transition = 'none';
      track.style.transform = `translateX(${ox}px)`;
    } else if (g.type === 'dismiss') {
      const k = clamp(dy / (S.H * 0.6), 0, 1);
      slotCur.style.transition = 'none';
      slotCur.style.transform = `translate(${dx * 0.6}px, ${Math.max(0, dy)}px) scale(${1 - k * 0.25})`;
      viewer.style.setProperty('--pv-dim', String(1 - k * 0.85));
    }
  });

  function velocity() {
    const s = g?.samples; if (!s || s.length < 2) return [0, 0];
    const a = s[0], b = s[s.length - 1], dt = Math.max(b[2] - a[2], 1);
    return [(b[0] - a[0]) / dt, (b[1] - a[1]) / dt]; // px/ms
  }

  function endPointer(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    stage.classList.remove('pv-grabbing');
    if (!g) return;
    const cancelled = e.type === 'pointercancel';
    if (g.type === 'pinch') {
      if (ptrs.size === 1) {
        // continue as a pan with the remaining finger
        const [p] = [...ptrs.values()];
        settle(true);
        g = { type: 'none', x0: p.x, y0: p.y, samples: [] };
        return;
      }
      g = null; settle(true); return;
    }
    if (ptrs.size > 0) return;
    const [x, y] = rel(e);
    const cur = g; g = null;
    if (cur.type === 'draw') {
      const m = cur.mark;
      setPreview(null);
      if (cancelled || !cur.moved) return;
      if (m.kind === 'pen') { if (m.pts.length > 1) addMark(m); return; }
      const [ax, ay] = fromUV(m.pts[0][0], m.pts[0][1]), [bx, by] = fromUV(m.pts[1][0], m.pts[1][1]);
      if (Math.hypot(bx - ax, by - ay) < 12) return;
      if (m.kind === 'line') beginText(m, (ax + bx) / 2, (ay + by) / 2);
      else addMark(m);
      return;
    }
    if (cur.type === 'pending' && !cancelled) {
      const now = performance.now();
      if (now - cur.t0 > 500) return;
      if (S.annot && S.tool === 'text' && S.loaded) {
        const [u, v] = toUV(x, y);
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) beginText({ kind: 'text', pts: [[u, v]], color: S.color, text: '' }, x, y);
        return;
      }
      if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
        clearTimeout(tapTimer); lastTap = null;
        if (!S.loaded) return;
        if (zoom() > 1.05) fit(true); else zoomAt(2.5, x, y, true);
        return;
      }
      lastTap = { x, y, t: now };
      clearTimeout(tapTimer);
      if (cur.ptype !== 'mouse' && !S.annot) tapTimer = setTimeout(() => { lastTap = null; toggleChrome(); }, 330);
      return;
    }
    if (cur.type === 'pan') {
      const [vx, vy] = velocity();
      const speed = Math.hypot(vx, vy);
      if (!cancelled && speed > 0.25) {
        // inertia: glide in the release direction, clamped to the image bounds
        const k = 220;
        [S.cx, S.cy] = clampC(S.cx + vx * k, S.cy + vy * k);
        xf.classList.add('pv-glide');
        apply(false);
        setTimeout(() => xf.classList.remove('pv-glide'), 460);
      } else settle(true);
      return;
    }
    if (cur.type === 'swipe') {
      const dx = x - cur.x0, [vx] = velocity();
      const i = curIndex(), n = photos().length;
      let d = 0;
      if (!cancelled && (Math.abs(dx) > S.W * 0.22 || (Math.abs(vx) > 0.45 && Math.abs(dx) > 20))) d = dx < 0 ? 1 : -1;
      if (d && i + d >= 0 && i + d < n) nav(d);
      else { track.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1)'; track.style.transform = ''; }
      return;
    }
    if (cur.type === 'dismiss') {
      const dy = y - cur.y0, [, vy] = velocity();
      if (!cancelled && (dy > S.H * 0.18 || (vy > 0.6 && dy > 30))) {
        slotCur.style.transition = 'transform .22s ease-in, opacity .22s ease-in';
        slotCur.style.transform = `translateY(${S.H * 0.5}px) scale(.7)`;
        slotCur.style.opacity = '0';
        setTimeout(() => { slotCur.style.transition = ''; slotCur.style.transform = ''; slotCur.style.opacity = ''; viewer.style.removeProperty('--pv-dim'); closeViewer(); }, 200);
      } else resetDismiss();
    }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) endPointer(e); });

  // wheel / trackpad
  let wheelSettle = 0;
  stage.addEventListener('wheel', (e) => {
    if (!S.loaded || isCtl(e)) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? S.H : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    const [x, y] = rel(e);
    if (!e.ctrlKey && zoom() > 1.01 && (Math.abs(dx) > Math.abs(dy) || e.shiftKey)) {
      // horizontal / shift scroll pans when zoomed
      const px = e.shiftKey && !dx ? dy : dx, py = e.shiftKey ? 0 : dy;
      [S.cx, S.cy] = clampC(S.cx - px, S.cy - py); apply(false);
      return;
    }
    if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) return;
    const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022));
    zoomAt(zoom() * f, x, y, false, true);
    clearTimeout(wheelSettle);
    wheelSettle = setTimeout(() => settle(false), 120);
  }, { passive: false });

  // Safari trackpad pinch
  let gsBase = 1;
  stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gsBase = zoom(); });
  stage.addEventListener('gesturechange', (e) => { e.preventDefault(); const [x, y] = rel(e); zoomAt(gsBase * e.scale, x, y); });
  stage.addEventListener('gestureend', (e) => e.preventDefault());

  function toggleChrome(force) {
    S.chrome = force ?? !S.chrome;
    viewer.classList.toggle('pv-immersive', !S.chrome);
  }

  // ---------------------------------------------------------------- buttons
  backBtn.onclick = () => closeViewer();
  navPrev.onclick = () => nav(-1);
  navNext.onclick = () => nav(1);
  zIn.onclick = () => zoomAt(zoom() * 1.6, S.W / 2, S.H / 2, true);
  zOut.onclick = () => { const z = zoom() / 1.6; if (z <= 1.02) fit(true); else zoomAt(z, S.W / 2, S.H / 2, true); };
  zFit.onclick = () => fit(true);
  rotBtn.onclick = () => {
    if (!S.id) return;
    S.rot -= 90; rotations.set(S.id, S.rot);
    if (!S.loaded) return;
    S.s = fitS(); S.cx = S.W / 2; S.cy = S.H / 2; apply(true);
  };
  annBtn.onclick = () => { setAnnot(!S.annot); if (S.annot) toggleChrome(true); };
  infoBtn.onclick = () => setInfo(!S.info);
  delBtn.onclick = async () => {
    const p = curPhoto(); if (!p) return;
    if (!confirm(T('confirmDelete'))) return;
    const list = photos(), i = curIndex();
    const nextId = (list[i + 1] || list[i - 1] || {}).id;
    store.commit(t('delete'), (plan) => { plan.photos = plan.photos.filter((x) => x.id !== p.id); });
    if (!p.src) photoBlobs.remove(p.id);
    forgetPhoto(p);
    if (nextId) { S.id = nextId; showCurrent(); } else closeViewer();
  };

  // fullscreen (Fullscreen API with a CSS fallback for iPhone Safari)
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFs = () => fsEl() === viewer;
  const canFs = () => !!(viewer.requestFullscreen || viewer.webkitRequestFullscreen) && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? true);
  function exitFs() { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { /* ignore */ } }
  function updateFsBtn() {
    const on = isFs() || viewer.classList.contains('pv-pseudo-fs');
    fsBtn.innerHTML = icon(on ? 'exitFs' : 'fullscreen');
    fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  fsBtn.onclick = async () => {
    if (isFs()) { exitFs(); return; }
    if (viewer.classList.contains('pv-pseudo-fs')) { viewer.classList.remove('pv-pseudo-fs'); updateFsBtn(); return; }
    if (canFs()) {
      try { await (viewer.requestFullscreen || viewer.webkitRequestFullscreen).call(viewer); return; } catch { /* fall back */ }
    }
    viewer.classList.add('pv-pseudo-fs'); updateFsBtn();
  };
  document.addEventListener('fullscreenchange', updateFsBtn);
  document.addEventListener('webkitfullscreenchange', updateFsBtn);

  // ---------------------------------------------------------------- keyboard
  function onKey(e) {
    if (!S.active || !S.open || viewer.hidden) return;
    const tg = e.target;
    if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': if (zoom() > 1.01) { [S.cx, S.cy] = clampC(S.cx + 80, S.cy); apply(true); } else nav(-1); break;
      case 'ArrowRight': if (zoom() > 1.01) { [S.cx, S.cy] = clampC(S.cx - 80, S.cy); apply(true); } else nav(1); break;
      case 'ArrowUp': if (zoom() > 1.01) { [S.cx, S.cy] = clampC(S.cx, S.cy + 80); apply(true); } else handled = false; break;
      case 'ArrowDown': if (zoom() > 1.01) { [S.cx, S.cy] = clampC(S.cx, S.cy - 80); apply(true); } else handled = false; break;
      case 'Escape':
        if (isFs()) handled = false;
        else if (S.annot) setAnnot(false);
        else if (viewer.classList.contains('pv-pseudo-fs')) { viewer.classList.remove('pv-pseudo-fs'); updateFsBtn(); }
        else closeViewer();
        break;
      case '+': case '=': zIn.onclick(); break;
      case '-': case '_': zOut.onclick(); break;
      case '0': fit(true); break;
      case 'i': case 'I': setInfo(!S.info); break;
      case 'r': case 'R': rotBtn.onclick(); break;
      case 'f': case 'F': fsBtn.onclick(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  window.addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------------- store sync
  function relabel() {
    for (const el of root.querySelectorAll('[data-al]')) { const s = T(el.dataset.al); el.setAttribute('aria-label', s); el.title = s; }
    for (const el of root.querySelectorAll('[data-tx]')) el.textContent = T(el.dataset.tx);
    inNote.placeholder = T('notePh');
  }
  store.on('change', () => {
    if (!S.active) return;
    if (S.open) {
      if (!curPhoto()) {
        const first = photos()[0];
        if (first) { S.id = first.id; showCurrent(); } else closeViewer();
        return;
      }
      renderTitle(); renderMarks(); renderFilm(); renderInfo();
      navPrev.disabled = curIndex() <= 0; navNext.disabled = curIndex() >= photos().length - 1;
    } else renderGallery();
  });
  store.on('settings', () => { relabel(); if (!S.active) return; if (S.open) { renderTitle(); renderInfo(); apply(false); } else renderGallery(); });

  // ---------------------------------------------------------------- public API
  return {
    activate() {
      S.active = true;
      root.hidden = false;
      if (S.open) {
        const r = { width: stage.clientWidth, height: stage.clientHeight };
        if (r.width > 1) { S.W = r.width; S.H = r.height; layoutTrack(); }
        showCurrent();
      } else renderGallery();
    },
    deactivate() {
      S.active = false;
      commitText(true);
      if (isFs()) exitFs();
      ptrs.clear(); g = null;
    },
    open(photoId) {
      if (!photoById(photoId)) return;
      openViewer(photoId);
    },
  };
}
