import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ stdin: { contents: `export { fieldAt, contourLayersForBlobs } from '@nct/nctgraphite'; export { createMetaballLayer, createInitialDocument, setLayerSetting, layerParameters, metaballContours } from './unified/layers.ts'; export { openGridPaintFile } from './unified/records.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const blob = (x, type = 'positive') => ({ x, y: 100, r: 20, type, colorGroup: 0, color: '#fff' });
test('finite range fades to zero for positive and negative blobs', () => {
  const a = blob(100), far = blob(300), neg = blob(300, 'negative');
  const base = api.fieldAt(100, 100, [a], []);
  assert.ok(api.fieldAt(100, 100, [a, far], []) > base);
  assert.equal(api.fieldAt(100, 100, [a, far], [], 3), base);
  assert.equal(api.fieldAt(100, 100, [a], [neg], 3), base);
  assert.ok(api.fieldAt(140, 100, [a], [], 3) > 0);
  assert.equal(api.fieldAt(160, 100, [a], [], 3), 0);
  assert.ok(api.fieldAt(155, 100, [a], [], 3) < api.fieldAt(145, 100, [a], [], 3));
  assert.equal(api.fieldAt(200, 100, [a], [], 0), api.fieldAt(200, 100, [a], []));
});
test('distant field contours are unchanged with finite influence', () => {
  const params = [['#fff'], 80, 40, 400, 200, .8, false, 3];
  const a = api.contourLayersForBlobs([blob(100)], ...params)[0].pathD;
  const both = api.contourLayersForBlobs([blob(100), blob(300)], ...params)[0].pathD;
  assert.ok(both.includes(a.trim()));
});
test('range is a field-only control that persists in the native document', () => {
  let doc = api.createInitialDocument(), canvas = doc.snapshot.canvas;
  const layer = doc.layers.find(l => l.mode === 'metaball'), id = layer.id;
  doc = doc.updatingLayer(id, l => api.setLayerSetting(l, 'engine', 'contour', canvas));
  assert.ok(api.layerParameters(doc.layers.find(l => l.id === id)).some(p => p.id === 'influenceRange'));
  doc = doc.updatingLayer(id, l => api.setLayerSetting(l, 'influenceRange', 3, canvas));
  assert.equal(api.openGridPaintFile(doc.toJSON()).layers.find(l => l.id === id).settings.influenceRange, 3);
  const arc = api.setLayerSetting(doc.layers.find(l => l.id === id), 'engine', 'arc', canvas);
  assert.ok(!api.layerParameters(arc).some(p => p.id === 'influenceRange'));
});
