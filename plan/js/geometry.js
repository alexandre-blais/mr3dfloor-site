// Pure 2D geometry for MR 3D Floor plans. Plan space is in metres, x → right, y → down.
// No DOM access here so everything can be unit-tested under Node.

export const EPS = 1e-6;

export const v = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a) => { const l = len(a); return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; };
export const perp = (a) => ({ x: -a.y, y: a.x });
export const rot = (p, deg) => {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
export const angleDeg = (a) => Math.atan2(a.y, a.x) * 180 / Math.PI;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Closest point on segment ab to p: { point, t (0..1), d }. */
export function projectOnSegment(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const t = L2 < EPS ? 0 : clamp(dot(sub(p, a), ab) / L2, 0, 1);
  const point = lerp(a, b, t);
  return { point, t, d: dist(p, point) };
}

/** Intersection of segments p1p2 and p3p4, or null. Returns { point, t, u }. */
export function segmentIntersection(p1, p2, p3, p4) {
  const r = sub(p2, p1), s = sub(p4, p3);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / den, u = cross(qp, r) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { point: add(p1, mul(r, t)), t, u };
}

/** Signed polygon area (shoelace). Positive when counter-clockwise in a y-up frame,
 *  i.e. clockwise on screen (y-down). */
export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
export const polygonArea = (pts) => Math.abs(signedArea(pts));

export function polygonPerimeter(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

export function polygonCentroid(pts) {
  const A = signedArea(pts);
  if (Math.abs(A) < EPS) {
    const c = pts.reduce((acc, p) => add(acc, p), v(0, 0));
    return mul(c, 1 / Math.max(1, pts.length));
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A point inside the polygon that is well away from edges (good label anchor).
 *  Uses the centroid when it is inside, otherwise a coarse grid search. */
export function labelPoint(pts) {
  const c = polygonCentroid(pts);
  const edgeDist = (p) => {
    let m = Infinity;
    for (let i = 0; i < pts.length; i++) m = Math.min(m, projectOnSegment(p, pts[i], pts[(i + 1) % pts.length]).d);
    return m;
  };
  const b = bounds(pts);
  let best = pointInPolygon(c, pts) ? c : null, bestD = best ? edgeDist(best) : -1;
  const N = 14;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const p = { x: b.minX + (b.maxX - b.minX) * i / N, y: b.minY + (b.maxY - b.minY) * j / N };
    if (!pointInPolygon(p, pts)) continue;
    const d = edgeDist(p);
    if (d > bestD * 1.6) { best = p; bestD = d; }
  }
  return best || c;
}

export function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Corners of an oriented rectangle centred at (x,y), size w×d, rotated rot degrees. */
export function rectCorners(x, y, w, d, rotDeg) {
  const hw = w / 2, hd = d / 2;
  return [v(-hw, -hd), v(hw, -hd), v(hw, hd), v(-hw, hd)].map((p) => add(rot(p, rotDeg), v(x, y)));
}

/** Is p inside the oriented rect? */
export function pointInRect(p, x, y, w, d, rotDeg) {
  const l = rot(sub(p, v(x, y)), -rotDeg);
  return Math.abs(l.x) <= w / 2 + EPS && Math.abs(l.y) <= d / 2 + EPS;
}

/**
 * Faces of a planar straight-line graph. edges: [{ a, b }] of node ids, nodes: { id: {x,y} }.
 * Returns bounded faces as arrays of node ids (outer faces removed). Assumes edges only meet at
 * nodes (the editor splits walls at T-junctions to keep that true).
 */
export function planarFaces(nodes, edges) {
  const adj = new Map();
  const addHalf = (from, to) => {
    if (from === to || !nodes[from] || !nodes[to]) return;
    if (!adj.has(from)) adj.set(from, []);
    const list = adj.get(from);
    if (!list.includes(to)) list.push(to);
  };
  for (const e of edges) { addHalf(e.a, e.b); addHalf(e.b, e.a); }
  // Sort neighbours by angle around each node.
  for (const [id, list] of adj) {
    const o = nodes[id];
    list.sort((p, q) => Math.atan2(nodes[p].y - o.y, nodes[p].x - o.x) - Math.atan2(nodes[q].y - o.y, nodes[q].x - o.x));
  }
  const used = new Set();
  const faces = [];
  for (const [from, list] of adj) {
    for (const to of list) {
      const key = from + '>' + to;
      if (used.has(key)) continue;
      const face = [];
      let u = from, w = to, guard = 0;
      while (guard++ < 10000) {
        const k = u + '>' + w;
        if (used.has(k)) break;
        used.add(k);
        face.push(u);
        // Next edge: at w, turn to the neighbour immediately clockwise (on screen) from the reverse edge.
        const nb = adj.get(w);
        const i = nb.indexOf(u);
        const next = nb[(i - 1 + nb.length) % nb.length];
        u = w; w = next;
      }
      if (face.length >= 3) faces.push(face);
    }
  }
  // Neighbours are sorted by increasing atan2 and we always take the next edge clockwise, so
  // bounded faces are traversed with positive signed area and the unbounded face with negative.
  return faces
    .map((ids) => ({ ids, area: signedArea(ids.map((id) => nodes[id])) }))
    .filter((f) => f.area > 1e-4)
    .map((f) => f.ids);
}

/** Snap an angle (deg) to the nearest multiple of step when within tolerance. */
export function snapAngle(deg, step = 45, tol = 6) {
  const s = Math.round(deg / step) * step;
  return Math.abs(s - deg) <= tol ? s : deg;
}

/** Round a metric value to a grid step. */
export const snapGrid = (x, step) => (step > 0 ? Math.round(x / step) * step : x);
