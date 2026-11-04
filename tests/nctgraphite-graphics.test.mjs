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
      export { vectorStyle, makeVectorField, stampVectorField, vectorStampDelta, VECTOR_BRUSH_OPS, vectorBrushOp, constrainVector, applyVectorAttractors } from './vectorField.ts';
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
  convexHull, hullLoopsFromPolygons, metaballKernel, satoNeck, roundRectStamp, vectorStyle, makeVectorField, stampVectorField, vectorStampDelta,
  VECTOR_BRUSH_OPS, vectorBrushOp, constrainVector, applyVectorAttractors,
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

test('seek/swirl opposites negate: inward seek vs outward repel, CCW vs clockwise swirl', () => {
  const seek = vectorStampDelta('seek', 50, 40, 40, 40);
  const repel = vectorStampDelta('repel', 50, 40, 40, 40);
  assert.ok(seek.vx < 0);
  const signed = (value) => value === 0 ? 0 : value;
  assert.equal(signed(repel.vx), signed(-seek.vx));
  assert.equal(signed(repel.vy), signed(-seek.vy));
  const swirl = vectorStampDelta('swirl', 50, 40, 40, 40);
  const reverse = vectorStampDelta('swirl-rev', 50, 40, 40, 40);
  assert.ok(swirl.vy > 0);
  assert.equal(signed(reverse.vx), signed(-swirl.vx));
  assert.equal(signed(reverse.vy), signed(-swirl.vy));
  const picker = VECTOR_BRUSH_OPS.filter((op) => op.picker).map((op) => op.id);
  assert.deepEqual(picker, [
    'seek', 'velocity', 'swirl', 'swirl-rev', 'repel',
    'amplify', 'damp', 'rotate', 'smudge', 'drain', 'turbulence', 'normalize', 'invert',
  ]);
  assert.equal(vectorBrushOp('erase').key, 'e');
  const cleared = stampVectorField(makeVectorField(2, 1, 100, 50).map((sample, index) => (
    index === 0 ? { ...sample, vx: 2, vy: 0 } : sample
  )), {
    columns: 2, rows: 1, x: 25, y: 25, radius: 40, op: 'erase', strength: 1,
  });
  assert.equal(cleared[0].vx, 0);
});

test('edit brushes scale, twist, transport, drain, and pin existing flow', () => {
  const one = (op, sample, extra = {}) => stampVectorField([{ x: 40, y: 40, ...sample }], {
    columns: 1, rows: 1, x: 40, y: 40, radius: 20, op, strength: 1, ...extra,
  })[0];
  const amplified = one('amplify', { vx: 1, vy: 0 });
  assert.equal(amplified.vx, 2);
  assert.equal(amplified.vy, 0);
  assert.equal(one('damp', { vx: 1, vy: 0 }).vx, 0.5);
  assert.equal(one('invert', { vx: 1, vy: 0 }).vx, -1);
  assert.equal(one('normalize', { vx: 2, vy: 0 }).vx, 1);
  const turned = one('rotate', { vx: 1, vy: 0 });
  assert.ok(turned.vy > 0);
  assert.ok(Math.abs(Math.hypot(turned.vx, turned.vy) - 1) < 1e-6);
  const drain = vectorStampDelta('drain', 50, 40, 40, 40);
  assert.ok(drain.vx < 0);
  assert.ok(drain.vy > 0);
  const noisy = one('turbulence', { vx: 0, vy: 0 });
  assert.ok(Math.hypot(noisy.vx, noisy.vy) > 0);
  const field = makeVectorField(2, 1, 100, 40);
  field[0].vx = 2;
  const smudged = stampVectorField(field, {
    columns: 2, rows: 1, x: field[1].x, y: field[1].y, radius: 80,
    op: 'smudge', strength: 1, velocityX: 30, velocityY: 0,
  });
  assert.ok(smudged[1].vx > 0);
  assert.equal(smudged[0].vx, 2);
});

test('angle and length intervals gate stamps, and weight sets stroke thickness', () => {
  const north = constrainVector(2, 0, { angleMin: 90, angleMax: 90 });
  assert.ok(Math.abs(north.vx) < 1e-6);
  assert.ok(Math.abs(north.vy - 2) < 1e-6);
  const inside = constrainVector(1, 1, { angleMin: 0, angleMax: 90 });
  assert.equal(inside.vx, 1);
  assert.equal(inside.vy, 1);
  const capped = constrainVector(4, 0, { lengthMin: 0.5, lengthMax: 1 });
  assert.ok(Math.abs(capped.vx - 1) < 1e-9);
  const lifted = constrainVector(0.2, 0, { lengthMin: 0.5, lengthMax: 3 });
  assert.ok(Math.abs(lifted.vx - 0.5) < 1e-9);
  assert.deepEqual(constrainVector(0, 0, { lengthMin: 1, lengthMax: 3 }), { vx: 0, vy: 0 });
  const wrapped = constrainVector(1, 0, { angleMin: 350, angleMax: 10 });
  assert.ok(wrapped.vx > 0.9);
  assert.equal(constrainVector(-2, 0, { angleMin: 0, angleMax: 360, lengthMax: 3 }).vx, -2);
  const amplified = stampVectorField([{ x: 0, y: 0, vx: 1, vy: 0 }], {
    columns: 1, rows: 1, x: 0, y: 0, radius: 10, op: 'amplify', strength: 1,
    limits: { lengthMax: 1.2 },
  })[0];
  assert.ok(Math.abs(amplified.vx - 1.2) < 1e-6);
  const pulled = applyVectorAttractors(
    [{ x: 10, y: 0, vx: 2, vy: 0 }],
    [{ x: 0, y: 0, r: 40, orbit: false }],
    { lengthMax: 0.5 },
  )[0];
  assert.ok(Math.hypot(pulled.vx, pulled.vy) <= 0.5 + 1e-6);
  assert.equal(vectorStyle(1, 0, false, { weight: 0, minWidth: 4 }).width, 4);
  assert.equal(vectorStyle(1, 0, true, { weight: 0, minWidth: 4 }).width, 1);
  assert.equal(vectorStyle(1, 0, false).width, 2.2);
  const at = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return constrainVector(Math.cos(rad), Math.sin(rad), { angleStep: 15 });
  };
  const heading = (vector) => {
    const deg = (Math.atan2(vector.vy, vector.vx) * 180) / Math.PI;
    return deg < 0 ? deg + 360 : deg;
  };
  assert.ok(Math.abs(heading(at(10)) - 15) < 1e-6);
  assert.ok(heading(at(7)) < 1e-6);
  const gated = constrainVector(Math.cos((37 * Math.PI) / 180), Math.sin((37 * Math.PI) / 180), {
    angleMin: 0, angleMax: 40, angleStep: 15,
  });
  assert.ok(Math.abs(heading(gated) - 30) < 1e-6);
  const free = constrainVector(Math.cos((10 * Math.PI) / 180), Math.sin((10 * Math.PI) / 180), { angleStep: 0 });
  assert.ok(Math.abs(heading(free) - 10) < 1e-6);
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
