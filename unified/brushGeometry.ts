import { pointInPolygon, type NCTGraphitePoint } from '@nct/nctgraphite';

export type BrushShape = 'circle' | 'square' | 'hex-flat' | 'hex-pointy' | 'hex-flat-diamond' | 'tri-horiz' | 'tri-vert';
export type BrushFootprint = { x: number; y: number; radius: number; shape?: BrushShape; angle?: number };

/** Polygon points share a circumradius with the circular brush. */
export function brushPolygon(brush: BrushFootprint): NCTGraphitePoint[] | null {
  const shape = brush.shape ?? 'circle';
  if (shape === 'circle') return null;
  const rad = (brush.angle ?? 0) * Math.PI / 180;
  let vertices: NCTGraphitePoint[];
  if (shape === 'hex-flat-diamond') {
    vertices = [{ x: 1, y: 0 }, { x: .5, y: Math.sqrt(3) / 2 }, { x: -.5, y: Math.sqrt(3) / 2 }, { x: 0, y: 0 }];
    const center = { x: .25, y: Math.sqrt(3) / 4 };
    vertices = vertices.map(p => ({ x: p.x - center.x, y: p.y - center.y }));
    const scale = Math.max(...vertices.map(p => Math.hypot(p.x, p.y)));
    vertices = vertices.map(p => ({ x: p.x / scale, y: p.y / scale }));
  } else {
    const count = shape === 'square' ? 4 : shape === 'hex-flat' || shape === 'hex-pointy' ? 6 : 3;
    const offset = shape === 'square' ? Math.PI / 4 : shape === 'hex-pointy' ? Math.PI / 6 : shape === 'tri-horiz' ? -Math.PI / 2 : shape === 'tri-vert' ? 0 : 0;
    vertices = Array.from({ length: count }, (_, i) => ({ x: Math.cos(offset + i * 2 * Math.PI / count), y: Math.sin(offset + i * 2 * Math.PI / count) }));
  }
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return vertices.map(p => ({ x: brush.x + brush.radius * (p.x * cos - p.y * sin), y: brush.y + brush.radius * (p.x * sin + p.y * cos) }));
}

function segmentDistanceSquared(p: NCTGraphitePoint, a: NCTGraphitePoint, b: NCTGraphitePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
function segmentsIntersect(a: NCTGraphitePoint, b: NCTGraphitePoint, c: NCTGraphitePoint, d: NCTGraphitePoint): boolean {
  const cross = (p: NCTGraphitePoint, q: NCTGraphitePoint, r: NCTGraphitePoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const eps = 1e-8, x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
  if (((x > eps && y < -eps) || (x < -eps && y > eps)) && ((z > eps && w < -eps) || (z < -eps && w > eps))) return true;
  return segmentDistanceSquared(a, c, d) <= eps * eps || segmentDistanceSquared(b, c, d) <= eps * eps || segmentDistanceSquared(c, a, b) <= eps * eps || segmentDistanceSquared(d, a, b) <= eps * eps;
}
export function brushIntersectsPolygon(brush: BrushFootprint, polygon: readonly NCTGraphitePoint[], shapePoints = brushPolygon(brush)): boolean {
  if (!polygon.length) return false;
  if (!shapePoints) return pointInPolygon({ x: brush.x, y: brush.y }, polygon) || polygon.some((p, i) => segmentDistanceSquared({ x: brush.x, y: brush.y }, p, polygon[(i + 1) % polygon.length]) <= brush.radius ** 2);
  if (polygon.some(p => pointInPolygon(p, shapePoints)) || shapePoints.some(p => pointInPolygon(p, polygon))) return true;
  return polygon.some((a, i) => shapePoints.some((b, j) => segmentsIntersect(a, polygon[(i + 1) % polygon.length], b, shapePoints[(j + 1) % shapePoints.length])));
}
