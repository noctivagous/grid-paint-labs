// Focused coverage for the lab-idiom widgets added for the Arc/Vector ports:
// KeyMap, Dialog, Toast, and StageFooter render their contracts.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nct-widgets-'));
  const probe = path.join(tmp, 'probe.jsx');
  fs.writeFileSync(probe, `
    import React from 'react';
    import {
      NCTGraphiteKeyMap, NCTGraphiteKeyMapMeta,
      NCTGraphiteDialog, NCTGraphiteDialogMeta,
      NCTGraphiteToast, NCTGraphiteToastMeta,
      NCTGraphiteStageFooter, NCTGraphiteStageMeta,
      NCTGraphiteToggle, NCTGraphiteToggleMeta,
    } from ${JSON.stringify(LIB_INDEX)};
    export const metas = {
      keymap: NCTGraphiteKeyMapMeta,
      dialog: NCTGraphiteDialogMeta,
      toast: NCTGraphiteToastMeta,
      footer: NCTGraphiteStageMeta,
      toggle: NCTGraphiteToggleMeta,
    };
    const cmds = [
      { id: 'flow', label: 'FLOW', desc: 'paint vector flows', defaultKey: 'f' },
      { id: 'erase', label: 'ERASE', desc: 'erase vectors', defaultKey: 'e' },
    ];
    export function render() {
      const { renderToString } = require('react-dom/server');
      const noop = () => {};
      return {
        keymap: renderToString(React.createElement(NCTGraphiteKeyMap, {
          commands: cmds, keyMap: { flow: 'f', erase: 'e' }, rebinding: 'flow', onRebind: noop,
          heldActions: new Set(['flow']),
          emphasizeIds: new Set(['erase']),
        })),
        dialogOpen: renderToString(React.createElement(NCTGraphiteDialog, {
          open: true, onClose: noop, title: 'HELP', children: 'body text',
        })),
        dialogClosed: renderToString(React.createElement(NCTGraphiteDialog, {
          open: false, onClose: noop, title: 'HELP', children: 'body text',
        })),
        toast: renderToString(React.createElement(NCTGraphiteToast, { message: 'SAVED' })),
        toastNull: renderToString(React.createElement(NCTGraphiteToast, { message: null })),
        footer: renderToString(React.createElement(NCTGraphiteStageFooter, null, 'left', 'right')),
        toggleBox: renderToString(React.createElement(NCTGraphiteToggle, { label: 'OPT', checked: true, onChange: noop })),
        toggleSwitch: renderToString(React.createElement(NCTGraphiteToggle, { label: 'OPT', checked: false, onChange: noop, controlStyle: 'switch' })),
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

test('new lab-idiom widgets carry Meta contracts', async () => {
  const { metas } = await loadProbe();
  assert.equal(metas.keymap.tag, 'NCTGraphiteKeyMap');
  assert.equal(metas.keymap.category, 'widgets');
  assert.equal(metas.dialog.tag, 'NCTGraphiteDialog');
  assert.equal(metas.toast.tag, 'NCTGraphiteToast');
  assert.ok(metas.footer.description.includes('StageFooter'));
  assert.equal(metas.toggle.tag, 'NCTGraphiteToggle');
  assert.ok(metas.toggle.props.controlStyle.description.includes('"switch"'));
  assert.ok(metas.keymap.props.heldActions.description.includes('highlight'));
  assert.ok(metas.keymap.props.emphasizeIds.description.includes('accent'));
});

test('new lab-idiom widgets render their contracts', async () => {
  const { render } = await loadProbe();
  const out = render();
  assert.ok(out.keymap.includes('FLOW') && out.keymap.includes('PRESS KEY'));
  assert.ok(out.keymap.includes('bg-[#7c5cff]'), 'held key chip highlights');
  assert.ok(out.keymap.split('bg-[#7c5cff]').length - 1 >= 2, 'emphasized chip carries the accent persistently');
  assert.ok(out.keymap.includes('>E<') || out.keymap.includes('>E</div>'));
  assert.ok(out.dialogOpen.includes('HELP') && out.dialogOpen.includes('body text'));
  assert.equal(out.dialogClosed, '');
  assert.ok(out.toast.includes('SAVED'));
  assert.equal(out.toastNull, '');
  assert.ok(out.footer.includes('<footer') && out.footer.includes('left'));
  assert.ok(out.toggleBox.includes('type="checkbox"') && !out.toggleBox.includes('role="switch"'));
  assert.ok(out.toggleSwitch.includes('role="switch"') && !out.toggleSwitch.includes('type="checkbox"'));
});
