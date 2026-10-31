# grid-paint-labs

These are demos of key-clicks, using the keyboard keys
in place of mouse buttons, to deposit and manipulate shapes.

Mouse aims, keys act: the cursor positions, but only
holding a key deposits anything. Open either file in a
browser — no backend, no build step.

## Artifacts

### [Arc-Metaball-Grid-Lab.html](/Users/jpratt/Developer/grid-paint-labs/Arc-Metaball-Grid-Lab.html)

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
  bridge preview, adherence visualization.
- Color groups with a live component list and
  one-click SVG export of the Sato paths.

### [Grid-Paint-Field-Key.html](/Users/jpratt/Developer/grid-paint-labs/Grid-Paint-Field-Key.html)

Vector-field painting lab: move to aim, hold a key to
paint flows, drop attractors, erase, or smooth.

- Keys (rebindable): `F` paint/flow, `E` erase (zeroes
  vectors), `Q` smooth (averages neighbors), `G` drop
  attractor, `[` / `]` brush size, `X` clear field.
- Field modes: seek (vectors point at cursor), velocity
  (vectors follow mouse speed — whip fast for streams),
  swirl/vortex (attractors go orbital).
- Controls: brush size (18–320), strength, grid
  resolution, particle count; live field and live
  attractor-field previews; flow preview.
- Export/import the field (vectors + attractors) as JSON;
  clear-all with confirm. Built as a playable talk demo.
