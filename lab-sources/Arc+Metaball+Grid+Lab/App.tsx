import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NCTGraphiteSlider, NCTGraphiteStack, NCTGraphiteGrid,
  NCTGraphiteAppShell, NCTGraphiteStagePanel, NCTGraphiteStageMain,
  NCTGraphiteStageFooter, NCTGraphiteToggle, NCTGraphiteSegmented,
  NCTGraphiteKeyMap, NCTGraphiteToast, NCTGraphiteHint, useNCTGraphiteCommands,
  roundRectStamp, satoNeck,
} from "@nct/nctgraphite";
import type { NCTGraphiteCommandDef } from "@nct/nctgraphite";
import {
  contourLayersForBlobs, gooToThreshold, BRUSH_NOISE_PRESETS, brushNoisePreset, noisyStampCenters,
} from "./metaballField";

export { roundRectStamp, satoNeck };
export type { StampCenter, RoundRectStamp, SatoNeck } from "@nct/nctgraphite";

type BlobType = "positive" | "negative" | "sticky";
type PlaceMode = "positive" | "negative" | "sticky";
type StampShape = "circle" | "roundrect";
type Vec = { x: number; y: number };
type Blob = { id: number; x: number; y: number; r: number; type: BlobType; colorGroup: number; color: string };

const CANVAS_W = 900;
const CANVAS_H = 660;

const PALETTE = ["#7c5cff", "#ff7a7a", "#4dd0ff", "#a8ff7a", "#ffd76a", "#ff8ad8", "#7afcff", "#ff9f66"];

const ARC_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: "place", label: "Place +blob", desc: "Stamp a blob (sticky/positive per mode)", defaultKey: "f" },
  { id: "inflate", label: "Inflate", desc: "Grow blobs under the brush", defaultKey: "g" },
  { id: "placeNeg", label: "Place -hole", desc: "Stamp a negative hole", defaultKey: "h" },
  { id: "bridge", label: "Bridge", desc: "Neck blob between nearest pair", defaultKey: "b" },
  { id: "erase", label: "Erase", desc: "Remove blobs under the brush", defaultKey: "e" },
  { id: "smooth", label: "Smooth", desc: "Relax blobs under the brush toward the grid", defaultKey: "q" },
  { id: "newColor", label: "New Color", desc: "Cycle color group", defaultKey: "n" },
  { id: "smaller", label: "Brush -", desc: "Shrink brush", defaultKey: "[" },
  { id: "larger", label: "Brush +", desc: "Grow brush", defaultKey: "]" },
  { id: "clear", label: "Clear / All", desc: "Clear group; Shift+X clears all", defaultKey: "x" },
];

const HOLD_IDS = new Set(["inflate", "erase", "smooth", "smaller", "larger"]);
const ONCE_IDS = new Set(["place", "placeNeg", "bridge", "newColor", "clear"]);

const PLACE_MODES: { value: PlaceMode; label: string }[] = [
  { value: "positive", label: "+BLOB" },
  { value: "negative", label: "-HOLE" },
  { value: "sticky", label: "STICKY" },
];

const STAMP_SHAPES: { value: StampShape; label: string }[] = [
  { value: "circle", label: "CIRCLE" },
  { value: "roundrect", label: "ROUND RECT" },
];

const ENGINE_MODES: { value: "contour" | "arc"; label: string }[] = [
  { value: "contour", label: "FIELD" },
  { value: "arc", label: "ARC" },
];

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function connectedComponents(items: Blob[], handleSize: number, goo: number, kFactor: number): Blob[][] {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const p = parent.get(id) ?? id;
    if (p !== id) {
      const r = find(p);
      parent.set(id, r);
      return r;
    }
    return p;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const b of items) parent.set(b.id, b.id);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.colorGroup !== b.colorGroup) continue;
      if (satoNeck(a.r, b.r, a, b, handleSize, goo, kFactor)) unite(a.id, b.id);
    }
  }
  const groups = new Map<number, Blob[]>();
  for (const b of items) {
    const r = find(b.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(b);
  }
  return [...groups.values()];
}

function componentsOf(blobs: Blob[], handleSize: number, goo: number, kFactor: number): Blob[][] {
  return connectedComponents(blobs.filter((b) => b.type !== "negative"), handleSize, goo, kFactor);
}

function necksOf(groups: Blob[][], handleSize: number, goo: number, kFactor: number): SatoNeck[][] {
  return groups.map((g) => {
    const out: SatoNeck[] = [];
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        if (a.colorGroup !== b.colorGroup) continue;
        const n = satoNeck(a.r, b.r, a, b, handleSize, goo, kFactor);
        if (n) out.push({ ...n, a: i, b: j });
      }
    }
    return out;
  });
}

let nextId = 1;

export default function App() {
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [gridRes, setGridRes] = useState(48);
  const rows = Math.round(gridRes * 0.75);
  const [kFactor, setKFactor] = useState(2.5);
  const [handleSize, setHandleSize] = useState(2.4);
  const [goo, setGoo] = useState(0.8);
  const [adherence, setAdherence] = useState(0.6);
  const [snap, setSnap] = useState(true);
  const [showInfluence, setShowInfluence] = useState(false);
  const [heatmap, setHeatmap] = useState(false);
  const [bridgePreview, setBridgePreview] = useState(true);
  const [showConstruction, setShowConstruction] = useState(false);
  const [fieldContour, setFieldContour] = useState(true);
  const [smoothBezier, setSmoothBezier] = useState(true);
  const [brushNoise, setBrushNoise] = useState(false);
  const [noisePresetId, setNoisePresetId] = useState("medium");
  const [brushR, setBrushR] = useState(80);
  const [stampShape, setStampShape] = useState<StampShape>("circle");
  const [rectAspect, setRectAspect] = useState(1.7);
  const [cornerT, setCornerT] = useState(0.55);
  const [placeMode, setPlaceMode] = useState<PlaceMode>("sticky");
  const [colorIdx, setColorIdx] = useState(0);
  const [cursor, setCursor] = useState({ x: CANVAS_W / 2, y: CANVAS_H / 2 });
  const [toast, setToast] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const blobsRef = useRef(blobs);
  useEffect(() => { blobsRef.current = blobs; }, [blobs]);
  const cursorRef = useRef(cursor);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const brushRRef = useRef(brushR);
  useEffect(() => { brushRRef.current = brushR; }, [brushR]);
  const placeModeRef = useRef(placeMode);
  useEffect(() => { placeModeRef.current = placeMode; }, [placeMode]);
  const colorIdxRef = useRef(colorIdx);
  useEffect(() => { colorIdxRef.current = colorIdx; }, [colorIdx]);
  const stampShapeRef = useRef(stampShape);
  useEffect(() => { stampShapeRef.current = stampShape; }, [stampShape]);
  const rectAspectRef = useRef(rectAspect);
  useEffect(() => { rectAspectRef.current = rectAspect; }, [rectAspect]);
  const cornerTRef = useRef(cornerT);
  useEffect(() => { cornerTRef.current = cornerT; }, [cornerT]);
  const brushNoiseRef = useRef(brushNoise);
  useEffect(() => { brushNoiseRef.current = brushNoise; }, [brushNoise]);
  const noisePresetIdRef = useRef(noisePresetId);
  useEffect(() => { noisePresetIdRef.current = noisePresetId; }, [noisePresetId]);

  const cellW = CANVAS_W / gridRes;
  const cellH = CANVAS_H / rows;
  const vertex = useCallback((gx: number, gy: number) => ({ x: gx * cellW, y: gy * cellH }), [cellW, cellH]);
  const toGrid = useCallback((x: number, y: number) => ({ gx: Math.round(x / cellW), gy: Math.round(y / cellH) }), [cellW, cellH]);
  const snapPt = useCallback((x: number, y: number) => {
    if (!snap) return { x, y };
    const { gx, gy } = toGrid(x, y);
    return vertex(gx, gy);
  }, [snap, toGrid, vertex]);

  const snapPtRef = useRef(snapPt);
  useEffect(() => { snapPtRef.current = snapPt; }, [snapPt]);
  const kRef = useRef(kFactor);
  useEffect(() => { kRef.current = kFactor; }, [kFactor]);
  const adherenceRef = useRef(adherence);
  useEffect(() => { adherenceRef.current = adherence; }, [adherence]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  };

  const { keyMap, heldActions } = useNCTGraphiteCommands({
    commands: ARC_COMMANDS,
    ignoreInputs: true,
    preventDefaultKeys: [" ", "x", "g", "h", "f", "e", "q", "b", "n", "[", "]"],
    onAction: (id, e) => {
      if (HOLD_IDS.has(id)) return;
      if (e?.repeat && ONCE_IDS.has(id)) return;
      const p = snapPtRef.current(cursorRef.current.x, cursorRef.current.y);
      const gi = colorIdxRef.current;
      const color = PALETTE[gi % PALETTE.length];
      const r = Math.max(12, brushRRef.current * 0.6);
      const shape = stampShapeRef.current;
      let stampPts = shape === "roundrect"
        ? roundRectStamp(p.x, p.y, r, rectAspectRef.current, cornerTRef.current).centers
        : [{ x: p.x, y: p.y, r }];
      if (brushNoiseRef.current) {
        stampPts = noisyStampCenters(p, r, shape, stampPts, brushNoisePreset(noisePresetIdRef.current));
      }
      const stampOf = (type: BlobType) => stampPts.map((c) => ({
        id: nextId++, x: c.x, y: c.y, r: c.r, type, colorGroup: gi, color,
      }));
      if (id === "place") {
        const mode = placeModeRef.current;
        const type: BlobType = mode === "negative" ? "positive" : mode;
        setBlobs((prev) => [...prev, ...stampOf(type)]);
      }
      if (id === "placeNeg") {
        setBlobs((prev) => [...prev, ...stampOf("negative")]);
      }
      if (id === "bridge") {
        const pos = blobsRef.current.filter((b) => b.type !== "negative" && b.colorGroup === gi);
        if (pos.length < 2) { flash("NEED 2+ BLOBS"); return; }
        const nearest = [...pos].sort((a, b) => dist(a, cursorRef.current) - dist(b, cursorRef.current)).slice(0, 2);
        const mid = { x: (nearest[0].x + nearest[1].x) / 2, y: (nearest[0].y + nearest[1].y) / 2 };
        const nr = Math.min(nearest[0].r, nearest[1].r) * 0.55;
        setBlobs((prev) => [...prev, { id: nextId++, x: mid.x, y: mid.y, r: nr, type: "positive", colorGroup: gi, color }]);
        flash("NECK BLOB PLACED");
      }
      if (id === "newColor") {
        setColorIdx((i) => (i + 1) % PALETTE.length);
        flash(`COLOR → ${PALETTE[(gi + 1) % PALETTE.length]}`);
      }
      if (id === "clear") {
        if (e?.shiftKey) { setBlobs([]); flash("CLEARED ALL"); }
        else setBlobs((prev) => prev.filter((b) => b.colorGroup !== gi));
      }
    },
    onRebind: (action, key) => flash(`BOUND ${action.toUpperCase()} → [${key.toUpperCase()}]`),
  });

  const heldRef = useRef(heldActions);
  useEffect(() => { heldRef.current = heldActions; }, [heldActions]);

  // Hold-to-act: inflate / erase / smooth / resize, matching the standalone rAF loop.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const held = heldRef.current;
      if (held.has("smaller")) setBrushR((r) => Math.max(12, r - 1.2));
      if (held.has("larger")) setBrushR((r) => Math.min(180, r + 1.2));
      const cur = cursorRef.current;
      const S = brushRRef.current;
      if (held.has("inflate")) {
        setBlobs((prev) => prev.map((b) => dist(b, cur) < S ? { ...b, r: Math.min(160, b.r + 0.6) } : b));
      }
      if (held.has("erase")) {
        setBlobs((prev) => prev.filter((b) => dist(b, cur) > S * 0.8));
      }
      if (held.has("smooth")) {
        const v = adherenceRef.current;
        setBlobs((prev) => {
          const near = prev.filter((b) => dist(b, cur) < S);
          if (!near.length) return prev;
          const u = near.reduce((acc, b) => ({ x: acc.x + b.x / near.length, y: acc.y + b.y / near.length }), { x: 0, y: 0 });
          return prev.map((b) => {
            if (dist(b, cur) >= S) return b;
            const g = snapPtRef.current(b.x, b.y);
            return {
              ...b,
              x: b.x * 0.92 + u.x * 0.04 + g.x * 0.04 * v,
              y: b.y * 0.92 + u.y * 0.04 + g.y * 0.04 * v,
              r: b.r * 0.995 + 0.2,
            };
          });
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const groups = useMemo(() => componentsOf(blobs, handleSize, goo, kFactor), [blobs, handleSize, goo, kFactor]);
  const groupNecks = useMemo(() => necksOf(groups, handleSize, goo, kFactor), [groups, handleSize, goo, kFactor]);
  const holes = useMemo(() => blobs.filter((b) => b.type === "negative"), [blobs]);
  const holeGroups = useMemo(() => connectedComponents(holes, handleSize, goo, kFactor), [holes, handleSize, goo, kFactor]);
  const holeNecks = useMemo(() => necksOf(holeGroups, handleSize, goo, kFactor), [holeGroups, handleSize, goo, kFactor]);
  const neckCount = groupNecks.reduce((s, n) => s + n.length, 0);
  const positives = useMemo(() => blobs.filter((b) => b.type !== "negative"), [blobs]);
  const orphanHoles = useMemo(
    () => holes.filter((h) => !positives.some((b) => dist(b, h) < b.r + h.r)),
    [holes, positives]
  );
  const contourLayers = useMemo(
    () => contourLayersForBlobs(blobs, PALETTE, gridRes, rows, CANVAS_W, CANVAS_H, goo, smoothBezier),
    [blobs, gridRes, rows, goo, smoothBezier]
  );

  const nearest = useMemo(() => {
    const same = blobs.filter((b) => b.type !== "negative" && b.colorGroup === colorIdx);
    const pool = same.length ? same : blobs.filter((b) => b.type !== "negative");
    if (!pool.length) return null;
    let best = pool[0], bd = dist(pool[0], cursor);
    for (const b of pool) {
      const d = dist(b, cursor);
      if (d < bd) { bd = d; best = b; }
    }
    return { blob: best, d: bd };
  }, [blobs, cursor, colorIdx]);

  const stampR = Math.max(12, brushR * 0.6);
  const stampLayout = useMemo(
    () => {
      const base = stampShape === "roundrect"
        ? roundRectStamp(cursor.x, cursor.y, stampR, rectAspect, cornerT)
        : { centers: [{ x: cursor.x, y: cursor.y, r: stampR }], halfW: stampR, halfH: stampR, cornerR: stampR };
      if (!brushNoise) return base;
      return {
        ...base,
        centers: noisyStampCenters(cursor, stampR, stampShape, base.centers, brushNoisePreset(noisePresetId)),
      };
    },
    [stampShape, cursor.x, cursor.y, stampR, rectAspect, cornerT, brushNoise, noisePresetId]
  );

  const previewNeck = useMemo(() => {
    if (!nearest) return null;
    let best = stampLayout.centers[0];
    let bd = dist(best, nearest.blob);
    for (const c of stampLayout.centers) {
      const d = dist(c, nearest.blob);
      if (d < bd) { bd = d; best = c; }
    }
    return satoNeck(nearest.blob.r, best.r, nearest.blob, best, handleSize, goo, kFactor);
  }, [nearest, stampLayout, handleSize, goo, kFactor]);

  const onCanvasMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    setCursor({ x: clamp(x, 0, CANVAS_W), y: clamp(y, 0, CANVAS_H) });
  };

  const exportSVG = () => {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">\n`;
    svg += `<rect width="100%" height="100%" fill="#fdfaf3"/>\n`;
    if (fieldContour) {
      const tau = gooToThreshold(goo);
      svg += `<g id="paper-note" font-family="monospace" font-size="10" fill="#1a1a24" opacity="0.5"><text x="12" y="20">ARC METABALL - d3-contour MS - tau=${tau.toFixed(2)} grid=${gridRes}x${rows} v=${goo.toFixed(2)}</text></g>\n`;
      contourLayers.forEach((layer, i) => {
        svg += `<path id="contour-${i}" fill="${layer.color}" fill-opacity="0.95" fill-rule="evenodd" stroke="#1a1a24" stroke-width="1.2" d="${layer.pathD}"/>\n`;
      });
      svg += `</svg>`;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `arc-metaball-contour-${Date.now()}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      setExported(true);
      setTimeout(() => setExported(false), 1800);
      return;
    }
    svg += `<g id="paper-note" font-family="monospace" font-size="10" fill="#1a1a24" opacity="0.5"><text x="12" y="20">ARC METABALL - SATO Paper.js exact - v=${goo.toFixed(2)} handle=${handleSize.toFixed(2)} maxDist=${kFactor.toFixed(2)}</text></g>\n`;
    if (holes.length) {
      svg += `<defs><mask id="sato-holes" maskUnits="userSpaceOnUse" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}">\n`;
      svg += `  <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="#fff"/>\n`;
      holeGroups.forEach((g) => {
        for (const h of g) svg += `  <circle cx="${h.x.toFixed(3)}" cy="${h.y.toFixed(3)}" r="${h.r.toFixed(3)}" fill="#000"/>\n`;
      });
      holeNecks.forEach((necks) => {
        for (const n of necks) svg += `  <path d="${n.path}" fill="#000"/>\n`;
      });
      svg += `</mask></defs>\n`;
    }
    svg += holes.length ? `<g mask="url(#sato-holes)">\n` : `<g>\n`;
    groups.forEach((g, i) => {
      const color = g[0]?.color || PALETTE[0];
      const necks = groupNecks[i] || [];
      svg += `<g id="comp-${i}" fill="${color}" fill-opacity="0.9" stroke="#1a1a24" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">\n`;
      for (const b of g) svg += `  <circle cx="${b.x.toFixed(3)}" cy="${b.y.toFixed(3)}" r="${b.r.toFixed(3)}"/>\n`;
      for (const n of necks) svg += `  <path d="${n.path}" />\n`;
      svg += `</g>\n`;
    });
    svg += `</g>\n`;
    svg += `</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `arc-metaball-sato-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 1800);
  };

  const gridDots: Vec[] = [];
  for (let gx = 0; gx <= gridRes; gx++) {
    for (let gy = 0; gy <= rows; gy++) gridDots.push(vertex(gx, gy));
  }

  const heatmapCells: { x: number; y: number; o: number; key: string }[] = [];
  if (heatmap) {
    for (let gx = 0; gx < gridRes; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        const p = vertex(gx, gy);
        let n = 0;
        for (const b of blobs) {
          if (Math.hypot(b.x - p.x, b.y - p.y) < b.r + b.r * kFactor) n++;
        }
        if (n === 0) continue;
        heatmapCells.push({ x: p.x - cellW / 2, y: p.y - cellH / 2, o: Math.min(0.35, n * 0.12), key: `${gx}-${gy}` });
      }
    }
  }

  const brushStroke = placeMode === "negative" ? "#ff4d6d" : placeMode === "sticky" ? "#00e5ff" : "#7c5cff";

  const activeKeyLabel =
    heldActions.size > 0
      ? [...heldActions]
          .map((id) => ARC_COMMANDS.find((c) => c.id === id)?.label ?? id)
          .join(' • ')
          .toUpperCase()
      : null;

  return (
    <NCTGraphiteAppShell
      className="nctgraphite-font-sans"
      gap={0}
      proportion="220px 1fr 300px"
      header={
      <header data-safe-area-sticky-top style={{ top: "var(--safe-area-inset-top)" }} className="sticky z-20 backdrop-blur bg-[#0e0e14]/90 border-b border-[#24243a] h-[56px] px-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-7 w-7 rounded-[7px] bg-[#7c5cff] grid place-items-center text-black font-bold text-[12px]">A◐</div>
          <h1 className="text-[13px] md:text-[16px] tracking-[0.02em] font-bold">METABALL GRID LAB — <span className="opacity-60">FIELD CONTOUR / ARC</span></h1>
          <span className="hidden md:inline-flex ml-3 px-2 py-1 rounded bg-[#1a1a24] border border-[#2a2a3a] text-[10px] tracking-widest">MOUSE AIMS — USE KEYS</span>
        </div>
        <div className="hidden md:flex items-center gap-2 text-[11px] opacity-60">
          <span className="h-2 w-2 rounded-full bg-[#7c5cff]" />
          <span>{blobs.filter((b) => b.type !== "negative").length} BLOBS • {neckCount} BRIDGES • {groups.length} SHAPES</span>
        </div>
      </header>
      }
      footer={
      <NCTGraphiteStageFooter>
        <span>METABALL GRID LAB • FIELD CONTOUR • SATO ARC • GRID ADHERENCE KEPT</span>
        <span className="hidden md:inline">K {kFactor.toFixed(2)} • V {goo.toFixed(2)} • HS {handleSize.toFixed(1)} • GRID {gridRes}</span>
      </NCTGraphiteStageFooter>
      }
    >
      <NCTGraphiteStagePanel side="left" width={220} className="bg-[#0e0e14] border-r border-[#24243a] p-3 md:p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
        <NCTGraphiteSegmented
          label="PLACEMENT MODE"
          hint={`+BLOB stamps positive fill. −HOLE subtracts the same field kernel (true cut). STICKY snaps to grid vertices when placing.`}
          options={PLACE_MODES}
          value={placeMode}
          onChange={(v) => setPlaceMode(v as PlaceMode)}
        />
        <NCTGraphiteSegmented
          label="STAMP SHAPE"
          hint="Circle = one kernel. Round rect = many Sato circles along a pill; corner 100% = stadium, ~55% + aspect 1.7 = rounded box."
          options={STAMP_SHAPES}
          value={stampShape}
          onChange={(v) => setStampShape(v as StampShape)}
        />
        <NCTGraphiteSegmented
          label="OUTLINE"
          hint={`FIELD samples F = Σ r²/d², traces F ≥ τ (τ = 0.4 + V×1.1) with d3-contour; color groups separate; holes cut all groups; export uses even-odd rings. ARC uses Paper.js Sato necks (M p1 C … A … Z); K and handle size apply only in ARC.`}
          options={ENGINE_MODES}
          value={fieldContour ? "contour" : "arc"}
          onChange={(v) => setFieldContour(v === "contour")}
        />
        <div>
          <NCTGraphiteSlider
            label="BRUSH RADIUS"
            hint={`Stamp size. Larger r raises the field so blobs look bigger and merge sooner. Stamp with ${keyMap.place.toUpperCase()}, overlap neighbors, hold ${keyMap.inflate.toUpperCase()} to grow until they fuse.`}
            value={brushR}
            min={12}
            max={180}
            format={(v) => `${Math.round(v)}px`}
            onChange={setBrushR}
          />
          {stampShape === "roundrect" && (
            <div className="mt-2 flex flex-col gap-2">
              <NCTGraphiteSlider label="ASPECT W/H" hint="Width/height of the round-rect stamp (elongated pill vs square)." value={rectAspect} min={0.5} max={2.6} step={0.05} format={(v) => `${v.toFixed(2)}`} onChange={setRectAspect} />
              <NCTGraphiteSlider label="CORNER" hint="Four Sato circles at the corners; 100% corner radius = stadium ends." value={cornerT} min={0.25} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setCornerT} />
            </div>
          )}
          <div className="mt-2">
            <NCTGraphiteToggle
              label="Brush Perlin"
              hint="Warps only the next stamp (Fine / Medium / Coarse). Existing blobs stay as placed."
              checked={brushNoise}
              onChange={setBrushNoise}
              controlStyle="switch"
            />
            <label className="mt-1 flex items-center justify-between p-2 rounded-[8px] bg-[#15151e] border border-[#23232f]">
              <span className="flex items-center gap-1 text-[11px] opacity-70">
                Noise
                <NCTGraphiteHint text="Perlin scale for the stamp warp when Brush Perlin is on." />
              </span>
              <select
                value={noisePresetId}
                onChange={(e) => setNoisePresetId(e.target.value)}
                disabled={!brushNoise}
                className="bg-[#0e0e14] text-[#fdfaf3] text-[11px] border border-[#23232f] rounded-[6px] px-2 py-1 outline-none disabled:opacity-40"
              >
                {BRUSH_NOISE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="rounded-[18px] bg-[var(--panel-2)] text-[#fdfaf3] p-3 border border-white/10">
          <div className="text-[10px] tracking-[0.18em] opacity-60 mb-3 [font-family:var(--font-alt-mono)]">KEY-CLICK MAP — MOUSE AIMS</div>
          <NCTGraphiteKeyMap commands={ARC_COMMANDS} keyMap={keyMap} heldActions={heldActions} emphasizeIds={HOLD_IDS} />
          <NCTGraphiteStack direction="row" gap={8} className="mt-3">
            <div className={`flex-1 h-[36px] rounded-full grid place-items-center text-[11px] font-bold transition [font-family:var(--font-alt-mono)] ${activeKeyLabel ? 'bg-[#00e5ff] text-black' : 'bg-white/10 text-white/50'}`}>
              {activeKeyLabel ? `● ${activeKeyLabel}` : 'IDLE — MOVE MOUSE'}
            </div>
          </NCTGraphiteStack>
        </div>
      </NCTGraphiteStagePanel>

      <NCTGraphiteStageMain className="bg-[#0e0e14] items-stretch p-0 gap-0">
        <div className="p-2 md:p-3 flex items-center justify-between text-[10px] tracking-widest opacity-50 border-b border-[#24243a] bg-[#12121a]">
          <span>PAPER CANVAS • {fieldContour ? "MS FIELD" : "SATO ARC"} • {gridRes}×{rows} • V {goo.toFixed(2)}{fieldContour ? ` τ ${gooToThreshold(goo).toFixed(2)}` : ` HS ${handleSize.toFixed(1)}`}</span>
          <span className="flex items-center gap-2">
            <span className="hidden md:inline">CURSOR {Math.round(cursor.x)},{Math.round(cursor.y)}</span>
            <span className="px-2 py-0.5 rounded bg-[#7c5cff] text-white">{fieldContour ? "● LIVE CONTOUR" : "● LIVE SATO"}</span>
          </span>
        </div>
        <div className="relative flex-1 flex items-start justify-center p-2 md:p-4 bg-[radial-gradient(ellipse_at_center,_#1a1a2a_0%,_#0e0e14_70%)]">
          <div
            ref={stageRef}
            onMouseMove={onCanvasMove}
            className="relative w-full max-w-[900px] aspect-[900/660] bg-[#fdfaf3] rounded-[16px] overflow-hidden shadow-[0_20px_80px_rgba(0,0,0,0.6)] select-none touch-none"
            style={{ cursor: "none" }}
          >
            <svg width={CANVAS_W} height={CANVAS_H} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} className="absolute inset-0 w-full h-full">
              {!fieldContour && holes.length > 0 && (
                <defs>
                  <mask id="sato-holes" maskUnits="userSpaceOnUse" x={0} y={0} width={CANVAS_W} height={CANVAS_H}>
                    <rect width={CANVAS_W} height={CANVAS_H} fill="#fff" />
                    {holeGroups.map((g) => g.map((h) => (
                      <circle key={`hm-${h.id}`} cx={h.x} cy={h.y} r={h.r} fill="#000" />
                    )))}
                    {holeNecks.map((necks, i) => necks.map((n, j) => (
                      <path key={`hn-${i}-${j}`} d={n.path} fill="#000" />
                    )))}
                  </mask>
                </defs>
              )}
              {heatmap && (
                <g opacity={0.35}>
                  {heatmapCells.map((c) => (
                    <rect key={c.key} x={c.x} y={c.y} width={cellW} height={cellH} fill="#7c5cff" opacity={c.o} />
                  ))}
                </g>
              )}
              <g>
                {gridDots.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={snap ? 1.2 : 0.9} fill="#1a1a24" opacity={snap ? 0.18 : 0.09} />
                ))}
              </g>
              {showInfluence && blobs.map((b) => {
                const { gx, gy } = toGrid(b.x, b.y);
                const pts: Vec[] = [];
                for (let dx = -1; dx <= 1; dx++) {
                  for (let dy = -1; dy <= 1; dy++) {
                    const x = gx + dx, y = gy + dy;
                    if (x < 0 || x > gridRes || y < 0 || y > rows) continue;
                    pts.push(vertex(x, y));
                  }
                }
                const stroke = b.type === "sticky" ? "#00e5ff" : b.type === "negative" ? "#ff4d6d" : "#7c5cff";
                return (
                  <g key={`inf-${b.id}`} opacity={adherence}>
                    {pts.map((p, i) => (
                      <line key={i} x1={b.x} y1={b.y} x2={p.x} y2={p.y} stroke={stroke} strokeWidth={0.6} strokeDasharray="3 4" opacity={0.5} />
                    ))}
                  </g>
                );
              })}
              {fieldContour ? (
                <g>
                  {contourLayers.map((layer) => (
                    <path
                      key={`ms-${layer.colorGroup}`}
                      d={layer.pathD}
                      fill={layer.color}
                      fillOpacity={showConstruction ? 0.85 : 1}
                      fillRule="evenodd"
                      stroke={showConstruction ? "#1a1a24" : "none"}
                      strokeWidth={showConstruction ? 1.2 : 0}
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              ) : (
              <g mask={holes.length ? "url(#sato-holes)" : undefined}>
              {groups.map((g, i) => {
                const color = g[0]?.color || "#7c5cff";
                const necks = groupNecks[i] || [];
                const stroke = showConstruction ? "#1a1a24" : "none";
                const strokeWidth = showConstruction ? 1.2 : 0;
                return (
                  <g key={`comp-${i}`}>
                    {g.map((b) => (
                      <circle key={b.id} cx={b.x} cy={b.y} r={b.r} fill={color} fillOpacity={showConstruction ? 0.9 : 1} stroke={stroke} strokeWidth={strokeWidth} />
                    ))}
                    {necks.map((n, j) => (
                      <path key={j} d={n.path} fill={color} fillOpacity={showConstruction ? 0.9 : 1} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
                    ))}
                  </g>
                );
              })}
              </g>
              )}
              {!fieldContour && (showConstruction ? holes : orphanHoles).map((b) => (
                <g key={`neg-${b.id}`}>
                  <circle cx={b.x} cy={b.y} r={b.r} fill="none" stroke="#ff4d6d" strokeWidth={showConstruction ? 1.5 : 1} strokeDasharray="7 5" opacity={showConstruction ? 1 : 0.45} />
                  {showConstruction && <circle cx={b.x} cy={b.y} r={3} fill="#ff4d6d" />}
                </g>
              ))}
              {!fieldContour && showConstruction && holeNecks.map((necks, i) => necks.map((n, j) => (
                <path key={`hcn-${i}-${j}`} d={n.path} fill="none" stroke="#ff4d6d" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.8} />
              )))}
              {showConstruction && blobs.filter((b) => b.type !== "negative").map((b) => (
                <g key={`core-${b.id}`}>
                  <circle cx={b.x} cy={b.y} r={2.5} fill={b.type === "sticky" ? "#00e5ff" : "#1a1a24"} opacity={b.type === "sticky" ? 0.9 : 0.6} />
                  {b.type === "sticky" && (
                    <circle cx={b.x} cy={b.y} r={b.r} fill="none" stroke="#00e5ff" strokeWidth={1} strokeDasharray="2 8" opacity={0.4} />
                  )}
                </g>
              ))}
              <g pointerEvents="none">
                {!fieldContour && bridgePreview && previewNeck && (
                  <path d={previewNeck.path} fill="none" stroke="#7c5cff" strokeWidth={1.2} strokeDasharray="8 5" opacity={0.85} />
                )}
                {!fieldContour && bridgePreview && nearest && !previewNeck && (
                  <line x1={nearest.blob.x} y1={nearest.blob.y} x2={cursor.x} y2={cursor.y} stroke="#7c5cff" strokeWidth={1} strokeDasharray="6 4" opacity={0.4} />
                )}
                {brushNoise && stampLayout.centers.length > 2 ? (
                  <>
                    <polygon
                      points={stampLayout.centers.map((c) => `${c.x},${c.y}`).join(" ")}
                      fill="none"
                      stroke={brushStroke}
                      strokeWidth={1.5}
                      strokeDasharray="8 6"
                      opacity={0.9}
                    />
                    {stampLayout.centers.map((c, i) => (
                      <circle key={`sc-${i}`} cx={c.x} cy={c.y} r={c.r} fill="none" stroke={brushStroke} strokeWidth={0.8} strokeDasharray="3 4" opacity={0.4} />
                    ))}
                  </>
                ) : stampShape === "roundrect" ? (
                  <>
                    <rect
                      x={cursor.x - stampLayout.halfW}
                      y={cursor.y - stampLayout.halfH}
                      width={stampLayout.halfW * 2}
                      height={stampLayout.halfH * 2}
                      rx={stampLayout.cornerR}
                      ry={stampLayout.cornerR}
                      fill="none"
                      stroke={brushStroke}
                      strokeWidth={1.5}
                      strokeDasharray="8 6"
                      opacity={0.9}
                    />
                    {stampLayout.centers.slice(0, 4).map((c, i) => (
                      <circle key={`sc-${i}`} cx={c.x} cy={c.y} r={c.r} fill="none" stroke={brushStroke} strokeWidth={0.8} strokeDasharray="3 4" opacity={0.45} />
                    ))}
                  </>
                ) : (
                  <circle cx={cursor.x} cy={cursor.y} r={stampR} fill="none" stroke={brushStroke} strokeWidth={1.5} strokeDasharray="8 6" opacity={0.9} />
                )}
                <circle cx={cursor.x} cy={cursor.y} r={3} fill="#1a1a24" />
                {previewNeck && (
                  <>
                    <circle cx={previewNeck.p1.x} cy={previewNeck.p1.y} r={1.5} fill="#7c5cff" />
                    <circle cx={previewNeck.p3.x} cy={previewNeck.p3.y} r={1.5} fill="#7c5cff" />
                  </>
                )}
              </g>
            </svg>
            <div
              className="pointer-events-none absolute rounded-full border-[1.5px] border-[#1a1a24] bg-white/10 -translate-x-1/2 -translate-y-1/2 hidden md:block"
              style={{ left: `${(cursor.x / CANVAS_W) * 100}%`, top: `${(cursor.y / CANVAS_H) * 100}%`, width: 24, height: 24 }}
            />
            <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 bg-[#1a1a24] text-[#fdfaf3] text-[10px] tracking-widest px-2 py-1 rounded-full border border-white/10">
              MOUSE AIMS — USE KEYS • {keyMap.place.toUpperCase()} TO STAMP • SATO M p1 C h1 h3 p3 A r …
            </div>
            {exported && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-[#e8e6df] text-black text-[11px] px-3 py-1 rounded-full font-bold tracking-widest">
                SVG EXPORTED • SATO PATHS
              </div>
            )}
          </div>
        </div>
        <div className="h-[36px] border-t border-[#24243a] bg-[#12121a] flex items-center justify-between px-3 text-[10px] tracking-widest">
          <div className="flex gap-4 opacity-60">
            <span>GRID {gridRes}x{rows}</span>
            <span>BLOBS {blobs.length}</span>
            <span>SHAPES {groups.length}</span>
            <span className="hidden md:inline">BRIDGES {neckCount}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="opacity-50 hidden md:inline">MAXDIST r1+r2*{kFactor.toFixed(1)} • V {goo.toFixed(2)} • HS {handleSize.toFixed(1)} • SATO</span>
            <span className="px-2 py-1 rounded bg-[#1a1a24] border border-[#24243a]">
              POS {blobs.filter((b) => b.type !== "negative").length} • HOLES {blobs.filter((b) => b.type === "negative").length}
            </span>
          </div>
        </div>
        <NCTGraphiteToast message={toast} className="bg-[#7c5cff] text-white" />
      </NCTGraphiteStageMain>

      <NCTGraphiteStagePanel side="right" width={300} className="bg-[#0e0e14] border-l border-[#24243a] p-3 md:p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
        <div>
          <div className="text-[10px] tracking-[0.2em] opacity-50 mb-2">GRID & SATO ENGINE</div>
          <div className="bg-[#1a1a24] rounded-[12px] border border-[#24243a] p-3 flex flex-col gap-3">
            <NCTGraphiteSlider
              label="GRID RES"
              hint={`FIELD outline fidelity on a ${gridRes}×${rows} sample grid. 24–36 = chunky; 48 default; 72–100 = smoother, slower. Current τ ≈ ${gooToThreshold(goo).toFixed(2)} at V ${goo.toFixed(2)}.`}
              value={gridRes}
              min={24}
              max={100}
              format={(v) => `${Math.round(v)}`}
              onChange={(v) => setGridRes(Math.round(v))}
            />
            <NCTGraphiteSlider
              label="MAX DIST FACTOR • r1+r2*K"
              hint="ARC only: if center distance d > r1 + r2×K, Sato will not bridge the pair. Default K ≈ 2.5."
              value={kFactor}
              min={1}
              max={4}
              step={0.05}
              format={(v) => `${v.toFixed(2)}x`}
              onChange={setKFactor}
            />
            <NCTGraphiteSlider
              label="V • GOO TIGHTNESS"
              hint={`FIELD: iso-threshold τ = 0.4 + V×1.1 — low V (0.2–0.4) = long-range merge / lava; high V (0.7–1.2) = tight beads. ARC: neck angle = between ±u + (maxSpread−u)×V. Combos: organic FIELD + round rect, grid ≥ 56, V ≈ 0.5; separate pills V ≈ 0.8–1.0; one mass V ≈ 0.3 + ${keyMap.inflate.toUpperCase()}-inflate.`}
              value={goo}
              min={0.2}
              max={1.2}
              step={0.01}
              format={(v) => v.toFixed(2)}
              onChange={setGoo}
            />
            <NCTGraphiteSlider
              label="HANDLE SIZE"
              hint="ARC only: Sato handle length — d2 = min(V×handleSize, |p1−p3|/total) × min(1, 2d/total). Does not affect FIELD contours."
              value={handleSize}
              min={1}
              max={4}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={setHandleSize}
            />
            <NCTGraphiteSlider label="ADHERENCE VIS" hint="Opacity of dashed lines from blobs to nearby grid vertices (sticky / grid pull)." value={adherence} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={setAdherence} />
          </div>
        </div>
        <div>
          <div className="text-[10px] tracking-[0.2em] opacity-50 mb-2">VISUAL TOGGLES</div>
          <NCTGraphiteToggle label="Bezier smooth" hint="FIELD: fit cubic curves to the marching-squares contour so the outline is not faceted." checked={smoothBezier} onChange={setSmoothBezier} controlStyle="switch" />
          <NCTGraphiteToggle label="Show Construction" hint="Stroke blob cores, neck geometry, and negative holes for debugging." checked={showConstruction} onChange={setShowConstruction} controlStyle="switch" />
          <NCTGraphiteGrid columns="1fr 1fr" gap={8} className="mt-2">
            <NCTGraphiteToggle label="Snap to Grid" hint="Quantize stamp positions to grid vertices." checked={snap} onChange={setSnap} />
            <NCTGraphiteToggle label="Show Influence" hint="Draw adherence lines to neighboring grid points." checked={showInfluence} onChange={setShowInfluence} />
            <NCTGraphiteToggle label="Show Heatmap" hint="Shade grid cells by scalar field strength." checked={heatmap} onChange={setHeatmap} />
            <NCTGraphiteToggle label="Bridge Preview" hint="ARC: preview the Sato neck to the nearest blob under the cursor." checked={bridgePreview} onChange={setBridgePreview} />
          </NCTGraphiteGrid>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] tracking-[0.2em] opacity-50">COLOR GROUPS</div>
            <button onClick={() => setColorIdx((i) => (i + 1) % PALETTE.length)} className="text-[10px] px-2 py-1 rounded bg-[#1a1a24] border border-[#24243a]">
              NEW [{keyMap.newColor.toUpperCase()}]
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {PALETTE.map((col, i) => {
              const n = blobs.filter((b) => b.colorGroup === i).length;
              return (
                <button
                  key={col}
                  onClick={() => setColorIdx(i)}
                  className={`relative h-[42px] w-[42px] rounded-[10px] border flex flex-col items-center justify-center ${i === colorIdx ? "border-white scale-105" : "border-[#2a2a3a]"}`}
                  style={{ background: col }}
                >
                  <span className="text-[10px] font-bold text-black/70">{i}</span>
                  <span className="text-[9px] bg-black/70 text-white px-1 rounded-full">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-[10px] tracking-[0.2em] opacity-50 mb-2">BLOB LIST • {blobs.length}</div>
          <div className="bg-[#1a1a24] rounded-[12px] border border-[#24243a] max-h-[160px] overflow-auto divide-y divide-[#24243a]">
            {blobs.length === 0 && (
              <div className="p-3 text-[11px] opacity-40">No blobs — press {keyMap.place.toUpperCase()} to stamp</div>
            )}
            {blobs.slice().reverse().map((b) => (
              <div key={b.id} className="flex items-center justify-between px-2 py-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full border border-black/20" style={{ background: b.color }} />
                  <span className="opacity-60">{b.type.slice(0, 3).toUpperCase()}</span>
                  <span className="opacity-40">{Math.round(b.x)},{Math.round(b.y)} r{Math.round(b.r)}</span>
                </div>
                <button onClick={() => setBlobs((prev) => prev.filter((x) => x.id !== b.id))} className="px-1.5 py-0.5 rounded bg-[#0e0e14] border border-[#2a2a3a] text-[10px] hover:bg-[#ff4d6d] hover:text-white">DEL</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] tracking-[0.2em] opacity-50 mb-2">SHAPE LIST • {groups.length} COMPONENTS • SATO BRIDGES</div>
          <div className="bg-[#1a1a24] rounded-[12px] border border-[#24243a] max-h-[160px] overflow-auto divide-y divide-[#24243a]">
            {groups.length === 0 && <div className="p-3 text-[11px] opacity-40">No merged shapes</div>}
            {groups.map((g, i) => {
              const n = groupNecks[i]?.length || 0;
              const sample = n > 0 ? groupNecks[i][0].path.slice(0, 32) : "";
              return (
                <div key={i} className="px-2 py-1.5 text-[11px] flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span className="flex items-center gap-2">
                      Shape {i} • {g.length} blobs • {n} bridges
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: g[0].color }} />
                    </span>
                    <button
                      onClick={() => {
                        const ids = new Set(g.map((b) => b.id));
                        setBlobs((prev) => prev.filter((b) => !ids.has(b.id)));
                      }}
                      className="px-1.5 py-0.5 rounded bg-[#0e0e14] border border-[#2a2a3a] text-[10px]"
                    >
                      CLEAR
                    </button>
                  </div>
                  {sample && <div className="text-[8px] opacity-30 truncate font-mono">{sample}…</div>}
                </div>
              );
            })}
          </div>
        </div>
        <NCTGraphiteStack direction="column" gap={8}>
          <button onClick={exportSVG} className="h-[44px] rounded-[12px] bg-[#7c5cff] text-white font-bold tracking-widest text-[12px] hover:bg-[#6a4be0]">
            EXPORT SATO SVG • C+A PATHS ↓
          </button>
          <button onClick={() => { setBlobs([]); flash("CLEARED ALL"); }} className="h-[36px] rounded-[12px] bg-[#1a1a24] border border-[#24243a] text-[11px] font-bold">
            CLEAR ALL
          </button>
        </NCTGraphiteStack>
      </NCTGraphiteStagePanel>
    </NCTGraphiteAppShell>
  );
}
