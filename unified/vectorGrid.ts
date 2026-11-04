import { sampleSpatialIndex, recordSampleChanges } from './sampleSpatial';
import { gridCellsInBounds, makeVectorField, vectorBrushOp, constrainVector, type NCTGraphiteDocumentCanvas, type NCTGraphiteGridCell, type VectorFieldLimits, type VectorSample } from '@nct/nctgraphite';

export type VectorGridKind = 'square' | 'triangle' | 'hex';
export function vectorGridCells(kind: VectorGridKind, columns: number, rows: number, canvas: NCTGraphiteDocumentCanvas): NCTGraphiteGridCell[] {
  const spacing = Math.min(canvas.width / columns, canvas.height / rows);
  const spec = { kind: kind === 'triangle' ? 'tri-horiz' as const : 'hex-flat' as const, size: kind === 'triangle' ? spacing * 1.55 : spacing / Math.sqrt(3), origin: { x: 0, y: 0 } };
  return gridCellsInBounds(spec, { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height }).filter(c => c.center.x >= 0 && c.center.y >= 0 && c.center.x <= canvas.width && c.center.y <= canvas.height);
}
export function makeGridVectors(kind: VectorGridKind, columns: number, rows: number, canvas: NCTGraphiteDocumentCanvas): VectorSample[] {
  if (kind === 'square') return makeVectorField(columns, rows, canvas.width, canvas.height);
  return vectorGridCells(kind, columns, rows, canvas).map(c => ({ x: c.center.x, y: c.center.y, vx: 0, vy: 0 }));
}

/** Spatial buckets support interpolation and local brush neighborhoods on every lattice. */
export function vectorLookup(vectors: readonly VectorSample[], spacing: number) {
  const index = sampleSpatialIndex(vectors, spacing);
  const nearest = (x: number, y: number, maxDistance = Math.max(1, spacing) * 2) => index.within(x, y, maxDistance)
    .map(hit => ({ sample: vectors[hit.index], d: hit.d })).sort((a, b) => a.d - b.d);
  const interpolate = (x: number, y: number) => {
    const hits = nearest(x, y).slice(0, 4);
    if (!hits.length) return { vx: 0, vy: 0 };
    if (hits[0].d < 1e-6) return { vx: hits[0].sample.vx, vy: hits[0].sample.vy };
    let vx = 0, vy = 0, total = 0;
    for (const { sample, d } of hits) { const w = 1 / (d * d); total += w; vx += sample.vx * w; vy += sample.vy * w; }
    return { vx: vx / total, vy: vy / total };
  };
  const magnitude = (x: number, y: number) => {
    const hits = nearest(x, y).slice(0, 4);
    if (!hits.length) return 0;
    if (hits[0].d < 1e-6) return Math.hypot(hits[0].sample.vx, hits[0].sample.vy);
    let value = 0, total = 0;
    for (const { sample, d } of hits) { const w = 1 / (d * d); value += Math.hypot(sample.vx, sample.vy) * w; total += w; }
    return value / total;
  };
  return { nearest, interpolate, magnitude };
}

export function stampGridVectors(field: readonly VectorSample[], options: { kind: VectorGridKind; spacing: number; x: number; y: number; radius: number; op: string; strength: number; velocityX?: number; velocityY?: number; limits: VectorFieldLimits }): VectorSample[] {
  const brush = vectorBrushOp(options.op), lookup = brush.needsNeighbors ? vectorLookup(field, options.spacing) : null;
  return field.map(sample => {
    const distance = Math.hypot(sample.x - options.x, sample.y - options.y);
    if (distance > options.radius) return sample;
    const neighbors = lookup ? lookup.nearest(sample.x, sample.y, options.spacing * 1.6).slice(0, options.kind === 'triangle' ? 4 : 7).map(hit => hit.sample) : undefined;
    const v = brush.apply({ sample, brushX: options.x, brushY: options.y, falloff: 1 - distance / options.radius, strength: options.strength, paintScale: 1, velocityX: options.velocityX ?? 0, velocityY: options.velocityY ?? 0, neighbors });
    return { ...sample, ...constrainVector(v.vx, v.vy, options.limits) };
  });
}

const vectorIndices = new WeakMap<readonly VectorSample[], ReturnType<typeof sampleSpatialIndex<VectorSample>>>();
/** Apply an operation only to samples within the brush while reading neighbors from the original field. */
export function stampLocalVectors(field: readonly VectorSample[], options: { kind: VectorGridKind; columns: number; rows: number; spacing: number; x: number; y: number; radius: number; op: string; strength: number; velocityX?: number; velocityY?: number; limits: VectorFieldLimits }): VectorSample[] {
  let index = vectorIndices.get(field);
  if (!index) { index = sampleSpatialIndex(field, options.spacing); vectorIndices.set(field, index); }
  const brush = vectorBrushOp(options.op), hits = index.within(options.x, options.y, options.radius).sort((a, b) => a.index - b.index);
  if (!hits.length) return field as VectorSample[];
  let next: VectorSample[] | undefined;
  const changed: number[] = [];
  for (const hit of hits) {
    const sample = field[hit.index];
    let neighbors: VectorSample[] | undefined;
    if (brush.needsNeighbors) {
      if (options.kind === 'square') {
        neighbors = [];
        const col = hit.index % options.columns, row = Math.floor(hit.index / options.columns);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = col + dx, y = row + dy;
          if (x >= 0 && y >= 0 && x < options.columns && y < options.rows) neighbors.push(field[y * options.columns + x]);
        }
      } else {
        neighbors = index.within(sample.x, sample.y, options.spacing * 1.6).sort((a, b) => a.d - b.d).slice(0, options.kind === 'triangle' ? 4 : 7).map(item => field[item.index]);
      }
    }
    const written = brush.apply({ sample, brushX: options.x, brushY: options.y, falloff: 1 - hit.d / options.radius, strength: options.strength, paintScale: 1, velocityX: options.velocityX ?? 0, velocityY: options.velocityY ?? 0, neighbors });
    const value = constrainVector(written.vx, written.vy, options.limits);
    if (sample.vx === value.vx && sample.vy === value.vy) continue;
    next ??= field.slice();
    next[hit.index] = { ...sample, ...value }; changed.push(hit.index);
  }
  if (!next) return field as VectorSample[];
  recordSampleChanges(next, field, changed);
  vectorIndices.set(next, index);
  return next;
}
