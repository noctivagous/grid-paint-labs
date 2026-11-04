import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/utilities/graphics/metaballField.ts', import.meta.url));
const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral' });
const { contourLayersForBlobs, gooToThreshold } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
test('field contour is centered on its sample-aligned blob', () => {
  const width = 800, height = 600, cols = 80, rows = 60;
  const blob = { x: 400, y: 300, r: 60, type: 'positive', colorGroup: 0 };
  const path = contourLayersForBlobs([blob], ['#000'], cols, rows, width, height, 0.8)[0].pathD;
  const coords = [...path.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  const xs = coords.map(c => c[0]), ys = coords.map(c => c[1]);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - blob.x) < 0.001);
  assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - blob.y) < 0.001);
  const measured = (Math.max(...xs) - Math.min(...xs)) / 2;
  assert.ok(Math.abs(measured - blob.r / Math.sqrt(gooToThreshold(0.8))) < 1.5);
});
