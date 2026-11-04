import type { NCTGraphiteGridCell, NCTGraphitePoint } from '@nct/nctgraphite';

export type AdaptiveCell = NCTGraphiteGridCell & { level: number; parentId: string | null };
export type AdaptiveData = { splits?: Record<string, boolean>; scales?: Record<string, number> };

/** Subdivide a polygon using the same triangle, quadrilateral and hex rules as the hull lab. */
export function childCells(cell: AdaptiveCell): AdaptiveCell[] {
  const p = cell.corners;
  const mid = (i: number) => ({ x: (p[i].x + p[(i + 1) % p.length].x) / 2, y: (p[i].y + p[(i + 1) % p.length].y) / 2 });
  let parts: NCTGraphitePoint[][];
  if (p.length === 3) {
    const a = mid(0), b = mid(1), c = mid(2);
    parts = [[p[0], a, c], [p[1], b, a], [p[2], c, b], [a, b, c]];
  } else if (p.length === 4) {
    parts = p.map((point, i) => [point, mid(i), cell.center, mid((i + 3) % 4)]);
  } else {
    parts = p.map((point, i) => [cell.center, point, p[(i + 1) % p.length]]);
  }
  return parts.map((corners, i) => ({ ...cell, id: `${cell.id}/${i}`, parentId: cell.id, level: cell.level + 1, corners, center: { x: corners.reduce((v, p) => v + p.x, 0) / corners.length, y: corners.reduce((v, p) => v + p.y, 0) / corners.length } }));
}

export function adaptiveLattice(roots: readonly NCTGraphiteGridCell[], splits: Record<string, boolean> = {}): AdaptiveCell[] {
  const leaves: AdaptiveCell[] = [];
  const visit = (cell: AdaptiveCell) => {
    if (splits[cell.id] && cell.level < 4) childCells(cell).forEach(visit);
    else leaves.push(cell);
  };
  roots.forEach(root => visit({ ...root, level: 0, parentId: null }));
  return leaves;
}

/** Split edges at fine-cell vertices so the hull tracer recognizes shared edges. */
export function resolveAdaptiveEdges<T extends { corners: readonly NCTGraphitePoint[] }>(cells: readonly T[]): T[] {
  if (cells.length < 2) return cells.slice();
  const bucketSize = 16;
  type Edge = { cell: number; index: number; a: NCTGraphitePoint; b: NCTGraphitePoint };
  const buckets = new Map<string, Edge[]>();
  const key = (x: number, y: number) => `${x}:${y}`;
  cells.forEach((cell, ci) => cell.corners.forEach((a, ei) => {
    const b = cell.corners[(ei + 1) % cell.corners.length], edge = { cell: ci, index: ei, a, b };
    for (let x = Math.floor(Math.min(a.x, b.x) / bucketSize); x <= Math.floor(Math.max(a.x, b.x) / bucketSize); x++)
      for (let y = Math.floor(Math.min(a.y, b.y) / bucketSize); y <= Math.floor(Math.max(a.y, b.y) / bucketSize); y++) {
        const k = key(x, y), list = buckets.get(k) ?? []; list.push(edge); buckets.set(k, list);
      }
  }));
  const points = new Map<string, NCTGraphitePoint>();
  cells.forEach(cell => cell.corners.forEach(p => points.set(`${p.x.toFixed(5)},${p.y.toFixed(5)}`, p)));
  const splits = new Map<string, NCTGraphitePoint[]>();
  for (const p of points.values()) for (const e of buckets.get(key(Math.floor(p.x / bucketSize), Math.floor(p.y / bucketSize))) ?? []) {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, length2 = dx * dx + dy * dy;
    if (!length2) continue;
    const t = ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / length2;
    if (t <= 1e-6 || t >= 1 - 1e-6 || Math.abs((p.x - e.a.x) * dy - (p.y - e.a.y) * dx) > 1e-5 * Math.sqrt(length2)) continue;
    const k = `${e.cell}:${e.index}`, list = splits.get(k) ?? []; list.push(p); splits.set(k, list);
  }
  return cells.map((cell, ci) => ({ ...cell, corners: cell.corners.flatMap((a, ei) => [a, ...(splits.get(`${ci}:${ei}`) ?? []).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))]) }));
}
