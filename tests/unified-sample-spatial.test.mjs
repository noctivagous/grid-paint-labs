import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const nct = fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url));
const result = await build({ stdin: { contents: `export { createDotShadingLayer, paintLayerAt, defaultCanvas } from './unified/layers.ts'; export { stampSampleGain } from '@nct/nctgraphite';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', alias: { '@nct/nctgraphite': nct }, logLevel: 'silent' });
const { createDotShadingLayer, paintLayerAt, defaultCanvas, stampSampleGain } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);

test('localized dot brushes match the full lattice for painting, smoothing and erasing', () => {
  const canvas = defaultCanvas();
  let layer = createDotShadingLayer(canvas);
  const point = { x: 450, y: 350 };
  for (const [action, stampAction] of [['paint', 'grow'], ['paint', 'grow'], ['smooth', 'smooth'], ['erase', 'shrink'], ['clear', 'clear']]) {
    const s = layer.settings;
    const expected = stampSampleGain(layer.data.points, { columns: s.columns, rows: s.rows, width: canvas.width, height: canvas.height, x: point.x, y: point.y, radius: s.brushRadius, action: stampAction, intensity: s.intensity, falloffType: s.falloffType, falloffPower: s.falloffPower, minRadius: s.minRadius, maxRadius: s.maxRadius, rotationMode: s.rotationMode, rotationJitter: s.rotationJitter });
    layer = paintLayerAt(layer, canvas, point, action);
    assert.deepEqual(layer.data.points, expected, action);
  }
});
