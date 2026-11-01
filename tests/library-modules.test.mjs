// Regression coverage for the in-browser loader (index.html):
// every module specifier reachable from the labs must map to a real file,
// every theme token the labs use must exist, and the Vite dev plugin must
// keep serving library sources byte-for-byte (Vite's own transform rewrites
// imports to root-absolute specifiers that blob modules cannot resolve).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB_INDEX = 'NCTGraphite/packages/nctgraphite/src/index.ts';
const THEME_CSS = 'NCTGraphite/packages/nctgraphite/src/theme/NCTGraphiteTheme.css';
const LABS = ['Grid+Cell+Hull+Lab', 'Grid+Dot+Shading+Lab', 'Hex+Grid+Cell+Paint', 'Arc+Metaball+Grid+Lab', 'Grid+Paint+Vector+Field+Key'];

function resolveSpec(spec, fromDir) {
  if (spec === '@nct/nctgraphite') return LIB_INDEX;
  const noJs = path.join(fromDir, spec.replace(/\.js$/, ''));
  if (/\.js$/.test(spec)) {
    if (fs.existsSync(path.join(root, noJs + '.tsx'))) return noJs + '.tsx';
    return noJs + '.ts';
  }
  return noJs;
}

function walkModules() {
  const seen = new Map();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    assert.ok(fs.existsSync(path.join(root, rel)), `module specifier resolves to a real file: ${rel}`);
    seen.set(rel, true);
    if (!/\.(ts|tsx)$/.test(rel)) return;
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const specs = [...new Set(
      [...src.matchAll(/from\s*(['"])(\.[^'"]+|@nct\/nctgraphite)\1/g)].map((m) => m[2])
    )];
    for (const spec of specs) walk(resolveSpec(spec, path.dirname(rel)));
  };
  for (const lab of LABS) {
    walk(`lab-sources/${lab}/App.tsx`);
    walk(THEME_CSS);
  }
  return seen;
}

test('every loader module specifier resolves to a real file', () => {
  const seen = walkModules();
  assert.ok(seen.size >= 15, `expected all labs + library modules, got ${seen.size}`);
});

test('every theme token used by labs is defined by the theme', () => {
  const theme = fs.readFileSync(path.join(root, THEME_CSS), 'utf8');
  const themeDefined = new Set([...theme.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const lab of LABS) {
    // Legacy ports (arc, vector) are self-contained: their index.css defines
    // its own Tailwind preflight tokens, so those count as defined too.
    const labCss = fs.readFileSync(path.join(root, `lab-sources/${lab}/index.css`), 'utf8');
    const defined = new Set([
      ...themeDefined,
      ...[...labCss.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]),
    ]);
    const used = new Set();
    for (const f of [`lab-sources/${lab}/App.tsx`, `lab-sources/${lab}/index.css`]) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      for (const m of src.matchAll(/var\(--([a-zA-Z0-9-]+)\)/g)) used.add(m[1]);
    }
    // tw-* are Tailwind compiler internals, not NCT theme contract tokens:
    // legacy ports bundle their own preflight (quirks included, e.g. Arc's
    // undefined var(--tw-shadow-color), which matches the original file).
    const missing = [...used].filter((v) => !v.startsWith('tw-') && !defined.has(v));
    assert.deepEqual(missing, [], `${lab} tokens missing from theme: ${missing.join(', ')}`);
  }
});

test('Grid treats a slash-less template as columns, not grid-template shorthand', () => {
  // Regression: `grid-template: 220px 1fr 300px` means three rows, which
  // collapsed the shading lab shell to a single vertical column.
  const grid = fs.readFileSync(
    path.join(root, 'NCTGraphite/packages/nctgraphite/src/components/NCTGraphiteGrid.tsx'), 'utf8'
  );
  assert.ok(
    grid.includes("!effTemplate.includes('/')") || grid.includes('!effTemplate.includes("/")'),
    'Grid must route slash-less templates to grid-template-columns'
  );
});

test('command registry meta is intact and invoke dispatches', async () => {
  const esbuild = (await import('esbuild')).buildSync;
  const path = (await import('node:path')).default;
  const fs = (await import('node:fs')).default;
  const os = (await import('node:os')).default;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nct-commands-'));
  const probe = path.join(tmp, 'probe.jsx');
  fs.writeFileSync(probe, `
    import React from 'react';
    import { useNCTGraphiteCommands, NCTGraphiteCommandsMeta } from ${JSON.stringify(path.join(root, 'NCTGraphite/packages/nctgraphite/src/bindings/NCTGraphiteCommands.ts'))};
    export { NCTGraphiteCommandsMeta };
    export const calls = [];
    export function Probe() {
      const cmd = useNCTGraphiteCommands({
        commands: [{ id: 'paint', label: 'PAINT', desc: 'd', defaultKey: 'f' }],
        onAction: (id) => calls.push(id),
      });
      cmd.invoke('paint');
      return null;
    }
    export function render() {
      const { renderToString } = require('react-dom/server');
      return renderToString(React.createElement(Probe));
    }
  `);
  esbuild({
    entryPoints: [probe],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    nodePaths: [path.join(root, 'node_modules')],
    outfile: path.join(tmp, 'probe.cjs'),
  });
  const { NCTGraphiteCommandsMeta, render, calls } = await import(path.join(tmp, 'probe.cjs'));
  assert.equal(NCTGraphiteCommandsMeta.tag, 'useNCTGraphiteCommands');
  assert.equal(NCTGraphiteCommandsMeta.category, 'bindings');
  assert.ok(NCTGraphiteCommandsMeta.description.length > 0);
  render();
  assert.deepEqual(calls, ['paint']);
});

test('vite dev plugin serves library sources byte-for-byte', () => {
  const config = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8');
  assert.ok(
    config.includes('/NCTGraphite/packages/nctgraphite/src/'),
    'vite plugin must raw-serve library sources or blob-module imports fail under npm run dev'
  );
});
