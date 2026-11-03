import {
  NCTGraphiteDocument,
  contourLayersForBlobs,
  createNCTGraphiteLayerId,
  gridCell,
  gridCellsInBounds,
  hullLoopsFromPolygons,
  makeSampleLattice,
  makeVectorField,
  roundRectStamp,
  satoNeck,
  stampSampleGain,
  stampVectorField,
  type FieldBlob,
  type HullLoop,
  type HullMode,
  type NCTGraphiteCommandDef,
  type NCTGraphiteDocumentCanvas,
  type NCTGraphiteGridCell,
  type NCTGraphiteGridKind,
  type NCTGraphiteGridSpec,
  type NCTGraphiteLayerRecord,
  type NCTGraphitePoint,
  type NCTParameterDefinition,
  type SampleGainPoint,
  type SampleRotationMode,
  type ShadingFalloff,
  type VectorAttractor,
  type VectorFieldMode,
  type VectorSample,
} from '@nct/nctgraphite';

export { convexHull } from '@nct/nctgraphite';
export type { HullLoop, HullMode };

export const PALETTE = ['#7c5cff', '#00e5ff', '#ff7a45', '#ffe14a', '#38f28a', '#ff4d6d', '#b18aff', '#4af0ff'];

export type CellPaintSettings = {
  kind: NCTGraphiteGridKind;
  size: number;
  columns: number;
  rows: number;
  brushRadius: number;
  falloff: number;
  showGrid: boolean;
  showCenters: boolean;
  colorIndex: number;
};

export type HullSettings = {
  kind: NCTGraphiteGridKind;
  size: number;
  brushRadius: number;
  showGrid: boolean;
  hullMode: HullMode;
  colorIndex: number;
};

export type PaintedCells = Record<string, { color: string }>;

export type CellPaintLayer = NCTGraphiteLayerRecord & {
  mode: 'cell-paint';
  data: { cells: PaintedCells };
  settings: CellPaintSettings;
};

export type HullLayer = NCTGraphiteLayerRecord & {
  mode: 'hull';
  data: { cells: PaintedCells };
  settings: HullSettings;
};

export type MetaballBlob = FieldBlob & { id: string; color: string };

export type MetaballSettings = {
  gridResolution: number;
  goo: number;
  kFactor: number;
  handleSize: number;
  brushRadius: number;
  engine: 'contour' | 'arc';
  stampShape: 'circle' | 'roundrect';
  colorIndex: number;
  showGrid: boolean;
  smoothBezier: boolean;
};

export type MetaballLayer = NCTGraphiteLayerRecord & {
  mode: 'metaball';
  data: { blobs: MetaballBlob[] };
  settings: MetaballSettings;
};

export type VectorFieldSettings = {
  columns: number;
  rows: number;
  mode: VectorFieldMode;
  strength: number;
  brushRadius: number;
  showVectors: boolean;
  hoverThin: boolean;
  colorIndex: number;
};

export type VectorFieldLayer = NCTGraphiteLayerRecord & {
  mode: 'vector-field';
  data: { vectors: VectorSample[]; attractors: (VectorAttractor & { id: string })[] };
  settings: VectorFieldSettings;
};

export type DotShape = 'Circle' | 'Diamond' | 'Square' | 'Triangle' | 'Line' | 'Cross' | 'Plus';
export type DotColorMode = 'Mono' | 'Density' | 'Group';
export type DotFillMode = 'Fill' | 'Stroke';

export const DOT_SHAPES: DotShape[] = ['Circle', 'Diamond', 'Square', 'Triangle', 'Line', 'Cross', 'Plus'];

export type DotShadingSettings = {
  columns: number;
  rows: number;
  jitterAmount: number;
  useJitter: boolean;
  seed: number;
  maxRadius: number;
  minRadius: number;
  shapeType: DotShape;
  colorMode: DotColorMode;
  fillMode: DotFillMode;
  rotationMode: SampleRotationMode;
  rotationJitter: number;
  brushRadius: number;
  intensity: number;
  falloffPower: number;
  falloffType: ShadingFalloff;
  showGrid: boolean;
  colorIndex: number;
};

export type DotShadingLayer = NCTGraphiteLayerRecord & {
  mode: 'dot-shading';
  data: { points: SampleGainPoint[] };
  settings: DotShadingSettings;
};

export type CellMeshLayer = CellPaintLayer | HullLayer;
export type GridPaintLayer = CellPaintLayer | HullLayer | MetaballLayer | VectorFieldLayer | DotShadingLayer;
export type GridPaintDocument = NCTGraphiteDocument<GridPaintLayer>;
export type PaintAction = 'paint' | 'erase' | 'toggle' | 'inflate' | 'smooth' | 'placeNeg' | 'attractor' | 'clear';

export const CELL_PAINT_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: 'paint', label: 'Paint', desc: 'Activate primary color', defaultKey: 'f' },
  { id: 'erase', label: 'Erase', desc: 'Deactivate cells', defaultKey: 'e' },
  { id: 'toggle', label: 'Toggle', desc: 'Flip cells under the brush', defaultKey: 'q' },
  { id: 'clear', label: 'Clear', desc: 'Clear this layer', defaultKey: 'x' },
  { id: 'newColor', label: 'New color', desc: 'Cycle palette', defaultKey: 'c' },
  { id: 'brushSmaller', label: 'Brush −', desc: 'Decrease radius', defaultKey: '[' },
  { id: 'brushLarger', label: 'Brush +', desc: 'Increase radius', defaultKey: ']' },
  { id: 'gridFlat', label: 'Hex flat', desc: 'Flat-top hex grid', defaultKey: '1' },
  { id: 'gridPointy', label: 'Hex pointy', desc: 'Pointy-top hex grid', defaultKey: '2' },
  { id: 'gridSquare', label: 'Square', desc: 'Square grid', defaultKey: '3' },
  { id: 'showGrid', label: 'Grid', desc: 'Toggle cell outlines', defaultKey: 'm' },
];

export const HULL_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: 'paint', label: 'Activate', desc: 'Paint cells under the brush', defaultKey: 'f' },
  { id: 'erase', label: 'Erase', desc: 'Remove cells under the brush', defaultKey: 'e' },
  { id: 'clear', label: 'Clear', desc: 'Clear this layer', defaultKey: 'x' },
  { id: 'newColor', label: 'New color', desc: 'Cycle palette', defaultKey: 'c' },
  { id: 'brushSmaller', label: 'Brush −', desc: 'Decrease radius', defaultKey: '[' },
  { id: 'brushLarger', label: 'Brush +', desc: 'Increase radius', defaultKey: ']' },
  { id: 'gridSquare', label: 'Square', desc: 'Square grid', defaultKey: '1' },
  { id: 'gridFlat', label: 'Hex horiz', desc: 'Flat-top hex grid', defaultKey: '2' },
  { id: 'gridDiamond', label: 'Hex diamond', desc: 'Flat hex split into three rhombs', defaultKey: '0' },
  { id: 'gridPointy', label: 'Hex vert', desc: 'Pointy-top hex grid', defaultKey: '3' },
  { id: 'gridTriHoriz', label: 'Tri horiz', desc: 'Horizontal triangles', defaultKey: '4' },
  { id: 'gridTriVert', label: 'Tri vert', desc: 'Vertical triangles', defaultKey: '5' },
  { id: 'hullTight', label: 'Tight', desc: 'Cluster perimeter', defaultKey: '6' },
  { id: 'hullSmooth', label: 'Smooth', desc: 'Smoothed perimeter', defaultKey: '7' },
  { id: 'hullConvex', label: 'Convex', desc: 'Convex hull of painted cells', defaultKey: '8' },
  { id: 'hullConcave', label: 'Concave', desc: 'Same tracing as tight', defaultKey: '9' },
  { id: 'showGrid', label: 'Grid', desc: 'Toggle cell outlines', defaultKey: 'm' },
];

export const METABALL_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: 'paint', label: 'Place', desc: 'Stamp a blob', defaultKey: 'f' },
  { id: 'inflate', label: 'Inflate', desc: 'Grow blobs under the brush', defaultKey: 'g' },
  { id: 'placeNeg', label: 'Hole', desc: 'Stamp a negative hole', defaultKey: 'h' },
  { id: 'erase', label: 'Erase', desc: 'Remove blobs under the brush', defaultKey: 'e' },
  { id: 'newColor', label: 'New color', desc: 'Cycle color group', defaultKey: 'n' },
  { id: 'clear', label: 'Clear', desc: 'Clear this layer', defaultKey: 'x' },
  { id: 'brushSmaller', label: 'Brush −', desc: 'Decrease radius', defaultKey: '[' },
  { id: 'brushLarger', label: 'Brush +', desc: 'Increase radius', defaultKey: ']' },
];

export const VECTOR_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: 'paint', label: 'Paint', desc: 'Stamp flow in the brush', defaultKey: 'f' },
  { id: 'erase', label: 'Erase', desc: 'Zero vectors in the brush', defaultKey: 'e' },
  { id: 'smooth', label: 'Smooth', desc: 'Average neighbors in the brush', defaultKey: 'q' },
  { id: 'attractor', label: 'Attractor', desc: 'Drop attractor at the brush', defaultKey: 'n' },
  { id: 'clear', label: 'Clear', desc: 'Zero the field', defaultKey: 'x' },
  { id: 'brushSmaller', label: 'Brush −', desc: 'Decrease radius', defaultKey: '[' },
  { id: 'brushLarger', label: 'Brush +', desc: 'Increase radius', defaultKey: ']' },
];

export const DOT_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: 'paint', label: 'Grow', desc: 'Increase dot gain in the brush', defaultKey: 'f' },
  { id: 'erase', label: 'Shrink', desc: 'Decrease dot gain in the brush', defaultKey: 'e' },
  { id: 'smooth', label: 'Smooth', desc: 'Average neighbors in the brush', defaultKey: 'q' },
  { id: 'clear', label: 'Clear', desc: 'Reset gain in the brush', defaultKey: 'x' },
  { id: 'newColor', label: 'Shape', desc: 'Cycle stamp shape', defaultKey: 'c' },
  { id: 'reJitter', label: 'Re-jitter', desc: 'Scatter sample positions again', defaultKey: 'r' },
  { id: 'brushSmaller', label: 'Brush −', desc: 'Decrease radius', defaultKey: '[' },
  { id: 'brushLarger', label: 'Brush +', desc: 'Increase radius', defaultKey: ']' },
];

const GRID_OPTIONS = [
  { value: 'hex-flat', label: 'Hex flat' },
  { value: 'hex-pointy', label: 'Hex pointy' },
  { value: 'square', label: 'Square' },
];

export const CELL_PAINT_PARAMETERS: NCTParameterDefinition[] = [
  { id: 'kind', label: 'Grid', type: 'select', defaultValue: 'hex-flat', options: GRID_OPTIONS },
  { id: 'size', label: 'Cell size', type: 'number', min: 12, max: 48, step: 1, defaultValue: 28 },
  { id: 'columns', label: 'Columns', type: 'number', min: 5, max: 40, step: 1, defaultValue: 22 },
  { id: 'rows', label: 'Rows', type: 'number', min: 5, max: 40, step: 1, defaultValue: 16 },
  { id: 'brushRadius', label: 'Brush', type: 'number', min: 16, max: 160, step: 4, defaultValue: 56 },
  { id: 'falloff', label: 'Falloff', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0 },
  { id: 'showGrid', label: 'Show grid', type: 'boolean', defaultValue: true },
  { id: 'showCenters', label: 'Centers', type: 'boolean', defaultValue: false },
];

const HULL_GRID_OPTIONS = [
  { value: 'square', label: 'Square' },
  { value: 'hex-flat', label: 'Hex horiz' },
  { value: 'hex-flat-diamond', label: 'Hex diamond' },
  { value: 'hex-pointy', label: 'Hex vert' },
  { value: 'tri-horiz', label: 'Tri horiz' },
  { value: 'tri-vert', label: 'Tri vert' },
];

export const HULL_PARAMETERS: NCTParameterDefinition[] = [
  { id: 'kind', label: 'Grid', type: 'select', defaultValue: 'hex-flat', options: HULL_GRID_OPTIONS },
  { id: 'size', label: 'Cell size', type: 'number', min: 8, max: 40, step: 1, defaultValue: 14 },
  { id: 'brushRadius', label: 'Brush', type: 'number', min: 16, max: 160, step: 4, defaultValue: 64 },
  { id: 'showGrid', label: 'Show grid', type: 'boolean', defaultValue: false },
  { id: 'hullMode', label: 'Hull', type: 'select', defaultValue: 'convex', options: [
    { value: 'tight', label: 'Tight' },
    { value: 'smooth', label: 'Smooth' },
    { value: 'convex', label: 'Convex' },
    { value: 'concave', label: 'Concave' },
  ] },
];

export const METABALL_PARAMETERS: NCTParameterDefinition[] = [
  { id: 'engine', label: 'Engine', type: 'select', defaultValue: 'contour', options: [
    { value: 'contour', label: 'Field' },
    { value: 'arc', label: 'Arc' },
  ] },
  { id: 'stampShape', label: 'Stamp', type: 'select', defaultValue: 'circle', options: [
    { value: 'circle', label: 'Circle' },
    { value: 'roundrect', label: 'Round rect' },
  ] },
  { id: 'gridResolution', label: 'Field grid', type: 'number', min: 16, max: 96, step: 4, defaultValue: 48 },
  { id: 'goo', label: 'Goo', type: 'number', min: 0.2, max: 1.2, step: 0.05, defaultValue: 0.8 },
  { id: 'kFactor', label: 'Bridge K', type: 'number', min: 1, max: 4, step: 0.1, defaultValue: 2.5 },
  { id: 'handleSize', label: 'Handles', type: 'number', min: 0.5, max: 4, step: 0.1, defaultValue: 2.4 },
  { id: 'brushRadius', label: 'Brush', type: 'number', min: 16, max: 160, step: 4, defaultValue: 48 },
  { id: 'smoothBezier', label: 'Bezier contours', type: 'boolean', defaultValue: false },
  { id: 'showGrid', label: 'Show samples', type: 'boolean', defaultValue: false },
];

export const VECTOR_PARAMETERS: NCTParameterDefinition[] = [
  { id: 'mode', label: 'Mode', type: 'select', defaultValue: 'velocity', options: [
    { value: 'seek', label: 'Seek' },
    { value: 'velocity', label: 'Velocity' },
    { value: 'swirl', label: 'Swirl' },
  ] },
  { id: 'columns', label: 'Columns', type: 'number', min: 8, max: 80, step: 1, defaultValue: 48 },
  { id: 'rows', label: 'Rows', type: 'number', min: 8, max: 60, step: 1, defaultValue: 32 },
  { id: 'strength', label: 'Strength', type: 'number', min: 0.2, max: 3, step: 0.1, defaultValue: 1 },
  { id: 'brushRadius', label: 'Brush', type: 'number', min: 16, max: 240, step: 4, defaultValue: 90 },
  { id: 'showVectors', label: 'Show vectors', type: 'boolean', defaultValue: true },
  { id: 'hoverThin', label: 'Hover thin', type: 'boolean', defaultValue: true },
];

export const DOT_PARAMETERS: NCTParameterDefinition[] = [
  { id: 'columns', label: 'Columns', type: 'number', min: 8, max: 80, step: 1, defaultValue: 48 },
  { id: 'rows', label: 'Rows', type: 'number', min: 8, max: 60, step: 1, defaultValue: 32 },
  { id: 'jitterAmount', label: 'Jitter', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.65 },
  { id: 'useJitter', label: 'Use jitter', type: 'boolean', defaultValue: true },
  { id: 'shapeType', label: 'Shape', type: 'select', defaultValue: 'Circle', options: DOT_SHAPES.map((value) => ({ value, label: value })) },
  { id: 'colorMode', label: 'Color', type: 'select', defaultValue: 'Mono', options: [
    { value: 'Mono', label: 'Mono' },
    { value: 'Density', label: 'Density' },
    { value: 'Group', label: 'Group' },
  ] },
  { id: 'fillMode', label: 'Fill', type: 'select', defaultValue: 'Fill', options: [
    { value: 'Fill', label: 'Fill' },
    { value: 'Stroke', label: 'Stroke' },
  ] },
  { id: 'rotationMode', label: 'Rotation', type: 'select', defaultValue: 'Brush Direction', options: [
    { value: 'None', label: 'None' },
    { value: 'Random', label: 'Random' },
    { value: 'Brush Direction', label: 'Brush dir' },
    { value: 'Radial', label: 'Radial' },
    { value: 'Brush + Random', label: 'Brush + rand' },
    { value: 'Spiral', label: 'Spiral' },
  ] },
  { id: 'maxRadius', label: 'Max radius', type: 'number', min: 2, max: 28, step: 0.5, defaultValue: 14 },
  { id: 'minRadius', label: 'Min radius', type: 'number', min: 0.1, max: 4, step: 0.1, defaultValue: 0.2 },
  { id: 'intensity', label: 'Intensity', type: 'number', min: 0.1, max: 3, step: 0.1, defaultValue: 1.2 },
  { id: 'falloffType', label: 'Falloff', type: 'select', defaultValue: 'Linear', options: [
    { value: 'Linear', label: 'Linear' },
    { value: 'Smoothstep', label: 'Smoothstep' },
    { value: 'Gaussian', label: 'Gaussian' },
    { value: 'Sharp', label: 'Sharp' },
  ] },
  { id: 'falloffPower', label: 'Falloff power', type: 'number', min: 0.3, max: 3, step: 0.1, defaultValue: 1 },
  { id: 'brushRadius', label: 'Brush', type: 'number', min: 16, max: 240, step: 4, defaultValue: 110 },
  { id: 'showGrid', label: 'Show grid', type: 'boolean', defaultValue: false },
];

export function defaultCanvas(): NCTGraphiteDocumentCanvas {
  return { width: 960, height: 720, background: '#fdfaf3' };
}

export function createHullLayer(partial: Partial<HullLayer> = {}): HullLayer {
  return {
    id: createNCTGraphiteLayerId(),
    name: 'Hull',
    visible: true,
    mode: 'hull',
    data: { cells: {} },
    settings: { kind: 'hex-flat', size: 14, brushRadius: 64, showGrid: false, hullMode: 'convex', colorIndex: 0 },
    ...partial,
    mode: 'hull',
    data: partial.data ?? { cells: {} },
    settings: { kind: 'hex-flat', size: 14, brushRadius: 64, showGrid: false, hullMode: 'convex', colorIndex: 0, ...partial.settings },
  };
}

export function createCellPaintLayer(partial: Partial<CellPaintLayer> = {}): CellPaintLayer {
  return {
    id: createNCTGraphiteLayerId(),
    name: 'Hex Paint',
    visible: true,
    mode: 'cell-paint',
    data: { cells: {} },
    settings: {
      kind: 'hex-flat', size: 28, columns: 22, rows: 16, brushRadius: 56,
      falloff: 0, showGrid: true, showCenters: false, colorIndex: 0,
      ...partial.settings,
    },
    ...partial,
    mode: 'cell-paint',
    data: partial.data ?? { cells: {} },
    settings: {
      kind: 'hex-flat', size: 28, columns: 22, rows: 16, brushRadius: 56,
      falloff: 0, showGrid: true, showCenters: false, colorIndex: 0,
      ...partial.settings,
    },
  };
}

export function createMetaballLayer(partial: Partial<MetaballLayer> = {}): MetaballLayer {
  return {
    id: createNCTGraphiteLayerId(),
    name: 'Metaballs',
    visible: true,
    mode: 'metaball',
    data: { blobs: [] },
    settings: {
      gridResolution: 48, goo: 0.8, kFactor: 2.5, handleSize: 2.4, brushRadius: 48,
      engine: 'contour', stampShape: 'circle', colorIndex: 0, showGrid: false, smoothBezier: false,
      ...partial.settings,
    },
    ...partial,
    mode: 'metaball',
    data: partial.data ?? { blobs: [] },
    settings: {
      gridResolution: 48, goo: 0.8, kFactor: 2.5, handleSize: 2.4, brushRadius: 48,
      engine: 'contour', stampShape: 'circle', colorIndex: 0, showGrid: false, smoothBezier: false,
      ...partial.settings,
    },
  };
}

export function createVectorFieldLayer(canvas: NCTGraphiteDocumentCanvas, partial: Partial<VectorFieldLayer> = {}): VectorFieldLayer {
  const settings = {
    columns: 48, rows: 32, mode: 'velocity' as VectorFieldMode, strength: 1, brushRadius: 90,
    showVectors: true, hoverThin: true, colorIndex: 0,
    ...partial.settings,
  };
  return {
    id: createNCTGraphiteLayerId(),
    name: 'Vector Field',
    visible: true,
    mode: 'vector-field',
    ...partial,
    mode: 'vector-field',
    settings,
    data: partial.data ?? { vectors: makeVectorField(settings.columns, settings.rows, canvas.width, canvas.height), attractors: [] },
  };
}

export function createDotShadingLayer(canvas: NCTGraphiteDocumentCanvas, partial: Partial<DotShadingLayer> = {}): DotShadingLayer {
  const settings: DotShadingSettings = {
    columns: 48, rows: 32, jitterAmount: 0.65, useJitter: true, seed: 1,
    maxRadius: 14, minRadius: 0.2, shapeType: 'Circle', colorMode: 'Mono', fillMode: 'Fill',
    rotationMode: 'Brush Direction', rotationJitter: 22, brushRadius: 110, intensity: 1.2,
    falloffPower: 1, falloffType: 'Linear', showGrid: false, colorIndex: 0,
    ...partial.settings,
  };
  return {
    id: createNCTGraphiteLayerId(),
    name: 'Dot Shading',
    visible: true,
    mode: 'dot-shading',
    ...partial,
    mode: 'dot-shading',
    settings,
    data: partial.data ?? {
      points: makeSampleLattice(settings.columns, settings.rows, canvas.width, canvas.height, {
        jitter: settings.useJitter ? settings.jitterAmount : 0,
        seed: settings.seed,
        radius: 1,
      }),
    },
  };
}

export function createInitialDocument(): GridPaintDocument {
  const canvas = defaultCanvas();
  const hull = createHullLayer();
  const paint = createCellPaintLayer();
  const dots = createDotShadingLayer(canvas);
  const metaball = createMetaballLayer();
  const vector = createVectorFieldLayer(canvas);
  return NCTGraphiteDocument.untitled({
    displayName: 'Grid Paint',
    canvas,
    layers: [hull, paint, dots, metaball, vector],
    activeLayerId: paint.id,
  });
}

export function layerGridSpec(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas): NCTGraphiteGridSpec {
  return { kind: layer.settings.kind, size: layer.settings.size, origin: { x: canvas.width / 2, y: canvas.height / 2 } };
}

export function layerLattice(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas): NCTGraphiteGridCell[] {
  const spec = layerGridSpec(layer, canvas);
  if (layer.mode === 'hull') {
    return gridCellsInBounds(spec, { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height });
  }
  const qRange = Math.floor(layer.settings.columns / 2);
  const rRange = Math.floor(layer.settings.rows / 2);
  const cells: NCTGraphiteGridCell[] = [];
  const margin = spec.size * 2;
  for (let q = -qRange; q <= qRange; q++) {
    for (let r = -rRange; r <= rRange; r++) {
      const cell = gridCell(spec, { q, r });
      if (cell.center.x < -margin || cell.center.x > canvas.width + margin || cell.center.y < -margin || cell.center.y > canvas.height + margin) continue;
      cells.push(cell);
    }
  }
  return cells;
}

export function cellsUnderBrush(
  cells: readonly NCTGraphiteGridCell[],
  point: NCTGraphitePoint,
  radius: number,
  size: number,
  falloff = 0,
): NCTGraphiteGridCell[] {
  const threshold = radius + size * 0.55;
  const hits: NCTGraphiteGridCell[] = [];
  for (const cell of cells) {
    const dist = Math.hypot(cell.center.x - point.x, cell.center.y - point.y);
    if (dist > threshold) continue;
    if (falloff > 0 && 1 - (dist / threshold) * falloff < 0.15) continue;
    hits.push(cell);
  }
  return hits;
}

function paintCellMeshAt(
  layer: CellMeshLayer,
  canvas: NCTGraphiteDocumentCanvas,
  point: NCTGraphitePoint,
  action: PaintAction,
): CellMeshLayer {
  const lattice = layerLattice(layer, canvas);
  const falloff = layer.mode === 'cell-paint' ? layer.settings.falloff : 0;
  const hits = cellsUnderBrush(lattice, point, layer.settings.brushRadius, layer.settings.size, falloff);
  if (hits.length === 0) return layer;
  const color = PALETTE[layer.settings.colorIndex % PALETTE.length];
  const cells = { ...layer.data.cells };
  let changed = false;
  for (const cell of hits) {
    const id = cell.id;
    if (action === 'erase') {
      if (cells[id]) { delete cells[id]; changed = true; }
    } else if (action === 'toggle') {
      if (cells[id]) delete cells[id];
      else cells[id] = { color };
      changed = true;
    } else if (!cells[id] || cells[id].color !== color) {
      cells[id] = { color };
      changed = true;
    }
  }
  return changed ? { ...layer, data: { cells } } : layer;
}

function metaballStampCenters(layer: MetaballLayer, point: NCTGraphitePoint): { x: number; y: number; r: number }[] {
  const radius = Math.max(10, layer.settings.brushRadius * 0.42);
  if (layer.settings.stampShape === 'roundrect') return roundRectStamp(point.x, point.y, radius).centers;
  return [{ x: point.x, y: point.y, r: radius }];
}

function paintMetaballAt(layer: MetaballLayer, point: NCTGraphitePoint, action: PaintAction): MetaballLayer {
  const radius = layer.settings.brushRadius;
  if (action === 'erase') {
    const blobs = layer.data.blobs.filter((blob) => Math.hypot(blob.x - point.x, blob.y - point.y) > radius + blob.r * 0.35);
    return blobs.length === layer.data.blobs.length ? layer : { ...layer, data: { blobs } };
  }
  if (action === 'inflate') {
    let changed = false;
    const blobs = layer.data.blobs.map((blob) => {
      if (Math.hypot(blob.x - point.x, blob.y - point.y) > radius) return blob;
      changed = true;
      return { ...blob, r: Math.min(180, blob.r + 1.6) };
    });
    return changed ? { ...layer, data: { blobs } } : layer;
  }
  const type = action === 'placeNeg' ? 'negative' : 'positive';
  const color = PALETTE[layer.settings.colorIndex % PALETTE.length];
  const added: MetaballBlob[] = metaballStampCenters(layer, point).map((center) => ({
    id: createNCTGraphiteLayerId(),
    x: center.x,
    y: center.y,
    r: center.r,
    type,
    colorGroup: layer.settings.colorIndex,
    color,
  }));
  return { ...layer, data: { blobs: [...layer.data.blobs, ...added] } };
}

function paintVectorAt(
  layer: VectorFieldLayer,
  point: NCTGraphitePoint,
  action: PaintAction,
  extra?: { velocityX?: number; velocityY?: number },
): VectorFieldLayer {
  if (action === 'attractor') {
    const attractor = { id: createNCTGraphiteLayerId(), x: point.x, y: point.y, r: layer.settings.brushRadius, orbit: layer.settings.mode === 'swirl' };
    return { ...layer, data: { ...layer.data, attractors: [...layer.data.attractors, attractor] } };
  }
  const stampAction = action === 'smooth' ? 'smooth' : action === 'erase' ? 'erase' : 'paint';
  const vectors = stampVectorField(layer.data.vectors, {
    columns: layer.settings.columns,
    rows: layer.settings.rows,
    x: point.x,
    y: point.y,
    radius: layer.settings.brushRadius,
    action: stampAction,
    mode: layer.settings.mode,
    strength: layer.settings.strength,
    velocityX: extra?.velocityX,
    velocityY: extra?.velocityY,
  });
  return { ...layer, data: { ...layer.data, vectors } };
}

function paintDotAt(
  layer: DotShadingLayer,
  canvas: NCTGraphiteDocumentCanvas,
  point: NCTGraphitePoint,
  action: PaintAction,
  extra?: { brushAngle?: number },
): DotShadingLayer {
  const stampAction = action === 'erase' ? 'shrink' : action === 'smooth' ? 'smooth' : action === 'clear' ? 'clear' : 'grow';
  return {
    ...layer,
    data: {
      points: stampSampleGain(layer.data.points, {
        columns: layer.settings.columns,
        rows: layer.settings.rows,
        width: canvas.width,
        height: canvas.height,
        x: point.x,
        y: point.y,
        radius: layer.settings.brushRadius,
        action: stampAction,
        intensity: layer.settings.intensity,
        falloffType: layer.settings.falloffType,
        falloffPower: layer.settings.falloffPower,
        minRadius: layer.settings.minRadius,
        maxRadius: layer.settings.maxRadius,
        rotationMode: layer.settings.rotationMode,
        rotationJitter: layer.settings.rotationJitter,
        brushAngle: extra?.brushAngle,
      }),
    },
  };
}

export function paintLayerAt(
  layer: GridPaintLayer,
  canvas: NCTGraphiteDocumentCanvas,
  point: NCTGraphitePoint,
  action: PaintAction,
  extra?: { velocityX?: number; velocityY?: number; brushAngle?: number },
): GridPaintLayer {
  if (layer.locked || !layer.visible) return layer;
  if (layer.mode === 'metaball') return paintMetaballAt(layer, point, action);
  if (layer.mode === 'vector-field') return paintVectorAt(layer, point, action, extra);
  if (layer.mode === 'dot-shading') {
    if (action === 'inflate' || action === 'placeNeg' || action === 'attractor' || action === 'toggle') return layer;
    return paintDotAt(layer, canvas, point, action, extra);
  }
  if (action === 'inflate' || action === 'smooth' || action === 'placeNeg' || action === 'attractor' || action === 'clear') return layer;
  return paintCellMeshAt(layer, canvas, point, action);
}

export function clearLayerPaint(layer: GridPaintLayer): GridPaintLayer {
  if (layer.mode === 'metaball') {
    if (layer.data.blobs.length === 0) return layer;
    return { ...layer, data: { blobs: [] } };
  }
  if (layer.mode === 'vector-field') {
    const empty = layer.data.vectors.every((sample) => sample.vx === 0 && sample.vy === 0) && layer.data.attractors.length === 0;
    if (empty) return layer;
    return {
      ...layer,
      data: {
        vectors: layer.data.vectors.map((sample) => ({ ...sample, vx: 0, vy: 0 })),
        attractors: [],
      },
    };
  }
  if (layer.mode === 'dot-shading') {
    if (layer.data.points.every((point) => point.radius === 1)) return layer;
    return { ...layer, data: { points: layer.data.points.map((point) => ({ ...point, radius: 1 })) } };
  }
  if (Object.keys(layer.data.cells).length === 0) return layer;
  return { ...layer, data: { cells: {} } };
}

export function cycleLayerColor(layer: GridPaintLayer): GridPaintLayer {
  if (layer.mode === 'dot-shading') {
    const index = DOT_SHAPES.indexOf(layer.settings.shapeType);
    return { ...layer, settings: { ...layer.settings, shapeType: DOT_SHAPES[(index + 1) % DOT_SHAPES.length] } };
  }
  return { ...layer, settings: { ...layer.settings, colorIndex: (layer.settings.colorIndex + 1) % PALETTE.length } };
}

export function adjustBrush(layer: GridPaintLayer, delta: number): GridPaintLayer {
  const max = layer.mode === 'vector-field' || layer.mode === 'dot-shading' ? 240 : 160;
  const brushRadius = Math.min(max, Math.max(16, layer.settings.brushRadius + delta));
  if (brushRadius === layer.settings.brushRadius) return layer;
  return { ...layer, settings: { ...layer.settings, brushRadius } };
}

export function setLayerKind(layer: GridPaintLayer, kind: NCTGraphiteGridKind): GridPaintLayer {
  if (layer.mode !== 'cell-paint' && layer.mode !== 'hull') return layer;
  if (layer.settings.kind === kind) return layer;
  return { ...layer, settings: { ...layer.settings, kind }, data: { cells: {} } };
}

const SETTING_RESETS = new Set(['kind', 'size', 'columns', 'rows']);
const DOT_LATTICE_RESETS = new Set(['columns', 'rows', 'useJitter', 'jitterAmount', 'seed']);

export function setLayerSetting(
  layer: GridPaintLayer,
  id: string,
  value: number | boolean | string,
  canvas?: NCTGraphiteDocumentCanvas,
): GridPaintLayer {
  if (!(id in layer.settings) || (layer.settings as Record<string, unknown>)[id] === value) return layer;
  const settings = { ...layer.settings, [id]: value };
  if (layer.mode === 'vector-field' && (id === 'columns' || id === 'rows') && canvas) {
    const next = { ...layer, settings } as VectorFieldLayer;
    return rebuildVectorField(next, canvas);
  }
  if (layer.mode === 'dot-shading' && DOT_LATTICE_RESETS.has(id) && canvas) {
    return rebuildDotLattice({ ...layer, settings } as DotShadingLayer, canvas, id !== 'columns' && id !== 'rows');
  }
  const data = layer.mode === 'cell-paint' || layer.mode === 'hull'
    ? (SETTING_RESETS.has(id) ? { cells: {} } : layer.data)
    : layer.data;
  return { ...layer, settings, data } as GridPaintLayer;
}

export function rebuildVectorField(layer: VectorFieldLayer, canvas: NCTGraphiteDocumentCanvas): VectorFieldLayer {
  return {
    ...layer,
    data: {
      vectors: makeVectorField(layer.settings.columns, layer.settings.rows, canvas.width, canvas.height),
      attractors: layer.data.attractors,
    },
  };
}

export function rebuildDotLattice(layer: DotShadingLayer, canvas: NCTGraphiteDocumentCanvas, keepRadii = true): DotShadingLayer {
  const points = makeSampleLattice(layer.settings.columns, layer.settings.rows, canvas.width, canvas.height, {
    jitter: layer.settings.useJitter ? layer.settings.jitterAmount : 0,
    seed: layer.settings.seed,
    radius: 1,
  });
  if (keepRadii && points.length === layer.data.points.length) {
    for (let index = 0; index < points.length; index++) points[index].radius = layer.data.points[index].radius;
  }
  return { ...layer, data: { points } };
}

export function reJitterDotLayer(layer: DotShadingLayer, canvas: NCTGraphiteDocumentCanvas): DotShadingLayer {
  return rebuildDotLattice({ ...layer, settings: { ...layer.settings, seed: layer.settings.seed + 1 } }, canvas, false);
}

export function parseCellId(id: string): { q: number; r: number; s?: number } | null {
  const parts = id.split(',').map(Number);
  if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) return null;
  return parts.length >= 3 ? { q: parts[0], r: parts[1], s: parts[2] } : { q: parts[0], r: parts[1] };
}

function paintedCells(layer: HullLayer, canvas: NCTGraphiteDocumentCanvas) {
  const spec = layerGridSpec(layer, canvas);
  return Object.keys(layer.data.cells).flatMap((id) => {
    const coordinate = parseCellId(id);
    return coordinate ? [gridCell(spec, coordinate)] : [];
  });
}

export function hullOutlines(layer: HullLayer, canvas: NCTGraphiteDocumentCanvas): HullLoop[] {
  return hullLoopsFromPolygons(paintedCells(layer, canvas), layer.settings.hullMode);
}

export function hullOutline(layer: HullLayer, canvas: NCTGraphiteDocumentCanvas): NCTGraphitePoint[] {
  return hullOutlines(layer, canvas)[0]?.points ?? [];
}

export function metaballContours(layer: MetaballLayer, canvas: NCTGraphiteDocumentCanvas) {
  const rows = Math.max(8, Math.round(layer.settings.gridResolution * (canvas.height / canvas.width)));
  return contourLayersForBlobs(
    layer.data.blobs,
    PALETTE,
    layer.settings.gridResolution,
    rows,
    canvas.width,
    canvas.height,
    layer.settings.goo,
    layer.settings.smoothBezier,
  );
}

export function metaballNecks(layer: MetaballLayer) {
  const positives = layer.data.blobs.filter((blob) => blob.type !== 'negative');
  const necks: { path: string; color: string }[] = [];
  for (let i = 0; i < positives.length; i++) {
    for (let j = i + 1; j < positives.length; j++) {
      const a = positives[i], b = positives[j];
      if (a.colorGroup !== b.colorGroup) continue;
      const neck = satoNeck(a.r, b.r, a, b, layer.settings.handleSize, layer.settings.goo, layer.settings.kFactor);
      if (neck) necks.push({ path: neck.path, color: a.color });
    }
  }
  return necks;
}

export function paintedCount(layer: GridPaintLayer): number {
  if (layer.mode === 'metaball') return layer.data.blobs.length;
  if (layer.mode === 'vector-field') {
    return layer.data.vectors.filter((sample) => Math.hypot(sample.vx, sample.vy) >= 0.01).length;
  }
  if (layer.mode === 'dot-shading') return layer.data.points.filter((point) => point.radius > 1).length;
  return Object.keys(layer.data.cells).length;
}

export function layerCommands(layer: GridPaintLayer) {
  if (layer.mode === 'hull') return HULL_COMMANDS;
  if (layer.mode === 'metaball') return METABALL_COMMANDS;
  if (layer.mode === 'vector-field') return VECTOR_COMMANDS;
  if (layer.mode === 'dot-shading') return DOT_COMMANDS;
  return CELL_PAINT_COMMANDS;
}

export function layerParameters(layer: GridPaintLayer) {
  if (layer.mode === 'hull') return HULL_PARAMETERS;
  if (layer.mode === 'metaball') return METABALL_PARAMETERS;
  if (layer.mode === 'vector-field') return VECTOR_PARAMETERS;
  if (layer.mode === 'dot-shading') return DOT_PARAMETERS;
  return CELL_PAINT_PARAMETERS;
}

export function layerModeLabel(layer: GridPaintLayer): string {
  if (layer.mode === 'hull') return 'HULL';
  if (layer.mode === 'metaball') return 'META';
  if (layer.mode === 'vector-field') return 'FIELD';
  if (layer.mode === 'dot-shading') return 'DOTS';
  return 'PAINT';
}
