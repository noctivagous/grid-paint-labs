import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../NCTGraphite/packages/nctgraphite/src/grid/NCTGraphiteViewport.ts', import.meta.url), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const { fitDocumentToViewport, documentToViewport, viewportToDocument } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('fit centers the document and pointer coordinates round trip after resize', () => {
  const document = { width: 960, height: 720 };
  const point = { x: 100, y: 250 };
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 400, height: 900 }]) {
    const transform = fitDocumentToViewport(document, viewport);
    const screen = documentToViewport(point, transform);
    const result = viewportToDocument(screen, transform);
    assert.ok(Math.abs(result.x - point.x) < 1e-9);
    assert.ok(Math.abs(result.y - point.y) < 1e-9);
    assert.ok(transform.offsetX >= 0 && transform.offsetY >= 0);
    assert.ok(Math.abs(transform.offsetX * 2 + document.width * transform.scale - viewport.width) < 1e-9);
    assert.ok(Math.abs(transform.offsetY * 2 + document.height * transform.scale - viewport.height) < 1e-9);
  }
});

test('rejects zero dimensions and invalid scale', () => {
  assert.throws(() => fitDocumentToViewport({ width: 0, height: 10 }, { width: 10, height: 10 }), RangeError);
  assert.throws(() => viewportToDocument({ x: 0, y: 0 }, { scale: 0, offsetX: 0, offsetY: 0 }), RangeError);
});
