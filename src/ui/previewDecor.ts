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

/**
 * Płaszczyzna z legendami, środek = środek wierzchu nakładki (`w` × `h` mm). Legendy jak z legendLayout:
 * x, y = środek napisu (mm, +y od użytkownika), size = wysokość wielkiej litery (mm).
 * Tekstury trzymane w `cache`, żeby przebudowa podglądu nie rysowała ich od nowa.
 */
export function legendPlane(cache: Map<string, THREE.CanvasTexture>, items: PlacedLegend[], color: string, w: number, h: number): THREE.Mesh {
  const PX = 24; // pikseli na mm
  // legendy przedniej ścianki (Fn) widać w podglądzie klawisza w zakładce Nakładki, nie na wierzchu
  items = items.filter((it) => it.face !== 'front');
  const key = JSON.stringify([items, color, w.toFixed(2), h.toFixed(2)]);
  let tex = cache.get(key);
  if (!tex) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(8, Math.round(w * PX));
    cv.height = Math.max(8, Math.round(h * PX));
    const c2 = cv.getContext('2d')!;
    c2.fillStyle = color;
    c2.textAlign = 'center';
    c2.textBaseline = 'alphabetic';
    for (const it of items) {
      c2.font = `900 ${(it.size / CAP_EM) * PX}px ${FACE}, system-ui, Arial, sans-serif`;
      // linia bazowa pół wysokości wielkiej litery pod środkiem napisu
      c2.fillText(it.text, (it.x + w / 2) * PX, (h / 2 - it.y + it.size / 2) * PX);
    }
    tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, tex);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.userData.legend = true;
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
