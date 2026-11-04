import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../unified/layers.ts', import.meta.url));
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  alias: { '@nct/nctgraphite': nct },
});
const { createInitialDocument, paintLayerAt, convexHull, hullOutline, hullOutlines, setLayerKind, setLayerSetting, paintedCount } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);

test('initial document has hull under hex paint and paints only the active layer', () => {
  const doc = createInitialDocument();
  assert.equal(doc.layers.length, 5);
  assert.equal(doc.layers[0].mode, 'hull');
  assert.equal(doc.layers[1].mode, 'cell-paint');
  assert.equal(doc.layers[2].mode, 'dot-shading');
  assert.equal(doc.layers[3].mode, 'metaball');
  assert.equal(doc.layers[4].mode, 'vector-field');
  const painted = doc.updatingLayer(doc.activeLayerId, (layer) => paintLayerAt(layer, doc.snapshot.canvas, { x: 480, y: 360 }, 'paint'));
  assert.ok(paintedCount(painted.activeLayer) > 0);
  assert.equal(paintedCount(painted.layers[0]), 0);
});

test('convex hull of a square is the four corners', () => {
  const hull = convexHull([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 },
  ]);
  assert.equal(hull.length, 4);
});

test('changing grid kind clears paint and hull outline uses painted cell corners', () => {
  let doc = createInitialDocument();
  doc = doc.updatingLayer(doc.activeLayerId, (layer) => paintLayerAt(layer, doc.snapshot.canvas, { x: 480, y: 360 }, 'paint'));
  const cleared = setLayerKind(doc.activeLayer, 'square');
  assert.equal(paintedCount(cleared), 0);
  const hullDoc = doc.activating(doc.layers[0].id).updatingLayer(doc.layers[0].id, (layer) => paintLayerAt(layer, doc.snapshot.canvas, { x: 480, y: 360 }, 'paint'));
  const outline = hullOutline(hullDoc.activeLayer, hullDoc.snapshot.canvas);
  assert.ok(outline.length >= 3);
});

test('diamond topology and tight hull stay distinct from hex and convex', () => {
  let doc = createInitialDocument();
  doc = doc.activating(doc.layers[0].id);
  doc = doc.updatingLayer(doc.activeLayerId, (layer) => setLayerKind(layer, 'hex-flat-diamond'));
  assert.equal(doc.activeLayer.settings.kind, 'hex-flat-diamond');
  doc = doc.updatingLayer(doc.activeLayerId, (layer) => paintLayerAt(layer, doc.snapshot.canvas, { x: 480, y: 360 }, 'paint'));
  assert.ok(paintedCount(doc.activeLayer) > 0);
  const convex = hullOutlines({ ...doc.activeLayer, settings: { ...doc.activeLayer.settings, hullMode: 'convex' } }, doc.snapshot.canvas);
  const tight = hullOutlines({ ...doc.activeLayer, settings: { ...doc.activeLayer.settings, hullMode: 'tight' } }, doc.snapshot.canvas);
  assert.ok(convex[0].points.length >= 3);
  assert.ok(tight[0].points.length >= 3);
});

test('metaball and vector-field layers stamp through NCTGraphite graphics', () => {
  let doc = createInitialDocument();
  const meta = doc.layers.find((layer) => layer.mode === 'metaball');
  doc = doc.activating(meta.id).updatingLayer(meta.id, (layer) => paintLayerAt(layer, doc.snapshot.canvas, { x: 480, y: 360 }, 'paint'));
  assert.ok(paintedCount(doc.activeLayer) >= 1);
  const field = doc.layers.find((layer) => layer.mode === 'vector-field');
  doc = doc.activating(field.id).updatingLayer(field.id, (layer) => paintLayerAt(layer, doc.snapshot.canvas, { x: 480, y: 360 }, 'paint', { velocityX: 12, velocityY: 0 }));
  assert.ok(paintedCount(doc.activeLayer) > 0);
});

test('vector angle interval reprojects samples already on the layer', () => {
  let doc = createInitialDocument();
  const field = doc.layers.find((layer) => layer.mode === 'vector-field');
  doc = doc.activating(field.id).updatingLayer(field.id, (layer) => ({
    ...layer,
    data: {
      ...layer.data,
      vectors: layer.data.vectors.map((sample, index) => (index === 0 ? { ...sample, vx: 2, vy: 0 } : sample)),
    },
  }));
  doc = doc.updatingLayer(doc.activeLayerId, (layer) => setLayerSetting(layer, 'angleMin', 90));
  doc = doc.updatingLayer(doc.activeLayerId, (layer) => setLayerSetting(layer, 'angleMax', 90));
  const sample = doc.activeLayer.data.vectors[0];
  assert.ok(Math.abs(sample.vx) < 1e-6);
  assert.ok(sample.vy > 1);
  assert.equal(doc.activeLayer.settings.weight, 2.2);
  assert.equal(doc.activeLayer.settings.minWidth, 1);
});

test('dot shading grow stamps sample gain on the edge-aligned lattice', () => {
  let doc = createInitialDocument();
  const dots = doc.layers.find((layer) => layer.mode === 'dot-shading');
  assert.equal(dots.data.points.length, dots.settings.columns * dots.settings.rows);
  doc = doc.activating(dots.id).updatingLayer(dots.id, (layer) => paintLayerAt(layer, doc.snapshot.canvas, { x: 480, y: 360 }, 'paint'));
  assert.ok(paintedCount(doc.activeLayer) > 0);
});
