import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POP = path.join(root, 'NCTGraphite/packages/nctgraphite/src/components/NCTGraphitePopover.tsx');

async function loadPopover() {
  const { buildSync } = await import('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nct-popover-'));
  const outfile = path.join(tmp, 'popover.cjs');
  buildSync({
    entryPoints: [POP],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
  });
  return import(outfile);
}

test('computeNCTGraphitePopoverPosition keeps panel inside viewport', async () => {
  const { computeNCTGraphitePopoverPosition } = await loadPopover();
  const vw = 800;
  const vh = 600;
  const vp = { width: vw, height: vh };
  const panel = { width: 260, height: 120 };
  const nearRight = { left: 700, top: 100, right: 720, bottom: 120, width: 20, height: 20, x: 700, y: 100, toJSON: () => ({}) };
  const p = computeNCTGraphitePopoverPosition(nearRight, panel, 8, 6, vp);
  assert.ok(p.left >= 8);
  assert.ok(p.top >= 8);
  assert.ok(p.left + panel.width <= vw - 8);
  assert.ok(p.top + panel.height <= vh - 8);

  const nearBottom = { left: 100, top: 580, right: 120, bottom: 600, width: 20, height: 20, x: 100, y: 580, toJSON: () => ({}) };
  const p2 = computeNCTGraphitePopoverPosition(nearBottom, panel, 8, 6, vp);
  assert.ok(p2.top + panel.height <= vh - 8);
});

test('NCTGraphiteHint uses portaled popover markup', async () => {
  const theme = fs.readFileSync(path.join(root, 'NCTGraphite/packages/nctgraphite/src/theme/NCTGraphiteTheme.css'), 'utf8');
  assert.ok(theme.includes('.nctgraphite-popover'));
  const hint = fs.readFileSync(path.join(root, 'NCTGraphite/packages/nctgraphite/src/components/NCTGraphiteHint.tsx'), 'utf8');
  assert.ok(hint.includes('NCTGraphitePopover'));
});
