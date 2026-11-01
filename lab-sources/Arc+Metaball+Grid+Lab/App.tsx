import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  NCTGraphiteSlider, NCTGraphiteStack, NCTGraphiteGrid,
  NCTGraphiteStage, NCTGraphiteStageBody, NCTGraphiteStagePanel, NCTGraphiteStageMain,
  NCTGraphiteStageFooter, NCTGraphiteToggle, NCTGraphiteSwatch,
  NCTGraphiteKeyMap, NCTGraphiteToast, useNCTGraphiteCommands,
} from "@nct/nctgraphite";
import type { NCTGraphiteCommandDef } from "@nct/nctgraphite";

type Sign = 1 | -1;
type Blob = { id: number; x: number; y: number; r: number; sign: Sign; color: string };

const CANVAS_W = 960;
const CANVAS_H = 680;

const PALETTE = ["#7c5cff", "#00e5ff", "#ff7a45", "#ffe14a", "#38f28a", "#ff4d6d", "#b18aff", "#4af0ff"];

const ARC_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: "place", label: "Positive blob", desc: "Place + blob", defaultKey: "g" },
  { id: "placeNeg", label: "Negative blob", desc: "Place − blob", defaultKey: "h" },
  { id: "inflate", label: "Inflate", desc: "Grow blob under brush", defaultKey: "f" },
  { id: "bridge", label: "Bridge", desc: "Neck blob between nearest pair", defaultKey: "b" },
  { id: "erase", label: "Erase", desc: "Remove blob under brush", defaultKey: "e" },
  { id: "smooth", label: "Smooth", desc: "Relax blob positions", defaultKey: "q" },
  { id: "newColor", label: "New Color", desc: "Cycle palette", defaultKey: "n" },
  { id: "smaller", label: "Brush -", desc: "Shrink brush", defaultKey: "[" },
  { id: "larger", label: "Brush +", desc: "Grow brush", defaultKey: "]" },
  { id: "clear", label: "Clear / All", desc: "Clear color, Shift+X clears all", defaultKey: "x" },
];

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

type Neck = { a: Blob; b: Blob; d: number };

/** Pairs eligible for a Sato-style neck bridge: same color, positive, close enough. */
function bridgePairs(blobs: Blob[], k: number): Neck[] {
  const pos = blobs.filter((b) => b.sign > 0);
  const out: Neck[] = [];
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      const a = pos[i], b = pos[j];
      if (a.color !== b.color) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      if (d > 0.001 && d <= a.r + b.r * k) out.push({ a, b, d });
    }
  }
  return out;
}

/**
 * Neck bridge path between two circles, Sato-style:
 * M p1 C h1 h3 p3 A r r 0 esc 0 p4 C h4 h2 p2 Z.
 * Tapered quad with bezier handles scaled by goo tightness `v`
 * (1 = fat neck, 0 = pinched) and explicit handle size.
 */
function neckPath(a: Blob, b: Blob, d: number, k: number, v: number, handle: number): string {
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  const nx = -uy, ny = ux;
  const t = Math.min(1, d / (a.r + b.r * k));
  const pinch = 1 - t * (1 - v);
  const w1 = Math.max(1.5, a.r * pinch), w2 = Math.max(1.5, b.r * pinch);
  const h = handle;
  const p1ax = a.x + nx * w1, p1ay = a.y + ny * w1;
  const p1bx = a.x - nx * w1, p1by = a.y - ny * w1;
  const p3ax = b.x + nx * w2, p3ay = b.y + ny * w2;
  const p3bx = b.x - nx * w2, p3by = b.y - ny * w2;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const h1x = p1ax + ux * h, h1y = p1ay + uy * h;
  const h3x = p3ax - ux * h, h3y = p3ay - uy * h;
  const h4x = p3bx - ux * h, h4y = p3by - uy * h;
  const h2x = p1bx + ux * h, h2y = p1by + uy * h;
  const f = (n: number) => n.toFixed(1);
  return `M ${f(p1ax)} ${f(p1ay)} C ${f(h1x)} ${f(h1y)} ${f(h3x)} ${f(h3y)} ${f(p3ax)} ${f(p3ay)} A ${f(b.r)} ${f(b.r)} 0 0 0 ${f(p3bx)} ${f(p3by)} C ${f(h4x)} ${f(h4y)} ${f(h2x)} ${f(h2y)} ${f(p1bx)} ${f(p1by)} Z`;
}

/** Union-find over bridge pairs → live component list. */
function components(blobs: Blob[], necks: Neck[]): Blob[][] {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    if (!parent.has(id)) parent.set(id, id);
    let p = parent.get(id)!;
    if (p !== id) { p = find(p); parent.set(id, p); }
    return p;
  };
  for (const n of necks) {
    const ra = find(n.a.id), rb = find(n.b.id);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<number, Blob[]>();
  for (const b of blobs.filter((x) => x.sign > 0)) {
    const r = find(b.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(b);
  }
  return [...groups.values()];
}

let nextId = 1;

export default function App() {
  const [blobs, setBlobs] = useState<Blob[]>([
    { id: nextId++, x: 300, y: 300, r: 54, sign: 1, color: PALETTE[0] },
    { id: nextId++, x: 430, y: 330, r: 40, sign: 1, color: PALETTE[0] },
    { id: nextId++, x: 620, y: 300, r: 48, sign: 1, color: PALETTE[1] },
  ]);
  const [brush, setBrush] = useState({ x: CANVAS_W / 2, y: CANVAS_H / 2, r: 64 });
  const [colorIdx, setColorIdx] = useState(0);
  const [snapStep, setSnapStep] = useState(20);
  const [kFactor, setKFactor] = useState(2.5);
  const [goo, setGoo] = useState(0.65);
  const [handleSize, setHandleSize] = useState(28);
  const [snap, setSnap] = useState(true);
  const [showInfluence, setShowInfluence] = useState(false);
  const [bridgePreview, setBridgePreview] = useState(true);
  const [adherence, setAdherence] = useState(false);
  const [heatmap, setHeatmap] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportName, setExportName] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobsRef = useRef(blobs);
  useEffect(() => { blobsRef.current = blobs; }, [blobs]);
  const brushRef = useRef(brush);
  useEffect(() => { brushRef.current = brush; }, [brush]);
  const paramRef = useRef({ snapStep, kFactor, goo, handleSize, snap, showInfluence, bridgePreview, adherence, heatmap });
  useEffect(() => {
    paramRef.current = { snapStep, kFactor, goo, handleSize, snap, showInfluence, bridgePreview, adherence, heatmap };
  }, [snapStep, kFactor, goo, handleSize, snap, showInfluence, bridgePreview, adherence, heatmap]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  };

  const snapPt = (x: number, y: number) => {
    const s = paramRef.current.snapStep;
    if (!paramRef.current.snap || !s) return { x, y };
    return { x: Math.round(x / s) * s, y: Math.round(y / s) * s };
  };

  const nearestBlob = (x: number, y: number) => {
    let best: Blob | null = null, bd = Infinity;
    for (const b of blobsRef.current) {
      const d = dist(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best && bd <= brushRef.current.r + best.r ? best : null;
  };

  const { keyMap, heldActions, rebinding, beginRebind } = useNCTGraphiteCommands({
    commands: ARC_COMMANDS,
    ignoreInputs: true,
    preventDefaultKeys: [" ", "x"],
    onAction: (id, e) => {
      const p = snapPt(brushRef.current.x, brushRef.current.y);
      const color = PALETTE[colorIdx % PALETTE.length];
      if (id === "place") setBlobs((prev) => [...prev, { id: nextId++, x: p.x, y: p.y, r: 34, sign: 1, color }]);
      if (id === "placeNeg") setBlobs((prev) => [...prev, { id: nextId++, x: p.x, y: p.y, r: 26, sign: -1, color }]);
      if (id === "inflate") {
        const t = nearestBlob(p.x, p.y);
        if (t) setBlobs((prev) => prev.map((b) => (b.id === t.id ? { ...b, r: Math.min(120, b.r + 6) } : b)));
      }
      if (id === "bridge") {
        const pos = blobsRef.current.filter((b) => b.sign > 0 && b.color === color).sort((x, y) => dist(p.x, p.y, x.x, x.y) - dist(p.x, p.y, y.x, y.y));
        if (pos.length >= 2) {
          const [a, b] = pos;
          setBlobs((prev) => [...prev, { id: nextId++, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.min(a.r, b.r) * 0.5, sign: 1, color }]);
          flash("NECK BLOB PLACED");
        } else flash("NEED 2+ BLOBS");
      }
      if (id === "erase") {
        const t = nearestBlob(p.x, p.y);
        if (t) setBlobs((prev) => prev.filter((b) => b.id !== t.id));
      }
      if (id === "smooth") {
        setBlobs((prev) => {
          const next = prev.map((b) => ({ ...b }));
          for (let i = 0; i < next.length; i++) {
            const near = next.filter((o, j) => j !== i && dist(next[i].x, next[i].y, o.x, o.y) < 220);
            if (near.length) {
              const cx = near.reduce((s, o) => s + o.x, 0) / near.length;
              const cy = near.reduce((s, o) => s + o.y, 0) / near.length;
              next[i].x += (cx - next[i].x) * 0.15;
              next[i].y += (cy - next[i].y) * 0.15;
            }
          }
          return next;
        });
      }
      if (id === "newColor") {
        setColorIdx((i) => (i + 1) % PALETTE.length);
        flash(`COLOR → ${PALETTE[(colorIdx + 1) % PALETTE.length]}`);
      }
      if (id === "smaller") setBrush((b) => ({ ...b, r: Math.max(12, b.r - 8) }));
      if (id === "larger") setBrush((b) => ({ ...b, r: Math.min(220, b.r + 8) }));
      if (id === "clear") {
        if (e?.shiftKey) { setBlobs([]); flash("CLEARED ALL"); }
        else setBlobs((prev) => prev.filter((b) => b.color !== color));
      }
    },
    onRebind: (action, key) => flash(`BOUND ${action.toUpperCase()} → [${key.toUpperCase()}]`),
  });

  // Canvas render: paper field, metaball unions, holes, overlays.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const p = paramRef.current;
      const list = blobsRef.current;
      const b = brushRef.current;
      const necks = bridgePairs(list, p.kFactor);

      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = "#fdfaf3";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // snap grid
      if (p.snap && p.snapStep) {
        ctx.strokeStyle = "#e8e0c8";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= CANVAS_W; x += p.snapStep) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, CANVAS_H); }
        for (let y = 0; y <= CANVAS_H; y += p.snapStep) { ctx.moveTo(0, y + 0.5); ctx.lineTo(CANVAS_W, y + 0.5); }
        ctx.stroke();
      }

      // heatmap underlay
      if (p.heatmap) {
        for (const bl of list) {
          if (bl.sign < 0) continue;
          const g = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, bl.r * 2);
          g.addColorStop(0, bl.color + "55");
          g.addColorStop(1, bl.color + "00");
          ctx.fillStyle = g;
          ctx.fillRect(bl.x - bl.r * 2, bl.y - bl.r * 2, bl.r * 4, bl.r * 4);
        }
      }

      // unions: neck bridges first, then circles, then holes cut out
      ctx.save();
      for (const n of necks) {
        ctx.fillStyle = n.a.color;
        const path = new Path2D(neckPath(n.a, n.b, n.d, p.kFactor, p.goo, p.handleSize));
        ctx.fill(path);
      }
      for (const bl of list) {
        if (bl.sign < 0) continue;
        ctx.fillStyle = bl.color;
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "destination-out";
      for (const bl of list) {
        if (bl.sign > 0) continue;
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // influence rings
      if (p.showInfluence) {
        ctx.save();
        ctx.strokeStyle = "#7c5cff";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        for (const bl of list) {
          ctx.beginPath();
          ctx.arc(bl.x, bl.y, bl.r * p.kFactor, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // bridge preview: dashed center links; adherence ticks at neck midpoints
      if (p.bridgePreview || p.adherence) {
        for (const n of necks) {
          if (p.bridgePreview) {
            ctx.save();
            ctx.strokeStyle = "#00e5ff";
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(n.a.x, n.a.y);
            ctx.lineTo(n.b.x, n.b.y);
            ctx.stroke();
            ctx.restore();
          }
          if (p.adherence) {
            const mx = (n.a.x + n.b.x) / 2, my = (n.a.y + n.b.y) / 2;
            const ux = (n.b.x - n.a.x) / n.d, uy = (n.b.y - n.a.y) / n.d;
            ctx.save();
            ctx.strokeStyle = "#ff5c7a";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(mx - uy * 8, my + ux * 8);
            ctx.lineTo(mx + uy * 8, my - ux * 8);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // brush ring
      ctx.save();
      ctx.strokeStyle = "#0e0e14";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const necks = useMemo(() => bridgePairs(blobs, kFactor), [blobs, kFactor]);
  const groups = useMemo(() => components(blobs, necks), [blobs, necks]);

  const onCanvasMove = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    setBrush((b) => ({
      ...b,
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    }));
  };

  const exportSVG = () => {
    const p = paramRef.current;
    const parts = [
      `<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="#fdfaf3"/>`,
      ...necks.map((n) => `<path d="${neckPath(n.a, n.b, n.d, p.kFactor, p.goo, p.handleSize)}" fill="${n.a.color}"/>`),
      ...blobs.filter((b) => b.sign > 0).map((b) => `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r.toFixed(1)}" fill="${b.color}"/>`),
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}"><!-- arc-metaball K=${p.kFactor} v=${p.goo} -->${parts.join("")}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "arc-metaball.svg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <NCTGraphiteStage className="nctgraphite-font-sans">
      <header className="h-[60px] shrink-0 flex items-center gap-4 px-4 border-b border-[#1a1a24] bg-[#0e0e14]">
        <div className="w-8 h-8 rounded-[8px] bg-[#7c5cff] grid place-items-center font-bold">A</div>
        <h1 className="text-[13px] tracking-[0.18em] text-[#f5f1e8] font-bold">ARC METABALL GRID LAB — SATO BRIDGES, NO MARCHING SQUARES</h1>
        <span className="text-[10px] tracking-widest text-[#9a958c]">
          {blobs.filter((b) => b.sign > 0).length} BLOBS • {necks.length} NECKS • {groups.length} COMPONENTS
        </span>
      </header>

      <NCTGraphiteStageBody>
        <NCTGraphiteStagePanel side="left" width={220} className="bg-[#0e0e14] border-r border-[#1a1a24] p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
          <div className="text-[11px] tracking-[0.18em] text-[#7a7680]">CONTROLS / KEY-MAP</div>
          <NCTGraphiteKeyMap commands={ARC_COMMANDS} keyMap={keyMap} rebinding={rebinding} onRebind={beginRebind} />
          <div className="text-[10px] leading-[1.5] text-[#7a7680]">
            Bridges form when d ≤ r1 + r2·K (Sato K = 2.5). Necks follow M p1 C h1 h3 p3 A r r 0 · 0 p4 C h4 h2 p2 Z.
          </div>
          <NCTGraphiteToggle label="Snap to grid" checked={snap} onChange={setSnap} />
          <NCTGraphiteToggle label="Show influence" checked={showInfluence} onChange={setShowInfluence} />
          <NCTGraphiteToggle label="Bridge preview" checked={bridgePreview} onChange={setBridgePreview} />
          <NCTGraphiteToggle label="Adherence ticks" checked={adherence} onChange={setAdherence} />
          <NCTGraphiteToggle label="Heatmap" checked={heatmap} onChange={setHeatmap} />
        </NCTGraphiteStagePanel>

        <NCTGraphiteStageMain className="items-center bg-[#14141d] p-2 md:p-4 gap-3">
          <div className="w-full max-w-[960px] text-[10px] tracking-widest text-[#9a958c] flex justify-between">
            <span>CANVAS — CLICK PLACES VIA KEYS • BRUSH {Math.round(brush.r)}px</span>
            <span>{heldActions.size > 0 ? [...heldActions].join(" + ").toUpperCase() : "IDLE — AIM"}</span>
          </div>
          <div className="w-full max-w-[960px] rounded-[8px] overflow-hidden border border-[#23232f]" onMouseMove={onCanvasMove}>
            <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="w-full block" style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }} />
          </div>
        </NCTGraphiteStageMain>
        <NCTGraphiteToast message={toast} className="bg-[#7c5cff] text-white" />

        <NCTGraphiteStagePanel side="right" width={300} className="bg-[#0e0e14] border-l border-[#1a1a24] p-4 flex flex-col gap-5 shrink-0 overflow-y-auto">
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">ENGINE</div>
            <NCTGraphiteSlider label="GRID RESOLUTION" value={snapStep} min={8} max={64} format={(v) => `${Math.round(v)}px`} onChange={(v) => setSnapStep(Math.round(v))} />
            <NCTGraphiteSlider label="MAX-DIST FACTOR K" value={kFactor} min={1} max={4} step={0.1} format={(v) => v.toFixed(1)} onChange={setKFactor} />
            <NCTGraphiteSlider label="GOO TIGHTNESS" value={goo} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={setGoo} />
            <NCTGraphiteSlider label="HANDLE SIZE" value={handleSize} min={0} max={80} format={(v) => `${Math.round(v)}px`} onChange={(v) => setHandleSize(Math.round(v))} />
            <NCTGraphiteSlider label="BRUSH RADIUS" value={brush.r} min={12} max={220} format={(v) => `${Math.round(v)}px`} onChange={(v) => setBrush((b) => ({ ...b, r: Math.round(v) }))} />
          </div>
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">ACTIVE COLOR</div>
            <NCTGraphiteGrid columns="repeat(8, 1fr)" gap={6}>
              {PALETTE.map((col, i) => (
                <NCTGraphiteSwatch key={col + i} color={col} selected={i === colorIdx} onSelect={() => setColorIdx(i)} />
              ))}
            </NCTGraphiteGrid>
          </div>
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">COMPONENTS ({groups.length})</div>
            <NCTGraphiteStack direction="column" gap={6}>
              {groups.length === 0 && <div className="text-[11px] text-[#7a7680]">No positive blobs. Press G to place one.</div>}
              {groups.map((g, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-[8px] bg-[#15151e] border border-[#23232f]">
                  <div className="w-4 h-4 rounded-full" style={{ background: g[0].color }} />
                  <span className="text-[11px] text-white">g{i}</span>
                  <span className="text-[10px] text-[#7a7680]">{g.length} blobs</span>
                </div>
              ))}
            </NCTGraphiteStack>
          </div>
          <NCTGraphiteStack direction="row" gap={8}>
            <button onClick={exportSVG} className="flex-1 py-2.5 text-[11px] bg-[#fdfaf3] text-black rounded font-bold hover:bg-white">EXPORT SVG</button>
            <button onClick={() => { setBlobs([]); flash("CLEARED ALL"); }} className="flex-1 py-2.5 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded font-bold border border-[#23232f]">CLEAR ALL</button>
          </NCTGraphiteStack>
        </NCTGraphiteStagePanel>
      </NCTGraphiteStageBody>

      <NCTGraphiteStageFooter>
        <span>ARC METABALL GRID LAB • SATO EXACT, NO MARCHING SQUARES • MONO JetBrains Mono</span>
        <span className="hidden md:inline">G + • H − • F INFLATE • B BRIDGE • E ERASE • N COLOR</span>
      </NCTGraphiteStageFooter>
    </NCTGraphiteStage>
  );
}

