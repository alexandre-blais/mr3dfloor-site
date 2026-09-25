import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/geometry.js';
import * as M from '../js/model.js';
import { samplePlan } from '../js/sample.js';

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('planarFaces finds the 4 rooms of the sample', () => {
  const p = samplePlan();
  const rooms = M.computeRooms(p);
  assert.equal(rooms.length, 4);
  const named = rooms.map((r) => r.room?.name).sort();
  assert.deepEqual(named, ['Buanderie', 'Chambre', 'Salle de bain', 'Séjour / Cuisine']);
  const ch = rooms.find((r) => r.room?.name === 'Chambre');
  near(ch.area, 3.9 * 3.7);
  const total = rooms.reduce((s, r) => s + r.area, 0);
  near(total, 6.3 * 10.69 - 2.4 * 3.7 - 0.2 * (10.69 - 8.2), 1e-6);
});

test('planarFaces on a square split in two', () => {
  const nodes = { a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, c: { x: 4, y: 3 }, d: { x: 0, y: 3 }, e: { x: 2, y: 0 }, f: { x: 2, y: 3 } };
  const edges = [['a', 'e'], ['e', 'b'], ['b', 'c'], ['c', 'f'], ['f', 'd'], ['d', 'a'], ['e', 'f']].map(([a, b]) => ({ a, b }));
  const faces = G.planarFaces(nodes, edges);
  assert.equal(faces.length, 2);
  for (const f of faces) near(G.polygonArea(f.map((id) => nodes[id])), 6);
});

test('wall chain covers the whole wall and includes openings', () => {
  const p = samplePlan();
  const w = M.wallById(p, 'w1');
  const chain = M.wallChain(p, w);
  near(chain.reduce((s, c) => s + c.length, 0), 3.9);
  assert.deepEqual(chain.map((c) => c.kind), ['wall', 'window', 'wall']);
  near(chain[0].length, 1.1); near(chain[1].length, 1.6); near(chain[2].length, 1.2);
});

test('inside length subtracts half thickness of butting walls', () => {
  const p = samplePlan();
  near(M.wallInsideLength(p, M.wallById(p, 'w1')), 3.9 - 0.2);
});

test('addWall splits the wall it lands on and makes a new room', () => {
  const p = samplePlan();
  const before = M.computeRooms(p).length;
  // Split the chambre in two with a wall from the top wall to the bottom wall.
  const w = M.addWall(p, { x: 4.0, y: 0 }, { x: 4.0, y: 3.7 });
  assert.ok(w);
  assert.equal(M.computeRooms(p).length, before + 1);
  // The window on w1 (x 3.5–5.1) is split-assigned by its centre (4.3) to the right-hand piece.
  const o1 = p.openings.find((o) => o.id === 'o1');
  const ow = M.wallById(p, o1.wallId);
  assert.notEqual(ow.id, 'w1');
});

test('addWall across a wall splits both', () => {
  const nodes = {};
  const p = M.normalizePlan({ nodes });
  M.addWall(p, { x: 0, y: 1 }, { x: 4, y: 1 });
  M.addWall(p, { x: 2, y: 0 }, { x: 2, y: 2 });
  assert.equal(p.walls.length, 4);
});

test('setWallLength moves the less-connected end', () => {
  const p = M.normalizePlan({});
  const w = M.addWall(p, { x: 0, y: 0 }, { x: 3, y: 0 });
  M.setWallLength(p, w, 4.25);
  near(M.wallLength(p, w), 4.25);
});

test('takeoff totals are sane', () => {
  const t = M.takeoff(samplePlan());
  assert.ok(t.area > 55 && t.area < 60, 'area ' + t.area);
  assert.equal(t.counts.doors, 3);
  assert.equal(t.counts.windows, 6);
  assert.ok(t.baseboard > 30);
  near(t.width, 6.3); near(t.depth, 10.69);
});
