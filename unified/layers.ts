import { makeGridVectors, stampGridVectors, vectorLookup, type VectorGridKind } from './vectorGrid';
import { sampleSpatialIndex } from './sampleSpatial';
import { adaptiveLattice, childCells, resolveAdaptiveEdges, type AdaptiveData, type AdaptiveCell } from './adaptiveCells';
import {
  NCTGraphiteDocument,
  contourLayersForBlobs,
  gooToThreshold,
  createNCTGraphiteLayerId,
  gridCellsInBounds,
  hullLoopsFromPolygons,
  makeSampleLattice,
  makeVectorField,
  roundRectStamp,
  satoNeck,
  stampSampleGain,
  constrainVectorField,
  stampVectorField,
  vectorBrushOp,
  vectorBrushPickerOps,
  VECTOR_BRUSH_OPS,
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
  type VectorFieldLimits,
  type VectorFieldMode,
  type VectorSample,
} from '@nct/nctgraphite';

export { convexHull } from '@nct/nctgraphite';
export type { HullLoop, HullMode };

export const PALETTE = ['#7c5cff', '#00e5ff', '#ff7a45', '#ffe14a', '#38f28a', '#ff4d6d', '#b18aff', '#4af0ff'];

export type CellPaintSettings = {
  hullMode?: HullMode | 'off';
  subdivideDepth?: number;
  subdivideTarget?: 'shape' | 'grid';
  subdivideFalloff?: boolean;
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
  subdivideDepth?: number;
  subdivideTarget?: 'shape' | 'grid';
  subdivideFalloff?: boolean;
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
  data: { cells: PaintedCells } & AdaptiveData;
  settings: CellPaintSettings;
};

export type HullLayer = NCTGraphiteLayerRecord & {
  mode: 'hull';
  data: { cells: PaintedCells } & AdaptiveData;
  settings: HullSettings;
};

export type MetaballBlob = FieldBlob & { id: string; color: string };

export type MetaballSettings = {
  gridResolution: number;
  goo: number;
  kFactor: number;
  handleSize: number;
  brushRadius: number;
  engine: 'contour' | 'arc' | 'vector';
  stampShape: 'circle' | 'roundrect';
  colorIndex: number;
  showGrid: boolean;
  smoothBezier: boolean;
  influenceRange?: number;
  snap?: boolean;
  rectAspect?: number;
  cornerT?: number;
};

export type MetaballLayer = NCTGraphiteLayerRecord & {
  mode: 'metaball';
  data: { blobs: MetaballBlob[]; vectorField?: VectorFieldLayer };
  settings: MetaballSettings;
};

export type VectorFieldSettings = {
  gridKind?: VectorGridKind;
  showGrid?: boolean;
  columns: number;
  rows: number;
  shapeMode: 'off' | 'magnitude' | 'strokes' | 'streamlines';
  shapeThreshold: number;
  shapeThickness: number;
  shapeMerge: number;
  mode: VectorFieldMode;
  strength: number;
  brushRadius: number;
  showVectors: boolean;
  hoverThin: boolean;
  colorIndex: number;
  angleMin: number;
  angleMax: number;
  angleStep: number;
  lengthMin: number;
  lengthMax: number;
  weight: number;
  minWidth: number;
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
export type BrushMode = 'cell-paint' | 'hull' | 'metaball' | 'vector-field' | 'dot-shading';
export type GridPaintLayer = (CellPaintLayer | HullLayer | MetaballLayer | VectorFieldLayer | DotShadingLayer) & {
  modeContents?: Partial<Record<BrushMode, GridPaintLayer>>;
};
export type GridPaintDocument = NCTGraphiteDocument<GridPaintLayer>;
export type PaintAction = 'paint' | 'erase' | 'toggle' | 'inflate' | 'smooth' | 'placeNeg' | 'attractor' | 'clear' | 'bridge' | 'subdivide' | 'coarsen' | 'scaleDown' | 'scaleUp' | `op:${string}`;

const ADAPTIVE_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: 'subdivide', label: 'Subdivide', desc: 'Split cells under the brush', defaultKey: 'd' },
  { id: 'coarsen', label: 'Coarsen', desc: 'Restore parent cells under the brush', defaultKey: 's' },
  { id: 'scaleDown', label: 'Shrink cells', desc: 'Reduce painted cell size', defaultKey: 't' },
  { id: 'scaleUp', label: 'Grow cells', desc: 'Increase painted cell size', defaultKey: 'y' },
];

export const CELL_PAINT_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: 'paint', label: 'Paint', desc: 'Activate primary color', defaultKey: 'f' },
  ...ADAPTIVE_COMMANDS,
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
  ...ADAPTIVE_COMMANDS,
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
  { id: 'smooth', label: 'Smooth', desc: 'Relax blobs toward their neighbors and grid', defaultKey: 'q' },
  { id: 'bridge', label: 'Bridge', desc: 'Place a neck blob between nearest blobs', defaultKey: 'b' },
  { id: 'newColor', label: 'New color', desc: 'Cycle color group', defaultKey: 'n' },
  { id: 'clear', label: 'Clear', desc: 'Clear this layer', defaultKey: 'x' },
  { id: 'brushSmaller', label: 'Brush −', desc: 'Decrease radius', defaultKey: '[' },
  { id: 'brushLarger', label: 'Brush +', desc: 'Increase radius', defaultKey: ']' },
];

export const VECTOR_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: 'paint', label: 'Paint', desc: 'Stamp flow in the brush', defaultKey: 'f' },
  ...VECTOR_BRUSH_OPS.filter(op => op.picker && op.key).map(op => ({ id: `op:${op.id}`, label: op.label, desc: op.blurb, defaultKey: op.key! })),
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
  { id: 'intensityDown', label: 'Intensity −', desc: 'Decrease brush intensity', defaultKey: '-' },
  { id: 'intensityUp', label: 'Intensity +', desc: 'Increase brush intensity', defaultKey: '=' },
  { id: 'brushSmaller', label: 'Brush −', desc: 'Decrease radius', defaultKey: '[' },
  { id: 'brushLarger', label: 'Brush +', desc: 'Increase radius', defaultKey: ']' },
];

const HULL_GRID_OPTIONS = [
  { value: 'square', label: 'Square' },
  { value: 'hex-flat', label: 'Hex horiz' },
  { value: 'hex-flat-diamond', label: 'Hex diamond' },
  { value: 'hex-pointy', label: 'Hex vert' },
  { value: 'tri-horiz', label: 'Tri horiz' },
  { value: 'tri-vert', label: 'Tri vert' },
];

const ADAPTIVE_PARAMETERS: NCTParameterDefinition[] = [
  { id: 'subdivideDepth', label: 'Subdivision depth', type: 'number', min: 0, max: 4, step: 1, defaultValue: 2 },
  { id: 'subdivideTarget', label: 'Subdivision target', type: 'select', defaultValue: 'shape', options: [{ value: 'shape', label: 'Painted' }, { value: 'grid', label: 'Grid' }] },
  { id: 'subdivideFalloff', label: 'Subdivision falloff', type: 'boolean', defaultValue: false },
];

export const CELL_PAINT_PARAMETERS: NCTParameterDefinition[] = [
  { id: 'kind', label: 'Grid', type: 'select', defaultValue: 'hex-flat', options: HULL_GRID_OPTIONS },
  { id: 'size', label: 'Cell size', type: 'number', min: 12, max: 48, step: 1, defaultValue: 28 },
  { id: 'brushRadius', label: 'Brush', type: 'number', min: 16, max: 160, step: 4, defaultValue: 56 },
  { id: 'falloff', label: 'Falloff', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0 },
  { id: 'showGrid', label: 'Show grid', type: 'boolean', defaultValue: true },
  { id: 'showCenters', label: 'Centers', type: 'boolean', defaultValue: false },
  ...ADAPTIVE_PARAMETERS,
  { id: 'hullMode', label: 'Hull outline', type: 'select', defaultValue: 'off', options: [{ value: 'off', label: 'Off' }, { value: 'tight', label: 'Tight' }, { value: 'smooth', label: 'Smooth' }, { value: 'convex', label: 'Convex' }, { value: 'concave', label: 'Concave' }] },
];



export const HULL_PARAMETERS: NCTParameterDefinition[] = [
  ...ADAPTIVE_PARAMETERS,
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
  { id: 'engine', label: 'Engine', type: 'select', defaultValue: 'vector', options: [
    { value: 'contour', label: 'Field' },
    { value: 'arc', label: 'Arc' },
    { value: 'vector', label: 'Vector' },
  ] },
  { id: 'stampShape', label: 'Stamp', type: 'select', defaultValue: 'circle', options: [
    { value: 'circle', label: 'Circle' },
    { value: 'roundrect', label: 'Round rect' },
  ] },
  { id: 'snap', label: 'Snap to grid', type: 'boolean', defaultValue: false },
  { id: 'rectAspect', label: 'Stamp aspect', type: 'number', min: 1, max: 3, step: 0.05, defaultValue: 1.7 },
  { id: 'cornerT', label: 'Stamp corner', type: 'number', min: 0.25, max: 1, step: 0.05, defaultValue: 0.55 },
  { id: 'gridResolution', label: 'Field grid (minimum)', type: 'number', min: 16, max: 512, step: 4, defaultValue: 48 },
  { id: 'influenceRange', label: 'Range × radius (0 = unlimited)', type: 'number', min: 0, max: 20, step: 0.5, defaultValue: 0 },
  { id: 'goo', label: 'Goo', type: 'number', min: 0.2, max: 1.2, step: 0.05, defaultValue: 0.8 },
  { id: 'kFactor', label: 'Bridge K', type: 'number', min: 1, max: 4, step: 0.1, defaultValue: 2.5 },
  { id: 'handleSize', label: 'Handles', type: 'number', min: 0.5, max: 4, step: 0.1, defaultValue: 2.4 },
  { id: 'brushRadius', label: 'Brush', type: 'number', min: 16, max: 160, step: 4, defaultValue: 48 },
  { id: 'smoothBezier', label: 'Bezier contours', type: 'boolean', defaultValue: false },
  { id: 'showGrid', label: 'Show samples', type: 'boolean', defaultValue: false },
];

export const VECTOR_PARAMETERS: NCTParameterDefinition[] = [
  { id: 'gridKind', label: 'Grid', type: 'select', defaultValue: 'square', options: [{ value: 'square', label: 'Square' }, { value: 'triangle', label: 'Triangle' }, { value: 'hex', label: 'Hex' }] },
  { id: 'showGrid', label: 'Show grid', type: 'boolean', defaultValue: false },
  { id: 'mode', label: 'Mode', type: 'select', defaultValue: 'velocity', options: vectorBrushPickerOps().map((op) => ({
    value: op.id,
    label: op.label,
  })) },
  { id: 'shapeMode', label: 'Shape', type: 'select', defaultValue: 'off', options: [{ value: 'off', label: 'Off' }, { value: 'magnitude', label: 'Magnitude' }, { value: 'strokes', label: 'Vector strokes' }, { value: 'streamlines', label: 'Streamlines' }] },
  { id: 'shapeThreshold', label: 'Threshold', type: 'number', min: 0.05, max: 3, step: 0.05, defaultValue: 0.3 },
  { id: 'shapeThickness', label: 'Thickness', type: 'number', min: 2, max: 50, step: 1, defaultValue: 8 },
  { id: 'shapeMerge', label: 'Merge radius', type: 'number', min: 0, max: 40, step: 1, defaultValue: 6 },
  { id: 'columns', label: 'Columns', type: 'number', min: 8, max: 80, step: 1, defaultValue: 48 },
  { id: 'rows', label: 'Rows', type: 'number', min: 8, max: 60, step: 1, defaultValue: 32 },
  { id: 'strength', label: 'Strength', type: 'number', min: 0.2, max: 3, step: 0.1, defaultValue: 1 },
  { id: 'brushRadius', label: 'Brush', type: 'number', min: 16, max: 240, step: 4, defaultValue: 90 },
  { id: 'angleMin', label: 'Angle min', type: 'number', min: 0, max: 360, step: 1, defaultValue: 0 },
  { id: 'angleMax', label: 'Angle max', type: 'number', min: 0, max: 360, step: 1, defaultValue: 360 },
  { id: 'angleStep', label: 'Angle step', type: 'number', min: 0, max: 90, step: 1, defaultValue: 0 },
  { id: 'lengthMin', label: 'Length min', type: 'number', min: 0, max: 8, step: 0.1, defaultValue: 0 },
  { id: 'lengthMax', label: 'Length max', type: 'number', min: 0, max: 8, step: 0.1, defaultValue: 3 },
  { id: 'weight', label: 'Weight', type: 'number', min: 0, max: 8, step: 0.1, defaultValue: 2.2 },
  { id: 'minWidth', label: 'Min width', type: 'number', min: 0.5, max: 8, step: 0.1, defaultValue: 1 },
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
  // Document coordinates use 20 units per inch.
  return { width: 48 * 20, height: 36 * 20, background: '#ffffff' };
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
      kind: 'hex-flat', size: 28, columns: 22, rows: 16, brushRadius: 56, hullMode: 'off',
      falloff: 0, showGrid: true, showCenters: false, colorIndex: 0,
      ...partial.settings,
    },
    ...partial,
    mode: 'cell-paint',
    data: partial.data ?? { cells: {} },
    settings: {
      kind: 'hex-flat', size: 28, columns: 22, rows: 16, brushRadius: 56, hullMode: 'off',
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
      engine: 'vector', stampShape: 'circle', colorIndex: 0, showGrid: false, smoothBezier: false,
      ...partial.settings,
    },
    ...partial,
    mode: 'metaball',
    data: partial.data ?? { blobs: [] },
    settings: {
      gridResolution: 48, goo: 0.8, kFactor: 2.5, handleSize: 2.4, brushRadius: 48,
      engine: 'vector', stampShape: 'circle', colorIndex: 0, showGrid: false, smoothBezier: false,
      ...partial.settings,
    },
  };
}

export function createVectorFieldLayer(canvas: NCTGraphiteDocumentCanvas, partial: Partial<VectorFieldLayer> = {}): VectorFieldLayer {
  const settings = {
    columns: 48, rows: 32, gridKind: 'square' as VectorGridKind, showGrid: false, shapeMode: 'off' as const, shapeThreshold: 0.3, shapeThickness: 8, shapeMerge: 6, mode: 'velocity' as VectorFieldMode, strength: 1, brushRadius: 90,
    showVectors: true, hoverThin: true, colorIndex: 0,
    angleMin: 0, angleMax: 360, angleStep: 0, lengthMin: 0, lengthMax: 3, weight: 2.2, minWidth: 1,
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
    data: partial.data ?? { vectors: makeGridVectors(settings.gridKind, settings.columns, settings.rows, canvas), attractors: [] },
  };
}

/** The vector engine keeps its own editable field alongside the blob engines. */
export function metaballVectorLayer(layer: MetaballLayer, canvas: NCTGraphiteDocumentCanvas): VectorFieldLayer {
  const stored = layer.data.vectorField ?? createVectorFieldLayer(canvas, { settings: { shapeMode: 'magnitude', mode: 'swirl' } });
  return { ...stored, id: `${layer.id}:vector`, visible: layer.visible, locked: layer.locked, opacity: layer.opacity, settings: { ...stored.settings, brushRadius: layer.settings.brushRadius, colorIndex: layer.settings.colorIndex } };
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

export function createUnifiedDocument(): GridPaintDocument {
  const canvas = { ...defaultCanvas(), width: 144 * 20, height: 108 * 20 };
  const paint = createCellPaintLayer({ name: 'Layer 1' });
  return NCTGraphiteDocument.untitled({
    displayName: 'Grid Paint',
    canvas,
    layers: [paint],
    activeLayerId: paint.id,
  });
}

export function createInitialDocument(): GridPaintDocument {
  const canvas = { ...defaultCanvas(), width: 144 * 20, height: 108 * 20 };
  const hull = createHullLayer(), paint = createCellPaintLayer();
  return NCTGraphiteDocument.untitled({ displayName: 'Grid Paint', canvas, layers: [hull, paint, createDotShadingLayer(canvas), createMetaballLayer(), createVectorFieldLayer(canvas)], activeLayerId: paint.id });
}

const emptyModes = new WeakMap<GridPaintLayer, Map<string, GridPaintLayer>>();
export function modeLayer(layer: GridPaintLayer, mode: BrushMode, canvas: NCTGraphiteDocumentCanvas): GridPaintLayer {
  if (layer.mode === mode) return layer;
  const saved = layer.modeContents?.[mode];
  if (saved) return { ...saved, visible: layer.visible, locked: layer.locked, opacity: layer.opacity };
  let cached = emptyModes.get(layer);
  if (!cached) { cached = new Map(); emptyModes.set(layer, cached); }
  const key = `${mode}:${canvas.width}:${canvas.height}`;
  const previous = cached.get(key);
  if (previous) return previous;
  const created = mode === 'hull' ? createHullLayer() : mode === 'metaball' ? createMetaballLayer() : mode === 'dot-shading' ? createDotShadingLayer(canvas) : mode === 'vector-field' ? createVectorFieldLayer(canvas) : createCellPaintLayer();
  const part = { ...created, id: `${layer.id}:${mode}`, visible: layer.visible, locked: layer.locked, opacity: layer.opacity };
  cached.set(key, part);
  return part;
}

export function updateModeLayer(layer: GridPaintLayer, mode: BrushMode, canvas: NCTGraphiteDocumentCanvas, update: (part: GridPaintLayer) => GridPaintLayer): GridPaintLayer {
  if (layer.mode === mode) return update(layer);
  const part = modeLayer(layer, mode, canvas);
  const next = update(part);
  if (next === part) return layer;
  return { ...layer, modeContents: { ...layer.modeContents, [mode]: next } };
}

export function layerContents(layer: GridPaintLayer): GridPaintLayer[] {
  return [layer, ...Object.values(layer.modeContents ?? {}).filter((item): item is GridPaintLayer => !!item)];
}

export function layerGridSpec(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas): NCTGraphiteGridSpec {
  return { kind: layer.settings.kind, size: layer.settings.size, origin: { x: canvas.width / 2, y: canvas.height / 2 } };
}

function rootLattice(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas): NCTGraphiteGridCell[] {
  return gridCellsInBounds(layerGridSpec(layer, canvas), { minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height });
}

const latticeCache = new Map<string, { key: string; splits: CellMeshLayer['data']['splits']; cells: AdaptiveCell[] }>();
export function layerLattice(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas): AdaptiveCell[] {
  const key = `${canvas.width},${canvas.height},${layer.settings.kind},${layer.settings.size}`;
  const cached = latticeCache.get(layer.id);
  if (cached?.key === key && cached.splits === layer.data.splits) return cached.cells;
  const cells = adaptiveLattice(rootLattice(layer, canvas), layer.data.splits);
  if (latticeCache.size >= 12 && !cached) latticeCache.delete(latticeCache.keys().next().value!);
  latticeCache.set(layer.id, { key, splits: layer.data.splits, cells });
  return cells;
}

function brushLattice(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas, point: NCTGraphitePoint): AdaptiveCell[] {
  const radius = layer.settings.brushRadius + layer.settings.size * 2;
  const bounds = { minX: Math.max(0, point.x - radius), minY: Math.max(0, point.y - radius), maxX: Math.min(canvas.width, point.x + radius), maxY: Math.min(canvas.height, point.y + radius) };
  return adaptiveLattice(gridCellsInBounds(layerGridSpec(layer, canvas), bounds), layer.data.splits);
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
  const lattice = brushLattice(layer, canvas, point);
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
  return changed ? { ...layer, data: { ...layer.data, cells } } : layer;
}

/** Edit the adaptive mesh without changing the base lattice or mutating document history. */
function editAdaptiveCells(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas, point: NCTGraphitePoint, action: 'subdivide' | 'coarsen' | 'scaleDown' | 'scaleUp'): CellMeshLayer {
  const leaves = brushLattice(layer, canvas, point);
  const radius = layer.settings.brushRadius;
  const target = layer.settings.subdivideTarget ?? 'shape';
  const hits = leaves.filter(cell => Math.hypot(cell.center.x - point.x, cell.center.y - point.y) <= radius && (action === 'scaleDown' || action === 'scaleUp' || target === 'grid' || !!layer.data.cells[cell.id]));
  if (!hits.length) return layer;
  const cells = { ...layer.data.cells }, splits = { ...layer.data.splits }, scales = { ...layer.data.scales };
  if (action === 'scaleDown' || action === 'scaleUp') {
    let changed = false;
    for (const cell of hits) {
      const old = scales[cell.id] ?? 1, next = Math.max(0.05, Math.min(1, old + (action === 'scaleUp' ? 0.05 : -0.05)));
      if (old !== next) { scales[cell.id] = next; changed = true; }
    }
    return changed ? { ...layer, data: { ...layer.data, scales } } : layer;
  }
  if (action === 'subdivide') {
    const depth = Math.max(0, Math.min(4, layer.settings.subdivideDepth ?? 2));
    const candidates = hits.filter(cell => cell.level < depth && (!(layer.settings.subdivideFalloff ?? false) || cell.level < Math.ceil(depth * Math.max(0, 1 - Math.hypot(cell.center.x - point.x, cell.center.y - point.y) / radius))));
    if (!candidates.length) return layer;
    const minLevel = Math.min(...candidates.map(cell => cell.level));
    for (const cell of candidates.filter(c => c.level === minLevel)) {
      const painted = cells[cell.id]; delete cells[cell.id]; splits[cell.id] = true;
      for (const child of childCells(cell)) {
        if (painted) cells[child.id] = { ...painted };
        if (scales[cell.id] !== undefined) scales[child.id] = scales[cell.id];
      }
      delete scales[cell.id];
    }
  } else {
    const deepest = Math.max(...hits.map(cell => cell.level));
    if (!deepest) return layer;
    const parents = new Set(hits.filter(cell => cell.level === deepest && cell.parentId).map(cell => cell.parentId!));
    let changed = false;
    for (const parent of parents) {
      const children = leaves.filter(cell => cell.parentId === parent);
      // Only merge when every direct child is a leaf.
      if (!children.length || Object.keys(splits).some(id => id.startsWith(`${parent}/`) && splits[id])) continue;
      const painted = children.map(child => cells[child.id]).find(Boolean);
      const sizes = children.map(child => scales[child.id]).filter((v): v is number => v !== undefined);
      for (const child of children) { delete cells[child.id]; delete scales[child.id]; }
      if (painted) cells[parent] = { ...painted };
      if (sizes.length) scales[parent] = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      delete splits[parent]; changed = true;
    }
    if (!changed) return layer;
  }
  return { ...layer, data: { ...layer.data, cells, splits, scales } };
}

function metaballStampCenters(layer: MetaballLayer, point: NCTGraphitePoint): { x: number; y: number; r: number }[] {
  const radius = layer.settings.brushRadius;
  if (layer.settings.stampShape === 'roundrect') return roundRectStamp(point.x, point.y, radius, layer.settings.rectAspect ?? 1.7, layer.settings.cornerT ?? 0.55).centers;
  return [{ x: point.x, y: point.y, r: radius }];
}

function paintMetaballAt(layer: MetaballLayer, canvas: NCTGraphiteDocumentCanvas, point: NCTGraphitePoint, action: PaintAction): MetaballLayer {
  const cols = layer.settings.gridResolution;
  const rows = Math.max(8, Math.round(cols * canvas.height / canvas.width));
  const snapPoint = (p: NCTGraphitePoint) => ({ x: Math.round(p.x / canvas.width * cols) * canvas.width / cols, y: Math.round(p.y / canvas.height * rows) * canvas.height / rows });
  const radius = layer.settings.brushRadius;
  if (action === 'erase') {
    const blobs = layer.data.blobs.filter((blob) => Math.hypot(blob.x - point.x, blob.y - point.y) > radius + blob.r * 0.35);
    return blobs.length === layer.data.blobs.length ? layer : { ...layer, data: { ...layer.data, blobs } };
  }
  if (action === 'inflate') {
    let changed = false;
    const blobs = layer.data.blobs.map((blob) => {
      if (Math.hypot(blob.x - point.x, blob.y - point.y) > radius) return blob;
      changed = true;
      return { ...blob, r: Math.min(180, blob.r + 1.6) };
    });
    return changed ? { ...layer, data: { ...layer.data, blobs } } : layer;
  }
  if (action === 'smooth') {
    const near = layer.data.blobs.filter(b => Math.hypot(b.x - point.x, b.y - point.y) < radius);
    if (!near.length) return layer;
    const center = { x: near.reduce((n, b) => n + b.x, 0) / near.length, y: near.reduce((n, b) => n + b.y, 0) / near.length };
    return { ...layer, data: { ...layer.data, blobs: layer.data.blobs.map(b => { if (!near.includes(b)) return b; const grid = snapPoint(b); return { ...b, x: b.x * 0.92 + center.x * 0.04 + grid.x * 0.04, y: b.y * 0.92 + center.y * 0.04 + grid.y * 0.04, r: b.r * 0.995 + 0.2 }; }) } };
  }
  if (action === 'bridge') {
    const nearest = layer.data.blobs.filter(b => b.type !== 'negative' && b.colorGroup === layer.settings.colorIndex).sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y)).slice(0, 2);
    if (nearest.length < 2) return layer;
    const [a, b] = nearest;
    return { ...layer, data: { ...layer.data, blobs: [...layer.data.blobs, { id: createNCTGraphiteLayerId(), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.min(a.r, b.r) * 0.55, type: 'positive', colorGroup: a.colorGroup, color: a.color }] } };
  }
  if (action !== 'paint' && action !== 'placeNeg') return layer;
  if (layer.settings.snap) point = snapPoint(point);
  const type = action === 'placeNeg'  ? 'negative' : 'positive';
  const color = PALETTE[layer.settings.colorIndex % PALETTE.length];
  const added: MetaballBlob[] = metaballStampCenters(layer, point).map((center) => ({
    id: createNCTGraphiteLayerId(),
    x: center.x,
    y: center.y,
    r: center.r,
    ...(layer.settings.engine === 'contour' ? { fieldScale: Math.sqrt(gooToThreshold(layer.settings.goo)) } : {}),
    type,
    colorGroup: layer.settings.colorIndex,
    color,
  }));
  return { ...layer, data: { ...layer.data, blobs: [...layer.data.blobs, ...added] } };
}

function vectorLimitsOf(settings: VectorFieldSettings): VectorFieldLimits {
  return {
    angleMin: settings.angleMin ?? 0,
    angleMax: settings.angleMax ?? 360,
    angleStep: settings.angleStep ?? 0,
    lengthMin: settings.lengthMin ?? 0,
    lengthMax: settings.lengthMax ?? 3,
  };
}

const VECTOR_LIMIT_IDS = new Set(['angleMin', 'angleMax', 'angleStep', 'lengthMin', 'lengthMax']);

function paintVectorAt(
  layer: VectorFieldLayer,
  point: NCTGraphitePoint,
  action: PaintAction,
  extra?: { velocityX?: number; velocityY?: number },
  canvas?: NCTGraphiteDocumentCanvas,
): VectorFieldLayer {
  if (action === 'attractor') {
    const attractor = {
      id: createNCTGraphiteLayerId(),
      x: point.x,
      y: point.y,
      r: layer.settings.brushRadius,
      ...(vectorBrushOp(layer.settings.mode).attractor ?? { orbit: false }),
    };
    return { ...layer, data: { ...layer.data, attractors: [...layer.data.attractors, attractor] } };
  }
  const stampAction = action === 'smooth' ? 'smooth' : action === 'erase' ? 'erase' : 'paint';
  const kind = layer.settings.gridKind ?? 'square';
  const vectors = kind === 'square' ? stampVectorField(layer.data.vectors, {
    columns: layer.settings.columns,
    rows: layer.settings.rows,
    x: point.x,
    y: point.y,
    radius: layer.settings.brushRadius,
    action: stampAction,
    op: action.startsWith('op:') ? action.slice(3) : undefined,
    mode: layer.settings.mode,
    strength: layer.settings.strength,
    velocityX: extra?.velocityX,
    velocityY: extra?.velocityY,
    limits: vectorLimitsOf(layer.settings),
  }) : stampGridVectors(layer.data.vectors, {
    kind, spacing: Math.min((canvas?.width ?? 960) / layer.settings.columns, (canvas?.height ?? 660) / layer.settings.rows),
    x: point.x, y: point.y, radius: layer.settings.brushRadius,
    op: action.startsWith('op:') ? action.slice(3) : stampAction === 'paint' ? layer.settings.mode : stampAction,
    strength: layer.settings.strength, velocityX: extra?.velocityX, velocityY: extra?.velocityY, limits: vectorLimitsOf(layer.settings),
  });
  return { ...layer, data: { ...layer.data, vectors } };
}

const dotSampleIndices = new WeakMap<readonly SampleGainPoint[], ReturnType<typeof sampleSpatialIndex<SampleGainPoint>>>();

function paintDotAt(
  layer: DotShadingLayer,
  canvas: NCTGraphiteDocumentCanvas,
  point: NCTGraphitePoint,
  action: PaintAction,
  extra?: { brushAngle?: number },
): DotShadingLayer {
  const stampAction = action === 'erase' ? 'shrink' : action === 'smooth' ? 'smooth' : action === 'clear' ? 'clear' : 'grow';
  const original = layer.data.points;
  let index = dotSampleIndices.get(original);
  if (!index) {
    index = sampleSpatialIndex(original, canvas.width / Math.max(1, layer.settings.columns));
    dotSampleIndices.set(original, index);
  }
  const radius = layer.settings.brushRadius;
  const hits = index.within(point.x, point.y, radius);
  if (!hits.some(hit => hit.d < radius)) return layer;
  const neighbor = canvas.width / Math.max(1, layer.settings.columns) * 1.8;
  const candidates = (stampAction === 'smooth' ? index.within(point.x, point.y, radius + neighbor) : hits)
    .map(hit => hit.index).sort((a, b) => a - b);
  const stamped = stampSampleGain(candidates.map(i => original[i]), {
    columns: layer.settings.columns, rows: layer.settings.rows, width: canvas.width, height: canvas.height,
    x: point.x, y: point.y, radius: layer.settings.brushRadius, action: stampAction,
    intensity: layer.settings.intensity, falloffType: layer.settings.falloffType, falloffPower: layer.settings.falloffPower,
    minRadius: layer.settings.minRadius, maxRadius: layer.settings.maxRadius, rotationMode: layer.settings.rotationMode,
    rotationJitter: layer.settings.rotationJitter, brushAngle: extra?.brushAngle,
  });
  if (stamped.every((sample, i) => sample.radius === original[candidates[i]].radius && sample.rotation === original[candidates[i]].rotation)) return layer;
  const points = original.slice();
  for (let i = 0; i < candidates.length; i++) points[candidates[i]] = stamped[i];
  dotSampleIndices.set(points, index);
  return {
    ...layer,
    data: { points },
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
  if (layer.mode === 'metaball') {
    if (layer.settings.engine !== 'vector') return paintMetaballAt(layer, canvas, point, action);
    const vector = metaballVectorLayer(layer, canvas);
    const next = paintVectorAt(vector, point, action, extra, canvas);
    return next === vector ? layer : { ...layer, data: { ...layer.data, vectorField: next } };
  }
  if (layer.mode === 'vector-field') return paintVectorAt(layer, point, action, extra, canvas);
  if (layer.mode === 'dot-shading') {
    if (action === 'inflate' || action === 'placeNeg' || action === 'attractor' || action === 'toggle') return layer;
    return paintDotAt(layer, canvas, point, action, extra);
  }
  if (action === 'subdivide' || action === 'coarsen' || action === 'scaleDown' || action === 'scaleUp') return editAdaptiveCells(layer, canvas, point, action);
  if (action === 'inflate' || action === 'smooth' || action === 'placeNeg' || action === 'attractor' || action === 'clear') return layer;
  return paintCellMeshAt(layer, canvas, point, action);
}

export function clearLayerPaint(layer: GridPaintLayer): GridPaintLayer {
  if (layer.mode === 'metaball') {
    if (layer.settings.engine === 'vector' && layer.data.vectorField) {
      const vectorField = clearLayerPaint(layer.data.vectorField) as VectorFieldLayer;
      return vectorField === layer.data.vectorField ? layer : { ...layer, data: { ...layer.data, vectorField } };
    }
    if (layer.data.blobs.length === 0) return layer;
    return { ...layer, data: { ...layer.data, blobs: [] } };
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
  return { ...layer, data: { ...layer.data, cells: {} } };
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
  if (layer.mode === 'metaball' && id.startsWith('vector:') && canvas) {
    const vector = metaballVectorLayer(layer, canvas);
    const next = setLayerSetting(vector, id.slice(7), value, canvas) as VectorFieldLayer;
    return next === vector ? layer : { ...layer, data: { ...layer.data, vectorField: next } };
  }
  if (!(id in layer.settings) && !(layer.mode === 'vector-field' && (id.startsWith('shape') || id === 'gridKind' || id === 'showGrid')) && !(layer.mode === 'cell-paint' && id === 'hullMode') && !(layer.mode === 'metaball' && ['snap', 'rectAspect', 'cornerT', 'influenceRange'].includes(id)) && !((layer.mode === 'cell-paint' || layer.mode === 'hull') && ['subdivideDepth', 'subdivideTarget', 'subdivideFalloff'].includes(id))) return layer;
  if ( (layer.settings as Record<string, unknown>)[id] === value) return layer;
  const settings = { ...layer.settings, [id]: value };
  if (layer.mode === 'metaball' && id === 'engine' && value === 'vector' && canvas && !layer.data.vectorField) {
    return { ...layer, settings: settings as MetaballSettings, data: { ...layer.data, vectorField: metaballVectorLayer(layer, canvas) } };
  }
  if (layer.mode === 'vector-field' && id === 'gridKind' && canvas) {
    const next = { ...layer, settings } as VectorFieldLayer;
    const spacing = Math.min(canvas.width / layer.settings.columns, canvas.height / layer.settings.rows);
    const lookup = vectorLookup(layer.data.vectors, spacing);
    const vectors = makeGridVectors(next.settings.gridKind ?? 'square', next.settings.columns, next.settings.rows, canvas).map(v => ({ ...v, ...lookup.interpolate(v.x, v.y) }));
    return { ...next, data: { ...next.data, vectors } };
  }
  if (layer.mode === 'vector-field' && (id === 'columns' || id === 'rows') && canvas) {
    const next = { ...layer, settings } as VectorFieldLayer;
    return rebuildVectorField(next, canvas);
  }
  if (layer.mode === 'vector-field' && VECTOR_LIMIT_IDS.has(id)) {
    const next = { ...layer, settings } as VectorFieldLayer;
    return {
      ...next,
      data: { ...next.data, vectors: constrainVectorField(next.data.vectors, vectorLimitsOf(next.settings)) },
    };
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
      vectors: makeGridVectors(layer.settings.gridKind ?? 'square', layer.settings.columns, layer.settings.rows, canvas),
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

function paintedCells(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas) {
  if (!Object.keys(layer.data.cells).length) return [];
  const leaves = layerLattice(layer, canvas).filter(cell => !!layer.data.cells[cell.id]);
  return layer.data.splits && Object.keys(layer.data.splits).length ? resolveAdaptiveEdges(leaves) : leaves;
}

export function hullOutlines(layer: CellMeshLayer, canvas: NCTGraphiteDocumentCanvas): HullLoop[] {
  return hullLoopsFromPolygons(paintedCells(layer, canvas), layer.settings.hullMode === 'off' || !layer.settings.hullMode ? 'tight' : layer.settings.hullMode);
}

export function hullOutline(layer: HullLayer, canvas: NCTGraphiteDocumentCanvas): NCTGraphitePoint[] {
  return hullOutlines(layer, canvas)[0]?.points ?? [];
}

export function metaballContours(layer: MetaballLayer, canvas: NCTGraphiteDocumentCanvas) {
  // At least four samples per smallest radius, bounded to keep live drawing responsive.
  const smallest = layer.data.blobs.reduce((min, blob) => Number.isFinite(blob.r) && blob.r > 0 ? Math.min(min, blob.r) : min, Infinity);
  const cols = Math.max(layer.settings.gridResolution, Math.min(512, Math.ceil(canvas.width * 4 / smallest)));
  const rows = Math.max(8, Math.round(cols * (canvas.height / canvas.width)));
  return contourLayersForBlobs(
    layer.data.blobs,
    PALETTE,
    cols,
    rows,
    canvas.width,
    canvas.height,
    layer.settings.goo,
    layer.settings.smoothBezier,
    layer.settings.influenceRange ?? 0,
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
  if (layer.mode === 'metaball') return layer.settings.engine === 'vector' ? (layer.data.vectorField?.data.vectors.filter(v => Math.hypot(v.vx, v.vy) >= 0.01).length ?? 0) : layer.data.blobs.length;
  if (layer.mode === 'vector-field') {
    return layer.data.vectors.filter((sample) => Math.hypot(sample.vx, sample.vy) >= 0.01).length;
  }
  if (layer.mode === 'dot-shading') return layer.data.points.filter((point) => point.radius > 1).length;
  return Object.keys(layer.data.cells).length;
}

export function layerCommands(layer: GridPaintLayer) {
  if (layer.mode === 'hull') return HULL_COMMANDS;
  if (layer.mode === 'metaball') return layer.settings.engine === 'vector' ? VECTOR_COMMANDS : METABALL_COMMANDS;
  if (layer.mode === 'vector-field') return VECTOR_COMMANDS;
  if (layer.mode === 'dot-shading') return DOT_COMMANDS;
  return CELL_PAINT_COMMANDS;
}

export function layerParameters(layer: GridPaintLayer) {
  if (layer.mode === 'hull') return HULL_PARAMETERS;
  if (layer.mode === 'metaball') return layer.settings.engine === 'vector' ? [METABALL_PARAMETERS[0], METABALL_PARAMETERS.find(p => p.id === 'brushRadius')!, ...VECTOR_PARAMETERS.filter(p => p.id !== 'brushRadius').map(p => ({ ...p, id: `vector:${p.id}` }))] : layer.settings.engine === 'contour' ? METABALL_PARAMETERS : METABALL_PARAMETERS.filter(p => p.id !== 'influenceRange');
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
