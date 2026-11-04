import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const entry = fileURLToPath(new URL('../unified/layers.ts', import.meta.url));
const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createCellPaintLayer, defaultCanvas, layerLattice, paintLayerAt, setLayerSetting } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
function contains(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
test('all cell grids cover canvas corners and edges at several sizes', () => {
  const canvas = defaultCanvas();
  for (const kind of ['hex-flat', 'hex-pointy', 'square', 'hex-flat-diamond', 'tri-horiz', 'tri-vert']) for (const size of [12, 28, 48]) {
    const layer = createCellPaintLayer({ settings: { kind, size } });
    const cells = layerLattice(layer, canvas);
    for (const x of [0.1, canvas.width / 4, canvas.width / 2, canvas.width - .1]) for (const y of [.1, canvas.height / 4, canvas.height / 2, canvas.height - .1]) {
      assert.ok(cells.some(cell => contains({ x, y }, cell.corners)), `${kind} size ${size} missing ${x},${y}`);
    }
    const painted = paintLayerAt(layer, canvas, { x: 1, y: 1 }, 'paint');
    assert.ok(Object.keys(painted.data.cells).length, `${kind} edge painting`);
  }
});
test('legacy row and column limits no longer truncate the canvas', () => {
  const canvas = defaultCanvas();
  const layer = createCellPaintLayer({ settings: { columns: 5, rows: 5 } });
  const cells = layerLattice(layer, canvas);
  assert.ok(cells.some(c => contains({ x: canvas.width - 0.1, y: canvas.height - 0.1 }, c.corners)));
  assert.equal(setLayerSetting(layer, 'hullMode', 'tight', canvas).settings.hullMode, 'tight');
});
