For architects/designers, Grasshopper is interesting not because it's 3D, but because it's **attractor + field + tiling + subdivision with live feedback**. You can get all of that in 2D, and key-clicks actually make it *more* performative than sliders.

Here are the 2D parametric practices that map directly to labs we've already built — and would be shirt / wallpaper / facade ready:

### 1. Wallpaper Groups — the 17 plane symmetries
This is the foundation of ornament. Not just mirror X/Y.

- **Frieze groups (7)** for bands / borders / shirt hems
- **Wallpaper groups (17)** — p1, pmm, p4m, p6m etc. Hex grid you already have is p6m naturally.
- In Grasshopper this is `Symmetry` + `Array`. In key-click lab: brush paints in fundamental domain, lab mirrors it live with `p6m` etc.

**Lab version:** Paint a motif in one triangle of a hex cell with `F`, see it tiled p6m instantly. `M` cycles wallpaper group. This alone is a full textile lab. Owen Jones' *Grammar of Ornament* is basically 17 groups with different motifs.

### 2. Truchet + Wang Tiles — controlled randomness
From Islamic tilings to 1970s Truchet to contemporary architecture facades.

- Base tile has 2-4 arc/line configurations, rotated by field or random
- Rules: `if neighbor is X, this tile must be Y` — Wang tiles give you non-repeating but coherent fields
- **Key-click mapping:** Grid activation = place tile, field angle = tile rotation, `Q` smooth = make neighbors match.

You already have this 80% — Dot Lab's diamond/line shapes with rotation driven by field *is* a Truchet system. Just add rule enforcement.

Shirt outcome: looks like maze / interlocking pattern, but parametric.

### 3. Attractor Logic — the Grasshopper bread and butter
Every Grasshopper definition has 3 attractors:

- **Point attractor:** scale/rotation = f(distance to brush). You have this with falloff ` (1-d/R)^power`.
- **Curve attractor:** scale = distance to streamline (your fibers). Perfect for bands that get denser near flow lines.
- **Field attractor:** scale/rotation = sample field. You have this.

For designers: expose as **remapping graph** — small curve editor where X = distance to brush, Y = scale. Lets you make motifs fade, pulse, invert. Much more design control than just bigger/smaller.

### 4. Islamic Girih / Zellige — shape grammar on grid
- Start with hex grid, but each cell contains a **girih tile** (decagon, pentagon, bowtie) with notches
- Rule: when two cells activate, their straps connect if angles match
- Result: interlaced star patterns that architects use for screens / facades

**Key-click version:** `F` activates hex cells, lab auto-draws strapwork connecting active cells using Sato arcs. `E` erases, pattern re-routes live. This is exactly your hex activation + metaball merge, but with star logic.

### 5. Subdivision + Aggregation — the growth patterns
- **Subdivision:** Start coarse, subdivide where field strength high (you built this in Stipple Lab). For ornament, subdivide hex into 4 smaller hexes, or triangle into 4.
- **Aggregation:** DLA, particle aggregation along field — dots that walk along field and stick to existing cluster. Gives you coral / lichen growth that still follows your painted flow.

For wallpaper, subdivision gives you hierarchy: large motifs in sparse areas, fine texture where you lingered.

### 6. Voronoi / Delaunay / Packing — figure-ground control
- Take your activated points (from stipple lab with repulsion), run Delaunay → Voronoi. Each cell becomes a tile you can fill with motif or leave as shirt color.
- Packing: biggest possible circles that don't overlap, sized by field. Architects use this for perforated facades.

**Key-click:** `F` grows points, repulsion pushes them apart (you have), `V` generates Voronoi live. Immediately usable as laser-cut pattern or print.

### 7. L-Systems + Shape Grammars — line-based ornament
- Simple 2D L-system: `F = draw line, + = turn by field angle, [ ] = push/pop`. Growth follows your painted field.
- Shape grammar: replace triangle with 3 smaller triangles if within brush.

Gives you branching / meander / Greek key patterns that are field-driven, not random.

### 8. Interlace / Knotwork / Moire
- Two streamline systems at different angles → weave over/under at intersections. Classic ornament band.
- Moire from two slightly rotated grids — live as you paint rotation field.

---

### What I'd actually build next as one lab for designers

**2D Parametric Ornament Lab — Grasshopper-in-2D with key-clicks:**

- Base: hex + square + tri grid, switchable, with wallpaper group selector (p1, pmm, p6m etc)
- Brush: circle is **attractor** — falloff graph editor, not just radius
- Layers:
  - Mask (hex activation) = domain
  - Field (flow/radial/swirl) = orientation + warp
  - Motif (Truchet tile / girih strap / dot) = placed on points, rotation = field, scale = attractor graph
  - Merge (Sato arcs) = motifs within blend fuse into larger ornaments
  - Voronoi toggle = show cells of current points for facade / textile cut
- Live: everything updates as you paint, field hidden unless toggled, result is clean vector with 2-3 color groups
- Export: SVG with groups labeled `tile_`, `strap_`, `cell_` — architects can take into Rhino, designers to Illustrator for shirt.

That's Grasshopper's `Attractor → Field → Tile → Cull → Voronoi` chain, but you perform it with `[ ] F G E` instead of wiring nodes.

If you want one practice to start with that designers instantly recognize, start with **Wallpaper Groups + Truchet tiles + Attractor graph** — it's the most textile / facade relevant and uses all your existing grid + field + rotation logic.

Want me to build that ornament lab with p6m + truchet + attractor remapping as the core?
