// Regression: the vector field colors vectors by ANGLE (hue wheel), not by
// magnitude. Ports the original's hsla(angle, 95%, 62%, alpha) scheme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB_APP = path.join(root, 'lab-sources/Grid+Paint+Vector+Field+Key/App.tsx');

async function loadStyle() {
  const { buildSync } = await import('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nct-vector-color-'));
  const probe = path.join(tmp, 'probe.jsx');
  fs.writeFileSync(probe, `export { vectorStyle } from ${JSON.stringify(LAB_APP)};`);
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

test('vector color follows the angle hue wheel', async () => {
  const { vectorStyle } = await loadStyle();
  // Original wheel: hue = (atan2(vy, vx) in degrees + 180) % 360.
  assert.equal(vectorStyle(1, 0, false).hue, 180); // east → cyan
  assert.equal(vectorStyle(0, 1, false).hue, 270); // south (canvas y-down)
  assert.equal(vectorStyle(-1, 0, false).hue, 0); // west → red
  assert.equal(vectorStyle(0, -1, false).hue, 90); // north
});

test('idle vectors are skipped, painting vectors get arrowheads', async () => {
  const { vectorStyle } = await loadStyle();
  assert.equal(vectorStyle(0.005, 0, false).skip, true);
  assert.equal(vectorStyle(0.05, 0, false).skip, false);
  const paint = vectorStyle(0.5, 0, false);
  const preview = vectorStyle(0.5, 0, true);
  assert.equal(paint.arrow, true);
  assert.equal(preview.arrow, false);
  assert.equal(preview.width, 1);
  assert.ok(Math.abs(preview.alpha / paint.alpha - 0.35) < 1e-9);
});
