import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  NCTGraphiteSlider, NCTGraphiteStack, NCTGraphiteGrid,
  NCTGraphiteAppShell, NCTGraphiteStagePanel, NCTGraphiteStageMain,
  useNCTGraphiteCommands,
} from '@nct/nctgraphite';
import type { NCTGraphiteCommandDef } from '@nct/nctgraphite';

const HULL_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: "paint", label: "Activate cells", desc: "Hold F and move over grid", defaultKey: "f" },
  { id: "erase", label: "Erase cells", desc: "Hold E and move over grid", defaultKey: "e" },
  { id: "subdivide", label: "Subdivide cells", desc: "Hold D to split cells under the brush", defaultKey: "d" },
  { id: "coarsen", label: "Reduce subdivision", desc: "Hold S to merge cells under the brush", defaultKey: "s" },
  { id: "scaleDown", label: "Scale cells down", desc: "Hold T to inset cell shapes under the brush", defaultKey: "t" },
  { id: "scaleUp", label: "Scale cells up", desc: "Hold Y to restore cell shapes under the brush", defaultKey: "y" },
  { id: "smooth", label: "Smooth gaps", desc: "Average with neighbors", defaultKey: "q" },
  { id: "compute", label: "Regen Hull", desc: "Recompute hulls now", defaultKey: "v" },
  { id: "clear", label: "Clear / Invert", desc: "Clear, Shift+X inverts", defaultKey: "x" },
  { id: "newColor", label: "New Color Group", desc: "Cycle palette", defaultKey: "c" },
  { id: "showGrid", label: "Show Grid", desc: "Toggle grid lines", defaultKey: "m" },
  { id: "fillHull", label: "Shape Fill", desc: "Toggle the active shape color fill", defaultKey: "l" },
  { id: "brushCycle", label: "Brush Circle/Square/Tri", desc: "Cycle brush shape", defaultKey: "b" },
  { id: "rotateCcw", label: "Rotate brush −15°", desc: "Rotate brush counterclockwise", defaultKey: ";" },
  { id: "rotateCw", label: "Rotate brush +15°", desc: "Rotate brush clockwise", defaultKey: "'" },
  { id: "brushSmaller", label: "Brush 16-160", desc: "Shrink brush", defaultKey: "[" },
  { id: "brushLarger", label: "Brush 16-160", desc: "Grow brush", defaultKey: "]" },
  { id: "gridSquare", label: "Grid Square", desc: "Square grid", defaultKey: "1" },
  { id: "gridHexHoriz", label: "Grid Hex Horiz", desc: "Horizontal hex grid", defaultKey: "2" },
  { id: "gridHexHorizDiamond", label: "Grid Hex H. Diamond", desc: "Horizontal hex split into three diamonds", defaultKey: "0" },
  { id: "gridHexVert", label: "Grid Hex Vert", desc: "Vertical hex grid", defaultKey: "3" },
  { id: "gridTriHoriz", label: "Grid Tri Horiz", desc: "Horizontal triangle grid", defaultKey: "4" },
  { id: "gridTriVert", label: "Grid Tri Vert", desc: "Vertical triangle grid", defaultKey: "5" },
  { id: "hullTight", label: "Hull Tight", desc: "Tight hull", defaultKey: "6" },
  { id: "hullSmooth", label: "Hull Smooth", desc: "Smooth hull", defaultKey: "7" },
  { id: "hullConvex", label: "Hull Convex", desc: "Convex hull", defaultKey: "8" },
  { id: "hullConcave", label: "Hull Concave", desc: "Concave hull", defaultKey: "9" },
];

// Types
type Vec = { x: number; y: number };
type EdgeRaw = { x1: number; y1: number; x2: number; y2: number };
type Edge = EdgeRaw & { key: string };
type Cell = {
  id: number;
  cx: number;
  cy: number;
  col: number;
  row: number;
  corners: Vec[];
  edges: Edge[];
  parentId: number | null;
  rootId: number;
  level: number;
  shapeScale?: number;
};
type ParentRecord = { parent: Cell; childIds: number[] };

type Hull = {
  id: string;
  clusterId: number;
  points: Vec[];
  closed: boolean;
  isHole: boolean;
  area: number;
  perimeter: number;
};

type GridType = 'square' | 'hexHoriz' | 'hexHorizDiamond' | 'hexVert' | 'triHoriz' | 'triVert';
type HullMode = 'tight' | 'smooth' | 'convex' | 'concave';
type BrushShape = 'circle' | 'square' | 'triangle';
type SubdivideTarget = 'shape' | 'grid';
const PAINT_ACTIVATION_THRESHOLD = 0.75;

const GRID_TYPES: GridType[] = ['square', 'hexHoriz', 'hexHorizDiamond', 'hexVert', 'triHoriz', 'triVert'];
const GRID_LABELS: Record<GridType, string> = {
  square: 'SQUARE',
  hexHoriz: 'HEX HORIZ',
  hexHorizDiamond: 'HEX H. DIAMOND',
  hexVert: 'HEX VERT',
  triHoriz: 'TRI HORIZ',
  triVert: 'TRI VERT',
};
const GRID_ALIASES: Record<string, GridType> = {
  square: 'square',
  hexFlat: 'hexHoriz',
  hexHoriz: 'hexHoriz',
  hexHorizDiamond: 'hexHorizDiamond',
  hexPointy: 'hexVert',
  hexVert: 'hexVert',
  triangle: 'triHoriz',
  triHoriz: 'triHoriz',
  triVert: 'triVert',
};

const svgIcon = (inner: string) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: inner }} />
);
const ICONS: Record<string, React.ReactNode> = {
  circle: svgIcon('<circle cx="8" cy="8" r="5.2"/>'),
  square: svgIcon('<rect x="3" y="3" width="10" height="10"/>'),
  triangle: svgIcon('<path d="M8 2.8L13.6 13H2.4Z"/>'),
  rotateCcw: svgIcon('<polyline points="0.7,2.7 0.7,6.7 4.7,6.7"/><path d="M2.3 10a6 6 0 1 0 1.4-6.2L0.7 6.7"/>'),
  rotateCw: svgIcon('<polyline points="15.3,2.7 15.3,6.7 11.3,6.7"/><path d="M13.7 10a6 6 0 1 1-1.4-6.2l2 2.9"/>'),
  gridSquare: svgIcon('<rect x="2.5" y="2.5" width="5" height="5"/><rect x="8.5" y="2.5" width="5" height="5"/><rect x="2.5" y="8.5" width="5" height="5"/><rect x="8.5" y="8.5" width="5" height="5"/>'),
  hex: svgIcon('<polygon points="8,1.8 13.4,4.9 13.4,11.1 8,14.2 2.6,11.1 2.6,4.9"/>'),
  hexDiamond: svgIcon('<polygon points="8,1.8 13.4,4.9 13.4,11.1 8,14.2 2.6,11.1 2.6,4.9"/><path d="M8 8L13.4 4.9M8 8L13.4 11.1M8 8L2.6 11.1"/>'),
  targetShape: svgIcon('<polygon points="8,2 13,6 11,13.5 5,13.5 3,6"/>'),
  hullTight: svgIcon('<polygon points="2.5,6.5 5,3.5 9.5,4.5 13.5,6 12,10.5 13,13.5 8.5,13 4,13.5 2.5,10"/>'),
  hullConvex: svgIcon('<polygon points="8,2 14,8 8,14 2,8"/>'),
  hullConcave: svgIcon('<polygon points="3,2.5 8,5.5 13,2.5 13,13.5 8,10.5 3,13.5"/>'),
  fillGaps: svgIcon('<rect x="2.5" y="2.5" width="11" height="11"/><path d="M8 5.5v5M5.5 8h5"/>'),
  removeIsolated: svgIcon('<circle cx="8" cy="8" r="5.5"/><path d="M5.3 8h5.4"/>'),
  regenerate: svgIcon('<path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7"/><path d="M13.4 1.8v2.7h-2.7"/>'),
  shirt: svgIcon('<path d="M6 2.5L3 4.3 1.6 6.8l1.9 1 1-1.3v6.9h7V6.5l1 1.3 1.9-1-1.4-2.5L10 2.5H9v1.6H7V2.5Z"/>'),
  download: svgIcon('<path d="M8 2v8M4.8 7.2L8 10.4l3.2-3.2"/><path d="M3 12.5h10"/>'),
  image: svgIcon('<rect x="2" y="3.5" width="12" height="9.5" rx="1"/><circle cx="5.6" cy="7" r="1.2"/><path d="M2.5 11.5l3-3 2.4 2.4 2-2 3.6 3.6"/>'),
};
const BRUSH_ICONS: Record<BrushShape, React.ReactNode> = { circle: ICONS.circle, square: ICONS.square, triangle: ICONS.triangle };
const GRID_ICONS: Record<GridType, React.ReactNode> = { square: ICONS.gridSquare, hexHoriz: ICONS.hex, hexHorizDiamond: ICONS.hexDiamond, hexVert: ICONS.hex, triHoriz: ICONS.triangle, triVert: ICONS.triangle };
const HULL_ICONS: Record<HullMode, React.ReactNode> = { tight: ICONS.hullTight, smooth: ICONS.circle, convex: ICONS.hullConvex, concave: ICONS.hullConcave };

// Helpers
const quant = (n: number) => Math.round(n * 100);
const edgeKey = (x1: number, y1: number, x2: number, y2: number) => {
  const qx1 = quant(x1), qy1 = quant(y1), qx2 = quant(x2), qy2 = quant(y2);
  if (qx1 < qx2 || (qx1 === qx2 && qy1 < qy2)) return `${qx1},${qy1}-${qx2},${qy2}`;
  return `${qx2},${qy2}-${qx1},${qy1}`;
};
const pointKey = (x: number, y: number) => `${quant(x)},${quant(y)}`;
const pointsEqual = (a: Vec, b: Vec, eps = 0.5) => Math.hypot(a.x - b.x, a.y - b.y) < eps;
const pointsEqualXY = (x1: number, y1: number, x2: number, y2: number, eps = 0.5) =>
  Math.hypot(x1 - x2, y1 - y2) < eps;

function getJitter(key: string, amount: number, size: number): { dx: number; dy: number } {
  if (amount <= 0) return { dx: 0, dy: 0 };
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h << 5) - h + key.charCodeAt(i);
    h |= 0;
  }
  const r1 = Math.sin(h * 12.9898) * 43758.5453;
  const f1 = r1 - Math.floor(r1);
  const r2 = Math.sin(h * 78.233) * 43758.5453;
  const f2 = r2 - Math.floor(r2);
  const nx = f1 * 2 - 1;
  const ny = f2 * 2 - 1;
  return { dx: nx * amount * size * 0.5, dy: ny * amount * size * 0.5 };
}

function shoelace(pts: Vec[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    s += p1.x * p2.y - p2.x * p1.y;
  }
  return s / 2;
}
function perimeterPoly(pts: Vec[]) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}
function convexHullMonotone(pts: Vec[]): Vec[] {
  if (pts.length <= 1) return pts.slice();
  const sorted = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
function chaikin(pts: Vec[], iterations = 1): Vec[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next: Vec[] = [];
    for (let i = 0; i < cur.length; i++) {
      const p0 = cur[i];
      const p1 = cur[(i + 1) % cur.length];
      next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
      next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
    }
    cur = next;
  }
  return cur;
}

// Grid generation
function buildTopology(cells: Cell[]) {
  const edgeMap = new Map<string, { cellIds: number[]; x1: number; y1: number; x2: number; y2: number; key: string }>();
  const adjacency = new Map<number, Set<number>>();
  for (const cell of cells) {
    for (const e of cell.edges) {
      let entry = edgeMap.get(e.key);
      if (!entry) {
        entry = { cellIds: [], x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, key: e.key };
        edgeMap.set(e.key, entry);
      }
      entry.cellIds.push(cell.id);
    }
  }
  for (const entry of edgeMap.values()) {
    if (entry.cellIds.length >= 2) {
      for (let i = 0; i < entry.cellIds.length; i++) {
        for (let j = i + 1; j < entry.cellIds.length; j++) {
          const a = entry.cellIds[i], b = entry.cellIds[j];
          if (!adjacency.has(a)) adjacency.set(a, new Set());
          if (!adjacency.has(b)) adjacency.set(b, new Set());
          adjacency.get(a)!.add(b);
          adjacency.get(b)!.add(a);
        }
      }
    }
  }
  return { edgeMap, adjacency };
}

function genSquare(width: number, height: number, cellSize: number, jitter: number): Cell[] {
  const cols = Math.ceil(width / cellSize) + 1;
  const rows = Math.ceil(height / cellSize) + 1;
  const points: Vec[][] = [];
  for (let r = 0; r <= rows; r++) {
    points[r] = [];
    for (let c = 0; c <= cols; c++) {
      const off = getJitter(`sq-${c}-${r}`, jitter, cellSize);
      points[r][c] = { x: c * cellSize + off.dx, y: r * cellSize + off.dy };
    }
  }
  const cells: Cell[] = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = points[r][c];
      const tr = points[r][c + 1];
      const br = points[r + 1][c + 1];
      const bl = points[r + 1][c];
      const corners = [tl, tr, br, bl];
      const cx = (tl.x + tr.x + br.x + bl.x) / 4;
      const cy = (tl.y + tr.y + br.y + bl.y) / 4;
      const raw: EdgeRaw[] = [
        { x1: tl.x, y1: tl.y, x2: tr.x, y2: tr.y },
        { x1: tr.x, y1: tr.y, x2: br.x, y2: br.y },
        { x1: br.x, y1: br.y, x2: bl.x, y2: bl.y },
        { x1: bl.x, y1: bl.y, x2: tl.x, y2: tl.y },
      ];
      const edges = raw.map((e) => ({ ...e, key: edgeKey(e.x1, e.y1, e.x2, e.y2) }));
      cells.push({ id, cx, cy, col: c, row: r, corners, edges, parentId: null, rootId: id, level: 0 });
      id++;
    }
  }
  return cells;
}

function genHexFlat(width: number, height: number, size: number, jitter: number): Cell[] {
  const hexH = Math.sqrt(3) * size;
  const colStep = 1.5 * size;
  const rowStep = hexH;
  const cols = Math.ceil(width / colStep) + 2;
  const rows = Math.ceil(height / rowStep) + 2;
  const cells: Cell[] = [];
  let id = 0;
  for (let c = -1; c < cols; c++) {
    for (let r = -1; r < rows; r++) {
      const cxIdeal = c * colStep + size;
      const cyIdeal = r * rowStep + (c % 2 ? rowStep / 2 : 0) + rowStep / 2;
      if (cxIdeal < -size * 2 || cxIdeal > width + size * 2 || cyIdeal < -size * 2 || cyIdeal > height + size * 2) continue;
      const cornersIdeal: Vec[] = [];
      for (let k = 0; k < 6; k++) {
        const ang = (k * 60 * Math.PI) / 180;
        cornersIdeal.push({ x: cxIdeal + size * Math.cos(ang), y: cyIdeal + size * Math.sin(ang) });
      }
      const corners: Vec[] = cornersIdeal.map((p) => {
        const key = `${Math.round(p.x * 10)}-${Math.round(p.y * 10)}`;
        const off = getJitter(`hf-${key}`, jitter, size);
        return { x: p.x + off.dx, y: p.y + off.dy };
      });
      let cx = 0, cy = 0;
      for (const p of corners) { cx += p.x; cy += p.y; }
      cx /= 6; cy /= 6;
      const raw: EdgeRaw[] = [];
      for (let k = 0; k < 6; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 6];
        raw.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
      const edges = raw.map((e) => ({ ...e, key: edgeKey(e.x1, e.y1, e.x2, e.y2) }));
      cells.push({ id, cx, cy, col: c, row: r, corners, edges, parentId: null, rootId: id, level: 0 });
      id++;
    }
  }
  return cells;
}

function genHexFlatDiamonds(width: number, height: number, size: number, jitter: number): Cell[] {
  const hexH = Math.sqrt(3) * size;
  const colStep = 1.5 * size;
  const rowStep = hexH;
  const cols = Math.ceil(width / colStep) + 2;
  const rows = Math.ceil(height / rowStep) + 2;
  const cells: Cell[] = [];
  let id = 0;
  for (let c = -1; c < cols; c++) {
    for (let r = -1; r < rows; r++) {
      const cxIdeal = c * colStep + size;
      const cyIdeal = r * rowStep + (c % 2 ? rowStep / 2 : 0) + rowStep / 2;
      if (cxIdeal < -size * 2 || cxIdeal > width + size * 2 || cyIdeal < -size * 2 || cyIdeal > height + size * 2) continue;
      const corners: Vec[] = [];
      for (let k = 0; k < 6; k++) {
        const ang = (k * 60 * Math.PI) / 180;
        const p = { x: cxIdeal + size * Math.cos(ang), y: cyIdeal + size * Math.sin(ang) };
        const key = `${Math.round(p.x * 10)}-${Math.round(p.y * 10)}`;
        const off = getJitter(`hf-${key}`, jitter, size);
        corners.push({ x: p.x + off.dx, y: p.y + off.dy });
      }
      let hx = 0, hy = 0;
      for (const p of corners) { hx += p.x; hy += p.y; }
      const center = { x: hx / 6, y: hy / 6 };
      for (let d = 0; d < 3; d++) {
        const diamond = [
          corners[d * 2],
          corners[(d * 2 + 1) % 6],
          corners[(d * 2 + 2) % 6],
          center,
        ];
        const cx = (diamond[0].x + diamond[1].x + diamond[2].x + diamond[3].x) / 4;
        const cy = (diamond[0].y + diamond[1].y + diamond[2].y + diamond[3].y) / 4;
        const raw: EdgeRaw[] = [];
        for (let k = 0; k < 4; k++) {
          const a = diamond[k];
          const b = diamond[(k + 1) % 4];
          raw.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
        const edges = raw.map((e) => ({ ...e, key: edgeKey(e.x1, e.y1, e.x2, e.y2) }));
        cells.push({ id, cx, cy, col: c, row: r, corners: diamond, edges, parentId: null, rootId: id, level: 0 });
        id++;
      }
    }
  }
  return cells;
}

function genHexPointy(width: number, height: number, size: number, jitter: number): Cell[] {
  const hexW = Math.sqrt(3) * size;
  const colStep = hexW;
  const rowStep = 1.5 * size;
  const cols = Math.ceil(width / colStep) + 2;
  const rows = Math.ceil(height / rowStep) + 2;
  const cells: Cell[] = [];
  let id = 0;
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const cxIdeal = c * colStep + (r % 2 ? colStep / 2 : 0) + colStep / 2;
      const cyIdeal = r * rowStep + size;
      if (cxIdeal < -size * 2 || cxIdeal > width + size * 2 || cyIdeal < -size * 2 || cyIdeal > height + size * 2) continue;
      const cornersIdeal: Vec[] = [];
      for (let k = 0; k < 6; k++) {
        const ang = (30 + k * 60) * Math.PI / 180;
        cornersIdeal.push({ x: cxIdeal + size * Math.cos(ang), y: cyIdeal + size * Math.sin(ang) });
      }
      const corners = cornersIdeal.map((p) => {
        const key = `${Math.round(p.x * 10)}-${Math.round(p.y * 10)}`;
        const off = getJitter(`hp-${key}`, jitter, size);
        return { x: p.x + off.dx, y: p.y + off.dy };
      });
      let cx = 0, cy = 0;
      for (const p of corners) { cx += p.x; cy += p.y; }
      cx /= 6; cy /= 6;
      const raw: EdgeRaw[] = [];
      for (let k = 0; k < 6; k++) {
        const a = corners[k];
        const b = corners[(k + 1) % 6];
        raw.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
      const edges = raw.map((e) => ({ ...e, key: edgeKey(e.x1, e.y1, e.x2, e.y2) }));
      cells.push({ id, cx, cy, col: c, row: r, corners, edges, parentId: null, rootId: id, level: 0 });
      id++;
    }
  }
  return cells;
}

function genTriangle(width: number, height: number, triSize: number, jitter: number, vertical = false): Cell[] {
  const triAlt = (triSize * Math.sqrt(3)) / 2;
  const along = vertical ? height : width;
  const across = vertical ? width : height;
  const cols = Math.ceil(along / triSize) + 4;
  const rows = Math.ceil(across / triAlt) + 4;
  const latticeJitter = new Map<string, { dx: number; dy: number }>();
  const project = (alongX: number, acrossY: number) => {
    const x = vertical ? acrossY : alongX;
    const y = vertical ? alongX : acrossY;
    const k = `${Math.round(x * 10)}_${Math.round(y * 10)}`;
    if (!latticeJitter.has(k)) latticeJitter.set(k, getJitter(`tri-${vertical ? 'v' : 'h'}-${k}`, jitter, triSize));
    const off = latticeJitter.get(k)!;
    return { x: x + off.dx, y: y + off.dy };
  };
  const inBounds = (cx: number, cy: number) =>
    cx >= -triSize && cx <= width + triSize && cy >= -triSize && cy <= height + triSize;
  const cells: Cell[] = [];
  let id = 0;
  for (let r = -2; r < rows; r++) {
    for (let c = -2; c < cols; c++) {
      const baseAlong = c * triSize + (r % 2 === 1 ? triSize / 2 : 0) - triSize;
      const baseAcross = r * triAlt - triAlt;
      const p0 = project(baseAlong, baseAcross);
      const p1 = project(baseAlong + triSize, baseAcross);
      const p2 = project(baseAlong + triSize + triSize / 2, baseAcross + triAlt);
      const p3 = project(baseAlong + triSize / 2, baseAcross + triAlt);

      const t1Corners = [p0, p1, p3];
      const t1Cx = (p0.x + p1.x + p3.x) / 3;
      const t1Cy = (p0.y + p1.y + p3.y) / 3;
      if (inBounds(t1Cx, t1Cy)) {
        const raw: EdgeRaw[] = [
          { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y },
          { x1: p1.x, y1: p1.y, x2: p3.x, y2: p3.y },
          { x1: p3.x, y1: p3.y, x2: p0.x, y2: p0.y },
        ];
        const edges = raw.map((e) => ({ ...e, key: edgeKey(e.x1, e.y1, e.x2, e.y2) }));
        cells.push({ id, cx: t1Cx, cy: t1Cy, col: c, row: r, corners: t1Corners, edges, parentId: null, rootId: id, level: 0 });
        id++;
      }
      const t2Corners = [p1, p2, p3];
      const t2Cx = (p1.x + p2.x + p3.x) / 3;
      const t2Cy = (p1.y + p2.y + p3.y) / 3;
      if (inBounds(t2Cx, t2Cy)) {
        const raw: EdgeRaw[] = [
          { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
          { x1: p2.x, y1: p2.y, x2: p3.x, y2: p3.y },
          { x1: p3.x, y1: p3.y, x2: p1.x, y2: p1.y },
        ];
        const edges = raw.map((e) => ({ ...e, key: edgeKey(e.x1, e.y1, e.x2, e.y2) }));
        cells.push({ id, cx: t2Cx, cy: t2Cy, col: c, row: r, corners: t2Corners, edges, parentId: null, rootId: id, level: 0 });
        id++;
      }
    }
  }
  return cells;
}

function edgesFromCorners(corners: Vec[]): Edge[] {
  return corners.map((p, i) => {
    const q = corners[(i + 1) % corners.length];
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y, key: edgeKey(p.x, p.y, q.x, q.y) };
  });
}

function centroidOf(corners: Vec[]): Vec {
  let cx = 0, cy = 0;
  for (const p of corners) { cx += p.x; cy += p.y; }
  const n = corners.length || 1;
  return { x: cx / n, y: cy / n };
}

function makeChildCell(id: number, parent: Cell, corners: Vec[]): Cell {
  const c = centroidOf(corners);
  return {
    id,
    cx: c.x,
    cy: c.y,
    col: parent.col,
    row: parent.row,
    corners,
    edges: edgesFromCorners(corners),
    parentId: parent.id,
    rootId: parent.rootId,
    level: parent.level + 1,
    shapeScale: parent.shapeScale,
  };
}

function subdivideCell(cell: Cell, allocId: () => number): Cell[] {
  const p = cell.corners;
  const mid = (i: number) => {
    const a = p[i], b = p[(i + 1) % p.length];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const child = (corners: Vec[]) => makeChildCell(allocId(), cell, corners);
  if (p.length === 3) {
    const m0 = mid(0), m1 = mid(1), m2 = mid(2);
    return [
      child([p[0], m0, m2]),
      child([p[1], m1, m0]),
      child([p[2], m2, m1]),
      child([m0, m1, m2]),
    ];
  }
  if (p.length === 4) {
    const m0 = mid(0), m1 = mid(1), m2 = mid(2), m3 = mid(3);
    const center = { x: cell.cx, y: cell.cy };
    return [
      child([p[0], m0, center, m3]),
      child([p[1], m1, center, m0]),
      child([p[2], m2, center, m1]),
      child([p[3], m3, center, m2]),
    ];
  }
  const center = { x: cell.cx, y: cell.cy };
  return p.map((_, i) => child([center, p[i], p[(i + 1) % p.length]]));
}

function pointOnSegment(p: Vec, a: Vec, b: Vec, eps = 0.6): boolean {
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  if (ab < eps) return false;
  const ap = Math.hypot(p.x - a.x, p.y - a.y);
  const pb = Math.hypot(b.x - p.x, b.y - p.y);
  if (ap < eps || pb < eps) return false;
  return Math.abs(ap + pb - ab) < eps;
}

function resolveTJunctions(cells: Cell[]): Cell[] {
  let minL = Infinity, maxL = -Infinity;
  for (const cell of cells) {
    if (cell.level < minL) minL = cell.level;
    if (cell.level > maxL) maxL = cell.level;
  }
  if (!(maxL > minL)) return cells;

  // Subdivision creates T-junctions where a fine cell meets a coarse one.
  // The former implementation checked every vertex against every edge,
  // which becomes quadratic and made a 2–4 level brush stroke sluggish.
  // Index edge bounding boxes into a small spatial hash instead: a vertex
  // only needs to test edges that occupy its local bucket.
  const bucketSize = 16;
  type IndexedEdge = { cellIndex: number; edgeIndex: number; a: Vec; b: Vec };
  const edgeBuckets = new Map<string, IndexedEdge[]>();
  const bucketKey = (x: number, y: number) => `${x}:${y}`;
  const addToBucket = (x: number, y: number, edge: IndexedEdge) => {
    const key = bucketKey(x, y);
    const edges = edgeBuckets.get(key);
    if (edges) edges.push(edge);
    else edgeBuckets.set(key, [edge]);
  };
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    const corners = cells[cellIndex].corners;
    for (let edgeIndex = 0; edgeIndex < corners.length; edgeIndex++) {
      const a = corners[edgeIndex];
      const b = corners[(edgeIndex + 1) % corners.length];
      const edge = { cellIndex, edgeIndex, a, b };
      const minX = Math.floor(Math.min(a.x, b.x) / bucketSize);
      const maxX = Math.floor(Math.max(a.x, b.x) / bucketSize);
      const minY = Math.floor(Math.min(a.y, b.y) / bucketSize);
      const maxY = Math.floor(Math.max(a.y, b.y) / bucketSize);
      for (let bx = minX; bx <= maxX; bx++) {
        for (let by = minY; by <= maxY; by++) addToBucket(bx, by, edge);
      }
    }
  }

  const verts: Vec[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const p of cell.corners) {
      const k = pointKey(p.x, p.y);
      if (seen.has(k)) continue;
      seen.add(k);
      verts.push(p);
    }
  }
  const splitPoints = new Map<string, Vec[]>();
  for (const p of verts) {
    const px = Math.floor(p.x / bucketSize);
    const py = Math.floor(p.y / bucketSize);
    const candidates = edgeBuckets.get(bucketKey(px, py)) || [];
    for (const edge of candidates) {
      if (!pointOnSegment(p, edge.a, edge.b)) continue;
      const key = `${edge.cellIndex}:${edge.edgeIndex}`;
      const points = splitPoints.get(key);
      if (points) points.push(p);
      else splitPoints.set(key, [p]);
    }
  }

  return cells.map((cell, cellIndex) => {
    const corners: Vec[] = [];
    for (let i = 0; i < cell.corners.length; i++) {
      const a = cell.corners[i];
      corners.push(a);
      const extra = splitPoints.get(`${cellIndex}:${i}`);
      if (extra) extra.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
      if (extra) for (const p of extra) corners.push(p);
    }
    if (corners.length === cell.corners.length) return cell;
    return { ...cell, corners, edges: edgesFromCorners(corners) };
  });
}

function applySubdivide(
  mesh: Cell[],
  active: Set<number>,
  parents: Map<number, ParentRecord>,
  allocId: () => number,
  maxLevel: number,
  hit: (cell: Cell) => boolean
): { mesh: Cell[]; active: Set<number> } | null {
  if (maxLevel <= 0) return null;
  const candidates = mesh.filter((cell) => cell.level < maxLevel && hit(cell));
  if (candidates.length === 0) return null;
  const minLevel = Math.min(...candidates.map((cell) => cell.level));
  const splitIds = new Set(candidates.filter((cell) => cell.level === minLevel).map((cell) => cell.id));
  const next: Cell[] = [];
  const nextActive = new Set(active);
  for (const cell of mesh) {
    if (splitIds.has(cell.id)) {
      const kids = subdivideCell(cell, allocId);
      parents.set(cell.id, { parent: cell, childIds: kids.map((k) => k.id) });
      if (nextActive.has(cell.id)) {
        nextActive.delete(cell.id);
        for (const k of kids) nextActive.add(k.id);
      }
      next.push(...kids);
    } else {
      next.push(cell);
    }
  }
  return { mesh: next, active: nextActive };
}

function applyCoarsen(
  mesh: Cell[],
  active: Set<number>,
  parents: Map<number, ParentRecord>,
  hit: (cell: Cell) => boolean
): { mesh: Cell[]; active: Set<number> } | null {
  const hitCells = mesh.filter(hit);
  if (hitCells.length === 0) return null;
  const maxLevel = Math.max(...hitCells.map((c) => c.level));
  if (maxLevel <= 0) return null;
  const live = new Set(mesh.map((c) => c.id));
  const parentIds = new Set<number>();
  for (const cell of hitCells) {
    if (cell.level === maxLevel && cell.parentId != null) parentIds.add(cell.parentId);
  }
  const remove = new Set<number>();
  const restored: Cell[] = [];
  const nextActive = new Set(active);
  for (const pid of parentIds) {
    const rec = parents.get(pid);
    if (!rec) continue;
    if (!rec.childIds.every((id) => live.has(id))) continue;
    const anyActive = rec.childIds.some((id) => nextActive.has(id));
    for (const id of rec.childIds) {
      remove.add(id);
      nextActive.delete(id);
    }
    restored.push(rec.parent);
    if (anyActive) nextActive.add(pid);
    parents.delete(pid);
  }
  if (remove.size === 0) return null;
  return { mesh: mesh.filter((c) => !remove.has(c.id)).concat(restored), active: nextActive };
}

// Hull computation
function computeHulls(
  cells: Cell[],
  activeIds: Set<number>,
  edgeMap: Map<string, { cellIds: number[]; x1: number; y1: number; x2: number; y2: number; key: string }>,
  adjacency: Map<number, Set<number>>,
  hullMode: HullMode,
  smoothRadiusFactor: number,
  cellSize: number
): Hull[] {
  if (activeIds.size === 0) return [];
  const cellById = new Map<number, Cell>();
  for (const c of cells) cellById.set(c.id, c);

  // clusters BFS
  const visited = new Set<number>();
  const clusters: number[][] = [];
  for (const id of activeIds) {
    if (visited.has(id)) continue;
    const q: number[] = [id];
    visited.add(id);
    const cluster: number[] = [];
    while (q.length) {
      const cur = q.shift()!;
      cluster.push(cur);
      const neigh = adjacency.get(cur);
      if (neigh) for (const nb of neigh) if (activeIds.has(nb) && !visited.has(nb)) { visited.add(nb); q.push(nb); }
    }
    clusters.push(cluster);
  }

  const hulls: Hull[] = [];

  clusters.forEach((cluster, clusterId) => {
    if (hullMode === 'convex') {
      const pts: Vec[] = [];
      for (const cid of cluster) {
        const cell = cellById.get(cid);
        if (cell) pts.push(...cell.corners);
      }
      if (pts.length < 3) return;
      let hullPts = convexHullMonotone(pts);
      if (smoothRadiusFactor > 0.05) hullPts = chaikin(hullPts, 1);
      hulls.push({
        id: `hull-${clusterId}-convex`,
        clusterId,
        points: hullPts,
        closed: true,
        isHole: false,
        area: Math.abs(shoelace(hullPts)),
        perimeter: perimeterPoly(hullPts),
      });
      return;
    }

    // collect perimeter edges for this cluster
    const perimEdges: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (const cid of cluster) {
      const cell = cellById.get(cid);
      if (!cell) continue;
      for (const e of cell.edges) {
        const entry = edgeMap.get(e.key);
        if (!entry) continue;
        const otherActive = entry.cellIds.some((oid) => oid !== cid && activeIds.has(oid));
        if (!otherActive) perimEdges.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, key: e.key });
      }
    }

    // trace loops
    const pointToEdges = new Map<string, number[]>();
    perimEdges.forEach((e, idx) => {
      const k1 = pointKey(e.x1, e.y1);
      const k2 = pointKey(e.x2, e.y2);
      if (!pointToEdges.has(k1)) pointToEdges.set(k1, []);
      if (!pointToEdges.has(k2)) pointToEdges.set(k2, []);
      pointToEdges.get(k1)!.push(idx);
      pointToEdges.get(k2)!.push(idx);
    });

    const visitedEdges = new Set<number>();
    const loops: { points: Vec[]; closed: boolean }[] = [];

    for (let startIdx = 0; startIdx < perimEdges.length; startIdx++) {
      if (visitedEdges.has(startIdx)) continue;
      const startEdge = perimEdges[startIdx];
      let loop: Vec[] = [{ x: startEdge.x1, y: startEdge.y1 }, { x: startEdge.x2, y: startEdge.y2 }];
      visitedEdges.add(startIdx);
      let curPt = loop[1];
      let prevPt = loop[0];
      let iter = 0;
      while (iter < perimEdges.length * 2) {
        iter++;
        const k = pointKey(curPt.x, curPt.y);
        const incident = pointToEdges.get(k) || [];
        const candidates: { idx: number; other: Vec }[] = [];
        for (const idx of incident) {
          if (visitedEdges.has(idx)) continue;
          const ee = perimEdges[idx];
          const other = pointsEqualXY(ee.x1, ee.y1, curPt.x, curPt.y, 0.6) ? { x: ee.x2, y: ee.y2 } : { x: ee.x1, y: ee.y1 };
          if (pointsEqual(other, prevPt, 0.6)) continue;
          candidates.push({ idx, other });
        }
        if (candidates.length === 0) {
          // try allow backtrack to close
          for (const idx of incident) {
            if (visitedEdges.has(idx)) continue;
            const ee = perimEdges[idx];
            const other = pointsEqualXY(ee.x1, ee.y1, curPt.x, curPt.y, 0.6) ? { x: ee.x2, y: ee.y2 } : { x: ee.x1, y: ee.y1 };
            candidates.push({ idx, other });
          }
          if (candidates.length === 0) break;
        }
        // choose smallest turn
        const inVec = { x: curPt.x - prevPt.x, y: curPt.y - prevPt.y };
        let best = candidates[0];
        let bestScore = Infinity;
        for (const cand of candidates) {
          const outVec = { x: cand.other.x - curPt.x, y: cand.other.y - curPt.y };
          const inA = Math.atan2(inVec.y, inVec.x);
          const outA = Math.atan2(outVec.y, outVec.x);
          let delta = outA - inA;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          let ad = Math.abs(delta);
          if (ad > Math.PI * 0.85) ad = Infinity;
          if (ad < bestScore) { bestScore = ad; best = cand; }
        }
        loop.push(best.other);
        visitedEdges.add(best.idx);
        prevPt = curPt;
        curPt = best.other;
        if (pointsEqual(curPt, loop[0], 0.6)) break;
        if (loop.length > perimEdges.length + 5) break;
      }
      const closed = loop.length >= 3 && pointsEqual(loop[0], loop[loop.length - 1], 0.6);
      if (closed) loop.pop();
      if (loop.length >= 3) loops.push({ points: loop, closed });
    }

    if (loops.length === 0) return;
    // sort by area desc
    loops.sort((a, b) => Math.abs(shoelace(b.points)) - Math.abs(shoelace(a.points)));
    loops.forEach((lp, idx) => {
      const area = Math.abs(shoelace(lp.points));
      const perim = perimeterPoly(lp.points);
      // simple hole detection: if not largest and point inside largest
      let isHole = false;
      if (idx > 0) {
        // point in poly test for first point of this loop inside outer loop
        const outer = loops[0].points;
        const pt = lp.points[0];
        let inside = false;
        for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
          const xi = outer[i].x, yi = outer[i].y;
          const xj = outer[j].x, yj = outer[j].y;
          const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
          if (intersect) inside = !inside;
        }
        isHole = inside;
      }
      hulls.push({
        id: `hull-${clusterId}-${idx}`,
        clusterId,
        points: lp.points,
        closed: lp.closed,
        isHole,
        area,
        perimeter: perim,
      });
    });
  });

  // For concave mode, same as tight but we keep as is (already concave)
  // For smooth, same points but rendering smooths

  return hulls;
}

// Smooth path data for SVG
function generateSmoothPathData(points: Vec[], radius: number): string {
  if (points.length < 3) return '';
  let minEdge = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    minEdge = Math.min(minEdge, Math.hypot(b.x - a.x, b.y - a.y));
  }
  radius = Math.min(radius, minEdge * 0.45);
  if (radius < 0.5) {
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} `;
    for (let i = 1; i < points.length; i++) d += `L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} `;
    d += 'Z';
    return d;
  }

  type Seg = { q1: Vec; q2: Vec; c: Vec; sweep: number };
  const segs: Seg[] = [];
  for (let i = 0; i < points.length; i++) {
    const pPrev = points[(i - 1 + points.length) % points.length];
    const pCurr = points[i];
    const pNext = points[(i + 1) % points.length];
    const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
    const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };
    const l1 = Math.hypot(v1.x, v1.y) || 1;
    const l2 = Math.hypot(v2.x, v2.y) || 1;
    const nv1 = { x: v1.x / l1, y: v1.y / l1 };
    const nv2 = { x: v2.x / l2, y: v2.y / l2 };
    const dot = Math.max(-1, Math.min(1, nv1.x * nv2.x + nv1.y * nv2.y));
    const ang = Math.acos(dot);
    if (ang < 0.01 || ang > Math.PI - 0.01) {
      segs.push({ q1: pCurr, q2: pCurr, c: pCurr, sweep: 0 });
      continue;
    }
    const inset = radius / Math.tan(ang / 2);
    // clamp inset to edge lengths
    const edge1Len = Math.hypot(pCurr.x - pPrev.x, pCurr.y - pPrev.y);
    const edge2Len = Math.hypot(pNext.x - pCurr.x, pNext.y - pCurr.y);
    const maxInset = Math.min(edge1Len, edge2Len) * 0.45;
    const clampedInset = Math.min(inset, maxInset);
    const q1 = { x: pCurr.x + nv1.x * clampedInset, y: pCurr.y + nv1.y * clampedInset };
    const q2 = { x: pCurr.x + nv2.x * clampedInset, y: pCurr.y + nv2.y * clampedInset };
    const sum = { x: nv1.x + nv2.x, y: nv1.y + nv2.y };
    const sumLen = Math.hypot(sum.x, sum.y) || 1;
    const sumN = { x: sum.x / sumLen, y: sum.y / sumLen };
    const dist = radius / Math.sin(ang / 2);
    const c = { x: pCurr.x + sumN.x * dist, y: pCurr.y + sumN.y * dist };
    const cq1 = { x: q1.x - c.x, y: q1.y - c.y };
    const cq2 = { x: q2.x - c.x, y: q2.y - c.y };
    const cross = cq1.x * cq2.y - cq1.y * cq2.x;
    const sweep = cross > 0 ? 1 : 0;
    segs.push({ q1, q2, c, sweep });
  }
  if (segs.length === 0) return '';
  let d = `M ${segs[segs.length - 1].q2.x.toFixed(2)} ${segs[segs.length - 1].q2.y.toFixed(2)} `;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (Math.hypot(s.q1.x - s.q2.x, s.q1.y - s.q2.y) < 0.1) {
      d += `L ${s.q1.x.toFixed(2)} ${s.q1.y.toFixed(2)} `;
    } else {
      d += `L ${s.q1.x.toFixed(2)} ${s.q1.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 ${s.sweep} ${s.q2.x.toFixed(2)} ${s.q2.y.toFixed(2)} `;
    }
  }
  d += 'Z';
  return d;
}

function drawSmoothPath(ctx: CanvasRenderingContext2D, points: Vec[], radius: number) {
  if (points.length < 3) {
    ctx.beginPath();
    ctx.moveTo(points[0]?.x || 0, points[0]?.y || 0);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    return;
  }
  let minEdge = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    minEdge = Math.min(minEdge, Math.hypot(b.x - a.x, b.y - a.y));
  }
  radius = Math.min(radius, minEdge * 0.45);
  if (radius < 0.5) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length; i++) {
    const p1 = points[(i + 1) % points.length];
    const p2 = points[(i + 2) % points.length];
    ctx.arcTo(p1.x, p1.y, p2.x, p2.y, radius);
  }
  ctx.closePath();
}

// Main component
export default function App() {
  const WIDTH = 960, HEIGHT = 720;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Grid settings
  const [gridType, setGridType] = useState<GridType>('square');
  const [cellSize, setCellSize] = useState(14);
  const [subdivide, setSubdivide] = useState(2);
  const [subdivideTarget, setSubdivideTarget] = useState<SubdivideTarget>('shape');
  const [falloffPower, setFalloffPower] = useState(1);
  const [paintFalloff, setPaintFalloff] = useState(false);
  const [subdivideFalloff, setSubdivideFalloff] = useState(true);
  const [cellShapeScale, setCellShapeScale] = useState(1);
  const [jitter, setJitter] = useState(0);
  const [snapToGridDirections, setSnapToGridDirections] = useState(false);
  const [snapToCellCenters, setSnapToCellCenters] = useState(false);
  const [snapTolerance, setSnapTolerance] = useState(10);
  const [brushRadius, setBrushRadius] = useState(64);
  const [brushShape, setBrushShape] = useState<BrushShape>('circle');
  const [brushAngle, setBrushAngle] = useState(0);
  const [hullMode, setHullMode] = useState<HullMode>('tight');
  const [smoothRadius, setSmoothRadius] = useState(0.22);
  const [showGrid, setShowGrid] = useState(false);
  const [showCenters, setShowCenters] = useState(false);
  const [showShapeFill, setShowShapeFill] = useState(true);
  const [showShapeOutline, setShowShapeOutline] = useState(false);
  const [showDivisions, setShowDivisions] = useState(false);
  const [showSubdivisions, setShowSubdivisions] = useState(true);
  const [fillOpacity, setFillOpacity] = useState(0.18);
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [colorByCluster, setColorByCluster] = useState(true);
  const [liveHull, setLiveHull] = useState(true);
  const [cornerMode] = useState<'arc' | 'miter' | 'bevel'>('arc');

  // Interaction
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set<number>());
  const [mousePos, setMousePos] = useState<Vec | null>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [brushMode, setBrushModeState] = useState<'activate' | 'erase'>('activate');
  const pendingActiveRef = useRef<number[] | null>(null);
  const parentsRef = useRef(new Map<number, ParentRecord>());
  const nextIdRef = useRef(0);
  const paintStrengthRef = useRef(new Map<number, number>());
  const snapAnchorRef = useRef<Vec | null>(null);
  const loadGridType = (next: GridType) => {
    pendingActiveRef.current = null;
    paintStrengthRef.current.clear();
    setActiveIds(new Set());
    setGridType(next);
  };
  const { heldActions: hullHeld } = useNCTGraphiteCommands({
    commands: HULL_COMMANDS,
    ignoreInputs: true,
    onKeyUp: (key) => {
      if (key === 'f' || key === 'e' || key === 'd' || key === 's' || key === 't' || key === 'y') snapAnchorRef.current = null;
    },
    onAction: (id, e) => {
      if (id === "paint") { setBrushModeState('activate'); if (mousePos) { beginSnapStroke(mousePos); const point = snapBrushPosition(mousePos); paintAt(point.x, point.y, 'activate'); } }
      if (id === "erase") { setBrushModeState('erase'); if (mousePos) { beginSnapStroke(mousePos); const point = snapBrushPosition(mousePos); paintAt(point.x, point.y, 'erase'); } }
      if (id === "subdivide") { if (e?.repeat) return; if (mousePos) { beginSnapStroke(mousePos); const point = snapBrushPosition(mousePos); subdivideAt(point.x, point.y); } }
      if (id === "coarsen") { if (e?.repeat) return; if (mousePos) { beginSnapStroke(mousePos); const point = snapBrushPosition(mousePos); coarsenAt(point.x, point.y); } }
      if (id === "scaleDown") { if (e?.repeat) return; if (mousePos) { beginSnapStroke(mousePos); const point = snapBrushPosition(mousePos); scaleCellsAt(point.x, point.y, -1); } }
      if (id === "scaleUp") { if (e?.repeat) return; if (mousePos) { beginSnapStroke(mousePos); const point = snapBrushPosition(mousePos); scaleCellsAt(point.x, point.y, 1); } }
      if (id === "smooth") doSmoothGaps();
      if (id === "compute") computeNow();
      if (id === "clear") {
        paintStrengthRef.current.clear();
        if (e?.shiftKey) {
          const all = cells.map((c) => c.id);
          setActiveIds((prev) => {
            const ns = new Set<number>();
            for (const pid of all) if (!prev.has(pid)) ns.add(pid);
            return ns;
          });
        } else setActiveIds(new Set());
      }
      if (id === "newColor") setPaletteIdx((i) => (i + 1) % 5);
      if (id === "showGrid") setShowGrid((v) => !v);
      if (id === "fillHull") setShowShapeFill((v) => !v);
      if (id === "brushCycle") setBrushShape((s) => (s === 'circle' ? 'square' : s === 'square' ? 'triangle' : 'circle'));
      if (id === "rotateCcw") setBrushAngle((a) => (a + 345) % 360);
      if (id === "rotateCw") setBrushAngle((a) => (a + 15) % 360);
      if (id === "brushSmaller") setBrushRadius((r) => Math.max(16, r - 8));
      if (id === "brushLarger") setBrushRadius((r) => Math.min(160, r + 8));
      if (id === "gridSquare") loadGridType('square');
      if (id === "gridHexHoriz") loadGridType('hexHoriz');
      if (id === "gridHexHorizDiamond") loadGridType('hexHorizDiamond');
      if (id === "gridHexVert") loadGridType('hexVert');
      if (id === "gridTriHoriz") loadGridType('triHoriz');
      if (id === "gridTriVert") loadGridType('triVert');
      if (id === "hullTight") setHullMode('tight');
      if (id === "hullSmooth") setHullMode('smooth');
      if (id === "hullConvex") setHullMode('convex');
      if (id === "hullConcave") setHullMode('concave');
    },
  });
  const isFPressed = hullHeld.has("paint");
  const isEPressed = hullHeld.has("erase");
  const isDPressed = hullHeld.has("subdivide");
  const isSPressed = hullHeld.has("coarsen");
  const isTPressed = hullHeld.has("scaleDown");
  const isYPressed = hullHeld.has("scaleUp");
  const [hulls, setHulls] = useState<Hull[]>([]);
  const [showShirt, setShowShirt] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);

  // ---- Persistence (trusted backend) ----
  type SavedLab = { id: string; gridType: GridType; cellSize: number; hullMode: HullMode; active: number[]; createdAt: string };
  const [savedLabs, setSavedLabs] = useState<{ id: string; value: any }[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveResult, setSaveResult] = useState<{ saved: number; remaining: number; error: string | null; reloadError: string | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reloadRecords = async () => {
    const res = await fetch("actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "records.list", args: { collection: "hull_sessions" } }),
    });
    if (!res.ok) throw new Error(`list failed ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    setSavedLabs(json.data?.records || []);
  };

  const createRow = async (row: any) => {
    const idempotency_key = `lab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = await fetch("actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "records.create", args: { collection: "hull_sessions", value: row, idempotency_key } }),
    });
    if (!res.ok) throw new Error(`create failed ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.data;
  };

  useEffect(() => {
    (async () => {
      try {
        await reloadRecords();
      } catch (e: any) {
        setLoadError(e?.message || String(e));
      }
    })();
  }, []);

  const handleSaveLab = async () => {
    const row = {
      gridType,
      cellSize,
      hullMode,
      smoothRadius,
      active: Array.from(activeIds),
      createdAt: new Date().toISOString(),
      area: totalArea,
      perimeter: totalPerim,
    };
    const rows = [row];
    setBusy(true);
    let saved = 0;
    let error: string | null = null;
    try {
      for (const r of rows) {
        await createRow(r);
        saved += 1;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    let reloadError: string | null = null;
    try {
      await reloadRecords();
    } catch (e) {
      reloadError = e instanceof Error ? e.message : String(e);
    }
    setSaveResult({ saved, remaining: rows.length - saved, error, reloadError });
    setBusy(false);
  };

  const handleDeleteLab = async (id: string) => {
    try {
      const res = await fetch("actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "records.delete", args: { collection: "hull_sessions", id } }),
      });
      if (!res.ok) throw new Error(`delete failed ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      await reloadRecords();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleLoadLab = (val: any) => {
    const nextType = typeof val.gridType === 'string' ? GRID_ALIASES[val.gridType] : undefined;
    if (nextType && nextType !== gridType) {
      if (Array.isArray(val.active)) pendingActiveRef.current = val.active;
      setGridType(nextType);
    } else if (Array.isArray(val.active)) {
      setActiveIds(new Set(val.active));
    }
    if (val.cellSize) setCellSize(val.cellSize);
    if (val.hullMode) setHullMode(val.hullMode);
    if (val.smoothRadius !== undefined) setSmoothRadius(val.smoothRadius);
  };

  // Grid data
  const baseCells = useMemo(() => {
    if (gridType === 'square') return genSquare(WIDTH, HEIGHT, cellSize, jitter);
    if (gridType === 'hexHoriz') return genHexFlat(WIDTH, HEIGHT, cellSize, jitter);
    if (gridType === 'hexHorizDiamond') return genHexFlatDiamonds(WIDTH, HEIGHT, cellSize, jitter);
    if (gridType === 'hexVert') return genHexPointy(WIDTH, HEIGHT, cellSize, jitter);
    if (gridType === 'triVert') return genTriangle(WIDTH, HEIGHT, cellSize, jitter, true);
    return genTriangle(WIDTH, HEIGHT, cellSize, jitter);
  }, [gridType, cellSize, jitter]);

  const [meshCells, setMeshCells] = useState<Cell[]>(baseCells);
  const meshCellsRef = useRef(meshCells);
  meshCellsRef.current = meshCells;
  const activeIdsRef = useRef(activeIds);
  activeIdsRef.current = activeIds;

  useEffect(() => {
    parentsRef.current = new Map();
    paintStrengthRef.current.clear();
    snapAnchorRef.current = null;
    nextIdRef.current = baseCells.reduce((m, c) => Math.max(m, c.id + 1), 0);
    setMeshCells(baseCells);
    meshCellsRef.current = baseCells;
    if (pendingActiveRef.current) {
      setActiveIds(new Set(pendingActiveRef.current));
      pendingActiveRef.current = null;
      return;
    }
    setActiveIds(new Set());
  }, [baseCells]);

  const gridData = useMemo(() => {
    const cells = resolveTJunctions(meshCells);
    const { edgeMap, adjacency } = buildTopology(cells);
    return { cells, edgeMap, adjacency };
  }, [meshCells]);

  const { cells, edgeMap, adjacency } = gridData;
  const snapToNearestCellCenter = useCallback((point: Vec): Vec => {
    if (!snapToCellCenters || baseCells.length === 0) return point;
    let nearest = baseCells[0];
    let nearestDistance = Infinity;
    for (const cell of baseCells) {
      const dx = cell.cx - point.x;
      const dy = cell.cy - point.y;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearest = cell;
        nearestDistance = distance;
      }
    }
    return { x: nearest.cx, y: nearest.cy };
  }, [baseCells, snapToCellCenters]);
  const beginSnapStroke = useCallback((point: Vec) => {
    if (!snapAnchorRef.current) snapAnchorRef.current = snapToNearestCellCenter(point);
  }, [snapToNearestCellCenter]);
  const snapBrushPosition = useCallback((point: Vec): Vec => {
    const centerSnappedPoint = snapToNearestCellCenter(point);
    const anchor = snapAnchorRef.current;
    if (!snapToGridDirections || !anchor) return centerSnappedPoint;
    const directions = gridType === 'square'
      ? [0, Math.PI / 2]
      : [0, Math.PI / 3, (2 * Math.PI) / 3];
    let closest: Vec | null = null;
    let closestDistance = Infinity;
    for (const angle of directions) {
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const dx = centerSnappedPoint.x - anchor.x;
      const dy = centerSnappedPoint.y - anchor.y;
      const lengthOnLine = dx * ux + dy * uy;
      const candidate = { x: anchor.x + lengthOnLine * ux, y: anchor.y + lengthOnLine * uy };
      const perpendicularDistance = Math.hypot(centerSnappedPoint.x - candidate.x, centerSnappedPoint.y - candidate.y);
      if (perpendicularDistance < closestDistance) {
        closest = candidate;
        closestDistance = perpendicularDistance;
      }
    }
    return closest && closestDistance <= snapTolerance ? closest : centerSnappedPoint;
  }, [gridType, snapToGridDirections, snapTolerance, snapToNearestCellCenter]);

  // Hull computation
  const computeNow = useCallback(() => {
    const h = computeHulls(cells, activeIds, edgeMap, adjacency, hullMode, smoothRadius, cellSize);
    setHulls(h);
  }, [cells, activeIds, edgeMap, adjacency, hullMode, smoothRadius, cellSize]);

  useEffect(() => {
    if (!liveHull) return;
    const t = setTimeout(() => computeNow(), 150);
    return () => clearTimeout(t);
  }, [computeNow, liveHull]);

  useEffect(() => {
    if (liveHull) computeNow();
  }, [liveHull]); // initial

  // Brush shape geometry (shared by paint, preview outline, and activation preview)
  const brushVertices = (x: number, y: number): Vec[] => {
    const rot = (brushAngle * Math.PI) / 180;
    const n = brushShape === 'square' ? 4 : 3;
    const off = brushShape === 'square' ? Math.PI / 4 : -Math.PI / 2;
    const pts: Vec[] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + off + (i * 2 * Math.PI) / n;
      pts.push({ x: x + brushRadius * Math.cos(a), y: y + brushRadius * Math.sin(a) });
    }
    return pts;
  };
  const brushHits = (x: number, y: number, cx: number, cy: number): boolean => {
    if (brushShape === 'circle') return Math.hypot(cx - x, cy - y) < brushRadius;
    const poly = brushVertices(x, y);
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > cy !== b.y > cy && cx < ((b.x - a.x) * (cy - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  const brushInfluence = (x: number, y: number, cx: number, cy: number): number =>
    Math.max(0, 1 - Math.hypot(cx - x, cy - y) / brushRadius);
  const scaledCorners = (cell: Cell): Vec[] => {
    const scale = cell.shapeScale ?? cellShapeScale;
    if (scale === 1) return cell.corners;
    return cell.corners.map((corner) => ({
      x: cell.cx + (corner.x - cell.cx) * scale,
      y: cell.cy + (corner.y - cell.cy) * scale,
    }));
  };
  const traceBrush = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    if (brushShape === 'circle') {
      ctx.beginPath();
      ctx.arc(x, y, brushRadius, 0, Math.PI * 2);
      return;
    }
    const v = brushVertices(x, y);
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
  };

  // Drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    canvas.style.width = WIDTH + 'px';
    canvas.style.height = HEIGHT + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // bg
    ctx.fillStyle = '#fdfaf3';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // grid
    if (showGrid) {
      ctx.strokeStyle = '#e8e0c8';
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (const cell of cells) {
        ctx.moveTo(cell.corners[0].x, cell.corners[0].y);
        for (let i = 1; i < cell.corners.length; i++) ctx.lineTo(cell.corners[i].x, cell.corners[i].y);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // clusters for coloring
    const visited = new Set<number>();
    const cellToCluster = new Map<number, number>();
    let clusterCount = 0;
    for (const id of activeIds) {
      if (visited.has(id)) continue;
      const q: number[] = [id];
      visited.add(id);
      cellToCluster.set(id, clusterCount);
      while (q.length) {
        const cur = q.shift()!;
        const neigh = adjacency.get(cur);
        if (neigh) for (const nb of neigh) if (activeIds.has(nb) && !visited.has(nb)) { visited.add(nb); cellToCluster.set(nb, clusterCount); q.push(nb); }
      }
      clusterCount++;
    }

    const palette = ['#c2a878', '#7c5cff', '#ff7a5c', '#4ecdc4', '#e84855'];
    const shiftedPalette = [...palette.slice(paletteIdx), ...palette.slice(0, paletteIdx)];
    const cellById = new Map(cells.map((cell) => [cell.id, cell]));

    // active cells
    if (showShapeFill) {
      for (const cell of cells) {
        if (!activeIds.has(cell.id)) continue;
        const cIdx = cellToCluster.get(cell.id) ?? 0;
        const col = colorByCluster ? shiftedPalette[cIdx % shiftedPalette.length] : shiftedPalette[0];
        const corners = scaledCorners(cell);
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.86;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // These are drawn directly from the active mesh, so line-only display is
    // immediate and does not wait for the debounced hull calculation.
    const boundarySegments: Edge[] = [];
    const divisionSegments: Edge[] = [];
    const subdivisionSegments: Edge[] = [];
    const seenInternalEdges = new Set<string>();
    for (const cell of cells) {
      if (!activeIds.has(cell.id)) continue;
      for (const edge of cell.edges) {
        const entry = edgeMap.get(edge.key);
        const activeNeighbors = entry?.cellIds.filter((id) => id !== cell.id && activeIds.has(id)) || [];
        if (activeNeighbors.length === 0) {
          boundarySegments.push(edge);
          continue;
        }
        if (seenInternalEdges.has(edge.key)) continue;
        seenInternalEdges.add(edge.key);
        const crossesBaseCell = activeNeighbors.some((id) => cellById.get(id)?.rootId !== cell.rootId);
        if (crossesBaseCell) divisionSegments.push(edge);
        else subdivisionSegments.push(edge);
      }
    }
    const strokeSegments = (segments: Edge[], width: number, alpha = 1) => {
      if (segments.length === 0) return;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const edge of segments) {
        ctx.moveTo(edge.x1, edge.y1);
        ctx.lineTo(edge.x2, edge.y2);
      }
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    ctx.strokeStyle = '#1a1a24';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (showShapeOutline) strokeSegments(boundarySegments, strokeWidth);
    if (showDivisions) strokeSegments(divisionSegments, Math.max(0.75, strokeWidth * 0.45), 0.78);
    if (showSubdivisions) strokeSegments(subdivisionSegments, Math.max(0.6, strokeWidth * 0.32), 0.68);
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';

    // hulls
    for (const hull of hulls) {
      if (hull.points.length < 3) continue;
      const cIdx = hull.clusterId;
      const col = colorByCluster ? shiftedPalette[cIdx % shiftedPalette.length] : '#1a1a24';
      if (showShapeFill && !hull.isHole) {
        ctx.fillStyle = colorByCluster ? col + '33' : `rgba(26,26,36,${fillOpacity})`;
        ctx.globalAlpha = 1;
        if (hullMode === 'smooth') {
          drawSmoothPath(ctx, hull.points, cellSize * smoothRadius);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(hull.points[0].x, hull.points[0].y);
          for (let i = 1; i < hull.points.length; i++) ctx.lineTo(hull.points[i].x, hull.points[i].y);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (showShapeOutline) {
        ctx.strokeStyle = hull.isHole ? '#e84855' : col;
        if (!colorByCluster) ctx.strokeStyle = '#1a1a24';
        ctx.lineWidth = strokeWidth;
        if (hullMode === 'convex') ctx.setLineDash([8, 6]);
        else ctx.setLineDash([]);
        if (hullMode === 'smooth') {
          drawSmoothPath(ctx, hull.points, cellSize * smoothRadius);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(hull.points[0].x, hull.points[0].y);
          for (let i = 1; i < hull.points.length; i++) ctx.lineTo(hull.points[i].x, hull.points[i].y);
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    if (showCenters) {
      ctx.fillStyle = '#1a1a24';
      for (const cell of cells) if (activeIds.has(cell.id)) {
        ctx.beginPath();
        ctx.arc(cell.cx, cell.cy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (mousePos) {
      ctx.strokeStyle = isDPressed ? '#c2a878' : isSPressed ? '#ff7a5c' : isTPressed ? '#4ecdc4' : isYPressed ? '#5ca8ff' : brushMode === 'activate' ? '#7c5cff' : '#e84855';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      traceBrush(ctx, mousePos.x, mousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = isDPressed ? '#c2a878' : isSPressed ? '#ff7a5c' : isTPressed ? '#4ecdc4' : isYPressed ? '#5ca8ff' : brushMode === 'activate' ? '#7c5cff' : '#e84855';
      ctx.globalAlpha = 0.35;
      for (const cell of meshCells) {
        if (!brushHits(mousePos.x, mousePos.y, cell.cx, cell.cy)) continue;
        const wouldChange = isDPressed
          ? cell.level < subdivide &&
            (subdivideTarget === 'grid' || activeIds.has(cell.id)) &&
            (!subdivideFalloff || cell.level < Math.ceil(subdivide * Math.pow(brushInfluence(mousePos.x, mousePos.y, cell.cx, cell.cy), falloffPower)))
          : isSPressed
            ? cell.level > 0 && (subdivideTarget === 'grid' || activeIds.has(cell.id))
            : isTPressed
              ? (cell.shapeScale ?? cellShapeScale) > 0.05
              : isYPressed
                ? (cell.shapeScale ?? cellShapeScale) < 1
            : brushMode === 'activate' ? !activeIds.has(cell.id) : activeIds.has(cell.id);
        if (!wouldChange) continue;
        ctx.beginPath();
        ctx.moveTo(cell.corners[0].x, cell.corners[0].y);
        for (let i = 1; i < cell.corners.length; i++) ctx.lineTo(cell.corners[i].x, cell.corners[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = '#1a1a24';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }, [cells, meshCells, activeIds, hulls, showGrid, showCenters, showShapeFill, showShapeOutline, showDivisions, showSubdivisions, mousePos, brushRadius, brushShape, brushAngle, brushMode, colorByCluster, fillOpacity, strokeWidth, hullMode, smoothRadius, cellSize, adjacency, edgeMap, paletteIdx, isDPressed, isSPressed, isTPressed, isYPressed, subdivide, subdivideTarget, subdivideFalloff, falloffPower, cellShapeScale]);

  // Interaction helpers
  const paintAt = useCallback((x: number, y: number, mode: 'activate' | 'erase') => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const cell of meshCells) {
        if (brushHits(x, y, cell.cx, cell.cy)) {
          if (mode === 'activate') {
            if (next.has(cell.id)) continue;
            if (!paintFalloff) {
              next.add(cell.id);
              changed = true;
              continue;
            }
            const influence = Math.pow(brushInfluence(x, y, cell.cx, cell.cy), falloffPower);
            const strength = (paintStrengthRef.current.get(cell.id) || 0) + influence;
            if (strength >= PAINT_ACTIVATION_THRESHOLD) {
              paintStrengthRef.current.delete(cell.id);
              next.add(cell.id);
              changed = true;
            } else {
              paintStrengthRef.current.set(cell.id, strength);
            }
          } else {
            paintStrengthRef.current.delete(cell.id);
            if (next.has(cell.id)) { next.delete(cell.id); changed = true; }
          }
        }
      }
      return changed ? next : prev;
    });
  }, [meshCells, brushRadius, brushShape, brushAngle, paintFalloff, falloffPower]);

  const subdivideAt = useCallback((x: number, y: number) => {
    const hit = (cell: Cell) =>
      brushHits(x, y, cell.cx, cell.cy) &&
      (subdivideTarget === 'grid' || activeIdsRef.current.has(cell.id)) &&
      (!subdivideFalloff || cell.level < Math.ceil(subdivide * Math.pow(brushInfluence(x, y, cell.cx, cell.cy), falloffPower)));
    const result = applySubdivide(
      meshCellsRef.current,
      activeIdsRef.current,
      parentsRef.current,
      () => nextIdRef.current++,
      subdivide,
      hit
    );
    if (!result) return;
    meshCellsRef.current = result.mesh;
    activeIdsRef.current = result.active;
    setMeshCells(result.mesh);
    setActiveIds(result.active);
  }, [subdivide, subdivideTarget, subdivideFalloff, falloffPower, brushRadius, brushShape, brushAngle]);

  const coarsenAt = useCallback((x: number, y: number) => {
    const hit = (cell: Cell) =>
      brushHits(x, y, cell.cx, cell.cy) &&
      (subdivideTarget === 'grid' || activeIdsRef.current.has(cell.id));
    const result = applyCoarsen(meshCellsRef.current, activeIdsRef.current, parentsRef.current, hit);
    if (!result) return;
    meshCellsRef.current = result.mesh;
    activeIdsRef.current = result.active;
    setMeshCells(result.mesh);
    setActiveIds(result.active);
  }, [subdivideTarget, brushRadius, brushShape, brushAngle]);

  const scaleCellsAt = useCallback((x: number, y: number, direction: -1 | 1) => {
    const step = 0.05 * direction;
    let changed = false;
    const next = meshCellsRef.current.map((cell) => {
      if (!brushHits(x, y, cell.cx, cell.cy)) return cell;
      const falloff = paintFalloff
        ? Math.pow(brushInfluence(x, y, cell.cx, cell.cy), falloffPower)
        : 1;
      const current = cell.shapeScale ?? cellShapeScale;
      const shapeScale = Math.max(0.05, Math.min(1, current + step * falloff));
      if (shapeScale === current) return cell;
      changed = true;
      return { ...cell, shapeScale };
    });
    if (!changed) return;
    meshCellsRef.current = next;
    setMeshCells(next);
  }, [brushRadius, brushShape, brushAngle, cellShapeScale, paintFalloff, falloffPower]);

  const doSmoothGaps = useCallback(() => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      for (const cell of cells) {
        const neigh = adjacency.get(cell.id);
        let activeN = 0;
        if (neigh) for (const nb of neigh) if (prev.has(nb)) activeN++;
        if (!prev.has(cell.id)) {
          if (activeN >= 3) next.add(cell.id);
        } else {
          if (activeN === 0) next.delete(cell.id);
        }
      }
      return next;
    });
  }, [cells, adjacency]);

  // Mouse handlers
  const getPos = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) * (WIDTH / rect.width);
    const y = (e.clientY - rect.top) * (HEIGHT / rect.height);
    return { x, y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isMouseDown || isFPressed || isEPressed || isDPressed || isSPressed || isTPressed || isYPressed) beginSnapStroke(getPos(e));
    const point = snapBrushPosition(getPos(e));
    setMousePos(point);
    if (isDPressed) subdivideAt(point.x, point.y);
    else if (isSPressed) coarsenAt(point.x, point.y);
    else if (isTPressed) scaleCellsAt(point.x, point.y, -1);
    else if (isYPressed) scaleCellsAt(point.x, point.y, 1);
    else if (isMouseDown) paintAt(point.x, point.y, brushMode);
    else if (isFPressed) paintAt(point.x, point.y, 'activate');
    else if (isEPressed) paintAt(point.x, point.y, 'erase');
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    const rawPoint = getPos(e);
    beginSnapStroke(rawPoint);
    const point = snapBrushPosition(rawPoint);
    setIsMouseDown(true);
    setMousePos(point);
    paintAt(point.x, point.y, brushMode);
  };
  const handleMouseUp = () => {
    setIsMouseDown(false);
    snapAnchorRef.current = null;
  };

  // Keyboard handling lives in useNCTGraphiteCommands (HULL_COMMANDS above).

  // Export
  const exportSVG = () => {
    let svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">\n`;
    svg += `<rect width="100%" height="100%" fill="#fdfaf3"/>\n<g id="cells">\n`;
    for (const cell of cells) if (activeIds.has(cell.id)) {
      const pts = scaledCorners(cell).map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
      svg += `  <polygon points="${pts}" fill="#c2a878" stroke="#1a1a24" stroke-width="0.5" opacity="0.85"/>\n`;
    }
    svg += `</g>\n<g id="hulls">\n`;
    for (const hull of hulls) {
      const d = hullMode === 'smooth' ? generateSmoothPathData(hull.points, cellSize * smoothRadius) :
        `M ${hull.points[0]?.x.toFixed(2) || 0} ${hull.points[0]?.y.toFixed(2) || 0} ` + hull.points.slice(1).map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';
      svg += `  <path d="${d}" fill="${showShapeFill ? 'rgba(26,26,36,0.08)' : 'none'}" stroke="${showShapeOutline ? '#1a1a24' : 'none'}" stroke-width="${strokeWidth}" />\n`;
    }
    svg += `</g>\n<!-- grid:${gridType} cellSize:${cellSize} hullMode:${hullMode} smooth:${smoothRadius} -->\n</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `hull-${gridType}-${Date.now()}.svg`; a.click();
    URL.revokeObjectURL(url);
  };
  const exportPNG = () => {
    const c = canvasRef.current;
    if (!c) return;
    const url = c.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = `hull-${gridType}-${Date.now()}.png`; a.click();
  };

  const activeCount = activeIds.size;
  const clusterCount = (() => {
    const v = new Set<number>();
    let cnt = 0;
    for (const id of activeIds) if (!v.has(id)) {
      cnt++;
      const q = [id]; v.add(id);
      while (q.length) { const cur = q.shift()!; const nb = adjacency.get(cur); if (nb) for (const n of nb) if (activeIds.has(n) && !v.has(n)) { v.add(n); q.push(n); } }
    }
    return cnt;
  })();

  const largestCluster = (() => {
    const v = new Set<number>();
    let max = 0;
    for (const id of activeIds) if (!v.has(id)) {
      let size = 0;
      const q = [id]; v.add(id);
      while (q.length) { const cur = q.shift()!; size++; const nb = adjacency.get(cur); if (nb) for (const n of nb) if (activeIds.has(n) && !v.has(n)) { v.add(n); q.push(n); } }
      max = Math.max(max, size);
    }
    return max;
  })();

  const totalArea = hulls.reduce((s, h) => s + (h.isHole ? -h.area : h.area), 0);
  const totalPerim = hulls.reduce((s, h) => s + h.perimeter, 0);

  const activeKeyAction = isFPressed
    ? 'ACTIVATE'
    : isEPressed
      ? 'ERASE'
      : isDPressed
        ? 'SUBDIVIDE'
        : isSPressed
          ? 'REDUCE SUB'
          : isTPressed
            ? 'INSET'
            : isYPressed
              ? 'RESTORE'
              : null;

  return (
    <NCTGraphiteAppShell
      gap={0}
      proportion="220px 1fr 300px"
      header={
      <header data-safe-area-sticky-top style={{ top: 'var(--safe-area-inset-top)' }} className="sticky z-20 backdrop-blur bg-[#0e0e14]/90 border-b border-[#1a1a24] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
          <h1 className="text-[13px] font-bold tracking-[0.18em]">GRID CELL HULL LAB — ACTIVATE → HULL</h1>
          <span className="hidden md:inline text-[10px] tracking-widest text-[var(--text-dim)] ml-4">MARCHING SQUARES REPLACED BY EXPLICIT CELL + HULL • 60FPS</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="px-2 py-1 bg-[#1a1a24] rounded">{GRID_LABELS[gridType]}</span>
          <span className="px-2 py-1 bg-[#1a1a24] rounded">SUB {subdivide}</span>
          <span className="px-2 py-1 bg-[#1a1a24] rounded">{hullMode}</span>
          <span className="px-2 py-1 bg-[var(--accent)] text-black rounded font-bold">{activeCount} CELLS</span>
        </div>
      </header>
      }
      footer={
      <footer className="border-t border-[#1a1a24] bg-[#0e0e14] px-4 py-2 text-[10px] tracking-widest text-[#9a958c] flex justify-between">
        <span>GRID CELL HULL LAB • DARK PANELS #0e0e14 #1a1a24 • ACCENT #c2a878 #7c5cff • MONO JetBrains Mono • 60FPS SPATIAL HASH</span>
        <span className="hidden md:inline">SQUARE = ORTHO TECHNICAL • HEX HORIZ/VERT = HONEYCOMB • HEX H. DIAMOND = 3 RHOMBS • TRI HORIZ/VERT = 60° DYNAMIC</span>
      </footer>
      }
    >
        {/* Left panel */}
        <NCTGraphiteStagePanel side="left" width={220} className="bg-[#0e0e14] border-r border-[#1a1a24] p-4 flex flex-col gap-4 shrink-0">
          <div className="rounded-[18px] bg-[var(--panel-2)] text-[#fdfaf3] p-3 border border-white/10">
            <div className="text-[10px] tracking-[0.18em] opacity-60 mb-3 [font-family:var(--font-alt-mono)]">KEY-CLICKS — MOUSE AIMS</div>
            <div className="space-y-2">
              {[
                { k: 'F', label: 'ACTIVATE', desc: 'paint cells under brush', active: isFPressed },
                { k: 'E', label: 'ERASE', desc: 'remove cells under brush', active: isEPressed },
                { k: 'D', label: 'SUBDIVIDE', desc: 'split cells under brush', active: isDPressed },
                { k: 'S', label: 'REDUCE SUB', desc: 'merge subdivided cells', active: isSPressed },
                { k: 'T / Y', label: 'INSET / RESTORE', desc: 'scale cell shapes ±', active: isTPressed || isYPressed },
                { k: 'Q', label: 'SMOOTH', desc: 'average gaps with neighbors', active: hullHeld.has('smooth') },
                { k: 'V', label: 'REGEN HULL', desc: 'recompute hulls now', active: hullHeld.has('compute') },
                { k: 'X / ⇧X', label: 'CLEAR / INVERT', desc: 'clear all • shift inverts', active: hullHeld.has('clear') },
                { k: '[ ]', label: 'RADIUS', desc: `${brushRadius}px • 16–160`, active: hullHeld.has('brushSmaller') || hullHeld.has('brushLarger') },
                { k: '1-5 / 0', label: 'GRID', desc: GRID_LABELS[gridType], active: false },
                { k: '6-9', label: 'HULL', desc: hullMode.toUpperCase(), active: false },
                { k: 'C', label: 'NEW COLOR', desc: 'cycle palette group', active: false },
                { k: 'M / L', label: 'GRID / FILL', desc: `${showGrid ? 'grid on' : 'grid off'} • ${showShapeFill ? 'fill on' : 'fill off'}`, active: false },
                { k: 'B', label: 'BRUSH SHAPE', desc: brushShape, active: false },
                { k: "; '", label: 'ROTATE', desc: `${brushAngle}° • ±15°`, active: hullHeld.has('rotateCcw') || hullHeld.has('rotateCw') },
              ].map((it) => (
                <div
                  key={it.k + it.label}
                  className={`group flex items-center gap-2.5 rounded-[12px] border px-2.5 py-2.5 transition ${it.active ? 'bg-[#7c5cff] border-[#7c5cff] text-white shadow-[0_0_0_3px_rgba(124,92,255,0.25)]' : 'bg-[#1a1a24] border-white/10 hover:border-white/20'}`}
                >
                  <div className={`h-8 min-w-[40px] grid place-items-center rounded-[8px] text-[12px] font-bold border [font-family:var(--font-alt-mono)] ${it.active ? 'bg-white text-[#0e0e14] border-white' : 'bg-[#0e0e14] border-white/15 text-white'}`}>
                    {it.k}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold tracking-wide leading-none [font-family:var(--font-alt-mono)]">{it.label}</div>
                    <div className="text-[10px] opacity-60 truncate [font-family:var(--font-alt-mono)]">{it.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <NCTGraphiteStack direction="row" gap={8} className="mt-3">
              <div className={`flex-1 h-[36px] rounded-full grid place-items-center text-[11px] font-bold transition [font-family:var(--font-alt-mono)] ${activeKeyAction ? 'bg-[#00e5ff] text-black' : 'bg-white/10 text-white/50'}`}>
                {activeKeyAction ? `● ${activeKeyAction}` : 'IDLE — MOVE MOUSE'}
              </div>
            </NCTGraphiteStack>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-2">GRID COMPARISON</div>
            <div className="text-[10px] leading-3.5 space-y-2 text-[#9a958c]">
              <div><span className="text-[#fdfaf3]">Square:</span> orthogonal, technical, laser-cut friendly, 90° hull.</div>
              <div><span className="text-[#fdfaf3]">Hex Horiz:</span> honeycomb, organic facade, 60°/120° hull, best for ornament.</div>
              <div><span className="text-[#fdfaf3]">Hex H. Diamond:</span> each horizontal hex split into three 60° rhombs meeting at the center.</div>
              <div><span className="text-[#fdfaf3]">Hex Vert:</span> vertical honeycomb, shirt pattern, dense packing.</div>
              <div><span className="text-[#fdfaf3]">Tri Horiz:</span> bases run left-right, 60° spikes, aggressive graphics.</div>
              <div><span className="text-[#fdfaf3]">Tri Vert:</span> bases run up-down, matching hex vert orientation.</div>
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          <NCTGraphiteStack direction="row" gap={8}>
            <button onClick={() => setActiveIds(new Set())} className="flex-1 py-2 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded">X Clear</button>
            <button onClick={doSmoothGaps} className="flex-1 py-2 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded">Q Smooth</button>
            <button onClick={computeNow} className="flex-1 py-2 text-[11px] bg-[var(--accent)] text-black font-bold rounded">V Hull</button>
          </NCTGraphiteStack>
        </NCTGraphiteStagePanel>

        {/* Center */}
        <NCTGraphiteStageMain className="items-center bg-[#14141d] p-2 md:p-4 gap-3">
          <div className="relative bg-[#fdfaf3] rounded-[8px] overflow-hidden shadow-[0_0_0_1px_#1a1a24] max-w-full">
            <canvas
              ref={canvasRef}
              width={WIDTH}
              height={HEIGHT}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => { setIsMouseDown(false); setMousePos(null); snapAnchorRef.current = null; }}
              className="block max-w-[100vw] lg:max-w-[960px] w-[960px] h-[720px] cursor-crosshair touch-none"
            />
            {showShirt && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-[#fdfaf3]/80 backdrop-blur-sm">
                <div className="relative w-[320px] h-[420px]">
                  <svg viewBox="0 0 200 260" className="w-full h-full">
                    <path d="M60 20 L40 45 L20 45 L10 60 L25 75 L45 60 L45 240 L155 240 L155 60 L175 75 L190 60 L180 45 L160 45 L140 20 Z" fill="#111" opacity={0.9} />
                    <clipPath id="shirtClip"><path d="M60 20 L40 45 L20 45 L10 60 L25 75 L45 60 L45 240 L155 240 L155 60 L175 75 L190 60 L180 45 L160 45 L140 20 Z" /></clipPath>
                    <g clipPath="url(#shirtClip)">
                      {/* simple preview of hulls */}
                      {hulls.slice(0,3).map((h,i)=>(
                        <path key={i} d={generateSmoothPathData(h.points.map(p=>({x: p.x*0.2+30, y: p.y*0.2+60})), cellSize*0.2)} fill="none" stroke={['#c2a878','#7c5cff','#ff7a5c'][i%3]} strokeWidth={1.2} />
                      ))}
                    </g>
                  </svg>
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] px-2 py-1 bg-black text-white rounded">SHIRT MOCKUP — SVG READY FOR SCREEN PRINT</div>
                </div>
              </div>
            )}
          </div>
          <div className="w-full max-w-[960px] flex flex-wrap gap-2 text-[10px] tracking-wide">
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">MOUSE {mousePos ? `${mousePos.x.toFixed(0)},${mousePos.y.toFixed(0)}` : '--'}</div>
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">BRUSH {brushRadius} {brushShape.toUpperCase()} {brushAngle}° • {snapToCellCenters ? 'CELL SNAP ' : ''}{snapToGridDirections ? `LINE SNAP ${snapTolerance}` : 'FREE'} • {brushMode.toUpperCase()} {isFPressed ? '[F]' : ''}{isEPressed ? '[E]' : ''}{isDPressed ? '[D]' : ''}{isSPressed ? '[S]' : ''}{isTPressed ? '[T]' : ''}{isYPressed ? '[Y]' : ''}</div>
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">GRID {GRID_LABELS[gridType]} • {cellSize}px • SUB {subdivide} • {meshCells.length} cells</div>
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">{activeCount} ACTIVE • {clusterCount} CLUSTERS • LARGEST {largestCluster}</div>
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">{hulls.length} HULLS • {hullMode.toUpperCase()} • AREA {totalArea.toFixed(0)} • PERIM {totalPerim.toFixed(0)}</div>
            <div className="px-2 py-1 bg-[#1a1a24] rounded">FPS 60 • SPATIAL HASH VIA EDGE MAP</div>
          </div>
        </NCTGraphiteStageMain>

        {/* Right panel */}
        <NCTGraphiteStagePanel side="right" width={300} className="bg-[#0e0e14] border-l border-[#1a1a24] p-4 flex flex-col gap-5 shrink-0 overflow-y-auto max-h-[calc(100vh-60px)]">
          {/* Brush */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">BRUSH</div>
            <NCTGraphiteGrid columns="repeat(3, 1fr)" gap={6} className="mb-3">
              {(['circle','square','triangle'] as BrushShape[]).map((t)=>(
                <button key={t} onClick={()=>setBrushShape(t)} className={`inline-flex items-center justify-center gap-1 py-2 text-[11px] rounded border ${brushShape===t?'bg-[var(--accent)] text-black border-[var(--accent)] font-bold':'bg-[#1a1a24] border-[#222230] hover:bg-[#222230]'}`}>{BRUSH_ICONS[t]}<span>{t.toUpperCase()}</span></button>
              ))}
            </NCTGraphiteGrid>
            <div className="flex justify-between text-[10px] mb-1"><span>ROTATE</span><span>{brushAngle}°</span></div>
            <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={6}>
              <button onClick={()=>setBrushAngle((a)=>(a+345)%360)} className="inline-flex items-center justify-center gap-1 py-2 text-[11px] rounded border bg-[#1a1a24] border-[#222230] hover:bg-[#222230]">{ICONS.rotateCcw}<span>; −15°</span></button>
              <button onClick={()=>setBrushAngle((a)=>(a+15)%360)} className="inline-flex items-center justify-center gap-1 py-2 text-[11px] rounded border bg-[#1a1a24] border-[#222230] hover:bg-[#222230]">{ICONS.rotateCw}<span>' +15°</span></button>
            </NCTGraphiteGrid>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          {/* Grid */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">GRID</div>
            <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={6} className="mb-3">
              {GRID_TYPES.map((t)=>(
                <button key={t} onClick={()=>loadGridType(t)} className={`inline-flex items-center justify-center gap-1 py-2 text-[11px] rounded border ${gridType===t?'bg-[var(--accent)] text-black border-[var(--accent)] font-bold':'bg-[#1a1a24] border-[#222230] hover:bg-[#222230]'}`}>{GRID_ICONS[t]}<span>{GRID_LABELS[t]}</span></button>
              ))}
            </NCTGraphiteGrid>
            <div className="space-y-3">
              <NCTGraphiteSlider label="CELL SIZE" value={cellSize} min={14} max={60} onChange={setCellSize} />
              <NCTGraphiteSlider label="SUBDIVIDE" value={subdivide} min={0} max={4} step={1} onChange={(v) => setSubdivide(Math.round(v))} hint="Max split depth. D splits under the brush; S merges." />
              <NCTGraphiteSlider label="DEFAULT CELL SHAPE SCALE" value={cellShapeScale} min={0.05} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={setCellShapeScale} hint="1.00 is the original cell size. T and Y create per-cell scale overrides under the brush." />
              <div>
                <div className="text-[10px] mb-1.5">SUBDIVIDE TARGET</div>
                <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={6}>
                  {(['shape', 'grid'] as SubdivideTarget[]).map((target) => (
                    <button key={target} onClick={() => setSubdivideTarget(target)} className={`inline-flex items-center justify-center gap-1 py-2 text-[11px] rounded border ${subdivideTarget === target ? 'bg-[var(--accent)] text-black border-[var(--accent)] font-bold' : 'bg-[#1a1a24] border-[#222230] hover:bg-[#222230]'}`}>{target === 'shape' ? ICONS.targetShape : ICONS.gridSquare}<span>{target.toUpperCase()}</span></button>
                  ))}
                </NCTGraphiteGrid>
              </div>
              <NCTGraphiteSlider label="FALLOFF POWER" value={falloffPower} min={0.25} max={4} step={0.25} format={(v) => v === 1 ? '1.00 • LINEAR' : v.toFixed(2)} onChange={setFalloffPower} hint="Shared brush influence. 1 is linear; higher powers concentrate deposits and detail toward the brush center." />
              <NCTGraphiteStack direction="row" gap={8} className="text-[10px]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={paintFalloff} onChange={e => setPaintFalloff(e.target.checked)} /> F Paint Falloff</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={subdivideFalloff} onChange={e => setSubdivideFalloff(e.target.checked)} /> D Subdivide Falloff</label>
              </NCTGraphiteStack>
              <NCTGraphiteSlider label="JITTER ORGANIC" value={jitter} min={0} max={0.3} step={0.01} format={(v)=>v.toFixed(2)} onChange={setJitter} />
              <NCTGraphiteStack direction="row" gap={8} className="text-[10px]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={snapToCellCenters} onChange={e=>setSnapToCellCenters(e.target.checked)} /> Snap to Cell Centers</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={snapToGridDirections} onChange={e=>setSnapToGridDirections(e.target.checked)} /> Line Snap to Grid Directions</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)} /> Show Grid</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showCenters} onChange={e=>setShowCenters(e.target.checked)} /> Centers</label>
              </NCTGraphiteStack>
              <NCTGraphiteSlider label="LINE SNAP TOLERANCE" value={snapTolerance} min={2} max={48} step={1} onChange={setSnapTolerance} hint="The brush center snaps to a guide only within this distance." />
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          {/* Hull */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">HULL</div>
            <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={6} className="mb-3">
              {(['tight','smooth','convex','concave'] as HullMode[]).map((m)=>(
                <button key={m} onClick={()=>setHullMode(m)} className={`inline-flex items-center justify-center gap-1 py-2 text-[11px] rounded border ${hullMode===m?'bg-[#7c5cff] text-white border-[#7c5cff] font-bold':'bg-[#1a1a24] border-[#222230] hover:bg-[#222230]'}`}>{HULL_ICONS[m]}<span>{m.toUpperCase()}</span></button>
              ))}
            </NCTGraphiteGrid>
            <div className="space-y-3">
              <NCTGraphiteSlider label="SMOOTH RADIUS 0-0.5" value={smoothRadius} min={0} max={0.5} step={0.01} format={(v)=>v.toFixed(2)} onChange={setSmoothRadius} />
              <NCTGraphiteSlider label="STROKE WIDTH 1-5" value={strokeWidth} min={1} max={5} step={0.1} onChange={setStrokeWidth} />
              <NCTGraphiteSlider label="FILL OPACITY" value={fillOpacity} min={0} max={1} step={0.05} format={(v)=>v.toFixed(2)} onChange={setFillOpacity} />
              <NCTGraphiteStack direction="row" gap={8} className="text-[10px]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={colorByCluster} onChange={e=>setColorByCluster(e.target.checked)} /> Color by Cluster</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={liveHull} onChange={e=>setLiveHull(e.target.checked)} /> Live Hull</label>
              </NCTGraphiteStack>
              <div className="text-[10px] text-[#9a958c]">Corner: {cornerMode} • {hullMode==='tight'?'Tight follows cell edges':hullMode==='smooth'?`Arc radius = cellSize*${smoothRadius}`:hullMode==='convex'?'Monotone chain + Chaikin':'Alpha concave tight'}</div>
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          {/* Display */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">DISPLAY — SHAPE EFFECT</div>
            <div className="space-y-2 text-[10px]">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showShapeFill} onChange={e=>setShowShapeFill(e.target.checked)} /> Shape Color Fill</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showShapeOutline} onChange={e=>setShowShapeOutline(e.target.checked)} /> Shape Outline</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showDivisions} onChange={e=>setShowDivisions(e.target.checked)} /> Base Divisions</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showSubdivisions} onChange={e=>setShowSubdivisions(e.target.checked)} /> Subdivision Lines</label>
              <div className="text-[#9a958c] leading-3.5 pt-1">Turn off Shape Color Fill to use the active shape as a line-based subdivision pattern. Base divisions separate original cells; subdivision lines show splits inside them.</div>
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          {/* Cells */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">CELLS</div>
            <NCTGraphiteGrid columns="repeat(3, 1fr)" gap={8} className="text-[11px]">
              <div className="bg-[#1a1a24] p-2 rounded"><div className="text-[10px] text-[#9a958c]">ACTIVE</div><div className="font-bold">{activeCount}</div></div>
              <div className="bg-[#1a1a24] p-2 rounded"><div className="text-[10px] text-[#9a958c]">CLUSTERS</div><div className="font-bold">{clusterCount}</div></div>
              <div className="bg-[#1a1a24] p-2 rounded"><div className="text-[10px] text-[#9a958c]">LARGEST</div><div className="font-bold">{largestCluster}</div></div>
            </NCTGraphiteGrid>
            <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={8} className="mt-3">
              <button onClick={doSmoothGaps} className="inline-flex items-center justify-center gap-1 py-2 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded border border-[#222230]">{ICONS.fillGaps}<span>Fill Gaps ≥3 neigh</span></button>
              <button onClick={()=>{ setActiveIds(prev=>{ const ns=new Set(prev); for(const cell of cells){ const nb=adjacency.get(cell.id); let an=0; if(nb) for(const n of nb) if(prev.has(n)) an++; if(prev.has(cell.id)&&an===0) ns.delete(cell.id);} return ns; }); }} className="inline-flex items-center justify-center gap-1 py-2 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded border border-[#222230]">{ICONS.removeIsolated}<span>Remove Isolated</span></button>
            </NCTGraphiteGrid>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          {/* Output */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">OUTPUT — DESIGN READY</div>
            <div className="space-y-2">
              <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={8}>
                <button onClick={computeNow} className="inline-flex items-center justify-center gap-1.5 py-2.5 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded font-bold">{ICONS.regenerate}<span>V REGENERATE</span></button>
                <button onClick={()=>setShowShirt(v=>!v)} className={`inline-flex items-center justify-center gap-1.5 py-2.5 text-[11px] rounded font-bold ${showShirt?'bg-[var(--accent)] text-black':'bg-[#1a1a24] hover:bg-[#222230]'}`}>{ICONS.shirt}<span>SHIRT MOCKUP</span></button>
              </NCTGraphiteGrid>
              <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={8}>
                <button onClick={exportSVG} className="inline-flex items-center justify-center gap-1.5 py-2.5 text-[11px] bg-[#fdfaf3] text-black hover:bg-white rounded font-bold">{ICONS.download}<span>EXPORT SVG</span></button>
                <button onClick={exportPNG} className="inline-flex items-center justify-center gap-1.5 py-2.5 text-[11px] bg-[#222230] hover:bg-[#2a2a3a] rounded font-bold">{ICONS.image}<span>EXPORT PNG</span></button>
              </NCTGraphiteGrid>
              <div className="text-[10px] leading-3.5 bg-[#15151f] p-2 rounded border border-[#1a1a24] text-[#9a958c]">
                SVG: &lt;g id="cells"&gt; &lt;polygon points=...&gt; per cell, &lt;g id="hulls"&gt; &lt;path d="M ... Z"&gt; per cluster. If Smooth mode, path includes A arc commands. Ready for laser cut / screen print. Includes metadata comment grid type, cell size, hull mode.
                <br/><br/>Stats: Area {totalArea.toFixed(0)} / Perim {totalPerim.toFixed(0)} • Live debounced 150ms + full on mouse up.
              </div>
            </div>
          </div>

          <div className="h-px bg-[#1a1a24]" />
          <div className="text-[10px] text-[#9a958c] leading-4">
            <span className="text-[#fdfaf3]">Brush:</span> Size [{brushRadius}] shape {brushShape} — cells inside the brush shape activate, and cells it would change highlight under the brush. Snap to Cell Centers locks deposits to original cell centers; Line Snap uses the first brush center as a guide origin and only locks when the center comes within its tolerance. When both are on, cell centering runs first. Square follows horizontal/vertical guides; hex and triangle follow 0°/60°/120° guides. B cycles circle/square/triangle; ; and ' rotate. Press/hold F to deposit, E to erase, D to subdivide, S to reduce subdivision, T to inset cell shapes, or Y to restore them. No mouse movement needed.<br/>
            <span className="text-[#fdfaf3]">Subdivide:</span> Target {subdivideTarget}; max depth {subdivide}. Square splits into 4, triangle into 4, hex into 6 triangles then 4. Shape only splits active cells; Grid can split any cell. Active cells keep paint on children. S merges a parent when all children are still leaves.<br/>
            <span className="text-[#fdfaf3]">Falloff:</span> Power {falloffPower.toFixed(2)} {falloffPower === 1 ? '(linear)' : ''}. F activates the center first and accumulates toward the edge; D creates deeper detail at the center and coarser edges. Either effect can be toggled independently.
            <br/><span className="text-[#fdfaf3]">Cell shape scale:</span> Default {cellShapeScale.toFixed(2)}. T/Y adjust each cell by 0.05 toward its center or back to 1.00. When F Paint Falloff is enabled, the same brush influence attenuates that adjustment.<br/>
            <span className="text-[#fdfaf3]">Hull:</span> Group active via flood fill (BFS through edge-adjacent neighbors). Collect perimeter edges where neighbor not active. Link edges into closed loops via point map + min-turn. Tight = direct polyline. Smooth = arcTo with radius cellSize*smoothRadius. Convex = monotone chain. Concave = same as tight (follows indentations).
          </div>
        </NCTGraphiteStagePanel>
    </NCTGraphiteAppShell>
  );
}
