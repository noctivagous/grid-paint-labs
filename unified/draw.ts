import paper from 'paper';
import { vectorStyle, type NCTGraphitePoint } from '@nct/nctgraphite';
import type { DotShadingLayer, GridPaintDocument, GridPaintLayer, MetaballLayer, VectorFieldLayer } from './layers';
import { hullOutlines, layerLattice, metaballContours, metaballNecks, PALETTE } from './layers';

function toColor(scope: paper.PaperScope, value: string, alpha = 1): paper.Color {
  const color = new scope.Color(value);
  color.alpha = alpha;
  return color;
}

function polygon(scope: paper.PaperScope, corners: readonly NCTGraphitePoint[]): paper.Path {
  const path = new scope.Path();
  for (const corner of corners) path.add(new scope.Point(corner.x, corner.y));
  path.closed = true;
  return path;
}

function pathFromD(scope: paper.PaperScope, d: string, fill: string, alpha: number) {
  const item = new scope.CompoundPath({ pathData: d });
  item.fillColor = toColor(scope, fill, alpha);
  item.strokeColor = toColor(scope, fill, Math.min(1, alpha + 0.15));
  item.strokeWidth = 1;
  item.fillRule = 'evenodd';
  return item;
}

function drawCellLayer(scope: paper.PaperScope, layer: Extract<GridPaintLayer, { mode: 'hull' | 'cell-paint' }>, canvas: GridPaintDocument['snapshot']['canvas'], opacity: number) {
  const lattice = layerLattice(layer, canvas);
  if (layer.settings.showGrid) {
    for (const cell of lattice) {
      const path = polygon(scope, cell.corners);
      path.strokeColor = toColor(scope, '#cfc6b4', 0.55 * opacity);
      path.strokeWidth = 1;
    }
  }
  for (const cell of lattice) {
    const painted = layer.data.cells[cell.id];
    if (!painted) continue;
    const path = polygon(scope, cell.corners);
    path.fillColor = toColor(scope, painted.color, (layer.mode === 'hull' ? 0.78 : 0.92) * opacity);
    path.strokeColor = toColor(scope, painted.color, opacity);
    path.strokeWidth = 1;
  }
  if (layer.mode === 'cell-paint' && layer.settings.showCenters) {
    for (const cell of lattice) {
      const dot = new scope.Path.Circle(new scope.Point(cell.center.x, cell.center.y), 1.4);
      dot.fillColor = toColor(scope, '#8a8378', opacity);
    }
  }
  if (layer.mode === 'hull') {
    for (const loop of hullOutlines(layer, canvas)) {
      if (loop.points.length < 3) continue;
      const path = polygon(scope, loop.points);
      path.strokeColor = toColor(scope, '#1a1a24', opacity);
      path.strokeWidth = loop.hole ? 1.4 : 2.4;
      path.fillColor = loop.hole ? null : toColor(scope, '#1a1a24', 0.06 * opacity);
    }
  }
}

function drawMetaballLayer(scope: paper.PaperScope, layer: MetaballLayer, canvas: GridPaintDocument['snapshot']['canvas'], opacity: number) {
  if (layer.settings.showGrid) {
    const cols = layer.settings.gridResolution;
    const rows = Math.max(8, Math.round(cols * (canvas.height / canvas.width)));
    const cellW = canvas.width / cols;
    const cellH = canvas.height / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const dot = new scope.Path.Circle(new scope.Point((i + 0.5) * cellW, (j + 0.5) * cellH), 0.9);
        dot.fillColor = toColor(scope, '#cfc6b4', 0.35 * opacity);
      }
    }
  }
  if (layer.settings.engine === 'arc') {
    for (const blob of layer.data.blobs) {
      const circle = new scope.Path.Circle(new scope.Point(blob.x, blob.y), blob.r);
      const alpha = blob.type === 'negative' ? 0.18 : 0.82;
      circle.fillColor = toColor(scope, blob.color, alpha * opacity);
      circle.strokeColor = toColor(scope, blob.color, opacity);
      circle.strokeWidth = blob.type === 'negative' ? 1 : 1.4;
    }
    for (const neck of metaballNecks(layer)) {
      pathFromD(scope, neck.path, neck.color, 0.88 * opacity);
    }
    return;
  }
  for (const contour of metaballContours(layer, canvas)) {
    pathFromD(scope, contour.pathD, contour.color, 0.88 * opacity);
  }
}

function drawVectorLayer(scope: paper.PaperScope, layer: VectorFieldLayer, opacity: number, brush: { x: number; y: number; radius: number } | null, painting: boolean) {
  const minCell = layer.data.vectors.length
    ? Math.min(
      Math.abs(layer.data.vectors[1]?.x - layer.data.vectors[0]?.x || 16),
      24,
    )
    : 16;
  for (const sample of layer.data.vectors) {
    const idle = new scope.Path.Circle(new scope.Point(sample.x, sample.y), 0.8);
    idle.fillColor = toColor(scope, '#1a1a24', 0.12 * opacity);
  }
  if (layer.settings.showVectors) {
    for (const sample of layer.data.vectors) {
      const inBrush = !!brush && Math.hypot(sample.x - brush.x, sample.y - brush.y) < brush.radius;
      const style = vectorStyle(sample.vx, sample.vy, layer.settings.hoverThin && inBrush && !painting);
      if (style.skip) continue;
      const length = style.m * minCell * 0.9;
      const angle = Math.atan2(sample.vy, sample.vx);
      const color = `hsla(${style.hue}, 95%, ${style.light}%, ${style.alpha * opacity})`;
      const path = new scope.Path();
      path.add(new scope.Point(sample.x, sample.y));
      path.add(new scope.Point(sample.x + Math.cos(angle) * length, sample.y + Math.sin(angle) * length));
      path.strokeColor = new scope.Color(color);
      path.strokeWidth = style.width;
      path.strokeCap = 'round';
      if (style.arrow) {
        const tip = path.lastSegment.point;
        const head = 4 + style.m * 3;
        const left = new scope.Path();
        left.add(tip);
        left.add(tip.add(new scope.Point(Math.cos(angle + Math.PI * 0.82) * head, Math.sin(angle + Math.PI * 0.82) * head)));
        left.strokeColor = path.strokeColor;
        left.strokeWidth = style.width;
        const right = new scope.Path();
        right.add(tip);
        right.add(tip.add(new scope.Point(Math.cos(angle - Math.PI * 0.82) * head, Math.sin(angle - Math.PI * 0.82) * head)));
        right.strokeColor = path.strokeColor;
        right.strokeWidth = style.width;
      }
    }
  }
  for (const attractor of layer.data.attractors) {
    const ring = new scope.Path.Circle(new scope.Point(attractor.x, attractor.y), attractor.r);
    ring.strokeColor = toColor(scope, attractor.orbit ? '#7c5cff' : '#ff7a45', 0.55 * opacity);
    ring.strokeWidth = 1.2;
    ring.dashArray = [4, 4];
  }
}

function dotFill(layer: DotShadingLayer, radius: number, col: number, row: number): string {
  if (layer.settings.colorMode === 'Density') {
    const t = Math.min(1, radius / Math.max(0.001, layer.settings.maxRadius));
    const l = Math.round(240 - t * 210);
    const b = t > 0.7 ? 14 + t * 10 : l;
    return `rgb(${l},${l},${b})`;
  }
  if (layer.settings.colorMode === 'Group') {
    const group = (col + row) % 3;
    return group === 0 ? '#0e0e14' : group === 1 ? '#7c5cff' : '#ff5c7a';
  }
  return PALETTE[layer.settings.colorIndex % PALETTE.length];
}

function linePath(scope: paper.PaperScope, x1: number, y1: number, x2: number, y2: number, width: number) {
  const path = new scope.Path();
  path.add(new scope.Point(x1, y1));
  path.add(new scope.Point(x2, y2));
  path.strokeWidth = width;
  path.strokeCap = 'round';
  return path;
}

function drawDotShape(scope: paper.PaperScope, shape: DotShadingLayer['settings']['shapeType'], radius: number) {
  if (shape === 'Circle') return new scope.Path.Circle(new scope.Point(0, 0), radius);
  if (shape === 'Diamond') {
    const s = radius * 1.15;
    return new scope.Path({ segments: [[0, -s], [s, 0], [0, s], [-s, 0]], closed: true });
  }
  if (shape === 'Square') {
    const s = radius * 1.1;
    return new scope.Path.Rectangle(new scope.Rectangle(-s, -s, s * 2, s * 2));
  }
  if (shape === 'Triangle') {
    const s = radius * 1.35;
    return new scope.Path({ segments: [[0, -s], [s * 0.866, s * 0.5], [-s * 0.866, s * 0.5]], closed: true });
  }
  if (shape === 'Line') return linePath(scope, -radius * 1.6, 0, radius * 1.6, 0, Math.max(1, radius * 0.42));
  const len = radius * 1.3;
  const thick = Math.max(0.8, radius * 0.34);
  const path = new scope.CompoundPath();
  if (shape === 'Plus') {
    path.addChild(linePath(scope, -len, 0, len, 0, thick));
    path.addChild(linePath(scope, 0, -len, 0, len, thick));
  } else {
    path.addChild(linePath(scope, -len, -len, len, len, thick));
    path.addChild(linePath(scope, -len, len, len, -len, thick));
  }
  path.strokeCap = 'round';
  path.strokeWidth = thick;
  return path;
}

function drawDotLayer(scope: paper.PaperScope, layer: DotShadingLayer, canvas: GridPaintDocument['snapshot']['canvas'], opacity: number) {
  if (layer.settings.showGrid && layer.data.points.length) {
    const spacing = canvas.width / Math.max(1, layer.settings.columns);
    const offsetX = (canvas.width - (layer.settings.columns - 1) * spacing) / 2;
    const offsetY = (canvas.height - (layer.settings.rows - 1) * spacing) / 2;
    for (let col = 0; col < layer.settings.columns; col++) {
      const line = new scope.Path.Line(
        new scope.Point(offsetX + col * spacing, 0),
        new scope.Point(offsetX + col * spacing, canvas.height),
      );
      line.strokeColor = toColor(scope, '#cfc6b4', 0.28 * opacity);
      line.strokeWidth = 1;
    }
    for (let row = 0; row < layer.settings.rows; row++) {
      const line = new scope.Path.Line(
        new scope.Point(0, offsetY + row * spacing),
        new scope.Point(canvas.width, offsetY + row * spacing),
      );
      line.strokeColor = toColor(scope, '#cfc6b4', 0.28 * opacity);
      line.strokeWidth = 1;
    }
  }
  for (const point of layer.data.points) {
    const radius = Math.max(0.15, point.radius);
    const fill = dotFill(layer, point.radius, point.col, point.row);
    const dens = Math.min(1, point.radius / Math.max(0.001, layer.settings.maxRadius));
    const alpha = (layer.settings.colorMode === 'Group' ? 1 : 0.18 + dens * 0.82) * opacity;
    const item = drawDotShape(scope, layer.settings.shapeType, radius);
    item.position = new scope.Point(point.x, point.y);
    if (layer.settings.rotationMode !== 'None') item.rotate((point.rotation * 180) / Math.PI);
    const color = toColor(scope, fill, alpha);
    if (layer.settings.shapeType === 'Line' || layer.settings.shapeType === 'Cross' || layer.settings.shapeType === 'Plus' || layer.settings.fillMode === 'Stroke') {
      item.strokeColor = color;
      if (!item.strokeWidth) item.strokeWidth = Math.max(0.8, radius * 0.35);
    } else {
      item.fillColor = color;
    }
  }
}

function drawLayer(
  scope: paper.PaperScope,
  layer: GridPaintLayer,
  canvas: GridPaintDocument['snapshot']['canvas'],
  inactive: boolean,
  brush: { x: number; y: number; radius: number } | null,
  painting: boolean,
) {
  const dim = inactive ? 0.45 : 1;
  const opacity = (layer.opacity ?? 1) * dim;
  if (layer.mode === 'metaball') {
    drawMetaballLayer(scope, layer, canvas, opacity);
    return;
  }
  if (layer.mode === 'vector-field') {
    drawVectorLayer(scope, layer, opacity, inactive ? null : brush, painting);
    return;
  }
  if (layer.mode === 'dot-shading') {
    drawDotLayer(scope, layer, canvas, opacity);
    return;
  }
  drawCellLayer(scope, layer, canvas, opacity);
}

export function drawDocument(
  scope: paper.PaperScope,
  document: GridPaintDocument,
  brush: { x: number; y: number; radius: number; color: string } | null,
  painting = false,
) {
  scope.project.activeLayer.removeChildren();
  const { canvas, activeLayerId } = document.snapshot;
  const page = new scope.Path.Rectangle(new scope.Rectangle(0, 0, canvas.width, canvas.height));
  page.fillColor = new scope.Color(canvas.background);
  for (const layer of document.visibleLayers) {
    drawLayer(scope, layer, canvas, layer.id !== activeLayerId, brush, painting);
  }
  if (brush) {
    const ring = new scope.Path.Circle(new scope.Point(brush.x, brush.y), brush.radius);
    ring.strokeColor = toColor(scope, brush.color, 0.9);
    ring.strokeWidth = 1.5;
    ring.dashArray = [5, 4];
    ring.fillColor = toColor(scope, brush.color, 0.08);
  }
  scope.view.update();
}
