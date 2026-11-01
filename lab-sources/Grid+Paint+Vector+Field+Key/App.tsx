import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  NCTGraphiteSlider, NCTGraphiteStack, NCTGraphiteGrid,
  NCTGraphiteAppShell, NCTGraphiteStagePanel, NCTGraphiteStageMain,
  NCTGraphiteStageFooter, NCTGraphiteToggle, NCTGraphiteSegmented,
  NCTGraphiteKeyMap, NCTGraphiteDialog, NCTGraphiteToast, useNCTGraphiteCommands,
  NCTGraphiteButton,
} from "@nct/nctgraphite";
import type { NCTGraphiteCommandDef } from "@nct/nctgraphite";

type FieldMode = "seek" | "velocity" | "swirl";
type Vec = { x: number; y: number; vx: number; vy: number };
type Attractor = { id: number; x: number; y: number; r: number; orbit: boolean };

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

const VECTOR_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: "paint", label: "Paint / Flow", desc: "Stamp flow in brush", defaultKey: "f" },
  { id: "paintSeek", label: "Seek Paint", desc: "Momentary seek paint while held", defaultKey: "g" },
  { id: "paintVelocity", label: "Velocity Paint", desc: "Momentary velocity paint while held", defaultKey: "v" },
  { id: "paintSwirl", label: "Swirl Paint", desc: "Momentary swirl paint while held", defaultKey: "c" },
  { id: "erase", label: "Erase", desc: "Zero vectors in brush", defaultKey: "e" },
  { id: "smooth", label: "Smooth", desc: "Average neighbors in brush", defaultKey: "q" },
  { id: "attractor", label: "Attractor", desc: "Drop attractor at brush", defaultKey: "n" },
  { id: "smaller", label: "Brush -", desc: "Shrink brush", defaultKey: "[" },
  { id: "larger", label: "Brush +", desc: "Grow brush", defaultKey: "]" },
  { id: "clear", label: "Clear", desc: "Zero entire field", defaultKey: "x" },
];

const PAINT_KEY_IDS = new Set(["paint", "paintSeek", "paintVelocity", "paintSwirl"]);
const PAINT_GROUP_IDS = new Set([...PAINT_KEY_IDS, "erase"]);
const PAINT_COMMANDS = VECTOR_COMMANDS.filter((c) => PAINT_GROUP_IDS.has(c.id));
const REST_COMMANDS = VECTOR_COMMANDS.filter((c) => !PAINT_GROUP_IDS.has(c.id));

const MODES: { value: FieldMode; label: string }[] = [
  { value: "seek", label: "SEEK" },
  { value: "velocity", label: "VELOCITY" },
  { value: "swirl", label: "SWIRL" },
];

let nextId = 1;

function makeField(cols: number, rows: number): Vec[] {
  const out: Vec[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      out.push({ x: (i + 0.5) * (CANVAS_W / cols), y: (j + 0.5) * (CANVAS_H / rows), vx: 0, vy: 0 });
    }
  }
  return out;
}

function mag(vx: number, vy: number) {
  return Math.hypot(vx, vy);
}

export interface VectorStyle {
  skip: boolean;
  m: number;
  hue: number;
  alpha: number;
  width: number;
  arrow: boolean;
  light: number;
}

/**
 * Original angle→color scheme: hue is the vector direction on a 0–360 wheel
 * (canvas y-down), lightness 62% (75% dimmed preview), alpha grows with
 * magnitude. Vectors under an idle brush render dimmed (preview); vectors
 * under a held paint key render full with arrowheads above 0.08.
 */
export function vectorStyle(vx: number, vy: number, preview: boolean): VectorStyle {
  const m = Math.hypot(vx, vy);
  if (m < 0.01) return { skip: true, m, hue: 0, alpha: 0, width: 0, arrow: false, light: 62 };
  const hue = ((Math.atan2(vy, vx) * 180) / Math.PI + 180) % 360;
  const alpha = Math.min(0.95, 0.25 + m * 0.9) * (preview ? 0.35 : 1);
  return {
    skip: false,
    m,
    hue,
    alpha,
    width: preview ? 1 : Math.max(1, m * 2.2),
    arrow: !preview && m > 0.08,
    light: preview ? 75 : 62,
  };
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
  const paramRef = useRef({ cols, rows, strength, mode, particleCount, showVectors, showParticles, showAttractors, flowTrails, hoverThin });
  useEffect(() => {
    paramRef.current = { cols, rows, strength, mode, particleCount, showVectors, showParticles, showAttractors, flowTrails, hoverThin };
  }, [cols, rows, strength, mode, particleCount, showVectors, showParticles, showAttractors, flowTrails, hoverThin]);
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
    const f = fieldRef.current;
    const b = brushRef.current;
    const p = paramRef.current;
    const mode = forceMode ?? p.mode;
    const next = f.map((v) => ({ ...v }));
    for (const v of next) {
      const d = Math.hypot(v.x - bx, v.y - by);
      if (d > b.r) continue;
      const fall = 1 - d / b.r;
      if (kind === "erase") { v.vx = 0; v.vy = 0; continue; }
      if (kind === "smooth") continue;
      const s = p.strength * fall;
      if (mode === "seek") {
        const dx = bx - v.x, dy = by - v.y;
        const m = Math.hypot(dx, dy) || 1;
        v.vx += (dx / m) * s;
        v.vy += (dy / m) * s;
      } else if (mode === "velocity") {
        v.vx += mvx * s * 0.05;
        v.vy += mvy * s * 0.05;
      } else {
        const dx = v.x - bx, dy = v.y - by;
        const m = Math.hypot(dx, dy) || 1;
        v.vx += (-dy / m) * s;
        v.vy += (dx / m) * s;
      }
      const m = mag(v.vx, v.vy);
      if (m > 3) { v.vx = (v.vx / m) * 3; v.vy = (v.vy / m) * 3; }
    }
    if (kind === "smooth") {
      const idx = (i: number, j: number) => j * p.cols + i;
      const src = next.map((v) => ({ ...v }));
      for (let j = 0; j < p.rows; j++) {
        for (let i = 0; i < p.cols; i++) {
          const v = src[idx(i, j)];
          if (Math.hypot(v.x - bx, v.y - by) > b.r) continue;
          let sx = 0, sy = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= p.cols || jj >= p.rows) continue;
              sx += src[idx(ii, jj)].vx; sy += src[idx(ii, jj)].vy; n++;
            }
          }
          next[idx(i, j)].vx = sx / n;
          next[idx(i, j)].vy = sy / n;
        }
      }
    }
    setField(next);
  };

  const { keyMap, heldActions } = useNCTGraphiteCommands({
    commands: VECTOR_COMMANDS,
    ignoreInputs: true,
    preventDefaultKeys: [" ", "x"],
    onAction: (id) => {
      const b = brushRef.current;
      if (id === "paint") stampAt(b.x, b.y, "paint", b.vx, b.vy);
      if (id === "erase") stampAt(b.x, b.y, "erase");
      if (id === "smooth") stampAt(b.x, b.y, "smooth");
      if (id === "attractor") {
        setAttractors((prev) => [...prev, { id: nextId++, x: b.x, y: b.y, r: b.r, orbit: paramRef.current.mode === "swirl" }]);
        flash("ATTRACTOR DROPPED");
      }
      if (id === "smaller") setBrush((p) => ({ ...p, r: Math.max(18, p.r - 12) }));
      if (id === "larger") setBrush((p) => ({ ...p, r: Math.min(320, p.r + 12) }));
      if (id === "clear") {
        setField(makeField(paramRef.current.cols, paramRef.current.rows));
        setAttractors([]);
        flash("FIELD CLEARED");
      }
      if (id === "paintSeek") stampAt(b.x, b.y, "paint", b.vx, b.vy, "seek");
      if (id === "paintVelocity") stampAt(b.x, b.y, "paint", b.vx, b.vy, "velocity");
      if (id === "paintSwirl") stampAt(b.x, b.y, "paint", b.vx, b.vy, "swirl");
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

      // attractor influence: tangential swirl or radial pull
      for (const a of attrRef.current) {
        for (const v of f) {
          const dx = v.x - a.x, dy = v.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d > a.r || d < 0.001) continue;
          const fall = 1 - d / a.r;
          if (a.orbit) {
            v.vx += (-dy / d) * fall * 0.06;
            v.vy += (dx / d) * fall * 0.06;
          } else {
            v.vx += (-dx / d) * fall * 0.04;
            v.vy += (-dy / d) * fall * 0.04;
          }
        }
      }

      // held paint/erase/smooth apply continuously at the brush;
      // G/V/C hold a momentary mode that overrides the selected one
      const held = labHeldRef.current;
      if (held.size > 0) {
        const f = fieldRef.current;
        const b = brushRef.current;
        const force = held.has("paintVelocity") ? "velocity" : held.has("paintSwirl") ? "swirl" : held.has("paintSeek") ? "seek" : null;
        const next = f.map((v) => ({ ...v }));
        let touched = false;
        for (const v of next) {
          if (Math.hypot(v.x - b.x, v.y - b.y) > b.r) continue;
          touched = true;
          if (held.has("erase")) { v.vx = 0; v.vy = 0; }
          else if (held.has("smooth")) { /* smoothed below in bulk */ }
          else if (held.has("paint") || force) {
            const fall = 1 - Math.hypot(v.x - b.x, v.y - b.y) / b.r;
            const s = paramRef.current.strength * fall;
            if ((force ?? paramRef.current.mode) === "seek") {
              const dx = b.x - v.x, dy = b.y - v.y;
              const m = Math.hypot(dx, dy) || 1;
              v.vx += (dx / m) * s * 0.2;
              v.vy += (dy / m) * s * 0.2;
            } else if ((force ?? paramRef.current.mode) === "velocity") {
              v.vx += b.vx * s * 0.01;
              v.vy += b.vy * s * 0.01;
            } else {
              const dx = v.x - b.x, dy = v.y - b.y;
              const m = Math.hypot(dx, dy) || 1;
              v.vx += (-dy / m) * s * 0.2;
              v.vy += (dx / m) * s * 0.2;
            }
          }
        }
        const now = performance.now();
        if (touched && now - lastStampRef.current > 80) {
          lastStampRef.current = now;
          fieldRef.current = next;
          setField(next);
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
        const painting = held.has("paint") || held.has("erase") || held.has("smooth") || held.has("paintSeek") || held.has("paintVelocity") || held.has("paintSwirl");
        const minCell = Math.min(cw, ch);
        for (const v of f) {
          const inBrush = Math.hypot(v.x - b.x, v.y - b.y) < b.r;
          const st = vectorStyle(v.vx, v.vy, p.hoverThin && inBrush && !painting);
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
          ctx.strokeStyle = a.orbit ? "#ff2d95" : "#00e5ff";
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
            <p>Aim → hold key → watch particles advect → release. Attractors bend the field: PULL sucks vectors in, ORBIT stirs them around.</p>
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
        <span>GRID PAINT VECTOR FIELD • SEEK / VELOCITY / SWIRL • BUILT FOR TALKS · NO BACKEND · CANVAS 2D</span>
        <span className="hidden md:inline">F FLOW • E ERASE • Q SMOOTH • N ATTRACTOR • G/V/C SEEK/VELO/SWIRL</span>
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
            <div className="text-[10px] text-[#7a7680] mt-2 leading-[1.4]">
              {mode === "seek" && "Vectors point at the cursor. Attractors pull."}
              {mode === "velocity" && "Vectors follow mouse speed — whip fast for streams."}
              {mode === "swirl" && "Brush paints vortices. New attractors go orbital."}
            </div>
          </div>
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">BRUSH & FIELD</div>
            <NCTGraphiteSlider label="BRUSH SIZE" value={brush.r} min={18} max={320} format={(v) => `${Math.round(v)}px`} onChange={(v) => setBrush((b) => ({ ...b, r: Math.round(v) }))} />
            <NCTGraphiteSlider label="STRENGTH" value={strength} min={0.1} max={3} step={0.1} format={(v) => `${v.toFixed(1)}x`} onChange={setStrength} />
            <NCTGraphiteSlider label="GRID RESOLUTION" value={cols} min={16} max={96} format={(v) => `${Math.round(v)}×${Math.round((Math.round(v) * CANVAS_H) / CANVAS_W)}`} onChange={(v) => rebuildField(Math.round(v), Math.round((Math.round(v) * CANVAS_H) / CANVAS_W))} />
            <NCTGraphiteSlider label="PARTICLES" value={particleCount} min={0} max={2000} step={50} format={(v) => `${Math.round(v)}`} onChange={(v) => setParticleCount(Math.round(v))} />
          </div>
          <div>
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">ATTRACTORS ({attractors.length})</div>
            <NCTGraphiteStack direction="column" gap={6}>
              {attractors.length === 0 && <div className="text-[11px] text-[#7a7680]">Press N over the canvas to drop one.</div>}
              {attractors.map((a) => (
                <div key={a.id} className="flex items-center gap-2 p-2 rounded-[8px] bg-[#15151e] border border-[#23232f]">
                  <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: a.orbit ? "#ff2d95" : "#00e5ff" }} />
                  <span className="text-[11px] text-white flex-1">{Math.round(a.x)}, {Math.round(a.y)}</span>
                  <span className="text-[10px] text-[#7a7680]">{a.orbit ? "ORBIT" : "PULL"}</span>
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
