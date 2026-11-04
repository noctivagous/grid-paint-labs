/** Spatial buckets shared by sample-based brushes. Indices preserve drawing order. */
export type PositionedSample = { x: number; y: number };
export function sampleSpatialIndex<T extends PositionedSample>(samples: readonly T[], spacing: number) {
  const size = Math.max(1, spacing);
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  samples.forEach((sample, index) => {
    const k = key(Math.floor(sample.x / size), Math.floor(sample.y / size));
    const bucket = buckets.get(k) ?? [];
    bucket.push(index); buckets.set(k, bucket);
  });
  const within = (x: number, y: number, radius: number) => {
    const bx = Math.floor(x / size), by = Math.floor(y / size), reach = Math.ceil(radius / size);
    const found: { index: number; d: number }[] = [];
    for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) {
      for (const index of buckets.get(key(bx + i, by + j)) ?? []) {
        const sample = samples[index], d = Math.hypot(x - sample.x, y - sample.y);
        if (d <= radius) found.push({ index, d });
      }
    }
    return found;
  };
  const withinBounds = (left: number, top: number, right: number, bottom: number) => {
    const found: number[] = [];
    for (let j = Math.floor(top / size); j <= Math.floor(bottom / size); j++) for (let i = Math.floor(left / size); i <= Math.floor(right / size); i++) {
      for (const index of buckets.get(key(i, j)) ?? []) {
        const sample = samples[index];
        if (sample.x >= left && sample.x <= right && sample.y >= top && sample.y <= bottom) found.push(index);
      }
    }
    return found.sort((a, b) => a - b);
  };
  return { within, withinBounds };
}

/** Track local edits without persisting rendering metadata in documents. */
const sampleChanges = new WeakMap<object, { previous: WeakRef<object>; indices: readonly number[] }>();
export function recordSampleChanges<T>(next: readonly T[], previous: readonly T[], indices: readonly number[]) {
  sampleChanges.set(next, { previous: new WeakRef(previous), indices });
}
export function changedSampleIndices<T>(next: readonly T[], previous: readonly T[]): number[] | null {
  if (next === previous) return [];
  const indices = new Set<number>();
  let cursor: object = next;
  for (let depth = 0; depth < 64; depth++) {
    const change = sampleChanges.get(cursor);
    if (!change) return null;
    for (const index of change.indices) indices.add(index);
    const prior = change.previous.deref();
    if (!prior) return null;
    if (prior === previous) return [...indices];
    cursor = prior;
  }
  return null;
}
