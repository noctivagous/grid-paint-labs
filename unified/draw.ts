import paper from 'paper';
import { vectorShapePath } from './vectorShapes';
import { vectorGridCells } from './vectorGrid';
import { vectorStyle, satoNeck, type NCTGraphitePoint } from '@nct/nctgraphite';
import type { DotShadingLayer, GridPaintDocument, GridPaintLayer, MetaballLayer, VectorFieldLayer } from './layers';
import { hullOutlines, layerContents, layerLattice, metaballContours, metaballNecks, PALETTE, type BrushMode } from './layers';

function toColor(scope: paper.PaperScope, value: string, alpha = 1): paper.Color {
  const color = new scope.Color(value);
  color.alpha = alpha;
  return color;
}

/** Rebuild only the visible workspace grid as the view moves. */
export function drawWorkspaceGrid(scope: paper.PaperScope) {
  const layer = scope.project.activeLayer;
  layer.children.find(item => item.name === 'workspace-grid')?.remove();
  const page = layer.children.find(item => item.name === 'document-page');
  if (!page) return;
  const bounds = scope.view.bounds;
  const zoom = scope.view.zoom || 1;
  let spacing = 20;
  while (spacing * zoom < 12) spacing *= 2;
  const grid = new scope.Group({ name: 'workspace-grid', insert: false });
  const addLine = (from: paper.Point, to: paper.Point) => {
    const line = new scope.Path.Line({ from, to, insert: false });
    line.strokeColor = new scope.Color(0, 0, 0, 0.14);
    line.strokeWidth = 1 / zoom;
    grid.addChild(line);
  };
  for (let x = Math.ceil(bounds.left / spacing) * spacing; x <= bounds.right; x += spacing) {
    addLine(new scope.Point(x, bounds.top), new scope.Point(x, bounds.bottom));
  }
  for (let y = Math.ceil(bounds.top / spacing) * spacing; y <= bounds.bottom; y += spacing) {
    addLine(new scope.Point(bounds.left, y), new scope.Point(bounds.right, y));
  }
  grid.insertAbove(page);
}

export function drawBrush(scope: paper.PaperScope, brush: { x: number; y: number; radius: number; color: string } | null) {
  scope.project.activeLayer.children.find(item => item.name === 'brush-cursor')?.remove();
  if (brush) {
    const ring = new scope.Path.Circle(new scope.Point(brush.x, brush.y), brush.radius);
    ring.name = 'brush-cursor';
    ring.strokeColor = toColor(scope, brush.color, 0.9);
    ring.strokeWidth = 1.5;
    ring.dashArray = [5, 4];
    ring.fillColor = toColor(scope, brush.color, 0.08);
  }
  scope.view.update();
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

const gridImages = new WeakMap<paper.PaperScope, Map<string, { key: string; splits: unknown; image: HTMLCanvasElement }>>();

function drawCellLayer(scope: paper.PaperScope, layer: Extract<GridPaintLayer, { mode: 'hull' | 'cell-paint' }>, canvas: GridPaintDocument['snapshot']['canvas'], opacity: number) {
  if (!layer.settings.showGrid && !(layer.mode === 'cell-paint' && layer.settings.showCenters) && !Object.keys(layer.data.cells).length) return;
  const lattice = layerLattice(layer, canvas);
  if (layer.settings.showGrid) {
    let cache = gridImages.get(scope);
    if (!cache) { cache = new Map(); gridImages.set(scope, cache); }
    const key = `${canvas.width},${canvas.height},${layer.settings.kind},${layer.settings.size},${opacity}`;
    let entry = cache.get(layer.id);
    if (!entry || entry.key !== key || entry.splits !== layer.data.splits) {
      const image = window.document.createElement('canvas');
      image.width = canvas.width; image.height = canvas.height;
      const context = image.getContext('2d')!;
      context.strokeStyle = `rgba(207, 198, 180, ${0.55 * opacity})`;
      context.lineWidth = 1;
      context.beginPath();
      for (const cell of lattice) {
        context.moveTo(cell.corners[0].x, cell.corners[0].y);
        for (const corner of cell.corners.slice(1)) context.lineTo(corner.x, corner.y);
        context.closePath();
      }
      context.stroke();
      entry = { key, splits: layer.data.splits, image };
      if (cache.size >= 12 && !cache.has(layer.id)) cache.delete(cache.keys().next().value!);
      cache.set(layer.id, entry);
    }
    new scope.Raster({ source: entry.image, position: new scope.Point(canvas.width / 2, canvas.height / 2) });
  }
  for (const cell of lattice) {
    const painted = layer.data.cells[cell.id];
    if (!painted) continue;
    const scale = layer.data.scales?.[cell.id] ?? 1;
    const path = polygon(scope, cell.corners.map(p => ({ x: cell.center.x + (p.x - cell.center.x) * scale, y: cell.center.y + (p.y - cell.center.y) * scale })));
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
  if (layer.mode === 'hull' || (layer.mode === 'cell-paint' && layer.settings.hullMode && layer.settings.hullMode !== 'off')) {
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
    const holes = layer.data.blobs.filter(blob => blob.type === 'negative');
    const masks: paper.PathItem[] = holes.map(blob => new scope.Path.Circle(new scope.Point(blob.x, blob.y), blob.r));
    for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i], b = holes[j];
      const neck = satoNeck(a.r, b.r, a, b, layer.settings.handleSize, layer.settings.goo, layer.settings.kFactor);
      if (neck) masks.push(new scope.CompoundPath({ pathData: neck.path }));
    }
    const subtractHoles = (initial: paper.PathItem) => {
      let item = initial;
      for (const mask of masks) {
        if (!item.bounds.intersects(mask.bounds)) continue;
        const result = item.subtract(mask);
        item.remove(); item = result;
      }
      return item;
    };
    for (const blob of layer.data.blobs) {
      if (blob.type === 'negative') continue;
      const circle = subtractHoles(new scope.Path.Circle(new scope.Point(blob.x, blob.y), blob.r));
      circle.fillColor = toColor(scope, blob.color, 0.82 * opacity);
      circle.strokeColor = toColor(scope, blob.color, opacity);
      circle.strokeWidth = 1.4;
    }
    for (const neck of metaballNecks(layer)) {
      const path = subtractHoles(new scope.CompoundPath({ pathData: neck.path }));
      path.fillColor = toColor(scope, neck.color, 0.88 * opacity);
      path.fillRule = 'evenodd';
    }
    for (const mask of masks) mask.remove();
    return;
  }
  for (const contour of metaballContours(layer, canvas)) {
    pathFromD(scope, contour.pathD, contour.color, 0.88 * opacity);
  }
}

function drawVectorLayer(scope: paper.PaperScope, layer: VectorFieldLayer, canvas: GridPaintDocument['snapshot']['canvas'], opacity: number, brush: { x: number; y: number; radius: number } | null, painting: boolean, artworkOnly = false) {
  const kind = layer.settings.gridKind ?? 'square';
  if (layer.settings.showGrid && !artworkOnly) {
    if (kind === 'square') {
      const cw = canvas.width / layer.settings.columns, ch = canvas.height / layer.settings.rows;
      for (const sample of layer.data.vectors) {
        const path = new scope.Path.Rectangle(new scope.Rectangle(sample.x - cw / 2, sample.y - ch / 2, cw, ch));
        path.strokeColor = toColor(scope, '#1a1a24', 0.18 * opacity); path.strokeWidth = 0.6;
      }
    } else {
      const cells = vectorGridCells(kind, layer.settings.columns, layer.settings.rows, canvas);
      const dx = (layer.data.vectors[0]?.x ?? cells[0]?.center.x ?? 0) - (cells[0]?.center.x ?? 0);
      const dy = (layer.data.vectors[0]?.y ?? cells[0]?.center.y ?? 0) - (cells[0]?.center.y ?? 0);
      for (const cell of cells) {
        const path = polygon(scope, cell.corners.map(p => ({ x: p.x + dx, y: p.y + dy })));
        path.strokeColor = toColor(scope, '#1a1a24', 0.18 * opacity); path.strokeWidth = 0.6;
      }
    }
  }
  const shape = vectorShapePath(layer, canvas.width, canvas.height);
  if (shape) pathFromD(scope, shape, PALETTE[layer.settings.colorIndex % PALETTE.length], opacity);
  const minCell = Math.min(canvas.width / layer.settings.columns, canvas.height / layer.settings.rows);
  for (const sample of artworkOnly ? [] : layer.data.vectors) {
    const idle = new scope.Path.Circle(new scope.Point(sample.x, sample.y), 0.8);
    idle.fillColor = toColor(scope, '#1a1a24', 0.12 * opacity);
  }
  if (layer.settings.showVectors) {
    for (const sample of layer.data.vectors) {
      const inBrush = !!brush && Math.hypot(sample.x - brush.x, sample.y - brush.y) < brush.radius;
      const style = vectorStyle(sample.vx, sample.vy, layer.settings.hoverThin && inBrush && !painting, {
        weight: layer.settings.weight ?? 2.2,
        minWidth: layer.settings.minWidth ?? 1,
      });
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
  artworkOnly = false,
) {
  const dim = inactive ? 0.45 : 1;
  const opacity = (layer.opacity ?? 1) * dim;
  if (layer.mode === 'metaball') {
    drawMetaballLayer(scope, layer, canvas, opacity);
    return;
  }
  if (layer.mode === 'vector-field') {
    drawVectorLayer(scope, layer, canvas, opacity, inactive ? null : brush, painting, artworkOnly);
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
  artworkOnly = false,
  activeMode?: BrushMode,
) {
  scope.project.activeLayer.removeChildren();
  const { canvas, activeLayerId } = document.snapshot;
  const page = new scope.Path.Rectangle(new scope.Rectangle(0, 0, canvas.width, canvas.height));
  page.name = 'document-page';
  page.fillColor = new scope.Color(canvas.background);
  if (!artworkOnly) drawWorkspaceGrid(scope);
  for (const parent of document.visibleLayers) for (const content of layerContents(parent)) {
    const layer = { ...content, visible: parent.visible, opacity: parent.opacity } as GridPaintLayer;
    let rendered = layer;
    if (artworkOnly) {
      if (layer.mode === 'vector-field') rendered = { ...layer, settings: { ...layer.settings, showVectors: layer.settings.shapeMode && layer.settings.shapeMode !== 'off' ? false : layer.settings.showVectors }, data: { ...layer.data, attractors: [] } };
      else rendered = { ...layer, settings: { ...layer.settings, showGrid: false, showCenters: false } } as GridPaintLayer;
    }
    const inactive = parent.id !== activeLayerId;
    drawLayer(scope, rendered, canvas, artworkOnly ? false : inactive, artworkOnly || inactive || (activeMode && layer.mode !== activeMode) ? null : brush, painting, artworkOnly);
  }
  if (!artworkOnly) drawBrush(scope, brush);
  scope.view.update();
}
