import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ stdin: { contents: `export { createVectorFieldLayer, defaultCanvas, setLayerSetting, paintLayerAt } from './unified/layers.ts'; export { vectorShapePath } from './unified/vectorShapes.ts'; export { vectorGridCells } from './unified/vectorGrid.ts'; export { importLabRecord, exportLabRecord } from './unified/records.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createVectorFieldLayer, defaultCanvas, setLayerSetting, paintLayerAt, vectorShapePath, vectorGridCells, importLabRecord, exportLabRecord } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const canvas = defaultCanvas();
test('grid choices use real polygon centers and preserve painted field when switching', () => {
  let field = createVectorFieldLayer(canvas);
  field = paintLayerAt(field, canvas, { x: 480, y: 330 }, 'op:swirl');
  for (const [kind, sides] of [['hex', 6], ['triangle', 3]]) {
    field = setLayerSetting(field, 'gridKind', kind, canvas);
    const cells = vectorGridCells(kind, field.settings.columns, field.settings.rows, canvas);
    assert.equal(cells[0].corners.length, sides);
    assert.deepEqual({ x: field.data.vectors[0].x, y: field.data.vectors[0].y }, cells[0].center);
    assert.ok(field.data.vectors.some(v => Math.hypot(v.vx, v.vy) > .01));
    field = paintLayerAt(field, canvas, { x: 480, y: 330 }, 'smooth');
    assert.ok(field.data.vectors.every(v => Number.isFinite(v.vx) && Number.isFinite(v.vy)));
    for (const mode of ['magnitude', 'strokes', 'streamlines']) {
      const shaped = setLayerSetting(field, 'shapeMode', mode, canvas);
      assert.match(vectorShapePath(shaped, canvas.width, canvas.height), /M .* Z/);
    }
  }
});
test('non-square JSON and native documents preserve coordinates and grid kind', () => {
  let field = createVectorFieldLayer(canvas);
  field = setLayerSetting(field, 'gridKind', 'hex', canvas);
  field = paintLayerAt(field, canvas, { x: 480, y: 330 }, 'op:swirl');
  const payload = exportLabRecord(field, canvas);
  const opened = importLabRecord(payload.value);
  assert.equal(opened.activeLayer.settings.gridKind, 'hex');
  assert.deepEqual(opened.activeLayer.data.vectors, field.data.vectors);
});
