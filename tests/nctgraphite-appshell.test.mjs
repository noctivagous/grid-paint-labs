// Focused coverage for the NCTGraphiteAppShell layout container:
// header/footer slots, N sections (default 3), orientation, proportion,
// min/max width, clamp/pad, and nested subdivision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB_INDEX = path.join(root, 'NCTGraphite/packages/nctgraphite/src/index.ts');

async function loadProbe() {
  const { buildSync } = await import('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nct-appshell-'));
  const probe = path.join(tmp, 'probe.jsx');
  fs.writeFileSync(probe, `
    import React from 'react';
    import {
      NCTGraphiteAppShell, NCTGraphiteAppShellMeta,
    } from ${JSON.stringify(LIB_INDEX)};
    export const meta = NCTGraphiteAppShellMeta;
    export function render() {
      const { renderToString } = require('react-dom/server');
      const sec = (name) => React.createElement('div', { 'data-sec': name }, name);
      return {
        base: renderToString(
          React.createElement(NCTGraphiteAppShell, {
            header: React.createElement('div', null, 'HDR'),
            footer: React.createElement('div', null, 'FTR'),
          }, sec('A'), sec('B'), sec('C'))
        ),
        bare: renderToString(
          React.createElement(NCTGraphiteAppShell, null, sec('ONLY'))
        ),
        clamp: renderToString(
          React.createElement(NCTGraphiteAppShell, { sectionCount: 2 }, sec('A'), sec('B'), sec('C'))
        ),
        column: renderToString(
          React.createElement(NCTGraphiteAppShell, { sectionCount: 2, orientation: 'column', proportion: '100px 1fr' }, sec('A'), sec('B'))
        ),
        weights: renderToString(
          React.createElement(NCTGraphiteAppShell, { sectionCount: 3, proportion: [1, 2, 1], minWidth: 320, maxWidth: 1400 }, sec('A'), sec('B'), sec('C'))
        ),
        nested: renderToString(
          React.createElement(NCTGraphiteAppShell, { sectionCount: 2 },
            sec('TOP'),
            React.createElement(NCTGraphiteAppShell, { sectionCount: 2 }, sec('L'), sec('R')))
        ),
      };
    }
  `);
  buildSync({
    entryPoints: [probe],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    nodePaths: [path.join(root, 'node_modules')],
    outfile: path.join(tmp, 'probe.cjs'),
  });
  return import(path.join(tmp, 'probe.cjs'));
}

test('NCTGraphiteAppShell carries layout Meta contract', async () => {
  const { meta } = await loadProbe();
  assert.equal(meta.tag, 'NCTGraphiteAppShell');
  assert.equal(meta.category, 'layout');
  assert.equal(meta.props.sectionCount.default, 3);
  assert.deepEqual(meta.props.orientation.type, ['row', 'column']);
  assert.ok(meta.props.proportion.description.includes('220px 1fr 300px'));
  assert.equal(meta.props.maxWidth.default, 1600);
  assert.ok(meta.slots.header && meta.slots.footer && meta.slots.default);
  assert.ok(meta.dependencies.includes('NCTGraphiteGrid'));
});

test('NCTGraphiteAppShell renders header, footer, and three sections', async () => {
  const { render } = await loadProbe();
  const out = render();
  assert.ok(out.base.includes('HDR') && out.base.includes('FTR'));
  assert.ok(out.base.includes('<header') && out.base.includes('<footer'));
  assert.ok(out.base.includes('data-sec="A"') && out.base.includes('data-sec="B"') && out.base.includes('data-sec="C"'));
  assert.ok(out.base.includes('max-width:1600px'), 'default max width applies');
});

test('NCTGraphiteAppShell collapses chrome and pads missing sections', async () => {
  const { render } = await loadProbe();
  const out = render();
  assert.ok(!out.bare.includes('<header') && !out.bare.includes('<footer'), 'omitted chrome collapses');
  assert.ok(out.bare.includes('data-sec="ONLY"'));
  assert.equal(out.bare.split('<section').length - 1, 3, 'one child plus empty containers pad to the default three');
});

test('NCTGraphiteAppShell clamps extras and honors column proportions', async () => {
  const { render } = await loadProbe();
  const out = render();
  assert.ok(out.clamp.includes('data-sec="A"') && out.clamp.includes('data-sec="B"'));
  assert.ok(!out.clamp.includes('data-sec="C"'), 'fourth child clamps at sectionCount 2');
  assert.ok(out.column.includes('grid-template-rows:100px 1fr'), 'column proportion reaches track style');
});

test('NCTGraphiteAppShell applies widths and nests subdivisions', async () => {
  const { render } = await loadProbe();
  const out = render();
  assert.ok(out.weights.includes('min-width:320px') && out.weights.includes('max-width:1400px'));
  assert.ok(out.nested.includes('data-sec="TOP"') && out.nested.includes('data-sec="L"') && out.nested.includes('data-sec="R"'));
});

test('NCTGraphiteAppShell stretches body and section children to fill leftover height', async () => {
  const { render } = await loadProbe();
  const out = render();
  assert.ok(out.base.includes('flex:1 1 0%'), 'body and grid consume leftover viewport');
  assert.ok(out.base.includes('min-height:0;height:100%;display:grid'), 'each section is a stretched grid cell');
});
