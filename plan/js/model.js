// MR 3D Floor plan data model + derived measurements.
//
// Plan document (all lengths in metres, angles in degrees, y axis points down on the plan):
// {
//   version: 1, name, wallHeight,
//   nodes:    { [id]: { x, y } }                         wall end points, shared by connected walls
//   walls:    [{ id, a, b, thickness, kind: 'solid'|'virtual', height? }]
//   openings: [{ id, wallId, type, offset, width, height, sill, hinge: 'a'|'b', swing: 1|-1 }]
//             offset = distance along the wall centreline from node a to the opening's near edge
//             type   = 'door' | 'double' | 'sliding' | 'pocket' | 'window' | 'opening'
//   rooms:    [{ id, name, x, y, floor? }]               a label point; the room is the closed wall face containing it
//   objects:  [{ id, type, x, y, w, d, h, rot, label?, elev? }] centred rectangle, w along local x, d along local y
//   photos:   [{ id, name, x, y, dir, fov, blob?, src?, note, taken, marks: [] }]
//   notes:    [{ id, x, y, text }]
// }

import * as G from './geometry.js';

let seq = 0;
export const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const OPENING_TYPES = ['door', 'double', 'sliding', 'pocket', 'window', 'opening'];
export const isDoorType = (t) => t === 'door' || t === 'double' || t === 'sliding' || t === 'pocket';

export const OPENING_DEFAULTS = {
  door: { width: 0.81, height: 2.03, sill: 0 },
  double: { width: 1.52, height: 2.03, sill: 0 },
  sliding: { width: 1.83, height: 2.03, sill: 0 },
  pocket: { width: 0.76, height: 2.03, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  opening: { width: 0.9, height: 2.03, sill: 0 },
};

export function emptyPlan(name = 'Plan') {
  return { version: 1, name, wallHeight: 2.44, nodes: {}, walls: [], openings: [], rooms: [], objects: [], photos: [], notes: [] };
}

export function normalizePlan(p) {
  const d = emptyPlan(p?.name || 'Plan');
  const out = Object.assign(d, p || {});
  for (const k of ['walls', 'openings', 'rooms', 'objects', 'photos', 'notes']) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.nodes || typeof out.nodes !== 'object') out.nodes = {};
  out.walls = out.walls.filter((w) => out.nodes[w.a] && out.nodes[w.b] && w.a !== w.b);
  for (const w of out.walls) { w.thickness ??= 0.15; w.kind ??= 'solid'; }
  const wallIds = new Set(out.walls.map((w) => w.id));
  out.openings = out.openings.filter((o) => wallIds.has(o.wallId));
  for (const o of out.openings) {
    const def = OPENING_DEFAULTS[o.type] || OPENING_DEFAULTS.door;
    o.width ??= def.width; o.height ??= def.height; o.sill ??= def.sill;
    o.hinge ??= 'a'; o.swing ??= 1; o.offset ??= 0;
  }
  for (const o of out.objects) { o.rot ??= 0; o.h ??= 0.9; o.elev ??= 0; }
  return out;
}

export const clonePlan = (p) => JSON.parse(JSON.stringify(p));

// ---------------------------------------------------------------- lookups

export const wallById = (plan, id) => plan.walls.find((w) => w.id === id);
export const wallEnds = (plan, w) => [plan.nodes[w.a], plan.nodes[w.b]];
export const wallLength = (plan, w) => G.dist(plan.nodes[w.a], plan.nodes[w.b]);
export const wallDir = (plan, w) => G.norm(G.sub(plan.nodes[w.b], plan.nodes[w.a]));
export const wallNormal = (plan, w) => G.perp(wallDir(plan, w));
export const openingsOf = (plan, wallId) => plan.openings.filter((o) => o.wallId === wallId).sort((p, q) => p.offset - q.offset);
export const wallsAtNode = (plan, nodeId) => plan.walls.filter((w) => w.a === nodeId || w.b === nodeId);

/** Opening end points in plan space: { p0 (near node a), p1, center, dir, normal }. */
export function openingGeom(plan, o) {
  const w = wallById(plan, o.wallId);
  const [a] = wallEnds(plan, w);
  const dir = wallDir(plan, w);
  const p0 = G.add(a, G.mul(dir, o.offset));
  const p1 = G.add(a, G.mul(dir, o.offset + o.width));
  return { wall: w, p0, p1, center: G.lerp(p0, p1, 0.5), dir, normal: G.perp(dir) };
}

/** Clamp an opening so it stays on its wall. */
export function clampOpening(plan, o) {
  const w = wallById(plan, o.wallId);
  if (!w) return;
  const L = wallLength(plan, w);
  o.width = G.clamp(o.width, 0.1, Math.max(0.1, L));
  o.offset = G.clamp(o.offset, 0, Math.max(0, L - o.width));
}

// ---------------------------------------------------------------- dimensions

/**
 * Clear (inside-face) length of a wall: centreline length minus half the thickness of the
 * solid walls it butts into at each end. For the orthogonal plans LiDAR usually yields this is
 * the tape-measure number between finished wall faces.
 */
export function wallInsideLength(plan, w) {
  const L = wallLength(plan, w);
  if (w.kind === 'virtual') return L;
  let cut = 0;
  for (const nid of [w.a, w.b]) {
    const others = wallsAtNode(plan, nid).filter((x) => x !== w && x.kind !== 'virtual');
    if (!others.length) continue;
    // Only walls that are roughly perpendicular reduce the clear length.
    const d = wallDir(plan, w);
    const t = Math.max(...others.map((x) => Math.abs(G.cross(d, wallDir(plan, x))) > 0.5 ? x.thickness : 0));
    cut += t / 2;
  }
  return Math.max(0, L - cut);
}

/**
 * Dimension chain along a wall, from node a to node b:
 * [{ from, to, length, kind: 'wall'|'door'|'window'|'opening'|..., openingId? }]
 * Distances are along the centreline (from, to measured from node a).
 */
export function wallChain(plan, w) {
  const L = wallLength(plan, w);
  const ops = openingsOf(plan, w.id);
  const chain = [];
  let cur = 0;
  for (const o of ops) {
    const s = G.clamp(o.offset, 0, L), e = G.clamp(o.offset + o.width, 0, L);
    if (s - cur > 0.005) chain.push({ from: cur, to: s, length: s - cur, kind: 'wall' });
    chain.push({ from: s, to: e, length: e - s, kind: o.type, openingId: o.id });
    cur = Math.max(cur, e);
  }
  if (L - cur > 0.005) chain.push({ from: cur, to: L, length: L - cur, kind: 'wall' });
  return chain;
}

// ---------------------------------------------------------------- rooms

/** Closed faces formed by walls (solid + virtual). Returns [{ ids, pts, area, perimeter, label, room? }] */
export function computeRooms(plan) {
  const faces = G.planarFaces(plan.nodes, plan.walls);
  const out = faces.map((ids) => {
    const pts = ids.map((id) => plan.nodes[id]);
    return { ids, pts, area: G.polygonArea(pts), perimeter: G.polygonPerimeter(pts), label: G.labelPoint(pts), room: null };
  });
  // Assign stored room names: the face that contains the room's anchor point.
  for (const r of plan.rooms) {
    const f = out.find((f) => !f.room && G.pointInPolygon(r, f.pts));
    if (f) f.room = r;
  }
  return out;
}

/** Walls whose centreline lies on the boundary of a face (to compute trim per room). */
function faceWalls(plan, face) {
  const res = [];
  for (let i = 0; i < face.ids.length; i++) {
    const a = face.ids[i], b = face.ids[(i + 1) % face.ids.length];
    const w = plan.walls.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
    if (w) res.push(w);
  }
  return res;
}

/**
 * Trim / quantity take-off per room and for the whole plan.
 * Baseboard = solid wall inside length minus door/opening widths.
 * Door trim = both faces × (2 × height + width); Window trim = perimeter (one face);
 * Opening trim = both faces × (2 × height + width).
 */
export function takeoff(plan) {
  const rooms = computeRooms(plan);
  const perRoom = rooms.map((f) => {
    const walls = faceWalls(plan, f);
    let wallLen = 0, doorW = 0;
    for (const w of walls) {
      if (w.kind === 'virtual') continue;
      wallLen += wallInsideLength(plan, w);
      for (const o of openingsOf(plan, w.id)) if (o.type !== 'window') doorW += o.width;
    }
    const wallArea = walls.filter((w) => w.kind !== 'virtual')
      .reduce((s, w) => s + wallInsideLength(plan, w) * (w.height || plan.wallHeight), 0)
      - walls.flatMap((w) => openingsOf(plan, w.id)).reduce((s, o) => s + o.width * o.height, 0);
    return {
      face: f, name: f.room?.name || '', area: f.area, perimeter: f.perimeter,
      baseboard: Math.max(0, wallLen - doorW), wallArea: Math.max(0, wallArea), volume: f.area * plan.wallHeight,
    };
  });
  let doorTrim = 0, windowTrim = 0, openingTrim = 0;
  for (const o of plan.openings) {
    const w = wallById(plan, o.wallId);
    if (!w || w.kind === 'virtual') continue;
    if (o.type === 'window') windowTrim += 2 * (o.width + o.height);
    else if (o.type === 'opening') openingTrim += 2 * (2 * o.height + o.width);
    else doorTrim += 2 * (2 * o.height + o.width);
  }
  const allPts = Object.values(plan.nodes);
  const b = G.bounds(allPts);
  return {
    rooms: perRoom,
    area: perRoom.reduce((s, r) => s + r.area, 0),
    baseboard: perRoom.reduce((s, r) => s + r.baseboard, 0),
    wallArea: perRoom.reduce((s, r) => s + r.wallArea, 0),
    doorTrim, windowTrim, openingTrim,
    width: b.w, depth: b.h,
    counts: {
      doors: plan.openings.filter((o) => isDoorType(o.type)).length,
      windows: plan.openings.filter((o) => o.type === 'window').length,
      openings: plan.openings.filter((o) => o.type === 'opening').length,
      objects: plan.objects.length,
    },
  };
}

// ---------------------------------------------------------------- edits (mutate in place)

export function addNode(plan, p) {
  const id = uid('n');
  plan.nodes[id] = { x: p.x, y: p.y };
  return id;
}

/** Find a node within tol of p. */
export function nodeNear(plan, p, tol) {
  let best = null, bd = tol;
  for (const [id, n] of Object.entries(plan.nodes)) {
    const d = G.dist(n, p);
    if (d <= bd) { bd = d; best = id; }
  }
  return best;
}

/** Split wall w at distance s (from node a). Openings are redistributed. Returns the new node id. */
export function splitWall(plan, w, s) {
  const L = wallLength(plan, w);
  s = G.clamp(s, 0.01, L - 0.01);
  const a = plan.nodes[w.a];
  const p = G.add(a, G.mul(wallDir(plan, w), s));
  const nid = addNode(plan, p);
  const w2 = { ...w, id: uid('w'), a: nid, b: w.b };
  w.b = nid;
  plan.walls.push(w2);
  for (const o of plan.openings.filter((o) => o.wallId === w.id)) {
    if (o.offset + o.width / 2 > s) { o.wallId = w2.id; o.offset = Math.max(0, o.offset - s); }
  }
  for (const o of plan.openings.filter((o) => o.wallId === w.id || o.wallId === w2.id)) clampOpening(plan, o);
  return nid;
}

/** Returns an existing node at p, or splits a wall passing through p, or creates a free node. */
export function nodeAt(plan, p, tol) {
  const n = nodeNear(plan, p, tol);
  if (n) return n;
  for (const w of plan.walls) {
    const [a, b] = wallEnds(plan, w);
    const pr = G.projectOnSegment(p, a, b);
    if (pr.d <= tol && pr.t > 0.001 && pr.t < 0.999) return splitWall(plan, w, pr.t * G.dist(a, b));
  }
  return addNode(plan, p);
}

export function addWall(plan, p, q, opts = {}) {
  const tol = opts.tol ?? 0.05;
  const a = nodeAt(plan, p, tol);
  const b = nodeAt(plan, q, tol);
  if (a === b) return null;
  if (plan.walls.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return null;
  const w = { id: uid('w'), a, b, thickness: opts.thickness ?? 0.15, kind: opts.kind || 'solid' };
  plan.walls.push(w);
  // Split other walls this new wall crosses so rooms stay closed faces.
  splitCrossings(plan, w);
  return w;
}

function splitCrossings(plan, w) {
  const [a, b] = wallEnds(plan, w);
  const hits = [];
  for (const o of plan.walls) {
    if (o === w || o.a === w.a || o.a === w.b || o.b === w.a || o.b === w.b) continue;
    const [c, d] = wallEnds(plan, o);
    const x = G.segmentIntersection(a, b, c, d);
    if (x && x.t > 0.001 && x.t < 0.999 && x.u > 0.001 && x.u < 0.999) hits.push({ o, x });
  }
  if (!hits.length) return;
  hits.sort((p, q) => p.x.t - q.x.t);
  const nids = hits.map(({ o, x }) => splitWall(plan, o, x.u * wallLength(plan, o)));
  // Split w itself at each crossing node.
  let cur = w;
  for (const nid of nids) {
    const end = cur.b;
    const piece = { ...cur, id: uid('w'), a: nid, b: end };
    cur.b = nid;
    plan.walls.push(piece);
    cur = piece;
  }
}

export function deleteWall(plan, id) {
  plan.walls = plan.walls.filter((w) => w.id !== id);
  plan.openings = plan.openings.filter((o) => o.wallId !== id);
  pruneNodes(plan);
}

/** Remove nodes not used by any wall; merge collinear 2-wall nodes when asked. */
export function pruneNodes(plan) {
  const used = new Set(plan.walls.flatMap((w) => [w.a, w.b]));
  for (const id of Object.keys(plan.nodes)) if (!used.has(id)) delete plan.nodes[id];
}

/** Merge node `from` into node `into` (used when dragging an end point onto another). */
export function mergeNodes(plan, from, into) {
  if (from === into) return;
  for (const w of plan.walls) { if (w.a === from) w.a = into; if (w.b === from) w.b = into; }
  // Drop degenerate / duplicate walls.
  const seen = new Set();
  plan.walls = plan.walls.filter((w) => {
    if (w.a === w.b) return false;
    const k = [w.a, w.b].sort().join('|');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const ids = new Set(plan.walls.map((w) => w.id));
  plan.openings = plan.openings.filter((o) => ids.has(o.wallId));
  delete plan.nodes[from];
}

/** Set a wall's length by moving node b (or a) along the wall direction. Moves the end that
 *  has fewer other connections so rooms deform as little as possible. */
export function setWallLength(plan, w, L, anchor) {
  const [a, b] = wallEnds(plan, w);
  const dir = wallDir(plan, w);
  const moveB = anchor ? anchor === 'a' : wallsAtNode(plan, w.b).length <= wallsAtNode(plan, w.a).length;
  if (moveB) Object.assign(plan.nodes[w.b], G.add(a, G.mul(dir, L)));
  else Object.assign(plan.nodes[w.a], G.sub(b, G.mul(dir, L)));
  for (const o of openingsOf(plan, w.id)) clampOpening(plan, o);
}

export function addOpening(plan, wallId, type, center, width) {
  const w = wallById(plan, wallId);
  const def = OPENING_DEFAULTS[type] || OPENING_DEFAULTS.door;
  const o = { id: uid('o'), wallId, type, width: width ?? def.width, height: def.height, sill: def.sill, hinge: 'a', swing: 1, offset: 0 };
  o.offset = center - o.width / 2;
  clampOpening(plan, o);
  plan.openings.push(o);
  return o;
}

/** Move everything so the plan's bounding box starts at (0,0). */
export function normalizeOrigin(plan) {
  const b = G.bounds(Object.values(plan.nodes));
  const dx = -b.minX, dy = -b.minY;
  if (Math.abs(dx) < EPS2 && Math.abs(dy) < EPS2) return;
  for (const n of Object.values(plan.nodes)) { n.x += dx; n.y += dy; }
  for (const k of ['rooms', 'objects', 'photos', 'notes']) for (const o of plan[k]) { o.x += dx; o.y += dy; }
}
const EPS2 = 1e-9;

/** Bounding box of everything drawable. */
export function planBounds(plan) {
  const pts = [...Object.values(plan.nodes)];
  for (const o of plan.objects) pts.push(...G.rectCorners(o.x, o.y, o.w, o.d, o.rot));
  for (const p of plan.photos) pts.push(p);
  for (const n of plan.notes) pts.push(n);
  return G.bounds(pts);
}
