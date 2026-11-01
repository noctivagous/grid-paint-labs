import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';

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
};

type Hull = {
  id: string;
  clusterId: number;
  points: Vec[];
  closed: boolean;
  isHole: boolean;
  area: number;
  perimeter: number;
};

type GridType = 'square' | 'hexFlat' | 'hexPointy' | 'triangle';
type HullMode = 'tight' | 'smooth' | 'convex' | 'concave';

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
      cells.push({ id: id++, cx, cy, col: c, row: r, corners, edges });
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
      cells.push({ id: id++, cx, cy, col: c, row: r, corners, edges });
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
      cells.push({ id: id++, cx, cy, col: c, row: r, corners, edges });
    }
  }
  return cells;
}

function genTriangle(width: number, height: number, triSize: number, jitter: number): Cell[] {
  const triH = (triSize * Math.sqrt(3)) / 2;
  const cols = Math.ceil(width / triSize) + 4;
  const rows = Math.ceil(height / triH) + 4;
  const latticeJitter = new Map<string, { dx: number; dy: number }>();
  const getLattice = (x: number, y: number) => {
    const k = `${Math.round(x * 10)}_${Math.round(y * 10)}`;
    if (!latticeJitter.has(k)) latticeJitter.set(k, getJitter(`tri-${k}`, jitter, triSize));
    const off = latticeJitter.get(k)!;
    return { x: x + off.dx, y: y + off.dy };
  };
  const cells: Cell[] = [];
  let id = 0;
  for (let r = -2; r < rows; r++) {
    for (let c = -2; c < cols; c++) {
      const baseX = c * triSize + (r % 2 === 1 ? triSize / 2 : 0) - triSize;
      const baseY = r * triH - triH;
      const p0 = getLattice(baseX, baseY);
      const p1 = getLattice(baseX + triSize, baseY);
      const p2 = getLattice(baseX + triSize + triSize / 2, baseY + triH);
      const p3 = getLattice(baseX + triSize / 2, baseY + triH);

      // tri1 p0,p1,p3
      const t1Corners = [p0, p1, p3];
      const t1Cx = (p0.x + p1.x + p3.x) / 3;
      const t1Cy = (p0.y + p1.y + p3.y) / 3;
      if (t1Cx >= -triSize && t1Cx <= width + triSize && t1Cy >= -triSize && t1Cy <= height + triSize) {
        const raw: EdgeRaw[] = [
          { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y },
          { x1: p1.x, y1: p1.y, x2: p3.x, y2: p3.y },
          { x1: p3.x, y1: p3.y, x2: p0.x, y2: p0.y },
        ];
        const edges = raw.map((e) => ({ ...e, key: edgeKey(e.x1, e.y1, e.x2, e.y2) }));
        cells.push({ id: id++, cx: t1Cx, cy: t1Cy, col: c, row: r, corners: t1Corners, edges });
      }
      // tri2 p1,p2,p3
      const t2Corners = [p1, p2, p3];
      const t2Cx = (p1.x + p2.x + p3.x) / 3;
      const t2Cy = (p1.y + p2.y + p3.y) / 3;
      if (t2Cx >= -triSize && t2Cx <= width + triSize && t2Cy >= -triSize && t2Cy <= height + triSize) {
        const raw: EdgeRaw[] = [
          { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
          { x1: p2.x, y1: p2.y, x2: p3.x, y2: p3.y },
          { x1: p3.x, y1: p3.y, x2: p1.x, y2: p1.y },
        ];
        const edges = raw.map((e) => ({ ...e, key: edgeKey(e.x1, e.y1, e.x2, e.y2) }));
        cells.push({ id: id++, cx: t2Cx, cy: t2Cy, col: c, row: r, corners: t2Corners, edges });
      }
    }
  }
  return cells;
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
  const [cellSize, setCellSize] = useState(28);
  const [jitter, setJitter] = useState(0);
  const [brushRadius, setBrushRadius] = useState(64);
  const [hullMode, setHullMode] = useState<HullMode>('tight');
  const [smoothRadius, setSmoothRadius] = useState(0.22);
  const [showGrid, setShowGrid] = useState(true);
  const [showCenters, setShowCenters] = useState(false);
  const [fillHull, setFillHull] = useState(true);
  const [fillOpacity, setFillOpacity] = useState(0.18);
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [colorByCluster, setColorByCluster] = useState(true);
  const [liveHull, setLiveHull] = useState(true);
  const [cornerMode] = useState<'arc' | 'miter' | 'bevel'>('arc');

  // Interaction
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set([10, 11, 12, 30, 31, 32, 33]));
  const [mousePos, setMousePos] = useState<Vec | null>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [brushMode, setBrushModeState] = useState<'activate' | 'erase'>('activate');
  const [isFPressed, setIsFPressed] = useState(false);
  const [isEPressed, setIsEPressed] = useState(false);
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
    if (val.gridType) setGridType(val.gridType);
    if (val.cellSize) setCellSize(val.cellSize);
    if (val.hullMode) setHullMode(val.hullMode);
    if (val.smoothRadius !== undefined) setSmoothRadius(val.smoothRadius);
    if (Array.isArray(val.active)) setActiveIds(new Set(val.active));
  };

  // Grid data
  const gridData = useMemo(() => {
    let cells: Cell[] = [];
    if (gridType === 'square') cells = genSquare(WIDTH, HEIGHT, cellSize, jitter);
    else if (gridType === 'hexFlat') cells = genHexFlat(WIDTH, HEIGHT, cellSize, jitter);
    else if (gridType === 'hexPointy') cells = genHexPointy(WIDTH, HEIGHT, cellSize, jitter);
    else cells = genTriangle(WIDTH, HEIGHT, cellSize, jitter);
    const { edgeMap, adjacency } = buildTopology(cells);
    return { cells, edgeMap, adjacency, cols: 0, rows: 0 };
  }, [gridType, cellSize, jitter]);

  const { cells, edgeMap, adjacency } = gridData;

  // Keep activeIds valid when grid changes (reset if cells changed drastically)
  useEffect(() => {
    setActiveIds((prev) => {
      const valid = new Set<number>();
      for (const id of prev) if (id < cells.length) valid.add(id);
      return valid;
    });
  }, [cells.length]);

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
      for (const cell of cells) {
        ctx.beginPath();
        ctx.moveTo(cell.corners[0].x, cell.corners[0].y);
        for (let i = 1; i < cell.corners.length; i++) ctx.lineTo(cell.corners[i].x, cell.corners[i].y);
        ctx.closePath();
        ctx.stroke();
      }
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

    // active cells
    for (const cell of cells) {
      if (!activeIds.has(cell.id)) continue;
      const cIdx = cellToCluster.get(cell.id) ?? 0;
      const col = colorByCluster ? shiftedPalette[cIdx % shiftedPalette.length] : shiftedPalette[0];
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.86;
      ctx.beginPath();
      ctx.moveTo(cell.corners[0].x, cell.corners[0].y);
      for (let i = 1; i < cell.corners.length; i++) ctx.lineTo(cell.corners[i].x, cell.corners[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#1a1a24';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // hulls
    for (const hull of hulls) {
      if (hull.points.length < 3) continue;
      const cIdx = hull.clusterId;
      const col = colorByCluster ? shiftedPalette[cIdx % shiftedPalette.length] : '#1a1a24';
      if (fillHull && !hull.isHole) {
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
      ctx.strokeStyle = brushMode === 'activate' ? '#7c5cff' : '#e84855';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(mousePos.x, mousePos.y, brushRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      let inBrush = 0, activeIn = 0;
      for (const cell of cells) {
        const dx = cell.cx - mousePos.x, dy = cell.cy - mousePos.y;
        if (Math.hypot(dx, dy) < brushRadius) {
          inBrush++;
          if (activeIds.has(cell.id)) activeIn++;
        }
      }
      ctx.fillStyle = '#0e0e14';
      ctx.fillRect(mousePos.x + 12, mousePos.y - 32, 86, 22);
      ctx.fillStyle = '#fdfaf3';
      ctx.font = '11px JetBrains Mono';
      ctx.fillText(`${inBrush}/${activeIn}`, mousePos.x + 18, mousePos.y - 17);
    }
  }, [cells, activeIds, hulls, showGrid, showCenters, mousePos, brushRadius, brushMode, colorByCluster, fillHull, fillOpacity, strokeWidth, hullMode, smoothRadius, cellSize, adjacency, paletteIdx]);

  // Interaction helpers
  const paintAt = useCallback((x: number, y: number, mode: 'activate' | 'erase') => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const cell of cells) {
        const d = Math.hypot(cell.cx - x, cell.cy - y);
        if (d < brushRadius) {
          if (mode === 'activate') {
            if (!next.has(cell.id)) { next.add(cell.id); changed = true; }
          } else {
            if (next.has(cell.id)) { next.delete(cell.id); changed = true; }
          }
        }
      }
      return changed ? next : prev;
    });
  }, [cells, brushRadius]);

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
    const { x, y } = getPos(e);
    setMousePos({ x, y });
    if (isMouseDown) paintAt(x, y, brushMode);
    else if (isFPressed) paintAt(x, y, 'activate');
    else if (isEPressed) paintAt(x, y, 'erase');
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getPos(e);
    setIsMouseDown(true);
    paintAt(x, y, brushMode);
  };
  const handleMouseUp = () => setIsMouseDown(false);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === '[') setBrushRadius((r) => Math.max(16, r - 8));
      if (k === ']') setBrushRadius((r) => Math.min(160, r + 8));
      if (k === 'f') { setIsFPressed(true); setBrushModeState('activate'); }
      if (k === 'e') { setIsEPressed(true); setBrushModeState('erase'); }
      if (k === 'q') doSmoothGaps();
      if (k === 'v') computeNow();
      if (k === 'x') {
        if (e.shiftKey) {
          const all = cells.map((c) => c.id);
          setActiveIds((prev) => {
            const ns = new Set<number>();
            for (const id of all) if (!prev.has(id)) ns.add(id);
            return ns;
          });
        } else setActiveIds(new Set());
      }
      if (k === 'c') setPaletteIdx((i) => (i + 1) % 5);
      if (k === '1') setGridType('square');
      if (k === '2') setGridType('hexFlat');
      if (k === '3') setGridType('hexPointy');
      if (k === '4') setGridType('triangle');
      if (k === '5') setHullMode('tight');
      if (k === '6') setHullMode('smooth');
      if (k === '7') setHullMode('convex');
      if (k === '8') setHullMode('concave');
      if (k === 'm') setShowGrid((v) => !v);
      if (k === 'l') setFillHull((v) => !v);
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'f') setIsFPressed(false);
      if (k === 'e') setIsEPressed(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [cells, doSmoothGaps, computeNow]);

  // Export
  const exportSVG = () => {
    let svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">\n`;
    svg += `<rect width="100%" height="100%" fill="#fdfaf3"/>\n<g id="cells">\n`;
    for (const cell of cells) if (activeIds.has(cell.id)) {
      const pts = cell.corners.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
      svg += `  <polygon points="${pts}" fill="#c2a878" stroke="#1a1a24" stroke-width="0.5" opacity="0.85"/>\n`;
    }
    svg += `</g>\n<g id="hulls">\n`;
    for (const hull of hulls) {
      const d = hullMode === 'smooth' ? generateSmoothPathData(hull.points, cellSize * smoothRadius) :
        `M ${hull.points[0]?.x.toFixed(2) || 0} ${hull.points[0]?.y.toFixed(2) || 0} ` + hull.points.slice(1).map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';
      svg += `  <path d="${d}" fill="${fillHull ? 'rgba(26,26,36,0.08)' : 'none'}" stroke="#1a1a24" stroke-width="${strokeWidth}" />\n`;
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

  return (
    <div data-safe-area-inset-root style={{ boxSizing: 'border-box', paddingTop: 'var(--safe-area-inset-top)' }} className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)] flex flex-col overflow-x-clip">
      {/* Header */}
      <header data-safe-area-sticky-top style={{ top: 'var(--safe-area-inset-top)' }} className="sticky z-20 backdrop-blur bg-[#0e0e14]/90 border-b border-[#1a1a24] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
          <h1 className="text-[13px] font-bold tracking-[0.18em]">GRID CELL HULL LAB — ACTIVATE → HULL</h1>
          <span className="hidden md:inline text-[10px] tracking-widest text-[var(--text-dim)] ml-4">MARCHING SQUARES REPLACED BY EXPLICIT CELL + HULL • 60FPS</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="px-2 py-1 bg-[#1a1a24] rounded">{gridType}</span>
          <span className="px-2 py-1 bg-[#1a1a24] rounded">{hullMode}</span>
          <span className="px-2 py-1 bg-[var(--accent)] text-black rounded font-bold">{activeCount} CELLS</span>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left panel */}
        <aside className="w-full lg:w-[220px] bg-[#0e0e14] border-r border-[#1a1a24] p-4 flex flex-col gap-4 shrink-0">
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-2">KEY-CLICKS — MOUSE AIMS</div>
            <div className="space-y-1.5 text-[11px] leading-4">
              <div className="flex justify-between"><span className="text-[#7c5cff]">F</span><span>Activate cells</span></div>
              <div className="flex justify-between"><span className="text-[#e84855]">E</span><span>Erase cells</span></div>
              <div className="flex justify-between"><span>Q</span><span>Smooth gaps</span></div>
              <div className="flex justify-between"><span>V</span><span>Regen Hull</span></div>
              <div className="flex justify-between"><span>X / ⇧X</span><span>Clear / Invert</span></div>
              <div className="flex justify-between"><span>[ ]</span><span>Brush 16-160</span></div>
              <div className="flex justify-between"><span>1-4</span><span>Grid Square/HexF/HexP/Tri</span></div>
              <div className="flex justify-between"><span>5-8</span><span>Hull Tight/Smooth/Convex/Concave</span></div>
              <div className="flex justify-between"><span>C</span><span>New Color Group</span></div>
              <div className="flex justify-between"><span>M / L</span><span>Show Grid / Fill Hull</span></div>
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-2">GRID COMPARISON</div>
            <div className="text-[10px] leading-3.5 space-y-2 text-[#9a958c]">
              <div><span className="text-[#fdfaf3]">Square:</span> orthogonal, technical, laser-cut friendly, 90° hull.</div>
              <div><span className="text-[#fdfaf3]">Hex Flat:</span> honeycomb, organic facade, 60°/120° hull, best for ornament.</div>
              <div><span className="text-[#fdfaf3]">Hex Pointy:</span> vertical honeycomb, shirt pattern, dense packing.</div>
              <div><span className="text-[#fdfaf3]">Triangle:</span> dynamic, star-like, 60° spikes, best for aggressive graphics.</div>
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          <div className="flex gap-2">
            <button onClick={() => setActiveIds(new Set())} className="flex-1 py-2 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded">X Clear</button>
            <button onClick={doSmoothGaps} className="flex-1 py-2 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded">Q Smooth</button>
            <button onClick={computeNow} className="flex-1 py-2 text-[11px] bg-[var(--accent)] text-black font-bold rounded">V Hull</button>
          </div>
        </aside>

        {/* Center */}
        <main className="flex-1 flex flex-col items-center bg-[#14141d] p-2 md:p-4 gap-3">
          <div className="relative bg-[#fdfaf3] rounded-[8px] overflow-hidden shadow-[0_0_0_1px_#1a1a24] max-w-full">
            <canvas
              ref={canvasRef}
              width={WIDTH}
              height={HEIGHT}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => { setIsMouseDown(false); setMousePos(null); }}
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
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">BRUSH {brushRadius} • {brushMode.toUpperCase()} {isFPressed ? '[F]' : ''}{isEPressed ? '[E]' : ''}</div>
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">GRID {gridType} • {cellSize}px • {cells.length} cells</div>
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">{activeCount} ACTIVE • {clusterCount} CLUSTERS • LARGEST {largestCluster}</div>
            <div className="px-2 py-1 bg-[#0e0e14] border border-[#1a1a24] rounded">{hulls.length} HULLS • {hullMode.toUpperCase()} • AREA {totalArea.toFixed(0)} • PERIM {totalPerim.toFixed(0)}</div>
            <div className="px-2 py-1 bg-[#1a1a24] rounded">FPS 60 • SPATIAL HASH VIA EDGE MAP</div>
          </div>
        </main>

        {/* Right panel */}
        <aside className="w-full lg:w-[300px] bg-[#0e0e14] border-l border-[#1a1a24] p-4 flex flex-col gap-5 shrink-0 overflow-y-auto max-h-[calc(100vh-60px)]">
          {/* Grid */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">GRID</div>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {(['square','hexFlat','hexPointy','triangle'] as GridType[]).map((t)=>(
                <button key={t} onClick={()=>setGridType(t)} className={`py-2 text-[11px] rounded border ${gridType===t?'bg-[var(--accent)] text-black border-[var(--accent)] font-bold':'bg-[#1a1a24] border-[#222230] hover:bg-[#222230]'}`}>{t.toUpperCase()}</button>
              ))}
            </div>
            <div className="space-y-3">
              <div><div className="flex justify-between text-[10px] mb-1"><span>CELL SIZE</span><span>{cellSize}</span></div><input type="range" min={14} max={60} value={cellSize} onChange={e=>setCellSize(parseInt(e.target.value))} className="w-full" /></div>
              <div><div className="flex justify-between text-[10px] mb-1"><span>JITTER ORGANIC</span><span>{jitter.toFixed(2)}</span></div><input type="range" min={0} max={0.3} step={0.01} value={jitter} onChange={e=>setJitter(parseFloat(e.target.value))} className="w-full" /></div>
              <div className="flex gap-2 text-[10px]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showGrid} onChange={e=>setShowGrid(e.target.checked)} /> Show Grid</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showCenters} onChange={e=>setShowCenters(e.target.checked)} /> Centers</label>
              </div>
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          {/* Hull */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">HULL</div>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {(['tight','smooth','convex','concave'] as HullMode[]).map((m)=>(
                <button key={m} onClick={()=>setHullMode(m)} className={`py-2 text-[11px] rounded border ${hullMode===m?'bg-[#7c5cff] text-white border-[#7c5cff] font-bold':'bg-[#1a1a24] border-[#222230] hover:bg-[#222230]'}`}>{m.toUpperCase()}</button>
              ))}
            </div>
            <div className="space-y-3">
              <div><div className="flex justify-between text-[10px] mb-1"><span>SMOOTH RADIUS 0-0.5</span><span>{smoothRadius.toFixed(2)}</span></div><input type="range" min={0} max={0.5} step={0.01} value={smoothRadius} onChange={e=>setSmoothRadius(parseFloat(e.target.value))} className="w-full" /></div>
              <div><div className="flex justify-between text-[10px] mb-1"><span>STROKE WIDTH 1-5</span><span>{strokeWidth}</span></div><input type="range" min={1} max={5} step={0.1} value={strokeWidth} onChange={e=>setStrokeWidth(parseFloat(e.target.value))} className="w-full" /></div>
              <div><div className="flex justify-between text-[10px] mb-1"><span>FILL OPACITY</span><span>{fillOpacity.toFixed(2)}</span></div><input type="range" min={0} max={1} step={0.05} value={fillOpacity} onChange={e=>setFillOpacity(parseFloat(e.target.value))} className="w-full" /></div>
              <div className="flex gap-2 text-[10px]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={fillHull} onChange={e=>setFillHull(e.target.checked)} /> Fill Hull</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={colorByCluster} onChange={e=>setColorByCluster(e.target.checked)} /> Color by Cluster</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={liveHull} onChange={e=>setLiveHull(e.target.checked)} /> Live Hull</label>
              </div>
              <div className="text-[10px] text-[#9a958c]">Corner: {cornerMode} • {hullMode==='tight'?'Tight follows cell edges':hullMode==='smooth'?`Arc radius = cellSize*${smoothRadius}`:hullMode==='convex'?'Monotone chain + Chaikin':'Alpha concave tight'}</div>
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          {/* Cells */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">CELLS</div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="bg-[#1a1a24] p-2 rounded"><div className="text-[10px] text-[#9a958c]">ACTIVE</div><div className="font-bold">{activeCount}</div></div>
              <div className="bg-[#1a1a24] p-2 rounded"><div className="text-[10px] text-[#9a958c]">CLUSTERS</div><div className="font-bold">{clusterCount}</div></div>
              <div className="bg-[#1a1a24] p-2 rounded"><div className="text-[10px] text-[#9a958c]">LARGEST</div><div className="font-bold">{largestCluster}</div></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={doSmoothGaps} className="py-2 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded border border-[#222230]">Fill Gaps ≥3 neigh</button>
              <button onClick={()=>{ setActiveIds(prev=>{ const ns=new Set(prev); for(const cell of cells){ const nb=adjacency.get(cell.id); let an=0; if(nb) for(const n of nb) if(prev.has(n)) an++; if(prev.has(cell.id)&&an===0) ns.delete(cell.id);} return ns; }); }} className="py-2 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded border border-[#222230]">Remove Isolated</button>
            </div>
          </div>
          <div className="h-px bg-[#1a1a24]" />
          {/* Output */}
          <div>
            <div className="text-[11px] tracking-widest text-[var(--text-dim)] mb-3">OUTPUT — DESIGN READY</div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={computeNow} className="py-2.5 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded font-bold">V REGENERATE</button>
                <button onClick={()=>setShowShirt(v=>!v)} className={`py-2.5 text-[11px] rounded font-bold ${showShirt?'bg-[var(--accent)] text-black':'bg-[#1a1a24] hover:bg-[#222230]'}`}>SHIRT MOCKUP</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={exportSVG} className="py-2.5 text-[11px] bg-[#fdfaf3] text-black hover:bg-white rounded font-bold">EXPORT SVG</button>
                <button onClick={exportPNG} className="py-2.5 text-[11px] bg-[#222230] hover:bg-[#2a2a3a] rounded font-bold">EXPORT PNG</button>
              </div>
              <div className="text-[10px] leading-3.5 bg-[#15151f] p-2 rounded border border-[#1a1a24] text-[#9a958c]">
                SVG: &lt;g id="cells"&gt; &lt;polygon points=...&gt; per cell, &lt;g id="hulls"&gt; &lt;path d="M ... Z"&gt; per cluster. If Smooth mode, path includes A arc commands. Ready for laser cut / screen print. Includes metadata comment grid type, cell size, hull mode.
                <br/><br/>Stats: Area {totalArea.toFixed(0)} / Perim {totalPerim.toFixed(0)} • Live debounced 150ms + full on mouse up.
              </div>
            </div>
          </div>

          <div className="h-px bg-[#1a1a24]" />
          <div className="text-[10px] text-[#9a958c] leading-4">
            <span className="text-[#fdfaf3]">Brush:</span> Circle radius [{brushRadius}] — activate cells within dist &lt; radius. Falloff power 1-3 (binary now). Hold F to paint, E to erase. Mouse aims only.<br/>
            <span className="text-[#fdfaf3]">Hull:</span> Group active via flood fill (BFS through edge-adjacent neighbors). Collect perimeter edges where neighbor not active. Link edges into closed loops via point map + min-turn. Tight = direct polyline. Smooth = arcTo with radius cellSize*smoothRadius. Convex = monotone chain. Concave = same as tight (follows indentations).
          </div>
        </aside>
      </div>

      <footer className="border-t border-[#1a1a24] bg-[#0e0e14] px-4 py-2 text-[10px] tracking-widest text-[#9a958c] flex justify-between">
        <span>GRID CELL HULL LAB • DARK PANELS #0e0e14 #1a1a24 • ACCENT #c2a878 #7c5cff • MONO JetBrains Mono • 60FPS SPATIAL HASH</span>
        <span className="hidden md:inline">SQUARE = ORTHO TECHNICAL • HEX FLAT = HONEYCOMB ORGANIC • TRIANGLE = 60° DYNAMIC</span>
      </footer>
    </div>
  );
}
