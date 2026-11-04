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
  const size = Math.max(1, spacing), buckets = new Map<string, VectorSample[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (const v of vectors) {
    const k = key(Math.floor(v.x / size), Math.floor(v.y / size)), bucket = buckets.get(k) ?? [];
    bucket.push(v); buckets.set(k, bucket);
  }
  const nearest = (x: number, y: number, maxDistance = size * 2) => {
    const bx = Math.floor(x / size), by = Math.floor(y / size), reach = Math.ceil(maxDistance / size), found: { sample: VectorSample; d: number }[] = [];
    for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) for (const sample of buckets.get(key(bx + i, by + j)) ?? []) {
      const d = Math.hypot(x - sample.x, y - sample.y); if (d <= maxDistance) found.push({ sample, d });
    }
    return found.sort((a, b) => a.d - b.d);
  };
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
