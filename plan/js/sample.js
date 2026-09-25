// Sample floor used on first launch: modelled on the "Floor 2" example scan (6.30 m × 10.69 m).
import { normalizePlan } from './model.js';

export function samplePlan() {
  const nodes = {
    U1: { x: 2.4, y: 0 }, U2: { x: 6.3, y: 0 }, U3: { x: 6.3, y: 3.7 }, U4: { x: 2.4, y: 3.7 },
    M1: { x: 0, y: 3.7 }, R1: { x: 6.3, y: 8.2 }, R2: { x: 6.1, y: 8.2 },
    D1: { x: 0, y: 8.92 }, D3: { x: 3.4, y: 8.92 }, D2: { x: 6.1, y: 8.92 },
    B1: { x: 0, y: 10.69 }, B3: { x: 3.4, y: 10.69 }, B4: { x: 6.1, y: 10.69 },
  };
  const W = (id, a, b, t = 0.15, kind = 'solid') => ({ id, a, b, thickness: t, kind });
  const walls = [
    W('w1', 'U1', 'U2', 0.2), W('w2', 'U2', 'U3', 0.2), W('w3', 'U3', 'R1', 0.2), W('w4', 'R1', 'R2', 0.2),
    W('w5', 'R2', 'D2', 0.2), W('w6', 'D2', 'B4', 0.2), W('w7', 'B4', 'B3', 0.2), W('w8', 'B3', 'B1', 0.2),
    W('w9', 'B1', 'D1', 0.2), W('w10', 'D1', 'M1', 0.2), W('w11', 'M1', 'U4', 0.2), W('w12', 'U4', 'U1', 0.2),
    W('w13', 'U4', 'U3', 0.12), W('w14', 'D1', 'D3', 0.12), W('w15', 'D3', 'D2', 0.12), W('w16', 'D3', 'B3', 0.12),
  ];
  const O = (id, wallId, type, offset, width, extra = {}) => ({ id, wallId, type, offset, width, ...extra });
  const openings = [
    O('o1', 'w1', 'window', 1.1, 1.6, { height: 1.2, sill: 0.9 }),
    O('o2', 'w13', 'door', 0.6, 0.81, { height: 2.03, sill: 0, hinge: 'a', swing: -1 }),
    O('o3', 'w3', 'window', 1.75, 1.2, { height: 1.05, sill: 1.05 }),
    O('o4', 'w10', 'window', 1.6, 1.8, { height: 1.4, sill: 0.6 }),
    O('o5', 'w11', 'window', 0.6, 1.2, { height: 1.2, sill: 0.9 }),
    O('o6', 'w8', 'window', 1.3, 0.6, { height: 0.6, sill: 1.4 }),
    O('o7', 'w7', 'window', 0.6, 0.9, { height: 0.9, sill: 1.1 }),
    O('o8', 'w14', 'door', 1.72, 0.76, { height: 2.03, sill: 0, hinge: 'b', swing: 1 }),
    O('o9', 'w15', 'opening', 0.3, 1.6, { height: 2.03, sill: 0 }),
    O('o10', 'w6', 'door', 0.45, 0.91, { height: 2.03, sill: 0, hinge: 'b', swing: 1 }),
  ];
  const rooms = [
    { id: 'r1', name: 'Chambre', x: 4.1, y: 2.6 },
    { id: 'r2', name: 'Séjour / Cuisine', x: 2.6, y: 7.4 },
    { id: 'r3', name: 'Salle de bain', x: 1.25, y: 9.6 },
    { id: 'r4', name: 'Buanderie', x: 4.6, y: 9.6 },
  ];
  const B = (id, type, x, y, w, d, h, rot = 0, extra = {}) => ({ id, type, x, y, w, d, h, rot, elev: 0, ...extra });
  const objects = [
    // Chambre
    B('b1', 'bedQueen', 5.17, 1.9, 1.52, 2.03, 0.6, 90),
    B('b2', 'nightstand', 5.98, 0.8, 0.5, 0.4, 0.6, 90),
    B('b3', 'nightstand', 5.98, 3.0, 0.5, 0.4, 0.6, 90),
    B('b4', 'closet', 2.81, 1.85, 1.83, 0.61, 2.1, -90),
    // Séjour / cuisine
    B('b5', 'sofa', 0.56, 6.9, 2.13, 0.91, 0.84, -90),
    B('b6', 'coffeeTable', 1.55, 6.9, 1.12, 0.61, 0.43, 90),
    B('b7', 'fridge', 5.8, 4.3, 0.91, 0.8, 1.78, 90),
    B('b8', 'counter', 5.88, 5.4, 1.3, 0.64, 0.91, 90),
    B('b9', 'sinkCounter', 5.88, 6.5, 0.91, 0.64, 0.91, 90),
    B('b10', 'range', 5.87, 7.4, 0.76, 0.66, 0.91, 90),
    B('b11', 'island', 4.3, 6.0, 1.83, 0.91, 0.91, 90),
    B('b12', 'diningTable', 2.5, 5.0, 1.52, 0.91, 0.76, 0),
    B('b13', 'chair', 2.1, 4.35, 0.46, 0.5, 0.9, 180),
    B('b14', 'chair', 2.9, 4.35, 0.46, 0.5, 0.9, 180),
    B('b15', 'chair', 2.1, 5.65, 0.46, 0.5, 0.9, 0),
    B('b16', 'chair', 2.9, 5.65, 0.46, 0.5, 0.9, 0),
    B('b17', 'tvUnit', 3.05, 8.6, 1.6, 0.45, 0.55, 180),
    // Salle de bain
    B('b18', 'bathtub', 0.48, 9.8, 1.52, 0.76, 0.56, -90),
    B('b19', 'toilet', 1.35, 10.235, 0.46, 0.71, 0.78, 180),
    B('b20', 'vanity', 2.05, 10.325, 0.91, 0.53, 0.86, 180),
    B('b21', 'shower', 2.885, 10.105, 0.91, 0.91, 2.0, 180),
    // Buanderie
    B('b22', 'washer', 3.9, 10.23, 0.69, 0.71, 0.97, 180),
    B('b23', 'dryer', 4.62, 10.23, 0.69, 0.71, 0.97, 180),
    B('b24', 'waterHeater', 5.68, 9.25, 0.56, 0.56, 1.52, 0),
  ];
  return normalizePlan({
    version: 1, name: 'Floor 2', wallHeight: 2.44,
    nodes, walls, openings, rooms, objects,
    photos: [
      { id: 'p1', name: 'Séjour', x: 1.2, y: 8.2, dir: -60, fov: 70, src: 'samples/photo-living.jpg', note: 'Vue vers la cuisine', taken: '2026-09-07T14:17:00', marks: [] },
      { id: 'p2', name: 'Salle de bain', x: 2.3, y: 9.12, dir: 150, fov: 70, src: 'samples/photo-bath.jpg', note: 'Douche et vanité', taken: '2026-09-07T14:21:00', marks: [] },
      { id: 'p3', name: 'Chambre', x: 3.2, y: 3.2, dir: -35, fov: 70, src: 'samples/photo-bedroom.jpg', note: '', taken: '2026-09-07T14:25:00', marks: [] },
    ],
    notes: [],
  });
}
