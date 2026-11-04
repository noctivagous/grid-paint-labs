import { contours } from 'd3-contour';
import { vectorLookup } from './vectorGrid';
import type { VectorFieldLayer } from './layers';

type Segment = [number, number, number, number];

const cache = new WeakMap<object, { key: string; path: string }>();

/** Extract a closed, even-odd SVG outline from the painted field. */
export function vectorShapePath(layer: VectorFieldLayer, width: number, height: number): string {
  const { vectors } = layer.data;
  const s = layer.settings;
  const mode = s.shapeMode ?? 'off';
  if (mode === 'off' || !vectors.length) return '';
  const key = [width, height, mode, s.gridKind, s.columns, s.rows, s.shapeThreshold, s.shapeThickness, s.shapeMerge].join(':');
  const cached = cache.get(vectors);
  if (cached?.key === key) return cached.path;
  const cols = s.columns, rows = s.rows;
  const cw = width / cols, ch = height / rows;
  const step = Math.min(cw, ch) / 2;
  const nx = Math.ceil(width / step), ny = Math.ceil(height / step);
  const sx = width / nx, sy = height / ny;
  const gw = nx + 3, gh = ny + 3;
  const values = new Float64Array(gw * gh);
  const radius = Math.max(1, (s.shapeThickness ?? 8) / 2 + (s.shapeMerge ?? 6));
  const segments: Segment[] = [];
  const minCell = Math.min(cw, ch);
  const lookup = s.gridKind && s.gridKind !== 'square' ? vectorLookup(vectors, minCell) : null;
  if (mode === 'strokes') {
    for (const v of vectors) if (Math.hypot(v.vx, v.vy) > 0.05)
      segments.push([v.x, v.y, v.x + v.vx * minCell * 0.9, v.y + v.vy * minCell * 0.9]);
  } else if (mode === 'streamlines') {
    const seeds = lookup ? vectors.filter((_, index) => index % 4 === 0) : vectors.filter((_, index) => Math.floor(index / cols) % 2 === 0 && index % cols % 2 === 0);
    for (const seed of seeds) {
      let x = seed.x, y = seed.y;
      for (let n = 0; n < 16; n++) {
        let v;
        if (lookup) v = lookup.nearest(x, y, minCell * 1.5)[0]?.sample;
        else {
          const ci = Math.floor((x - vectors[0].x + cw / 2) / cw), cj = Math.floor((y - vectors[0].y + ch / 2) / ch);
          if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) break;
          v = vectors[cj * cols + ci];
        }
        if (!v) break;
        const m = Math.hypot(v.vx, v.vy);
        if (m < 0.05) break;
        const xx = x + v.vx / m * minCell * 0.5, yy = y + v.vy / m * minCell * 0.5;
        segments.push([x, y, xx, yy]); x = xx; y = yy;
      }
    }
  }
  if (mode === 'magnitude') {
    for (let j = 1; j <= ny + 1; j++) for (let i = 1; i <= nx + 1; i++) {
      if (lookup) { values[j * gw + i] = lookup.magnitude((i - 1) * sx, (j - 1) * sy); continue; }
      const x = ((i - 1) * sx - vectors[0].x) / cw, y = ((j - 1) * sy - vectors[0].y) / ch;
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      let value = 0;
      for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
        const a = ix + dx, b = iy + dy;
        if (a >= 0 && a < cols && b >= 0 && b < rows) {
          const v = vectors[b * cols + a];
          value += Math.hypot(v.vx, v.vy) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        }
      }
      values[j * gw + i] = value;
    }
  } else {
    for (const [x1, y1, x2, y2] of segments) {
      const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
      const imin = Math.max(1, Math.floor((Math.min(x1, x2) - radius) / sx) + 1), imax = Math.min(nx + 1, Math.ceil((Math.max(x1, x2) + radius) / sx) + 1);
      const jmin = Math.max(1, Math.floor((Math.min(y1, y2) - radius) / sy) + 1), jmax = Math.min(ny + 1, Math.ceil((Math.max(y1, y2) + radius) / sy) + 1);
      for (let j = jmin; j <= jmax; j++) for (let i = imin; i <= imax; i++) {
        const x = (i - 1) * sx, y = (j - 1) * sy;
        const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
        const d = Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
        values[j * gw + i] = Math.max(values[j * gw + i], Math.max(0, 1 - d / radius));
      }
    }
  }
  const threshold = mode === 'magnitude' ? (s.shapeThreshold ?? 0.3) : 0.5;
  const result = contours().size([gw, gh]).thresholds([threshold])(values);
  const path = result.flatMap(c => c.coordinates.flatMap(poly => poly.map(ring => ring.map((p, i) => `${i ? 'L' : 'M'} ${((p[0] - 1.5) * sx).toFixed(2)} ${((p[1] - 1.5) * sy).toFixed(2)}`).join(' ') + ' Z'))).join(' ');
  cache.set(vectors, { key, path });
  return path;
}
