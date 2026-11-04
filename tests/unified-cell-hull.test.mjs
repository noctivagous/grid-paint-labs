import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../unified/layers.ts', import.meta.url));
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createCellPaintLayer, defaultCanvas, layerLattice, setLayerSetting, paintLayerAt, hullOutlines } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
test('cell paint can enable a hull on existing painted cells', () => {
  const canvas = defaultCanvas();
  let layer = paintLayerAt(createCellPaintLayer(), canvas, { x: canvas.width / 2, y: canvas.height / 2 }, 'paint');
  const cells = layer.data.cells;
  layer = setLayerSetting(layer, 'hullMode', 'tight', canvas);
  assert.equal(layer.data.cells, cells);
  assert.ok(hullOutlines(layer, canvas).length);
});
test('split grid modes contain all subcells', () => {
  const canvas = defaultCanvas();
  for (const [kind, expected] of [['hex-flat-diamond', 3], ['tri-horiz', 2], ['tri-vert', 2]]) {
    const layer = setLayerSetting(createCellPaintLayer(), 'kind', kind, canvas);
    const samples = layerLattice(layer, canvas).filter(c => c.q === 0 && c.r === 0);
    assert.equal(samples.length, expected);
  }
});
