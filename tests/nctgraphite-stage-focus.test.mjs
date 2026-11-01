import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOCUS = path.join(root, 'NCTGraphite/packages/nctgraphite/src/bindings/NCTGraphiteStageFocus.ts');

async function loadFocus() {
  const { buildSync } = await import('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nct-stage-focus-'));
  const outfile = path.join(tmp, 'focus.cjs');
  buildSync({
    entryPoints: [FOCUS],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
  });
  return import(outfile);
}

test('panel widgets are not text entry; name fields are', async () => {
  const { isTextEntryControl } = await loadFocus();
  assert.equal(isTextEntryControl('input', 'range'), false);
  assert.equal(isTextEntryControl('input', 'checkbox'), false);
  assert.equal(isTextEntryControl('input', 'radio'), false);
  assert.equal(isTextEntryControl('input', 'file'), false);
  assert.equal(isTextEntryControl('input', 'color'), false);
  assert.equal(isTextEntryControl('button'), false);
  assert.equal(isTextEntryControl('input', 'text'), true);
  assert.equal(isTextEntryControl('input', ''), true);
  assert.equal(isTextEntryControl('textarea'), true);
  assert.equal(isTextEntryControl('select'), true);
  assert.equal(isTextEntryControl('div', '', true), true);
});

test('stage focus is installed on the app shell and the canvas hosts', () => {
  const shell = fs.readFileSync(path.join(root, 'NCTGraphite/packages/nctgraphite/src/components/NCTGraphiteAppShell.tsx'), 'utf8');
  const stage = fs.readFileSync(path.join(root, 'NCTGraphite/packages/nctgraphite/src/components/NCTGraphiteStage.tsx'), 'utf8');
  const hex = fs.readFileSync(path.join(root, 'lab-sources/Hex+Grid+Cell+Paint/App.tsx'), 'utf8');
  const shading = fs.readFileSync(path.join(root, 'lab-sources/Grid+Dot+Shading+Lab/App.tsx'), 'utf8');
  assert.ok(shell.includes('bindStageFocus'));
  assert.ok(stage.includes('data-nct-stage'));
  assert.ok(hex.includes('data-nct-stage'));
  assert.ok(shading.includes('data-nct-stage'));
});
