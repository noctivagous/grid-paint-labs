// Regression: Arc lab uses Hiroyuki Sato / Paper.js exact necks, not the
// simplified pinch-bezier the first port used (d <= r1+r2*K, acos angles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB_APP = path.join(root, 'lab-sources/Arc+Metaball+Grid+Lab/App.tsx');

async function loadSato() {
  const { buildSync } = await import('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nct-sato-'));
  const probe = path.join(tmp, 'probe.jsx');
  fs.writeFileSync(probe, `export { satoNeck, roundRectStamp } from ${JSON.stringify(LAB_APP)};`);
  buildSync({
    entryPoints: [probe],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    alias: { '@nct/nctgraphite': path.join(root, 'NCTGraphite/packages/nctgraphite/src/index.ts') },
    nodePaths: [path.join(root, 'node_modules')],
    outfile: path.join(tmp, 'probe.cjs'),
  });
  return import(path.join(tmp, 'probe.cjs'));
}

test('satoNeck refuses pairs past r1+r2*K and contained circles', async () => {
  const { satoNeck } = await loadSato();
  const a = { x: 0, y: 0 };
  const far = { x: 400, y: 0 };
  assert.equal(satoNeck(40, 40, a, far, 2.4, 0.5, 2.5), null);
  const inside = { x: 5, y: 0 };
  assert.equal(satoNeck(80, 10, a, inside, 2.4, 0.5, 2.5), null);
});

test('satoNeck emits M/C/A path with escaped flag when circles are separate', async () => {
  const { satoNeck } = await loadSato();
  const n = satoNeck(40, 30, { x: 0, y: 0 }, { x: 90, y: 0 }, 2.4, 0.5, 2.5);
  assert.ok(n);
  assert.match(n.path, /^M /);
  assert.match(n.path, / C /);
  assert.match(n.path, / A 30 30 0 1 0 /);
  assert.equal(n.escaped, true);
  assert.ok(Math.abs(n.d - 90) < 1e-9);
});

test('escaped flag is d > r1 (center of r2 inside r1 uses the minor arc)', async () => {
  const { satoNeck } = await loadSato();
  // d=50, r1=40 → center of r2 is outside r1, large-arc flag 1 (original: escaped = d > r1)
  const outside = satoNeck(40, 40, { x: 0, y: 0 }, { x: 50, y: 0 }, 2.4, 0.5, 2.5);
  assert.ok(outside);
  assert.equal(outside.escaped, true);
  assert.match(outside.path, / A 40 40 0 1 0 /);
  // d=50, r1=80, r2=40: not contained (d > |r1-r2|) but center of r2 is inside r1
  const inside = satoNeck(80, 40, { x: 0, y: 0 }, { x: 50, y: 0 }, 2.4, 0.5, 2.5);
  assert.ok(inside);
  assert.equal(inside.escaped, false);
  assert.match(inside.path, / A 40 40 0 0 0 /);
});

test('roundRectStamp drops corner circles and edge samples so the long side necks', async () => {
  const { roundRectStamp } = await loadSato();
  const s = roundRectStamp(0, 0, 40, 1.7, 0.55);
  assert.ok(s.centers.length >= 4);
  assert.ok(s.halfW > s.halfH);
  assert.ok(s.cornerR < s.halfH);
  for (const c of s.centers) assert.equal(c.r, s.cornerR);
  const compact = roundRectStamp(0, 0, 40, 1.1, 0.85);
  assert.ok(compact.centers.length >= 4);
});

test('roundRectStamp collapses to a pill or a circle', async () => {
  const { roundRectStamp } = await loadSato();
  const circle = roundRectStamp(10, 20, 40, 1, 1);
  assert.equal(circle.centers.length, 1);
  assert.equal(circle.centers[0].x, 10);
  assert.equal(circle.centers[0].y, 20);
  const pill = roundRectStamp(0, 0, 40, 2, 1);
  assert.ok(pill.centers.length >= 2);
  assert.ok(pill.centers.every((c) => Math.abs(c.y) < 0.75));
});
