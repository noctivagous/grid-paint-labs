import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ stdin: { contents: `export { brushPolygon, brushIntersectsPolygon } from './unified/brushGeometry.ts'; export { createCellPaintLayer, createUnifiedDocument, setLayerSetting, paintLayerAt, layerLattice, CELL_PAINT_COMMANDS } from './unified/layers.ts'; export { openGridPaintFile } from './unified/records.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
test('brushes represent each grid geometry and rotate around their center', () => {
  for (const [shape, sides] of [['square', 4], ['hex-flat', 6], ['hex-pointy', 6], ['hex-flat-diamond', 4], ['tri-horiz', 3], ['tri-vert', 3]]) {
    const brush = { x: 100, y: 80, radius: 20, shape, angle: 0 };
    const a = api.brushPolygon(brush), b = api.brushPolygon({ ...brush, angle: 90 });
    assert.equal(a.length, sides);
    assert.ok(Math.abs(Math.hypot(a[0].x - 100, a[0].y - 80) - 20) < 1e-8 || shape === 'hex-flat-diamond');
    assert.ok(Math.abs(b[0].x - (100 - (a[0].y - 80))) < 1e-8);
  }
});
test('rotated polygon footprint intersects inset cells only where the cursor touches', () => {
  const cell = [{ x: 9, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 1 }, { x: 9, y: 1 }];
  const brush = { x: 0, y: 0, radius: 10, shape: 'square', angle: 0 };
  assert.equal(api.brushIntersectsPolygon(brush, cell), false);
  assert.equal(api.brushIntersectsPolygon({ ...brush, angle: 45 }, cell), true);
  assert.equal(api.brushIntersectsPolygon({ ...brush, angle: 45 }, [{ x: 9, y: 0 }]), true);
  assert.equal(api.brushIntersectsPolygon({ ...brush, angle: 45 }, [{ x: 11, y: 0 }]), false);
});
test('brush settings are persisted and affect painted cells', () => {
  let doc = api.createUnifiedDocument(); const canvas = doc.snapshot.canvas;
  let layer = api.createCellPaintLayer({ settings: { kind: 'square', size: 20, brushRadius: 10 } });
  layer = api.setLayerSetting(layer, 'brushShape', 'square', canvas);
  layer = api.setLayerSetting(layer, 'activationInset', 100, canvas);
  const cell = api.layerLattice(layer, canvas).find(c => c.q === 0 && c.r === 0);
  const point = { x: cell.center.x - 9, y: cell.center.y };
  assert.equal(api.paintLayerAt(layer, canvas, point, 'paint').data.cells[cell.id], undefined);
  layer = api.setLayerSetting(layer, 'brushAngle', 45, canvas);
  layer = api.paintLayerAt(layer, canvas, point, 'paint');
  assert.ok(layer.data.cells[cell.id]);
  doc = doc.insertingLayer(layer);
  const saved = api.openGridPaintFile(doc.toJSON());
  assert.equal(saved.activeLayer.settings.brushShape, 'square');
  assert.equal(saved.activeLayer.settings.brushAngle, 45);
  assert.equal(api.CELL_PAINT_COMMANDS.find(c => c.id === 'rotateBrushLeft').defaultKey, ';');
  assert.equal(api.CELL_PAINT_COMMANDS.find(c => c.id === 'rotateBrushRight').defaultKey, "'");
});
