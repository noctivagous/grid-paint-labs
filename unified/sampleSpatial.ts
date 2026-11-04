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
  return { within };
}
