import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../NCTGraphite/packages/nctgraphite/src/grid/NCTGraphiteGridGeometry.ts', import.meta.url), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const {
  gridCell, gridCellId, gridCellsInBounds, pointInPolygon, pointToGridCoordinate,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('diamond-split hexes are three rhombs, not a hex alias', () => {
  const spec = { kind: 'hex-flat-diamond', size: 20, origin: { x: 0, y: 0 } };
  const diamonds = [0, 1, 2].map((s) => gridCell(spec, { q: 0, r: 0, s }));
  assert.equal(diamonds[0].corners.length, 4);
  assert.equal(gridCell({ kind: 'hex-flat', size: 20 }, { q: 0, r: 0 }).corners.length, 6);
  assert.notEqual(gridCellId({ q: 0, r: 0, s: 0 }), gridCellId({ q: 0, r: 0 }));
  const center = diamonds[0].corners[3];
  for (const diamond of diamonds) {
    assert.ok(pointInPolygon(center, diamond.corners));
  }
  const hit = pointToGridCoordinate(spec, diamonds[1].center);
  assert.equal(hit.q, 0);
  assert.equal(hit.r, 0);
  assert.equal(hit.s, 1);
});

test('horizontal and vertical triangles are distinct 3-sided cells', () => {
  const horiz = gridCell({ kind: 'tri-horiz', size: 24, origin: { x: 0, y: 0 } }, { q: 0, r: 0, s: 0 });
  const vert = gridCell({ kind: 'tri-vert', size: 24, origin: { x: 0, y: 0 } }, { q: 0, r: 0, s: 0 });
  assert.equal(horiz.corners.length, 3);
  assert.equal(vert.corners.length, 3);
  assert.notEqual(horiz.corners[1].x, vert.corners[1].x);
  const hit = pointToGridCoordinate({ kind: 'tri-horiz', size: 24, origin: { x: 0, y: 0 } }, horiz.center);
  assert.equal(hit.s, 0);
});

test('bounds enumeration emits sub-cells for diamonds and triangles', () => {
  const diamonds = gridCellsInBounds(
    { kind: 'hex-flat-diamond', size: 16, origin: { x: 80, y: 80 } },
    { minX: 40, minY: 40, maxX: 120, maxY: 120 },
  );
  assert.ok(diamonds.every((cell) => cell.corners.length === 4 && cell.s != null));
  const triangles = gridCellsInBounds(
    { kind: 'tri-horiz', size: 20, origin: { x: 0, y: 0 } },
    { minX: 0, minY: 0, maxX: 60, maxY: 60 },
  );
  assert.ok(triangles.length > 0);
  assert.ok(triangles.every((cell) => cell.corners.length === 3));
});
