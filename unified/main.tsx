import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import paper from 'paper';
import {
  NCTGRAPHITE_DOCUMENT_FILE_EXTENSION,
  NCTGraphiteAppShell,
  NCTParameterPanel,
  fitDocumentToViewport,
  useNCTGraphiteCommands,
  useNCTGraphiteDocument,
  viewportToDocument,
} from '@nct/nctgraphite';
import type { NCTGraphiteViewportTransform } from '@nct/nctgraphite';
import { drawDocument } from './draw';
import {
  adjustBrush,
  CELL_PAINT_COMMANDS,
  clearLayerPaint,
  createInitialDocument,
  cycleLayerColor,
  DOT_COMMANDS,
  HULL_COMMANDS,
  METABALL_COMMANDS,
  PALETTE,
  VECTOR_COMMANDS,
  layerCommands,
  layerModeLabel,
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
import './style.css';

const POINTER_ACTIONS = new Set(['paint', 'erase', 'toggle', 'inflate', 'smooth', 'placeNeg', 'attractor']);
const DISCRETE_POINTER = new Set(['placeNeg', 'attractor']);

function heldPaintAction(held: Set<string>, mode: GridPaintLayer['mode'] | undefined): PaintAction | null {
  if (mode === 'metaball') {
    if (held.has('inflate')) return 'inflate';
    if (held.has('erase')) return 'erase';
    return null;
  }
  if (mode === 'dot-shading' && held.has('clear')) return 'clear';
  if (held.has('paint')) return 'paint';
  if (held.has('erase')) return 'erase';
  if (held.has('toggle')) return 'toggle';
  if (held.has('smooth')) return 'smooth';
  if (held.has('inflate')) return 'inflate';
  return null;
}

function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scope = useRef<paper.PaperScope | null>(null);
  const transform = useRef<NCTGraphiteViewportTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const documentRef = useRef<GridPaintDocument | null>(null);
  const strokeBase = useRef<GridPaintDocument | null>(null);
  const [document, setDocument] = useNCTGraphiteDocument(createInitialDocument);
  documentRef.current = document;
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [pointerLabel, setPointerLabel] = useState('—');
  const [openError, setOpenError] = useState<string | null>(null);

  const active = document.activeLayer;
  const canvasSize = document.snapshot.canvas;

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
    setDocument((doc) => doc.updatingLayer(doc.activeLayerId!, (layer) => paintLayerAt(layer, doc.snapshot.canvas, point, action, extra), { recordUndo }));
  }, [setDocument]);

  const live = !!active?.visible && !active?.locked;
  const hexCommands = useNCTGraphiteCommands({
    commands: CELL_PAINT_COMMANDS,
    enabled: active?.mode === 'cell-paint' && live,
    ignoreInputs: true,
    onAction: (id, event) => handleCommand(id, event),
    onKeyUp: () => commitStroke(),
  });
  const hullCommands = useNCTGraphiteCommands({
    commands: HULL_COMMANDS,
    enabled: active?.mode === 'hull' && live,
    ignoreInputs: true,
    onAction: (id, event) => handleCommand(id, event),
    onKeyUp: () => commitStroke(),
  });
  const metaballCommands = useNCTGraphiteCommands({
    commands: METABALL_COMMANDS,
    enabled: active?.mode === 'metaball' && live,
    ignoreInputs: true,
    onAction: (id, event) => handleCommand(id, event),
    onKeyUp: () => commitStroke(),
  });
  const vectorCommands = useNCTGraphiteCommands({
    commands: VECTOR_COMMANDS,
    enabled: active?.mode === 'vector-field' && live,
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
  const commands = active?.mode === 'hull' ? hullCommands
    : active?.mode === 'metaball' ? metaballCommands
      : active?.mode === 'vector-field' ? vectorCommands
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
    const mode = documentRef.current?.activeLayer?.mode;
    if (POINTER_ACTIONS.has(id) || (id === 'clear' && mode === 'dot-shading')) {
      if (event?.repeat && (DISCRETE_POINTER.has(id) || (mode === 'metaball' && (id === 'paint' || id === 'placeNeg')))) return;
      beginStroke();
      if (point) paintAtPointer(id as PaintAction, false);
      return;
    }
    setDocument((doc) => {
      const layer = doc.activeLayer;
      if (!layer) return doc;
      if (id === 'clear') return doc.updatingLayer(layer.id, clearLayerPaint);
      if (id === 'newColor') return doc.updatingLayer(layer.id, cycleLayerColor);
      if (id === 'reJitter' && layer.mode === 'dot-shading') {
        return doc.updatingLayer(layer.id, (item) => item.mode === 'dot-shading' ? reJitterDotLayer(item, doc.snapshot.canvas) : item);
      }
      if (id === 'brushSmaller') return doc.updatingLayer(layer.id, (item) => adjustBrush(item, -8));
      if (id === 'brushLarger') return doc.updatingLayer(layer.id, (item) => adjustBrush(item, 8));
      if (id === 'showGrid') return doc.updatingLayer(layer.id, (item) => setLayerSetting(item, 'showGrid', !('showGrid' in item.settings && item.settings.showGrid)));
      if (id === 'gridFlat') return doc.updatingLayer(layer.id, (item) => setLayerKind(item, 'hex-flat'));
      if (id === 'gridPointy') return doc.updatingLayer(layer.id, (item) => setLayerKind(item, 'hex-pointy'));
      if (id === 'gridSquare') return doc.updatingLayer(layer.id, (item) => setLayerKind(item, 'square'));
      if (id === 'gridDiamond') return doc.updatingLayer(layer.id, (item) => setLayerKind(item, 'hex-flat-diamond'));
      if (id === 'gridTriHoriz') return doc.updatingLayer(layer.id, (item) => setLayerKind(item, 'tri-horiz'));
      if (id === 'gridTriVert') return doc.updatingLayer(layer.id, (item) => setLayerKind(item, 'tri-vert'));
      if (id === 'hullTight' && layer.mode === 'hull') return doc.updatingLayer(layer.id, (item) => setLayerSetting(item, 'hullMode', 'tight'));
      if (id === 'hullSmooth' && layer.mode === 'hull') return doc.updatingLayer(layer.id, (item) => setLayerSetting(item, 'hullMode', 'smooth'));
      if (id === 'hullConvex' && layer.mode === 'hull') return doc.updatingLayer(layer.id, (item) => setLayerSetting(item, 'hullMode', 'convex'));
      if (id === 'hullConcave' && layer.mode === 'hull') return doc.updatingLayer(layer.id, (item) => setLayerSetting(item, 'hullMode', 'concave'));
      return doc;
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
    const layer = document.activeLayer;
    if (!layer) return;
    const payload = exportLabRecord(layer, document.snapshot.canvas);
    if (!payload) {
      setOpenError('This layer has no lab JSON export');
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
    const resize = () => {
      const bounds = stage.current!.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      p.view.viewSize = new p.Size(bounds.width, bounds.height);
      const next = fitDocumentToViewport(canvasSize, bounds);
      transform.current = next;
      p.view.matrix.set(next.scale, 0, 0, next.scale, next.offsetX, next.offsetY);
      p.view.update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage.current);
    resize();
    return () => { observer.disconnect(); scope.current = null; p.remove(); };
  }, [canvasSize.width, canvasSize.height]);

  useEffect(() => {
    const p = scope.current;
    if (!p) return;
    const layer = document.activeLayer;
    const point = pointer.current;
    const brush = layer && point ? {
      x: point.x, y: point.y, radius: layer.settings.brushRadius,
      color: PALETTE[layer.settings.colorIndex % PALETTE.length],
    } : null;
    const painting = heldPaintAction(held, layer?.mode) != null;
    drawDocument(p, document, brush, painting);
  }, [document, pointerLabel, held]);

  useEffect(() => {
    const action = heldPaintAction(held, active?.mode);
    if (!action || (active?.mode === 'metaball' && DISCRETE_POINTER.has(action))) return;
    const tick = () => paintAtPointer(action, false);
    tick();
    const id = window.setInterval(tick, 32);
    return () => window.clearInterval(id);
  }, [held, paintAtPointer, active?.mode]);

  useEffect(() => () => {
    const base = strokeBase.current;
    strokeBase.current = null;
    if (base) setDocument((doc) => doc.recordingUndoFrom(base));
  }, [document.activeLayerId, setDocument]);

  const parameters = active ? layerParameters(active) : [];
  const values = active ? Object.fromEntries(parameters.map((item) => [item.id, (active.settings as Record<string, number | boolean | string>)[item.id]])) : {};
  const countNoun = active?.mode === 'metaball' ? 'BLOBS'
    : active?.mode === 'vector-field' ? 'VECTORS'
      : active?.mode === 'dot-shading' ? 'DOTS'
        : 'CELLS';

  return <NCTGraphiteAppShell sectionCount={1} gap={0} maxWidth={100000} className="unified-shell" style={{ height: '100dvh', maxWidth: 'none', paddingTop: 0 }}>
    <main ref={stage} data-nct-stage="" tabIndex={-1} className="stage" aria-label="Drawing canvas" onPointerMove={(event) => {
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
      <canvas ref={canvas} className="paper-canvas" aria-label="Grid Paint canvas" />
      <header className="topbar">
        <span className="brand">GRID PAINT <small>LABS</small></span>
        <span className="topbar-label">{document.displayName}{document.edited ? ' •' : ''}</span>
        <div className="file-actions">
          <button type="button" onClick={() => fileInput.current?.click()}>Open</button>
          <button type="button" onClick={saveDocument}>Save</button>
          <button type="button" onClick={exportActiveLabRecord} disabled={!active || active.mode === 'metaball'}>Export lab JSON</button>
          <button type="button" disabled={!document.canUndo} onClick={() => setDocument((doc) => doc.undo())}>Undo</button>
          <button type="button" disabled={!document.canRedo} onClick={() => setDocument((doc) => doc.redo())}>Redo</button>
        </div>
        <input ref={fileInput} type="file" accept=".json,.nctgdoc.json,application/json" hidden aria-label="Open document" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void openDocumentFile(file);
        }} />
        <a href="http://127.0.0.1:8123/">Original labs ↗</a>
      </header>
      <button className="drawer-toggle left-toggle" aria-expanded={leftOpen} aria-controls="layers-drawer" onClick={() => setLeftOpen(!leftOpen)}>☰ <span>Layers</span></button>
      <button className="drawer-toggle right-toggle" aria-expanded={rightOpen} aria-controls="settings-drawer" onClick={() => setRightOpen(!rightOpen)}>◫ <span>Settings</span></button>
      <aside id="layers-drawer" className="drawer left-drawer" hidden={!leftOpen} aria-label="Layers">
        <div className="drawer-title">Layers <span>{String(document.layers.length).padStart(2, '0')}</span></div>
        {openError ? <p className="open-error" role="alert">{openError}</p> : null}
        <ul className="layer-list">
          {[...document.layers].reverse().map((layer) => (
            <li key={layer.id}>
              <button className={`layer-row${layer.id === document.activeLayerId ? ' active' : ''}`} onClick={() => setDocument((doc) => doc.activating(layer.id))}>
                <span className="layer-name">{layer.name}</span>
                <span className="layer-meta">{layerModeLabel(layer)} · {paintedCount(layer)}</span>
              </button>
              <button className="layer-vis" aria-pressed={layer.visible} aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`} onClick={() => setDocument((doc) => doc.updatingLayer(layer.id, (item) => ({ ...item, visible: !item.visible })))}>{layer.visible ? '◉' : '○'}</button>
            </li>
          ))}
        </ul>
      </aside>
      <aside id="settings-drawer" className="drawer right-drawer" hidden={!rightOpen} aria-label="Layer settings">
        <div className="drawer-title">{active?.name ?? 'Layer'} <span>SETTINGS</span></div>
        {active ? <>
          <p className="drawer-caption">KEYS · {layerModeLabel(active)}</p>
          <ol className="key-list">
            {layerCommands(active).map((command) => (
              <li key={command.id} className={held.has(command.id) ? 'held' : undefined}>
                <kbd>{(commands.keyMap[command.id] ?? command.defaultKey).toUpperCase()}</kbd>
                <span>{command.label}</span>
              </li>
            ))}
          </ol>
          <p className="drawer-caption">PARAMETERS</p>
          <NCTParameterPanel definitions={parameters} values={values} onChange={(id, value) => {
            setDocument((doc) => doc.updatingLayer(doc.activeLayerId!, (layer) => setLayerSetting(layer, id, value, doc.snapshot.canvas)));
          }} />
          <div className="swatches" role="list" aria-label="Paint color">
            {PALETTE.map((color, index) => (
              <button key={color} role="listitem" className={index === (active.settings.colorIndex % PALETTE.length) ? 'on' : undefined} style={{ background: color }} aria-label={`Color ${index + 1}`} onClick={() => setDocument((doc) => doc.updatingLayer(doc.activeLayerId!, (layer) => ({ ...layer, settings: { ...layer.settings, colorIndex: index } })))} />
            ))}
          </div>
        </> : <p className="empty-state">Select a layer to edit it.</p>}
        <div className="document-size">Document <strong>{canvasSize.width} × {canvasSize.height}</strong></div>
      </aside>
      <div className="status">
        <span>{active ? `${active.name.toUpperCase()} · ${paintedCount(active)} ${countNoun}` : 'NO LAYER'}</span>
        <span>{pointerLabel}</span>
      </div>
    </main>
  </NCTGraphiteAppShell>;
}

createRoot(document.getElementById('root')!).render(<App />);
