import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  NCTGraphiteSlider, NCTGraphiteStack, NCTGraphiteGrid,
  NCTGraphiteAppShell, NCTGraphiteStagePanel, NCTGraphiteStageMain,
  NCTGraphiteStageFooter, NCTGraphiteToggle, NCTGraphiteSegmented,
  NCTGraphiteKeyMap, NCTGraphiteDialog, NCTGraphiteToast, useNCTGraphiteCommands,
  NCTGraphiteButton, makeVectorField, vectorStyle, stampVectorField, applyVectorAttractors, constrainVectorField, findVectorBrushOp, VECTOR_BRUSH_OPS,
} from "@nct/nctgraphite";
import type { NCTGraphiteCommandDef, VectorFieldMode, VectorStyle } from "@nct/nctgraphite";
export { vectorStyle };
export type { VectorStyle };

type FieldMode = VectorFieldMode;
type Vec = { x: number; y: number; vx: number; vy: number };
type Attractor = { id: number; x: number; y: number; r: number; orbit: boolean; reverse?: boolean };

const CANVAS_W = 960;
const CANVAS_H = 680;

const svgIcon = (inner: string) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: inner }} />
);
const HELP_ICON = svgIcon('<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.2c.2-1 1-1.6 1.9-1.6 1 0 1.9.7 1.9 1.7 0 1.2-1.2 1.4-1.9 2.1v.7"/><circle cx="8.1" cy="11.6" r="0.4" fill="currentColor" stroke="none"/>');
const CLOSE_ICON = svgIcon('<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>');
const DOWNLOAD_ICON = svgIcon('<path d="M8 2v8M4.8 7.2L8 10.4l3.2-3.2"/><path d="M3 12.5h10"/>');
const UPLOAD_ICON = svgIcon('<path d="M8 10.4V2.4M4.8 5.6L8 2.4l3.2 3.2"/><path d="M3 12.5h10"/>');
const TRASH_ICON = svgIcon('<path d="M3 4.5h10M6.5 4.5V3h3v1.5"/><path d="M4.5 4.5l.7 8.5h5.6l.7-8.5"/><path d="M6.8 7v4M9.2 7v4"/>');

const PICKER_OPS = VECTOR_BRUSH_OPS.filter((op) => op.picker);
const EDIT_OPS = VECTOR_BRUSH_OPS.filter((op) => !op.picker && op.key);

const VECTOR_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: "paint", label: "Paint / Flow", desc: "Stamp flow in brush", defaultKey: "f" },
  ...PICKER_OPS.filter((op) => op.key).map((op) => ({
    id: op.id,
    label: `${op.label} Paint`,
    desc: `Momentary ${op.label.toLowerCase()} paint while held`,
    defaultKey: op.key!,
  })),
  ...EDIT_OPS.map((op) => ({
    id: op.id,
    label: op.label,
    desc: op.blurb,
    defaultKey: op.key!,
  })),
  { id: "attractor", label: "Attractor", desc: "Drop attractor at brush", defaultKey: "n" },
  { id: "smaller", label: "Brush -", desc: "Shrink brush", defaultKey: "[" },
  { id: "larger", label: "Brush +", desc: "Grow brush", defaultKey: "]" },
  { id: "clear", label: "Clear", desc: "Zero entire field", defaultKey: "x" },
];

const PAINT_KEY_IDS = new Set(["paint", ...PICKER_OPS.map((op) => op.id)]);
const PAINT_GROUP_IDS = new Set([...PAINT_KEY_IDS, "erase"]);
const PAINT_COMMANDS = VECTOR_COMMANDS.filter((c) => PAINT_GROUP_IDS.has(c.id));
const REST_COMMANDS = VECTOR_COMMANDS.filter((c) => !PAINT_GROUP_IDS.has(c.id));

const MODES = PICKER_OPS.map((op) => ({ value: op.id, label: op.shortLabel }));

let nextId = 1;

function makeField(cols: number, rows: number): Vec[] {
  return makeVectorField(cols, rows, CANVAS_W, CANVAS_H);
}

function mag(vx: number, vy: number) {
  return Math.hypot(vx, vy);
}

export default function App() {
  const [cols, setCols] = useState(48);
  const [rows, setRows] = useState(32);
  const [field, setField] = useState<Vec[]>(() => makeField(48, 32));
  const [attractors, setAttractors] = useState<Attractor[]>([]);
  const [brush, setBrush] = useState({ x: CANVAS_W / 2, y: CANVAS_H / 2, r: 90, px: CANVAS_W / 2, py: CANVAS_H / 2, vx: 0, vy: 0 });
  const [strength, setStrength] = useState(1);
  const [mode, setMode] = useState<FieldMode>("velocity");
  const [particleCount, setParticleCount] = useState(600);
  const [showVectors, setShowVectors] = useState(true);
  const [showParticles, setShowParticles] = useState(false);
  const [showAttractors, setShowAttractors] = useState(true);
  const [flowTrails, setFlowTrails] = useState(true);
  const [hoverThin, setHoverThin] = useState(true);
  const [angleMin, setAngleMin] = useState(0);
  const [angleMax, setAngleMax] = useState(360);
  const [angleStep, setAngleStep] = useState(0);
  const [lengthMin, setLengthMin] = useState(0);
  const [lengthMax, setLengthMax] = useState(3);
  const [weight, setWeight] = useState(2.2);
  const [minWidth, setMinWidth] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labHeldRef = useRef<Set<string>>(new Set());
  const lastStampRef = useRef(0);
  const fieldRef = useRef(field);
  useEffect(() => { fieldRef.current = field; }, [field]);
  const brushRef = useRef(brush);
  useEffect(() => { brushRef.current = brush; }, [brush]);
  const attrRef = useRef(attractors);
  useEffect(() => { attrRef.current = attractors; }, [attractors]);
  const limits = { angleMin, angleMax, angleStep, lengthMin, lengthMax };
  const paramRef = useRef({ cols, rows, strength, mode, particleCount, showVectors, showParticles, showAttractors, flowTrails, hoverThin, limits, weight, minWidth });
  useEffect(() => {
    paramRef.current = { cols, rows, strength, mode, particleCount, showVectors, showParticles, showAttractors, flowTrails, hoverThin, limits, weight, minWidth };
  }, [cols, rows, strength, mode, particleCount, showVectors, showParticles, showAttractors, flowTrails, hoverThin, angleMin, angleMax, angleStep, lengthMin, lengthMax, weight, minWidth]);
  useEffect(() => {
    const next = constrainVectorField(fieldRef.current, { angleMin, angleMax, angleStep, lengthMin, lengthMax });
    fieldRef.current = next;
    setField(next);
  }, [angleMin, angleMax, angleStep, lengthMin, lengthMax]);
  const partsRef = useRef<{ x: number; y: number }[]>([]);
  // The scene redraws every frame, while this separate layer retains only
  // particle marks. Keeping UI overlays out of the trail buffer prevents the
  // brush ring from being stamped along the cursor path.
  const particleTrailRef = useRef<HTMLCanvasElement | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  };

  const stampAt = (bx: number, by: number, kind: "paint" | "erase" | "smooth", mvx = 0, mvy = 0, forceMode?: FieldMode) => {
    const b = brushRef.current;
    const p = paramRef.current;
    setField(stampVectorField(fieldRef.current, {
      columns: p.cols,
      rows: p.rows,
      x: bx,
      y: by,
      radius: b.r,
      action: kind,
      mode: forceMode ?? p.mode,
      strength: p.strength,
      velocityX: mvx,
      velocityY: mvy,
      limits: p.limits,
    }));
  };

  const { keyMap, heldActions } = useNCTGraphiteCommands({
    commands: VECTOR_COMMANDS,
    ignoreInputs: true,
    preventDefaultKeys: [" ", "x"],
    onAction: (id) => {
      const b = brushRef.current;
      const brushOp = findVectorBrushOp(id);
      if (id === "paint") stampAt(b.x, b.y, "paint", b.vx, b.vy);
      else if (brushOp?.picker) stampAt(b.x, b.y, "paint", b.vx, b.vy, brushOp.id as FieldMode);
      else if (brushOp) stampAt(b.x, b.y, brushOp.id as "erase" | "smooth");
      if (id === "attractor") {
        const dropped = findVectorBrushOp(paramRef.current.mode)?.attractor ?? { orbit: false };
        setAttractors((prev) => [...prev, { id: nextId++, x: b.x, y: b.y, r: b.r, ...dropped }]);
        flash("ATTRACTOR DROPPED");
      }
      if (id === "smaller") setBrush((p) => ({ ...p, r: Math.max(18, p.r - 12) }));
      if (id === "larger") setBrush((p) => ({ ...p, r: Math.min(320, p.r + 12) }));
      if (id === "clear") {
        setField(makeField(paramRef.current.cols, paramRef.current.rows));
        setAttractors([]);
        flash("FIELD CLEARED");
      }
    },
    onRebind: (action, key) => flash(`BOUND ${action.toUpperCase()} → [${key.toUpperCase()}]`),
  });
  useEffect(() => { labHeldRef.current = heldActions; }, [heldActions]);

  const activeKeyLabel =
    heldActions.size > 0
      ? [...heldActions]
          .map((id) => VECTOR_COMMANDS.find((c) => c.id === id)?.label ?? id)
          .join(' • ')
          .toUpperCase()
      : null;

  const rebuildField = (c: number, r: number) => {
    const next = makeField(c, r);
    // A slider input and a held paint key can occur in the same frame. Update
    // the render-loop sources synchronously so it never indexes the old grid
    // with the new dimensions.
    fieldRef.current = next;
    paramRef.current = { ...paramRef.current, cols: c, rows: r };
    lastStampRef.current = 0;
    setCols(c);
    setRows(r);
    setField(next);
  };

  // Render loop: field vectors, attractor swirl, advected particles.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const p = paramRef.current;
      const f = fieldRef.current;
      const b = brushRef.current;
      const cw = CANVAS_W / p.cols, ch = CANVAS_H / p.rows;

      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // attractor influence, then the field angle and length gates
      if (attrRef.current.length > 0) {
        const influenced = applyVectorAttractors(f, attrRef.current, p.limits);
        for (let i = 0; i < f.length; i++) {
          f[i].vx = influenced[i].vx;
          f[i].vy = influenced[i].vy;
        }
      }

      // held paint/erase/smooth apply continuously at the brush;
      // a held mode key overrides the selected brush op
      const held = labHeldRef.current;
      if (held.size > 0) {
        const f = fieldRef.current;
        const b = brushRef.current;
        const force = [...held].map((id) => findVectorBrushOp(id)).find((op) => op?.picker);
        const op = held.has("erase") ? "erase" : held.has("smooth") ? "smooth" : force?.id ?? (held.has("paint") ? p.mode : null);
        if (op) {
          const next = stampVectorField(f, {
            columns: p.cols,
            rows: p.rows,
            x: b.x,
            y: b.y,
            radius: b.r,
            op,
            strength: p.strength,
            velocityX: b.vx,
            velocityY: b.vy,
            paintScale: 0.2,
            limits: p.limits,
          });
          const now = performance.now();
          if (now - lastStampRef.current > 80) {
            lastStampRef.current = now;
            fieldRef.current = next;
            setField(next);
          }
        }
      }

      // idle grid dots under everything
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      for (const v of f) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }

      if (p.showVectors) {
        const held = labHeldRef.current;
        const painting = held.has("paint") || [...held].some((id) => findVectorBrushOp(id));
        const minCell = Math.min(cw, ch);
        for (const v of f) {
          const inBrush = Math.hypot(v.x - b.x, v.y - b.y) < b.r;
          const st = vectorStyle(v.vx, v.vy, p.hoverThin && inBrush && !painting, { weight: p.weight, minWidth: p.minWidth });
          if (st.skip) continue;
          const J = st.m * minCell * 0.9;
          ctx.save();
          ctx.translate(v.x, v.y);
          ctx.rotate(Math.atan2(v.vy, v.vx));
          ctx.strokeStyle = `hsla(${st.hue}, 95%, ${st.light}%, ${st.alpha})`;
          ctx.lineWidth = st.width;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(J, 0);
          ctx.stroke();
          if (st.arrow) {
            ctx.beginPath();
            ctx.moveTo(J, 0);
            ctx.lineTo(J - 5, -2.5);
            ctx.lineTo(J - 5, 2.5);
            ctx.closePath();
            ctx.fillStyle = `hsla(${st.hue}, 95%, 62%, ${st.alpha})`;
            ctx.fill();
          }
          ctx.restore();
          if (inBrush && painting) {
            ctx.fillStyle = "rgba(0,229,255,0.15)";
            ctx.beginPath();
            ctx.arc(v.x, v.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      if (p.showAttractors) {
        for (const a of attrRef.current) {
          ctx.save();
          ctx.strokeStyle = a.orbit ? "#ff2d95" : a.reverse ? "#ffe14a" : "#00e5ff";
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (p.showParticles) {
        const want = p.particleCount;
        const parts = partsRef.current;
        let trail = particleTrailRef.current;
        if (!trail) {
          trail = document.createElement("canvas");
          trail.width = CANVAS_W;
          trail.height = CANVAS_H;
          particleTrailRef.current = trail;
        }
        const trailCtx = trail.getContext("2d");
        if (!trailCtx) return;
        if (p.flowTrails) {
          trailCtx.fillStyle = "rgba(10, 10, 15, 0.28)";
          trailCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        } else {
          trailCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        }
        while (parts.length < want) parts.push({ x: Math.random() * CANVAS_W, y: Math.random() * CANVAS_H });
        parts.length = Math.min(parts.length, Math.max(want, 0));
        trailCtx.fillStyle = "#ffffff";
        for (const pt of parts) {
          const i = Math.max(0, Math.min(p.cols - 1, Math.floor(pt.x / cw)));
          const j = Math.max(0, Math.min(p.rows - 1, Math.floor(pt.y / ch)));
          const v = f[j * p.cols + i];
          pt.x += v.vx * 2;
          pt.y += v.vy * 2;
          if (pt.x < 0 || pt.y < 0 || pt.x > CANVAS_W || pt.y > CANVAS_H) {
            pt.x = Math.random() * CANVAS_W;
            pt.y = Math.random() * CANVAS_H;
          }
          trailCtx.fillRect(pt.x, pt.y, 1.5, 1.5);
        }
        ctx.drawImage(trail, 0, 0);
      } else if (particleTrailRef.current) {
        particleTrailRef.current.getContext("2d")?.clearRect(0, 0, CANVAS_W, CANVAS_H);
      }

      // spotlight: when hover-thinning is off, darken outside the brush
      // circle so the full-strength field inside it stands out
      if (!p.hoverThin) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, CANVAS_W, CANVAS_H);
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.clip("evenodd");
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
      }

      // brush ring
      ctx.save();
      ctx.strokeStyle = "#fdfaf3";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onCanvasMove = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    setBrush((b) => ({ ...b, vx: x - b.x, vy: y - b.y, px: b.x, py: b.y, x, y }));
  };

  const energy = useMemo(() => {
    if (!field.length) return 0;
    return field.reduce((s, v) => s + mag(v.vx, v.vy), 0) / field.length;
  }, [field]);
  const liveCount = useMemo(() => field.filter((v) => mag(v.vx, v.vy) > 0.05).length, [field]);

  const exportJSON = () => {
    const data = { cols, rows, vectors: field.map((v) => [v.vx, v.vy]), attractors };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "vector-field.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const importJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.vectors)) throw new Error("bad field");
        setCols(data.cols);
        setRows(data.rows);
        setField(data.vectors.map(([vx, vy]: number[], k: number) => ({
          x: (k % data.cols + 0.5) * (CANVAS_W / data.cols),
          y: (Math.floor(k / data.cols) + 0.5) * (CANVAS_H / data.rows),
          vx, vy,
        })));
        setAttractors(data.attractors ?? []);
        flash("FIELD IMPORTED");
      } catch {
        flash("IMPORT FAILED");
      }
    };
    reader.readAsText(file);
  };

  const clearAll = () => {
    if (window.confirm("Clear the entire field and all attractors?")) {
      setField(makeField(cols, rows));
      setAttractors([]);
      flash("CLEARED ALL");
    }
  };

  return (
    <NCTGraphiteAppShell
      className="nctgraphite-font-alt-mono"
      gap={0}
      proportion="220px 1fr 300px"
      header={<>
      <header className="h-[60px] shrink-0 flex items-center gap-4 px-4 border-b border-[#1a1a24] bg-[#0e0e14]">
        <div className="w-8 h-8 rounded-[8px] bg-[#00e5ff] grid place-items-center font-bold text-black">V</div>
        <h1 className="nctgraphite-font-display text-[18px] text-[#f5f1e8]">Grid Paint Vector Field — <em className="text-[#00e5ff]">hold F</em></h1>
        <span className="text-[10px] tracking-widest text-[#9a958c]">
          {liveCount} LIVE • {attractors.length} ATTRACTORS • AVG {energy.toFixed(2)}
        </span>
        <NCTGraphiteButton
          label="? HELP"
          icon={HELP_ICON}
          onClick={() => setHelpOpen(true)}
          className="ml-auto px-2 py-1 rounded-[7px] text-[#7a7680] hover:text-white"
        />
      </header>

      <NCTGraphiteDialog open={helpOpen} onClose={() => setHelpOpen(false)} title="? HELP — KEY-CLICK PHILOSOPHY">
        <div className="flex flex-col gap-4 text-[12px] leading-[1.5] text-[#e8e6df]">
          <p className="nctgraphite-font-display text-[15px]">MOUSE AIMS. KEYS ACT. — A PLAYABLE TALK DEMO</p>
          <div>
            <h3 className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-1">HOW TO PAINT</h3>
            <p>Move to aim the brush, hold a key to act. F stamps flow along the current field mode, E erases, Q smooths, N drops an attractor. Hold G, V, or C to paint momentarily in Seek, Velocity, or Swirl. Whip the mouse in VELOCITY mode for streams.</p>
          </div>
          <div>
            <h3 className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-1">CORE LOOP</h3>
            <p>Aim → hold key → watch particles advect → release. Attractors bend the field: PULL sucks in, PUSH blows out, ORBIT / CW stir both ways.</p>
          </div>
          <div>
            <h3 className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-2">ANGLE → COLOR LEGEND</h3>
            <div className="h-2 w-full rounded-full" style={{ background: "linear-gradient(90deg, hsl(0,95%,62%), hsl(60,95%,62%), hsl(120,95%,62%), hsl(180,95%,62%), hsl(240,95%,62%), hsl(300,95%,62%), hsl(360,95%,62%))" }} />
            <div className="flex justify-between text-[9px] text-[#7a7680] mt-1">
              <span>← 0°</span><span>90°</span><span>180°</span><span>→ 360°</span>
            </div>
            <p className="text-[10px] leading-relaxed text-[#9a958c] mt-2">
              <span className="text-[#00e5ff] font-bold">TIP:</span> Use VELOCITY mode + fast mouse moves to paint streams. Drop attractors with N to make sinks.
            </p>
          </div>
          <NCTGraphiteButton
            label="CLOSE — BACK TO PAINT"
            icon={CLOSE_ICON}
            onClick={() => setHelpOpen(false)}
            className="py-2.5 rounded-[8px] bg-[#00e5ff] border-[#00e5ff] text-black"
          />
        </div>
      </NCTGraphiteDialog>
      </>}
      footer={
      <NCTGraphiteStageFooter>
        <span>GRID PAINT VECTOR FIELD • FLOW, TWIST, AND EDIT • BUILT FOR TALKS · NO BACKEND · CANVAS 2D</span>
        <span className="hidden md:inline">F PAINTS THE MODE • A/D AMP/DAMP • R ROTATE • S SMUDGE • J DRAIN • T TURB • M NORM • I INVERT</span>
      </NCTGraphiteStageFooter>
      }
    >
        <NCTGraphiteStagePanel side="left" width={220} className="bg-[#0e0e14] border-r border-[#1a1a24] p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
          <div className="rounded-[18px] bg-[var(--panel-2)] text-[#fdfaf3] p-3 border border-white/10">
            <div className="text-[10px] tracking-[0.18em] opacity-60 mb-3 [font-family:var(--font-alt-mono)]">CONTROLS / KEY-MAP</div>
            <div className="text-[10px] tracking-[0.12em] opacity-50 mb-2 [font-family:var(--font-alt-mono)]">PAINT + ERASE</div>
            <NCTGraphiteKeyMap commands={PAINT_COMMANDS} keyMap={keyMap} heldActions={heldActions} emphasizeIds={PAINT_KEY_IDS} />
            <div className="text-[10px] tracking-[0.12em] opacity-50 mb-2 mt-3 [font-family:var(--font-alt-mono)]">FIELD + BRUSH</div>
            <NCTGraphiteKeyMap commands={REST_COMMANDS} keyMap={keyMap} heldActions={heldActions} />
            <NCTGraphiteStack direction="row" gap={8} className="mt-3">
              <div className={`flex-1 h-[36px] rounded-full grid place-items-center text-[11px] font-bold transition [font-family:var(--font-alt-mono)] ${activeKeyLabel ? 'bg-[#00e5ff] text-black' : 'bg-white/10 text-white/50'}`}>
                {activeKeyLabel ? `● ${activeKeyLabel}` : 'IDLE — MOVE MOUSE'}
              </div>
            </NCTGraphiteStack>
          </div>
          <NCTGraphiteStack direction="row" gap={8}>
            <NCTGraphiteButton label="EXPORT JSON" icon={DOWNLOAD_ICON} onClick={exportJSON} className="flex-1" />
            <label className="flex-1 inline-flex items-center justify-center gap-[6px] py-2 px-3 text-[11px] bg-[#1a1a24] hover:bg-[#222230] rounded font-bold border border-[#23232f] text-center cursor-pointer">
              {UPLOAD_ICON}<span>IMPORT</span>
              <input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJSON(f); e.target.value = ""; }} />
            </label>
          </NCTGraphiteStack>
          <NCTGraphiteButton label="CLEAR ALL (CONFIRM)" icon={TRASH_ICON} onClick={clearAll} className="w-full" />
        </NCTGraphiteStagePanel>

        <NCTGraphiteStageMain className="items-center bg-[#14141d] p-2 md:p-4 gap-3">
          <div className="w-full max-w-[960px] text-[10px] tracking-widest text-[#9a958c] flex justify-between">
            <span>CANVAS — MOVE TO AIM • HOLD KEY TO PAINT FLOWS</span>
            <span>{heldActions.size > 0 ? [...heldActions].join(" + ").toUpperCase() : "IDLE — AIM"}</span>
          </div>
          <div className="w-full max-w-[960px] rounded-[8px] overflow-hidden border border-[#23232f]" onMouseMove={onCanvasMove}>
            <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="w-full block" style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }} />
          </div>
          <NCTGraphiteToast message={toast} />
          <NCTGraphiteStack direction="row" gap={8} className="w-full max-w-[960px]">
            <NCTGraphiteToggle label="Vectors" checked={showVectors} onChange={setShowVectors} />
            <NCTGraphiteToggle label="Follow particles" checked={showParticles} onChange={setShowParticles} />
            <NCTGraphiteToggle label="Attractors" checked={showAttractors} onChange={setShowAttractors} />
            <NCTGraphiteToggle label="Flow trails" checked={flowTrails} onChange={setFlowTrails} />
            <NCTGraphiteToggle label="Hover thin" checked={hoverThin} onChange={setHoverThin} />
          </NCTGraphiteStack>
        </NCTGraphiteStageMain>

        <NCTGraphiteStagePanel side="right" width={300} className="bg-[#0e0e14] border-l border-[#1a1a24] p-4 flex flex-col gap-5 shrink-0 overflow-y-auto">
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">FIELD MODE</div>
            <NCTGraphiteSegmented options={MODES} value={mode} onChange={(v) => setMode(v as FieldMode)} />
            <div className="text-[10px] text-[#7a7680] mt-2 leading-[1.4]">{findVectorBrushOp(mode)?.blurb}</div>
          </div>
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">BRUSH & FIELD</div>
            <NCTGraphiteSlider label="BRUSH SIZE" value={brush.r} min={18} max={320} format={(v) => `${Math.round(v)}px`} onChange={(v) => setBrush((b) => ({ ...b, r: Math.round(v) }))} />
            <NCTGraphiteSlider label="STRENGTH" value={strength} min={0.1} max={3} step={0.1} format={(v) => `${v.toFixed(1)}x`} onChange={setStrength} />
            <NCTGraphiteSlider label="GRID RESOLUTION" value={cols} min={16} max={96} format={(v) => `${Math.round(v)}×${Math.round((Math.round(v) * CANVAS_H) / CANVAS_W)}`} onChange={(v) => rebuildField(Math.round(v), Math.round((Math.round(v) * CANVAS_H) / CANVAS_W))} />
            <NCTGraphiteSlider label="PARTICLES" value={particleCount} min={0} max={2000} step={50} format={(v) => `${Math.round(v)}`} onChange={(v) => setParticleCount(Math.round(v))} />
          </div>
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">LIMITS & STROKE</div>
            <NCTGraphiteSlider label="ANGLE MIN" value={angleMin} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => setAngleMin(Math.round(v))} />
            <NCTGraphiteSlider label="ANGLE MAX" value={angleMax} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => setAngleMax(Math.round(v))} />
            <NCTGraphiteSlider label="ANGLE STEP" value={angleStep} min={0} max={90} step={1} format={(v) => v < 0.5 ? 'off' : `${Math.round(v)}°`} onChange={(v) => setAngleStep(Math.round(v))} />
            <NCTGraphiteSlider label="LENGTH MIN" value={lengthMin} min={0} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={setLengthMin} />
            <NCTGraphiteSlider label="LENGTH MAX" value={lengthMax} min={0} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={setLengthMax} />
            <NCTGraphiteSlider label="WEIGHT" value={weight} min={0} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={setWeight} />
            <NCTGraphiteSlider label="MIN WIDTH" value={minWidth} min={0.5} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={setMinWidth} />
          </div>
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">ATTRACTORS ({attractors.length})</div>
            <NCTGraphiteStack direction="column" gap={6}>
              {attractors.length === 0 && <div className="text-[11px] text-[#7a7680]">Press N over the canvas to drop one.</div>}
              {attractors.map((a) => (
                <div key={a.id} className="flex items-center gap-2 p-2 rounded-[8px] bg-[#15151e] border border-[#23232f]">
                  <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: a.orbit ? "#ff2d95" : a.reverse ? "#ffe14a" : "#00e5ff" }} />
                  <span className="text-[11px] text-white flex-1">{Math.round(a.x)}, {Math.round(a.y)}</span>
                  <span className="text-[10px] text-[#7a7680]">{a.orbit ? (a.reverse ? "CW" : "ORBIT") : a.reverse ? "PUSH" : "PULL"}</span>
                  <button onClick={() => setAttractors((prev) => prev.filter((x) => x.id !== a.id))} className="text-[11px] text-[#7a7680] hover:text-[#ff4d6d]">×</button>
                </div>
              ))}
            </NCTGraphiteStack>
          </div>
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">LIVE FIELD</div>
            <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={8} className="text-[11px]">
              <div className="bg-[#1a1a24] p-2 rounded"><div className="text-[10px] text-[#9a958c]">AVG MAG</div><div className="font-bold">{energy.toFixed(2)}</div></div>
              <div className="bg-[#1a1a24] p-2 rounded"><div className="text-[10px] text-[#9a958c]">LIVE VECS</div><div className="font-bold">{liveCount}</div></div>
            </NCTGraphiteGrid>
          </div>
        </NCTGraphiteStagePanel>
    </NCTGraphiteAppShell>
  );
}
