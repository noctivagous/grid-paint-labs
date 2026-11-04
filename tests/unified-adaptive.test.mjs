import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const entry = fileURLToPath(new URL('../unified/layers.ts', import.meta.url));
const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createCellPaintLayer, createHullLayer, defaultCanvas, layerLattice, paintLayerAt, setLayerSetting, hullOutlines, clearLayerPaint } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const canvas = defaultCanvas(), point = { x: canvas.width / 2, y: canvas.height / 2 };
function setup(kind = 'square') {
  let layer = createCellPaintLayer();
  layer = setLayerSetting(layer, 'kind', kind, canvas);
  layer = setLayerSetting(layer, 'brushRadius', 2, canvas);
  return layer;
}
test('split preserves paint, allows child editing, and coarsens to painted parent', () => {
  let layer = setup();
  layer = paintLayerAt(layer, canvas, point, 'paint');
  const rootId = layerLattice(layer, canvas).find(c => c.center.x === point.x && c.center.y === point.y).id;
  assert.ok(layer.data.cells[rootId]);
  layer = paintLayerAt(layer, canvas, point, 'subdivide');
  assert.equal(layerLattice(layer, canvas).filter(c => c.parentId === rootId).length, 4);
  assert.equal(Object.keys(layer.data.cells).filter(id => id.startsWith(rootId + '/')).length, 4);
  const child = layerLattice(layer, canvas).find(c => c.parentId === rootId);
  layer = paintLayerAt(layer, canvas, child.center, 'erase');
  assert.equal(layer.data.cells[child.id], undefined);
  layer = setLayerSetting(layer, 'brushRadius', 20, canvas);
  layer = paintLayerAt(layer, canvas, point, 'coarsen');
  assert.ok(layer.data.cells[rootId]);
  assert.equal(layer.data.splits[rootId], undefined);
});
test('mixed-resolution neighbors remain one tight hull', () => {
  let layer = setup();
  const roots = layerLattice(layer, canvas);
  const left = roots.find(c => c.q === 0 && c.r === 0), right = roots.find(c => c.q === 1 && c.r === 0);
  layer = { ...layer, data: { cells: { [left.id]: { color: '#123456' }, [right.id]: { color: '#123456' } } } };
  layer = paintLayerAt(layer, canvas, left.center, 'subdivide');
  layer = setLayerSetting(layer, 'hullMode', 'tight', canvas);
  const loops = hullOutlines(layer, canvas);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].hole, false);
});
test('grid target splits empty cells, clear retains mesh, and depth is bounded', () => {
  let layer = setLayerSetting(setup(), 'subdivideTarget', 'grid', canvas);
  layer = paintLayerAt(layer, canvas, point, 'subdivide');
  assert.ok(Object.keys(layer.data.splits).length);
  layer = paintLayerAt(layer, canvas, point, 'paint');
  layer = clearLayerPaint(layer);
  assert.ok(Object.keys(layer.data.splits).length);
  assert.equal(Object.keys(layer.data.cells).length, 0);
  layer = setLayerSetting(layer, 'subdivideDepth', 0, canvas);
  assert.equal(paintLayerAt(layer, canvas, point, 'subdivide'), layer);
});
test('hex and triangle grids subdivide and legacy hull layer supports editing', () => {
  for (const kind of ['hex-flat', 'tri-horiz', 'hex-flat-diamond']) {
    let layer = setLayerSetting(setup(kind), 'subdivideTarget', 'grid', canvas);
    const cell = layerLattice(layer, canvas).find(c => Math.hypot(c.center.x - point.x, c.center.y - point.y) < 30);
    layer = paintLayerAt(layer, canvas, cell.center, 'subdivide');
    assert.equal(layerLattice(layer, canvas).filter(c => c.parentId === cell.id).length, cell.corners.length === 6 ? 6 : 4);
  }
  let hull = createHullLayer(); hull = setLayerSetting(hull, 'subdivideTarget', 'grid', canvas);
  hull = paintLayerAt(hull, canvas, point, 'subdivide');
  assert.ok(Object.keys(hull.data.splits).length);
});

test('adaptive edits survive document serialization and undo restores the previous mesh', async () => {
  const combined = await build({ stdin: { contents: `export { createInitialDocument, paintLayerAt, setLayerSetting } from './unified/layers.ts'; export { openGridPaintFile, exportLabRecord } from './unified/records.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
  const api = await import(`data:text/javascript;base64,${Buffer.from(combined.outputFiles[0].contents).toString('base64')}`);
  let doc = api.createInitialDocument();
  const id = doc.activeLayerId;
  doc = doc.updatingLayer(id, l => api.setLayerSetting(l, 'subdivideTarget', 'grid', doc.snapshot.canvas));
  doc = doc.updatingLayer(id, l => api.paintLayerAt(l, doc.snapshot.canvas, point, 'subdivide'));
  assert.ok(Object.keys(doc.activeLayer.data.splits).length);
  const saved = api.openGridPaintFile(doc.toJSON());
  assert.deepEqual(saved.activeLayer.data.splits, doc.activeLayer.data.splits);
  assert.equal(api.exportLabRecord(doc.activeLayer, doc.snapshot.canvas), null);
  assert.equal(doc.undo().activeLayer.data.splits, undefined);
  assert.deepEqual(doc.undo().redo().activeLayer.data.splits, doc.activeLayer.data.splits);
});
