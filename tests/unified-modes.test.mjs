import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ stdin: { contents: `export { createUnifiedDocument, modeLayer, updateModeLayer, layerContents, paintLayerAt } from './unified/layers.ts'; export { NCTGraphiteDocument } from '@nct/nctgraphite';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createUnifiedDocument, modeLayer, updateModeLayer, layerContents, paintLayerAt, NCTGraphiteDocument } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);

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
  assert.ok(modeLayer(doc.activeLayer, 'metaball', canvas).data.blobs.length > 0);
  assert.equal(Object.keys(modeLayer(doc.activeLayer, 'cell-paint', canvas).data.cells).length, cells);
  assert.equal(layerContents(doc.activeLayer).length, 2);
  const saved = NCTGraphiteDocument.parse(doc.toJSON());
  assert.equal(modeLayer(saved.activeLayer, 'metaball', canvas).data.blobs.length, modeLayer(doc.activeLayer, 'metaball', canvas).data.blobs.length);
  assert.equal(layerContents(doc.undo().activeLayer).length, 1);
  assert.equal(layerContents(doc.undo().redo().activeLayer).length, 2);
});

test('all five modes can retain data on the same layer', () => {
  let doc = createUnifiedDocument();
  const canvas = doc.snapshot.canvas, id = doc.activeLayerId;
  for (const [mode, action] of [['cell-paint', 'paint'], ['hull', 'paint'], ['metaball', 'paint'], ['vector-field', 'op:swirl'], ['dot-shading', 'paint']]) {
    doc = doc.updatingLayer(id, layer => updateModeLayer(layer, mode, canvas, part => paintLayerAt(part, canvas, { x: 480, y: 360 }, action)));
  }
  assert.deepEqual(new Set(layerContents(doc.activeLayer).map(part => part.mode)), new Set(['cell-paint', 'hull', 'metaball', 'vector-field', 'dot-shading']));
  assert.equal(doc.layers.length, 1);
  assert.deepEqual(new Set(layerContents(NCTGraphiteDocument.parse(doc.toJSON()).activeLayer).map(part => part.mode)), new Set(['cell-paint', 'hull', 'metaball', 'vector-field', 'dot-shading']));
});
