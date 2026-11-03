# Unified Grid Paint App: overlap and layer model

This inventory describes the five labs currently loaded by the app switcher. It is a migration map, not a claim that their data models are already interchangeable. In particular, “grid” means different things in different labs: a cell mesh, a set of sample points, or a field sampling resolution.

## Lab inventory

| Lab | Grid / spatial model | Editable data | Main settings | Commands and current defaults | Exports and persistence |
|---|---|---|---|---|---|
| **Grid Cell Hull** (`Grid+Cell+Hull+Lab`) | Cell mesh: square, horizontal hex, horizontal hex split into diamonds, vertical hex, horizontal triangle, vertical triangle. Cells carry corners/edges, parent/root and subdivision level; topology includes adjacency and resolved T-junctions. Cell size and jitter generate the base mesh. | Active cell IDs; adaptively subdivided/coarsened mesh with parent records and per-cell shape scale; derived hulls/clusters. | Cell size, subdivision depth/target, jitter, paint and subdivision falloff, shape scale, snap-to-centers/directions/tolerance, brush radius/shape/angle, hull mode (tight/smooth/convex/concave), smoothing radius, fill/outline/division/subdivision visibility, opacity/stroke, cluster colors, live hull, shirt mockup. | `F` paint, `E` erase, `D` subdivide, `S` coarsen, `T/Y` scale cells, `Q` smooth gaps, `V` recompute hull, `X` clear (`Shift+X` invert), `C` new color, `M` grid, `L` shape fill, `B` brush shape, `;/'` rotate, `[/]` brush size. Grid: `1` square, `2` hex horiz, `0` hex diamond, `3` hex vert, `4/5` triangles horiz/vert. Hull mode: `6–9`. | SVG, PNG. Session records through `records.list/create/delete` in `hull_sessions`; load/save data includes grid type, active IDs, cell size, hull mode, smooth radius (and session metadata). |
| **Hex Grid Cell Paint** (`Hex+Grid+Cell+Paint`) | Axial hex lattice: flat-top, pointy-top, or square; size and rows/columns determine visible cells. | Per-cell active state, color, group, activation time; current and secondary palette colors. | Hex size, rows/columns, brush radius, falloff, centers/grid-line visibility, active palette color. | `F` primary paint, `G` secondary paint, `E` erase, `Q` toggle, `X` clear (Shift behavior supported), `C` new color, `[/]` brush size. Grid: `1` flat, `2` pointy, `3` square. | SVG; persistent painting records through `records.list/create/delete` in `paintings`. Save UI describes a 340-cell/16KiB limit. |
| **Grid Dot Shading** (`Grid+Dot+Shading+Lab`) | Rectangular lattice of sample points with optional positional jitter; columns/rows define density. This is not a polygon cell mesh. | Per-point position/base position, radius (gain), rotation, row/column. | Columns, rows, jitter amount/on-off, grid-line visibility, min/max radius, shape (circle/diamond/square/triangle/line/cross/plus), fill/stroke, mono/density/group color, rotation mode and jitter, brush radius, intensity, falloff type/power. | `F` grow, `E` shrink, `Q` smooth, `X` reset gain in brush, `[/]` radius, `-/=` intensity, `C` cycle shape, `R` re-jitter. | SVG, PNG. Preset persistence via `records.list/create/delete` in `presets`; presets store shading parameters, while the radius field is editable art data. |
| **Arc Metaball Grid** (`Arc+Metaball+Grid+Lab`) | Resolution-based sampling lattice (grid resolution plus derived rows); optional snap-to-grid. It drives field heatmap/contour and adherence visualization, rather than defining paintable polygon cells. | Blob stamps with position, radius, positive/negative/sticky type, color group/color. Contours, components and Sato neck geometry are derived. | Engine: FIELD contour or ARC/Sato; grid resolution, bridge distance factor K, goo, handle size, adherence display. Stamp: brush radius, circle/round-rect, aspect/corner, noise toggle/preset, placement mode, color. Display: snap, influence, heatmap, bridge preview, construction, Bezier smoothing. | `F` place, `G` inflate, `H` negative stamp, `B` bridge, `E` erase, `Q` smooth, `N` color group, `[/]` brush, `X` clear current group (`Shift+X` all). | SVG in both contour and Sato/arc forms. No separate structured save/load flow found in this lab. |
| **Grid Paint Vector Field** (`Grid+Paint+Vector+Field+Key`) | Regular rectangular vector lattice (`cols × rows`) across the canvas. It is not currently a selectable geometric tiling. | Vector `(vx, vy)` per grid point and attractors `(id,x,y,r,orbit)`; particles/trails are a visualization/simulation state. | Grid columns/rows; field mode (seek/velocity/swirl); brush radius, strength, particle count; show vectors/particles/attractors/trails, hover thinning. | `F` paint flow; `G/V/C` momentary seek/velocity/swirl paint; `E` zero vectors; `Q` smooth; `N` add attractor; `[/]` brush size; `X` clear field. | JSON export/import for columns, rows, vectors and attractors. |

## What overlaps

- **Canvas interaction:** all five use pointer position to aim and keyboard actions to modify art. All have a brush or stamp footprint, though brush semantics vary (cell selection, point influence, blob stamping, vector influence).
- **Commands and key rebinding:** each lab registers commands through NCTGraphite; an in-app key map is exposed in some labs but not consistently in all five. Several defaults collide (`F`, `E`, `Q`, `X`, brackets, `C`, `N`), so the unified app must dispatch commands only to the selected layer/mode. Inactive layers must not retain key listeners or held-action state.
- **Grid geometry and sampling:** Hull and Hex Paint need reusable cell geometry and topology. Dot Shading needs regular/jittered sample positions. Metaballs need a sampling lattice for field evaluation and optional snapping. Vector Field needs a regular sample lattice with vector-valued cells. These can share coordinate/spacing helpers, but not one forced cell data representation.
- **Common settings:** canvas/document dimensions, grid visibility, brush radius, and snap behavior recur. Store common settings only where semantics truly match; keep each mode’s controls in its own settings namespace.
- **Rendering and export:** all modes render a visual result and most have vector or raster export. Export code is mode-specific today, and vector-field JSON is a data export rather than an image export.
- **Persistence:** Hull, Hex Paint, and Dot Shading call the `actions` records API for saved sessions/paintings/presets. Metaball has no equivalent structured save flow; Vector Field uses local JSON import/export. A unified document format should be distinct from these existing backend record formats, with adapters if those records remain supported.

## Proposed document and layer model

The document owns shared canvas/view state and an ordered list of layers. Each layer is a self-contained mode instance. Its `mode` selects the data/settings schema, panel definition, command definitions, renderer, and export handlers. `grid` records the spatial scheme and parameters; `data` is mode-specific. Visibility and order affect compositing. `activeLayerId` selects the only layer whose controls and keyboard commands are active.

```ts
type GridSpec =
  | { kind: "cell-mesh"; topology: "square" | "hex-horizontal" | "hex-horizontal-diamond" | "hex-vertical" | "triangle-horizontal" | "triangle-vertical"; cellSize: number; jitter: number }
  | { kind: "axial-cells"; topology: "hex-flat" | "hex-pointy" | "square"; size: number; columns: number; rows: number }
  | { kind: "sample-lattice"; topology: "rectangular"; columns: number; rows: number; jitter?: number }
  | { kind: "field-lattice"; topology: "rectangular"; columns: number; rows: number }
  | { kind: "implicit-sampling"; topology: "rectangular"; resolution: number; rows: number };

type LayerBase = {
  id: string;
  name: string;
  grid: GridSpec;
  visible: boolean;
  opacity?: number;
  blendMode?: "normal"; // expand only when a real use case needs another blend
};

type Layer =
  | (LayerBase & { mode: "hull"; grid: Extract<GridSpec, { kind: "cell-mesh" }>; data: HullData; settings: HullSettings })
  | (LayerBase & { mode: "cell-paint"; grid: Extract<GridSpec, { kind: "axial-cells" }>; data: CellPaintData; settings: CellPaintSettings })
  | (LayerBase & { mode: "dot-shading"; grid: Extract<GridSpec, { kind: "sample-lattice" }>; data: DotShadingData; settings: DotShadingSettings })
  | (LayerBase & { mode: "metaball"; grid: Extract<GridSpec, { kind: "implicit-sampling" }>; data: MetaballData; settings: MetaballSettings })
  | (LayerBase & { mode: "vector-field"; grid: Extract<GridSpec, { kind: "field-lattice" }>; data: VectorFieldData; settings: VectorFieldSettings });

type Document = {
  version: number;
  canvas: { width: number; height: number; background: string };
  view: { zoom: number; panX: number; panY: number };
  layers: Layer[]; // bottom to top; array position is draw order
  activeLayerId: string;
};
```

`data` should contain durable editable state, not derived output. For example, the Hull mesh and active cell IDs are durable while hull outlines are derived; Metaball contours/components and Vector Field particles/trails can be recomputed from blobs or vectors/attractors plus settings. Dot Shading should preserve point radii and any randomized positions (or a reproducible seed) so reopening a document does not change the artwork. Use discriminated mode schemas and version the document so future migrations can translate old layers safely.

### Selection and commands

On active-layer change, the app selects that layer’s control panel and command set. A single app-level keyboard dispatcher resolves the current active layer at event time, routes key-down/repeat/key-up to that mode, and clears held actions when focus leaves the canvas, a text input receives focus, the layer changes, or the layer is hidden/deleted. Rebinding belongs to the active mode’s commands; commands with conflicting keys are safe because inactive modes do not receive them. Layer visibility/order controls rendering and hit testing; hidden layers cannot receive paint input. A locked flag may be added later if editing inactive visible layers becomes necessary.

### Shared grid library boundary

NCTGraphite’s grid library owns grid descriptions and geometry operations: generate cells or sample positions, map screen/document points to grid coordinates, calculate centers/vertices/bounds, enumerate neighbors where meaningful, and provide hit testing. Graphics math lives in `utilities/graphics/` (`hull.ts`, `metaballField.ts`, `satoNeck.ts`, `vectorField.ts`). Apps own painting, layer schemas, colors, and UI. Diamond and triangle cells stay distinct polygons; hull clustering uses shared edges.

## Status

- [x] Square, hex-flat, and hex-pointy geometry in NCTGraphite (`NCTGraphiteGridGeometry`).
- [x] Document-to-viewport fit used for drawing, pointer, and brush (`NCTGraphiteViewport`).
- [x] NSDocument-style store in NCTGraphite: `NCTGraphiteDocument` / `NCTGraphiteDocumentController`, dirty flag, undo, JSON snapshot. Mode data stays on the layer.
- [x] Unified app: Hex Paint and Hull as independently selectable layers; active layer owns keys and the parameter panel; hidden layers do not receive paint.
- [x] Six Hull topologies as distinct grid kinds (`square`, `hex-flat`, `hex-flat-diamond`, `hex-pointy`, `tri-horiz`, `tri-vert`). Diamond-split and triangles are not aliases of ordinary hexes.
- [x] Hull outlines: tight (cluster perimeter), convex, smooth (Chaikin on tight), concave (tight).
- [x] Hull, metaball, and vector-field math in NCTGraphite `utilities/graphics/` (`hull.ts`, `metaballField.ts`, `satoNeck.ts`, `vectorField.ts`).
- [ ] Hull adaptive subdivision, coarsen, jitter, and per-cell shape scale.
- [x] Metaball and Vector Field layers on those graphics utilities.
- [x] Sampling-grid adapters and a Dot Shading layer (`utilities/graphics/sampleLattice.ts`, Dot Shading layer in the unified document).
- [x] Document save/open UI on `.nctgdoc.json`.
- [x] Adapters for existing lab `records` and Vector Field JSON (`unified/records.ts`; Open detects lab JSON, Export writes the active layer).
- [ ] Mode-specific SVG/PNG export from the document.

## Migration implications

1. [x] Implement and validate the grid descriptors/adapters, starting with square and the two hex orientations used by Hull and Hex Paint. Preserve the existing six Hull topologies as distinct values; do not silently alias its diamond-split or triangle grids to ordinary hexes.
2. [x] Add a document/layer store with mode-discriminated state and active-layer command routing. Migrate Hull and Hex Paint first because they exercise polygon geometry, topology, selection, and colliding commands.
3. [x] Port Dot Shading through a sampling-grid adapter. Bridge existing backend saves and Vector Field JSON through import/export adapters. SVG/PNG export is still open.
4. [x] Keep canvas sizing/view transforms at the document stage boundary. The current apps use fixed 900×660 or 960×680 coordinates, so converting to a viewport-filling canvas needs a common document-to-screen transform used consistently for drawing, pointer input, brush overlays, and exports. (Save/export of that document is still open under item 3.)
