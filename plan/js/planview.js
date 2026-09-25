// Plan renderer: SVG in two layers.
//  • world layer — geometry in metres under one transform (walls, openings, rooms, objects);
//    strokes use non-scaling-stroke so line weights stay constant while zooming.
//  • screen layer — everything that must stay readable at any zoom (dimension lines and labels,
//    room names, handles, pins), computed in screen pixels each frame.

import * as G from './geometry.js';
import * as M from './model.js';
import { symbolSVG, catalogLabel } from './catalog.js';
import { fmtLen, fmtLenShort, fmtArea, getUnits } from './units.js';
import { lang } from './i18n.js';

const NS = 'vector-effect="non-scaling-stroke"';
const r3 = (n) => Math.round(n * 1000) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ viewport

export class Viewport {
  constructor() { this.s = 60; this.tx = 0; this.ty = 0; this.w = 800; this.h = 600; this.fitS = 60; }
  toScreen(p) { return { x: p.x * this.s + this.tx, y: p.y * this.s + this.ty }; }
  toWorld(X, Y) { return { x: (X - this.tx) / this.s, y: (Y - this.ty) / this.s }; }
  get minS() { return Math.max(2, this.fitS / 4); }
  get maxS() { return Math.max(this.fitS * 40, 1500); }
  zoomAt(factor, X, Y) {
    const s2 = G.clamp(this.s * factor, this.minS, this.maxS);
    const k = s2 / this.s;
    this.tx = X - (X - this.tx) * k;
    this.ty = Y - (Y - this.ty) * k;
    this.s = s2;
  }
  panBy(dx, dy) { this.tx += dx; this.ty += dy; }
  /** Fit world bounds b into the viewport with padding (px). */
  fit(b, pad = 70) {
    const bw = Math.max(b.w, 1), bh = Math.max(b.h, 1);
    const s = Math.min((this.w - 2 * pad) / bw, (this.h - 2 * pad) / bh);
    this.s = this.fitS = G.clamp(s, 2, 5000);
    this.tx = (this.w - bw * this.s) / 2 - b.minX * this.s;
    this.ty = (this.h - bh * this.s) / 2 - b.minY * this.s;
  }
  snapshot() { return { s: this.s, tx: this.tx, ty: this.ty }; }
  restore(o) { Object.assign(this, o); }
}

// ------------------------------------------------------------------ text metrics

let measureCtx = null;
export function textWidth(str, px = 11, weight = 500) {
  if (!measureCtx) {
    try { measureCtx = document.createElement('canvas').getContext('2d'); } catch { measureCtx = null; }
  }
  if (!measureCtx) return str.length * px * 0.58;
  measureCtx.font = `${weight} ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  return measureCtx.measureText(str).width;
}

/** Keep text upright: angle in degrees normalised to (-90, 90]. */
const upright = (deg) => { let a = ((deg % 360) + 360) % 360; if (a > 90 && a <= 270) a -= 180; if (a > 270) a -= 360; return a; };

// ------------------------------------------------------------------ derived per-render data

/** Pre-compute per-wall data shared by the render and hit testing. */
export function analyse(plan) {
  const rooms = M.computeRooms(plan);
  const walls = new Map();
  for (const w of plan.walls) {
    const [A, B] = M.wallEnds(plan, w);
    const L = G.dist(A, B);
    if (L < 1e-4) continue;
    const d = G.norm(G.sub(B, A)), n = G.perp(d);
    const ext = (nid) => {
      if (w.kind === 'virtual') return 0;
      const others = M.wallsAtNode(plan, nid).filter((x) => x !== w && x.kind !== 'virtual');
      return others.length ? Math.max(...others.map((x) => x.thickness)) / 2 : 0;
    };
    const extA = ext(w.a), extB = ext(w.b);
    // Which side is outside the building / where to put dimensions.
    const mid = G.lerp(A, B, 0.5);
    const probe = w.thickness / 2 + 0.08;
    const roomAt = (p) => rooms.find((f) => G.pointInPolygon(p, f.pts));
    const pos = roomAt(G.add(mid, G.mul(n, probe))), neg = roomAt(G.add(mid, G.mul(n, -probe)));
    let out = 1, exterior = false;
    if (pos && !neg) { out = -1; exterior = true; } else if (!pos && neg) { out = 1; exterior = true; }
    else if (pos && neg) out = pos.area >= neg.area ? 1 : -1; // interior: dimension in the roomier side
    walls.set(w.id, { w, A, B, L, d, n, extA, extB, out, exterior });
  }
  return { rooms, walls };
}

// ------------------------------------------------------------------ world layer

function wallPieces(plan, info) {
  const { w, A, d, n, L, extA, extB } = info;
  const t = w.thickness / 2;
  const chain = M.wallChain(plan, w);
  const polys = [];
  for (const c of chain) {
    if (c.kind !== 'wall') continue;
    const s0 = c.from <= 1e-6 ? -extA : c.from;
    const s1 = c.to >= L - 1e-6 ? L + extB : c.to;
    const p = (s, k) => G.add(G.add(A, G.mul(d, s)), G.mul(n, k));
    polys.push([p(s0, t), p(s1, t), p(s1, -t), p(s0, -t)]);
  }
  return polys;
}

const poly = (pts) => 'M' + pts.map((p) => `${r3(p.x)},${r3(p.y)}`).join('L') + 'Z';

function openingSVG(plan, o, info, sel) {
  const g = M.openingGeom(plan, o);
  const t = info.w.thickness / 2;
  const { p0, p1, dir, normal } = g;
  const W = o.width;
  const cls = `pv-op pv-${o.type}${sel ? ' is-sel' : ''}`;
  const at = (p, k) => G.add(p, G.mul(normal, k));
  const L = (a, b, c = '') => `<line x1="${r3(a.x)}" y1="${r3(a.y)}" x2="${r3(b.x)}" y2="${r3(b.y)}" ${NS} ${c}/>`;
  let s = `<g class="${cls}" data-kind="opening" data-id="${o.id}">`;
  // Hit area covering the gap.
  s += `<path class="pv-hit" d="${poly([at(p0, t + 0.05), at(p1, t + 0.05), at(p1, -t - 0.05), at(p0, -t - 0.05)])}"/>`;
  // Jambs
  s += L(at(p0, t), at(p0, -t), 'class="pv-jamb"') + L(at(p1, t), at(p1, -t), 'class="pv-jamb"');
  if (o.type === 'window') {
    s += `<path class="pv-win-frame" d="${poly([at(p0, t), at(p1, t), at(p1, -t), at(p0, -t)])}" ${NS}/>`;
    s += L(at(p0, t * 0.25), at(p1, t * 0.25), 'class="pv-glass"') + L(at(p0, -t * 0.25), at(p1, -t * 0.25), 'class="pv-glass"');
  } else if (o.type === 'opening') {
    s += L(at(p0, 0), at(p1, 0), 'class="pv-open-line"');
  } else if (o.type === 'sliding') {
    const half = W / 2 + 0.03;
    const pa = G.add(p0, G.mul(dir, 0)), pb = G.add(p1, G.mul(dir, -half));
    s += `<path class="pv-leaf-rect" d="${poly([at(pa, t * 0.5), at(G.add(pa, G.mul(dir, half)), t * 0.5), at(G.add(pa, G.mul(dir, half)), 0.02), at(pa, 0.02)])}" ${NS}/>`;
    s += `<path class="pv-leaf-rect" d="${poly([at(pb, -0.02), at(G.add(pb, G.mul(dir, half)), -0.02), at(G.add(pb, G.mul(dir, half)), -t * 0.5), at(pb, -t * 0.5)])}" ${NS}/>`;
  } else if (o.type === 'pocket') {
    const q = G.add(p0, G.mul(dir, W * 0.35));
    s += `<path class="pv-leaf-rect" d="${poly([at(G.sub(p0, G.mul(dir, W * 0.65)), 0.02), at(q, 0.02), at(q, -0.02), at(G.sub(p0, G.mul(dir, W * 0.65)), -0.02)])}" ${NS}/>`;
    s += L(at(G.sub(p0, G.mul(dir, W)), 0), at(p0, 0), 'class="pv-pocket"');
  } else {
    // Swing door(s): leaf drawn open at 90°, with the swing arc.
    const side = G.mul(normal, o.swing >= 0 ? 1 : -1);
    const leaves = o.type === 'double'
      ? [{ h: p0, other: G.lerp(p0, p1, 0.5), w: W / 2 }, { h: p1, other: G.lerp(p0, p1, 0.5), w: W / 2 }]
      : [{ h: o.hinge === 'b' ? p1 : p0, other: o.hinge === 'b' ? p0 : p1, w: W }];
    for (const lf of leaves) {
      const hf = G.add(lf.h, G.mul(side, t));
      const of = G.add(lf.other, G.mul(side, t));
      const tip = G.add(hf, G.mul(side, lf.w));
      const sweep = G.cross(G.sub(tip, hf), G.sub(of, hf)) > 0 ? 1 : 0;
      s += L(hf, tip, 'class="pv-leaf"');
      s += `<path class="pv-arc" d="M${r3(tip.x)},${r3(tip.y)} A${r3(lf.w)},${r3(lf.w)} 0 0 ${sweep} ${r3(of.x)},${r3(of.y)}" ${NS}/>`;
    }
    s += L(at(p0, t), at(p1, t), 'class="pv-sill"') + L(at(p0, -t), at(p1, -t), 'class="pv-sill"');
  }
  return s + '</g>';
}

function objectSVG(o, sel) {
  return `<g class="pv-obj${sel ? ' is-sel' : ''}" data-kind="object" data-id="${o.id}" transform="translate(${r3(o.x)} ${r3(o.y)}) rotate(${r3(o.rot || 0)})">`
    + `<rect class="pv-hit" x="${r3(-o.w / 2)}" y="${r3(-o.d / 2)}" width="${r3(o.w)}" height="${r3(o.d)}"/>`
    + symbolSVG(o) + '</g>';
}

// ------------------------------------------------------------------ screen layer helpers

/**
 * Dimension line between screen points P and Q, offset by `off` px along screen normal N
 * (N already points to the side where the dimension goes). Returns SVG.
 */
function dimLine(P, Q, N, off, label, cls, opts = {}) {
  const a = G.add(P, G.mul(N, off)), b = G.add(Q, G.mul(N, off));
  const segLen = G.dist(a, b);
  if (segLen < 3) return '';
  const base = opts.extFrom ?? 4;
  const ext = (p, q) => `<line class="dim-ext" x1="${r1(G.add(p, G.mul(N, base)).x)}" y1="${r1(G.add(p, G.mul(N, base)).y)}" x2="${r1(G.add(q, G.mul(N, 4)).x)}" y2="${r1(G.add(q, G.mul(N, 4)).y)}"/>`;
  const dir = G.norm(G.sub(b, a));
  const tick = (p) => {
    const k = G.mul(G.norm(G.add(dir, N)), 4.5);
    return `<line class="dim-tick" x1="${r1(p.x - k.x)}" y1="${r1(p.y - k.y)}" x2="${r1(p.x + k.x)}" y2="${r1(p.y + k.y)}"/>`;
  };
  let s = `<g class="dim ${cls}">`;
  if (opts.ext !== false) s += ext(P, a) + ext(Q, b);
  s += `<line class="dim-line" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}"/>` + tick(a) + tick(b);
  const fs = opts.fs || 11;
  const tw = textWidth(label, fs, 600);
  if (label && tw + 6 <= segLen) {
    const m = G.lerp(a, b, 0.5);
    const ang = upright(G.angleDeg(dir));
    s += `<text class="dim-text" font-size="${fs}" transform="translate(${r1(m.x)} ${r1(m.y)}) rotate(${r1(ang)})" text-anchor="middle" dy="0.35em">${esc(label)}</text>`;
  } else if (label && opts.outsideLabel && segLen > 10) {
    // Put the label past the end of the dimension line (for short segments)
    const ang = upright(G.angleDeg(dir));
    const m = G.add(b, G.mul(dir, tw / 2 + 6));
    s += `<text class="dim-text" font-size="${fs}" transform="translate(${r1(m.x)} ${r1(m.y)}) rotate(${r1(ang)})" text-anchor="middle" dy="0.35em">${esc(label)}</text>`;
  }
  return s + '</g>';
}

function handle(p, kind, id, role, extra = '') {
  return `<circle class="h h-${role}" cx="${r1(p.x)}" cy="${r1(p.y)}" r="7" data-kind="handle" data-id="${id}" data-role="${role}" data-of="${kind}" ${extra}/>`;
}

/** Distance from an object's side to the nearest wall face along a ray (for clearance dims). */
function rayToWall(plan, A, info, P, dir, maxD = 5) {
  let best = null;
  const far = G.add(P, G.mul(dir, maxD));
  for (const inf of info.walls.values()) {
    if (inf.w.kind === 'virtual') continue;
    const x = G.segmentIntersection(P, far, inf.A, inf.B);
    if (!x) continue;
    const cosang = Math.abs(G.dot(dir, inf.n)) || 1;
    const dd = x.t * maxD - (inf.w.thickness / 2) / cosang;
    if (dd > -0.02 && (!best || dd < best.d)) best = { d: Math.max(0, dd), hit: G.add(P, G.mul(dir, Math.max(0, dd))) };
  }
  return best;
}

// ------------------------------------------------------------------ main render

/**
 * Render the plan. ui = {
 *   selection, settings, hover, info (from analyse), preview: { wall:{a,b}, opening:{...}, object:{...} },
 *   measures: [{a,b}], highlight: { kind, id, until }
 * }
 * Returns { world, screen } SVG strings.
 */
export function renderPlan(plan, vp, ui) {
  const st = ui.settings;
  const info = ui.info || analyse(plan);
  const sel = ui.selection || {};
  const isSel = (k, id) => sel.kind === k && sel.id === id;
  const S = (p) => vp.toScreen(p);
  let world = '', screen = '';

  // Rooms
  world += '<g class="pv-rooms">';
  for (const f of info.rooms) {
    const selR = f.room && isSel('room', f.room.id);
    world += `<path class="pv-room${selR ? ' is-sel' : ''}" d="${poly(f.pts)}" data-kind="roomface" data-id="${f.room?.id || ''}" data-face="${f.ids.join(',')}"/>`;
  }
  world += '</g>';

  // Objects (below walls so wall lines stay crisp over them)
  if (st.showFurniture) {
    world += '<g class="pv-objs">';
    for (const o of plan.objects) world += objectSVG(o, isSel('object', o.id));
    world += '</g>';
  }

  // Walls
  world += '<g class="pv-walls">';
  for (const inf of info.walls.values()) {
    const w = inf.w;
    const selW = isSel('wall', w.id);
    if (w.kind === 'virtual') {
      world += `<g class="pv-wallg${selW ? ' is-sel' : ''}" data-kind="wall" data-id="${w.id}"><line class="pv-hitline" x1="${r3(inf.A.x)}" y1="${r3(inf.A.y)}" x2="${r3(inf.B.x)}" y2="${r3(inf.B.y)}"/>`
        + `<line class="pv-virtual" x1="${r3(inf.A.x)}" y1="${r3(inf.A.y)}" x2="${r3(inf.B.x)}" y2="${r3(inf.B.y)}" ${NS}/></g>`;
      continue;
    }
    const pieces = wallPieces(plan, inf);
    world += `<g class="pv-wallg${selW ? ' is-sel' : ''}" data-kind="wall" data-id="${w.id}"><line class="pv-hitline" x1="${r3(inf.A.x)}" y1="${r3(inf.A.y)}" x2="${r3(inf.B.x)}" y2="${r3(inf.B.y)}"/>`;
    world += `<path class="pv-wall" d="${pieces.map(poly).join('')}"/>`;
    world += '</g>';
  }
  world += '</g>';

  // Openings
  world += '<g class="pv-ops">';
  for (const o of plan.openings) {
    const inf = info.walls.get(o.wallId);
    if (inf) world += openingSVG(plan, o, inf, isSel('opening', o.id));
  }
  world += '</g>';

  // Photo cones (world) + pins (screen)
  if (st.showPhotos) {
    world += '<g class="pv-photos">';
    for (const p of plan.photos) {
      const L = 0.9, h = (p.fov || 60) / 2;
      const a = G.add(p, G.mul(G.rot({ x: 1, y: 0 }, p.dir - h), L)), b = G.add(p, G.mul(G.rot({ x: 1, y: 0 }, p.dir + h), L));
      world += `<path class="pv-cone${isSel('photo', p.id) ? ' is-sel' : ''}" d="M${r3(p.x)},${r3(p.y)}L${r3(a.x)},${r3(a.y)}A${L},${L} 0 0 1 ${r3(b.x)},${r3(b.y)}Z" ${NS}/>`;
    }
    world += '</g>';
  }

  // ---------------------------------------------------------------- screen layer
  const unitsImperial = getUnits() === 'imperial';
  const fmt = (m) => fmtLen(m);
  const fmtS = (m) => fmtLenShort(m);

  // Dimensions
  if (st.showDims) {
    screen += '<g class="dims">';
    for (const inf of info.walls.values()) {
      const w = inf.w;
      const selOp = sel.kind === 'opening' && plan.openings.some((o) => o.id === sel.id && o.wallId === w.id);
      const selW = isSel('wall', w.id) || selOp;
      if (w.kind === 'virtual' && !selW) continue;
      const Ls = inf.L * vp.s;
      if (Ls < 26 && !selW) continue;
      const inside = st.dimMode === 'inside' && w.kind !== 'virtual';
      const cutA = inside ? inf.extA : 0, cutB = inside ? inf.extB : 0;
      // Screen-space normal on the dimension side.
      const nW = G.mul(inf.n, inf.out);
      const P0 = S(G.add(inf.A, G.mul(inf.d, cutA))), P1 = S(G.add(inf.A, G.mul(inf.d, inf.L - cutB)));
      const faceOff = (w.thickness / 2) * vp.s;
      const Ns = G.norm(nW); // uniform scale, same direction in screen space
      const ops = M.openingsOf(plan, w.id);
      // Interior walls sit inside rooms: keep them light at overview zoom (overall length close to
      // the wall), and reveal their opening chains once zoomed in or when the wall is selected.
      const zoomedIn = vp.s >= vp.fitS * 1.45;
      const chainOn = st.showChains && ops.length && (selW || (inf.exterior ? Ls > 90 : zoomedIn && Ls > 120));
      const tier1 = faceOff + (inf.exterior ? 14 : 10), tier2 = faceOff + (chainOn ? (inf.exterior ? 34 : 28) : (inf.exterior ? 14 : 10));
      if (chainOn) {
        const chain = M.wallChain(plan, w);
        for (let i = 0; i < chain.length; i++) {
          const c = chain[i];
          const from = i === 0 ? Math.max(c.from, cutA) : c.from;
          const to = i === chain.length - 1 ? Math.min(c.to, inf.L - cutB) : c.to;
          const len = to - from;
          if (len < 0.005) continue;
          const a = S(G.add(inf.A, G.mul(inf.d, from))), b = S(G.add(inf.A, G.mul(inf.d, to)));
          const cls = c.kind === 'wall' ? 'dim-chain' : `dim-chain dim-${c.kind === 'window' ? 'win' : 'door'}`;
          screen += dimLine(a, b, Ns, tier1, fmtS(len), cls, { fs: 10, extFrom: faceOff + 2 });
        }
      }
      const len = inside ? Math.max(0, inf.L - cutA - cutB) : inf.L;
      screen += dimLine(P0, P1, Ns, tier2, fmt(len), 'dim-wall' + (selW ? ' is-sel' : ''), { fs: 11, extFrom: faceOff + 2 });
    }
    // Overall extents (top and left), outermost tier.
    const allN = Object.values(plan.nodes);
    if (allN.length > 1) {
      const b = G.bounds(allN);
      const tl = S({ x: b.minX, y: b.minY }), tr = S({ x: b.maxX, y: b.minY }), bl = S({ x: b.minX, y: b.maxY });
      const maxT = Math.max(0.2, ...plan.walls.map((w) => w.thickness)) / 2 * vp.s;
      if (b.w * vp.s > 60) screen += dimLine(tl, tr, { x: 0, y: -1 }, maxT + 58, fmt(b.w), 'dim-total', { fs: 12, extFrom: maxT + 44 });
      if (b.h * vp.s > 60) screen += dimLine(bl, tl, { x: -1, y: 0 }, maxT + 58, fmt(b.h), 'dim-total', { fs: 12, extFrom: maxT + 44 });
    }
    screen += '</g>';
  }

  // Room labels
  screen += '<g class="room-labels">';
  for (const f of info.rooms) {
    const anchor = f.room ? f.room : f.label;
    const p = S(f.room && G.pointInPolygon(f.room, f.pts) ? f.room : f.label);
    const b = G.bounds(f.pts);
    const small = Math.min(b.w, b.h) * vp.s < 70;
    if (Math.min(b.w, b.h) * vp.s < 34) continue;
    const name = f.room?.name || '';
    const selR = f.room && isSel('room', f.room.id);
    // Shrink the name to fit the room's width (the phone app lets names spill over walls).
    const roomW = b.w * vp.s * 0.9;
    const nfs = name ? G.clamp(13 * roomW / Math.max(1, textWidth(name, 13, 650)), 9, 13) : 13;
    screen += `<g class="room-label${selR ? ' is-sel' : ''}" data-kind="room" data-id="${f.room?.id || ''}" data-face="${f.ids.join(',')}" transform="translate(${r1(p.x)} ${r1(p.y)})">`;
    if (name) screen += `<text class="rl-name" text-anchor="middle" y="${small ? 0 : -3}" style="font-size:${r1(nfs)}px">${esc(name)}</text>`;
    screen += `<text class="rl-area" text-anchor="middle" y="${name ? (small ? 13 : 12) : 4}">${esc(fmtArea(f.area))}</text>`;
    screen += '</g>';
    void anchor;
  }
  screen += '</g>';

  // Photo pins
  if (st.showPhotos) {
    screen += '<g class="photo-pins">';
    plan.photos.forEach((p, i) => {
      const q = S(p);
      screen += `<g class="photo-pin${isSel('photo', p.id) ? ' is-sel' : ''}" data-kind="photo" data-id="${p.id}" transform="translate(${r1(q.x)} ${r1(q.y)})">`
        + `<circle r="11"/><path d="M-5.5,-2.5h2.2l1.3-2h4l1.3,2h2.2v7h-11z" class="cam"/><circle r="2" cy="1" class="lens"/>`
        + `<text x="13" y="-9" class="pin-num">${i + 1}</text></g>`;
    });
    screen += '</g>';
  }

  // Notes
  screen += '<g class="notes">';
  for (const n of plan.notes) {
    const q = S(n);
    const tw = Math.min(220, textWidth(n.text || '…', 12, 500)) + 16;
    screen += `<g class="note${isSel('note', n.id) ? ' is-sel' : ''}" data-kind="note" data-id="${n.id}" transform="translate(${r1(q.x)} ${r1(q.y)})">`
      + `<rect x="${r1(-tw / 2)}" y="-13" width="${r1(tw)}" height="24" rx="7"/><text text-anchor="middle" y="4">${esc((n.text || '…').slice(0, 40))}</text></g>`;
  }
  screen += '</g>';

  // Selection overlays & handles
  screen += selectionOverlay(plan, vp, ui, info);

  // Measurements
  for (const m of ui.measures || []) {
    const a = S(m.a), b = S(m.b);
    const d = G.dist(m.a, m.b);
    const N = G.perp(G.norm(G.sub(b, a)));
    screen += `<g class="measure"><circle cx="${r1(a.x)}" cy="${r1(a.y)}" r="4"/><circle cx="${r1(b.x)}" cy="${r1(b.y)}" r="4"/>`
      + dimLine(a, b, N, 0, fmt(d), 'dim-measure', { fs: 12, ext: false, outsideLabel: true }) + '</g>';
  }

  // Tool previews
  const pv = ui.preview || {};
  if (pv.wall) {
    const a = S(pv.wall.a), b = S(pv.wall.b);
    const L = G.dist(pv.wall.a, pv.wall.b);
    const N = G.perp(G.norm(G.sub(b, a)));
    screen += `<g class="preview"><line class="pw-line${pv.wall.virtual ? ' virtual' : ''}" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" stroke-width="${Math.max(2, (pv.wall.thickness || 0.15) * vp.s)}"/>`
      + dimLine(a, b, N, 22, fmt(L), 'dim-preview', { fs: 12, outsideLabel: true })
      + `<text class="pw-angle" x="${r1(b.x + 12)}" y="${r1(b.y - 12)}">${Math.round(((G.angleDeg(G.sub(pv.wall.b, pv.wall.a)) % 360) + 360) % 360)}°</text></g>`;
  }
  if (pv.snap) {
    const q = S(pv.snap);
    screen += `<circle class="snap-dot" cx="${r1(q.x)}" cy="${r1(q.y)}" r="6"/>`;
  }
  if (pv.guides) {
    for (const g of pv.guides) {
      const a = S(g.a), b = S(g.b);
      screen += `<line class="guide" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}"/>`;
    }
  }
  if (pv.opening) {
    const { wall, center, width, type } = pv.opening;
    const inf = info.walls.get(wall);
    if (inf) {
      const s0 = G.clamp(center - width / 2, 0, Math.max(0, inf.L - width));
      const a = S(G.add(inf.A, G.mul(inf.d, s0))), b = S(G.add(inf.A, G.mul(inf.d, s0 + width)));
      const N = G.mul(G.norm(inf.n), inf.out);
      screen += `<g class="preview"><line class="po-line ${type === 'window' ? 'win' : 'door'}" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" stroke-width="${Math.max(4, inf.w.thickness * vp.s)}"/>`;
      // live position dims from both corners
      const A = S(inf.A), B = S(inf.B), off = inf.w.thickness / 2 * vp.s + 16;
      screen += dimLine(A, a, N, off, fmtS(s0), 'dim-preview', { fs: 11, outsideLabel: true }) + dimLine(b, B, N, off, fmtS(inf.L - s0 - width), 'dim-preview', { fs: 11, outsideLabel: true }) + '</g>';
    }
  }
  if (pv.object) {
    const o = pv.object;
    const pts = G.rectCorners(o.x, o.y, o.w, o.d, o.rot || 0).map(S);
    screen += `<path class="po-obj" d="${poly(pts)}"/>`;
  }

  void unitsImperial;
  return { world, screen, info };
}

function selectionOverlay(plan, vp, ui, info) {
  const sel = ui.selection;
  if (!sel) return '';
  const S = (p) => vp.toScreen(p);
  let s = '<g class="sel-layer">';
  if (sel.kind === 'wall') {
    const inf = info.walls.get(sel.id);
    if (inf) {
      const A = S(inf.A), B = S(inf.B);
      s += `<line class="sel-line" x1="${r1(A.x)}" y1="${r1(A.y)}" x2="${r1(B.x)}" y2="${r1(B.y)}"/>`;
      s += handle(A, 'wall', inf.w.a, 'node') + handle(B, 'wall', inf.w.b, 'node');
      const m = G.lerp(A, B, 0.5), N = G.mul(G.norm(inf.n), -inf.out);
      const hp = G.add(m, G.mul(N, inf.w.thickness / 2 * vp.s + 16));
      s += `<g class="h-move" data-kind="handle" data-id="${inf.w.id}" data-role="wallmove" data-of="wall" transform="translate(${r1(hp.x)} ${r1(hp.y)}) rotate(${r1(G.angleDeg(N))})"><circle r="11" class="h-bg"/><path d="M-5,0H5M1.5,-3.5L5,0L1.5,3.5M-1.5,-3.5L-5,0L-1.5,3.5" class="h-arrow"/></g>`;
    }
  } else if (sel.kind === 'node') {
    const n = plan.nodes[sel.id];
    if (n) s += handle(S(n), 'node', sel.id, 'node');
  } else if (sel.kind === 'opening') {
    const o = plan.openings.find((x) => x.id === sel.id);
    const inf = o && info.walls.get(o.wallId);
    if (o && inf) {
      const g = M.openingGeom(plan, o);
      s += handle(S(g.p0), 'opening', o.id, 'op0') + handle(S(g.p1), 'opening', o.id, 'op1');
    }
  } else if (sel.kind === 'object') {
    const o = plan.objects.find((x) => x.id === sel.id);
    if (o) {
      const pts = G.rectCorners(o.x, o.y, o.w, o.d, o.rot || 0);
      const sp = pts.map(S);
      s += `<path class="sel-box" d="${poly(sp)}"/>`;
      // rotate handle beyond the back edge (local -y)
      const back = G.lerp(pts[0], pts[1], 0.5);
      const outDir = G.norm(G.sub(back, { x: o.x, y: o.y }));
      const bs = S(back);
      const rp = G.add(bs, G.mul(outDir, 26));
      s += `<line class="sel-stem" x1="${r1(bs.x)}" y1="${r1(bs.y)}" x2="${r1(rp.x)}" y2="${r1(rp.y)}"/>`;
      s += `<g class="h-rot" data-kind="handle" data-id="${o.id}" data-role="rotate" data-of="object" transform="translate(${r1(rp.x)} ${r1(rp.y)})"><circle r="11" class="h-bg"/><path d="M4,-3A5,5 0 1 0 5,1.5M4,-3L4.5,-6.5M4,-3L0.7,-3.4" class="h-arrow"/></g>`;
      sp.forEach((p, i) => { s += handle(p, 'object', o.id, 'corner' + i); });
      // Size + clearance dimensions to nearest walls
      if (ui.settings.showDims) {
        const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
        const halves = [o.d / 2, o.w / 2, o.d / 2, o.w / 2];
        dirs.forEach((dl, i) => {
          const dw = G.rot(dl, o.rot || 0);
          const P = G.add({ x: o.x, y: o.y }, G.mul(dw, halves[i]));
          const hit = rayToWall(plan, null, info, P, dw, 4);
          if (!hit || hit.d < 0.01 || hit.d * vp.s < 16) return;
          const a = S(P), b = S(hit.hit);
          s += dimLine(a, b, G.perp(G.norm(G.sub(b, a))), 0, fmtLenShort(hit.d), 'dim-clear', { fs: 11, ext: false, outsideLabel: true });
        });
        const lbl = `${fmtLenShort(o.w)} × ${fmtLenShort(o.d)}`;
        const c = S({ x: o.x, y: o.y });
        s += `<text class="obj-size" x="${r1(c.x)}" y="${r1(c.y + Math.max(o.w, o.d) * vp.s / 2 + 34)}" text-anchor="middle">${esc(catalogLabel(o.type, lang()))} · ${esc(lbl)}</text>`;
      }
    }
  } else if (sel.kind === 'photo') {
    const p = plan.photos.find((x) => x.id === sel.id);
    if (p) {
      const q = S(p);
      const tip = G.add(q, G.mul(G.rot({ x: 1, y: 0 }, p.dir), 44));
      s += `<line class="sel-stem" x1="${r1(q.x)}" y1="${r1(q.y)}" x2="${r1(tip.x)}" y2="${r1(tip.y)}"/>` + handle(tip, 'photo', p.id, 'photodir');
    }
  }
  return s + '</g>';
}

/** Hit test at screen point: returns { kind, id, role?, face? } using DOM data attributes. */
export function hitFromElement(el) {
  while (el && el.nodeType === 1) {
    const k = el.getAttribute && el.getAttribute('data-kind');
    if (k) {
      const r = { kind: k, id: el.getAttribute('data-id') };
      if (k === 'handle') { r.role = el.getAttribute('data-role'); r.of = el.getAttribute('data-of'); }
      const face = el.getAttribute('data-face');
      if (face) r.face = face.split(',');
      return r;
    }
    if (el.tagName === 'svg') break;
    el = el.parentNode;
  }
  return null;
}

/** Nearest wall to world point p within tol (metres): { wallId, s (along), d, point }. */
export function nearestWall(plan, info, p, tol, filter) {
  let best = null;
  for (const inf of info.walls.values()) {
    if (filter && !filter(inf.w)) continue;
    const pr = G.projectOnSegment(p, inf.A, inf.B);
    const d = pr.d - inf.w.thickness / 2;
    if (d <= tol && (!best || d < best.d)) best = { wallId: inf.w.id, s: pr.t * inf.L, d, point: pr.point, info: inf };
  }
  return best;
}

/** Pick a nice scale-bar length for px-per-metre s. */
export function scaleBar(s) {
  const imperial = getUnits() === 'imperial';
  const unit = imperial ? 0.3048 : 1;
  const steps = imperial ? [1, 2, 5, 10, 20, 50, 100] : [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
  let best = steps[0];
  for (const st of steps) if (st * unit * s <= 130) best = st;
  const px = best * unit * s;
  const label = imperial ? `${best} ft` : best < 1 ? `${Math.round(best * 100)} cm` : `${best} m`;
  return { px, label };
}

/** Grid spacing in metres for current zoom. */
export function gridStep(s) {
  const imperial = getUnits() === 'imperial';
  const steps = imperial ? [0.0254 * 6, 0.3048, 0.3048 * 5, 0.3048 * 10] : [0.1, 0.5, 1, 5];
  for (const st of steps) if (st * s >= 14) return st;
  return steps[steps.length - 1] * 2;
}
