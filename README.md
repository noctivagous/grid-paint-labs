# grid-paint-labs

These are demos of key-clicks, using the keyboard keys
in place of mouse buttons, to deposit and manipulate shapes.

Mouse aims, keys act: the cursor positions, but only
holding a key deposits anything. Open either file in a
browser — no backend, no build step.

## App switcher

[index.html](index.html)
loads any lab from [lab-sources/](lab-sources)
(Hull, Dot Shading, Hex Paint, Metaball Grid, Vector Field) into one page: pick a lab
in the top bar, or deep-link with `?app=hull`.
It compiles the `App.tsx` + `index.css` sources live in
the browser — it does not load the prebuilt files in
[standalone-html/](standalone-html),
which are independent static copies.
Run the original labs with `npm run dev:multiapp` (serves
`index.html` plus the lab sources raw via `vite.config.js`
on port 8123), or with `python3 -m http.server`; opened
via `file://` it asks you to pick the folder instead.
Needs network for the React/Babel/Tailwind CDNs.

The unified Paper.js app is the default: `npm run dev`
serves it at http://127.0.0.1:8124/.

## Artifacts

### [Arc-Metaball-Grid-Lab.html](standalone-html/Arc-Metaball-Grid-Lab.html)

Arc-metaball playground using the Paper.js "Sato exact"
method (Hiroyuki Sato, no marching squares). Circles on a
snappable grid are bridged with arc/bezier neck paths
(`M p1 C h1 h3 p3 A r r 0 esc 0 p4 C h4 h2 p2 Z`).

- Placement: `G` positive blob, `H` negative blob,
  `F` inflate, `B` bridge via neck blob, `E` erase,
  `Q` smooth, `N` new color, `[` / `]` resize,
  `X` clear, `X` (shift) clear all. Keys are rebindable.
- Engine sliders: grid resolution, max-dist factor
  (bridges only if `d <= r1 + r2*K`, Sato orig 2.5),
  goo tightness `v`, handle size, brush radius.
- Toggles: snap to grid, show influence, heatmap,
  bridge preview, adherence visualization,
  **field contour (d3-contour / marching squares)** — see
  [refs/arc-metaball-marching-squares.md](refs/arc-metaball-marching-squares.md).
- Color groups with a live component list and
  one-click SVG export of the Sato paths.

### [Grid-Paint-Field-Key.html](standalone-html/Grid-Paint-Field-Key.html)

Vector-field painting lab: move to aim, hold a key to
paint flows, drop attractors, erase, or smooth.

- Keys (rebindable): `F` paint/flow, `E` erase (zeroes
  vectors), `Q` smooth (averages neighbors), `G` drop
  attractor, `[` / `]` brush size, `X` clear field.
- Field modes live in `VECTOR_BRUSH_OPS`: seek, velocity, swirl,
  swirl−, seek−, amplify, damp, rotate, smudge, drain, turbulence,
  normalize, and invert. `F` paints the selected mode.
- Controls: brush size (18–320), strength, grid
  resolution, particle count; live field and live
  attractor-field previews; flow preview.
- Export/import the field (vectors + attractors) as JSON;
  clear-all with confirm. Built as a playable talk demo.
