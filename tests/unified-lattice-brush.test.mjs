import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ stdin: { contents: `export { createCellPaintLayer, createUnifiedDocument, cellBrushAnchor, cellBrushHits, setLayerSetting, layerLattice, paintLayerAt, layerParameters } from './unified/layers.ts'; export { openGridPaintFile } from './unified/records.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const canvas = api.createUnifiedDocument().snapshot.canvas;
const relative = (cells, q, r) => cells.map(c => `${c.q - q},${c.r - r},${c.s ?? ''}`).sort();
test('lattice brush keeps its selection stable within and between root cells', () => {
  for (const kind of ['square', 'hex-flat', 'hex-pointy', 'hex-flat-diamond', 'tri-horiz', 'tri-vert']) {
    let layer = api.createCellPaintLayer({ settings: { kind, size: 20, brushRadius: 48, brushShape: 'square', brushAngle: 12, activationInset: 25 } });
    layer = api.setLayerSetting(layer, 'brushType', 'lattice-shape', canvas);
    const cells = api.layerLattice(layer, canvas);
    const a = cells.find(c => c.q === 0 && c.r === 0 && (c.s === undefined || c.s === 0));
    const b = cells.find(c => c.q === 1 && c.r === 0 && (c.s === undefined || c.s === 0));
    assert.ok(a && b, kind);
    const offset = { x: a.center.x + .1, y: a.center.y + .1 };
    assert.deepEqual(api.cellBrushAnchor(layer, canvas, offset), a.center, kind);
    assert.deepEqual(relative(api.cellBrushHits(layer, canvas, offset), 0, 0), relative(api.cellBrushHits(layer, canvas, a.center), 0, 0), kind);
    assert.deepEqual(relative(api.cellBrushHits(layer, canvas, a.center), 0, 0), relative(api.cellBrushHits(layer, canvas, b.center), 1, 0), kind);
    const painted = api.paintLayerAt(layer, canvas, offset, 'paint');
    assert.deepEqual(Object.keys(painted.data.cells).sort(), api.cellBrushHits(layer, canvas, offset).map(c => c.id).sort(), kind);
  }
});
test('lattice anchor stays on root lattice after subdivision and settings persist', () => {
  let layer = api.createCellPaintLayer({ settings: { kind: 'square', size: 20, brushRadius: 10 } });
  layer = api.setLayerSetting(layer, 'brushType', 'lattice-shape', canvas);
  layer = api.setLayerSetting(layer, 'subdivideTarget', 'grid', canvas);
  const anchor = { x: canvas.width / 2, y: canvas.height / 2 };
  layer = api.paintLayerAt(layer, canvas, anchor, 'subdivide');
  assert.deepEqual(api.cellBrushAnchor(layer, canvas, { x: anchor.x + 2, y: anchor.y + 2 }), anchor);
  const saved = api.openGridPaintFile(api.createUnifiedDocument().insertingLayer(layer).toJSON());
  assert.equal(saved.activeLayer.settings.brushType, 'lattice-shape');
  assert.ok(api.layerParameters(saved.activeLayer).some(p => p.id === 'brushType'));
});
