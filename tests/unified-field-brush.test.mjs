import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ stdin: { contents: `export { createMetaballLayer, createUnifiedDocument, paintLayerAt, metaballContours, setLayerSetting } from './unified/layers.ts'; export { openGridPaintFile } from './unified/records.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createMetaballLayer, createUnifiedDocument, paintLayerAt, metaballContours, setLayerSetting, openGridPaintFile } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const canvas = createUnifiedDocument().snapshot.canvas;
function bounds(path) {
  const coords = [...path.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  const xs = coords.map(p => p[0]), ys = coords.map(p => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, rx: (Math.max(...xs) - Math.min(...xs)) / 2, ry: (Math.max(...ys) - Math.min(...ys)) / 2 };
}
test('new Field stamps match the brush at multiple goo values and positions', () => {
  for (const goo of [.2, .8, 1.2]) for (const [x, y] of [[1400, 1000], [1413, 1007]]) {
    let layer = createMetaballLayer({ settings: { engine: 'contour', brushRadius: 48, goo } });
    layer = paintLayerAt(layer, canvas, { x, y }, 'paint');
    assert.equal(layer.data.blobs[0].r, 48);
    const outline = metaballContours(layer, canvas)[0];
    assert.ok(outline);
    const box = bounds(outline.pathD);
    assert.ok(Math.abs(box.x - x) < 3 && Math.abs(box.y - y) < 3, JSON.stringify(box));
    assert.ok(Math.abs(box.rx - 48) < 4 && Math.abs(box.ry - 48) < 4, JSON.stringify(box));
  }
});
test('small brush deposits are visible at default resolution and stored scales survive save', () => {
  let doc = createUnifiedDocument(), canvas = doc.snapshot.canvas;
  // A tiny Field stamp at a point between the original 60px samples.
  let layer = createMetaballLayer({ settings: { engine: 'contour', brushRadius: 16 } });
  layer = paintLayerAt(layer, canvas, { x: 1411, y: 1007 }, 'paint');
  assert.ok(metaballContours(layer, canvas)[0]?.pathD);
  doc = doc.insertingLayer(layer);
  const opened = openGridPaintFile(doc.toJSON());
  assert.equal(opened.activeLayer.data.blobs[0].fieldScale, layer.data.blobs[0].fieldScale);
  assert.equal(metaballContours(opened.activeLayer, canvas)[0].pathD, metaballContours(layer, canvas)[0].pathD);
});
test('previous blobs keep their field meaning and Goo still changes their outline', () => {
  let layer = createMetaballLayer({ settings: { engine: 'contour' }, data: { blobs: [{ id: 'old', x: 1400, y: 1000, r: 48, type: 'positive', colorGroup: 0, color: '#fff' }] } });
  const before = metaballContours(layer, canvas)[0].pathD;
  layer = setLayerSetting(layer, 'goo', 1.2, canvas);
  assert.notEqual(metaballContours(layer, canvas)[0].pathD, before);
  assert.equal(layer.data.blobs[0].fieldScale, undefined);
});
