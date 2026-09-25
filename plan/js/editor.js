// Plan tab: zoomable/pannable plan with editing tools, object library and inspector.

import * as G from './geometry.js';
import * as M from './model.js';
import { CATALOG, CATEGORIES, catalogLabel, makeObject, symbolSVG } from './catalog.js';
import { store } from './store.js';
import { t, lang } from './i18n.js';
import { fmtLen, fmtLenShort, fmtArea, parseLen, getUnits, fmtAngle } from './units.js';
import { Viewport, renderPlan, analyse, hitFromElement, nearestWall, scaleBar, gridStep } from './planview.js';
import { icon } from './icons.js';

const TOOLS = [
  { id: 'select', icon: 'cursor', key: 'v' },
  { id: 'wall', icon: 'wall', key: 'w' },
  { id: 'virtual', icon: 'divider', key: 'l', label: 'virtualWall' },
  { id: 'door', icon: 'door', key: 'd' },
  { id: 'window', icon: 'window', key: 'n' },
  { id: 'opening', icon: 'opening', key: 'o' },
  { id: 'library', icon: 'sofa', key: 'f', label: 'library' },
  { id: 'room', icon: 'room', key: 'r' },
  { id: 'measure', icon: 'ruler', key: 'm' },
  { id: 'note', icon: 'note', key: 't' },
  { id: 'photo', icon: 'camera', key: 'p', label: 'photoPin' },
];

const TIPS = { wall: 'tipWall', virtual: 'tipWall', door: 'tipOpening', window: 'tipOpening', opening: 'tipOpening', object: 'tipObject', room: 'tipRoom', measure: 'tipMeasure', note: 'tipNote', photo: 'tipPhoto' };

export function createPlanView(container) {
  const vp = new Viewport();
  let info = null;           // analyse(plan) cache
  let worldDirty = true;
  let raf = 0;
  let tool = 'select';
  let objectType = null;     // for tool 'object'
  let preview = {};
  let measures = [];
  let measureStart = null;
  let wallStart = null;      // world point where the current wall chain starts
  let chainFirst = null;     // first point of the chain (to detect closing)
  let hover = null;
  let fitted = false;
  let active = false;
  let pendingPhotoAt = null;
  let highlight = null;

  // ---------------------------------------------------------------- DOM
  container.innerHTML = `
  <div class="pl-root">
    <div class="pl-toolbar" role="toolbar" aria-label="Tools"></div>
    <div class="pl-stage">
      <svg class="pl-svg" xmlns="http://www.w3.org/2000/svg" tabindex="0" aria-label="Floor plan">
        <defs>
          <pattern id="gridMinor" patternUnits="userSpaceOnUse" width="10" height="10"><path class="grid-minor" d="M10 0H0V10" fill="none"/></pattern>
          <pattern id="gridMajor" patternUnits="userSpaceOnUse" width="50" height="50"><path class="grid-major" d="M50 0H0V50" fill="none"/></pattern>
        </defs>
        <rect class="grid-bg minor" width="100%" height="100%" fill="url(#gridMinor)"/>
        <rect class="grid-bg major" width="100%" height="100%" fill="url(#gridMajor)"/>
        <g class="world"></g>
        <g class="screen"></g>
      </svg>
      <div class="pl-hint" hidden></div>
      <div class="pl-zoom">
        <button class="icon-btn" data-z="out" aria-label="${t('zoomOut')}">${icon('minus')}</button>
        <button class="pl-zoom-pct" data-z="fit" aria-label="${t('fit')}">100 %</button>
        <button class="icon-btn" data-z="in" aria-label="${t('zoomIn')}">${icon('plus')}</button>
        <button class="icon-btn" data-z="fit" aria-label="${t('fit')}">${icon('fit')}</button>
      </div>
      <div class="pl-scale"><div class="bar"></div><span></span></div>
    </div>
    <aside class="pl-inspector" aria-label="${t('properties')}">
      <button class="pl-insp-grip" aria-label="${t('properties')}"></button>
      <div class="pl-insp-body"></div>
    </aside>
    <div class="pl-library" hidden>
      <div class="lib-head"><input type="search" class="lib-search" placeholder="${t('search')}"><button class="icon-btn lib-close" aria-label="${t('close')}">${icon('close')}</button></div>
      <div class="lib-body"></div>
    </div>
    <input type="file" class="pl-photo-input" accept="image/*" multiple hidden>
  </div>`;
  const $ = (s) => container.querySelector(s);
  const root = $('.pl-root'), stage = $('.pl-stage'), svg = $('.pl-svg');
  const worldG = $('.world'), screenG = $('.screen');
  const toolbar = $('.pl-toolbar'), inspector = $('.pl-insp-body'), hintEl = $('.pl-hint');
  const library = $('.pl-library'), libBody = $('.lib-body'), libSearch = $('.lib-search');
  const photoInput = $('.pl-photo-input');

  // ---------------------------------------------------------------- toolbar
  function buildToolbar() {
    toolbar.innerHTML = TOOLS.map((tl) => `<button class="tool-btn" data-tool="${tl.id}" aria-label="${t(tl.label || tl.id)}" title="${t(tl.label || tl.id)} (${tl.key.toUpperCase()})">${icon(tl.icon)}<span>${t(tl.label || tl.id)}</span></button>`).join('');
    syncToolbar();
  }
  function syncToolbar() {
    for (const b of toolbar.querySelectorAll('.tool-btn')) {
      const id = b.dataset.tool;
      const on = id === tool || (id === 'library' && (tool === 'object' || !library.hidden));
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on);
    }
  }
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('.tool-btn'); if (!b) return;
    const id = b.dataset.tool;
    if (id === 'library') { toggleLibrary(); return; }
    setTool(id);
  });

  function setTool(id, opts = {}) {
    finishWallChain();
    tool = id;
    if (id !== 'object') objectType = null;
    if (id !== 'measure') { measureStart = null; }
    if (id !== 'object' && !opts.keepLibrary) library.hidden = true;
    preview = {};
    const tip = TIPS[id];
    hintEl.hidden = !tip;
    if (tip) hintEl.textContent = t(tip);
    stage.dataset.tool = id;
    syncToolbar();
    schedule(true);
  }

  // ---------------------------------------------------------------- library
  function buildLibrary(filter = '') {
    const q = filter.trim().toLowerCase();
    let html = '';
    for (const c of CATEGORIES) {
      const items = Object.entries(CATALOG).filter(([id, it]) => it.cat === c.id && (!q || it.en.toLowerCase().includes(q) || it.fr.toLowerCase().includes(q) || id.toLowerCase().includes(q)));
      if (!items.length) continue;
      html += `<h4>${lang() === 'fr' ? c.fr : c.en}</h4><div class="lib-grid">`;
      for (const [id, it] of items) {
        const o = { type: id, w: it.w, d: it.d };
        const m = Math.max(it.w, it.d) * 0.62;
        html += `<button class="lib-item${objectType === id ? ' is-on' : ''}" data-type="${id}" title="${catalogLabel(id, lang())}">
          <svg viewBox="${-m} ${-m} ${2 * m} ${2 * m}" class="lib-sym"><g class="pv-obj">${symbolSVG(o)}</g></svg>
          <span>${catalogLabel(id, lang())}</span><small>${fmtLenShort(it.w)} × ${fmtLenShort(it.d)}</small></button>`;
      }
      html += '</div>';
    }
    libBody.innerHTML = html || `<p class="muted">—</p>`;
  }
  function toggleLibrary(force) {
    const show = force ?? library.hidden;
    library.hidden = !show;
    if (show) { buildLibrary(libSearch.value); if (window.innerWidth > 700) libSearch.focus(); }
    syncToolbar();
  }
  libSearch.addEventListener('input', () => buildLibrary(libSearch.value));
  $('.lib-close').addEventListener('click', () => { toggleLibrary(false); if (tool === 'object') setTool('select'); });
  libBody.addEventListener('click', (e) => {
    const b = e.target.closest('.lib-item'); if (!b) return;
    objectType = b.dataset.type;
    setTool('object', { keepLibrary: true });
    buildLibrary(libSearch.value);
    if (window.innerWidth <= 700) library.hidden = true;
    syncToolbar();
  });

  // ---------------------------------------------------------------- render
  function schedule(world = false) {
    if (world) worldDirty = true;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  function render() {
    if (!active) return;
    const plan = store.plan;
    if (!info) info = analyse(plan);
    const out = renderPlan(plan, vp, { settings: store.settings, selection: store.selection, info, preview, measures: measureStart ? [...measures, { a: measureStart, b: preview.measureTo || measureStart }] : measures, hover, highlight });
    if (worldDirty) { worldG.innerHTML = out.world; worldDirty = false; }
    worldG.setAttribute('transform', `matrix(${vp.s} 0 0 ${vp.s} ${vp.tx} ${vp.ty})`);
    // wall hit band: ~16px on screen, but never thinner than the wall itself
    worldG.style.setProperty('--hit', String(16 / vp.s));
    screenG.innerHTML = out.screen;
    // grid
    const showGrid = store.settings.showGrid;
    svg.querySelector('.grid-bg.minor').style.display = showGrid ? '' : 'none';
    svg.querySelector('.grid-bg.major').style.display = showGrid ? '' : 'none';
    if (showGrid) {
      const st = gridStep(vp.s) * vp.s, mj = st * 5;
      const pm = svg.querySelector('#gridMinor'), pj = svg.querySelector('#gridMajor');
      pm.setAttribute('width', st); pm.setAttribute('height', st); pm.firstElementChild.setAttribute('d', `M${st} 0H0V${st}`);
      pj.setAttribute('width', mj); pj.setAttribute('height', mj); pj.firstElementChild.setAttribute('d', `M${mj} 0H0V${mj}`);
      pm.setAttribute('patternTransform', `translate(${vp.tx} ${vp.ty})`);
      pj.setAttribute('patternTransform', `translate(${vp.tx} ${vp.ty})`);
    }
    // zoom % relative to fit, scale bar
    $('.pl-zoom-pct').textContent = Math.round(vp.s / vp.fitS * 100) + ' %';
    const sb = scaleBar(vp.s);
    $('.pl-scale .bar').style.width = sb.px + 'px';
    $('.pl-scale span').textContent = sb.label;
  }

  function fitView(animate = false) {
    const b = M.planBounds(store.plan);
    const r = svg.getBoundingClientRect();
    vp.w = r.width || 800; vp.h = r.height || 600;
    const from = vp.snapshot();
    const pad = Math.max(56, Math.min(90, Math.min(vp.w, vp.h) * 0.12));
    vp.fit(b.w ? b : { minX: 0, minY: 0, w: 5, h: 5 }, pad);
    if (animate) animateTo(from, vp.snapshot()); else schedule();
  }
  function animateTo(from, to, ms = 240) {
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      vp.s = from.s + (to.s - from.s) * e; vp.tx = from.tx + (to.tx - from.tx) * e; vp.ty = from.ty + (to.ty - from.ty) * e;
      render();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function zoomBy(f, X, Y, animate = true) {
    const r = svg.getBoundingClientRect();
    X ??= r.width / 2; Y ??= r.height / 2;
    const from = vp.snapshot();
    vp.zoomAt(f, X, Y);
    if (animate) { const to = vp.snapshot(); vp.restore(from); animateTo(from, to, 180); } else schedule();
  }
  /** Centre the view on a world point (keeping zoom, or zooming in a bit). */
  function focusOn(p, minS) {
    const from = vp.snapshot();
    if (minS && vp.s < minS) vp.s = minS;
    vp.tx = vp.w / 2 - p.x * vp.s; vp.ty = vp.h / 2 - p.y * vp.s;
    const to = vp.snapshot(); vp.restore(from); animateTo(from, to, 300);
  }

  $('.pl-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    if (b.dataset.z === 'in') zoomBy(1.5); else if (b.dataset.z === 'out') zoomBy(1 / 1.5); else fitView(true);
  });

  const ro = new ResizeObserver(() => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = vp.w / 2, cy = vp.h / 2;
    vp.w = r.width; vp.h = r.height;
    if (!fitted) { fitted = true; fitView(); return; }
    // keep centre stable on resize
    vp.tx += vp.w / 2 - cx; vp.ty += vp.h / 2 - cy;
    schedule();
  });
  ro.observe(svg);

  // ---------------------------------------------------------------- snapping
  const pxToM = (px) => px / vp.s;
  function snapPoint(p, opts = {}) {
    const plan = store.plan;
    const guides = [];
    let snapped = null;
    const tol = pxToM(opts.tolPx ?? 12);
    // 1. existing nodes
    let best = null, bd = tol;
    for (const [id, n] of Object.entries(plan.nodes)) {
      if (opts.excludeNode === id) continue;
      const d = G.dist(n, p);
      if (d < bd) { bd = d; best = { x: n.x, y: n.y, node: id }; }
    }
    if (best) return { p: best, snap: best, guides };
    // 2. angle snap relative to an origin
    let q = { ...p };
    if (opts.from) {
      const v = G.sub(p, opts.from);
      const L = G.len(v);
      const a = G.angleDeg(v);
      const sa = G.snapAngle(a, 45, 7);
      if (sa !== a) q = G.add(opts.from, G.mul(G.rot({ x: 1, y: 0 }, sa), L));
      // round the length to a nice increment
      if (store.settings.snap) {
        const inc = getUnits() === 'imperial' ? 0.0254 : (vp.s > 300 ? 0.01 : 0.05);
        const L2 = Math.round(G.dist(opts.from, q) / inc) * inc;
        q = G.add(opts.from, G.mul(G.norm(G.sub(q, opts.from)), L2));
      }
    }
    // 3. alignment with other nodes (x or y)
    const al = pxToM(8);
    let ax = null, ay = null;
    for (const [id, n] of Object.entries(plan.nodes)) {
      if (opts.excludeNode === id) continue;
      if (ax === null && Math.abs(n.x - q.x) < al) { ax = n; }
      if (ay === null && Math.abs(n.y - q.y) < al) { ay = n; }
    }
    if (ax && (!opts.from || Math.abs(G.sub(q, opts.from).x) > 1e-3 || true)) { q.x = ax.x; guides.push({ a: { x: ax.x, y: ax.y }, b: { x: ax.x, y: q.y } }); }
    if (ay) { q.y = ay.y; guides.push({ a: { x: ay.x, y: ay.y }, b: { x: q.x, y: ay.y } }); }
    // 4. onto a wall centreline
    if (!ax && !ay && info) {
      const nw = nearestWall(plan, info, q, pxToM(10) - 0.0, opts.wallFilter);
      if (nw && nw.d + nw.info.w.thickness / 2 < pxToM(10)) { snapped = nw.point; q = { ...nw.point }; }
    }
    return { p: q, snap: snapped, guides };
  }

  // ---------------------------------------------------------------- pointer handling
  const pointers = new Map();
  let drag = null;   // active single-pointer interaction
  let pinch = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  const localXY = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  svg.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    svg.setPointerCapture(e.pointerId);
    const xy = localXY(e);
    pointers.set(e.pointerId, xy);
    if (pointers.size === 2) {
      // switch to pinch; abandon single-finger action (commit whatever was dragged)
      if (drag?.gesture) drag.gesture.end();
      drag = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: G.dist(a, b), c: G.lerp(a, b, 0.5) };
      return;
    }
    if (pointers.size > 2) return;
    const hit = hitFromElement(e.target);
    const wp = vp.toWorld(xy.x, xy.y);
    drag = { start: xy, last: xy, wp0: wp, hit, moved: false, pointerType: e.pointerType, button: e.button, shift: e.shiftKey };
    // Middle button or space-drag pans regardless of tool.
    if (e.button === 1) { drag.mode = 'pan'; return; }
    if (tool === 'select') beginSelectDrag(drag, e);
  });

  svg.addEventListener('pointermove', (e) => {
    const xy = localXY(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, xy);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = G.dist(a, b), c = G.lerp(a, b, 0.5);
      vp.zoomAt(d / pinch.d, c.x, c.y);
      vp.panBy(c.x - pinch.c.x, c.y - pinch.c.y);
      pinch = { d, c };
      schedule();
      return;
    }
    const wp = vp.toWorld(xy.x, xy.y);
    if (!drag) { hoverMove(wp, e); return; }
    const thr = drag.pointerType === 'touch' ? 8 : 4;
    if (!drag.moved && G.dist(xy, drag.start) < thr) return;
    drag.moved = true;
    const dx = xy.x - drag.last.x, dy = xy.y - drag.last.y;
    drag.last = xy;
    if (drag.mode === 'pan' || (!drag.mode && tool !== 'select')) {
      if (tool === 'select' || drag.mode === 'pan' || drag.pointerType === 'touch' || drag.button === 1) {
        vp.panBy(dx, dy); schedule();
        drag.mode = 'pan';
      } else if (tool !== 'select') {
        hoverMove(wp, e);
      }
      return;
    }
    if (drag.onMove) { drag.onMove(wp, e); schedule(true); }
  });

  const endPointer = (e) => {
    const had = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; if (drag) drag = null; return; }
    if (!had || !drag) return;
    const d = drag; drag = null;
    if (e.type === 'pointercancel') { d.gesture?.cancel(); return; }
    const xy = localXY(e);
    const wp = vp.toWorld(xy.x, xy.y);
    if (d.moved) {
      if (d.onEnd) d.onEnd(wp, e);
      d.gesture?.end();
      return;
    }
    // A tap
    const now = performance.now();
    const dbl = now - lastTap.t < 320 && G.dist(xy, lastTap) < 20;
    lastTap = dbl ? { t: 0, x: 0, y: 0 } : { t: now, x: xy.x, y: xy.y };
    onTap(wp, d.hit, e, dbl, xy);
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const xy = localXY(e);
    const isMouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
    if (e.ctrlKey || e.metaKey || isMouseWheel) {
      const k = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0022;
      vp.zoomAt(Math.exp(-e.deltaY * k), xy.x, xy.y);
    } else {
      vp.panBy(-e.deltaX, -e.deltaY);
    }
    schedule();
  }, { passive: false });
  // Safari trackpad pinch
  let gs = 1;
  svg.addEventListener('gesturestart', (e) => { e.preventDefault(); gs = 1; });
  svg.addEventListener('gesturechange', (e) => { e.preventDefault(); const xy = localXY(e); vp.zoomAt(e.scale / gs, xy.x, xy.y); gs = e.scale; schedule(); });

  function hoverMove(wp, e) {
    const plan = store.plan;
    if (!info) info = analyse(plan);
    preview = {};
    if (tool === 'wall' || tool === 'virtual') {
      const r = snapPoint(wp, { from: wallStart });
      preview.snap = r.snap; preview.guides = r.guides;
      if (wallStart) preview.wall = { a: wallStart, b: r.p, virtual: tool === 'virtual', thickness: tool === 'virtual' ? 0.02 : 0.15 };
      else preview.snap = r.snap || r.p;
    } else if (tool === 'door' || tool === 'window' || tool === 'opening') {
      const nw = nearestWall(plan, info, wp, pxToM(28));
      if (nw) {
        const def = M.OPENING_DEFAULTS[tool];
        preview.opening = { wall: nw.wallId, center: snapAlong(nw, nw.s), width: Math.min(def.width, nw.info.L), type: tool };
      }
    } else if (tool === 'object' && objectType) {
      const o = makeObject(objectType, wp.x, wp.y, M.uid);
      snapObjectToWall(o);
      preview.object = o;
    } else if (tool === 'measure') {
      const r = snapPoint(wp, { from: measureStart, tolPx: 12 });
      preview.snap = r.snap;
      if (measureStart) preview.measureTo = r.p;
    }
    schedule();
    void e;
  }

  function snapAlong(nw, s) {
    const inc = getUnits() === 'imperial' ? 0.0254 : 0.01;
    return Math.round(s / inc) * inc;
  }

  /** Place an object's back against a nearby wall face and align its rotation. */
  function snapObjectToWall(o, onlyIfClose = false) {
    if (!info) return;
    const tol = Math.max(0.35, pxToM(24));
    let best = null;
    for (const inf of info.walls.values()) {
      if (inf.w.kind === 'virtual') continue;
      const pr = G.projectOnSegment(o, inf.A, inf.B);
      if (pr.t <= 0 || pr.t >= 1) continue;
      const side = Math.sign(G.dot(G.sub(o, pr.point), inf.n)) || 1;
      const faceDist = pr.d - inf.w.thickness / 2;
      if (faceDist < tol + o.d / 2 && (!best || faceDist < best.fd)) best = { inf, pr, side, fd: faceDist };
    }
    if (!best) return false;
    const { inf, pr, side } = best;
    // Orientation: back (local -y) toward the wall, i.e. local +y along side*n.
    const inward = G.mul(inf.n, side);
    const rot = G.angleDeg(inward) - 90;
    if (onlyIfClose) {
      const diff = Math.abs(((o.rot - rot) % 360 + 540) % 360 - 180);
      if (diff > 12) return false;
    }
    o.rot = Math.round(rot * 100) / 100;
    const c = G.add(pr.point, G.mul(inward, inf.w.thickness / 2 + o.d / 2));
    o.x = c.x; o.y = c.y;
    return true;
  }

  // ---------------------------------------------------------------- select-tool drags
  function beginSelectDrag(d, e) {
    const plan = store.plan;
    const hit = d.hit;
    if (!hit) { d.mode = 'pan'; return; }
    if (hit.kind === 'handle') {
      const g = store.beginGesture('edit');
      d.gesture = g;
      if (hit.role === 'node') {
        const nid = hit.id;
        d.onMove = (wp) => {
          const r = snapPoint(wp, { excludeNode: nid });
          preview = { snap: r.snap, guides: r.guides };
          Object.assign(store.plan.nodes[nid], { x: r.p.x, y: r.p.y });
          for (const w of M.wallsAtNode(store.plan, nid)) for (const o of M.openingsOf(store.plan, w.id)) M.clampOpening(store.plan, o);
          info = null; g.live();
        };
        d.onEnd = (wp) => {
          const r = snapPoint(wp, { excludeNode: nid });
          preview = {};
          if (r.p.node && r.p.node !== nid) { M.mergeNodes(store.plan, nid, r.p.node); store.select({ kind: 'node', id: r.p.node }); }
          info = null;
        };
      } else if (hit.role === 'wallmove') {
        const w = M.wallById(plan, hit.id);
        const n = M.wallNormal(plan, w);
        const a0 = { ...plan.nodes[w.a] }, b0 = { ...plan.nodes[w.b] };
        d.onMove = (wp) => {
          let k = G.dot(G.sub(wp, d.wp0), n);
          if (store.settings.snap) k = Math.round(k / 0.01) * 0.01;
          Object.assign(store.plan.nodes[w.a], G.add(a0, G.mul(n, k)));
          Object.assign(store.plan.nodes[w.b], G.add(b0, G.mul(n, k)));
          for (const ww of [...M.wallsAtNode(store.plan, w.a), ...M.wallsAtNode(store.plan, w.b)]) for (const o of M.openingsOf(store.plan, ww.id)) M.clampOpening(store.plan, o);
          info = null; g.live();
        };
      } else if (hit.role === 'op0' || hit.role === 'op1') {
        const o = plan.openings.find((x) => x.id === hit.id);
        d.onMove = (wp) => {
          const w = M.wallById(store.plan, o.wallId);
          const [A] = M.wallEnds(store.plan, w);
          const L = M.wallLength(store.plan, w);
          let s = G.clamp(G.dot(G.sub(wp, A), M.wallDir(store.plan, w)), 0, L);
          s = snapAlong(null, s);
          const end = o.offset + o.width;
          if (hit.role === 'op0') { const ns = Math.min(s, end - 0.2); o.width = end - ns; o.offset = ns; }
          else { o.width = Math.max(0.2, s - o.offset); }
          M.clampOpening(store.plan, o); g.live();
        };
      } else if (hit.role === 'rotate') {
        const o = plan.objects.find((x) => x.id === hit.id);
        d.onMove = (wp, ev) => {
          let r = G.angleDeg(G.sub(wp, o)) + 90;
          if (!ev.shiftKey) { r = G.snapAngle(r, 90, 6); r = G.snapAngle(r, 15, 3); }
          o.rot = Math.round((((r % 360) + 540) % 360 - 180) * 10) / 10; g.live();
        };
      } else if (hit.role.startsWith('corner')) {
        const o = plan.objects.find((x) => x.id === hit.id);
        const i = +hit.role.slice(6);
        const corners = G.rectCorners(o.x, o.y, o.w, o.d, o.rot);
        const opp = corners[(i + 2) % 4];
        d.onMove = (wp) => {
          const local = G.rot(G.sub(wp, opp), -o.rot);
          let w = Math.max(0.1, Math.abs(local.x)), dd = Math.max(0.1, Math.abs(local.y));
          const inc = getUnits() === 'imperial' ? 0.0254 : 0.01;
          w = Math.round(w / inc) * inc; dd = Math.round(dd / inc) * inc;
          const sx = Math.sign(local.x) || 1, sy = Math.sign(local.y) || 1;
          const c = G.add(opp, G.rot({ x: sx * w / 2, y: sy * dd / 2 }, o.rot));
          Object.assign(o, { w, d: dd, x: c.x, y: c.y }); g.live();
        };
      } else if (hit.role === 'photodir') {
        const p = plan.photos.find((x) => x.id === hit.id);
        d.onMove = (wp) => { p.dir = Math.round(G.angleDeg(G.sub(wp, p))); g.live(); };
      }
      return;
    }
    if (hit.kind === 'object' || hit.kind === 'photo' || hit.kind === 'note' || hit.kind === 'opening' || (hit.kind === 'room' && hit.id)) {
      if (!store.selection || store.selection.id !== hit.id) store.select({ kind: hit.kind, id: hit.id });
      const coll = { object: 'objects', photo: 'photos', note: 'notes', room: 'rooms' }[hit.kind];
      if (hit.kind === 'opening') {
        const o = plan.openings.find((x) => x.id === hit.id);
        const g = store.beginGesture('move');
        d.gesture = g;
        const grab = (() => { const gm = M.openingGeom(plan, o); return G.dot(G.sub(d.wp0, gm.p0), gm.dir); })();
        d.onMove = (wp) => {
          if (!info) info = analyse(store.plan);
          const nw = nearestWall(store.plan, info, wp, pxToM(30));
          if (nw && nw.wallId !== o.wallId && nw.info.L > o.width) o.wallId = nw.wallId;
          const w = M.wallById(store.plan, o.wallId);
          const [A] = M.wallEnds(store.plan, w);
          o.offset = snapAlong(null, G.dot(G.sub(wp, A), M.wallDir(store.plan, w)) - grab);
          M.clampOpening(store.plan, o); g.live();
        };
        return;
      }
      const item = plan[coll].find((x) => x.id === hit.id);
      if (!item) return;
      const g = store.beginGesture('move');
      d.gesture = g;
      const off = G.sub(d.wp0, item);
      d.onMove = (wp, ev) => {
        let p = G.sub(wp, off);
        if (store.settings.snap && !ev.shiftKey) {
          const inc = getUnits() === 'imperial' ? 0.0254 : 0.01;
          p = { x: Math.round(p.x / inc) * inc, y: Math.round(p.y / inc) * inc };
        }
        item.x = p.x; item.y = p.y;
        if (hit.kind === 'object' && store.settings.snap && !ev.shiftKey) snapObjectToWall(item, true);
        g.live();
      };
      return;
    }
    d.mode = 'pan';
    void e;
  }

  // ---------------------------------------------------------------- taps per tool
  function onTap(wp, hit, e, dbl, xy) {
    const plan = store.plan;
    if (!info) info = analyse(plan);
    switch (tool) {
      case 'select': {
        if (dbl && (!hit || hit.kind === 'roomface')) { zoomBy(2, xy.x, xy.y); return; }
        if (!hit || hit.kind === 'handle') { if (!hit) store.select(null); return; }
        if (hit.kind === 'roomface' || hit.kind === 'room') {
          if (hit.id) store.select({ kind: 'room', id: hit.id });
          else if (hit.face) {
            // unnamed face: create a room label so it can be named
            const pts = hit.face.map((id) => plan.nodes[id]);
            const lp = G.labelPoint(pts);
            const r = store.commit('room', (p) => { const r = { id: M.uid('r'), name: `${t('untitledRoom')} ${p.rooms.length + 1}`, x: lp.x, y: lp.y }; p.rooms.push(r); return r; });
            store.select({ kind: 'room', id: r.id });
          }
          if (dbl) focusInspectorField('name');
          return;
        }
        store.select({ kind: hit.kind, id: hit.id });
        if (hit.kind === 'photo' && dbl) store.emit('navigate', { tab: 'photo', focus: { kind: 'photo', id: hit.id } });
        return;
      }
      case 'wall': case 'virtual': {
        const r = snapPoint(wp, { from: wallStart });
        if (dbl) { finishWallChain(); return; }
        if (!wallStart) { wallStart = r.p; chainFirst = r.p; schedule(); return; }
        if (G.dist(wallStart, r.p) < 0.05) return;
        const virtual = tool === 'virtual';
        store.commit('wall', (p) => M.addWall(p, wallStart, r.p, { kind: virtual ? 'virtual' : 'solid', thickness: virtual ? 0.02 : (store.settings.wallThickness || 0.15), tol: 0.03 }));
        info = null;
        const closed = chainFirst && G.dist(chainFirst, r.p) < 0.03;
        wallStart = closed ? null : r.p;
        if (closed) { chainFirst = null; preview = {}; }
        schedule(true);
        return;
      }
      case 'door': case 'window': case 'opening': {
        const nw = nearestWall(plan, info, wp, pxToM(28));
        if (!nw) return;
        const type = tool;
        const o = store.commit('opening', (p) => M.addOpening(p, nw.wallId, type, snapAlong(nw, nw.s), Math.min(M.OPENING_DEFAULTS[type].width, nw.info.L)));
        // door swings into the room on the click side
        if (o && type !== 'window' && type !== 'opening') {
          const side = Math.sign(G.dot(G.sub(wp, nw.point), nw.info.n)) || 1;
          store.commit('swing', (p) => { const x = p.openings.find((q) => q.id === o.id); if (x) x.swing = side; });
        }
        setTool('select');
        store.select({ kind: 'opening', id: o.id });
        return;
      }
      case 'object': {
        if (!objectType) return;
        const ob = makeObject(objectType, wp.x, wp.y, M.uid);
        snapObjectToWall(ob);
        store.commit('object', (p) => { p.objects.push(ob); });
        setTool('select');
        store.select({ kind: 'object', id: ob.id });
        return;
      }
      case 'room': {
        const f = info.rooms.find((f) => G.pointInPolygon(wp, f.pts));
        if (!f) return;
        if (f.room) { store.select({ kind: 'room', id: f.room.id }); }
        else {
          const r = store.commit('room', (p) => { const r = { id: M.uid('r'), name: `${t('untitledRoom')} ${p.rooms.length + 1}`, x: wp.x, y: wp.y }; p.rooms.push(r); return r; });
          store.select({ kind: 'room', id: r.id });
        }
        setTool('select');
        focusInspectorField('name');
        return;
      }
      case 'measure': {
        const r = snapPoint(wp, { from: measureStart });
        if (!measureStart) { measureStart = r.p; }
        else { measures.push({ a: measureStart, b: r.p }); if (measures.length > 12) measures.shift(); measureStart = null; preview = {}; }
        schedule();
        return;
      }
      case 'note': {
        const n = store.commit('note', (p) => { const n = { id: M.uid('nt'), x: wp.x, y: wp.y, text: '' }; p.notes.push(n); return n; });
        setTool('select');
        store.select({ kind: 'note', id: n.id });
        focusInspectorField('text');
        return;
      }
      case 'photo': {
        pendingPhotoAt = wp;
        photoInput.click();
        return;
      }
    }
    void e;
  }

  photoInput.addEventListener('change', async () => {
    const files = [...photoInput.files];
    photoInput.value = '';
    if (!files.length) return;
    try {
      const mod = await import('./photos.js');
      const ids = await mod.addPhotoFiles(files, pendingPhotoAt);
      setTool('select');
      if (ids?.length) store.select({ kind: 'photo', id: ids[0] });
    } catch (err) { console.error(err); }
  });

  function finishWallChain() {
    wallStart = null; chainFirst = null;
    if (preview.wall) { preview = {}; schedule(); }
  }

  // ---------------------------------------------------------------- keyboard
  function onKey(e) {
    if (!active) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
    if (mod) return;
    if (e.key === 'Escape') {
      if (wallStart) finishWallChain();
      else if (measureStart) { measureStart = null; preview = {}; schedule(); }
      else if (tool !== 'select') setTool('select');
      else if (measures.length) { measures = []; schedule(); }
      else store.select(null);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    if (e.key === '+' || e.key === '=') { zoomBy(1.4); return; }
    if (e.key === '-' || e.key === '_') { zoomBy(1 / 1.4); return; }
    if (e.key === '0') { fitView(true); return; }
    const sel = store.selection;
    if (sel?.kind === 'object' && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.01;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      store.commit('nudge', (p) => { const o = p.objects.find((x) => x.id === sel.id); if (o) { o.x += dx; o.y += dy; } });
      return;
    }
    if (sel?.kind === 'object' && e.key.toLowerCase() === 'r') {
      store.commit('rotate', (p) => { const o = p.objects.find((x) => x.id === sel.id); if (o) o.rot = ((o.rot + (e.shiftKey ? -90 : 90)) + 540) % 360 - 180; });
      return;
    }
    const tl = TOOLS.find((x) => x.key === e.key.toLowerCase());
    if (tl) { if (tl.id === 'library') toggleLibrary(); else setTool(tl.id); }
  }
  window.addEventListener('keydown', onKey);

  function deleteSel() {
    const sel = store.selection; if (!sel) return;
    store.commit('delete', (p) => {
      if (sel.kind === 'wall') M.deleteWall(p, sel.id);
      else if (sel.kind === 'node') { for (const w of M.wallsAtNode(p, sel.id)) M.deleteWall(p, w.id); }
      else {
        const coll = { opening: 'openings', object: 'objects', room: 'rooms', photo: 'photos', note: 'notes' }[sel.kind];
        if (coll) p[coll] = p[coll].filter((x) => x.id !== sel.id);
      }
    });
    if (sel.kind === 'photo') import('./store.js').then((m) => m.photoBlobs.remove(sel.id));
    info = null;
    store.select(null);
  }
  function duplicateSel() {
    const sel = store.selection; if (!sel) return;
    if (sel.kind === 'object') {
      const n = store.commit('duplicate', (p) => { const o = p.objects.find((x) => x.id === sel.id); if (!o) return null; const c = { ...o, id: M.uid('ob'), x: o.x + 0.3, y: o.y + 0.3 }; p.objects.push(c); return c; });
      if (n) store.select({ kind: 'object', id: n.id });
    } else if (sel.kind === 'opening') {
      const n = store.commit('duplicate', (p) => { const o = p.openings.find((x) => x.id === sel.id); if (!o) return null; const c = { ...o, id: M.uid('o'), offset: o.offset + o.width + 0.2 }; p.openings.push(c); M.clampOpening(p, c); return c; });
      if (n) store.select({ kind: 'opening', id: n.id });
    }
  }

  // ---------------------------------------------------------------- inspector
  let inspectorFocus = null;
  function focusInspectorField(name) { inspectorFocus = name; renderInspector(); }

  const lenField = (key, label, value, opts = {}) => `<label class="fld"><span>${label}</span><input class="num" data-len="${key}" value="${escAttr(fmtLen(value, { forceM: true }))}" inputmode="decimal" ${opts.ro ? 'readonly' : ''} autocomplete="off" enterkeyhint="done"></label>`;
  const txtField = (key, label, value) => `<label class="fld"><span>${label}</span><input data-txt="${key}" value="${escAttr(value)}" autocomplete="off" enterkeyhint="done"></label>`;
  const numField = (key, label, value, suffix = '') => `<label class="fld"><span>${label}</span><div class="with-suffix"><input class="num" data-num="${key}" value="${value}" inputmode="decimal" autocomplete="off"><em>${suffix}</em></div></label>`;
  const stat = (label, value) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
  const btn = (act, label, cls = '', ic = '') => `<button class="btn ${cls}" data-act="${act}">${ic ? icon(ic) : ''}<span>${label}</span></button>`;
  const escAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderInspector() {
    const plan = store.plan;
    const sel = store.selection;
    let h = '';
    root.classList.toggle('has-sel', !!sel);
    if (!sel) {
      const tk = M.takeoff(plan);
      h += `<h3>${escAttr(plan.name)}</h3><p class="muted small">${t('nothingSelected')}</p>`;
      h += `<div class="stats">${stat(t('area'), fmtArea(tk.area))}${stat(t('size'), `${fmtLen(tk.width)} × ${fmtLen(tk.depth)}`)}${stat(t('rooms'), tk.rooms.length)}${stat(t('openings'), tk.counts.doors + tk.counts.windows + tk.counts.openings)}</div>`;
      h += `<div class="grid2">${txtField('planName', t('name'), plan.name)}${lenField('wallHeight', t('wallHeight'), plan.wallHeight)}</div>`;
      h += `<h4>${t('settings')}</h4><div class="toggles">`;
      for (const k of ['showDims', 'showChains', 'showFurniture', 'showPhotos', 'showGrid', 'snap']) h += `<label class="tgl"><input type="checkbox" data-setting="${k}" ${store.settings[k] ? 'checked' : ''}><span>${t(k)}</span></label>`;
      h += `</div><div class="seg" role="group"><button data-dim="inside" class="${store.settings.dimMode === 'inside' ? 'is-on' : ''}">${t('insideDims')}</button><button data-dim="center" class="${store.settings.dimMode !== 'inside' ? 'is-on' : ''}">${t('centerDims')}</button></div>`;
    } else if (sel.kind === 'wall') {
      const w = M.wallById(plan, sel.id); if (!w) { store.select(null); return; }
      const L = M.wallLength(plan, w), Li = M.wallInsideLength(plan, w);
      h += `<h3>${w.kind === 'virtual' ? t('virtualWall') : t('wall')}</h3>`;
      h += `<div class="grid2">${lenField('wallLen', t('length') + (store.settings.dimMode === 'inside' && w.kind !== 'virtual' ? ' (int.)' : ''), store.settings.dimMode === 'inside' && w.kind !== 'virtual' ? Li : L)}${w.kind !== 'virtual' ? lenField('thickness', t('thickness'), w.thickness) : ''}${w.kind !== 'virtual' ? lenField('wallH', t('height'), w.height || plan.wallHeight) : ''}</div>`;
      h += `<div class="seg" role="group"><button data-kindset="solid" class="${w.kind !== 'virtual' ? 'is-on' : ''}">${t('solid')}</button><button data-kindset="virtual" class="${w.kind === 'virtual' ? 'is-on' : ''}">${t('virtual')}</button></div>`;
      const ops = M.openingsOf(plan, w.id);
      if (ops.length) {
        h += `<h4>${t('openings')}</h4><ul class="op-list">`;
        for (const o of ops) h += `<li><button data-goto="${o.id}"><b>${t(o.type)}</b><span>${fmtLen(o.width)} · ${t('offset')} ${fmtLen(o.offset)} / ${fmtLen(L - o.offset - o.width)}</span></button></li>`;
        h += '</ul>';
      }
      h += `<div class="btns">${btn('addDoor', t('door'), '', 'door')}${btn('addWindow', t('window'), '', 'window')}${btn('split', t('split'), '', 'split')}${btn('delete', t('delete'), 'danger', 'trash')}</div>`;
    } else if (sel.kind === 'node') {
      h += `<h3>${t('wall')}</h3><div class="btns">${btn('delete', t('delete'), 'danger', 'trash')}</div>`;
    } else if (sel.kind === 'opening') {
      const o = plan.openings.find((x) => x.id === sel.id); if (!o) { store.select(null); return; }
      const w = M.wallById(plan, o.wallId);
      const L = M.wallLength(plan, w);
      h += `<h3>${t(o.type)}</h3>`;
      h += `<div class="seg wrap" role="group">${M.OPENING_TYPES.map((ty) => `<button data-optype="${ty}" class="${o.type === ty ? 'is-on' : ''}">${t(ty)}</button>`).join('')}</div>`;
      h += `<div class="grid2">${lenField('opW', t('width'), o.width)}${lenField('opH', t('height'), o.height)}${lenField('opA', t('offset') + ' A', o.offset)}${lenField('opB', t('offset') + ' B', L - o.offset - o.width)}${o.type === 'window' ? lenField('opSill', t('sill'), o.sill) : ''}</div>`;
      if (M.isDoorType(o.type) && o.type !== 'sliding' && o.type !== 'pocket') h += `<div class="btns">${btn('flipHinge', t('hinge'), '', 'flipH')}${btn('flipSwing', t('swing'), '', 'flipV')}</div>`;
      h += `<div class="btns">${btn('duplicate', t('duplicate'), '', 'copy')}${btn('delete', t('delete'), 'danger', 'trash')}</div>`;
    } else if (sel.kind === 'object') {
      const o = plan.objects.find((x) => x.id === sel.id); if (!o) { store.select(null); return; }
      h += `<h3>${escAttr(o.label || catalogLabel(o.type, lang()))}</h3>`;
      h += `<label class="fld"><span>${t('type')}</span><select data-objtype>${CATEGORIES.map((c) => `<optgroup label="${lang() === 'fr' ? c.fr : c.en}">${Object.entries(CATALOG).filter(([, it]) => it.cat === c.id).map(([id]) => `<option value="${id}" ${id === o.type ? 'selected' : ''}>${catalogLabel(id, lang())}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
      h += `<div class="grid2">${lenField('obW', t('width'), o.w)}${lenField('obD', t('depth'), o.d)}${lenField('obH', t('height'), o.h)}${lenField('obE', t('elevation'), o.elev || 0)}${numField('obRot', t('rotation'), Math.round((o.rot || 0) * 10) / 10, '°')}${txtField('obLabel', t('name'), o.label || '')}</div>`;
      h += `<div class="btns">${btn('rot90', '90°', '', 'rotate')}${btn('toWall', t('wall'), '', 'magnet')}${btn('duplicate', t('duplicate'), '', 'copy')}${btn('delete', t('delete'), 'danger', 'trash')}</div>`;
    } else if (sel.kind === 'room') {
      const r = plan.rooms.find((x) => x.id === sel.id); if (!r) { store.select(null); return; }
      const tk = M.takeoff(plan).rooms.find((x) => x.face.room?.id === r.id);
      h += `<h3>${escAttr(r.name || t('room'))}</h3>${txtField('roomName', t('name'), r.name)}`;
      if (tk) h += `<div class="stats">${stat(t('area'), fmtArea(tk.area))}${stat(t('perimeter'), fmtLen(tk.perimeter))}${stat(t('baseboard'), fmtLen(tk.baseboard))}${stat(t('wallArea'), fmtArea(tk.wallArea))}</div>`;
      h += `<div class="btns">${btn('delete', t('delete'), 'danger', 'trash')}</div>`;
    } else if (sel.kind === 'photo') {
      const p = plan.photos.find((x) => x.id === sel.id); if (!p) { store.select(null); return; }
      h += `<h3>${escAttr(p.name || t('photo'))}</h3><div class="ph-thumb" data-photo="${p.id}"></div>${txtField('phName', t('name'), p.name)}${txtField('phNote', t('note'), p.note || '')}`;
      h += `<div class="grid2">${numField('phDir', t('direction'), Math.round(p.dir || 0), '°')}</div>`;
      h += `<div class="btns">${btn('openPhoto', t('open'), 'primary', 'photo')}${btn('delete', t('delete'), 'danger', 'trash')}</div>`;
    } else if (sel.kind === 'note') {
      const n = plan.notes.find((x) => x.id === sel.id); if (!n) { store.select(null); return; }
      h += `<h3>${t('note')}</h3><label class="fld"><span>${t('text')}</span><textarea data-txt="noteText" rows="3">${escAttr(n.text)}</textarea></label><div class="btns">${btn('delete', t('delete'), 'danger', 'trash')}</div>`;
    }
    inspector.innerHTML = h;
    // photo thumbnail
    const th = inspector.querySelector('.ph-thumb');
    if (th) {
      const p = plan.photos.find((x) => x.id === th.dataset.photo);
      import('./store.js').then(({ photoURL }) => photoURL(p)).then((u) => { if (u) th.style.backgroundImage = `url("${u}")`; });
    }
    if (inspectorFocus) {
      const map = { name: '[data-txt="roomName"]', text: '[data-txt="noteText"]' };
      const el = inspector.querySelector(map[inspectorFocus] || '');
      inspectorFocus = null;
      if (el) { root.classList.add('insp-open'); setTimeout(() => { el.focus(); el.select?.(); }, 30); }
    }
  }

  // Inspector events
  inspector.addEventListener('change', (e) => {
    const el = e.target;
    const plan = store.plan, sel = store.selection;
    if (el.dataset.setting) { store.setSetting(el.dataset.setting, el.checked); return; }
    if (el.dataset.len) {
      const v = parseLen(el.value);
      if (v == null || v < 0) { el.classList.add('bad'); setTimeout(() => el.classList.remove('bad'), 600); renderInspector(); return; }
      applyLen(el.dataset.len, v, sel);
      return;
    }
    if (el.dataset.num) {
      const v = parseFloat(String(el.value).replace(',', '.'));
      if (!isFinite(v)) { renderInspector(); return; }
      if (el.dataset.num === 'obRot') store.commit('rotate', (p) => { const o = p.objects.find((x) => x.id === sel.id); if (o) o.rot = ((v + 540) % 360) - 180; });
      if (el.dataset.num === 'phDir') store.commit('photo', (p) => { const o = p.photos.find((x) => x.id === sel.id); if (o) o.dir = v; });
      return;
    }
    if (el.dataset.txt) {
      const v = el.value;
      const k = el.dataset.txt;
      store.commit('text', (p) => {
        if (k === 'planName') p.name = v || p.name;
        if (k === 'roomName') { const r = p.rooms.find((x) => x.id === sel.id); if (r) r.name = v; }
        if (k === 'obLabel') { const o = p.objects.find((x) => x.id === sel.id); if (o) o.label = v || undefined; }
        if (k === 'phName') { const o = p.photos.find((x) => x.id === sel.id); if (o) o.name = v; }
        if (k === 'phNote') { const o = p.photos.find((x) => x.id === sel.id); if (o) o.note = v; }
        if (k === 'noteText') { const o = p.notes.find((x) => x.id === sel.id); if (o) o.text = v; }
      });
      return;
    }
    if (el.matches('[data-objtype]')) {
      const ty = el.value, it = CATALOG[ty];
      store.commit('type', (p) => { const o = p.objects.find((x) => x.id === sel.id); if (o && it) Object.assign(o, { type: ty, w: it.w, d: it.d, h: it.h, elev: it.elev || 0 }); });
    }
    void plan;
  });
  inspector.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.blur(); }
  });
  inspector.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const sel = store.selection;
    if (b.dataset.dim) { store.setSetting('dimMode', b.dataset.dim); return; }
    if (b.dataset.goto) { store.select({ kind: 'opening', id: b.dataset.goto }); return; }
    if (b.dataset.kindset) { store.commit('kind', (p) => { const w = M.wallById(p, sel.id); if (w) { w.kind = b.dataset.kindset; if (w.kind === 'virtual') w.thickness = 0.02; else if (w.thickness < 0.05) w.thickness = 0.12; } }); info = null; return; }
    if (b.dataset.optype) { store.commit('type', (p) => { const o = p.openings.find((x) => x.id === sel.id); if (o) { const d = M.OPENING_DEFAULTS[b.dataset.optype]; o.type = b.dataset.optype; o.height = d.height; o.sill = d.sill; } }); return; }
    const act = b.dataset.act; if (!act) return;
    const plan = store.plan;
    switch (act) {
      case 'delete': deleteSel(); break;
      case 'duplicate': duplicateSel(); break;
      case 'split': store.commit('split', (p) => { const w = M.wallById(p, sel.id); M.splitWall(p, w, M.wallLength(p, w) / 2); }); info = null; break;
      case 'addDoor': case 'addWindow': {
        const type = act === 'addDoor' ? 'door' : 'window';
        const o = store.commit('opening', (p) => { const w = M.wallById(p, sel.id); return M.addOpening(p, w.id, type, M.wallLength(p, w) / 2); });
        store.select({ kind: 'opening', id: o.id });
        break;
      }
      case 'flipHinge': store.commit('flip', (p) => { const o = p.openings.find((x) => x.id === sel.id); if (o) o.hinge = o.hinge === 'b' ? 'a' : 'b'; }); break;
      case 'flipSwing': store.commit('flip', (p) => { const o = p.openings.find((x) => x.id === sel.id); if (o) o.swing = -(o.swing || 1); }); break;
      case 'rot90': store.commit('rotate', (p) => { const o = p.objects.find((x) => x.id === sel.id); if (o) o.rot = ((o.rot + 90) + 540) % 360 - 180; }); break;
      case 'toWall': store.commit('snap', (p) => { const o = p.objects.find((x) => x.id === sel.id); if (o) snapObjectToWall(o); }); break;
      case 'openPhoto': store.emit('navigate', { tab: 'photo', focus: { kind: 'photo', id: sel.id } }); break;
    }
    void plan;
  });
  $('.pl-insp-grip').addEventListener('click', () => root.classList.toggle('insp-open'));

  function applyLen(key, v, sel) {
    store.commit('edit', (p) => {
      if (key === 'wallHeight') p.wallHeight = G.clamp(v, 1.5, 6);
      if (!sel) return;
      if (sel.kind === 'wall') {
        const w = M.wallById(p, sel.id); if (!w) return;
        if (key === 'wallLen') {
          const inside = store.settings.dimMode === 'inside' && w.kind !== 'virtual';
          const extra = inside ? M.wallLength(p, w) - M.wallInsideLength(p, w) : 0;
          M.setWallLength(p, w, Math.max(0.05, v + extra));
        }
        if (key === 'thickness') w.thickness = G.clamp(v, 0.02, 1);
        if (key === 'wallH') w.height = G.clamp(v, 0.3, 8);
      } else if (sel.kind === 'opening') {
        const o = p.openings.find((x) => x.id === sel.id); if (!o) return;
        const L = M.wallLength(p, M.wallById(p, o.wallId));
        if (key === 'opW') o.width = v;
        if (key === 'opH') o.height = v;
        if (key === 'opSill') o.sill = v;
        if (key === 'opA') o.offset = v;
        if (key === 'opB') o.offset = L - o.width - v;
        M.clampOpening(p, o);
      } else if (sel.kind === 'object') {
        const o = p.objects.find((x) => x.id === sel.id); if (!o) return;
        if (key === 'obW') o.w = Math.max(0.05, v);
        if (key === 'obD') o.d = Math.max(0.05, v);
        if (key === 'obH') o.h = Math.max(0.01, v);
        if (key === 'obE') o.elev = v;
      }
    });
    info = null;
  }

  // ---------------------------------------------------------------- store wiring
  store.on('change', (ev) => {
    info = null;
    schedule(true);
    if (!ev?.live) renderInspector();
  });
  store.on('select', () => { schedule(true); renderInspector(); keepSelectionVisible(); });

  /** On phones the inspector is a bottom sheet: pan so the selection stays above it. */
  function keepSelectionVisible() {
    const sel = store.selection;
    if (!sel || window.innerWidth > 760 || drag) return;
    const plan = store.plan;
    let p = null;
    if (sel.kind === 'object') p = plan.objects.find((x) => x.id === sel.id);
    else if (sel.kind === 'photo') p = plan.photos.find((x) => x.id === sel.id);
    else if (sel.kind === 'note' || sel.kind === 'room') p = plan[sel.kind + 's'].find((x) => x.id === sel.id);
    else if (sel.kind === 'opening') { const o = plan.openings.find((x) => x.id === sel.id); if (o) p = M.openingGeom(plan, o).center; }
    else if (sel.kind === 'wall') { const w = M.wallById(plan, sel.id); if (w) p = G.lerp(...M.wallEnds(plan, w), 0.5); }
    if (!p) return;
    const q = vp.toScreen(p);
    const visibleBottom = vp.h * 0.5 - 20;
    if (q.y > 40 && q.y < visibleBottom) return;
    const from = vp.snapshot();
    vp.ty += vp.h * 0.28 - q.y;
    const to = vp.snapshot(); vp.restore(from); animateTo(from, to, 260);
  }
  store.on('settings', () => { info = null; schedule(true); renderInspector(); buildToolbar(); if (!library.hidden) buildLibrary(libSearch.value); });

  buildToolbar();
  renderInspector();

  return {
    activate() { active = true; const r = svg.getBoundingClientRect(); if (r.width) { vp.w = r.width; vp.h = r.height; if (!fitted) { fitted = true; fitView(); } } schedule(true); },
    deactivate() { active = false; },
    fit: () => fitView(true),
    focus(target) {
      if (!target) return;
      const plan = store.plan;
      let p = null;
      if (target.kind === 'photo') p = plan.photos.find((x) => x.id === target.id);
      if (target.kind === 'object') p = plan.objects.find((x) => x.id === target.id);
      if (target.kind === 'room') p = plan.rooms.find((x) => x.id === target.id);
      if (target.kind === 'opening') { const o = plan.openings.find((x) => x.id === target.id); if (o) p = M.openingGeom(plan, o).center; }
      if (target.kind === 'wall') { const w = M.wallById(plan, target.id); if (w) p = G.lerp(...M.wallEnds(plan, w), 0.5); }
      store.select(target);
      if (p) focusOn(p, vp.fitS * 1.6);
      highlight = target;
    },
    /** Export the current plan as a standalone SVG string (fit to content). */
    exportSVG(opts = {}) {
      const plan = store.plan;
      const b = M.planBounds(plan);
      const pad = 90, W = opts.width || 1400;
      const v2 = new Viewport();
      v2.w = W; v2.h = Math.round(W * (b.h + 3) / (b.w + 3));
      v2.fit(b, pad);
      const out = renderPlan(plan, v2, { settings: { ...store.settings, showGrid: false }, selection: null, info: analyse(plan) });
      const cs = getComputedStyle(document.documentElement);
      const vars = ['--bg', '--surface', '--text', '--text-2', '--wall', '--wall-fill', '--virtual', '--window', '--door', '--dim', '--dim-chain', '--room-fill', '--obj-fill', '--obj-stroke', '--accent', '--sel'];
      const css = `:root{${vars.map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';')}}` + (opts.css || '');
      const title = `<text x="${pad / 3}" y="${v2.h - 24}" class="export-title">${plan.name} · ${fmtArea(M.takeoff(plan).area)}</text>`;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${v2.h}" viewBox="0 0 ${W} ${v2.h}" class="pl-svg export"><style>${css}</style><rect width="100%" height="100%" fill="${opts.background || '#ffffff'}"/><g class="world" transform="matrix(${v2.s} 0 0 ${v2.s} ${v2.tx} ${v2.ty})">${out.world}</g><g class="screen">${out.screen}</g>${title}</svg>`;
    },
  };
}
