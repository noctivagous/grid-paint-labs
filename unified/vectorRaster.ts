import { vectorStyle, type VectorSample } from '@nct/nctgraphite';
import { changedSampleIndices, sampleSpatialIndex } from './sampleSpatial';
import type { VectorFieldLayer, GridPaintDocument } from './layers';

type Hover = { x: number; y: number; radius: number } | null;
type Entry = { key: string; image: HTMLCanvasElement; samples: readonly VectorSample[]; index: ReturnType<typeof sampleSpatialIndex<VectorSample>>; maxExtent: number; hover: Hover };
const images = new WeakMap<object, Map<string, Entry>>();

/** Live vector marks, cached per layer and repainted only where they change. */
export function vectorRaster(owner: object, layer: VectorFieldLayer, canvas: GridPaintDocument['snapshot']['canvas'], opacity: number, brush: Hover, painting: boolean): HTMLCanvasElement {
  let cache = images.get(owner);
  if (!cache) { cache = new Map(); images.set(owner, cache); }
  const samples = layer.data.vectors;
  const minCell = Math.min(canvas.width / layer.settings.columns, canvas.height / layer.settings.rows);
  const key = JSON.stringify([canvas.width, canvas.height, layer.settings.columns, layer.settings.rows, layer.settings.gridKind, layer.settings.showVectors, layer.settings.weight, layer.settings.minWidth, opacity]);
  const hover = layer.settings.showVectors && layer.settings.hoverThin && !painting && brush ? { ...brush } : null;
  let entry = cache.get(layer.id);
  const full = !entry || entry.key !== key || entry.samples.length !== samples.length;
  if (!entry || entry.image.width !== canvas.width || entry.image.height !== canvas.height) {
    const image = document.createElement('canvas'); image.width = canvas.width; image.height = canvas.height;
    entry = { key: '', image, samples: [], index: sampleSpatialIndex([], minCell), maxExtent: 2, hover: null };
    if (cache.size >= 6 && !cache.has(layer.id)) cache.delete(cache.keys().next().value!);
    cache.set(layer.id, entry);
  }
  const extent = (v: VectorSample) => {
    const m = Math.hypot(v.vx, v.vy);
    return Math.max(2, m * minCell * 0.9 + 4 + m * 3 + Math.max(layer.settings.minWidth ?? 1, m * (layer.settings.weight ?? 2.2)) + 2);
  };
  let dirty: number[] | null = full ? null : changedSampleIndices(samples, entry.samples);
  if (!full && dirty === null) {
    dirty = [];
    for (let i = 0; i < samples.length; i++) {
      const a = entry.samples[i], b = samples[i];
      if (a.x !== b.x || a.y !== b.y || a.vx !== b.vx || a.vy !== b.vy) dirty.push(i);
    }
  }
  if (full) {
    entry.index = sampleSpatialIndex(samples, minCell);
    entry.maxExtent = samples.reduce((max, sample) => Math.max(max, extent(sample)), 2);
  } else if (dirty?.length) {
    if (dirty.some(i => entry!.samples[i].x !== samples[i].x || entry!.samples[i].y !== samples[i].y)) entry.index = sampleSpatialIndex(samples, minCell);
    for (const i of dirty) entry.maxExtent = Math.max(entry.maxExtent, extent(entry.samples[i]), extent(samples[i]));
  }
  let left = full ? 0 : canvas.width, top = full ? 0 : canvas.height, right = full ? canvas.width : 0, bottom = full ? canvas.height : 0;
  const add = (x: number, y: number, radius: number) => { left = Math.min(left, x - radius); top = Math.min(top, y - radius); right = Math.max(right, x + radius); bottom = Math.max(bottom, y + radius); };
  if (!full) {
    for (const i of dirty ?? []) { add(entry.samples[i].x, entry.samples[i].y, extent(entry.samples[i])); add(samples[i].x, samples[i].y, extent(samples[i])); }
    if (JSON.stringify(entry.hover) !== JSON.stringify(hover)) {
      if (entry.hover) add(entry.hover.x, entry.hover.y, entry.hover.radius + entry.maxExtent);
      if (hover) add(hover.x, hover.y, hover.radius + entry.maxExtent);
    }
  }
  if (right > left && bottom > top) {
    left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top)); right = Math.min(canvas.width, Math.ceil(right)); bottom = Math.min(canvas.height, Math.ceil(bottom));
    const ctx = entry.image.getContext('2d')!;
    ctx.clearRect(left, top, right - left, bottom - top); ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    const indices = full ? samples.map((_, i) => i) : entry.index.withinBounds(left - entry.maxExtent, top - entry.maxExtent, right + entry.maxExtent, bottom + entry.maxExtent);
    ctx.fillStyle = '#1a1a24'; ctx.globalAlpha = 0.12 * opacity;
    for (const i of indices) { const v = samples[i]; ctx.beginPath(); ctx.arc(v.x, v.y, 0.8, 0, Math.PI * 2); ctx.fill(); }
    if (layer.settings.showVectors) for (const i of indices) {
      const v = samples[i];
      const preview = !!hover && Math.hypot(v.x - hover.x, v.y - hover.y) < hover.radius;
      const style = vectorStyle(v.vx, v.vy, preview, { weight: layer.settings.weight ?? 2.2, minWidth: layer.settings.minWidth ?? 1 });
      if (style.skip) continue;
      const angle = Math.atan2(v.vy, v.vx), length = style.m * minCell * 0.9;
      const x = v.x + Math.cos(angle) * length, y = v.y + Math.sin(angle) * length;
      ctx.globalAlpha = style.alpha * opacity; ctx.strokeStyle = `hsl(${style.hue}, 95%, ${style.light}%)`; ctx.lineWidth = style.width; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(x, y); ctx.stroke();
      if (style.arrow) {
        const head = 4 + style.m * 3;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle + Math.PI * .82) * head, y + Math.sin(angle + Math.PI * .82) * head); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle - Math.PI * .82) * head, y + Math.sin(angle - Math.PI * .82) * head); ctx.stroke();
      }
    }
    ctx.restore();
  }
  entry.key = key; entry.samples = samples; entry.hover = hover;
  return entry.image;
}
