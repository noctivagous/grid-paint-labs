/**
 * Adapters between the unified .nctgdoc.json snapshot and the original lab
 * record / Vector Field JSON payloads. NCTGraphite owns the document kit;
 * this module owns lab schema mapping.
 */
import { NCTGraphiteDocument, createNCTGraphiteLayerId, makeSampleLattice, makeVectorField } from '@nct/nctgraphite';
import type { NCTGraphiteDocumentCanvas, NCTGraphiteGridKind, SampleGainPoint } from '@nct/nctgraphite';
import {
  PALETTE,
  createCellPaintLayer,
  createDotShadingLayer,
  createHullLayer,
  createVectorFieldLayer,
  defaultCanvas,
  layerLattice,
  parseCellId,
  type DotColorMode,
  type DotFillMode,
  type DotShape,
  type DotShadingLayer,
  type GridPaintDocument,
  type GridPaintLayer,
  type HullLayer,
  type HullSettings,
  type PaintedCells,
} from './layers';

export type LabRecordKind = 'nctgdoc' | 'paintings' | 'hull_sessions' | 'presets' | 'vector-field';

const HULL_FROM_LAB: Record<string, NCTGraphiteGridKind> = {
  square: 'square',
  hexFlat: 'hex-flat',
  hexHoriz: 'hex-flat',
  hexHorizDiamond: 'hex-flat-diamond',
  hexVert: 'hex-pointy',
  hexPointy: 'hex-pointy',
  triHoriz: 'tri-horiz',
  triangle: 'tri-horiz',
  triVert: 'tri-vert',
  'hex-flat': 'hex-flat',
  'hex-flat-diamond': 'hex-flat-diamond',
  'hex-pointy': 'hex-pointy',
  'tri-horiz': 'tri-horiz',
  'tri-vert': 'tri-vert',
};

const HULL_TO_LAB: Record<NCTGraphiteGridKind, string> = {
  square: 'square',
  'hex-flat': 'hexHoriz',
  'hex-flat-diamond': 'hexHorizDiamond',
  'hex-pointy': 'hexVert',
  'tri-horiz': 'triHoriz',
  'tri-vert': 'triVert',
};

const HEX_FROM_LAB: Record<string, NCTGraphiteGridKind> = {
  flat: 'hex-flat',
  pointy: 'hex-pointy',
  square: 'square',
  'hex-flat': 'hex-flat',
  'hex-pointy': 'hex-pointy',
};

const HEX_TO_LAB: Record<string, 'flat' | 'pointy' | 'square'> = {
  'hex-flat': 'flat',
  'hex-pointy': 'pointy',
  square: 'square',
};

const VECTOR_LAB_HEIGHT = 680;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unwrapPayload(data: unknown): { collection?: string; value: unknown } {
  if (!isRecord(data)) return { value: data };
  if (Array.isArray(data.data) || Array.isArray((data.data as { records?: unknown })?.records)) {
    const records = Array.isArray(data.data) ? data.data : (data.data as { records: unknown[] }).records;
    const first = records[0];
    if (isRecord(first) && 'value' in first) {
      return { collection: typeof first.collection === 'string' ? first.collection : undefined, value: first.value };
    }
    return { value: first };
  }
  if (isRecord(data.args) && 'value' in data.args) {
    return {
      collection: typeof data.args.collection === 'string' ? data.args.collection : undefined,
      value: data.args.value,
    };
  }
  if ('value' in data && (data.collection || data.id)) {
    return { collection: typeof data.collection === 'string' ? data.collection : undefined, value: data.value };
  }
  return { value: data };
}

export function detectLabRecordKind(data: unknown): LabRecordKind | null {
  if (isRecord(data) && data.kind === 'nctgraphite-document') return 'nctgdoc';
  const { collection, value } = unwrapPayload(data);
  if (collection === 'paintings') return 'paintings';
  if (collection === 'hull_sessions') return 'hull_sessions';
  if (collection === 'presets') return 'presets';
  if (!isRecord(value)) return null;
  if (Array.isArray(value.vectors) && (typeof value.cols === 'number' || typeof value.columns === 'number')) return 'vector-field';
  const active = value.active;
  if (Array.isArray(active) && active.length > 0) {
    const first = active[0];
    if (isRecord(first) && ('q' in first || 'color' in first)) return 'paintings';
    if (typeof first === 'number') return 'hull_sessions';
  }
  if (
    typeof value.shapeType === 'string'
    || typeof value.falloffType === 'string'
    || typeof value.jitterAmount === 'number'
    || (Array.isArray(value.points) && isRecord(value.points[0]) && 'radius' in value.points[0])
  ) {
    return 'presets';
  }
  if (typeof value.hullMode === 'string' || typeof value.cellSize === 'number') return 'hull_sessions';
  if (typeof value.gridType === 'string') {
    if (value.gridType === 'flat' || value.gridType === 'pointy') return 'paintings';
    if (value.gridType in HULL_FROM_LAB) return 'hull_sessions';
  }
  if (typeof value.hexSize === 'number') return 'paintings';
  return null;
}

function documentFromLayer(layer: GridPaintLayer, canvas: NCTGraphiteDocumentCanvas, displayName: string, fileName?: string | null): GridPaintDocument {
  return NCTGraphiteDocument.untitled({
    displayName,
    canvas,
    layers: [layer],
    activeLayerId: layer.id,
  }).markingSaved(fileName ?? null);
}

function importPaintings(value: Record<string, unknown>, canvas: NCTGraphiteDocumentCanvas): GridPaintLayer {
  const kind = HEX_FROM_LAB[String(value.gridType ?? 'flat')] ?? 'hex-flat';
  const cells: PaintedCells = {};
  if (Array.isArray(value.active)) {
    for (const item of value.active) {
      if (!isRecord(item) || typeof item.q !== 'number' || typeof item.r !== 'number') continue;
      const color = typeof item.color === 'string' ? item.color : PALETTE[0];
      cells[`${item.q},${item.r}`] = { color };
    }
  }
  return createCellPaintLayer({
    name: typeof value.name === 'string' ? value.name : 'Hex Paint',
    data: { cells },
    settings: {
      kind,
      size: typeof value.hexSize === 'number' ? value.hexSize : 28,
      columns: typeof value.cols === 'number' ? value.cols : 22,
      rows: typeof value.rows === 'number' ? value.rows : 16,
    },
  });
}

function importHull(value: Record<string, unknown>, canvas: NCTGraphiteDocumentCanvas): GridPaintLayer {
  const kind = HULL_FROM_LAB[String(value.gridType ?? 'hexHoriz')] ?? 'hex-flat';
  const hullMode = (['tight', 'smooth', 'convex', 'concave'] as const).includes(value.hullMode as HullSettings['hullMode'])
    ? value.hullMode as HullSettings['hullMode']
    : 'convex';
  const layer = createHullLayer({
    settings: {
      kind,
      size: typeof value.cellSize === 'number' ? value.cellSize : 14,
      hullMode,
    },
  });
  const lattice = layerLattice(layer, canvas);
  const cells: PaintedCells = {};
  if (Array.isArray(value.active)) {
    for (const item of value.active) {
      if (typeof item === 'number') {
        const cell = lattice[item];
        if (cell) cells[cell.id] = { color: PALETTE[0] };
        continue;
      }
      if (typeof item === 'string') {
        cells[item] = { color: PALETTE[0] };
        continue;
      }
      if (isRecord(item) && typeof item.q === 'number' && typeof item.r === 'number') {
        const id = typeof item.s === 'number' ? `${item.q},${item.r},${item.s}` : `${item.q},${item.r}`;
        cells[id] = { color: PALETTE[0] };
      }
    }
  }
  return { ...layer, data: { cells } };
}

function remapY(y: number, sourceHeight: number, destHeight: number): number {
  if (!sourceHeight || sourceHeight === destHeight) return y;
  return y * (destHeight / sourceHeight);
}

function importVectorField(value: Record<string, unknown>, canvas: NCTGraphiteDocumentCanvas): GridPaintLayer {
  const columns = typeof value.cols === 'number' ? value.cols : Number(value.columns) || 48;
  const rows = typeof value.rows === 'number' ? value.rows : 32;
  const sourceHeight = typeof value.height === 'number' ? value.height : VECTOR_LAB_HEIGHT;
  const vectors = makeVectorField(columns, rows, canvas.width, canvas.height);
  if (Array.isArray(value.vectors)) {
    for (let index = 0; index < Math.min(vectors.length, value.vectors.length); index++) {
      const sample = value.vectors[index];
      if (Array.isArray(sample) && sample.length >= 2) {
        vectors[index].vx = Number(sample[0]) || 0;
        vectors[index].vy = Number(sample[1]) || 0;
      } else if (isRecord(sample)) {
        vectors[index].vx = Number(sample.vx) || 0;
        vectors[index].vy = Number(sample.vy) || 0;
      }
    }
  }
  const attractors = Array.isArray(value.attractors)
    ? value.attractors.filter(isRecord).map((item) => ({
      id: typeof item.id === 'string' ? item.id : createNCTGraphiteLayerId(),
      x: Number(item.x) || 0,
      y: remapY(Number(item.y) || 0, sourceHeight, canvas.height),
      r: Number(item.r) || 90,
      orbit: !!item.orbit,
    }))
    : [];
  return createVectorFieldLayer(canvas, {
    settings: { columns, rows },
    data: { vectors, attractors },
  });
}

function importPresetPoint(item: unknown, sourceHeight: number, destHeight: number): SampleGainPoint | null {
  if (!isRecord(item)) return null;
  const x = Number(item.x);
  const y = Number(item.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y: remapY(y, sourceHeight, destHeight),
    baseX: Number(item.baseX) || x,
    baseY: remapY(Number(item.baseY) || y, sourceHeight, destHeight),
    col: Number(item.col) || 0,
    row: Number(item.row) || 0,
    radius: Number(item.radius) || 1,
    rotation: Number(item.rotation) || 0,
  };
}

function importPresets(value: Record<string, unknown>, canvas: NCTGraphiteDocumentCanvas): GridPaintLayer {
  const columns = typeof value.cols === 'number' ? value.cols : 48;
  const rows = typeof value.rows === 'number' ? value.rows : 32;
  const sourceHeight = typeof value.height === 'number' ? value.height : VECTOR_LAB_HEIGHT;
  const settings = {
    columns,
    rows,
    jitterAmount: typeof value.jitterAmount === 'number' ? value.jitterAmount : 0.65,
    useJitter: value.useJitter !== false,
    seed: typeof value.seed === 'number' ? value.seed : 1,
    maxRadius: typeof value.maxRadius === 'number' ? value.maxRadius : 14,
    minRadius: typeof value.minRadius === 'number' ? value.minRadius : 0.2,
    shapeType: (typeof value.shapeType === 'string' ? value.shapeType : 'Circle') as DotShape,
    colorMode: (typeof value.colorMode === 'string' ? value.colorMode : 'Mono') as DotColorMode,
    fillMode: (typeof value.fillMode === 'string' ? value.fillMode : 'Fill') as DotFillMode,
    rotationMode: typeof value.rotationMode === 'string' ? value.rotationMode as DotShadingLayer['settings']['rotationMode'] : 'Brush Direction',
    rotationJitter: typeof value.rotationJitter === 'number' ? value.rotationJitter : 22,
    brushRadius: typeof value.brushRadius === 'number' ? value.brushRadius : 110,
    intensity: typeof value.intensity === 'number' ? value.intensity : 1.2,
    falloffPower: typeof value.falloffPower === 'number' ? value.falloffPower : 1,
    falloffType: typeof value.falloffType === 'string' ? value.falloffType as DotShadingLayer['settings']['falloffType'] : 'Linear',
  };
  const imported = Array.isArray(value.points)
    ? value.points.map((item) => importPresetPoint(item, sourceHeight, canvas.height)).filter((item): item is SampleGainPoint => !!item)
    : [];
  const points = imported.length
    ? imported
    : makeSampleLattice(columns, rows, canvas.width, canvas.height, {
      jitter: settings.useJitter ? settings.jitterAmount : 0,
      seed: settings.seed,
      radius: 1,
    });
  return createDotShadingLayer(canvas, {
    name: typeof value.name === 'string' ? value.name : 'Dot Shading',
    settings,
    data: { points },
  });
}

export function importLabRecord(data: unknown, fileName?: string | null): GridPaintDocument {
  const kind = detectLabRecordKind(data);
  if (!kind || kind === 'nctgdoc') {
    throw new TypeError('Not a lab record payload');
  }
  const { value } = unwrapPayload(data);
  if (!isRecord(value)) throw new TypeError('Lab record value must be an object');
  const canvas = defaultCanvas();
  if (kind === 'paintings') return documentFromLayer(importPaintings(value, canvas), canvas, typeof value.name === 'string' ? value.name : 'Hex Paint', fileName);
  if (kind === 'hull_sessions') return documentFromLayer(importHull(value, canvas), canvas, 'Hull', fileName);
  if (kind === 'presets') return documentFromLayer(importPresets(value, canvas), canvas, typeof value.name === 'string' ? value.name : 'Dot Shading', fileName);
  return documentFromLayer(importVectorField(value, canvas), canvas, 'Vector Field', fileName);
}

export function openGridPaintFile(text: string, fileName?: string | null): GridPaintDocument {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new TypeError('File is not valid JSON');
  }
  if (detectLabRecordKind(data) === 'nctgdoc') {
    return NCTGraphiteDocument.parse<GridPaintLayer>(text, fileName ?? undefined);
  }
  return importLabRecord(data, fileName);
}

export function exportLabRecord(layer: GridPaintLayer, canvas: NCTGraphiteDocumentCanvas): { kind: Exclude<LabRecordKind, 'nctgdoc'>; value: Record<string, unknown>; fileName: string } | null {
  if (layer.mode === 'cell-paint') {
    const active = Object.entries(layer.data.cells).flatMap(([id, painted]) => {
      const coordinate = parseCellId(id);
      return coordinate ? [{ q: coordinate.q, r: coordinate.r, color: painted.color, group: 0 }] : [];
    });
    return {
      kind: 'paintings',
      fileName: 'painting.json',
      value: {
        name: layer.name,
        gridType: HEX_TO_LAB[layer.settings.kind] ?? 'flat',
        hexSize: layer.settings.size,
        cols: layer.settings.columns,
        rows: layer.settings.rows,
        active,
        totalActive: active.length,
        palette: PALETTE,
        createdAt: Date.now(),
      },
    };
  }
  if (layer.mode === 'hull') {
    const lattice = layerLattice(layer as HullLayer, canvas);
    const indexOf = new Map(lattice.map((cell, index) => [cell.id, index]));
    const active = Object.keys(layer.data.cells).flatMap((id) => {
      const index = indexOf.get(id);
      return index == null ? [] : [index];
    });
    return {
      kind: 'hull_sessions',
      fileName: 'hull-session.json',
      value: {
        gridType: HULL_TO_LAB[layer.settings.kind] ?? 'hexHoriz',
        cellSize: layer.settings.size,
        hullMode: layer.settings.hullMode,
        active,
        createdAt: new Date().toISOString(),
      },
    };
  }
  if (layer.mode === 'dot-shading') {
    const radii = layer.data.points.map((point) => point.radius);
    const avgRadius = radii.length ? radii.reduce((sum, value) => sum + value, 0) / radii.length : 1;
    return {
      kind: 'presets',
      fileName: 'shading-preset.json',
      value: {
        name: layer.name,
        cols: layer.settings.columns,
        rows: layer.settings.rows,
        jitterAmount: layer.settings.jitterAmount,
        useJitter: layer.settings.useJitter,
        seed: layer.settings.seed,
        maxRadius: layer.settings.maxRadius,
        minRadius: layer.settings.minRadius,
        shapeType: layer.settings.shapeType,
        colorMode: layer.settings.colorMode,
        fillMode: layer.settings.fillMode,
        rotationMode: layer.settings.rotationMode,
        rotationJitter: layer.settings.rotationJitter,
        brushRadius: layer.settings.brushRadius,
        intensity: layer.settings.intensity,
        falloffPower: layer.settings.falloffPower,
        falloffType: layer.settings.falloffType,
        avgRadius,
        totalPoints: layer.data.points.length,
        createdAt: Date.now(),
        width: canvas.width,
        height: canvas.height,
        points: layer.data.points,
      },
    };
  }
  if (layer.mode === 'vector-field') {
    return {
      kind: 'vector-field',
      fileName: 'vector-field.json',
      value: {
        cols: layer.settings.columns,
        rows: layer.settings.rows,
        vectors: layer.data.vectors.map((sample) => [sample.vx, sample.vy]),
        attractors: layer.data.attractors,
        width: canvas.width,
        height: canvas.height,
      },
    };
  }
  return null;
}

export async function fetchLabRecords(collection: 'paintings' | 'hull_sessions' | 'presets'): Promise<unknown[]> {
  try {
    const response = await fetch('/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'records.list', args: { collection } }),
    });
    if (!response.ok) return [];
    const json = await response.json() as { data?: { records?: unknown[] } | unknown[] };
    const records = Array.isArray(json.data) ? json.data : json.data?.records;
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}
