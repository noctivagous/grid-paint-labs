import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ stdin: { contents: `export { createUnifiedDocument, modeLayer, updateModeLayer, layerContents, paintLayerAt, setLayerSetting, hullOutlines } from './unified/layers.ts'; export { NCTGraphiteDocument } from '@nct/nctgraphite';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createUnifiedDocument, modeLayer, updateModeLayer, layerContents, paintLayerAt, setLayerSetting, hullOutlines, NCTGraphiteDocument } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);

test('one layer retains independent mode marks through undo, redo and save', () => {
  let doc = createUnifiedDocument();
  const canvas = doc.snapshot.canvas;
  assert.equal(doc.layers.length, 1);
  const id = doc.activeLayerId;
  const paint = (mode, action) => { doc = doc.updatingLayer(id, layer => updateModeLayer(layer, mode, canvas, part => paintLayerAt(part, canvas, { x: 480, y: 360 }, action))); };
  paint('cell-paint', 'paint');
  const cells = Object.keys(modeLayer(doc.activeLayer, 'cell-paint', canvas).data.cells).length;
  assert.ok(cells > 0);
  paint('metaball', 'paint');
  assert.ok(modeLayer(doc.activeLayer, 'metaball', canvas).data.vectorField.data.vectors.some(v => Math.hypot(v.vx, v.vy) > 0));
  assert.equal(Object.keys(modeLayer(doc.activeLayer, 'cell-paint', canvas).data.cells).length, cells);
  assert.equal(layerContents(doc.activeLayer).length, 2);
  const saved = NCTGraphiteDocument.parse(doc.toJSON());
  assert.deepEqual(modeLayer(saved.activeLayer, 'metaball', canvas).data.vectorField.data.vectors, modeLayer(doc.activeLayer, 'metaball', canvas).data.vectorField.data.vectors);
  assert.equal(layerContents(doc.undo().activeLayer).length, 1);
  assert.equal(layerContents(doc.undo().redo().activeLayer).length, 2);
});

test('all four modes can retain data on the same layer', () => {
  let doc = createUnifiedDocument();
  const canvas = doc.snapshot.canvas, id = doc.activeLayerId;
  for (const [mode, action] of [['cell-paint', 'paint'], ['metaball', 'paint'], ['vector-field', 'op:swirl'], ['dot-shading', 'paint']]) {
    doc = doc.updatingLayer(id, layer => updateModeLayer(layer, mode, canvas, part => paintLayerAt(part, canvas, { x: 480, y: 360 }, action)));
  }
  assert.deepEqual(new Set(layerContents(doc.activeLayer).map(part => part.mode)), new Set(['cell-paint', 'metaball', 'vector-field', 'dot-shading']));
  assert.equal(doc.layers.length, 1);
  assert.deepEqual(new Set(layerContents(NCTGraphiteDocument.parse(doc.toJSON()).activeLayer).map(part => part.mode)), new Set(['cell-paint', 'metaball', 'vector-field', 'dot-shading']));
});

test('cell hull setting outlines the same painted cells', () => {
  const doc = createUnifiedDocument(), canvas = doc.snapshot.canvas;
  let cells = paintLayerAt(doc.activeLayer, canvas, { x: 480, y: 360 }, 'paint');
  const original = cells.data.cells;
  cells = setLayerSetting(cells, 'hullMode', 'convex', canvas);
  assert.equal(cells.data.cells, original);
  assert.ok(hullOutlines(cells, canvas).length > 0);
});

test('dot brush leaves a layer unchanged when no samples are in reach', () => {
  const doc = createUnifiedDocument();
  const dots = modeLayer(doc.activeLayer, 'dot-shading', doc.snapshot.canvas);
  const unchanged = paintLayerAt(dots, doc.snapshot.canvas, { x: -1000, y: -1000 }, 'paint');
  assert.equal(unchanged, dots);
  const point = dots.data.points[0];
  const painted = paintLayerAt(dots, doc.snapshot.canvas, { x: point.x, y: point.y }, 'paint');
  assert.ok(painted.data.points[0].radius > point.radius);
});
