import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lab-sources/Grid+Cell+Hull+Lab/App.tsx'),
  'utf8',
);

test('hull lab maps D to subdivide and S to coarsen', () => {
  assert.match(src, /id: "subdivide"[\s\S]*defaultKey: "d"/);
  assert.match(src, /id: "coarsen"[\s\S]*defaultKey: "s"/);
  assert.match(src, /label="SUBDIVIDE"/);
});

test('hull lab splits squares into 4 and triangles into 4', () => {
  assert.match(src, /if \(p\.length === 3\)/);
  assert.match(src, /if \(p\.length === 4\)/);
  assert.match(src, /child\(\[p\[0\], m0, m2\]\)/);
  assert.match(src, /child\(\[p\[0\], m0, center, m3\]\)/);
});
