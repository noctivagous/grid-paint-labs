import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { NCTGraphiteSlider, NCTGraphiteStack, NCTGraphiteGrid, NCTGraphiteAppShell, useNCTGraphiteCommands } from "@nct/nctgraphite";
import type { NCTGraphiteCommandDef } from "@nct/nctgraphite";

const SHADING_COMMANDS: NCTGraphiteCommandDef[] = [
  { id: "f", label: "GROW", desc: "increase dot gain", defaultKey: "f" },
  { id: "e", label: "SHRINK", desc: "decrease dot gain", defaultKey: "e" },
  { id: "q", label: "SMOOTH", desc: "avg with neighbors", defaultKey: "q" },
  { id: "x", label: "CLEAR", desc: "reset to 1px in brush", defaultKey: "x" },
  { id: "[", label: "RADIUS", desc: "shrink brush", defaultKey: "[" },
  { id: "]", label: "RADIUS", desc: "grow brush", defaultKey: "]" },
  { id: "-", label: "INTENSITY", desc: "lower gain speed", defaultKey: "-", aliases: ["_"] },
  { id: "=", label: "INTENSITY", desc: "raise gain speed", defaultKey: "=", aliases: ["+"] },
  { id: "c", label: "NEW SHAPE", desc: "cycle shape", defaultKey: "c" },
  { id: "r", label: "RE-JITTER", desc: "re-randomize positions", defaultKey: "r" },
];

type ShapeType = "Circle" | "Diamond" | "Square" | "Triangle" | "Line" | "Cross" | "Plus";
type FalloffType = "Linear" | "Smoothstep" | "Gaussian" | "Sharp";
type RotationMode = "None" | "Random" | "Brush Direction" | "Radial" | "Brush + Random" | "Spiral";
type ColorMode = "Mono" | "Density" | "Group";

type Point = {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  radius: number;
  rotation: number;
  col: number;
  row: number;
};

const CANVAS_W = 960;
const CANVAS_H = 680;

const SHAPES: ShapeType[] = ["Circle","Diamond","Square","Triangle","Line","Cross","Plus"];
const FALLOFFS: FalloffType[] = ["Linear","Smoothstep","Gaussian","Sharp"];
const ROT_MODES: RotationMode[] = ["None","Random","Brush Direction","Radial","Brush + Random","Spiral"];

export default function App(){
  // Grid
  const [cols,setCols] = useState(48);
  const [rows,setRows] = useState(32);
  const [jitterAmount,setJitterAmount] = useState(0.65);
  const [useJitter,setUseJitter] = useState(true);
  const [showGrid,setShowGrid] = useState(false);
  const [maxRadius,setMaxRadius] = useState(14);
  const [minRadius,setMinRadius] = useState(0.2);
  const [shapeType,setShapeType] = useState<ShapeType>("Circle");
  const [colorMode,setColorMode] = useState<ColorMode>("Mono");
  const [fillMode,setFillMode] = useState<"Fill"|"Stroke">("Fill");
  const [rotationMode,setRotationMode] = useState<RotationMode>("Brush Direction");
  const [rotationJitter,setRotationJitter] = useState(22);
  
  // Brush
  const [brushRadius,setBrushRadius] = useState(110);
  const [intensity,setIntensity] = useState(1.2);
  const [falloffPower,setFalloffPower] = useState(1);
  const [falloffType,setFalloffType] = useState<FalloffType>("Linear");

  // Refs for fast loop
  const pointsRef = useRef<Point[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const curveRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const brushRef = useRef({ x: CANVAS_W/2, y: CANVAS_H/2, lastX: CANVAS_W/2, lastY: CANVAS_H/2, angle: 0, moving: false });
  const keysHeldRef = useRef<Set<string>>(new Set());
  const [activeAction,setActiveAction] = useState<string | null>(null);
  const { heldActions: keysHeld } = useNCTGraphiteCommands({
    commands: SHADING_COMMANDS,
    preventDefaultKeys: ["f", "e", "q", "x"],
    onAction: (id) => {
      if (id === "f") setActiveAction("GROW");
      if (id === "e") setActiveAction("SHRINK");
      if (id === "q") setActiveAction("SMOOTH");
      if (id === "x") setActiveAction("CLEAR");
      if (id === "[") setBrushRadius((v) => Math.max(20, v - 8));
      if (id === "]") setBrushRadius((v) => Math.min(240, v + 8));
      if (id === "-") setIntensity((v) => Math.max(0.1, v - 0.1));
      if (id === "=") setIntensity((v) => Math.min(3, v + 0.1));
      if (id === "c") {
        setShapeType((prev) => {
          const idx = SHAPES.indexOf(prev);
          return SHAPES[(idx + 1) % SHAPES.length];
        });
        setToast(`Shape → ${shapeType}`);
        setTimeout(() => setToast(null), 1200);
      }
      if (id === "r") {
        generatePoints();
        setToast("Re-jittered grid");
        setTimeout(() => setToast(null), 1000);
      }
    },
    onKeyUp: () => setActiveAction(null),
  });
  useEffect(() => { keysHeldRef.current = keysHeld; }, [keysHeld]);
  const [toast,setToast] = useState<string|null>(null);
  const [pointsInBrush,setPointsInBrush] = useState(0);
  const [avgRadius,setAvgRadius] = useState(1);
  const [statsTick,setStatsTick] = useState(0);
  const frameRef = useRef(0);

  // Persistence — presets collection
  const [presets,setPresets] = useState<{id:string,value:any,created_at:string}[]>([]);
  const [presetName,setPresetName] = useState("");
  const [saving,setSaving] = useState(false);
  const [presetsError,setPresetsError] = useState<string|null>(null);

  const spacing = useMemo(()=> CANVAS_W / cols, [cols]);
  const totalPoints = cols * rows;

  const generatePoints = useCallback(()=>{
    const pts: Point[] = [];
    const offsetX = (CANVAS_W - (cols-1)*spacing)/2;
    const offsetY = (CANVAS_H - (rows-1)*spacing)/2;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const baseX = offsetX + c*spacing;
        const baseY = offsetY + r*spacing;
        let x = baseX;
        let y = baseY;
        if(useJitter && jitterAmount>0){
          const jx = (Math.random()-0.5)*spacing*jitterAmount;
          const jy = (Math.random()-0.5)*spacing*jitterAmount;
          x += jx; y += jy;
        }
        let rot = 0;
        if(rotationMode==="Random" || rotationMode==="Brush + Random"){
          rot = Math.random()*Math.PI*2;
        }
        pts.push({
          x,y,baseX,baseY,
          radius: 0.6 + Math.random()*0.9,
          rotation: rot,
          col:c,row:r
        })
      }
    }
    pointsRef.current = pts;
    setStatsTick(v=>v+1);
  },[cols,rows,spacing,jitterAmount,useJitter,rotationMode]);

  useEffect(()=>{ generatePoints(); },[generatePoints]);

  const getFalloff = useCallback((norm:number)=>{
    let v = norm;
    switch(falloffType){
      case "Linear": v = norm; break;
      case "Smoothstep": v = norm*norm*(3-2*norm); break;
      case "Gaussian": {
        const d = 1 - norm;
        v = Math.exp(- (d*d) * 5.5);
        break;
      }
      case "Sharp": {
        v = Math.pow(norm, 0.5) * norm;
        v = Math.pow(v, 0.7);
        break;
      }
    }
    return Math.pow(Math.max(0,v), falloffPower);
  },[falloffType,falloffPower]);

  // ---- Backend wiring ----
  const reloadRecords = useCallback(async ()=>{
    try{
      const res = await fetch("actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "records.list", args: { collection: "presets" } }) });
      const json = await res.json() as any;
      if(!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setPresets(json.data?.records || []);
      setPresetsError(null);
    }catch(e:any){
      if(e?.message?.includes("not found") || e?.message?.includes("fetch")) return;
      setPresetsError(e?.message || String(e));
    }
  },[]);

  useEffect(()=>{
    reloadRecords();
  },[reloadRecords]);

  const createRow = useCallback(async (value:any, idempotencyKey?:string)=>{
    const args:any = { collection: "presets", value };
    if(idempotencyKey) args.idempotency_key = idempotencyKey;
    const res = await fetch("actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "records.create", args }) });
    const json = await res.json() as any;
    if(!res.ok || json.error) throw new Error(json.error || `create failed ${res.status}`);
    return json.data;
  },[]);

  const savePreset = async ()=>{
    if(saving) return;
    setSaving(true);
    try{
      const value = {
        name: presetName.trim() || `Gain ${new Date().toLocaleTimeString()} • ${shapeType} • ${Math.round(avgRadius*10)/10}px`,
        cols, rows, jitterAmount, useJitter, maxRadius, minRadius,
        shapeType, colorMode, fillMode, rotationMode, rotationJitter,
        brushRadius, intensity, falloffPower, falloffType,
        avgRadius, totalPoints, createdAt: Date.now()
      };
      const key = `preset-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      await createRow(value, key);
      setPresetName("");
      await reloadRecords();
      setToast("Preset saved");
      setTimeout(()=>setToast(null),1500);
    }catch(e:any){
      setToast(e?.message || "Save failed");
      setTimeout(()=>setToast(null),2000);
    }finally{
      setSaving(false);
    }
  };

  const deletePreset = async (id:string)=>{
    try{
      const res = await fetch("actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "records.delete", args: { collection: "presets", id } }) });
      const json = await res.json() as any;
      if(!res.ok || json.error) throw new Error(json.error || "delete failed");
      await reloadRecords();
      setToast("Preset removed");
      setTimeout(()=>setToast(null),1200);
    }catch(e:any){
      setToast(e?.message || "Delete failed");
      setTimeout(()=>setToast(null),1500);
    }
  };

  const applyPreset = (val:any)=>{
    if(!val) return;
    setCols(val.cols ?? 48);
    setRows(val.rows ?? 32);
    setJitterAmount(val.jitterAmount ?? 0.65);
    setUseJitter(val.useJitter ?? true);
    setMaxRadius(val.maxRadius ?? 14);
    setMinRadius(val.minRadius ?? 0.2);
    setShapeType(val.shapeType ?? "Circle");
    setColorMode(val.colorMode ?? "Mono");
    setFillMode(val.fillMode ?? "Fill");
    setRotationMode(val.rotationMode ?? "Brush Direction");
    setRotationJitter(val.rotationJitter ?? 22);
    setBrushRadius(val.brushRadius ?? 110);
    setIntensity(val.intensity ?? 1.2);
    setFalloffPower(val.falloffPower ?? 1);
    setFalloffType(val.falloffType ?? "Linear");
    setToast(`Loaded ${val.name}`);
    setTimeout(()=>setToast(null),1300);
  };

  // painting loop
  useEffect(()=>{
    let raf=0;
    let lastTime = performance.now();
    const loop = (t:number)=>{
      const dt = Math.min(32, t-lastTime)/16.66;
      lastTime = t;
      const brush = brushRef.current;
      const keys = keysHeldRef.current;
      let changed = false;
      let inBrushCount = 0;

      const dx = brush.x - brush.lastX;
      const dy = brush.y - brush.lastY;
      if(Math.hypot(dx,dy) > 0.5){
        brush.angle = Math.atan2(dy,dx);
        brush.moving = true;
      } else {
        brush.moving = false;
      }

      const isGrowing = keys.has("f");
      const isShrinking = keys.has("e");
      const isSmoothing = keys.has("q");
      const isClearing = keys.has("x");

      if(isGrowing || isShrinking || isSmoothing || isClearing){
        const pts = pointsRef.current;
        const br = brushRadius;
        const br2 = br*br;
        if(isSmoothing){
          const avgs = new Float32Array(pts.length);
          for(let i=0;i<pts.length;i++){
            const p = pts[i];
            const d2 = (p.x-brush.x)*(p.x-brush.x)+(p.y-brush.y)*(p.y-brush.y);
            if(d2 < br2){
              let sum=0,cnt=0;
              for(let j=0;j<pts.length;j++){
                const q = pts[j];
                const nd2 = (p.x-q.x)*(p.x-q.x)+(p.y-q.y)*(p.y-q.y);
                if(nd2 < (spacing*1.8)*(spacing*1.8)){
                  sum+=q.radius; cnt++;
                }
              }
              avgs[i] = cnt? sum/cnt : p.radius;
            } else avgs[i] = p.radius;
          }
          for(let i=0;i<pts.length;i++){
            const p = pts[i];
            const d = Math.hypot(p.x-brush.x, p.y-brush.y);
            if(d < br){
              const norm = 1 - d/br;
              const infl = getFalloff(norm) * intensity * 0.18 * dt;
              p.radius = p.radius + (avgs[i]-p.radius)*infl*1.2;
              if(rotationMode==="Brush Direction") p.rotation = brush.angle + (Math.random()-0.5)*rotationJitter*Math.PI/180;
              else if(rotationMode==="Radial") p.rotation = Math.atan2(p.y-brush.y, p.x-brush.x)+Math.PI/2;
              else if(rotationMode==="Brush + Random") p.rotation = brush.angle + (Math.random()-0.5)*rotationJitter*Math.PI/180*3;
              else if(rotationMode==="Spiral"){
                const ang = Math.atan2(p.y-CANVAS_H/2, p.x-CANVAS_W/2);
                const dist = Math.hypot(p.x-CANVAS_W/2,p.y-CANVAS_H/2);
                p.rotation = ang + dist*0.01;
              }
              changed=true;
            }
          }
        } else {
          for(const p of pts){
            const d = Math.hypot(p.x-brush.x, p.y-brush.y);
            if(d < br){
              inBrushCount++;
              const norm = 1 - d/br;
              const infl = getFalloff(norm) * intensity * 0.065 * dt;
              if(isGrowing){
                p.radius = Math.min(maxRadius, p.radius + infl*6);
                if(rotationMode==="Brush Direction") p.rotation = brush.angle + (Math.random()-0.5)*rotationJitter*Math.PI/180;
                else if(rotationMode==="Radial") p.rotation = Math.atan2(p.y-brush.y, p.x-brush.x)+Math.PI/2;
                else if(rotationMode==="Brush + Random") p.rotation = brush.angle + (Math.random()-0.5)*rotationJitter*Math.PI/180*2;
                else if(rotationMode==="Spiral"){
                  const ang = Math.atan2(p.y-CANVAS_H/2, p.x-CANVAS_W/2);
                  const dist = Math.hypot(p.x-CANVAS_W/2,p.y-CANVAS_H/2);
                  p.rotation = ang + dist*0.008;
                } else if(rotationMode==="Random" && Math.random()<0.02){
                  p.rotation = Math.random()*Math.PI*2;
                }
              } else if(isShrinking){
                p.radius = Math.max(minRadius, p.radius - infl*6);
              } else if(isClearing){
                p.radius = Math.max(minRadius, p.radius - infl*18);
                if(p.radius < 1) p.radius = minRadius;
              }
              changed=true;
            }
          }
          if(isClearing){
            for(const p of pts){
              const d = Math.hypot(p.x-brush.x, p.y-brush.y);
              if(d<br) p.radius = 1;
            }
          }
        }
      } else {
        const pts = pointsRef.current;
        let cnt=0;
        for(const p of pts){
          if(Math.hypot(p.x-brush.x, p.y-brush.y) < brushRadius) cnt++;
        }
        inBrushCount = cnt;
      }

      const cvs = canvasRef.current;
      if(cvs){
        const ctx = cvs.getContext("2d",{alpha:false});
        if(ctx){
          ctx.fillStyle = "#fdfaf3";
          ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
          ctx.fillStyle = "rgba(0,0,0,0.02)";
          for(let i=0;i<200;i++){
            const x = (i*73)%CANVAS_W;
            const y = (i*127)%CANVAS_H;
            ctx.fillRect(x,y,1,1);
          }
          if(showGrid){
            ctx.strokeStyle = "rgba(26,26,36,0.06)";
            ctx.lineWidth = 0.5;
            const offX = (CANVAS_W - (cols-1)*spacing)/2;
            const offY = (CANVAS_H - (rows-1)*spacing)/2;
            for(let c=0;c<cols;c++){
              const x = offX + c*spacing;
              ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,CANVAS_H); ctx.stroke();
            }
            for(let r=0;r<rows;r++){
              const y = offY + r*spacing;
              ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(CANVAS_W,y); ctx.stroke();
            }
          }
          if(!isGrowing && !isShrinking){
            ctx.strokeStyle = "rgba(124,92,255,0.18)";
            ctx.lineWidth = 0.6;
            for(const p of pointsRef.current){
              const d = Math.hypot(p.x-brush.x, p.y-brush.y);
              if(d < brushRadius){
                const a = 1 - d/brushRadius;
                ctx.globalAlpha = a*0.5;
                ctx.beginPath();
                ctx.arc(p.x,p.y, Math.max(2,p.radius*0.9),0,Math.PI*2);
                ctx.stroke();
              }
            }
            ctx.globalAlpha=1;
          }

          for(const p of pointsRef.current){
            const r = Math.max(0.15,p.radius);
            let fill = "#0e0e14";
            if(colorMode==="Density"){
              const t = Math.min(1, p.radius / maxRadius);
              const l = Math.round(240 - t*210);
              const b = t>0.7 ? 14 + t*10 : l;
              fill = `rgb(${l},${l},${b})`;
            } else if(colorMode==="Group"){
              const g = (p.col + p.row) % 3;
              fill = g===0?"#0e0e14": g===1?"#7c5cff" : "#ff5c7a";
            }
            ctx.save();
            ctx.translate(p.x,p.y);
            let rot = p.rotation;
            if(rotationMode==="None") rot=0;
            ctx.rotate(rot);
            ctx.fillStyle = fill;
            ctx.strokeStyle = fill;
            ctx.lineWidth = Math.max(0.8, r*0.35);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            if(colorMode==="Mono" || colorMode==="Density"){
              const dens = Math.min(1, p.radius / maxRadius);
              ctx.globalAlpha = 0.18 + dens*0.82;
            }

            switch(shapeType){
              case "Circle":{
                ctx.beginPath();
                ctx.arc(0,0,r,0,Math.PI*2);
                if(fillMode==="Fill") ctx.fill(); else ctx.stroke();
                break;
              }
              case "Diamond":{
                const s = r*1.15;
                ctx.beginPath();
                ctx.moveTo(0,-s); ctx.lineTo(s,0); ctx.lineTo(0,s); ctx.lineTo(-s,0); ctx.closePath();
                if(fillMode==="Fill") ctx.fill(); else ctx.stroke();
                break;
              }
              case "Square":{
                const s = r*1.1;
                ctx.beginPath();
                ctx.rect(-s,-s,s*2,s*2);
                if(fillMode==="Fill") ctx.fill(); else ctx.stroke();
                break;
              }
              case "Triangle":{
                const s = r*1.35;
                ctx.beginPath();
                ctx.moveTo(0,-s);
                ctx.lineTo(s*0.866, s*0.5);
                ctx.lineTo(-s*0.866, s*0.5);
                ctx.closePath();
                if(fillMode==="Fill") ctx.fill(); else ctx.stroke();
                break;
              }
              case "Line":{
                const len = r*3.2;
                const thick = Math.max(1, r*0.42);
                ctx.lineWidth = thick;
                ctx.beginPath();
                ctx.moveTo(-len/2,0); ctx.lineTo(len/2,0);
                ctx.stroke();
                break;
              }
              case "Cross":{
                const len = r*2.6;
                const thick = Math.max(0.8, r*0.34);
                ctx.lineWidth = thick;
                ctx.beginPath();
                ctx.moveTo(-len/2,-len/2); ctx.lineTo(len/2,len/2);
                ctx.moveTo(-len/2,len/2); ctx.lineTo(len/2,-len/2);
                ctx.stroke();
                break;
              }
              case "Plus":{
                const len = r*2.6;
                const thick = Math.max(0.8, r*0.36);
                ctx.lineWidth = thick;
                ctx.beginPath();
                ctx.moveTo(-len/2,0); ctx.lineTo(len/2,0);
                ctx.moveTo(0,-len/2); ctx.lineTo(0,len/2);
                ctx.stroke();
                break;
              }
            }
            ctx.restore();
            ctx.globalAlpha=1;
          }
        }
      }

      const over = overlayRef.current;
      if(over){
        const octx = over.getContext("2d",{alpha:true});
        if(octx){
          octx.clearRect(0,0,CANVAS_W,CANVAS_H);
          octx.save();
          octx.strokeStyle = "#7c5cff";
          octx.lineWidth = 1.2;
          octx.setLineDash([6,4]);
          octx.beginPath();
          octx.arc(brush.x, brush.y, brushRadius, 0, Math.PI*2);
          octx.stroke();
          octx.setLineDash([]);
          octx.fillStyle = "rgba(124,92,255,0.08)";
          octx.beginPath();
          octx.arc(brush.x, brush.y, brushRadius, 0, Math.PI*2);
          octx.fill();
          octx.fillStyle = "#7c5cff";
          octx.beginPath();
          octx.arc(brush.x, brush.y, 2.5,0,Math.PI*2); octx.fill();
          if(brush.moving){
            octx.strokeStyle = "#00e5ff";
            octx.lineWidth = 1;
            octx.beginPath();
            octx.moveTo(brush.x, brush.y);
            octx.lineTo(brush.x + Math.cos(brush.angle)*brushRadius*0.6, brush.y + Math.sin(brush.angle)*brushRadius*0.6);
            octx.stroke();
          }
          octx.strokeStyle = "rgba(124,92,255,0.25)";
          octx.setLineDash([2,6]);
          octx.beginPath();
          octx.arc(brush.x, brush.y, brushRadius*0.5,0,Math.PI*2);
          octx.stroke();
          octx.restore();
        }
      }

      frameRef.current++;
      if(frameRef.current % 12 ===0){
        setPointsInBrush(inBrushCount);
        const pts = pointsRef.current;
        if(pts.length){
          const avg = pts.reduce((s,p)=>s+p.radius,0)/pts.length;
          setAvgRadius(avg);
        }
      }
      if(changed && frameRef.current % 6===0){
        setStatsTick(v=>v+1);
      }

      brush.lastX = brush.x;
      brush.lastY = brush.y;

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return ()=> cancelAnimationFrame(raf);
  },[brushRadius,intensity,falloffPower,rotationMode,rotationJitter,shapeType,colorMode,fillMode,maxRadius,minRadius,spacing,showGrid,getFalloff]);

  useEffect(()=>{
    const c = curveRef.current;
    if(!c) return;
    const ctx = c.getContext("2d")!;
    const W = c.width, H=c.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#1a1a24";
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="rgba(255,255,255,0.08)";
    ctx.lineWidth=0.5;
    ctx.beginPath();
    ctx.moveTo(0,H*0.5); ctx.lineTo(W,H*0.5); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W*0.5,0); ctx.lineTo(W*0.5,H); ctx.stroke();
    ctx.strokeStyle="#7c5cff";
    ctx.lineWidth=1.5;
    ctx.beginPath();
    for(let i=0;i<=W;i++){
      const norm = i/W;
      const f = getFalloff(norm);
      const x = i;
      const y = H - f*H*0.85 - 4;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.fillStyle="#00e5ff";
    ctx.fillRect(W-2,4,2, H-8);
  },[getFalloff]);

  const onCanvasMouseMove = (e: React.MouseEvent)=>{
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const x = (e.clientX - rect.left)*scaleX;
    const y = (e.clientY - rect.top)*scaleY;
    brushRef.current.x = x;
    brushRef.current.y = y;
  };

  // Keyboard handling lives in useNCTGraphiteCommands (SHADING_COMMANDS above).

  const handleCanvasMouseDown = ()=>{
    setToast("Mouse aims — keys shade");
    setTimeout(()=>setToast(null),2200);
  };

  const exportSVG = ()=>{
    const pts = pointsRef.current;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}"><rect width="100%" height="100%" fill="#fdfaf3"/>`;
    for(const p of pts){
      const r = p.radius;
      const rotDeg = (p.rotation*180/Math.PI).toFixed(2);
      const style = `fill:${colorMode==="Group"? ( (p.col+p.row)%3===1?"#7c5cff": (p.col+p.row)%3===2?"#ff5c7a":"#0e0e14"):"#0e0e14"};stroke:${colorMode==="Group"? ( (p.col+p.row)%3===1?"#7c5cff": (p.col+p.row)%3===2?"#ff5c7a":"#0e0e14"):"#0e0e14"};`;
      switch(shapeType){
        case "Circle":
          svg+=`<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r.toFixed(2)}" style="${style}" ${fillMode==="Fill"?`fill-opacity="${(0.2 + Math.min(1,r/maxRadius)*0.8).toFixed(2)}"`:`fill="none" stroke-width="${Math.max(0.8,r*0.35).toFixed(2)}"`}/>`;
          break;
        case "Square":{
          const s=r*1.1;
          svg+=`<g transform="translate(${p.x} ${p.y}) rotate(${rotDeg})"><rect x="${-s}" y="${-s}" width="${s*2}" height="${s*2}" style="${style}" ${fillMode==="Fill"?`fill-opacity="${(0.2 + Math.min(1,r/maxRadius)*0.8).toFixed(2)}"`:`fill="none" stroke-width="${Math.max(0.8,r*0.35).toFixed(2)}"`}/></g>`;
          break;
        }
        case "Diamond":{
          const s=r*1.15;
          svg+=`<g transform="translate(${p.x} ${p.y}) rotate(${rotDeg})"><polygon points="0,${-s} ${s},0 0,${s} ${-s},0" style="${style}" ${fillMode==="Fill"?`fill-opacity="${(0.2 + Math.min(1,r/maxRadius)*0.8).toFixed(2)}"`:`fill="none" stroke-width="${Math.max(0.8,r*0.35).toFixed(2)}"`}/></g>`;
          break;
        }
        case "Triangle":{
          const s=r*1.35;
          svg+=`<g transform="translate(${p.x} ${p.y}) rotate(${rotDeg})"><polygon points="0,${-s} ${s*0.866},${s*0.5} ${-s*0.866},${s*0.5}" style="${style}" ${fillMode==="Fill"?`fill-opacity="${(0.2 + Math.min(1,r/maxRadius)*0.8).toFixed(2)}"`:`fill="none" stroke-width="${Math.max(0.8,r*0.35).toFixed(2)}"`}/></g>`;
          break;
        }
        case "Line":{
          const len=r*3.2;
          svg+=`<g transform="translate(${p.x} ${p.y}) rotate(${rotDeg})"><line x1="${-len/2}" y1="0" x2="${len/2}" y2="0" style="${style}" stroke-width="${Math.max(1,r*0.42).toFixed(2)}" stroke-linecap="round"/></g>`;
          break;
        }
        case "Cross":{
          const len=r*2.6;
          svg+=`<g transform="translate(${p.x} ${p.y}) rotate(${rotDeg})"><line x1="${-len/2}" y1="${-len/2}" x2="${len/2}" y2="${len/2}" style="${style}" stroke-width="${Math.max(0.8,r*0.34).toFixed(2)}" stroke-linecap="round"/><line x1="${-len/2}" y1="${len/2}" x2="${len/2}" y2="${-len/2}" style="${style}" stroke-width="${Math.max(0.8,r*0.34).toFixed(2)}" stroke-linecap="round"/></g>`;
          break;
        }
        case "Plus":{
          const len=r*2.6;
          svg+=`<g transform="translate(${p.x} ${p.y}) rotate(${rotDeg})"><line x1="${-len/2}" y1="0" x2="${len/2}" y2="0" style="${style}" stroke-width="${Math.max(0.8,r*0.36).toFixed(2)}" stroke-linecap="round"/><line x1="0" y1="${-len/2}" x2="0" y2="${len/2}" style="${style}" stroke-width="${Math.max(0.8,r*0.36).toFixed(2)}" stroke-linecap="round"/></g>`;
          break;
        }
      }
    }
    svg+=`</svg>`;
    const blob = new Blob([svg],{type:"image/svg+xml"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`shading-${Date.now()}.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPNG = ()=>{
    const c = canvasRef.current;
    if(!c) return;
    const url = c.toDataURL("image/png");
    const a = document.createElement("a");
    a.href=url; a.download=`shading-${Date.now()}.png`; a.click();
  };

  const resetRadii = ()=>{
    for(const p of pointsRef.current) p.radius=1;
    setStatsTick(v=>v+1);
  };

  return (
    <>
    <NCTGraphiteAppShell
      maxWidth={1600}
      proportion="220px 1fr 300px"
      className="bg-[var(--paper)] text-[var(--ink)] overflow-x-clip selection:bg-[var(--accent)]/30"
      header={
      <div className="sticky top-0 z-30 border-b border-[var(--line)] bg-[#fdfaf3]/90 backdrop-blur" data-safe-area-sticky-top style={{top:'var(--safe-area-inset-top)'}}>
        <div className="mx-auto max-w-[1600px] px-4 md:px-6 h-[52px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-[6px] bg-[#0e0e14] text-[#fdfaf3] grid place-items-center mono text-[11px] font-bold">G•</div>
            <div className="display font-bold tracking-[-0.02em] text-[15px] md:text-[17px] uppercase">Grid Dot Shading Lab — Brush Drives Dot Gain</div>
            <div className="hidden md:flex ml-3 px-2.5 py-1 rounded-full bg-[#0e0e14] text-[#fdfaf3] mono text-[10px] tracking-wide">MOUSE AIMS — KEYS SHADE</div>
          </div>
          <div className="flex items-center gap-2 mono text-[10px]">
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#0e0e14]/10">
              <span className="h-2 w-2 rounded-full bg-[#00e5ff] animate-pulse" />
              60FPS • {totalPoints} PTS • {presets.length} SAVED
            </div>
            <button onClick={resetRadii} className="px-3 py-1.5 rounded-full bg-[#0e0e14] text-white hover:bg-black transition">Reset Gain</button>
          </div>
        </div>
      </div>
      }
    >
        {/* Left keymap */}
        <div className="order-2 lg:order-1">
          <div className="rounded-[18px] bg-[var(--panel)] text-[#fdfaf3] p-3 md:p-4 lg:sticky lg:top-[66px]">
            <div className="mono text-[10px] tracking-[0.18em] opacity-60 mb-3">KEY MAP — HOLD TO SHADE</div>
            <div className="space-y-2">
              {[
                {k:"F", label:"GROW", desc:"increase dot gain", active: keysHeld.has("f")},
                {k:"E", label:"SHRINK", desc:"decrease dot gain", active: keysHeld.has("e")},
                {k:"Q", label:"SMOOTH", desc:"avg with neighbors", active: keysHeld.has("q")},
                {k:"X", label:"CLEAR", desc:"reset to 1px in brush", active: keysHeld.has("x")},
                {k:"[ ]", label:"RADIUS", desc:`${brushRadius}px • drag or keys`, active: keysHeld.has("[")||keysHeld.has("]")},
                {k:"- =", label:"INTENSITY", desc:`${intensity.toFixed(1)} • gain speed`, active: keysHeld.has("-")||keysHeld.has("=")},
                {k:"C", label:"NEW SHAPE", desc:`${shapeType}`, active:false},
                {k:"R", label:"RE-JITTER", desc:"re-randomize positions", active:false},
              ].map(it=>(
                <div key={it.k} className={`group flex items-center gap-2.5 rounded-[12px] border px-2.5 py-2.5 transition ${it.active? "bg-[#7c5cff] border-[#7c5cff] text-white shadow-[0_0_0_3px_rgba(124,92,255,0.25)]" : "bg-[#1a1a24] border-white/10 hover:border-white/20"}`}>
                  <div className={`h-8 min-w-[40px] grid place-items-center rounded-[8px] mono text-[12px] font-bold border ${it.active? "bg-white text-[#0e0e14] border-white" : "bg-[#0e0e14] border-white/15 text-white"}`}>{it.k}</div>
                  <div className="min-w-0">
                    <div className="mono text-[11px] font-bold tracking-wide leading-none">{it.label}</div>
                    <div className="mono text-[10px] opacity-60 truncate">{it.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-[12px] bg-[#fdfaf3]/[0.06] border border-white/10 p-3">
              <div className="mono text-[10px] tracking-wide opacity-70">HOW IT WORKS</div>
              <div className="mono text-[11px] leading-[1.35] mt-1.5 opacity-90">
                Grid points hold a <span className="text-[#7c5cff]">gain</span>. Brush circle has falloff <span className="text-[#00e5ff]">(1-d/R)^p</span> — strongest at center. Jittered positions turn uniform dots into organic stipple halftone. Line/diamond shapes expose rotation.
              </div>
            </div>
            <NCTGraphiteStack direction="row" gap={8} className="mt-3">
              <div className={`flex-1 h-[36px] rounded-full grid place-items-center mono text-[11px] font-bold transition ${activeAction? "bg-[#00e5ff] text-black" : "bg-white/10 text-white/50"}`}>
                {activeAction? `● ${activeAction}` : "IDLE — MOVE MOUSE"}
              </div>
            </NCTGraphiteStack>
            <div className="mt-3 mono text-[9px] opacity-40 leading-[1.3]">
              Tip: hold F + move slowly for smooth gradients. Use E to carve highlights. Q smudges. Lines + Brush Direction = hatching.
            </div>
          </div>
        </div>

        {/* Center canvas */}
        <div className="order-1 lg:order-2">
          <div ref={containerRef} data-nct-stage="" tabIndex={-1} onMouseMove={onCanvasMouseMove} onMouseDown={handleCanvasMouseDown} className="relative rounded-[22px] overflow-hidden bg-[#fdfaf3] border border-[#0e0e14]/10 shadow-[0_16px_40px_rgba(14,14,20,0.08)]">
            <div className="relative w-full aspect-[960/680] bg-[#fdfaf3]">
              <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="absolute inset-0 w-full h-full" />
              <canvas ref={overlayRef} width={CANVAS_W} height={CANVAS_H} className="absolute inset-0 w-full h-full pointer-events-none" />
              <NCTGraphiteStack direction="row" gap={8} className="absolute left-3 top-3 mono text-[10px]">
                <div className="px-2.5 py-1 rounded-full bg-[#0e0e14] text-white flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#7c5cff]"/>
                  {pointsInBrush} in brush
                </div>
                <div className="px-2.5 py-1 rounded-full bg-white border border-black/10 text-black">
                  {shapeType} • {rotationMode}
                </div>
              </NCTGraphiteStack>
              <div className="absolute right-3 top-3 mono text-[10px] px-2.5 py-1 rounded-full bg-[#7c5cff] text-white">
                {brushRef.current.x.toFixed(0)}, {brushRef.current.y.toFixed(0)}
              </div>
              {toast && (
                <div className="absolute left-1/2 -translate-x-1/2 bottom-4 px-4 py-2 rounded-full bg-[#0e0e14] text-white mono text-[11px] shadow-xl animate-[bounce_0.3s_ease]">
                  {toast}
                </div>
              )}
            </div>
            <div className="h-[44px] border-t border-[#0e0e14]/10 flex items-center justify-between px-3 mono text-[10px] bg-[#f5efe0]">
              <div className="flex items-center gap-3">
                <span className="opacity-60">MOUSE</span> <span className="font-bold">{Math.round(brushRef.current.x)},{Math.round(brushRef.current.y)}</span>
                <span className="h-3 w-px bg-black/10"/>
                <span className="opacity-60">BRUSH</span> <span className="font-bold">{brushRadius}px @ {intensity.toFixed(1)}x</span>
                <span className="h-3 w-px bg-black/10"/>
                <span className="opacity-60">FALLOFF</span> <span className="font-bold">{falloffType} ^ {falloffPower.toFixed(1)}</span>
              </div>
              <div className="hidden md:flex items-center gap-2">
                <span className="opacity-60">AVG GAIN</span> <span className="font-bold">{avgRadius.toFixed(2)}px</span>
                <div className="w-20 h-1.5 rounded-full bg-black/10 overflow-hidden ml-1">
                  <div className="h-full bg-[#7c5cff]" style={{width:`${Math.min(100, (avgRadius/maxRadius)*100)}%`}}/>
                </div>
              </div>
            </div>
          </div>

          <NCTGraphiteGrid columns="repeat(2, 1fr)" wideMinWidth={768} wideColumns="repeat(4, 1fr)" gap={8} className="mt-3 mono text-[10px]">
            <div className="rounded-[14px] border border-black/10 bg-white p-3">
              <div className="opacity-50 tracking-wide">TOTAL POINTS</div>
              <div className="text-[18px] font-bold leading-none mt-1">{totalPoints}</div>
            </div>
            <div className="rounded-[14px] border border-black/10 bg-white p-3">
              <div className="opacity-50 tracking-wide">JITTER</div>
              <div className="text-[18px] font-bold leading-none mt-1">{useJitter? `${(jitterAmount*100).toFixed(0)}%`:"OFF"}</div>
            </div>
            <div className="rounded-[14px] border border-black/10 bg-white p-3">
              <div className="opacity-50 tracking-wide">MAX GAIN</div>
              <div className="text-[18px] font-bold leading-none mt-1">{maxRadius}px</div>
            </div>
            <div className="rounded-[14px] bg-[#0e0e14] text-white p-3 flex items-center justify-between">
              <div>
                <div className="opacity-50 tracking-wide">SHAPE MODE</div>
                <div className="text-[13px] font-bold leading-none mt-1">{fillMode} {shapeType.toUpperCase()}</div>
              </div>
              <div className="h-7 w-7 rounded-full bg-[#7c5cff] grid place-items-center text-[12px]">✦</div>
            </div>
          </NCTGraphiteGrid>
        </div>

        {/* Right controls */}
        <div className="order-3">
          <div className="rounded-[18px] bg-[#0e0e14] text-[#fdfaf3] p-3 md:p-4 space-y-5">
            {/* Grid */}
            <div>
              <div className="flex items-center justify-between">
                <div className="mono text-[10px] tracking-[0.18em] opacity-60">GRID</div>
                <button onClick={()=>generatePoints()} className="mono text-[10px] px-2.5 py-1 rounded-full bg-white text-black font-bold hover:bg-[#7c5cff] hover:text-white transition">Re-jitter [R]</button>
              </div>
              <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={8} className="mt-3">
                <NCTGraphiteSlider label="COLS" value={cols} min={20} max={80} format={(v)=>`${Math.round(v)}`} onChange={(v)=>setCols(Math.round(v))} />
                <NCTGraphiteSlider label="ROWS" value={rows} min={15} max={60} format={(v)=>`${Math.round(v)}`} onChange={(v)=>setRows(Math.round(v))} />
              </NCTGraphiteGrid>
              <NCTGraphiteSlider label="JITTER" value={jitterAmount} min={0} max={1} step={0.01} format={(v)=>`${(v*100).toFixed(0)}%`} onChange={setJitterAmount} />
              <NCTGraphiteStack direction="row" gap={8} className="mt-2">
                <button onClick={()=>setUseJitter(v=>!v)} className={`flex-1 h-7 rounded-full mono text-[10px] font-bold ${useJitter?"bg-[#7c5cff] text-white":"bg-white/10 text-white/60"}`}>{useJitter?"RANDOMIZED":"ALIGNED GRID"}</button>
                <button onClick={()=>setShowGrid(v=>!v)} className={`px-3 h-7 rounded-full mono text-[10px] font-bold ${showGrid?"bg-[#00e5ff] text-black":"bg-white/10 text-white/60"}`}>GRID LINES</button>
              </NCTGraphiteStack>
            </div>

            {/* Brush */}
            <div>
              <div className="mono text-[10px] tracking-[0.18em] opacity-60">BRUSH</div>
              <div className="mt-3 space-y-2">
                <NCTGraphiteSlider label="RADIUS [ ]" value={brushRadius} min={20} max={240} format={(v)=>`${Math.round(v)}px`} onChange={(v)=>setBrushRadius(Math.round(v))} />
                <NCTGraphiteSlider label="INTENSITY - =" value={intensity} min={0.1} max={3} step={0.1} format={(v)=>`${v.toFixed(1)}x`} onChange={setIntensity} />
                <div className="bg-[#1a1a24] border border-white/10 rounded-[12px] p-2.5">
                  <NCTGraphiteSlider label="FALLOFF POWER" value={falloffPower} min={0.5} max={4} step={0.1} format={(v)=>v.toFixed(1)} onChange={setFalloffPower} />
                  <NCTGraphiteStack direction="row" gap={6} wrap className="mt-2">
                    {FALLOFFS.map(f=>(
                      <button key={f} onClick={()=>setFalloffType(f)} className={`px-2.5 py-1 rounded-full mono text-[10px] border ${falloffType===f?"bg-[#7c5cff] border-[#7c5cff] text-white":"bg-transparent border-white/15 text-white/60 hover:border-white/30"}`}>{f}</button>
                    ))}
                  </NCTGraphiteStack>
                  <NCTGraphiteStack direction="row" gap={8} align="center" className="mt-2.5">
                    <canvas ref={curveRef} width={80} height={40} className="rounded-[6px] border border-white/10" />
                    <div className="mono text-[9px] leading-[1.2] opacity-60">influence = pow( (1-d/R), p )<br/>center bias = {falloffType==="Gaussian"?"gauss":"pow"}<br/><span className="text-[#00e5ff]">dotted = 50% radius</span></div>
                  </NCTGraphiteStack>
                </div>
              </div>
            </div>

            {/* Dots */}
            <div>
              <div className="mono text-[10px] tracking-[0.18em] opacity-60">DOTS</div>
              <div className="mt-3 space-y-2">
                <div className="bg-[#1a1a24] border border-white/10 rounded-[12px] p-2.5">
                  <div className="mono text-[9px] opacity-50 mb-2">SHAPE TYPE [C]</div>
                  <NCTGraphiteGrid columns="repeat(3, 1fr)" gap={6}>
                    {SHAPES.map(s=>(
                      <button key={s} onClick={()=>setShapeType(s)} className={`h-8 rounded-[9px] mono text-[10px] font-bold border ${shapeType===s?"bg-[#fdfaf3] text-black border-[#fdfaf3]":"bg-[#0e0e14] border-white/10 text-white/70 hover:border-white/20"}`}>{s}</button>
                    ))}
                  </NCTGraphiteGrid>
                  <NCTGraphiteGrid columns="repeat(3, 1fr)" gap={6} className="mt-2">
                    <button onClick={()=>setFillMode("Fill")} className={`h-7 rounded-full mono text-[10px] ${fillMode==="Fill"?"bg-[#7c5cff] text-white":"bg-white/10 text-white/60"}`}>Fill</button>
                    <button onClick={()=>setFillMode("Stroke")} className={`h-7 rounded-full mono text-[10px] ${fillMode==="Stroke"?"bg-[#7c5cff] text-white":"bg-white/10 text-white/60"}`}>Stroke</button>
                    <button onClick={()=>setColorMode(c=> c==="Mono"?"Density": c==="Density"?"Group":"Mono")} className="h-7 rounded-full mono text-[10px] bg-white/10 text-white/60">{colorMode}</button>
                  </NCTGraphiteGrid>
                </div>

                <NCTGraphiteSlider label="MAX GAIN" value={maxRadius} min={4} max={24} format={(v)=>`${Math.round(v)}px`} onChange={(v)=>setMaxRadius(Math.round(v))} />
                <NCTGraphiteSlider label="MIN GAIN" value={minRadius} min={0.1} max={2} step={0.1} format={(v)=>`${v.toFixed(1)}px`} onChange={setMinRadius} />

                <div className="bg-[#1a1a24] border border-white/10 rounded-[12px] p-2.5">
                  <div className="mono text-[9px] opacity-50 mb-2">ROTATION MODE</div>
                  <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={6}>
                    {ROT_MODES.map(m=>(
                      <button key={m} onClick={()=>setRotationMode(m)} className={`h-8 rounded-[9px] mono text-[9px] font-bold leading-[1.1] border px-1 ${rotationMode===m?"bg-[#00e5ff] text-black border-[#00e5ff]":"bg-[#0e0e14] border-white/10 text-white/70"}`}>{m}</button>
                    ))}
                  </NCTGraphiteGrid>
                  <NCTGraphiteSlider label="ROT JITTER" value={rotationJitter} min={0} max={180} format={(v)=>`${Math.round(v)}°`} onChange={(v)=>setRotationJitter(Math.round(v))} />
                </div>
              </div>
            </div>

            {/* Stats / Export */}
            <div className="pt-1">
              <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={8} className="mono text-[10px]">
                <div className="rounded-[12px] bg-[#1a1a24] border border-white/10 p-2.5">
                  <div className="opacity-50">BRUSH POS</div>
                  <div className="font-bold mt-1">{brushRef.current.x.toFixed(0)}, {brushRef.current.y.toFixed(0)}</div>
                </div>
                <div className="rounded-[12px] bg-[#1a1a24] border border-white/10 p-2.5">
                  <div className="opacity-50">AVG RADIUS</div>
                  <div className="font-bold mt-1">{avgRadius.toFixed(2)}px</div>
                </div>
              </NCTGraphiteGrid>
              <NCTGraphiteStack direction="row" gap={8} className="mt-2">
                <button onClick={exportSVG} className="flex-1 h-9 rounded-full bg-[#fdfaf3] text-black mono text-[11px] font-bold hover:bg-white transition">Export SVG</button>
                <button onClick={exportPNG} className="flex-1 h-9 rounded-full bg-[#7c5cff] text-white mono text-[11px] font-bold hover:bg-[#6d4fff] transition">Export PNG</button>
              </NCTGraphiteStack>
              <div className="mt-3 mono text-[9px] opacity-30 leading-[1.3]">
                Export bakes current jitter, gain, rotation. SVG preserves vector shapes. Presets are durable via trusted backend.
              </div>
            </div>

            {/* Presets - persistent */}
            <div>
              <div className="flex items-center justify-between">
                <div className="mono text-[10px] tracking-[0.18em] opacity-60">SAVED PRESETS</div>
                <div className="mono text-[9px] opacity-50">{presets.length} / 1000</div>
              </div>
              <div className="mt-3 bg-[#1a1a24] border border-white/10 rounded-[12px] p-2.5">
                <NCTGraphiteStack direction="row" gap={8}>
                  <input value={presetName} onChange={e=>setPresetName(e.target.value)} placeholder="Name (optional)" className="flex-1 h-8 px-3 rounded-full bg-[#0e0e14] border border-white/10 mono text-[11px] text-white placeholder:text-white/30 outline-none focus:border-[#7c5cff]" />
                  <button disabled={saving} onClick={savePreset} className="px-4 h-8 rounded-full bg-[#fdfaf3] text-black mono text-[11px] font-bold hover:bg-white disabled:opacity-50 transition">{saving? "Saving...":"Save"}</button>
                </NCTGraphiteStack>
                {presetsError && <div className="mono text-[10px] text-[#ff5c7a] mt-2">{presetsError}</div>}
                <div className="mt-3 max-h-[160px] overflow-y-auto space-y-1.5 pr-1">
                  {presets.length===0 && <div className="mono text-[10px] opacity-40 py-2">No saved presets yet. Current brush + grid + shape will be stored.</div>}
                  {presets.map(r=>(
                    <div key={r.id} className="flex items-center gap-2 rounded-[10px] bg-[#0e0e14] border border-white/10 px-2.5 py-2">
                      <button onClick={()=>applyPreset(r.value)} className="flex-1 text-left min-w-0">
                        <div className="mono text-[11px] font-bold truncate">{r.value?.name || "Untitled"}</div>
                        <div className="mono text-[9px] opacity-50 truncate">{r.value?.shapeType} • {r.value?.cols}x{r.value?.rows} • {r.value?.falloffType}</div>
                      </button>
                      <button onClick={()=>deletePreset(r.id)} className="h-6 w-6 rounded-full bg-white/10 grid place-items-center text-[10px] hover:bg-[#ff5c7a] hover:text-white">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
    </NCTGraphiteAppShell>
      <style>{`
        @keyframes bounce{0%{transform:translate(-50%,10px) scale(0.96); opacity:0} 100%{transform:translate(-50%,0) scale(1); opacity:1}}
      `}</style>
    </>
  );
}
