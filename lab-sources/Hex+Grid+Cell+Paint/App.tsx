import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { NCTGraphiteSlider, NCTGraphiteStack, NCTGraphiteGrid, NCTGraphiteAppShell, NCTGraphiteToggle, useNCTGraphiteCommands } from "@nct/nctgraphite";
import type { NCTGraphiteCommandDef } from "@nct/nctgraphite";

type GridType = "flat" | "pointy" | "square";
type Cell = {
  id: string;
  q: number;
  r: number;
  x: number;
  y: number;
  active: boolean;
  color: string;
  group: number;
  activatedAt: number;
};

type KeyMap = Record<string, string>;

const PALETTE = [
  "#7c5cff",
  "#00e5ff",
  "#ff7a45",
  "#ffe14a",
  "#38f28a",
  "#ff4d6d",
  "#b18aff",
  "#4af0ff",
];

const DEFAULT_KEYS: KeyMap = {
  paint: "f",
  paintSecondary: "g",
  erase: "e",
  toggle: "q",
  clear: "x",
  newColor: "c",
  smaller: "[",
  larger: "]",
  gridFlat: "1",
  gridPointy: "2",
  gridSquare: "3",
};

const ACTIONS_LABEL: Record<string, {label:string, desc:string}> = {
  paint: {label:"PAINT", desc:"Activate primary"},
  paintSecondary: {label:"PAINT 2", desc:"Secondary color"},
  erase: {label:"ERASE", desc:"Deactivate"},
  toggle: {label:"TOGGLE", desc:"Flip state"},
  clear: {label:"CLEAR ALL", desc:"Hold Shift+X also clears"},
  newColor: {label:"NEW COLOR", desc:"Cycle palette"},
  smaller: {label:"BRUSH -", desc:"Decrease radius"},
  larger: {label:"BRUSH +", desc:"Increase radius"},
  gridFlat: {label:"HEX FLAT", desc:"Flat-top hex"},
  gridPointy: {label:"HEX POINTY", desc:"Pointy-top hex"},
  gridSquare: {label:"SQUARE", desc:"Square grid"},
};

const HEX_COMMANDS: NCTGraphiteCommandDef[] = Object.entries(ACTIONS_LABEL).map(([id, meta]) => ({
  id,
  label: meta.label,
  desc: meta.desc,
  defaultKey: DEFAULT_KEYS[id] ?? "",
}));

function hexPoints(cx:number, cy:number, size:number, type:GridType, rotOffset=0){
  const pts: [number,number][] = [];
  for(let i=0;i<6;i++){
    const angDeg = type==="flat" ? 60*i -30 : 60*i;
    const ang = (angDeg+rotOffset)*Math.PI/180;
    pts.push([cx + size*Math.cos(ang), cy + size*Math.sin(ang)]);
  }
  return pts;
}
function squarePoints(cx:number, cy:number, size:number){
  const s = size*0.92;
  return [
    [cx-s, cy-s],
    [cx+s, cy-s],
    [cx+s, cy+s],
    [cx-s, cy+s],
  ] as [number,number][];
}

function axialToPixel(q:number, r:number, size:number, type:GridType){
  if(type==="square"){
    return {x: q*size*1.95, y: r*size*1.95};
  }
  if(type==="flat"){
    return {
      x: size*1.5*q,
      y: size*Math.sqrt(3)*(r + q/2),
    };
  } else {
    return {
      x: size*Math.sqrt(3)*(q + r/2),
      y: size*1.5*r,
    };
  }
}

export default function App(){
  const CANVAS_W = 960;
  const CANVAS_H = 680;

  const [hexSize, setHexSize] = useState(28);
  const [cols, setCols] = useState(22);
  const [rows, setRows] = useState(16);
  const [gridType, setGridType] = useState<GridType>("flat");
  const [brushRadius, setBrushRadius] = useState(54);
  const [falloff, setFalloff] = useState(0.35);
  const [showCenters, setShowCenters] = useState(false);
  const [showGridLines, setShowGridLines] = useState(true);
  const [colorIdx, setColorIdx] = useState(0);
  const [secondaryIdx] = useState(1);
  const [activeCount, setActiveCount] = useState(0);
  const [previewCount, setPreviewCount] = useState(0);
  const [toast, setToast] = useState<string|null>(null);
  const { keyMap, heldActions, rebinding, beginRebind } = useNCTGraphiteCommands({
    commands: HEX_COMMANDS,
    onAction: (id, e) => {
      if (id === "clear") {
        if (Date.now() - lastClearRef.current > 300) {
          lastClearRef.current = Date.now();
          cellsRef.current.forEach(c=>{c.active=false;});
          setToast("CLEARED ALL");
          setTimeout(()=>setToast(null),1200);
        }
      }
      if (id === "newColor" && !e?.repeat) {
        setColorIdx(i=>{
          const n = (i+1)%PALETTE.length;
          setGroupsUsed(g=> g.includes(n)?g:[...g,n]);
          return n;
        });
        setToast(`COLOR → ${PALETTE[(colorIdxRef.current+1)%PALETTE.length]}`);
        setTimeout(()=>setToast(null),1000);
      }
      if (id === "gridFlat") setGridType("flat");
      if (id === "gridPointy") setGridType("pointy");
      if (id === "gridSquare") setGridType("square");
      if (id === "smaller") setBrushRadius(r=>Math.max(8, r-((e?.shiftKey)?10:3)));
      if (id === "larger") setBrushRadius(r=>Math.min(120, r+((e?.shiftKey)?10:3)));
    },
    onRebind: (action, key) => {
      setToast(`BOUND ${action.toUpperCase()} → [${key.toUpperCase()}]`);
      setTimeout(()=>setToast(null),1800);
    },
  });
  const [groupsUsed, setGroupsUsed] = useState<number[]>([0]);

  // ---- persistence state (required for backend wiring) ----
  const [savedLabs, setSavedLabs] = useState<any[]>([]);
  const [labName, setLabName] = useState("");
  const [savingLab, setSavingLab] = useState(false);
  const [labError, setLabError] = useState<string|null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<Cell[]>([]);
  const brushRef = useRef<{x:number,y:number, clientX:number, clientY:number}|null>(null);
  const brushRadiusRef = useRef(brushRadius);
  const hexSizeRef = useRef(hexSize);
  const gridTypeRef = useRef(gridType);
  const falloffRef = useRef(falloff);
  const heldRef = useRef<Set<string>>(new Set());
  const colorIdxRef = useRef(colorIdx);
  const rafRef = useRef<number>(0);
  const lastClearRef = useRef<number>(0);

  useEffect(()=>{ brushRadiusRef.current=brushRadius },[brushRadius]);
  useEffect(()=>{ hexSizeRef.current=hexSize },[hexSize]);
  useEffect(()=>{ gridTypeRef.current=gridType },[gridType]);
  useEffect(()=>{ falloffRef.current=falloff },[falloff]);
  useEffect(()=>{ colorIdxRef.current=colorIdx },[colorIdx]);
  useEffect(()=>{ heldRef.current = heldActions },[heldActions]);

  const currentColor = PALETTE[colorIdx % PALETTE.length];
  const secondaryColor = PALETTE[secondaryIdx % PALETTE.length];

  const generate = useCallback(()=>{
    const newCells: Cell[] = [];
    const centerX = CANVAS_W/2;
    const centerY = CANVAS_H/2;
    const qRange = Math.floor(cols/2);
    const rRange = Math.floor(rows/2);
    for(let q=-qRange; q<=qRange; q++){
      for(let r=-rRange; r<=rRange; r++){
        const {x: px, y: py} = axialToPixel(q,r,hexSize,gridType);
        const x = px + centerX;
        const y = py + centerY;
        if(x < -hexSize*2 || x > CANVAS_W+hexSize*2 || y < -hexSize*2 || y > CANVAS_H+hexSize*2) continue;
        newCells.push({
          id: `${q},${r}`,
          q,r,x,y,
          active:false,
          color: PALETTE[0],
          group:0,
          activatedAt:0,
        });
      }
    }
    cellsRef.current = newCells;
    setActiveCount(0);
    setGroupsUsed([0]);
  },[cols, rows, hexSize, gridType]);

  useEffect(()=>{ generate() },[generate]);

  // ---- records API helpers (must use exact literals) ----
  const reloadLabs = useCallback(async ()=>{
    try{
      const res = await fetch("actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "records.list", args: { collection: "paintings" } })
      });
      const json = await res.json();
      if(json && json.data){
        const recs = json.data.records ? json.data.records : json.data;
        if(Array.isArray(recs)) setSavedLabs(recs);
      }
    }catch{
      // backend unavailable in preview - silent
    }
  },[]);

  useEffect(()=>{
    reloadLabs();
  },[reloadLabs]);

  const saveCurrentLab = useCallback(async ()=>{
    if(savingLab) return;
    setSavingLab(true);
    setLabError(null);
    try{
      const activeCells = cellsRef.current.filter(c=>c.active).map(c=>({q:c.q,r:c.r,color:c.color,group:c.group}));
      const truncated = activeCells.slice(0, 340); // keep under 16KiB
      const value = {
        name: labName.trim() || `Lab ${new Date().toLocaleTimeString()}`,
        gridType: gridTypeRef.current,
        hexSize: hexSizeRef.current,
        cols,
        rows,
        active: truncated,
        totalActive: truncated.length,
        palette: PALETTE,
        createdAt: Date.now()
      };
      const res = await fetch("actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "records.create", args: { collection: "paintings", value } })
      });
      const json = await res.json();
      if(!res.ok || json.error){
        throw new Error(json.error || "save failed");
      }
      setLabName("");
      setToast("SAVED LAB • " + value.name);
      setTimeout(()=>setToast(null), 1800);
      await reloadLabs();
    }catch(e:any){
      setLabError(e?.message || String(e));
    }finally{
      setSavingLab(false);
    }
  },[labName, cols, rows, savingLab, reloadLabs]);

  const loadLab = useCallback(async (rec:any)=>{
    try{
      // rec.value contains active cells
      const v = rec.value;
      if(!v || !Array.isArray(v.active)) return;
      const map = new Map<string, {color:string, group:number}>();
      v.active.forEach((a:any)=> map.set(`${a.q},${a.r}`, {color:a.color, group:a.group}));
      cellsRef.current.forEach(c=>{
        const hit = map.get(c.id);
        if(hit){
          c.active = true;
          c.color = hit.color;
          c.group = hit.group;
          c.activatedAt = performance.now();
        } else {
          c.active = false;
        }
      });
      if(v.gridType) setGridType(v.gridType);
      if(v.hexSize) setHexSize(v.hexSize);
      const groups = Array.from(new Set(v.active.map((a:any)=>a.group))) as number[];
      setGroupsUsed(groups.length? groups : [0]);
      setToast(`LOADED ${v.name}`);
      setTimeout(()=>setToast(null),1500);
    }catch{}
  },[]);

  const deleteLab = useCallback(async (id:string)=>{
    try{
      const res = await fetch("actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "records.delete", args: { collection: "paintings", id } })
      });
      const json = await res.json();
      if(!res.ok || json.error) throw new Error(json.error||"delete failed");
      await reloadLabs();
    }catch(e:any){
      setLabError(e?.message || String(e));
    }
  },[reloadLabs]);

  // stats updater
  useEffect(()=>{
    const iv = setInterval(()=>{
      const active = cellsRef.current.filter(c=>c.active).length;
      setActiveCount(active);
    }, 200);
    return ()=>clearInterval(iv);
  },[]);

  // key handling lives in useNCTGraphiteCommands (keymap, held state, rebind).

  // mouse move
  useEffect(()=>{
    const container = containerRef.current;
    if(!container) return;
    const onMove = (e:MouseEvent)=>{
      const canvas = canvasRef.current;
      if(!canvas) return;
      const cRect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / cRect.width;
      const scaleY = CANVAS_H / cRect.height;
      const x = (e.clientX - cRect.left)*scaleX;
      const y = (e.clientY - cRect.top)*scaleY;
      brushRef.current = {
        x,
        y,
        clientX: e.clientX - cRect.left,
        clientY: e.clientY - cRect.top,
      };
    };
    const onLeave = ()=>{
      brushRef.current=null;
    };
    const onDown = ()=>{
      setToast("Mouse aims — use keys to paint");
      setTimeout(()=>setToast(null),1800);
    };
    window.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    container.addEventListener("mousedown", onDown);
    return ()=>{
      window.removeEventListener("mousemove", onMove);
      container?.removeEventListener("mouseleave", onLeave);
      container?.removeEventListener("mousedown", onDown);
    };
  },[]);

  // main render loop
  useEffect(()=>{
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    if(!ctx) return;

    const draw = ()=>{
      const now = performance.now();
      const b = brushRef.current;
      const radius = brushRadiusRef.current;
      const size = hexSizeRef.current;
      const type = gridTypeRef.current;
      const fo = falloffRef.current;
      const cells = cellsRef.current;

      // activation logic
      if(b){
        const threshold = radius + size*0.55;
        const minX = b.x - threshold;
        const maxX = b.x + threshold;
        const minY = b.y - threshold;
        const maxY = b.y + threshold;

        const held = heldRef.current;
        const isPainting = held.has("paint") || held.has("paintSecondary") || held.has("erase") || held.has("toggle");
        let preview = 0;

        for(let i=0;i<cells.length;i++){
          const cell = cells[i];
          if(cell.x < minX || cell.x > maxX || cell.y < minY || cell.y > maxY) continue;
          const dx = cell.x - b.x;
          const dy = cell.y - b.y;
          const dist = Math.hypot(dx,dy);
          if(dist > threshold) continue;
          let alpha = 1;
          if(fo>0){
            alpha = 1 - (dist / threshold)*fo;
            if(alpha < 0.15) continue;
          }
          preview++;

          if(!isPainting) continue;
          if(held.has("paint")){
            if(!cell.active || cell.color!==currentColor){
              cell.active=true;
              cell.color = currentColor;
              cell.group = colorIdxRef.current % PALETTE.length;
              cell.activatedAt = now;
            }
          } else if(held.has("paintSecondary")){
            if(!cell.active || cell.color!==secondaryColor){
              cell.active=true;
              cell.color = secondaryColor;
              cell.group = secondaryIdx % PALETTE.length;
              cell.activatedAt = now;
            }
          } else if(held.has("erase")){
            if(cell.active){
              cell.active=false;
              cell.activatedAt = now;
            }
          } else if(held.has("toggle")){
            if(now - cell.activatedAt > 180){
              cell.active = !cell.active;
              if(cell.active){
                cell.color = currentColor;
                cell.group = colorIdxRef.current % PALETTE.length;
              }
              cell.activatedAt = now;
            }
          }
        }
        if(rafRef.current % 6 === 0){
          setPreviewCount(preview);
        }
      }

      // ---- DRAW ----
      ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
      ctx.fillStyle="#fdfaf3";
      ctx.fillRect(0,0,CANVAS_W,CANVAS_H);

      ctx.save();
      ctx.globalAlpha=0.04;
      for(let i=0;i<400;i++){
        const gx = (i*73 % CANVAS_W);
        const gy = (i*131 % CANVAS_H);
        ctx.fillStyle = i%2?"#1a1a24":"#7c5cff";
        ctx.fillRect(gx, gy, 1,1);
      }
      ctx.restore();

      for(const cell of cells){
        if(cell.active) continue;
        if(showGridLines){
          if(type==="square"){
            const pts = squarePoints(cell.x, cell.y, size);
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for(let k=1;k<pts.length;k++) ctx.lineTo(pts[k][0], pts[k][1]);
            ctx.closePath();
            ctx.fillStyle="#f5f0e0";
            ctx.fill();
            ctx.strokeStyle="#d0c8b8";
            ctx.lineWidth=0.7;
            ctx.stroke();
          } else {
            const pts = hexPoints(cell.x, cell.y, size, type);
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for(let k=1;k<pts.length;k++) ctx.lineTo(pts[k][0], pts[k][1]);
            ctx.closePath();
            ctx.fillStyle="#f5f0e0";
            ctx.fill();
            ctx.strokeStyle="#d0c8b8";
            ctx.lineWidth=0.6;
            ctx.stroke();
          }
        }
        if(showCenters){
          ctx.beginPath();
          ctx.arc(cell.x, cell.y, 1.2, 0, Math.PI*2);
          ctx.fillStyle="#c9c2b3";
          ctx.fill();
        }
      }

      for(const cell of cells){
        if(!cell.active) continue;
        const elapsed = now - cell.activatedAt;
        let scale = 1;
        if(elapsed < 120){
          scale = 0.8 + 0.2*(elapsed/120);
        }
        ctx.save();
        ctx.translate(cell.x, cell.y);
        ctx.scale(scale, scale);
        ctx.translate(-cell.x, -cell.y);

        if(type==="square"){
          const pts = squarePoints(cell.x, cell.y, size);
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for(let k=1;k<pts.length;k++) ctx.lineTo(pts[k][0], pts[k][1]);
          ctx.closePath();
          ctx.fillStyle=cell.color;
          ctx.fill();
          ctx.strokeStyle="#1a1a24";
          ctx.lineWidth=1.1;
          ctx.stroke();
          ctx.globalAlpha=0.18;
          ctx.fillStyle="#fff";
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.lineTo(pts[1][0], pts[1][1]);
          ctx.lineTo(cell.x, cell.y);
          ctx.closePath();
          ctx.fill();
        } else {
          const pts = hexPoints(cell.x, cell.y, size, type);
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for(let k=1;k<pts.length;k++) ctx.lineTo(pts[k][0], pts[k][1]);
          ctx.closePath();
          ctx.fillStyle=cell.color;
          ctx.fill();
          ctx.strokeStyle="#1a1a24";
          ctx.lineWidth=1;
          ctx.stroke();
          ctx.globalAlpha=0.16;
          ctx.fillStyle="#000";
          ctx.beginPath();
          ctx.moveTo(pts[2][0], pts[2][1]);
          ctx.lineTo(pts[3][0], pts[3][1]);
          ctx.lineTo(pts[4][0], pts[4][1]);
          ctx.lineTo(cell.x, cell.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha=0.18;
          ctx.fillStyle="#fff";
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.lineTo(pts[1][0], pts[1][1]);
          ctx.lineTo(cell.x, cell.y);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();

        if(showCenters){
          ctx.beginPath();
          ctx.arc(cell.x, cell.y, 1.5, 0, Math.PI*2);
          ctx.fillStyle="#1a1a24";
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return ()=>cancelAnimationFrame(rafRef.current);
  },[]);

  const [brushClient, setBrushClient] = useState<{x:number,y:number}|null>(null);
  useEffect(()=>{
    const id = setInterval(()=>{
      const b = brushRef.current;
      if(b) setBrushClient({x:b.clientX, y:b.clientY});
      else setBrushClient(null);
    },16);
    return ()=>clearInterval(id);
  },[]);

  const exportSVG = ()=>{
    const cells = cellsRef.current.filter(c=>c.active);
    const groups = new Map<string, Cell[]>();
    cells.forEach(c=>{
      const key = c.color;
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    });
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">\n`;
    svg+=`<rect width="100%" height="100%" fill="#fdfaf3"/>\n`;
    groups.forEach((list, color)=>{
      svg+=`<g fill="${color}" stroke="#1a1a24" stroke-width="1">\n`;
      list.forEach(cell=>{
        const pts = gridType==="square" ? squarePoints(cell.x, cell.y, hexSize) : hexPoints(cell.x, cell.y, hexSize, gridType);
        const ptsStr = pts.map(p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
        svg+=`<polygon points="${ptsStr}" />\n`;
      });
      svg+=`</g>\n`;
    });
    svg+=`</svg>`;
    const blob = new Blob([svg], {type:"image/svg+xml"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url;
    a.download=`hex-paint-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const groupedStats = useMemo(()=>{
    const map = new Map<number, number>();
    cellsRef.current.forEach(c=>{
      if(c.active){
        map.set(c.group, (map.get(c.group)||0)+1);
      }
    });
    return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]);
  },[activeCount, colorIdx]);

  return (
    <>
    <NCTGraphiteAppShell
      maxWidth={1520}
      gap={1}
      proportion="3fr 6fr 3fr"
      className="bg-[#0a0a0f] overflow-x-clip selection:bg-[#7c5cff]/30"
      header={
      <header
        data-safe-area-sticky-top
        className="sticky z-30 border-b border-[#23232f] bg-[#0e0e14]/95 backdrop-blur"
        style={{top:"var(--safe-area-inset-top)"}}
      >
        <div className="mx-auto max-w-[1520px] px-4 md:px-6 h-[52px] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-[28px] h-[28px] rounded-[6px] bg-[#7c5cff] grid place-items-center font-bold text-[14px] text-white">H</div>
            <h1 className="tracking-[0.12em] text-[12px] md:text-[13px] font-bold text-[#ece9e3]">HEX GRID CELL PAINT — CIRCLE ACTIVATES CELLS</h1>
            <span className="hidden md:inline-flex ml-3 px-2 py-[2px] rounded bg-[#1a1a24] border border-[#2a2a3a] text-[10px] text-[#7a7680]">60FPS CANVAS • KEY-CLICK</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#7a7680]">
            <span className="hidden md:inline">FLAT-TOP q,r → x = size·3/2·q</span>
            <div className="w-px h-4 bg-[#23232f] hidden md:block"/>
            <span className="px-2 py-1 rounded bg-[#15151e] border border-[#23232f] text-[#ece9e3]">PROTOTYPE v0.4 + SAVE</span>
          </div>
        </div>
      </header>
      }
      footer={
      <footer className="border-t border-[#23232f] bg-[#0e0e14] h-[28px] flex items-center px-4 text-[10px] text-[#5a5860] justify-between">
        <NCTGraphiteStack direction="row" gap={16}>
          <span className="hidden md:inline">axial q,r → pixel • distance center test • records.list / create persisted</span>
          <span className="text-[#7a7680]">{gridType} • {hexSize}px • {activeCount}/{cellsRef.current.length} active • {((activeCount/cellsRef.current.length)*100||0).toFixed(1)}%</span>
        </NCTGraphiteStack>
        <NCTGraphiteStack direction="row" gap={12}>
          <span>JetBrains Mono</span>
          <span className="px-1.5 py-[1px] rounded bg-[#1a1a24] border border-[#23232f] text-[#7a7680]">PAPER #fdfaf3</span>
        </NCTGraphiteStack>
      </footer>
      }
    >
        <aside className="bg-[#0e0e14] flex flex-col min-h-0">
          <div className="p-4 border-b border-[#1a1a24]">
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">CONTROLS / KEY-MAP</div>
            <div className="space-y-[6px]">
              {Object.entries(ACTIONS_LABEL).map(([action, meta])=>{
                const key = keyMap[action];
                const isHeld = heldActions.has(action);
                const isRebinding = rebinding===action;
                return (
                  <div key={action} className={`group flex items-center justify-between rounded-[8px] border px-2.5 py-[7px] transition ${isHeld?"bg-[#7c5cff] border-[#7c5cff] text-white": isRebinding?"bg-[#1a1a24] border-[#00e5ff]":"bg-[#15151e] border-[#23232f] hover:border-[#2a2a3a]"}`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-[22px] h-[22px] grid place-items-center rounded-[5px] text-[11px] font-bold ${isHeld?"bg-white text-[#7c5cff]":"bg-[#1a1a24] text-[#ece9e3] border border-[#2a2a3a]"}`}>{key.toUpperCase()}</div>
                      <div>
                        <div className={`text-[11px] font-bold leading-none ${isHeld?"text-white":"text-[#ece9e3]"}`}>{meta.label}</div>
                        <div className={`text-[9px] leading-[1.1] mt-[2px] ${isHeld?"text-white/70":"text-[#7a7680]"}`}>{meta.desc}</div>
                      </div>
                    </div>
                    <button
                      onClick={()=> beginRebind(isRebinding?null:action)}
                      className={`text-[9px] tracking-[0.1em] px-2 py-1 rounded border transition ${isRebinding?"bg-[#00e5ff] text-black border-[#00e5ff]":"bg-[#1a1a24] border-[#2a2a3a] text-[#7a7680] hover:text-white hover:border-[#3a3a4a]"}`}
                    >
                      {isRebinding?"PRESS KEY":"REBIND"}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-[10px] bg-[#fdfaf3] text-[#1a1a24] p-3 border border-[#e8e0cc]">
              <div className="text-[10px] font-bold tracking-[0.14em]">HOW IT WORKS</div>
              <div className="mt-2 text-[11px] leading-[1.35] text-[#3a352c]">
                Mouse <b>only aims</b>. Keys do activation. Hold <b>F</b> and move over grid — hexes whose center is within brush radius + size·0.4 become active. <span className="px-1 bg-[#1a1a24] text-white rounded">Q</span> toggles, <span className="px-1 bg-[#ff4d6d] text-white rounded">E</span> erases.
              </div>
              <NCTGraphiteStack direction="row" gap={6} className="mt-2">
                <div className="h-[22px] px-2 rounded-full bg-[#1a1a24] text-white text-[10px] grid place-items-center">○ BRUSH</div>
                <div className="h-[22px] px-2 rounded-full border border-[#1a1a24] text-[10px] grid place-items-center">DIST &lt; R + 0.5·SIZE</div>
              </NCTGraphiteStack>
            </div>
          </div>

          <div className="p-4 space-y-5">
            <div>
              <NCTGraphiteSlider label="BRUSH RADIUS" value={brushRadius} min={8} max={120} format={(v)=>`${Math.round(v)}px`} onChange={(v)=>setBrushRadius(Math.round(v))} />
              <div className="flex justify-between text-[9px] text-[#5a5860] mt-1"><span>[ SMALLER</span><span>LARGER ]</span></div>
            </div>

            <div>
              <div className="text-[11px] tracking-[0.14em] text-[#7a7680] mb-2">ACTIVE COLOR</div>
              <NCTGraphiteStack direction="row" gap={8} wrap>
                {PALETTE.map((col,i)=>{
                  const active = i===colorIdx;
                  return (
                    <button
                      key={col}
                      onClick={()=>setColorIdx(i)}
                      className={`w-[28px] h-[28px] rounded-[8px] border-2 transition ${active?"border-white scale-110":"border-[#23232f] hover:border-[#3a3a4a]"}`}
                      style={{background:col}}
                      aria-label={col}
                    />
                  );
                })}
              </NCTGraphiteStack>
              <NCTGraphiteStack direction="row" gap={8} className="mt-3">
                <div className="flex-1 h-[32px] rounded-[8px] border border-[#23232f] bg-[#15151e] flex items-center px-2 gap-2">
                  <div className="w-[16px] h-[16px] rounded-full" style={{background:currentColor}}/>
                  <span className="text-[11px] text-[#ece9e3]">{currentColor}</span>
                </div>
                <div className="flex-1 h-[32px] rounded-[8px] border border-[#23232f] bg-[#15151e] flex items-center px-2 gap-2">
                  <div className="w-[16px] h-[16px] rounded-full" style={{background:secondaryColor}}/>
                  <span className="text-[11px] text-[#ece9e3]">2nd G</span>
                </div>
              </NCTGraphiteStack>
            </div>

            <NCTGraphiteGrid columns="repeat(3, 1fr)" gap={6}>
              {(["flat","pointy","square"] as GridType[]).map(t=>(
                <button
                  key={t}
                  onClick={()=>setGridType(t)}
                  className={`h-[36px] rounded-[8px] border text-[10px] font-bold tracking-[0.1em] ${gridType===t?"bg-[#ece9e3] text-black border-[#ece9e3]":"bg-[#15151e] border-[#23232f] text-[#7a7680] hover:text-white"}`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </NCTGraphiteGrid>

            <NCTGraphiteStack direction="row" gap={8}>
              <button onClick={()=>{ cellsRef.current.forEach(c=>c.active=false); }} className="flex-1 h-[34px] rounded-[8px] bg-[#1a1a24] border border-[#23232f] text-[10px] font-bold text-[#7a7680] hover:text-white">CLEAR ALL (X)</button>
              <button onClick={exportSVG} className="flex-1 h-[34px] rounded-[8px] bg-[#7c5cff] text-white text-[10px] font-bold">EXPORT SVG</button>
            </NCTGraphiteStack>
          </div>
        </aside>

        {/* CENTER CANVAS */}
        <main className="bg-[#0e0e14] flex flex-col min-h-[520px]">
          <div className="h-[38px] px-4 border-b border-[#1a1a24] flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-3">
              <span className="text-[#7a7680] tracking-[0.14em]">CANVAS</span>
              <span className="px-2 py-[2px] rounded bg-[#15151e] border border-[#23232f] text-[#ece9e3]">960×680 • PAPER #fdfaf3</span>
            </div>
            <div className="text-[#5a5860] hidden md:block">Mouse aims — keys paint. Hold F over hexes to activate.</div>
          </div>

          <div ref={containerRef} className="flex-1 relative bg-[#07070a] grid place-items-start justify-items-center p-3 md:p-6 overflow-hidden">
            <div className="relative shadow-[0_0_0_1px_#23232f,0_20px_60px_rgba(0,0,0,0.5)] rounded-[12px] overflow-hidden bg-[#fdfaf3]">
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className="block w-[90vw] md:w-[560px] lg:w-[640px] h-auto max-w-full aspect-[960/680]"
              />
              {/* brush overlay */}
              {brushClient && (
                <div
                  className="pointer-events-none absolute rounded-full border-2 border-dashed border-[#7c5cff] flex items-center justify-center"
                  style={{
                    left: brushClient.x,
                    top: brushClient.y,
                    width: brushRadius*2 * ( (canvasRef.current?.getBoundingClientRect().width||CANVAS_W) / CANVAS_W ),
                    height: brushRadius*2 * ( (canvasRef.current?.getBoundingClientRect().width||CANVAS_W) / CANVAS_W ),
                    transform:"translate(-50%,-50%)",
                    background:"rgba(124,92,255,0.08)",
                  }}
                >
                  <span className="text-[14px] text-[#7c5cff]">○</span>
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-[2px] rounded bg-[#0e0e14] border border-[#23232f] text-[10px] text-white whitespace-nowrap">
                    {previewCount} cells • R{brushRadius}
                  </span>
                </div>
              )}
              {/* held indicator */}
              {heldActions.size>0 && (
                <NCTGraphiteStack direction="row" gap={6} className="pointer-events-none absolute left-3 top-3">
                  {Array.from(heldActions).map(a=>(
                    <span key={a} className="px-2 py-1 rounded-full bg-[#7c5cff] text-white text-[10px] font-bold tracking-[0.1em]">{ACTIONS_LABEL[a]?.label || a}</span>
                  ))}
                </NCTGraphiteStack>
              )}
            </div>

            {toast && (
              <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-[#ece9e3] text-[#0e0e14] text-[11px] font-bold tracking-[0.08em] shadow-lg" style={{animation:"pop 0.2s ease"}}>
                {toast}
              </div>
            )}
          </div>

          <div className="h-[28px] border-t border-[#1a1a24] px-4 flex items-center justify-between text-[10px] text-[#5a5860]">
            <span>dist = hypot(cell.x-brush.x, cell.y-brush.y) &lt; R+size·0.55</span>
            <span className="text-[#7a7680]">{activeCount} active / {cellsRef.current.length} cells</span>
          </div>
        </main>

        {/* RIGHT PANEL */}
        <aside className="bg-[#0e0e14] flex flex-col">
          <div className="p-4 border-b border-[#1a1a24] space-y-4">
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680]">GRID / RENDER</div>
            <div className="space-y-3">
              <NCTGraphiteSlider label="HEX SIZE" value={hexSize} min={12} max={48} format={(v)=>`${Math.round(v)}px`} onChange={(v)=>setHexSize(Math.round(v))} />
              <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={8}>
                <NCTGraphiteSlider label="COLS" value={cols} min={12} max={40} format={(v)=>`${Math.round(v)}`} onChange={(v)=>setCols(Math.round(v))} />
                <NCTGraphiteSlider label="ROWS" value={rows} min={10} max={30} format={(v)=>`${Math.round(v)}`} onChange={(v)=>setRows(Math.round(v))} />
              </NCTGraphiteGrid>
              <NCTGraphiteSlider label="BRUSH FALLOFF (soft edge)" value={falloff} min={0} max={1} step={0.05} format={(v)=>v.toFixed(2)} onChange={setFalloff} />
                <div className="text-[9px] text-[#5a5860] mt-1">0 = hard cut, 1 = fade by distance • thresh {">"}0.1</div>
            </div>
          </div>

          <div className="p-4 border-b border-[#1a1a24] space-y-2">
            <NCTGraphiteToggle label="Show Centers" checked={showCenters} onChange={setShowCenters} />
            <NCTGraphiteToggle label="Show Grid Lines" checked={showGridLines} onChange={setShowGridLines} />
          </div>

          <div className="p-4 border-b border-[#1a1a24]">
            <div className="text-[11px] tracking-[0.18em] text-[#7a7680] mb-3">STATS / BRUSH</div>
            <NCTGraphiteGrid columns="repeat(2, 1fr)" gap={8} className="text-[10px]">
              <div className="p-2.5 rounded-[8px] bg-[#15151e] border border-[#23232f]">
                <div className="text-[#7a7680]">TOTAL CELLS</div>
                <div className="text-[16px] font-bold text-white mt-1">{cellsRef.current.length}</div>
              </div>
              <div className="p-2.5 rounded-[8px] bg-[#7c5cff]/10 border border-[#7c5cff]/30">
                <div className="text-[#b8a6ff]">ACTIVE</div>
                <div className="text-[16px] font-bold text-[#7c5cff] mt-1">{activeCount}</div>
              </div>
              <div className="p-2.5 rounded-[8px] bg-[#15151e] border border-[#23232f]">
                <div className="text-[#7a7680]">BRUSH POS</div>
                <div className="text-[11px] font-bold text-white mt-1">{brushRef.current? `${Math.round(brushRef.current.x)}, ${Math.round(brushRef.current.y)}` : "—"}</div>
              </div>
              <div className="p-2.5 rounded-[8px] bg-[#00e5ff]/10 border border-[#00e5ff]/30">
                <div className="text-[#7deeff]">IN BRUSH</div>
                <div className="text-[16px] font-bold text-[#00e5ff] mt-1">{previewCount}</div>
              </div>
            </NCTGraphiteGrid>
          </div>

          <div className="p-4 border-b border-[#1a1a24]">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] tracking-[0.18em] text-[#7a7680]">COLOR GROUPS</div>
              <button onClick={()=>{ setGroupsUsed([0]); cellsRef.current.forEach(c=>c.active=false); }} className="text-[9px] px-2 py-1 rounded bg-[#1a1a24] border border-[#23232f] text-[#7a7680]">RESET</button>
            </div>
            <div className="space-y-1.5">
              {groupedStats.length===0 && <div className="text-[10px] text-[#5a5860] p-3 border border-dashed border-[#23232f] rounded-[8px]">No active cells yet. Hold F and aim.</div>}
              {groupedStats.map(([gIdx,count])=>{
                const col = PALETTE[gIdx % PALETTE.length];
                return (
                  <NCTGraphiteStack direction="row" justify="between" align="center" className="p-2 rounded-[8px] bg-[#15151e] border border-[#23232f]">
                    <NCTGraphiteStack direction="row" align="center" gap={8}>
                      <div className="w-4 h-4 rounded-[4px]" style={{background:col}}/>
                      <span className="text-[11px] text-white">{col}</span>
                      <span className="text-[10px] text-[#7a7680]">g{gIdx}</span>
                    </NCTGraphiteStack>
                    <NCTGraphiteStack direction="row" align="center" gap={8}>
                      <span className="text-[11px] font-bold text-white">{count}</span>
                      <button onClick={()=>{
                        cellsRef.current.forEach(c=>{ if(c.group===gIdx) c.active=false; });
                        setGroupsUsed(g=>g.filter(x=>x!==gIdx));
                      }} className="w-5 h-5 grid place-items-center rounded bg-[#1a1a24] text-[#7a7680] hover:text-[#ff4d6d]">×</button>
                    </NCTGraphiteStack>
                  </NCTGraphiteStack>
                );
              })}
            </div>

            <div className="mt-6 space-y-3">
              <button onClick={exportSVG} className="w-full h-[42px] rounded-[10px] bg-[#ece9e3] text-[#0e0e14] text-[11px] font-bold tracking-[0.12em] hover:bg-white transition flex items-center justify-center gap-2">
                <span className="w-5 h-5 rounded bg-[#0e0e14] text-white grid place-items-center text-[10px]">↗</span> EXPORT SVG (BY COLOR)
              </button>

              {/* Persistent save section - required for records.create */}
              <div className="p-3 rounded-[10px] bg-[#15151e] border border-[#2a2a3a]">
                <div className="text-[10px] font-bold tracking-[0.14em] text-[#ece9e3] mb-2">SAVE LAB (PERSISTENT)</div>
                <NCTGraphiteStack direction="row" gap={8}>
                  <input value={labName} onChange={e=>setLabName(e.target.value)} placeholder="Lab name (optional)" className="flex-1 h-[34px] px-3 rounded-[8px] bg-[#0e0e14] border border-[#23232f] text-[11px] text-white placeholder:text-[#5a5860] outline-none"/>
                  <button onClick={saveCurrentLab} disabled={savingLab} className="h-[34px] px-4 rounded-[8px] bg-[#7c5cff] text-white text-[11px] font-bold disabled:opacity-50">
                    {savingLab ? "SAVING..." : "SAVE"}
                  </button>
                </NCTGraphiteStack>
                {labError && <div className="mt-2 text-[10px] text-[#ff4d6d]">{labError}</div>}
                <div className="mt-2 text-[9px] text-[#5a5860]">Saves active cells to backend via records.create. Max 340 cells per save (16KiB limit).</div>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] tracking-[0.18em] text-[#7a7680]">SAVED LABS</div>
                <button onClick={reloadLabs} className="text-[9px] px-2 py-1 rounded bg-[#1a1a24] border border-[#23232f] text-[#7a7680] hover:text-white">REFRESH</button>
              </div>
              <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                {savedLabs.length===0 && <div className="text-[10px] text-[#5a5860] p-2 border border-dashed border-[#23232f] rounded-[8px]">No saved labs yet. Paint then SAVE.</div>}
                {savedLabs.map((rec:any)=>(
                  <div key={rec.id} className="flex items-center justify-between p-2 rounded-[8px] bg-[#15151e] border border-[#23232f]">
                    <div className="min-w-0">
                      <div className="text-[11px] text-white truncate">{rec.value?.name || rec.id.slice(0,8)}</div>
                      <div className="text-[9px] text-[#7a7680]">{rec.value?.totalActive||rec.value?.active?.length||0} cells • {rec.value?.gridType} • {new Date(rec.value?.createdAt||rec.created_at).toLocaleTimeString()}</div>
                    </div>
                    <NCTGraphiteStack direction="row" gap={4}>
                      <button onClick={()=>loadLab(rec)} className="px-2 py-1 rounded bg-[#ece9e3] text-black text-[10px] font-bold">LOAD</button>
                      <button onClick={()=>deleteLab(rec.id)} className="px-1.5 py-1 rounded bg-[#1a1a24] border border-[#23232f] text-[#7a7680] text-[10px]">×</button>
                    </NCTGraphiteStack>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 p-3 rounded-[10px] bg-[#15151e] border border-[#23232f]">
              <div className="text-[10px] font-bold text-[#ece9e3] tracking-[0.12em]">FORMULA</div>
              <div className="mt-2 font-mono text-[10px] text-[#7a7680] leading-[1.4]">
                flat: x=size·1.5·q<br/>y=size·√3·(r+q/2)<br/>pointy: x=size·√3·(q+r/2)<br/>y=size·1.5·r<br/><br/>hit: dist&lt;R+size·0.55<br/>α=1-(dist/thr)·falloff
              </div>
            </div>
          </div>
        </aside>
    </NCTGraphiteAppShell>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap'); *{font-family:"JetBrains Mono", monospace} @keyframes pop{0%{transform:translate(-50%,-6px) scale(0.96)}100%{transform:translate(-50%,0) scale(1)}}`}</style>
    </>
  );
}
