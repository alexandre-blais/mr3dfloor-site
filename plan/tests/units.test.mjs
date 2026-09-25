import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../js/units.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('format metric', () => {
  U.setUnits('metric');
  assert.equal(U.fmtLen(3.524), '3.52 m');
  assert.equal(U.fmtLen(0.45), '45 cm');
  assert.equal(U.fmtArea(67.33), '67.3 m²');
});

test('format imperial', () => {
  assert.equal(U.fmtLen(3.5052, { units: 'imperial' }), `11' 6"`);
  assert.equal(U.fmtLen(0.0254 * 5.5, { units: 'imperial' }), `5 ½"`);
  assert.equal(U.fmtLen(0.3048 * 3, { units: 'imperial' }), `3' 0"`);
});

test('parse lengths', () => {
  near(U.parseLen('3.2', 'metric'), 3.2);
  near(U.parseLen('3,2', 'metric'), 3.2);
  near(U.parseLen('320cm'), 3.2);
  near(U.parseLen('320 mm'), 0.32);
  near(U.parseLen(`10' 6"`), 10 * 0.3048 + 6 * 0.0254);
  near(U.parseLen(`10ft 6in`), 10 * 0.3048 + 6 * 0.0254);
  near(U.parseLen(`126"`), 126 * 0.0254);
  near(U.parseLen(`5 1/2"`), 5.5 * 0.0254);
  near(U.parseLen('10', 'imperial'), 3.048);
  near(U.parseLen('10-6', 'imperial'), 10 * 0.3048 + 6 * 0.0254);
  assert.equal(U.parseLen('abc'), null);
});
