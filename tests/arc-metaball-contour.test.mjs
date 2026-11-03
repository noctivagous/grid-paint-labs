import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELD_MOD = path.join(root, 'lab-sources/Arc+Metaball+Grid+Lab/metaballField.ts');

async function loadField() {
  const { buildSync } = await import('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nct-field-'));
  const probe = path.join(tmp, 'probe.mjs');
  fs.writeFileSync(
    probe,
    `export { fieldAt, gooToThreshold, contourLayersForBlobs, metaballKernel, closedRingToBezierD, perlin2, noisyStampCenters, brushNoisePreset } from ${JSON.stringify(FIELD_MOD)};`
  );
  buildSync({
    entryPoints: [probe],
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@nct/nctgraphite': path.join(root, 'NCTGraphite/packages/nctgraphite/src/index.ts') },
    outfile: path.join(tmp, 'probe.bundle.mjs'),
  });
  return import(path.join(tmp, 'probe.bundle.mjs'));
}

test('metaballKernel peaks at blob center', async () => {
  const { metaballKernel } = await loadField();
  const at = metaballKernel(100, 100, 40, 100, 100);
  const off = metaballKernel(100, 100, 40, 200, 100);
  assert.ok(at > off);
  assert.ok(at > 1000);
});

test('fieldAt subtracts negative blobs', async () => {
  const { fieldAt } = await loadField();
  const pos = [{ x: 50, y: 50, r: 30, type: 'positive', colorGroup: 0 }];
  const neg = [{ x: 50, y: 50, r: 10, type: 'negative', colorGroup: 0 }];
  const center = fieldAt(50, 50, pos, []);
  const holed = fieldAt(50, 50, pos, neg);
  assert.ok(holed < center);
});

test('contourLayersForBlobs returns path for two merged circles', async () => {
  const { contourLayersForBlobs } = await loadField();
  const blobs = [
    { id: 1, x: 200, y: 200, r: 50, type: 'positive', colorGroup: 0, color: '#7c5cff' },
    { id: 2, x: 260, y: 200, r: 50, type: 'positive', colorGroup: 0, color: '#7c5cff' },
  ];
  const layers = contourLayersForBlobs(blobs, ['#7c5cff'], 48, 36, 900, 660, 0.5);
  assert.equal(layers.length, 1);
  assert.match(layers[0].pathD, /^M /);
  assert.ok(layers[0].pathD.includes('Z'));
});

test('gooToThreshold increases with tighter goo', async () => {
  const { gooToThreshold } = await loadField();
  assert.ok(gooToThreshold(0.8) > gooToThreshold(0.3));
});

test('closedRingToBezierD emits cubic segments', async () => {
  const { closedRingToBezierD } = await loadField();
  const d = closedRingToBezierD([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]);
  assert.match(d, /^M /);
  assert.match(d, / C /);
  assert.match(d, / Z$/);
});

test('contourLayersForBlobs can emit bezier paths', async () => {
  const { contourLayersForBlobs } = await loadField();
  const blobs = [
    { x: 200, y: 200, r: 50, type: 'positive', colorGroup: 0, color: '#7c5cff' },
  ];
  const poly = contourLayersForBlobs(blobs, ['#7c5cff'], 48, 36, 900, 660, 0.5, false);
  const bez = contourLayersForBlobs(blobs, ['#7c5cff'], 48, 36, 900, 660, 0.5, true);
  assert.ok(poly[0].pathD.includes(' L ') || poly[0].pathD.includes('L'));
  assert.match(bez[0].pathD, / C /);
});

test('perlin2 is deterministic and noisyStampCenters perturbs a circle', async () => {
  const { perlin2, noisyStampCenters, brushNoisePreset } = await loadField();
  assert.equal(perlin2(1.25, 2.5), perlin2(1.25, 2.5));
  const origin = { x: 100, y: 100 };
  const base = [{ x: 100, y: 100, r: 40 }];
  const noisy = noisyStampCenters(origin, 40, 'circle', base, brushNoisePreset('medium'));
  assert.ok(noisy.length > 1);
  const moved = noisy.some((c) => Math.hypot(c.x - origin.x, c.y - origin.y) > 1);
  assert.ok(moved);
});
