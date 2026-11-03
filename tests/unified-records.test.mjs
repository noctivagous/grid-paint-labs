import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../unified/records.ts', import.meta.url));
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  alias: { '@nct/nctgraphite': nct },
});
const {
  detectLabRecordKind, importLabRecord, exportLabRecord, openGridPaintFile,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);

test('detects paintings, hull sessions, presets, and vector-field JSON', () => {
  assert.equal(detectLabRecordKind({ kind: 'nctgraphite-document', layers: [] }), 'nctgdoc');
  assert.equal(detectLabRecordKind({
    collection: 'paintings',
    value: { gridType: 'flat', hexSize: 28, active: [{ q: 0, r: 0, color: '#7c5cff' }] },
  }), 'paintings');
  assert.equal(detectLabRecordKind({
    gridType: 'hexHorizDiamond',
    cellSize: 14,
    hullMode: 'tight',
    active: [3, 8, 9],
  }), 'hull_sessions');
  assert.equal(detectLabRecordKind({
    shapeType: 'Circle',
    falloffType: 'Linear',
    jitterAmount: 0.65,
    cols: 48,
    rows: 32,
  }), 'presets');
  assert.equal(detectLabRecordKind({ cols: 8, rows: 4, vectors: [[1, 0], [0, 1]] }), 'vector-field');
});

test('hex painting adapter round-trips axial cells', () => {
  const doc = importLabRecord({
    name: 'Shirt',
    gridType: 'pointy',
    hexSize: 22,
    cols: 10,
    rows: 8,
    active: [{ q: 1, r: -1, color: '#00e5ff', group: 2 }],
  });
  const layer = doc.activeLayer;
  assert.equal(layer.mode, 'cell-paint');
  assert.equal(layer.settings.kind, 'hex-pointy');
  assert.equal(layer.data.cells['1,-1'].color, '#00e5ff');
  const exported = exportLabRecord(layer, doc.snapshot.canvas);
  assert.equal(exported.kind, 'paintings');
  assert.equal(exported.value.gridType, 'pointy');
  assert.deepEqual(exported.value.active[0], { q: 1, r: -1, color: '#00e5ff', group: 0 });
});

test('hull numeric ids map through unified lattice index and round-trip', () => {
  const first = importLabRecord({
    gridType: 'square',
    cellSize: 20,
    hullMode: 'convex',
    active: [0, 2],
  });
  const hull = first.activeLayer;
  assert.equal(hull.mode, 'hull');
  assert.equal(hull.settings.kind, 'square');
  const ids = Object.keys(hull.data.cells);
  assert.equal(ids.length, 2);
  const exported = exportLabRecord(hull, first.snapshot.canvas);
  assert.deepEqual(exported.value.active, [0, 2]);
  const again = importLabRecord(exported.value);
  assert.deepEqual(Object.keys(again.activeLayer.data.cells).sort(), ids.sort());
});

test('vector field JSON remaps attractor y from the 680 lab canvas', () => {
  const doc = importLabRecord({
    cols: 4,
    rows: 2,
    vectors: [[1, 0], [0, 0], [0, 0], [0, 0], [0, 2], [0, 0], [0, 0], [0, 0]],
    attractors: [{ x: 100, y: 680, r: 40, orbit: true }],
  });
  const layer = doc.activeLayer;
  assert.equal(layer.mode, 'vector-field');
  assert.equal(layer.data.vectors[0].vx, 1);
  assert.equal(layer.data.attractors[0].y, 720);
  const exported = exportLabRecord(layer, doc.snapshot.canvas);
  assert.equal(exported.value.height, 720);
  assert.equal(exported.value.vectors[0][0], 1);
});

test('dot preset settings rebuild the sample lattice, and extra points import', () => {
  const settingsOnly = importLabRecord({
    cols: 6,
    rows: 4,
    jitterAmount: 0.2,
    useJitter: false,
    shapeType: 'Diamond',
    falloffType: 'Gaussian',
  });
  assert.equal(settingsOnly.activeLayer.mode, 'dot-shading');
  assert.equal(settingsOnly.activeLayer.data.points.length, 24);
  assert.equal(settingsOnly.activeLayer.settings.shapeType, 'Diamond');
  const withPoints = importLabRecord({
    cols: 2,
    rows: 1,
    height: 680,
    points: [{ x: 10, y: 680, baseX: 10, baseY: 680, col: 0, row: 0, radius: 8, rotation: 0 }],
  });
  assert.equal(withPoints.activeLayer.data.points[0].radius, 8);
  assert.equal(withPoints.activeLayer.data.points[0].y, 720);
});

test('openGridPaintFile keeps nctgdoc parse and wraps lab JSON as untitled', () => {
  const wrapped = openGridPaintFile(JSON.stringify({
    collection: 'paintings',
    value: { gridType: 'flat', active: [{ q: 0, r: 0, color: '#ffe14a' }] },
  }), 'lab.json');
  assert.equal(wrapped.fileName, 'lab.json');
  assert.equal(wrapped.activeLayer.data.cells['0,0'].color, '#ffe14a');
});
