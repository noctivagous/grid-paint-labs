import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../NCTGraphite/packages/nctgraphite/src/document/NCTGraphiteDocument.ts', import.meta.url), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const {
  NCTGraphiteDocument,
  NCTGraphiteDocumentController,
  NCTGRAPHITE_DOCUMENT_KIND,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const layer = (id, name = id) => ({ id, name, visible: true });

test('untitled document tracks layers, dirty state, undo, and JSON round trip', () => {
  const doc = NCTGraphiteDocument.untitled({
    layers: [layer('hull', 'Hull'), layer('paint', 'Hex Paint')],
  });
  assert.equal(doc.snapshot.kind, NCTGRAPHITE_DOCUMENT_KIND);
  assert.equal(doc.activeLayerId, 'paint');
  assert.equal(doc.edited, false);
  const hidden = doc.updatingLayer('hull', (item) => ({ ...item, visible: false }));
  assert.equal(hidden.edited, true);
  assert.equal(hidden.id, doc.id);
  assert.equal(hidden.visibleLayers.length, 1);
  const undone = hidden.undo();
  assert.equal(undone.activeLayer?.id, 'paint');
  assert.equal(undone.layers.find((item) => item.id === 'hull').visible, true);
  assert.equal(undone.edited, false);
  const parsed = NCTGraphiteDocument.parse(hidden.toJSON(), 'demo.nctgdoc.json');
  assert.equal(parsed.fileName, 'demo.nctgdoc.json');
  assert.equal(parsed.layers[0].visible, false);
  assert.equal(parsed.edited, false);
});

test('live edits can collapse into one undo step from a base document', () => {
  const doc = NCTGraphiteDocument.untitled({ layers: [layer('paint')] });
  const stroke = doc
    .updatingLayer('paint', (item) => ({ ...item, name: 'A' }), { recordUndo: false })
    .updatingLayer('paint', (item) => ({ ...item, name: 'B' }), { recordUndo: false });
  const committed = stroke.recordingUndoFrom(doc);
  assert.equal(committed.activeLayer.name, 'B');
  assert.equal(committed.undo().activeLayer.name, 'paint');
});

test('controller replaces the current document by id', () => {
  const doc = NCTGraphiteDocument.untitled({ layers: [layer('a')] });
  let controller = new NCTGraphiteDocumentController([doc], doc.id);
  controller = controller.replacing(doc.insertingLayer(layer('b', 'Hull')));
  assert.equal(controller.current.layers.length, 2);
  assert.equal(controller.currentId, doc.id);
});

test('rejects invalid canvas sizes and unknown kinds', () => {
  assert.throws(() => NCTGraphiteDocument.untitled({ canvas: { width: 0, height: 10 }, layers: [] }), RangeError);
  assert.throws(() => NCTGraphiteDocument.fromSnapshot({ kind: 'other', version: 1, displayName: 'x', canvas: { width: 10, height: 10, background: '#000' }, view: { zoom: 1, panX: 0, panY: 0 }, layers: [], activeLayerId: null }), TypeError);
});
