// 3D "Model" tab: walls with real openings, doors / windows, room floors, low-poly furniture,
// orbit / top / walk cameras, picking and selection highlight. Renders on demand.
//
// Mapping: plan x → three x, plan y → three z, height → three y (metres).
// Object frame: group at (o.x, elev, o.y), rotation.y = -rot°, local x = plan local x, local z = plan
// local y ("front" is +z, the back that sits against a wall is -z).

import * as THREE from '../vendor/three.module.min.js';
import { store } from './store.js';
import { t, lang } from './i18n.js';
import * as M from './model.js';
import * as G from './geometry.js';
import { CATALOG } from './catalog.js';
import { fmtArea } from './units.js';

const DEG = Math.PI / 180;
const CUT_H = 1.0;          // "dollhouse" wall height
const EYE = 1.6;            // walk eye height
const WALK_SPEED = 1.5;     // m/s
const BODY_R = 0.22;        // walk collision radius

// ------------------------------------------------------------------ shared unit geometries

const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  sphere: new THREE.SphereGeometry(0.5, 24, 14),
};
for (const g of Object.values(UNIT)) g.userData.persistent = true;
const EDGE_BOX = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
EDGE_BOX.userData.persistent = true;

// ------------------------------------------------------------------ procedural floor textures

let TEX = null;
function floorTextures(renderer) {
  if (TEX) return TEX;
  const rnd = mulberry(7);
  const mk = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    draw(c.getContext('2d'));
    const tx = new THREE.CanvasTexture(c);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tx.userData.persistent = true;
    return tx;
  };
  // Wood planks: 1.6 m tile, 9 rows of ~18 cm boards.
  const wood = mk((g) => {
    const rows = 9, rh = 512 / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 300;
      while (x < 512) {
        const len = 180 + rnd() * 260;
        const l = 71 + rnd() * 7, s = 36 + rnd() * 8;
        g.fillStyle = `hsl(33 ${s}% ${l}%)`;
        g.fillRect(x, r * rh, len, rh);
        // grain
        g.globalAlpha = 0.07;
        for (let k = 0; k < 6; k++) {
          g.fillStyle = rnd() > 0.5 ? '#6b4a2a' : '#fff4e0';
          g.fillRect(x, r * rh + rnd() * rh, len, 1 + rnd() * 2);
        }
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(70,45,20,0.35)';
        g.fillRect(x, r * rh, 1.5, rh);
        x += len;
      }
      g.fillStyle = 'rgba(70,45,20,0.3)';
      g.fillRect(0, r * rh, 512, 1.5);
    }
  });
  wood.repeat.set(1 / 1.6, 1 / 1.6);
  // Tiles: 1.2 m tile, 4 × 4 tiles of 30 cm.
  const tile = mk((g) => {
    g.fillStyle = '#c9c6c0';
    g.fillRect(0, 0, 512, 512);
    const n = 4, s = 512 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const l = 88 + rnd() * 4;
      g.fillStyle = `hsl(40 6% ${l}%)`;
      g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
    }
  });
  tile.repeat.set(1 / 1.2, 1 / 1.2);
  TEX = { wood, tile };
  return TEX;
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

const WET_ROOM = /bain|bath|douche|shower|\bwc\b|toilet|toilette|laund|buand|lavage|mud|vestibule|entr[ée]e|cellier|garage/i;
const FLOOR_TINTS = ['#ffffff', '#f6ece2', '#fff6ea', '#efe6dc', '#f9efe4'];

// ------------------------------------------------------------------ icons

const ICON = {
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M5 20v-7h14v7M5 13l3-5h8l3 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-dasharray="0"/><path d="M8 8V4M16 8V4" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 2"/></svg>',
  labels: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h9M3 12h13M3 17h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M16 15l2.5 2.5L22 13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const L10N = {
  en: { walkHintMouse: 'Drag to look · WASD / arrows to move · click the floor to walk there · Esc to exit', walkHintTouch: 'Drag to look · joystick to move · tap the floor to walk there', labels: 'Room names', noGL: '3D view unavailable: WebGL is disabled on this device.' },
  fr: { walkHintMouse: 'Glisser pour regarder · WASD / flèches pour avancer · cliquer au sol pour s’y rendre · Échap pour quitter', walkHintTouch: 'Glisser pour regarder · manette pour avancer · toucher le sol pour s’y rendre', labels: 'Noms des pièces', noGL: 'Vue 3D indisponible : WebGL est désactivé sur cet appareil.' },
};
const tl = (k) => (L10N[lang()] || L10N.en)[k] || L10N.en[k];

// =================================================================== view

export function createModelView(container) {
  // ---------------------------------------------------------------- DOM
  const root = document.createElement('div');
  root.className = 'v3d';
  root.innerHTML = `
    <div class="v3d-labels" aria-hidden="true"></div>
    <div class="v3d-bar" role="toolbar">
      <div class="v3d-seg" role="group">
        <button type="button" data-mode="orbit"></button>
        <button type="button" data-mode="top"></button>
        <button type="button" data-mode="walk"></button>
      </div>
      <div class="v3d-tools">
        <button type="button" class="v3d-btn" data-act="cut">${ICON.cut}<span></span></button>
        <button type="button" class="v3d-btn" data-act="labels">${ICON.labels}<span></span></button>
        <button type="button" class="v3d-btn" data-act="reset">${ICON.reset}<span></span></button>
      </div>
    </div>
    <div class="v3d-hint" hidden></div>
    <div class="v3d-joy" hidden><div class="v3d-joy-knob"></div></div>`;
  container.appendChild(root);
  const labelsEl = root.querySelector('.v3d-labels');
  const hintEl = root.querySelector('.v3d-hint');
  const joyEl = root.querySelector('.v3d-joy');
  const knobEl = root.querySelector('.v3d-joy-knob');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    const msg = document.createElement('div');
    msg.className = 'v3d-nogl';
    msg.textContent = tl('noGL');
    root.appendChild(msg);
    root.querySelector('.v3d-bar').hidden = true;
    return { activate() {}, deactivate() {}, resize() {} };
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'v3d-canvas';
  canvas.tabIndex = 0;
  root.prepend(canvas);

  // ---------------------------------------------------------------- scene
  const scene = new THREE.Scene();
  const persp = new THREE.PerspectiveCamera(50, 1, 0.05, 600);
  const ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 600);
  let camera = persp;

  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8a58c, 1.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.geometry.userData.persistent = true;
  ground.material.userData.persistent = true;
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.004;
  ground.receiveShadow = true;
  scene.add(ground);

  const content = new THREE.Group();
  scene.add(content);
  let gWalls, gFloors, gObjects, gVirtual;

  // Per-build registries
  const wallGroups = new Map(), objGroups = new Map(), openGroups = new Map();
  let floorMeshes = [];
  let labelItems = [];        // { el, pos: Vector3 }
  let walkSegs = [];          // collision data
  let bounds = { minX: 0, minY: 0, maxX: 6, maxY: 6, w: 6, h: 6 };
  let matCache = new Map();

  // ---------------------------------------------------------------- state
  const view = { mode: 'orbit', cut: true, labels: true };
  const orbit = { target: new THREE.Vector3(), theta: 0.4, phi: 0.95, radius: 14 };
  const topv = { target: new THREE.Vector3(), radius: 8 };
  const walk = { pos: new THREE.Vector3(0, EYE, 0), yaw: 0, pitch: -0.05, goal: null, keys: new Set(), joy: { x: 0, y: 0 } };
  let active = false, raf = 0, last = 0;
  let sceneDirty = true, needsRender = true, framed = false, built = false;
  let theme = { bg: '#f2f2f5', virtual: '#8c8c94', sel: '#ff7a00' };
  const coarse = window.matchMedia?.('(pointer: coarse)');

  const requestRender = () => { needsRender = true; };

  // ---------------------------------------------------------------- theme
  function cssVar(name, fb) {
    const v = getComputedStyle(container).getPropertyValue(name).trim();
    return v || fb;
  }
  function readTheme() {
    const nt = { bg: cssVar('--bg', '#f2f2f5'), virtual: cssVar('--virtual', '#8c8c94'), sel: cssVar('--sel', '#ff7a00') };
    const changed = JSON.stringify(nt) !== JSON.stringify(theme);
    theme = nt;
    try { scene.background = new THREE.Color().setStyle(theme.bg); } catch { scene.background = new THREE.Color(0xf2f2f5); }
    const dark = scene.background.getHSL({}).l < 0.4;
    hemi.intensity = dark ? 1.35 : 1.55;
    if (changed) { sceneDirty = true; }
    requestRender();
  }
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', () => setTimeout(readTheme, 0));
  new MutationObserver(() => readTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

  // ---------------------------------------------------------------- materials
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    let m = matCache.get(key);
    if (!m) {
      const { opacity, emissive, ...rest } = opts;
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...rest });
      if (opacity != null) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
      if (emissive) { m.emissive = new THREE.Color(emissive); }
      matCache.set(key, m);
    }
    return m;
  }
  const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
  const mix = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
  const M_ = {
    white: () => mat('#f5f5f3', { roughness: 0.35 }),
    porcelain: () => mat('#f7f8f9', { roughness: 0.25 }),
    chrome: () => mat('#dfe3e7', { roughness: 0.22, metalness: 0.25 }),
    dark: () => mat('#2b2d30', { roughness: 0.5 }),
    glass: () => mat('#bfe4ff', { roughness: 0.05, opacity: 0.28 }),
    darkGlass: () => mat('#1d2226', { roughness: 0.1, metalness: 0.2 }),
    frame: () => mat('#f4f4f2', { roughness: 0.5 }),
    wall: () => mat('#f1eee8', { roughness: 0.9 }),
    wallCap: () => mat('#3c3c42', { roughness: 0.9 }),
    wallSel: () => mat('#f1eee8', { roughness: 0.9, emissive: theme.sel, emissiveIntensity: 0.28 }),
    leaf: () => mat('#e9e2d6', { roughness: 0.6 }),
    wood: () => mat('#8b6a4c', { roughness: 0.7 }),
  };

  // ---------------------------------------------------------------- mesh helpers
  function mesh(geo, material, shadow = true) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = shadow && !material.transparent;
    m.receiveShadow = true;
    return m;
  }
  /** Axis-aligned box from ranges in the parent's frame. */
  function bx(parent, material, x0, x1, y0, y1, z0, z1) {
    const m = mesh(UNIT.box, material);
    m.scale.set(Math.max(1e-4, x1 - x0), Math.max(1e-4, y1 - y0), Math.max(1e-4, z1 - z0));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parent.add(m);
    return m;
  }
  /** Vertical (elliptic) cylinder: centre (x, z), diameters dx/dz, from y0 to y1. */
  function cy(parent, material, x, z, dx, dz, y0, y1, lo = false) {
    const m = mesh(lo ? UNIT.cylLo : UNIT.cyl, material);
    m.scale.set(dx, Math.max(1e-4, y1 - y0), dz);
    m.position.set(x, (y0 + y1) / 2, z);
    parent.add(m);
    return m;
  }
  function sph(parent, material, x, y, z, sx, sy, sz) {
    const m = mesh(UNIT.sphere, material);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  /** Thin vertical panel between two local points (x,z) from y0 to y1. */
  function panel(parent, material, p, q, y0, y1, th = 0.012) {
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    const m = mesh(UNIT.box, material);
    m.scale.set(L, y1 - y0, th);
    m.position.set((p[0] + q[0]) / 2, (y0 + y1) / 2, (p[1] + q[1]) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
    parent.add(m);
    return m;
  }
  /** Extruded prism from local [x, z] outline (+ optional holes), y0..y1. */
  function prism(parent, material, outline, y0, y1, holes = []) {
    const toShape = (pts, S) => { const s = new S(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath?.(); return s; };
    const shape = toShape(outline, THREE.Shape);
    for (const h of holes) shape.holes.push(toShape(h, THREE.Path));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y0, 0);
    const m = mesh(geo, material);
    parent.add(m);
    return m;
  }
  function roundRect(w, d, r, n = 8) {
    r = Math.min(r, w / 2, d / 2);
    const pts = [];
    const corners = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 90], [-w / 2 + r, -d / 2 + r, 180], [w / 2 - r, -d / 2 + r, 270]];
    for (const [cx, cz, a0] of corners) for (let i = 0; i <= n; i++) {
      const a = (a0 + 90 * i / n) * DEG;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    return pts;
  }

  // ---------------------------------------------------------------- object builders
  /** Which sides of the object's local rect are flush against a solid wall. */
  function sidesAgainstWalls(o) {
    const res = new Set();
    const plan = store.plan;
    const sides = { back: [[-0.35, -0.5], [0, -0.5], [0.35, -0.5]], front: [[-0.35, 0.5], [0, 0.5], [0.35, 0.5]], left: [[-0.5, -0.35], [-0.5, 0], [-0.5, 0.35]], right: [[0.5, -0.35], [0.5, 0], [0.5, 0.35]] };
    for (const [k, pts] of Object.entries(sides)) {
      let hits = 0;
      for (const [u, v] of pts) {
        const p = G.add(G.rot({ x: u * o.w, y: v * o.d }, o.rot || 0), { x: o.x, y: o.y });
        for (const w of plan.walls) {
          if (w.kind === 'virtual') continue;
          const [a, b] = M.wallEnds(plan, w);
          if (G.projectOnSegment(p, a, b).d <= w.thickness / 2 + 0.07) { hits++; break; }
        }
      }
      if (hits >= 2) res.add(k);
    }
    return res;
  }

  function cabinetBody(g, col, w, d, h, topMat, topT = 0.04) {
    const bodyTop = h - topT;
    bx(g, mat(shade(col, 0.55)), -w / 2 + 0.01, w / 2 - 0.01, 0, 0.1, -d / 2, d / 2 - 0.07);  // toe kick
    bx(g, mat(col), -w / 2, w / 2, 0.1, bodyTop, -d / 2, d / 2 - 0.02);
    const n = Math.max(1, Math.round(w / 0.5));
    const pw = w / n;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + i * pw;
      bx(g, mat(mix(col, '#ffffff', 0.12), { roughness: 0.6 }), x0 + 0.006, x0 + pw - 0.006, 0.105, bodyTop - 0.008, d / 2 - 0.02, d / 2);
      const hx = i % 2 ? x0 + 0.06 : x0 + pw - 0.06;
      bx(g, M_.chrome(), hx - 0.006, hx + 0.006, bodyTop - 0.2, bodyTop - 0.06, d / 2, d / 2 + 0.018);
    }
    bx(g, topMat, -w / 2 - 0.005, w / 2 + 0.005, bodyTop, h, -d / 2, d / 2 + 0.02);
  }
  function faucet(g, x, z, top) {
    cy(g, M_.chrome(), x, z, 0.035, 0.035, top, top + 0.16, true);
    bx(g, M_.chrome(), x - 0.012, x + 0.012, top + 0.13, top + 0.155, z, z + 0.12);
  }

  const BUILD = {
    box(g, o, col) {
      bx(g, mat(col), -o.w / 2, o.w / 2, 0, o.h, -o.d / 2, o.d / 2);
    },
    shower(g, o, col, ctx) {
      const { w, d, h } = o;
      const tray = 0.07;
      bx(g, M_.porcelain(), -w / 2, w / 2, 0, tray, -d / 2, d / 2);
      cy(g, M_.dark(), 0, 0, 0.08, 0.08, tray, tray + 0.003, true);
      const glass = M_.glass(), rail = M_.chrome();
      const sides = { front: [[-w / 2, d / 2 - 0.02], [w / 2, d / 2 - 0.02]], back: [[-w / 2, -d / 2 + 0.02], [w / 2, -d / 2 + 0.02]], left: [[-w / 2 + 0.02, -d / 2], [-w / 2 + 0.02, d / 2]], right: [[w / 2 - 0.02, -d / 2], [w / 2 - 0.02, d / 2]] };
      for (const [k, [p, q]] of Object.entries(sides)) {
        if (ctx.against.has(k)) continue;
        panel(g, glass, p, q, tray, h, 0.01);
        panel(g, rail, p, q, h - 0.02, h, 0.025);
      }
      // Tinted back wall panel + shower head on the back side.
      const bz = -d / 2 + 0.01;
      bx(g, mat(mix(col, '#ffffff', 0.55), { roughness: 0.3 }), -w / 2 + 0.03, w / 2 - 0.03, tray, Math.min(h, 2.0), bz - 0.005, bz + 0.005);
      const hy = Math.min(h, 2.1) - 0.12;
      bx(g, rail, -0.012, 0.012, hy - 0.012, hy + 0.012, bz, bz + 0.25);
      cy(g, rail, 0, bz + 0.27, 0.16, 0.16, hy - 0.04, hy - 0.02);
      bx(g, rail, -0.03, 0.03, 1.0, 1.08, bz, bz + 0.05);
    },
    showerCorner(g, o, col, ctx) {
      const { w, d, h } = o;
      const c = Math.min(w, d) * 0.4;
      const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2 - c], [w / 2 - c, d / 2], [-w / 2, d / 2]];
      prism(g, M_.porcelain(), pts, 0, 0.07);
      const glass = M_.glass(), rail = M_.chrome();
      const edges = [[pts[2], pts[3], null], [pts[1], pts[2], 'right'], [pts[3], pts[4], 'front'], [pts[4], pts[0], 'left'], [pts[0], pts[1], 'back']];
      for (const [p, q, k] of edges) {
        if (k && ctx.against.has(k)) continue;
        panel(g, glass, p, q, 0.07, h, 0.01);
        panel(g, rail, p, q, h - 0.02, h, 0.025);
      }
      const hy = Math.min(h, 2.1) - 0.12;
      bx(g, rail, -w / 2 + 0.1, -w / 2 + 0.12, hy - 0.012, hy + 0.012, -d / 2, -d / 2 + 0.25);
      cy(g, rail, -w / 2 + 0.11, -d / 2 + 0.27, 0.16, 0.16, hy - 0.04, hy - 0.02);
    },
    tub(g, o, col) {
      const { w, d, h } = o;
      const r = Math.min(0.08, d * 0.12);
      const shell = mat(col, { roughness: 0.3 });
      bx(g, shell, -w / 2, w / 2, 0, h, -d / 2, -d / 2 + r);
      bx(g, shell, -w / 2, w / 2, 0, h, d / 2 - r, d / 2);
      bx(g, shell, -w / 2, -w / 2 + r, 0, h, -d / 2 + r, d / 2 - r);
      bx(g, shell, w / 2 - r, w / 2, 0, h, -d / 2 + r, d / 2 - r);
      const inner = mat(mix(col, '#9fb6c4', 0.25), { roughness: 0.25 });
      prism(g, inner, roundRect(w - 2 * r, d - 2 * r, (d - 2 * r) * 0.35), 0, h * 0.35);
      cy(g, M_.dark(), -w / 2 + r + 0.15, 0, 0.05, 0.05, h * 0.35, h * 0.35 + 0.003, true);
      cy(g, M_.chrome(), -w / 2 + r / 2, 0, 0.04, 0.04, h, h + 0.1, true);
      bx(g, M_.chrome(), -w / 2 + r / 2, -w / 2 + r / 2 + 0.14, h + 0.07, h + 0.095, -0.012, 0.012);
    },
    tubFree(g, o, col) {
      const { w, d, h } = o;
      const outer = roundRect(w, d, d / 2, 10), innerP = roundRect(w - 0.12, d - 0.12, d / 2 - 0.06, 10);
      prism(g, mat(col, { roughness: 0.25 }), outer, 0.04, h, [innerP]);
      prism(g, mat(mix(col, '#9fb6c4', 0.25), { roughness: 0.25 }), innerP, 0.04, h * 0.4);
      prism(g, mat(shade(col, 0.8)), roundRect(w - 0.2, d - 0.2, d / 2 - 0.1, 6), 0, 0.04);
      cy(g, M_.chrome(), w / 2 + 0.12, 0, 0.04, 0.04, 0, h + 0.2, true);
      bx(g, M_.chrome(), w / 2 - 0.05, w / 2 + 0.12, h + 0.16, h + 0.19, -0.012, 0.012);
    },
    toilet(g, o, col) {
      const { w, d, h } = o;
      const porc = mat(col, { roughness: 0.22 });
      const hasTank = h >= 0.55;
      const tankD = hasTank ? Math.min(0.22, d * 0.3) : 0;
      const bowlD = d - tankD, zc = -d / 2 + tankD + bowlD / 2;
      const seat = Math.min(0.42, h);
      cy(g, porc, 0, zc - bowlD * 0.08, w * 0.5, bowlD * 0.55, 0, seat * 0.5);
      cy(g, porc, 0, zc, w * 0.92, bowlD * 0.96, seat * 0.5, seat - 0.03);
      cy(g, mat(mix(col, '#ffffff', 0.5), { roughness: 0.4 }), 0, zc, w * 0.95, bowlD * 0.98, seat - 0.03, seat);
      cy(g, mat('#a9bfcc', { roughness: 0.1 }), 0, zc + 0.01, w * 0.55, bowlD * 0.6, seat, seat + 0.002);
      if (hasTank) {
        bx(g, porc, -w * 0.47, w * 0.47, seat - 0.1, h - 0.03, -d / 2, -d / 2 + tankD);
        bx(g, porc, -w * 0.49, w * 0.49, h - 0.03, h, -d / 2 - 0.005, -d / 2 + tankD + 0.01);
        bx(g, M_.chrome(), -w * 0.4, -w * 0.28, h - 0.1, h - 0.08, -d / 2 + tankD, -d / 2 + tankD + 0.02);
      } else {
        faucet(g, 0, -d / 2 + 0.06, seat - 0.02);
      }
    },
    vanity(g, o, col, ctx) {
      const { w, d, h } = o;
      cabinetBody(g, col, w, d, h, mat('#f3f2ee', { roughness: 0.3 }));
      const n = ctx.spec.sinks || 1;
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + w * (i + 0.5) / n;
        cy(g, mat('#cfd6db', { roughness: 0.2 }), cx, d * 0.06, Math.min(w / n * 0.6, 0.44), d * 0.52, h, h + 0.003);
        cy(g, M_.dark(), cx, d * 0.06, 0.035, 0.035, h + 0.003, h + 0.005, true);
        faucet(g, cx, -d * 0.38, h);
      }
    },
    pedestal(g, o, col) {
      const { w, d, h } = o;
      const porc = mat(col, { roughness: 0.22 });
      cy(g, porc, 0, -d * 0.15, 0.2, 0.16, 0, h - 0.16);
      cy(g, porc, 0, 0, w, d, h - 0.16, h);
      bx(g, porc, -w / 2, w / 2, h - 0.16, h, -d / 2, -d * 0.1);
      cy(g, mat('#cfd6db', { roughness: 0.2 }), 0, 0.03, w * 0.6, d * 0.55, h, h + 0.003);
      faucet(g, 0, -d * 0.36, h);
    },
    counter(g, o, col, ctx) {
      const { w, d, h } = o;
      cabinetBody(g, col, w, d, h, mat('#8e8b86', { roughness: 0.35 }));
      const n = ctx.spec.sinks || 0;
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + w * (i + 0.5) / n;
        const sw = Math.min(w / n * 0.76, 0.6), sd = d * 0.56;
        bx(g, mat('#c3c8cc', { roughness: 0.25, metalness: 0.2 }), cx - sw / 2, cx + sw / 2, h, h + 0.003, -d * 0.2, -d * 0.2 + sd);
        cy(g, M_.dark(), cx, -d * 0.2 + sd / 2, 0.05, 0.05, h + 0.003, h + 0.005, true);
        faucet(g, cx, -d * 0.4, h);
      }
    },
    range(g, o, col) {
      const { w, d, h } = o;
      bx(g, mat(col, { roughness: 0.35, metalness: 0.15 }), -w / 2, w / 2, 0, h - 0.02, -d / 2, d / 2);
      bx(g, M_.darkGlass(), -w / 2, w / 2, h - 0.02, h, -d / 2, d / 2);
      bx(g, mat(col, { roughness: 0.35, metalness: 0.15 }), -w / 2, w / 2, h, h + 0.14, -d / 2, -d / 2 + 0.06);
      for (const [sx, sz, s] of [[-1, -1, 1], [1, -1, 0.8], [-1, 1, 0.8], [1, 1, 1]]) {
        const r = Math.min(w, d) * 0.3 * s;
        cy(g, mat('#55585c', { roughness: 0.6 }), sx * w / 4, sz * d / 4 + 0.02, r, r, h, h + 0.006);
      }
      bx(g, M_.darkGlass(), -w * 0.36, w * 0.36, h * 0.22, h * 0.6, d / 2, d / 2 + 0.005);
      bx(g, M_.chrome(), -w * 0.38, w * 0.38, h * 0.7, h * 0.72, d / 2 + 0.01, d / 2 + 0.03);
    },
    appliance(g, o, col) {
      const { w, d, h } = o;
      bx(g, mat(col, { roughness: 0.35 }), -w / 2, w / 2, 0, h - 0.1, -d / 2, d / 2);
      bx(g, mat(shade(col, 0.9), { roughness: 0.35 }), -w / 2, w / 2, h - 0.1, h, -d / 2, d / 2);
      bx(g, M_.darkGlass(), -w * 0.25, w * 0.15, h - 0.075, h - 0.03, d / 2, d / 2 + 0.004);
      cy(g, M_.chrome(), w * 0.35, d / 2 + 0.01, 0.05, 0.05, h - 0.07, h - 0.03, true).rotation.x = 0;
      const r = Math.min(w, h) * 0.34, yc = (h - 0.1) * 0.5;
      const ring = cy(g, M_.chrome(), 0, 0, 2 * r, 2 * r, 0, 0.03);
      ring.rotation.x = Math.PI / 2; ring.position.set(0, yc, d / 2 + 0.015);
      const win = cy(g, M_.darkGlass(), 0, 0, 1.6 * r, 1.6 * r, 0, 0.034);
      win.rotation.x = Math.PI / 2; win.position.set(0, yc, d / 2 + 0.017);
    },
    cylinder(g, o, col) {
      cy(g, mat(col, { roughness: 0.4 }), 0, 0, o.w, o.d, 0, o.h);
      cy(g, mat(shade(col, 0.8), { roughness: 0.4 }), 0, 0, o.w * 0.9, o.d * 0.9, o.h, o.h + 0.02);
      for (const x of [-0.1, 0.1]) cy(g, mat('#c07a45', { roughness: 0.35, metalness: 0.2 }), x * Math.min(1, o.w / 0.4), 0, 0.03, 0.03, o.h, o.h + 0.2, true);
    },
    sofa(g, o, col) {
      const { w, d, h } = o;
      const arm = Math.min(0.2, w * 0.12), back = Math.min(0.22, d * 0.26);
      const seat = Math.min(0.45, h * 0.55);
      const base = mat(shade(col, 0.82), { roughness: 0.95 }), cush = mat(col, { roughness: 0.95 });
      bx(g, base, -w / 2, w / 2, 0.06, seat - 0.12, -d / 2, d / 2);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(g, M_.wood(), sx * (w / 2 - 0.07) - 0.02, sx * (w / 2 - 0.07) + 0.02, 0, 0.06, sz * (d / 2 - 0.07) - 0.02, sz * (d / 2 - 0.07) + 0.02);
      bx(g, base, -w / 2, w / 2, 0.06, h, -d / 2, -d / 2 + back);
      bx(g, base, -w / 2, -w / 2 + arm, 0.06, seat + 0.18, -d / 2, d / 2);
      bx(g, base, w / 2 - arm, w / 2, 0.06, seat + 0.18, -d / 2, d / 2);
      const inner = w - 2 * arm, n = Math.max(1, Math.round(inner / 0.75));
      for (let i = 0; i < n; i++) {
        const x0 = -w / 2 + arm + inner * i / n;
        bx(g, cush, x0 + 0.01, x0 + inner / n - 0.01, seat - 0.12, seat, -d / 2 + back, d / 2 - 0.01);
        bx(g, cush, x0 + 0.02, x0 + inner / n - 0.02, seat, h - 0.04, -d / 2 + back, -d / 2 + back + 0.14);
      }
    },
    sectional(g, o, col) {
      const { w, d, h } = o;
      const a = Math.min(0.9, d * 0.6, w * 0.5), back = 0.22, arm = 0.2;
      const seat = Math.min(0.45, h * 0.55);
      const base = mat(shade(col, 0.82), { roughness: 0.95 }), cush = mat(col, { roughness: 0.95 });
      const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2;
      bx(g, base, X0, X1 - arm, 0.04, seat - 0.12, Z0, Z0 + a);
      bx(g, base, X0, X0 + a, 0.04, seat - 0.12, Z0 + a, Z1);
      bx(g, base, X0, X1, 0.04, h, Z0, Z0 + back);
      bx(g, base, X0, X0 + back, 0.04, h, Z0 + back, Z1);
      bx(g, base, X1 - arm, X1, 0.04, seat + 0.18, Z0, Z0 + a);
      bx(g, M_.dark(), X0 + 0.03, X1 - 0.03, 0, 0.04, Z0 + 0.03, Z0 + a - 0.03);
      bx(g, M_.dark(), X0 + 0.03, X0 + a - 0.03, 0, 0.04, Z0 + a, Z1 - 0.03);
      const run = X1 - arm - (X0 + a), n = Math.max(1, Math.round(run / 0.75));
      for (let i = 0; i < n; i++) {
        const x0 = X0 + a + run * i / n;
        bx(g, cush, x0 + 0.01, x0 + run / n - 0.01, seat - 0.12, seat, Z0 + back, Z0 + a - 0.01);
      }
      bx(g, cush, X0 + back, X0 + a - 0.01, seat - 0.12, seat, Z0 + back, Z0 + a - 0.01);
      bx(g, cush, X0 + back, X0 + a - 0.01, seat - 0.12, seat, Z0 + a + 0.01, Z1 - 0.01);
    },
    bed(g, o, col) {
      const { w, d, h } = o;
      const frameH = h * 0.45;
      const wood = M_.wood();
      bx(g, wood, -w / 2, w / 2, 0.05, frameH, -d / 2, d / 2);
      bx(g, wood, -w / 2, w / 2, 0, h + 0.45, -d / 2, -d / 2 + 0.07);
      bx(g, mat('#f4f2ee', { roughness: 0.9 }), -w / 2 + 0.03, w / 2 - 0.03, frameH, h, -d / 2 + 0.07, d / 2 - 0.03);
      const n = w > 1.3 ? 2 : 1;
      const pw = w / n - 0.14;
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + w * (i + 0.5) / n;
        sph(g, mat('#ffffff', { roughness: 0.95 }), cx, h + 0.05, -d / 2 + 0.07 + 0.26, pw, 0.14, 0.4);
      }
      const dz = -d / 2 + 0.07 + 0.58;
      bx(g, mat(col, { roughness: 0.95 }), -w / 2 - 0.015, w / 2 + 0.015, h - 0.2, h + 0.035, dz, d / 2 + 0.01);
      bx(g, mat(shade(col, 0.85), { roughness: 0.95 }), -w / 2 - 0.02, w / 2 + 0.02, h - 0.19, h + 0.045, d / 2 - 0.5, d / 2 - 0.25);
    },
    table(g, o, col) {
      const { w, d, h } = o;
      bx(g, mat(col, { roughness: 0.55 }), -w / 2, w / 2, h - 0.04, h, -d / 2, d / 2);
      const legs = mat(shade(col, 0.75), { roughness: 0.6 });
      const L = 0.05, ix = w / 2 - 0.05, iz = d / 2 - 0.05;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(g, legs, sx * ix - L / 2, sx * ix + L / 2, 0, h - 0.04, sz * iz - L / 2, sz * iz + L / 2);
    },
    roundTable(g, o, col) {
      const { w, d, h } = o;
      cy(g, mat(col, { roughness: 0.55 }), 0, 0, w, d, h - 0.04, h);
      cy(g, mat(shade(col, 0.75)), 0, 0, 0.1, 0.1, 0.03, h - 0.04, true);
      cy(g, mat(shade(col, 0.75)), 0, 0, Math.min(w, d) * 0.5, Math.min(w, d) * 0.5, 0, 0.03);
    },
    chair(g, o, col) {
      const { w, d, h } = o;
      const seat = Math.min(0.46, h * 0.52);
      const m = mat(col, { roughness: 0.6 }), legs = mat(shade(col, 0.8), { roughness: 0.6 });
      const z0 = -d / 2 + 0.02;
      bx(g, m, -w / 2, w / 2, seat - 0.05, seat, z0, d / 2);
      const L = 0.035;
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.035);
        bx(g, legs, x - L / 2, x + L / 2, 0, seat - 0.05, d / 2 - 0.05 - L / 2, d / 2 - 0.05 + L / 2);
        bx(g, legs, x - L / 2, x + L / 2, 0, h, z0, z0 + L);
      }
      bx(g, m, -w / 2 + 0.02, w / 2 - 0.02, h - 0.24, h - 0.02, z0, z0 + 0.03);
    },
    stairs(g, o, col, ctx) {
      const { w, d, h } = o;
      const n = Math.max(2, Math.round(o.steps || ctx.spec.steps || 13));
      const m = mat(col, { roughness: 0.7 }), nose = mat(shade(col, 0.88), { roughness: 0.7 });
      for (let i = 0; i < n; i++) {
        const z1 = d / 2 - d * i / n, z0 = d / 2 - d * (i + 1) / n;
        const y1 = h * (i + 1) / n;
        bx(g, m, -w / 2, w / 2, 0, y1 - 0.025, z0, z1);
        bx(g, nose, -w / 2, w / 2, y1 - 0.025, y1, z0, z1 + 0.02);
      }
    },
  };

  // ---------------------------------------------------------------- scene build
  function disposeContent() {
    content.traverse((o) => {
      if (o.geometry && !o.geometry.userData.persistent) o.geometry.dispose();
    });
    for (const m of matCache.values()) m.dispose();
    matCache = new Map();
    clearSelectionVisuals();
    content.clear();
    wallGroups.clear(); objGroups.clear(); openGroups.clear();
    floorMeshes = [];
    for (const it of labelItems) it.el.remove();
    labelItems = [];
  }

  function rebuild() {
    sceneDirty = false;
    built = true;
    disposeContent();
    const plan = store.plan;
    gWalls = new THREE.Group(); gFloors = new THREE.Group(); gObjects = new THREE.Group(); gVirtual = new THREE.Group();
    content.add(gFloors, gWalls, gVirtual, gObjects);

    // Bounds (walls + objects)
    const pts = [...Object.values(plan.nodes)];
    for (const o of plan.objects) pts.push(...G.rectCorners(o.x, o.y, o.w, o.d, o.rot || 0));
    if (pts.length) {
      const b = G.bounds(pts);
      bounds = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, w: Math.max(1, b.maxX - b.minX), h: Math.max(1, b.maxY - b.minY) };
    } else bounds = { minX: 0, minY: 0, maxX: 6, maxY: 6, w: 6, h: 6 };

    buildFloors(plan);
    buildWalls(plan);
    buildObjects(plan);
    gObjects.visible = store.settings.showFurniture !== false;
    fitLights();
    applySelection();
    updateLabelVisibility();
    requestRender();
  }

  function buildFloors(plan) {
    const tex = floorTextures(renderer);
    const faces = M.computeRooms(plan);
    faces.forEach((f, i) => {
      const shape = new THREE.Shape();
      f.pts.forEach((p, k) => (k ? shape.lineTo(p.x, -p.y) : shape.moveTo(p.x, -p.y)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const name = f.room?.name || '';
      const wet = WET_ROOM.test(name);
      const custom = typeof f.room?.floor === 'string' && /^#|^rgb/.test(f.room.floor) ? f.room.floor : null;
      const key = `floor${wet ? 't' : 'w'}${i % FLOOR_TINTS.length}${custom || ''}`;
      let m = matCache.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ map: wet ? tex.tile : tex.wood, color: custom || FLOOR_TINTS[i % FLOOR_TINTS.length], roughness: wet ? 0.45 : 0.7 });
        matCache.set(key, m);
      }
      const mesh = new THREE.Mesh(geo, m);
      mesh.receiveShadow = true;
      mesh.userData.floor = true;
      mesh.userData.pick = f.room ? { kind: 'room', id: f.room.id } : null;
      gFloors.add(mesh);
      floorMeshes.push(mesh);
      if (name) {
        const el = document.createElement('div');
        el.className = 'v3d-label';
        el.innerHTML = `<b></b><span></span>`;
        el.firstChild.textContent = name;
        el.lastChild.textContent = fmtArea(f.area);
        labelsEl.appendChild(el);
        labelItems.push({ el, pos: new THREE.Vector3(f.label.x, 0.05, f.label.y) });
      }
    });
  }

  function wallDisplayHeight(w) {
    const H = w.height || store.plan.wallHeight || 2.44;
    return cutActive() ? Math.min(H, CUT_H) : H;
  }
  const cutActive = () => view.cut && view.mode !== 'walk';

  /** Extension at node nid for wall w so corners close. */
  function endExtension(plan, w, nid) {
    const d = M.wallDir(plan, w);
    let ext = 0;
    for (const o of M.wallsAtNode(plan, nid)) {
      if (o === w || o.kind === 'virtual') continue;
      const od = M.wallDir(plan, o);
      if (Math.abs(G.cross(d, od)) < 0.3) return 0; // collinear continuation closes it
      ext = Math.max(ext, o.thickness / 2);
    }
    return ext;
  }

  function buildWalls(plan) {
    walkSegs = [];
    const cut = cutActive();
    const sideM = M_.wall(), capM = cut ? M_.wallCap() : sideM;
    const mats = [sideM, sideM, capM, sideM, sideM, sideM];
    for (const w of plan.walls) {
      const [a, b] = M.wallEnds(plan, w);
      const L = M.wallLength(plan, w);
      if (L < 1e-3) continue;
      const dir = M.wallDir(plan, w);
      if (w.kind === 'virtual') {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, 0.012, a.y), new THREE.Vector3(b.x, 0.012, b.y)]);
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: theme.virtual, dashSize: 0.18, gapSize: 0.1 }));
        matCache.set('virt' + w.id, line.material);
        line.computeLineDistances();
        line.userData.pick = { kind: 'wall', id: w.id };
        gVirtual.add(line);
        continue;
      }
      const T = w.thickness || 0.15;
      const H = wallDisplayHeight(w);
      const fullH = w.height || plan.wallHeight || 2.44;
      const e0 = endExtension(plan, w, w.a), e1 = endExtension(plan, w, w.b);
      const grp = new THREE.Group();
      grp.position.set(a.x, 0, a.y);
      grp.rotation.y = -Math.atan2(dir.y, dir.x);
      grp.userData.pick = { kind: 'wall', id: w.id };
      grp.userData.box = { x0: -e0, x1: L + e1, y0: 0, y1: H, z0: -T / 2, z1: T / 2 };
      const piece = (s0, s1, y0, y1) => {
        y1 = Math.min(y1, H);
        if (y1 - y0 < 0.004 || s1 - s0 < 0.002) return;
        const m = new THREE.Mesh(UNIT.box, mats);
        m.scale.set(s1 - s0, y1 - y0, T);
        m.position.set((s0 + s1) / 2, (y0 + y1) / 2, 0);
        m.castShadow = m.receiveShadow = true;
        m.userData.wallMesh = true;
        grp.add(m);
      };
      const passes = [];
      for (const seg of M.wallChain(plan, w)) {
        const s0 = seg.from === 0 ? -e0 : seg.from;
        const s1 = Math.abs(seg.to - L) < 1e-6 ? L + e1 : seg.to;
        if (seg.kind === 'wall') { piece(s0, s1, 0, H); continue; }
        const o = plan.openings.find((x) => x.id === seg.openingId);
        if (!o) { piece(s0, s1, 0, H); continue; }
        const oh = Math.min(o.height, fullH);
        if (o.type === 'window') {
          const sill = Math.min(o.sill || 0, fullH);
          piece(s0, s1, 0, sill);
          piece(s0, s1, sill + oh, H);
        } else {
          piece(s0, s1, oh, H);
          if (oh > 1.7) passes.push([seg.from, seg.to]);
        }
        buildOpening(grp, o, seg.from, seg.to, T, H, fullH);
      }
      gWalls.add(grp);
      wallGroups.set(w.id, grp);
      walkSegs.push({ a, b, L, dir, T, passes });
    }
  }

  function buildOpening(wg, o, s0, s1, T, H, fullH) {
    const g = new THREE.Group();
    g.userData.pick = { kind: 'opening', id: o.id };
    const width = s1 - s0;
    const frame = M_.frame();
    if (o.type === 'window') {
      const sill = Math.min(o.sill || 0, fullH), top = Math.min(sill + o.height, fullH);
      g.userData.box = { x0: s0, x1: s1, y0: sill, y1: Math.min(top, H), z0: -T / 2 - 0.03, z1: T / 2 + 0.03 };
      if (sill >= H - 0.01) return; // entirely above the cut
      const vis = Math.min(top, H);
      const fw = 0.05, fd = Math.min(T * 0.6, 0.09);
      bx(g, mat('#f6f6f4', { roughness: 0.5 }), s0 - 0.03, s1 + 0.03, sill, sill + 0.025, -T / 2 - 0.03, T / 2 + 0.03);
      bx(g, frame, s0, s0 + fw, sill, vis, -fd / 2, fd / 2);
      bx(g, frame, s1 - fw, s1, sill, vis, -fd / 2, fd / 2);
      bx(g, frame, s0, s1, sill, sill + fw, -fd / 2, fd / 2);
      if (top <= H + 1e-6) bx(g, frame, s0, s1, top - fw, top, -fd / 2, fd / 2);
      if (width > 1.0 && vis - sill > 0.3) bx(g, frame, (s0 + s1) / 2 - 0.02, (s0 + s1) / 2 + 0.02, sill, vis, -fd / 2 + 0.01, fd / 2 - 0.01);
      const gl = bx(g, M_.glass(), s0 + fw, s1 - fw, sill + fw, top <= H + 1e-6 ? top - fw : vis, -0.006, 0.006);
      gl.castShadow = false;
    } else {
      const oh = Math.min(o.height, fullH);
      const leafH = Math.min(oh - 0.01, H);
      g.userData.box = { x0: s0, x1: s1, y0: 0, y1: Math.min(oh, H), z0: -T / 2 - 0.03, z1: T / 2 + 0.03 };
      // Jamb lining
      const j = 0.025;
      bx(g, frame, s0, s0 + j, 0, Math.min(oh, H), -T / 2 - 0.01, T / 2 + 0.01);
      bx(g, frame, s1 - j, s1, 0, Math.min(oh, H), -T / 2 - 0.01, T / 2 + 0.01);
      if (oh <= H) bx(g, frame, s0, s1, oh - j, oh, -T / 2 - 0.01, T / 2 + 0.01);
      if (o.type === 'opening') { wg.add(g); openGroups.set(o.id, g); return; }
      const leafM = M_.leaf(), lt = 0.04;
      const sw = (o.swing || 1) >= 0 ? 1 : -1;
      const clear0 = s0 + j, clear1 = s1 - j, cw = clear1 - clear0;
      const swingLeaf = (hingeS, dirSign, lw) => {
        const ang = 70 * DEG;
        const ox = Math.cos(ang) * dirSign, oz = Math.sin(ang) * sw;
        const hz = sw * (T / 2);
        const m = mesh(UNIT.box, leafM);
        m.scale.set(lw, leafH, lt);
        m.position.set(hingeS + ox * lw / 2 - oz * 0 , leafH / 2 + 0.005, hz + oz * lw / 2);
        m.rotation.y = -Math.atan2(oz, ox);
        g.add(m);
        const hx = hingeS + ox * (lw - 0.07), hzz = hz + oz * (lw - 0.07);
        const kn = sph(g, M_.chrome(), hx, 1.0, hzz, 0.05, 0.05, 0.05);
        if (1.0 > leafH) kn.visible = false;
      };
      if (o.type === 'door') {
        const atA = (o.hinge || 'a') === 'a';
        swingLeaf(atA ? clear0 : clear1, atA ? 1 : -1, cw);
      } else if (o.type === 'double') {
        swingLeaf(clear0, 1, cw / 2);
        swingLeaf(clear1, -1, cw / 2);
      } else if (o.type === 'sliding') {
        const pw = cw / 2 + 0.03;
        const pm = mat('#dfe6ea', { roughness: 0.3 });
        bx(g, pm, clear0, clear0 + pw, 0.005, leafH, -0.035, -0.005);
        bx(g, pm, clear0 + cw * 0.12, clear0 + cw * 0.12 + pw, 0.005, leafH, 0.005, 0.035);
        const gm = M_.glass();
        bx(g, gm, clear0 + 0.06, clear0 + pw - 0.06, 0.15, leafH - 0.08, -0.04, 0).castShadow = false;
      } else if (o.type === 'pocket') {
        const atA = (o.hinge || 'a') === 'a';
        const slid = cw * 0.55;
        const x0 = atA ? clear0 - slid : clear0 + slid;
        bx(g, leafM, x0, x0 + cw, 0.005, leafH, -lt / 2, lt / 2);
      }
    }
    wg.add(g);
    openGroups.set(o.id, g);
  }

  function buildObjects(plan) {
    for (const o of plan.objects) {
      const spec = CATALOG[o.type] || CATALOG.box;
      const col = spec.color || '#c9ced3';
      const g = new THREE.Group();
      g.position.set(o.x, o.elev || 0, o.y);
      g.rotation.y = -(o.rot || 0) * DEG;
      g.userData.pick = { kind: 'object', id: o.id };
      const ob = { ...o, w: Math.max(0.02, o.w || spec.w), d: Math.max(0.02, o.d || spec.d), h: Math.max(0.02, o.h || spec.h) };
      g.userData.box = { x0: -ob.w / 2, x1: ob.w / 2, y0: 0, y1: ob.h, z0: -ob.d / 2, z1: ob.d / 2 };
      const fn = BUILD[spec.shape3d] || BUILD.box;
      const ctx = { spec, get against() { return this._a || (this._a = sidesAgainstWalls(ob)); } };
      try { fn(g, ob, col, ctx); } catch (e) { console.error('view3d: object build failed', o.type, e); BUILD.box(g, ob, col); }
      gObjects.add(g);
      objGroups.set(o.id, g);
    }
  }

  function fitLights() {
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minY + bounds.maxY) / 2;
    const R = Math.hypot(bounds.w, bounds.h) / 2 + 1;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx - R * 0.55, R * 1.5, cz + R * 0.8);
    const sc = sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
    sc.near = 0.1; sc.far = R * 5;
    sc.updateProjectionMatrix();
    ground.scale.set(R * 6, R * 6, 1);
    ground.position.set(cx, -0.004, cz);
  }

  // ---------------------------------------------------------------- selection
  let selVisuals = [];   // { outline, restore: [[mesh, mat]] }
  function clearSelectionVisuals() {
    for (const v of selVisuals) {
      v.outline?.parent?.remove(v.outline);
      v.outline?.material.dispose();
      for (const [m, orig] of v.restore) { if (m.material !== orig) { if (!Array.isArray(m.material)) m.material.dispose(); m.material = orig; } }
    }
    selVisuals = [];
  }
  function outlineFor(group) {
    const b = group.userData.box;
    if (!b) return null;
    const pad = 0.02;
    const ln = new THREE.LineSegments(EDGE_BOX, new THREE.LineBasicMaterial({ color: theme.sel, depthTest: false, transparent: true, opacity: 0.95 }));
    ln.scale.set(b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad, b.z1 - b.z0 + 2 * pad);
    ln.position.set((b.x0 + b.x1) / 2, b.y0 - pad, (b.z0 + b.z1) / 2);
    ln.renderOrder = 999;
    ln.raycast = () => {};
    return ln;
  }
  function applySelection() {
    clearSelectionVisuals();
    const s = store.selection;
    if (!s || !built) { requestRender(); return; }
    const grp = s.kind === 'wall' ? wallGroups.get(s.id) : s.kind === 'object' ? objGroups.get(s.id) : s.kind === 'opening' ? openGroups.get(s.id) : null;
    if (!grp) { requestRender(); return; }
    const v = { outline: outlineFor(grp), restore: [] };
    if (v.outline) grp.add(v.outline);
    const selColor = new THREE.Color().setStyle(theme.sel);
    grp.traverse((m) => {
      if (!m.isMesh || m === v.outline) return;
      if (s.kind === 'wall' && !m.userData.wallMesh) return;
      const orig = m.material;
      if (Array.isArray(orig)) {
        const sm = M_.wallSel();
        m.material = orig.map((x) => (x === M_.wall() ? sm : x));
        v.restore.push([m, orig]);
        return;
      }
      const c = orig.clone();
      c.emissive = selColor.clone();
      c.emissiveIntensity = 0.3;
      m.material = c;
      v.restore.push([m, orig]);
    });
    selVisuals.push(v);
    requestRender();
  }
  // Array materials of walls are shared from matCache: restoring must not dispose them.
  // (clearSelectionVisuals only disposes non-array replacement materials.)

  // ---------------------------------------------------------------- labels
  const _v = new THREE.Vector3();
  function updateLabels() {
    if (!labelItems.length) return;
    const show = view.labels && view.mode !== 'walk';
    labelsEl.hidden = !show;
    if (!show) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const it of labelItems) {
      _v.copy(it.pos).project(camera);
      if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) { it.el.style.display = 'none'; continue; }
      it.el.style.display = '';
      it.el.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _v.y) / 2 * h).toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
  function updateLabelVisibility() { labelsEl.hidden = !(view.labels && view.mode !== 'walk'); }

  // ---------------------------------------------------------------- cameras
  function viewSize() { return { w: Math.max(1, canvas.clientWidth || container.clientWidth), h: Math.max(1, canvas.clientHeight || container.clientHeight) }; }

  function frameAll() {
    const { w, h } = viewSize();
    const aspect = w / h;
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minY + bounds.maxY) / 2;
    // Orbit: bounding sphere of the plan footprint.
    const R = Math.hypot(bounds.w, bounds.h) / 2 + 0.3;
    const vf = persp.fov * DEG / 2;
    const hf = Math.atan(Math.tan(vf) * aspect);
    orbit.target.set(cx, 0, cz);
    orbit.theta = 0.35; orbit.phi = 0.9;
    orbit.radius = R / Math.sin(Math.min(vf, hf)) * 0.92;
    // Refine: scale the distance until the projected bounding box fills ~88% of the free area.
    const H = cutActive() ? CUT_H : (store.plan.wallHeight || 2.44);
    const corners = [];
    for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minY, bounds.maxY]) for (const y of [0, H]) corners.push(new THREE.Vector3(x, y, z));
    const padFrac = Math.min(64, h * 0.2) / h;   // toolbar band, as a fraction of the height
    const saved = view.mode;
    view.mode = 'orbit';
    for (let i = 0; i < 6; i++) {
      applyCamera();
      persp.updateMatrixWorld();
      let mx = 0, myTop = 0, myBot = 0;
      for (const c of corners) {
        _v.copy(c).project(persp);
        mx = Math.max(mx, Math.abs(_v.x));
        myTop = Math.max(myTop, _v.y); myBot = Math.max(myBot, -_v.y);
      }
      const need = Math.max(mx / 0.9, myTop / (0.9 - 2 * padFrac), myBot / 0.9);
      if (Math.abs(need - 1) < 0.02) break;
      orbit.radius *= 1 + (need - 1) * 0.9;
    }
    view.mode = saved;
    // Top: fit rect (x = plan w, screen-y = plan h)
    // Top: fit the plan into the area below the toolbar.
    const pad = Math.min(64, h * 0.2), effH = h - pad;
    const fitHalf = Math.max(bounds.h / 2, bounds.w / 2 / (w / effH)) * 1.06 + 0.25;
    const halfH = fitHalf * h / effH;
    topv.target.set(cx, 0, cz - (pad / 2) * (2 * halfH / h));
    topv.radius = halfH / Math.tan(vf);
    framed = true;
  }

  function clampTarget(tg) {
    const m = Math.max(bounds.w, bounds.h);
    tg.x = G.clamp(tg.x, bounds.minX - m, bounds.maxX + m);
    tg.z = G.clamp(tg.z, bounds.minY - m, bounds.maxY + m);
    tg.y = 0;
  }
  const maxRadius = () => Math.max(bounds.w, bounds.h) * 5 + 10;

  function applyCamera() {
    const { w, h } = viewSize();
    const aspect = w / h;
    if (view.mode === 'top') {
      camera = ortho;
      const halfH = topv.radius * Math.tan(persp.fov * DEG / 2);
      ortho.left = -halfH * aspect; ortho.right = halfH * aspect; ortho.top = halfH; ortho.bottom = -halfH;
      ortho.position.set(topv.target.x, 100, topv.target.z);
      ortho.up.set(0, 0, -1);
      ortho.lookAt(topv.target.x, 0, topv.target.z);
      ortho.updateProjectionMatrix();
    } else if (view.mode === 'walk') {
      camera = persp;
      persp.fov = 70; persp.aspect = aspect; persp.near = 0.05; persp.far = 300;
      persp.position.copy(walk.pos);
      persp.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
      persp.updateProjectionMatrix();
    } else {
      camera = persp;
      persp.fov = 50; persp.aspect = aspect;
      persp.near = Math.max(0.05, orbit.radius * 0.01); persp.far = orbit.radius * 10 + 100;
      const { theta, phi, radius, target } = orbit;
      persp.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
      persp.up.set(0, 1, 0);
      persp.lookAt(target);
      persp.updateProjectionMatrix();
    }
    requestRender();
  }

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function ndc(cx, cy) {
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  }
  function groundHit(cx, cy) {
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc(cx, cy), camera);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, p)) return null;
    if (view.mode === 'orbit' && p.distanceTo(orbit.target) > Math.max(bounds.w, bounds.h) * 4) return null;
    return p;
  }

  function zoomAt(cx, cy, f) {
    if (view.mode === 'walk') return;
    const st = view.mode === 'top' ? topv : orbit;
    const nr = G.clamp(st.radius * f, 0.8, maxRadius());
    f = nr / st.radius;
    const hit = cx == null ? null : groundHit(cx, cy);
    if (hit) { st.target.sub(hit).multiplyScalar(f).add(hit); clampTarget(st.target); }
    st.radius = nr;
    applyCamera();
  }
  function panBy(x0, y0, x1, y1) {
    const st = view.mode === 'top' ? topv : orbit;
    const p0 = groundHit(x0, y0), p1 = groundHit(x1, y1);
    if (p0 && p1) st.target.add(p0.sub(p1));
    else {
      const { h } = viewSize();
      const k = 2 * st.radius * Math.tan(persp.fov * DEG / 2) / h;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
      const fwd = new THREE.Vector3(-Math.sin(orbit.theta), 0, -Math.cos(orbit.theta));
      st.target.addScaledVector(right, -(x1 - x0) * k).addScaledVector(fwd, (y1 - y0) * k);
    }
    clampTarget(st.target);
    applyCamera();
  }
  function rotateBy(dx, dy) {
    orbit.theta -= dx * 0.0085;
    orbit.phi = G.clamp(orbit.phi - dy * 0.0085, 0.08, 1.48);
    applyCamera();
  }

  // ---------------------------------------------------------------- walk
  function startWalk() {
    const plan = store.plan;
    const faces = M.computeRooms(plan);
    let p = null;
    const tg = { x: orbit.target.x, y: orbit.target.z };
    const inFace = faces.find((f) => G.pointInPolygon(tg, f.pts));
    if (inFace) p = inFace.label;
    else if (faces.length) p = faces.reduce((a, b) => (b.area > a.area ? b : a)).label;
    else p = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    walk.pos.set(p.x, EYE, p.y);
    // Face the farthest open direction (sample 16 headings, pick the longest free run).
    let best = 0, bestYaw = orbit.theta;
    for (let i = 0; i < 16; i++) {
      const yaw = i * Math.PI / 8;
      const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      let d = 0;
      while (d < 15 && !blocked(p.x + dx * d, p.y + dz * d)) d += 0.1;
      if (d > best + 0.05) { best = d; bestYaw = yaw; }
    }
    walk.yaw = bestYaw; walk.pitch = -0.08; walk.goal = null;
  }

  function blocked(x, z) {
    for (const s of walkSegs) {
      const pr = G.projectOnSegment({ x, y: z }, s.a, s.b);
      if (pr.d >= s.T / 2 + BODY_R) continue;
      const at = pr.t * s.L;
      // Doorways (and full-height openings) can be walked through.
      if (s.passes.some(([p0, p1]) => at > p0 + BODY_R * 0.6 && at < p1 - BODY_R * 0.6)) continue;
      return true;
    }
    return false;
  }
  function moveWalk(dx, dz) {
    const p = walk.pos;
    const wasBlocked = blocked(p.x, p.z);
    const ok = (x, z) => wasBlocked || !blocked(x, z);
    if (ok(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return true; }
    if (ok(p.x + dx, p.z)) { p.x += dx; return true; }
    if (ok(p.x, p.z + dz)) { p.z += dz; return true; }
    return false;
  }
  function stepWalk(dt) {
    const k = walk.keys;
    let f = 0, s = 0, turn = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyA')) s -= 1;
    if (k.has('KeyD')) s += 1;
    if (k.has('ArrowLeft') || k.has('KeyQ')) turn += 1;
    if (k.has('ArrowRight') || k.has('KeyE')) turn -= 1;
    f += -walk.joy.y; s += walk.joy.x;
    const speed = WALK_SPEED * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2 : 1);
    let moved = false;
    if (turn) { walk.yaw += turn * 1.6 * dt; moved = true; }
    if (f || s) {
      walk.goal = null;
      const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw);
      const rx = Math.cos(walk.yaw), rz = -Math.sin(walk.yaw);
      const len = Math.max(1, Math.hypot(f, s));
      moveWalk((fx * f + rx * s) / len * speed * dt, (fz * f + rz * s) / len * speed * dt);
      moved = true;
    } else if (walk.goal) {
      const dx = walk.goal.x - walk.pos.x, dz = walk.goal.z - walk.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.05) walk.goal = null;
      else {
        const want = Math.atan2(-dx, -dz);
        let da = want - walk.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
        walk.yaw += da * Math.min(1, dt * 6);
        const st = Math.min(d, speed * dt);
        if (!moveWalk(dx / d * st, dz / d * st)) walk.goal = null;
      }
      moved = true;
    }
    if (moved) applyCamera();
  }

  // ---------------------------------------------------------------- modes / toolbar
  const bar = root.querySelector('.v3d-bar');
  function setMode(mode) {
    if (mode === view.mode) return;
    const wasCut = cutActive();
    view.mode = mode;
    walk.goal = null; walk.keys.clear(); walk.joy.x = walk.joy.y = 0;
    if (!framed) frameAll();
    if (mode === 'walk') startWalk();
    if (cutActive() !== wasCut) sceneDirty = true;
    root.classList.toggle('is-walk', mode === 'walk');
    updateToolbar();
    updateLabelVisibility();
    applyCamera();
    if (mode === 'walk') canvas.focus({ preventScroll: true });
  }
  function updateToolbar() {
    const labels = { orbit: t('view3dPersp'), top: t('view3dTop'), walk: t('view3dWalk') };
    for (const b of bar.querySelectorAll('[data-mode]')) {
      b.textContent = labels[b.dataset.mode];
      b.setAttribute('aria-pressed', String(b.dataset.mode === view.mode));
    }
    const set = (act, text, pressed) => {
      const b = bar.querySelector(`[data-act="${act}"]`);
      b.querySelector('span').textContent = text;
      b.title = text; b.setAttribute('aria-label', text);
      if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
      return b;
    };
    set('cut', t('wallsCut'), view.cut).disabled = view.mode === 'walk';
    set('labels', tl('labels'), view.labels).disabled = view.mode === 'walk';
    set('reset', t('resetView'));
    hintEl.hidden = view.mode !== 'walk';
    hintEl.textContent = coarse?.matches ? tl('walkHintTouch') : tl('walkHintMouse');
    joyEl.hidden = !(view.mode === 'walk' && coarse?.matches);
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) setMode(b.dataset.mode);
    else if (b.dataset.act === 'cut') { view.cut = !view.cut; sceneDirty = true; updateToolbar(); requestRender(); }
    else if (b.dataset.act === 'labels') { view.labels = !view.labels; updateToolbar(); updateLabelVisibility(); requestRender(); }
    else if (b.dataset.act === 'reset') {
      if (view.mode === 'walk') startWalk(); else frameAll();
      applyCamera();
    }
  });
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ---------------------------------------------------------------- pointer input
  const pointers = new Map();
  let gest = null;   // single-pointer gesture
  let pinch = null;  // two-pointer gesture
  const pinchInfo = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    walk.goal = null;
    if (pointers.size === 1) {
      const panMode = view.mode === 'top' || e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey;
      gest = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, pan: panMode, touch: e.pointerType === 'touch' };
    } else if (pointers.size === 2) {
      pinch = pinchInfo();
      if (gest) gest.moved = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size >= 2 && pinch) {
      const n = pinchInfo();
      if (view.mode === 'walk') {
        const fwd = (n.dist - pinch.dist) * 0.01;
        moveWalk(-Math.sin(walk.yaw) * fwd, -Math.cos(walk.yaw) * fwd);
        walk.yaw += (n.mx - pinch.mx) * 0.004;
        applyCamera();
      } else {
        if (n.dist > 10 && pinch.dist > 10) zoomAt(n.mx, n.my, pinch.dist / n.dist);
        panBy(pinch.mx, pinch.my, n.mx, n.my);
        if (view.mode === 'orbit') {
          let da = n.ang - pinch.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
          orbit.theta -= da;
          orbit.phi = G.clamp(orbit.phi - (n.my - pinch.my) * 0, 0.08, 1.48);
          applyCamera();
        }
      }
      pinch = n;
      return;
    }
    if (!gest) return;
    const dx = e.clientX - px, dy = e.clientY - py;
    if (Math.hypot(e.clientX - gest.x0, e.clientY - gest.y0) > (gest.touch ? 8 : 4)) gest.moved = true;
    if (!gest.moved) return;
    if (view.mode === 'walk') {
      walk.yaw += dx * 0.0045;
      walk.pitch = G.clamp(walk.pitch + dy * 0.0045, -1.3, 1.3);
      applyCamera();
    } else if (gest.pan) panBy(px, py, e.clientX, e.clientY);
    else rotateBy(dx, dy);
  });
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      // Continue as a one-finger gesture from the remaining pointer, without a jump.
      const [q] = pointers.values();
      gest = { x0: q.x, y0: q.y, x: q.x, y: q.y, t0: 0, moved: true, pan: view.mode === 'top', touch: true };
      pinch = null;
      return;
    }
    if (pointers.size === 0) {
      if (gest && !gest.moved && e.type === 'pointerup' && performance.now() - gest.t0 < 700) tap(e.clientX, e.clientY);
      gest = null; pinch = null;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => {
    if (!active) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
    if (view.mode === 'walk') {
      const st = -dy * (e.ctrlKey ? 0.02 : 0.004);
      moveWalk(-Math.sin(walk.yaw) * st, -Math.cos(walk.yaw) * st);
      applyCamera();
      return;
    }
    const f = Math.exp(G.clamp(dy, -200, 200) * (e.ctrlKey ? 0.01 : 0.0015));
    zoomAt(e.clientX, e.clientY, f);
  }, { passive: false });

  function pickTargets() {
    const list = [gWalls, gFloors];
    if (gObjects?.visible) list.push(gObjects);
    if (gVirtual) list.push(gVirtual);
    return list.filter(Boolean);
  }
  function tap(cx, cy) {
    if (!built) return;
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc(cx, cy), camera);
    raycaster.params.Line.threshold = 0.08;
    const hits = raycaster.intersectObjects(pickTargets(), true);
    for (const h of hits) {
      if (h.object.material?.transparent && h.object.material.opacity < 0.5 && !h.object.parent?.userData.pick) continue;
      let o = h.object, pick = null, isFloor = false;
      while (o && o !== content) {
        if (o.userData.floor) isFloor = true;
        if (o.userData.pick !== undefined) { pick = o.userData.pick; break; }
        o = o.parent;
      }
      if (view.mode === 'walk' && isFloor) {
        walk.goal = { x: h.point.x, z: h.point.z };
        requestRender();
        return;
      }
      if (isFloor) { store.select(pick || null); return; }
      if (pick) { store.select(pick); return; }
    }
    if (view.mode !== 'walk') store.select(null);
  }

  // ---------------------------------------------------------------- joystick
  let joyId = null;
  const joyMove = (e) => {
    const r = joyEl.getBoundingClientRect();
    const R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    walk.joy.x = x; walk.joy.y = y;
    knobEl.style.transform = `translate(${x * R * 0.55}px, ${y * R * 0.55}px)`;
  };
  joyEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); joyId = e.pointerId; joyEl.setPointerCapture?.(e.pointerId); joyMove(e); });
  joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
  const joyEnd = (e) => { if (e.pointerId !== joyId) return; joyId = null; walk.joy.x = walk.joy.y = 0; knobEl.style.transform = ''; };
  joyEl.addEventListener('pointerup', joyEnd);
  joyEl.addEventListener('pointercancel', joyEnd);

  // ---------------------------------------------------------------- keyboard
  const typing = (e) => { const el = e.target; return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); };
  const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  window.addEventListener('keydown', (e) => {
    if (!active || view.mode !== 'walk' || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { setMode('orbit'); e.preventDefault(); return; }
    if (WALK_KEYS.has(e.code)) { walk.keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => walk.keys.delete(e.code));
  window.addEventListener('blur', () => walk.keys.clear());

  // ---------------------------------------------------------------- store events
  store.on('change', () => { sceneDirty = true; });
  store.on('select', () => { if (built && !sceneDirty) applySelection(); });
  store.on('settings', () => {
    if (gObjects) gObjects.visible = store.settings.showFurniture !== false;
    updateToolbar();
    sceneDirty = true; // units / language affect labels
  });
  store.on('focus', (f) => {
    if (!active || !f || view.mode === 'walk') return;
    const p = f.kind === 'object' ? store.plan.objects.find((o) => o.id === f.id)
      : f.kind === 'room' ? store.plan.rooms.find((r) => r.id === f.id) : null;
    if (!p) return;
    const st = view.mode === 'top' ? topv : orbit;
    st.target.set(p.x, 0, p.y);
    applyCamera();
  });

  // ---------------------------------------------------------------- loop
  function render() {
    renderer.render(scene, camera);
    updateLabels();
  }
  function frame(now) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    if (sceneDirty) { rebuild(); if (!framed) { frameAll(); } applyCamera(); }
    if (view.mode === 'walk') stepWalk(dt);
    if (needsRender) { needsRender = false; render(); }
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    if (built) applyCamera();
    requestRender();
  }
  new ResizeObserver(() => { if (active) resize(); }).observe(container);

  updateToolbar();
  root.classList.toggle('is-walk', false);

  return {
    activate() {
      if (active) return;
      active = true;
      readTheme();
      resize();
      if (sceneDirty || !built) rebuild();
      if (!framed) frameAll();
      updateToolbar();
      applyCamera();
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    deactivate() {
      active = false;
      cancelAnimationFrame(raf);
      walk.keys.clear(); walk.goal = null; walk.joy.x = walk.joy.y = 0;
      pointers.clear(); gest = null; pinch = null;
    },
    resize,
    // Test hook (not part of the public contract).
    _debug: { orbit, topv, walk, view, setMode, applyCamera },
  };
}
