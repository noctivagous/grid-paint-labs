# Arc Metaball Lab — Marching Squares via d3-contour

Research notes for a **field + iso-contour** render path alongside the existing **Hiroyuki Sato / Paper.js** circle–circle necks.

## Why two engines?

| | Sato (default) | Marching squares (`d3-contour`) |
|--|----------------|-------------------------------|
| Geometry | Analytic necks between circles | Grid-sampled scalar field, iso-line at threshold τ |
| Merge | Pairwise `satoNeck` + union-find | Implicit where field ≥ τ |
| Sliders | `goo`, `handleSize`, `kFactor` are geometric | `goo` maps to τ; `gridRes` is contour resolution |
| SVG export | Compact circles + neck paths | Polygon rings (often more segments) |
| Stamps | Round rect = many circles + edge samples | Same blob list; field sums all circles |
| Holes | SVG mask from negative Sato cluster | Subtract negative field from positive |

The lab keeps **blobs as source of truth** (stamp, inflate, erase, round rect). Only the **renderer** switches.

## Scalar field (2D metaball)

Classic inverse-square sum (Bloomenthal-style), per sample point `(x, y)`:

```
F(x,y) = Σ  rᵢ² / max(ε, (x−cxᵢ)² + (y−cyᵢ)²)
```

- Positive blobs add; **negative (hole) blobs subtract** the same kernel.
- **Per color group:** contour separately with only that group’s positive blobs; holes subtract for all groups (cut through any fill).

Iso-surface at threshold **τ** (default **1**, tuned with goo):

```
τ = 0.4 + v × 1.1    where v = goo tightness (0.2…0.8)
```

Higher `v` → higher τ → tighter, smaller visible blobs (rough analog to Sato tightness).

## Marching squares

1. Sample `F` on a regular grid aligned with the lab (`gridRes × rows` cells → `(gridRes+1) × (rows+1)` samples at grid vertices).
2. For each cell, classify corners against τ (16 cases).
3. Interpolate crossing points on edges; stitch into closed rings.
4. Resolve **ambiguous saddle cases** — `d3-contour` implements standard MS stitching (center-average style on ambiguous cells).

References:

- [Marching squares (Wikipedia)](https://en.wikipedia.org/wiki/Marching_squares)
- [Resolving ambiguities (Asymptotic decider)](https://www.boristhebrave.com/2022/01/03/resolving-ambiguities-in-marching-squares/)
- [Jamie Wong — metaballs + MS](http://jamie-wong.com/2014/08/19/metaballs-and-marching-squares/)
- [jurasic.dev — interactive MS](https://jurasic.dev/marching_squares/)
- [d3-contour](https://github.com/d3/d3-contour) — production contour polygons from a flat grid

## d3-contour usage in this repo

Module: `lab-sources/Arc+Metaball+Grid+Lab/metaballField.ts`

```ts
import { contours } from 'd3-contour';

const width = gridRes + 1;
const height = rows + 1;
const values = new Float64Array(width * height); // F at each vertex
const contour = contours().size([width, height]).thresholds([tau]);
const polygons = contour(values);
```

Grid index `values[i + j * width]` ↔ canvas via:

```
x = i * (CANVAS_W / gridRes)
y = j * (CANVAS_H / rows)
```

(contour coordinates are in index space `[0, width] × [0, height]`; scale to pixels when building SVG `d`.)

## UI

- **Visual toggles → “Field contour (MS)”** switches live view and SVG export.
- Canvas badge: **LIVE CONTOUR** vs **LIVE SATO**.
- Bridge preview (Sato neck) is hidden in contour mode — merge is implicit in the field.

## Performance

Cost ≈ `(gridRes+1)(rows+1) × blobCount` per color group per frame. At 48×36 cells and tens of blobs this is fine in the browser; coarser grid = faster, chunkier outlines.

## Tests

`tests/arc-metaball-contour.test.mjs` — field at blob center, two-blob merge produces contour geometry, hole lowers field inside positive region.

## When to use which

- **Sato:** Paper.js–exact bridges, teaching the neck math, smallest SVG.
- **Contour:** Single outline per component, arbitrary stamp density without tuning `kFactor`, stepping stone toward field-based ornament labs (see `PARAMETRIC-DESIGN-USES.md`).
