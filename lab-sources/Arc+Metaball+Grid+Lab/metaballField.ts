import { contours } from "d3-contour";

export type FieldBlob = {
  x: number;
  y: number;
  r: number;
  type: "positive" | "negative" | "sticky";
  colorGroup: number;
};

const EPS = 1e-4;

/** Inverse-square metaball kernel at (x, y). */
export function metaballKernel(cx: number, cy: number, r: number, x: number, y: number): number {
  const d2 = (x - cx) ** 2 + (y - cy) ** 2;
  return (r * r) / Math.max(d2, EPS);
}

/** Sum positive kernels minus negative (hole) kernels. */
export function fieldAt(x: number, y: number, positives: FieldBlob[], negatives: FieldBlob[]): number {
  let f = 0;
  for (const b of positives) f += metaballKernel(b.x, b.y, b.r, x, y);
  for (const b of negatives) f -= metaballKernel(b.x, b.y, b.r, x, y);
  return f;
}

/** Map goo tightness v (≈0.2–1.2) to iso-threshold τ (higher v → tighter/smaller blob). */
export function gooToThreshold(goo: number): number {
  return 0.4 + goo * 1.1;
}

export function buildGridValues(
  gridCols: number,
  gridRows: number,
  canvasW: number,
  canvasH: number,
  positives: FieldBlob[],
  negatives: FieldBlob[],
): { values: Float64Array; width: number; height: number } {
  const width = gridCols + 1;
  const height = gridRows + 1;
  const values = new Float64Array(width * height);
  const cellW = canvasW / gridCols;
  const cellH = canvasH / gridRows;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = i * cellW;
      const y = j * cellH;
      values[i + j * width] = fieldAt(x, y, positives, negatives);
    }
  }
  return { values, width, height };
}

export type PixelPt = { x: number; y: number };

function ringToPixels(
  ring: number[][],
  gridCols: number,
  gridRows: number,
  canvasW: number,
  canvasH: number,
): PixelPt[] {
  const sx = (gx: number) => (gx / gridCols) * canvasW;
  const sy = (gy: number) => (gy / gridRows) * canvasH;
  const pts: PixelPt[] = [];
  for (const p of ring) {
    const x = sx(p[0]), y = sy(p[1]);
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.x - x) < 1e-6 && Math.abs(prev.y - y) < 1e-6) continue;
    pts.push({ x, y });
  }
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) pts.pop();
  }
  return pts;
}

/** Closed polygon → cubic Bézier path (uniform Catmull-Rom, tension 0). */
export function closedRingToBezierD(pts: PixelPt[]): string {
  const n = pts.length;
  if (n < 3) return "";
  const at = (i: number) => pts[(i + n) % n];
  let d = `M ${at(0).x} ${at(0).y}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return `${d} Z`;
}

/** Grid-space ring → SVG subpath (coordinates scaled to canvas pixels). */
export function ringToPathD(
  ring: number[][],
  gridCols: number,
  gridRows: number,
  canvasW: number,
  canvasH: number,
  smoothBezier = false,
): string {
  const pts = ringToPixels(ring, gridCols, gridRows, canvasW, canvasH);
  if (pts.length < 2) return "";
  if (smoothBezier && pts.length >= 3) return closedRingToBezierD(pts);
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let k = 1; k < pts.length; k++) d += ` L ${pts[k].x} ${pts[k].y}`;
  return `${d} Z`;
}

export type ContourLayer = { colorGroup: number; color: string; pathD: string };

/**
 * One marching-squares pass per color group (d3-contour).
 * Returns SVG path data using even-odd fill across all rings at τ.
 */
export function contourLayersForBlobs(
  blobs: FieldBlob[],
  palette: string[],
  gridCols: number,
  gridRows: number,
  canvasW: number,
  canvasH: number,
  goo: number,
  smoothBezier = false,
): ContourLayer[] {
  const positives = blobs.filter((b) => b.type !== "negative");
  const negatives = blobs.filter((b) => b.type === "negative");
  const groups = [...new Set(positives.map((b) => b.colorGroup))].sort((a, b) => a - b);
  const threshold = gooToThreshold(goo);
  const out: ContourLayer[] = [];

  for (const gi of groups) {
    const groupPos = positives.filter((b) => b.colorGroup === gi);
    if (!groupPos.length) continue;
    const { values, width, height } = buildGridValues(
      gridCols,
      gridRows,
      canvasW,
      canvasH,
      groupPos,
      negatives,
    );
    const gen = contours().size([width, height]).thresholds([threshold]);
    const multi = gen(values);
    const parts: string[] = [];
    for (const mp of multi) {
      for (const polygon of mp.coordinates) {
        for (const ring of polygon) {
          const sub = ringToPathD(ring as number[][], gridCols, gridRows, canvasW, canvasH, smoothBezier);
          if (sub) parts.push(sub);
        }
      }
    }
    if (!parts.length) continue;
    out.push({
      colorGroup: gi,
      color: groupPos[0]?.color ?? palette[gi % palette.length] ?? "#7c5cff",
      pathD: parts.join(" "),
    });
  }
  return out;
}

export type BrushNoisePreset = {
  id: string;
  label: string;
  freq: number;
  amp: number;
  octaves: number;
};

export const BRUSH_NOISE_PRESETS: BrushNoisePreset[] = [
  { id: "fine", label: "Fine", freq: 0.11, amp: 0.16, octaves: 3 },
  { id: "medium", label: "Medium", freq: 0.045, amp: 0.26, octaves: 3 },
  { id: "coarse", label: "Coarse", freq: 0.02, amp: 0.42, octaves: 2 },
];

export function brushNoisePreset(id: string): BrushNoisePreset {
  return BRUSH_NOISE_PRESETS.find((p) => p.id === id) ?? BRUSH_NOISE_PRESETS[1];
}

const PERM = new Uint8Array(512);
(() => {
  const p = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142,
    8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117,
    35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71,
    134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41,
    55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89,
    18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226,
    250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182,
    189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43,
    172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97,
    228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107,
    49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138,
    236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
  ];
  for (let i = 0; i < 256; i++) PERM[i] = PERM[i + 256] = p[i];
})();

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number) { return a + t * (b - a); }
function grad(h: number, x: number, y: number) {
  const u = (h & 1) === 0 ? x : -x;
  const v = (h & 2) === 0 ? y : -y;
  return u + v;
}

/** Classic 2D Perlin in roughly [-1, 1]. */
export function perlin2(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);
  const aa = PERM[PERM[X] + Y], ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y], bb = PERM[PERM[X + 1] + Y + 1];
  return lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v,
  );
}

export function fbm2(x: number, y: number, freq: number, octaves: number): number {
  let amp = 1, f = freq, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin2(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

export type NoiseStampPt = { x: number; y: number; r: number };

/** Warp only the current brush samples — existing blobs are untouched. */
export function noisyStampCenters(
  origin: PixelPt,
  stampR: number,
  shape: "circle" | "roundrect",
  base: NoiseStampPt[],
  preset: BrushNoisePreset,
): NoiseStampPt[] {
  const { freq, amp, octaves } = preset;
  if (shape === "circle") {
    const n = 12;
    const bead = Math.max(8, stampR * 0.36);
    const out: NoiseStampPt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ox = origin.x + Math.cos(a) * stampR;
      const oy = origin.y + Math.sin(a) * stampR;
      const nrm = fbm2(ox, oy, freq, octaves);
      const rad = stampR * (1 + amp * nrm);
      const inset = Math.max(bead, Math.abs(rad) * 0.62);
      out.push({
        x: origin.x + Math.cos(a) * inset,
        y: origin.y + Math.sin(a) * inset,
        r: bead * (1 + 0.2 * nrm),
      });
    }
    return out;
  }
  return base.map((c) => {
    const nrm = fbm2(c.x, c.y, freq, octaves);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const len = Math.hypot(dx, dy) || 1;
    const push = stampR * amp * nrm;
    return {
      x: c.x + (dx / len) * push,
      y: c.y + (dy / len) * push,
      r: Math.max(6, c.r * (1 + 0.18 * nrm)),
    };
  });
}
