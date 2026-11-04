import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import paper from 'paper';
import {
  NCTGRAPHITE_DOCUMENT_FILE_EXTENSION,
  NCTGraphiteAppShell,
  fitDocumentToViewport,
  useNCTGraphiteCommands,
  useNCTGraphiteDocument,
  viewportToDocument,
} from '@nct/nctgraphite';
import type { NCTGraphiteViewportTransform } from '@nct/nctgraphite';
import { drawBrush, drawDocument, drawWorkspaceGrid } from './draw';
import { vectorShapePath } from './vectorShapes';
import {
  adjustBrush,
  CELL_PAINT_COMMANDS,
  clearLayerPaint,
  createUnifiedDocument,
  createVectorFieldLayer,
  createCellPaintLayer,
  createMetaballLayer,
  createDotShadingLayer,
  cycleLayerColor,
  DOT_COMMANDS,
  METABALL_COMMANDS,
  PALETTE,
  VECTOR_COMMANDS,
  layerCommands,
  layerModeLabel,
  layerContents,
  modeLayer,
  metaballVectorLayer,
  updateModeLayer,
  type BrushMode,
  layerParameters,
  paintLayerAt,
  paintedCount,
  reJitterDotLayer,
  setLayerKind,
  setLayerSetting,
  type GridPaintDocument,
  type GridPaintLayer,
  type PaintAction,
} from './layers';
import { exportLabRecord, openGridPaintFile } from './records';
import { GridIcon, ModeIcon } from './gridIcons';
import './style.css';

const POINTER_ACTIONS = new Set(['paint', 'erase', 'toggle', 'inflate', 'smooth', 'placeNeg', 'attractor', 'bridge', 'subdivide', 'coarsen', 'scaleDown', 'scaleUp']);
const DISCRETE_POINTER = new Set(['placeNeg', 'attractor', 'bridge']);

function heldPaintAction(held: Set<string>, mode: GridPaintLayer['mode'] | undefined): PaintAction | null {
  if (mode === 'metaball') {
    if (held.has('inflate')) return 'inflate';
    if (held.has('erase')) return 'erase';
    if (held.has('smooth')) return 'smooth';
    return null;
  }
  if (mode === 'vector-field') { const op = [...held].find(id => id.startsWith('op:')); if (op) return op as PaintAction; }
  if (mode === 'hull' || mode === 'cell-paint') { for (const id of ['subdivide', 'coarsen', 'scaleDown', 'scaleUp'] as const) if (held.has(id)) return id; }
  if (mode === 'dot-shading' && held.has('clear')) return 'clear';
  if (held.has('paint')) return 'paint';
  if (held.has('erase')) return 'erase';
  if (held.has('toggle')) return 'toggle';
  if (held.has('smooth')) return 'smooth';
  if (held.has('inflate')) return 'inflate';
  return null;
}

function NumberField({ value, min, max, step, label, onCommit }: { value: number; min: number; max: number; step: number; label: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const commit = () => { if (cancelled.current) { cancelled.current = false; setDraft(String(value)); setEditing(false); return; } const parsed = Number(draft); if (draft.trim() && Number.isFinite(parsed)) onCommit(Math.max(min, Math.min(max, parsed))); else setDraft(String(value)); setEditing(false); };
  return <input aria-label={`${label} value`} type="number" min={min} max={max} step={step} value={draft} onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelled.current = true; event.currentTarget.blur(); } }} />;
}

function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scope = useRef<paper.PaperScope | null>(null);
  const transform = useRef<NCTGraphiteViewportTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const pan = useRef<{ id: number; x: number; y: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const documentRef = useRef<GridPaintDocument | null>(null);
  const strokeBase = useRef<GridPaintDocument | null>(null);
  const [document, setDocument] = useNCTGraphiteDocument(createUnifiedDocument);
  documentRef.current = document;
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [pointerLabel, setPointerLabel] = useState('—');
  const [dragLayer, setDragLayer] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<BrushMode>('cell-paint');

  const selectedLayer = document.activeLayer;
  const canvasSize = document.snapshot.canvas;
  const active = selectedLayer ? modeLayer(selectedLayer, mode, canvasSize) : null;
  const commandMode = active?.mode === 'metaball' && active.settings.engine === 'vector' ? 'vector-field' : active?.mode;

  function updatePart(doc: GridPaintDocument, update: (layer: GridPaintLayer) => GridPaintLayer, recordUndo = true) {
    return doc.activeLayerId ? doc.updatingLayer(doc.activeLayerId, layer => updateModeLayer(layer, mode, doc.snapshot.canvas, update), { recordUndo }) : doc;
  }

  const paintAtPointer = useCallback((action: PaintAction, recordUndo: boolean) => {
    const current = documentRef.current;
    const point = pointer.current;
    if (!current || !point || !current.activeLayer) return;
    const previous = lastPointer.current;
    const extra = previous
      ? {
        velocityX: point.x - previous.x,
        velocityY: point.y - previous.y,
        brushAngle: Math.atan2(point.y - previous.y, point.x - previous.x),
      }
      : { velocityX: 0, velocityY: 0 };
    lastPointer.current = point;
    setDocument((doc) => updatePart(doc, layer => paintLayerAt(layer, doc.snapshot.canvas, point, action, extra), recordUndo));
  }, [setDocument, mode]);

  const live = !!active?.visible && !active?.locked;
  const hexCommands = useNCTGraphiteCommands({
    commands: CELL_PAINT_COMMANDS,
    enabled: active?.mode === 'cell-paint' && live,
    ignoreInputs: true,
    onAction: (id, event) => handleCommand(id, event),
    onKeyUp: () => commitStroke(),
  });
  const metaballCommands = useNCTGraphiteCommands({
    commands: METABALL_COMMANDS,
    enabled: commandMode === 'metaball' && live,
    ignoreInputs: true,
    onAction: (id, event) => handleCommand(id, event),
    onKeyUp: () => commitStroke(),
  });
  const vectorCommands = useNCTGraphiteCommands({
    commands: VECTOR_COMMANDS,
    enabled: commandMode === 'vector-field' && live,
    ignoreInputs: true,
    onAction: (id, event) => handleCommand(id, event),
    onKeyUp: () => commitStroke(),
  });
  const dotCommands = useNCTGraphiteCommands({
    commands: DOT_COMMANDS,
    enabled: active?.mode === 'dot-shading' && live,
    ignoreInputs: true,
    onAction: (id, event) => handleCommand(id, event),
    onKeyUp: () => commitStroke(),
  });
  const commands = commandMode === 'metaball' ? metaballCommands
      : commandMode === 'vector-field' ? vectorCommands
        : active?.mode === 'dot-shading' ? dotCommands
          : hexCommands;
  const held = commands.heldActions;

  function commitStroke() {
    const base = strokeBase.current;
    strokeBase.current = null;
    if (!base) return;
    setDocument((doc) => doc.recordingUndoFrom(base));
  }

  function beginStroke() {
    if (!strokeBase.current && documentRef.current) strokeBase.current = documentRef.current;
  }

  function handleCommand(id: string, event?: KeyboardEvent) {
    const point = pointer.current;
    if (POINTER_ACTIONS.has(id) || (commandMode === 'vector-field' && id.startsWith('op:')) || (id === 'clear' && mode === 'dot-shading')) {
      if (event?.repeat && (DISCRETE_POINTER.has(id) || (commandMode === 'metaball' && (id === 'paint' || id === 'placeNeg')))) return;
      beginStroke();
      if (point) paintAtPointer(id as PaintAction, false);
      return;
    }
    setDocument((doc) => {
      const layer = doc.activeLayer ? modeLayer(doc.activeLayer, mode, doc.snapshot.canvas) : null;
      if (!layer) return doc;
      if (id === 'clear') return updatePart(doc, item => item.mode === 'metaball' && item.settings.engine !== 'vector' && !event?.shiftKey ? { ...item, data: { ...item.data, blobs: item.data.blobs.filter(blob => blob.colorGroup !== item.settings.colorIndex) } } : clearLayerPaint(item));
      if (id === 'newColor') return updatePart(doc, cycleLayerColor);
      if (id === 'reJitter' && layer.mode === 'dot-shading') {
        return updatePart(doc, (item) => item.mode === 'dot-shading' ? reJitterDotLayer(item, doc.snapshot.canvas) : item);
      }
      if ((id === 'intensityDown' || id === 'intensityUp') && layer.mode === 'dot-shading') return updatePart(doc, item => item.mode === 'dot-shading' ? setLayerSetting(item, 'intensity', Math.max(0.1, Math.min(3, Math.round((item.settings.intensity + (id === 'intensityUp' ? 0.1 : -0.1)) * 10) / 10))) : item);
      if (id === 'brushSmaller') return updatePart(doc, (item) => adjustBrush(item, -8));
      if (id === 'brushLarger') return updatePart(doc, (item) => adjustBrush(item, 8));
      if (id === 'showGrid') return updatePart(doc, (item) => setLayerSetting(item, 'showGrid', !('showGrid' in item.settings && item.settings.showGrid)));
      if (id === 'gridFlat') return updatePart(doc, (item) => setLayerKind(item, 'hex-flat'));
      if (id === 'gridPointy') return updatePart(doc, (item) => setLayerKind(item, 'hex-pointy'));
      if (id === 'gridSquare') return updatePart(doc, (item) => setLayerKind(item, 'square'));
      if (id === 'gridDiamond') return updatePart(doc, (item) => setLayerKind(item, 'hex-flat-diamond'));
      if (id === 'gridTriHoriz') return updatePart(doc, (item) => setLayerKind(item, 'tri-horiz'));
      if (id === 'gridTriVert') return updatePart(doc, (item) => setLayerKind(item, 'tri-vert'));
      return doc;
    });
  }

  function exportArtwork(format: 'svg' | 'png') {
    const { width, height } = document.snapshot.canvas;
    const surface = window.document.createElement('canvas');
    surface.width = width; surface.height = height;
    const exportScope = new paper.PaperScope();
    exportScope.setup(surface);
    drawDocument(exportScope, document, null, false, true);
    const download = (url: string, revoke: boolean) => {
      const link = window.document.createElement('a'); link.href = url; link.download = `grid-paint.${format}`; link.click();
      if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (format === 'svg') {
      const svg = exportScope.project.exportSVG({ asString: false }) as SVGElement;
      svg.setAttribute('width', `${width / 20}in`);
      svg.setAttribute('height', `${height / 20}in`);
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      download(URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })), true);
    } else download(surface.toDataURL('image/png'), false);
    exportScope.remove();
  }

  function exportShapes() {
    const { width, height } = document.snapshot.canvas;
    const paths = document.visibleLayers.flatMap(layerContents).filter((layer) => layer.mode === 'vector-field' || (layer.mode === 'metaball' && layer.settings.engine === 'vector')).map((part) => {
      const layer = part.mode === 'metaball' ? metaballVectorLayer(part, document.snapshot.canvas) : part;
      if (layer.mode !== 'vector-field') return '';
      const d = vectorShapePath(layer, width, height);
      return d ? `<path d="${d}" fill="${PALETTE[layer.settings.colorIndex % PALETTE.length]}" fill-rule="evenodd" opacity="${layer.opacity ?? 1}"/>` : '';
    }).join('');
    const url = URL.createObjectURL(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paths}</svg>`], { type: 'image/svg+xml' }));
    const link = window.document.createElement('a'); link.href = url; link.download = 'vector-shapes.svg'; link.click(); URL.revokeObjectURL(url);
  }

  function moveVector(dx: number, dy: number) {
    setDocument(doc => updatePart(doc, layer => layer.mode !== 'vector-field' ? layer : ({ ...layer, data: { vectors: layer.data.vectors.map(v => ({ ...v, x: v.x + dx, y: v.y + dy })), attractors: layer.data.attractors.map(a => ({ ...a, x: a.x + dx, y: a.y + dy })) } })));
  }

  function duplicateLayer() {
    setDocument(doc => {
      if (!doc.activeLayer) return doc;
      const copy = structuredClone(doc.activeLayer);
      const id = createCellPaintLayer().id;
      copy.id = id;
      copy.name += ' copy';
      if (copy.modeContents) for (const part of Object.values(copy.modeContents)) if (part) part.id = `${id}:${part.mode}`;
      return doc.insertingLayer(copy);
    });
  }

  function saveDocument() {
    const name = document.fileName ?? `grid-paint.${NCTGRAPHITE_DOCUMENT_FILE_EXTENSION}`;
    const blob = new Blob([document.toJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = name.endsWith('.json') ? name : `${name}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDocument((doc) => doc.markingSaved(name));
  }

  async function openDocumentFile(file: File) {
    try {
      const text = await file.text();
      const next = openGridPaintFile(text, file.name);
      setDocument(() => next);
      setOpenError(null);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'Could not open document');
    }
  }

  function exportActiveLabRecord() {
    const layer = active;
    if (!layer) return;
    const payload = exportLabRecord(layer, document.snapshot.canvas);
    if (!payload) {
      setOpenError(layer.mode === 'cell-paint' || layer.mode === 'hull' ? 'Adaptive cells require Save: lab JSON cannot represent subdivision or cell scale.' : 'This layer has no lab JSON export');
      return;
    }
    const blob = new Blob([`${JSON.stringify(payload.value, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = payload.fileName;
    link.click();
    URL.revokeObjectURL(url);
    setOpenError(null);
  }

  useEffect(() => {
    if (!canvas.current || !stage.current) return;
    const p = new paper.PaperScope();
    p.setup(canvas.current);
    scope.current = p;
    let previousSize: { width: number; height: number } | null = null;
    const resize = () => {
      const bounds = stage.current!.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      p.view.viewSize = new p.Size(bounds.width, bounds.height);
      const next = previousSize ? {
        ...transform.current,
        offsetX: transform.current.offsetX + (bounds.width - previousSize.width) / 2,
        offsetY: transform.current.offsetY + (bounds.height - previousSize.height) / 2,
      } : fitDocumentToViewport(canvasSize, { width: bounds.width * 0.9, height: bounds.height * 0.9 });
      if (!previousSize) { next.offsetX += bounds.width * 0.05; next.offsetY += bounds.height * 0.05; }
      previousSize = { width: bounds.width, height: bounds.height };
      transform.current = next;
      setZoom(next.scale);
      p.view.matrix.set(next.scale, 0, 0, next.scale, next.offsetX, next.offsetY);
      drawWorkspaceGrid(p);
      p.view.update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage.current);
    resize();
    return () => { observer.disconnect(); scope.current = null; p.remove(); };
  }, [canvasSize.width, canvasSize.height]);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = scope.current;
      if (!p || !Number.isFinite(event.deltaY) || !event.deltaY) return;
      const rect = surface.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const current = transform.current;
      const factor = Math.min(1.3, Math.max(1 / 1.3, Math.exp(-event.deltaY * 0.002)));
      const scale = Math.min(16, Math.max(0.1, current.scale * factor));
      const ratio = scale / current.scale;
      const next = { scale, offsetX: x - (x - current.offsetX) * ratio, offsetY: y - (y - current.offsetY) * ratio };
      transform.current = next;
      setZoom(scale);
      p.view.matrix.set(scale, 0, 0, scale, next.offsetX, next.offsetY);
      drawWorkspaceGrid(p);
      p.view.update();
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, []);

  const setCenteredZoom = (requested: number) => {
    const p = scope.current;
    const bounds = stage.current?.getBoundingClientRect();
    if (!p || !bounds || !Number.isFinite(requested)) return;
    const current = transform.current;
    const scale = Math.min(16, Math.max(0.1, requested));
    const ratio = scale / current.scale;
    const x = bounds.width / 2, y = bounds.height / 2;
    const next = { scale, offsetX: x - (x - current.offsetX) * ratio, offsetY: y - (y - current.offsetY) * ratio };
    transform.current = next;
    setZoom(scale);
    p.view.matrix.set(scale, 0, 0, scale, next.offsetX, next.offsetY);
    drawWorkspaceGrid(p);
    p.view.update();
  };

  useEffect(() => {
    const p = scope.current;
    if (!p) return;
    const layer = active;
    const point = pointer.current;
    const brush = layer && point ? {
      x: point.x, y: point.y, radius: layer.settings.brushRadius,
      color: PALETTE[layer.settings.colorIndex % PALETTE.length],
    } : null;
    const painting = heldPaintAction(held, commandMode) != null;
    drawDocument(p, document, brush, painting, false, mode);
  }, [document, held, mode, commandMode === 'vector-field' ? pointerLabel : null]);

  useEffect(() => {
    const p = scope.current;
    if (!p) return;
    const layer = active, point = pointer.current;
    drawBrush(p, layer && point ? { x: point.x, y: point.y, radius: layer.settings.brushRadius, color: PALETTE[layer.settings.colorIndex % PALETTE.length] } : null);
  }, [document, pointerLabel, mode]);

  useEffect(() => {
    const action = heldPaintAction(held, commandMode);
    if (!action || (commandMode === 'metaball' && (DISCRETE_POINTER.has(action) || action === 'paint'))) return;
    const tick = () => paintAtPointer(action, false);
    tick();
    const id = window.setInterval(tick, 32);
    return () => window.clearInterval(id);
  }, [held, paintAtPointer, commandMode]);

  useEffect(() => () => {
    const base = strokeBase.current;
    strokeBase.current = null;
    if (base) setDocument((doc) => doc.recordingUndoFrom(base));
  }, [document.activeLayerId, setDocument]);

  const modeParameters = active ? layerParameters(active) : [];
  const gridParameter = modeParameters.find(item => item.id === 'kind' || item.id === 'gridKind' || item.id === 'vector:gridKind');
  const parameters = modeParameters.filter(item => item !== gridParameter);
  const parameterValue = (id: string) => active?.mode === 'metaball' && id.startsWith('vector:') ? (metaballVectorLayer(active, canvasSize).settings as Record<string, number | boolean | string>)[id.slice(7)] : (active?.settings as Record<string, number | boolean | string> | undefined)?.[id];
  const values = active ? Object.fromEntries(parameters.map(item => [item.id, parameterValue(item.id) ?? item.defaultValue])) : {};
  const parameterSection = (id: string) => {
    if (['mode', 'engine', 'stampShape', 'kind', 'shapeType'].includes(id)) return 'MODE & GEOMETRY';
    if (['columns', 'rows', 'gridResolution', 'size'].includes(id)) return 'GRID';
    if (id.startsWith('subdivide')) return 'ADAPTIVE GRID';
    if (['brushRadius', 'strength', 'intensity', 'falloff', 'falloffType', 'falloffPower'].includes(id)) return 'BRUSH';
    if (id === 'hullMode') return 'HULL';
    if (['shapeMode', 'shapeThreshold', 'shapeThickness', 'shapeMerge'].includes(id)) return 'SHAPE';
    if (id.startsWith('show') || id === 'hoverThin') return 'DISPLAY';
    return 'OPTIONS';
  };
  const countNoun = active?.mode === 'metaball' ? (active.settings.engine === 'vector' ? 'VECTORS' : 'BLOBS')
    : active?.mode === 'vector-field' ? 'VECTORS'
      : active?.mode === 'dot-shading' ? 'DOTS'
        : 'CELLS';

  return <NCTGraphiteAppShell sectionCount={1} gap={0} maxWidth={100000} className="unified-shell" style={{ height: '100dvh', maxWidth: 'none', paddingTop: 0 }}>
    <main ref={stage} data-nct-stage="" tabIndex={-1} className="stage" aria-label="Drawing canvas" onPointerMove={(event) => {
      if (pan.current?.id === event.pointerId) {
        const p = scope.current;
        const current = transform.current;
        const next = { ...current, offsetX: current.offsetX + event.clientX - pan.current.x, offsetY: current.offsetY + event.clientY - pan.current.y };
        pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        transform.current = next;
        if (p) { p.view.matrix.set(next.scale, 0, 0, next.scale, next.offsetX, next.offsetY); drawWorkspaceGrid(p); p.view.update(); }
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const next = viewportToDocument({ x: event.clientX - rect.left, y: event.clientY - rect.top }, transform.current);
      const inside = next.x >= 0 && next.y >= 0 && next.x <= canvasSize.width && next.y <= canvasSize.height;
      if (inside) {
        if (pointer.current) lastPointer.current = pointer.current;
        pointer.current = next;
      } else {
        pointer.current = null;
      }
      setPointerLabel(inside ? `${Math.round(next.x)}, ${Math.round(next.y)}` : '—');
    }} onPointerLeave={() => { pointer.current = null; lastPointer.current = null; setPointerLabel('—'); }}>
      <canvas ref={canvas} className="paper-canvas" aria-label="Grid Paint canvas" onPointerDown={event => {
        if (event.button !== 0) return;
        pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        pointer.current = null;
        lastPointer.current = null;
        setPointerLabel('—');
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.style.cursor = 'grabbing';
      }} onPointerUp={event => {
        if (pan.current?.id !== event.pointerId) return;
        pan.current = null;
        event.currentTarget.style.cursor = '';
      }} onPointerCancel={event => {
        if (pan.current?.id !== event.pointerId) return;
        pan.current = null;
        event.currentTarget.style.cursor = '';
      }} />
      <header className="topbar">
        <span className="brand">GRID PAINT <small>LABS</small></span>
        <span className="topbar-label">{document.displayName}{document.edited ? ' •' : ''}</span>
        <div className="mode-control" role="group" aria-label="Brush mode">{([['cell-paint', 'Cells'], ['metaball', 'Metaballs'], ['vector-field', 'Vectors'], ['dot-shading', 'Dots']] as [BrushMode, string][]).map(([id, label]) => <button type="button" key={id} aria-pressed={mode === id} onClick={() => { commitStroke(); setMode(id); }}><ModeIcon value={id} /><span>{label}</span></button>)}</div>
        <div className="zoom-control">
          <label htmlFor="zoom-slider">Zoom</label>
          <input id="zoom-slider" type="range" min={Math.log(0.1)} max={Math.log(16)} step="any" value={Math.log(zoom)} onChange={event => setCenteredZoom(Math.exp(Number(event.target.value)))} />
          <NumberField label="Zoom percentage" value={Math.round(zoom * 100)} min={10} max={1600} step={1} onCommit={value => setCenteredZoom(value / 100)} />
          <span aria-hidden="true">%</span>
        </div>
        <div className="engine-description" aria-live="polite">
          {!active ? <>Select a layer to start painting.</> : active.mode === 'metaball' ? (active.settings.engine === 'vector' ? <><strong>Vector field</strong> · Paint vectors to shape a contour. Blobs remain in Field and Arc.</> : active.settings.engine === 'arc' ? <><strong>Arc</strong> · Connect circular stamps with curved bridges. Shares blobs with Field.</> : <><strong>Field</strong> · Blend stamps into a sampled contour. Shares blobs with Arc.</>) : active.mode === 'vector-field' ? <><strong>Vectors</strong> · Paint and reshape a flow field; turn it into filled contours.</> : active.mode === 'dot-shading' ? <><strong>Dots</strong> · Paint dot size and density to create shading patterns.</> : <><strong>Cells</strong> · Paint grid cells, subdivide them, and outline them with a hull.</>}
        </div>
        <input ref={fileInput} type="file" accept=".json,.nctgdoc.json,application/json" hidden aria-label="Open document" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void openDocumentFile(file);
        }} />
        <div className="header-grid-control" role="group" aria-label={`${active ? layerModeLabel(active) : 'Brush'} grid type`}>
          <span>Grid</span>
          {gridParameter?.type === 'select' ? gridParameter.options.map(option => <button key={option.value} type="button" aria-pressed={String(parameterValue(gridParameter.id) ?? gridParameter.defaultValue) === option.value} title={option.label} aria-label={option.label} onClick={() => setDocument(doc => updatePart(doc, layer => setLayerSetting(layer, gridParameter.id, option.value, doc.snapshot.canvas)))}><GridIcon value={option.value} /><span>{option.label}</span></button>) : <button type="button" aria-pressed="true" disabled><GridIcon value="square" /><span>Square</span></button>}
        </div>
        <select className="file-menu" aria-label="File and history actions" value="" onChange={event => {
          switch (event.target.value) {
            case 'open': fileInput.current?.click(); break;
            case 'save': saveDocument(); break;
            case 'svg': exportArtwork('svg'); break;
            case 'png': exportArtwork('png'); break;
            case 'shapes': exportShapes(); break;
            case 'lab': exportActiveLabRecord(); break;
            case 'undo': setDocument(doc => doc.undo()); break;
            case 'redo': setDocument(doc => doc.redo()); break;
          }
        }}>
          <option value="">File &amp; edit…</option>
          <option value="open">Open</option><option value="save">Save</option>
          <option value="svg">SVG</option><option value="png">PNG</option><option value="shapes">Shapes SVG</option>
          <option value="lab" disabled={!active || active.mode === 'metaball'}>Export lab JSON</option>
          <option value="undo" disabled={!document.canUndo}>Undo</option><option value="redo" disabled={!document.canRedo}>Redo</option>
        </select>
        <a href="http://127.0.0.1:8123/">Original labs ↗</a>
      </header>
      <button className="drawer-toggle left-toggle" aria-expanded={leftOpen} aria-controls="layers-drawer" onClick={() => setLeftOpen(!leftOpen)}>☰ <span>Layers</span></button>
      <button className="drawer-toggle right-toggle" aria-expanded={rightOpen} aria-controls="settings-drawer" onClick={() => setRightOpen(!rightOpen)}>◫ <span>Settings</span></button>
      <aside id="layers-drawer" className="drawer left-drawer" hidden={!leftOpen} aria-label="Layers">
        <div className="drawer-title">Layers <span>{String(document.layers.length).padStart(2, '0')}</span></div>
        <button type="button" className="add-layer" onClick={() => setDocument(doc => doc.insertingLayer(createCellPaintLayer({ name: `Layer ${doc.layers.length + 1}` })))}>＋ Add layer</button>
        {openError ? <p className="open-error" role="alert">{openError}</p> : null}
        {active && <section className="keyboard-section">
          <p className="drawer-caption">KEYBOARD · {layerModeLabel(active)}</p>
          <ol className="key-list">{layerCommands(active).map(command => <li key={command.id} className={held.has(command.id) ? 'held' : undefined} title={command.desc}><button type="button" className="key-bind" title={`Rebind ${command.label}`} aria-label={`Rebind ${command.label}`} onClick={() => commands.beginRebind(commands.rebinding === command.id ? null : command.id)}>{commands.rebinding === command.id ? '…' : (commands.keyMap[command.id] ?? command.defaultKey).toUpperCase()}</button><span>{command.label}</span></li>)}</ol>
        </section>}
        <p className="drawer-caption">LAYERS · DRAG TO REORDER</p>
        <div className="layer-toolbar">
          <button title="Move layer up" aria-label="Move layer up" disabled={!active || document.layers.indexOf(selectedLayer!) === document.layers.length - 1} onClick={() => setDocument(doc => doc.activeLayer ? doc.movingLayer(doc.activeLayer.id, doc.layers.indexOf(doc.activeLayer) + 1) : doc)}>↑</button>
          <button title="Move layer down" aria-label="Move layer down" disabled={!active || document.layers.indexOf(selectedLayer!) === 0} onClick={() => setDocument(doc => doc.activeLayer ? doc.movingLayer(doc.activeLayer.id, doc.layers.indexOf(doc.activeLayer) - 1) : doc)}>↓</button>
        </div>
        <ul className="layer-list">
          {[...document.layers].reverse().map((layer) => (
            <li key={layer.id} draggable onDragStart={() => setDragLayer(layer.id)} onDragEnd={() => setDragLayer(null)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragLayer && dragLayer !== layer.id) setDocument(doc => doc.movingLayer(dragLayer, doc.layers.findIndex(item => item.id === layer.id))); setDragLayer(null); }}>
              <button className={`layer-row${layer.id === document.activeLayerId ? ' active' : ''}`} onClick={() => setDocument((doc) => doc.activating(layer.id))}>
                <span className="layer-name">{layer.name}</span>
                <span className="layer-meta">{layerContents(layer).reduce((count, part) => count + paintedCount(part), 0)} marks</span>
              </button>
              <button className="layer-vis" aria-pressed={layer.visible} aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`} onClick={() => setDocument((doc) => doc.updatingLayer(layer.id, (item) => ({ ...item, visible: !item.visible })))}>{layer.visible ? '◉' : '○'}</button>
            </li>
          ))}
        </ul>
      </aside>
      <aside id="settings-drawer" className="drawer right-drawer" hidden={!rightOpen} aria-label="Layer settings">
        <div className="drawer-title">{active ? layerModeLabel(active) : 'Brush'} <span>SETTINGS</span></div>
        {active ? <>
          <div>
            <button type="button" onClick={duplicateLayer}>Duplicate layer</button>
            <button type="button" onClick={() => setDocument(doc => doc.activeLayerId ? doc.removingLayer(doc.activeLayerId) : doc)}>Delete layer</button>
            {active.mode === 'vector-field' &&
            <div>Move: <button onClick={() => moveVector(-10, 0)}>←</button><button onClick={() => moveVector(10, 0)}>→</button><button onClick={() => moveVector(0, -10)}>↑</button><button onClick={() => moveVector(0, 10)}>↓</button></div>
            }
          </div>
          <p className="drawer-caption">PARAMETERS</p>
          <div className="nct-parameters">{parameters.map((item, index) => <React.Fragment key={item.id}>{(index === 0 || parameterSection(item.id) !== parameterSection(parameters[index - 1].id)) && <div className="parameter-section">{parameterSection(item.id)}</div>}<div className="parameter-widget">
            <label htmlFor={`parameter-${item.id}`}>{item.label}</label>
            {item.type === 'number' ? <div className="parameter-range"><input id={`parameter-${item.id}`} type="range" min={item.min} max={item.max} step={item.step} value={Number(values[item.id])} onChange={event => setDocument(doc => updatePart(doc, layer => setLayerSetting(layer, item.id, Number(event.target.value), doc.snapshot.canvas)))} /><NumberField label={item.label} value={Number(values[item.id])} min={item.min} max={item.max} step={item.step} onCommit={next => setDocument(doc => updatePart(doc, layer => setLayerSetting(layer, item.id, next, doc.snapshot.canvas)))} /></div> : item.type === 'boolean' ? <input id={`parameter-${item.id}`} type="checkbox" checked={Boolean(values[item.id])} onChange={event => setDocument(doc => updatePart(doc, layer => setLayerSetting(layer, item.id, event.target.checked, doc.snapshot.canvas)))} /> : item.options.length <= 4 ? <div className="parameter-segments" role="group" aria-label={item.label}>{item.options.map(option => <button type="button" key={option.value} aria-pressed={values[item.id] === option.value} onClick={() => setDocument(doc => updatePart(doc, layer => setLayerSetting(layer, item.id, option.value, doc.snapshot.canvas)))}>{option.label}</button>)}</div> : <select id={`parameter-${item.id}`} value={String(values[item.id])} onChange={event => { const value = event.target.value; setDocument(doc => updatePart(doc, layer => setLayerSetting(layer, item.id, value, doc.snapshot.canvas))); }}>{item.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
          </div></React.Fragment>)}</div>
          <div className="swatches" role="list" aria-label="Paint color">
            {PALETTE.map((color, index) => (
              <button key={color} role="listitem" className={index === (active.settings.colorIndex % PALETTE.length) ? 'on' : undefined} style={{ background: color }} aria-label={`Color ${index + 1}`} onClick={() => setDocument((doc) => updatePart(doc, (layer) => ({ ...layer, settings: { ...layer.settings, colorIndex: index } })))} />
            ))}
          </div>
        </> : <p className="empty-state">Select a layer to edit it.</p>}
        <div className="document-size">Document <strong>{canvasSize.width / 20}″ × {canvasSize.height / 20}″</strong></div>
      </aside>
      <div className="status">
        <span>{active ? `${selectedLayer?.name.toUpperCase()} · ${paintedCount(active)} ${countNoun}` : 'NO LAYER'}</span>
        <span>{pointerLabel}</span>
      </div>
    </main>
  </NCTGraphiteAppShell>;
}

createRoot(document.getElementById('root')!).render(<App />);
