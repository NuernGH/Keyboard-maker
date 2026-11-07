// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Dodatki podglądu 3D do kolorów (płaska klawiatura i Dactyl): legendy na wierzchu nakładek
 * (tekstura z canvas) i podświetlenie RGB pod obudową. Tylko wygląd; nic z tego nie trafia do plików.
 */
import * as THREE from 'three';
import type { PlacedLegend } from '../lib/legend';
import type { PreviewColors } from '../lib/colors';

const topCache = new WeakMap<THREE.BufferGeometry, { w: number; h: number; z: number }>();

/** wymiary płaskiego wierzchu nakładki (mm) i jego wysokość, z siatki nakładki (środek w 0, 0) */
export function meshTop(g: THREE.BufferGeometry): { w: number; h: number; z: number } {
  let t = topCache.get(g);
  if (t) return t;
  const pa = g.getAttribute('position');
  let zMax = -Infinity;
  for (let i = 0; i < pa.count; i++) zMax = Math.max(zMax, pa.getZ(i));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pa.count; i++)
    if (pa.getZ(i) > zMax - 0.4) {
      x0 = Math.min(x0, pa.getX(i));
      x1 = Math.max(x1, pa.getX(i));
      y0 = Math.min(y0, pa.getY(i));
      y1 = Math.max(y1, pa.getY(i));
    }
  t = { w: x1 - x0, h: y1 - y0, z: zMax };
  topCache.set(g, t);
  return t;
}

/** czcionka legend (ta sama co w plikach do druku) jako FontFace do rysowania na canvas */
const FACE = 'LegendNotoSans';
let facePending: Promise<boolean> | null = null;
export function loadLegendFace(): Promise<boolean> {
  facePending ??= (async () => {
    try {
      const f = new FontFace(FACE, `url(${import.meta.env.BASE_URL}fonts/NotoSans-Black.ttf)`, { weight: '900' });
      await f.load();
      document.fonts.add(f);
      return true;
    } catch {
      return false;
    }
  })();
  return facePending;
}
/** wysokość wielkiej litery Noto Sans w em */
const CAP_EM = 0.714;

/** rysuje napisy na canvas `w` × `h` mm: środek obrysu znaków (nie linii bazowej) w (x, y), jak w legendLayout */
function drawLegends(items: PlacedLegend[], color: string, w: number, h: number): THREE.CanvasTexture {
  const PX = 24; // pikseli na mm
  const cv = document.createElement('canvas');
  cv.width = Math.max(8, Math.round(w * PX));
  cv.height = Math.max(8, Math.round(h * PX));
  const c2 = cv.getContext('2d')!;
  c2.fillStyle = color;
  c2.textAlign = 'left';
  c2.textBaseline = 'alphabetic';
  for (const it of items) {
    c2.font = `900 ${(it.size / CAP_EM) * PX}px ${FACE}, system-ui, Arial, sans-serif`;
    // generator ustawia obrys znaków (przecinek, kropka, „-” leżą nisko przy linii bazowej), więc tu też
    const m = c2.measureText(it.text);
    const cx = (it.x + w / 2) * PX;
    const cy = (h / 2 - it.y) * PX;
    c2.fillText(it.text, cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function legendMesh(cache: Map<string, THREE.CanvasTexture>, items: PlacedLegend[], color: string, w: number, h: number): THREE.Mesh {
  const key = JSON.stringify([items, color, w.toFixed(2), h.toFixed(2)]);
  let tex = cache.get(key);
  if (!tex) {
    tex = drawLegends(items, color, w, h);
    cache.set(key, tex);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.userData.legend = true;
  return m;
}

/**
 * Płaszczyzna z legendami, środek = środek wierzchu nakładki (`w` × `h` mm). Legendy jak z legendLayout:
 * x, y = środek obrysu napisu (mm, +y od użytkownika), size = wysokość wielkiej litery (mm).
 * Tekstury trzymane w `cache`, żeby przebudowa podglądu nie rysowała ich od nowa.
 */
export function legendPlane(cache: Map<string, THREE.CanvasTexture>, items: PlacedLegend[], color: string, w: number, h: number): THREE.Mesh {
  return legendMesh(cache, items.filter((it) => it.face !== 'front'), color, w, h);
}

const frontCache = new WeakMap<THREE.BufferGeometry, { y: number; z: number; tilt: number; slant: number; width: number }>();

/**
 * Przednia ścianka nakładki (strona −y) z siatki, jak capFrontFace: środek (y, z), nachylenie od pionu (stopnie),
 * długość wzdłuż spadku i szerokość w połowie wysokości (mm).
 */
export function meshFront(g: THREE.BufferGeometry): { y: number; z: number; tilt: number; slant: number; width: number } {
  let f = frontCache.get(g);
  if (f) return f;
  const pa = g.getAttribute('position');
  let yMin = Infinity, zMax = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < pa.count; i++) {
    yMin = Math.min(yMin, pa.getY(i));
    zMax = Math.max(zMax, pa.getZ(i));
    x0 = Math.min(x0, pa.getX(i));
    x1 = Math.max(x1, pa.getX(i));
  }
  // dolna krawędź ścianki: najniższy punkt na samym przodzie; górna: najbardziej wysunięty punkt wierzchu
  let z0 = Infinity, yTop = Infinity, tx0 = Infinity, tx1 = -Infinity;
  for (let i = 0; i < pa.count; i++) {
    if (pa.getY(i) < yMin + 0.05) z0 = Math.min(z0, pa.getZ(i));
    if (pa.getZ(i) > zMax - 0.05) {
      yTop = Math.min(yTop, pa.getY(i));
      tx0 = Math.min(tx0, pa.getX(i));
      tx1 = Math.max(tx1, pa.getX(i));
    }
  }
  const H = zMax - z0;
  const dy = yTop - yMin;
  f = { y: (yMin + yTop) / 2, z: z0 + H / 2, tilt: (Math.atan2(dy, H) * 180) / Math.PI, slant: Math.hypot(dy, H), width: (x1 - x0 + tx1 - tx0) / 2 };
  frontCache.set(g, f);
  return f;
}

/**
 * Legendy przedniej ścianki (Fn) na płaszczyźnie przyłożonej do ścianki nakładki o siatce `g`, tak jak rowek
 * w modelu (applyLegend: obrót o 90° − nachylenie wokół X). Null, gdy klawisz nie ma legend na ściance.
 */
export function legendFront(cache: Map<string, THREE.CanvasTexture>, items: PlacedLegend[], color: string, g: THREE.BufferGeometry): THREE.Mesh | null {
  const front = items.filter((it) => it.face === 'front');
  if (!front.length) return null;
  const f = meshFront(g);
  const m = legendMesh(cache, front, color, f.width, f.slant);
  m.rotation.x = ((90 - f.tilt) * Math.PI) / 180;
  // odrobinę przed ścianką (wzdłuż jej normalnej), żeby nie migotała
  const a = (f.tilt * Math.PI) / 180;
  m.position.set(0, f.y - 0.04 * Math.cos(a), f.z + 0.04 * Math.sin(a));
  return m;
}

/** tekstura poświaty: rozmyta ramka w kolorze (tęcza albo jeden kolor) */
function glowTexture(mode: 'rainbow' | 'single', color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  const c2 = cv.getContext('2d')!;
  if (mode === 'rainbow') {
    const gr = c2.createLinearGradient(0, 0, 1024, 0);
    ['#ff2bd6', '#8a2bff', '#2b8cff', '#00e5ff', '#2bff88', '#ffe32b', '#ff7a2b', '#ff2bd6'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
    c2.fillStyle = gr;
  } else c2.fillStyle = color;
  c2.fillRect(0, 0, 1024, 512);
  const mk = document.createElement('canvas');
  mk.width = 1024;
  mk.height = 512;
  const mc = mk.getContext('2d')!;
  mc.filter = 'blur(28px)';
  mc.strokeStyle = '#fff';
  mc.lineWidth = 50;
  mc.strokeRect(150, 130, 724, 252);
  c2.globalCompositeOperation = 'destination-in';
  c2.drawImage(mk, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** podświetlenie pod obiektem `of`: poświata na podłożu wokół spodu + cztery kolorowe światła od dołu */
export function glowGroup(of: THREE.Object3D, glow: PreviewColors['glow']): THREE.Group {
  const out = new THREE.Group();
  const box = new THREE.Box3().setFromObject(of);
  if (box.isEmpty()) return out;
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const s = Math.min(1, Math.max(0, glow.strength));
  const pl = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 1.45, h * 2.1),
    new THREE.MeshBasicMaterial({ map: glowTexture(glow.mode, glow.color), transparent: true, opacity: 0.25 + 0.75 * s, depthWrite: false }),
  );
  pl.position.set(cx, cy, box.min.z - 0.5);
  out.add(pl);
  const rainbow = ['#ff2bd6', '#2b8cff', '#00e5ff', '#ffe32b'];
  const spots: [number, number][] = [[-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5]];
  spots.forEach(([fx, fy], i) => {
    const L = new THREE.PointLight(glow.mode === 'rainbow' ? rainbow[i] : glow.color, 600 * s, 90, 2);
    L.position.set(cx + fx * w * 0.9, cy + fy * h * 0.9, box.min.z + 4);
    out.add(L);
  });
  return out;
}

export function disposeGlow(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mat = o.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
  });
}
