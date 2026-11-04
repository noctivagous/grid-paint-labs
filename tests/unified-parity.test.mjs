import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../unified/layers.ts', import.meta.url));
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createMetaballLayer, createVectorFieldLayer, defaultCanvas, paintLayerAt, setLayerSetting, VECTOR_COMMANDS } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
test('momentary vector operation paints without changing selected mode', () => {
  const canvas = defaultCanvas();
  const layer = createVectorFieldLayer(canvas);
  const next = paintLayerAt(layer, canvas, { x: 480, y: 330 }, 'op:swirl');
  assert.equal(next.settings.mode, layer.settings.mode);
  assert.ok(next.data.vectors.some(v => Math.hypot(v.vx, v.vy) > 0));
  assert.ok(VECTOR_COMMANDS.some(c => c.id === 'op:swirl' && c.defaultKey === 'c'));
});
test('metaball snap, bridge and smoothing preserve blob data', () => {
  const canvas = defaultCanvas();
  let layer = setLayerSetting(createMetaballLayer({ settings: { engine: 'contour' } }), 'snap', true, canvas);
  layer = paintLayerAt(layer, canvas, { x: 201, y: 200 }, 'paint');
  assert.equal(layer.data.blobs[0].x % (canvas.width / layer.settings.gridResolution), 0);
  layer = paintLayerAt(layer, canvas, { x: 250, y: 200 }, 'paint');
  layer = paintLayerAt(layer, canvas, { x: 225, y: 200 }, 'bridge');
  assert.equal(layer.data.blobs.length, 3);
  const smooth = paintLayerAt(layer, canvas, { x: 225, y: 200 }, 'smooth');
  assert.equal(smooth.data.blobs.length, 3);
  assert.notEqual(smooth.data.blobs[0].x, layer.data.blobs[0].x);
});

 test('Arc circular stamps match the brush radius and cursor position', () => {
  const canvas = defaultCanvas();
  for (const radius of [16, 48, 120]) {
    const layer = createMetaballLayer({ settings: { engine: 'arc', brushRadius: radius, stampShape: 'circle' } });
    for (const action of ['paint', 'placeNeg']) {
      const next = paintLayerAt(layer, canvas, { x: 201, y: 209 }, action);
      assert.equal(next.data.blobs[0].r, radius);
      assert.equal(next.data.blobs[0].x, 201);
      assert.equal(next.data.blobs[0].y, 209);
    }
  }
});
