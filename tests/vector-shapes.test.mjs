import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../unified/vectorShapes.ts', import.meta.url));
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { vectorShapePath } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const make = (mode, vx = 1, vy = 0) => ({ settings: { shapeMode: mode, columns: 4, rows: 4 }, data: { vectors: Array.from({ length: 16 }, (_, i) => ({ x: (i % 4 + .5) * 25, y: (Math.floor(i / 4) + .5) * 25, vx, vy })) } });
test('shape modes contour painted fields and leave empty fields empty', () => {
  for (const mode of ['magnitude', 'strokes', 'streamlines']) {
    assert.match(vectorShapePath(make(mode), 100, 100), /M .* Z/);
    assert.equal(vectorShapePath(make(mode, 0, 0), 100, 100), '');
  }
});
test('direction changes the directional outline', () => {
  for (const mode of ['strokes', 'streamlines']) assert.notEqual(vectorShapePath(make(mode, 1, 0), 100, 100), vectorShapePath(make(mode, 0, 1), 100, 100));
});
