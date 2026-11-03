import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const graphics = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/utilities/graphics/', import.meta.url));
const result = await build({
  stdin: {
    contents: `
      export { convexHull, hullLoopsFromPolygons } from './hull.ts';
      export { metaballKernel } from './metaballField.ts';
      export { satoNeck, roundRectStamp } from './satoNeck.ts';
      export { vectorStyle, makeVectorField, stampVectorField } from './vectorField.ts';
      export { makeSampleLattice, stampSampleGain, sampleSpacing } from './sampleLattice.ts';
    `,
    resolveDir: graphics,
    sourcefile: 'probe.ts',
    loader: 'ts',
  },
  absWorkingDir: path.dirname(graphics),
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
});
const {
  convexHull, hullLoopsFromPolygons, metaballKernel, satoNeck, roundRectStamp, vectorStyle, makeVectorField, stampVectorField,
  makeSampleLattice, stampSampleGain, sampleSpacing,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);

test('convexHull of a square is the four corners', () => {
  const hull = convexHull([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 },
  ]);
  assert.equal(hull.length, 4);
});

test('tight hull clusters shared-edge polygons without aliasing shapes', () => {
  const square = {
    id: 'a',
    corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  };
  const neighbor = {
    id: 'b',
    corners: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }],
  };
  const loops = hullLoopsFromPolygons([square, neighbor], 'tight');
  assert.equal(loops.length, 1);
  assert.ok(loops[0].points.length >= 4);
});

test('metaballKernel peaks at the blob center', () => {
  const at = metaballKernel(100, 100, 40, 100, 100);
  const off = metaballKernel(100, 100, 40, 200, 100);
  assert.ok(at > off);
});

test('satoNeck refuses contained circles and emits an escaped path', () => {
  assert.equal(satoNeck(40, 40, { x: 0, y: 0 }, { x: 400, y: 0 }, 2.4, 0.5, 2.5), null);
  const n = satoNeck(40, 30, { x: 0, y: 0 }, { x: 90, y: 0 }, 2.4, 0.5, 2.5);
  assert.ok(n);
  assert.equal(n.escaped, true);
  assert.match(n.path, / A 30 30 0 1 0 /);
  const circle = roundRectStamp(10, 20, 40, 1, 1);
  assert.equal(circle.centers.length, 1);
});

test('vectorStyle follows the angle hue wheel', () => {
  assert.equal(vectorStyle(1, 0, false).hue, 180);
  assert.equal(vectorStyle(0, 1, false).hue, 270);
  const field = makeVectorField(4, 3, 400, 300);
  assert.equal(field.length, 12);
  const stamped = stampVectorField(field, {
    columns: 4, rows: 3, x: 40, y: 40, radius: 80, action: 'paint', mode: 'swirl', strength: 1,
  });
  assert.ok(stamped.some((sample) => sample.vx !== 0 || sample.vy !== 0));
});

test('sample lattice uses width/columns spacing and grow stamps hashed jitter in place', () => {
  assert.equal(sampleSpacing(4, 400), 100);
  const points = makeSampleLattice(4, 3, 400, 300, { jitter: 0, seed: 1, radius: 1 });
  assert.equal(points.length, 12);
  assert.equal(points[0].x, 50);
  assert.equal(points[3].x, 350);
  const grown = stampSampleGain(points, {
    columns: 4, rows: 3, width: 400, height: 300, x: points[0].x, y: points[0].y, radius: 50,
    action: 'grow', intensity: 1, falloffType: 'Linear', falloffPower: 1,
    minRadius: 0.2, maxRadius: 14, rotationMode: 'None', rotationJitter: 0,
  });
  assert.ok(grown[0].radius > 1);
});
