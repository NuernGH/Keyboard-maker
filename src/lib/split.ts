// SPDX-License-Identifier: AGPL-3.0-or-later
// Podział do druku: gdy płyta nie mieści się na stole drukarki, generator tnie ją na dwie części.
// Płyta: cięcie schodkami po krawędziach klawiszy (żadna komórka nie jest przecięta), w ramce
// u góry i u dołu zamki na jaskółczy ogon. Spód obudowy: cięcie proste, w innym miejscu niż
// płyta, więc każda część spodu przykrywa szew płyty. Śruby po obu stronach obu szwów
// skręcają całość. Tu same liczby; bryły tnie geometry.ts.

import { PITCH, keyCorners, type Key } from './layout';
import type { IslandGeom } from './island';

export interface PrintParams {
  /** stół drukarki (mm) */
  bedX: number;
  bedY: number;
  /** auto: tnij tylko, gdy nie mieści się na stole; off: nigdy */
  mode: 'auto' | 'off';
  /** luz w szwie płyty i w zamkach (mm, łącznie) */
  clearance: number;
}

export const DEFAULT_PRINT: PrintParams = { bedX: 250, bedY: 250, mode: 'auto', clearance: 0.15 };

/** Zamek na jaskółczy ogon: wypust na lewej części, wchodzi w prawą (w stronę +X). */
export const DOVETAIL = { depth: 3.5, neck: 2.4, head: 4.4 };
/** Odstęp szwu spodu od szwu płyty (mm), od 2U w dół do 1U, jeśli inaczej się nie mieści. */
const CASE_SEAM_OFFSETS = [2, 1.75, 1.5, 1.25, 1].map((u) => u * PITCH);

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PrintSplit {
  /** linia cięcia płyty od góry do dołu (pionowe i poziome odcinki); końce wychodzą poza płytę */
  seam: [number, number][];
  /** środki zamków (x na szwie, y w ramce) */
  dovetails: [number, number][];
  /** cięcie spodu obudowy: x = caseX */
  caseX: number;
  /** wymiary części płyty i spodu [szer., wys.] (mm), do sprawdzenia ze stołem */
  plateParts: [number, number][];
  caseParts: [number, number][];
  /** czy wszystkie części mieszczą się na stole */
  fits: boolean;
}

/** Obrys płyty w XY (klawisze, wyspa, margines). */
export function plateBounds(keys: Key[], island: IslandGeom | null, margin: number): Rect {
  const pts = keys.flatMap(keyCorners);
  if (island) {
    const r = island.rect;
    pts.push([r.x0, r.y0], [r.x1, r.y1]);
  }
  return {
    x0: Math.min(...pts.map((p) => p[0])) - margin,
    x1: Math.max(...pts.map((p) => p[0])) + margin,
    y0: Math.min(...pts.map((p) => p[1])) - margin,
    y1: Math.max(...pts.map((p) => p[1])) + margin,
  };
}

const fitsBed = (w: number, h: number, pp: PrintParams) =>
  (w <= pp.bedX + 1e-6 && h <= pp.bedY + 1e-6) || (w <= pp.bedY + 1e-6 && h <= pp.bedX + 1e-6);

interface Row {
  top: number;
  bottom: number;
  /** krawędzie klawiszy w rzędzie, przez które można ciąć */
  edges: number[];
}

/** Rzędy klawiszy (od góry) z możliwymi miejscami cięcia między klawiszami. */
function rowsOf(keys: Key[]): Row[] {
  const rows: { y: number; keys: Key[] }[] = [];
  for (const k of [...keys].sort((a, b) => b.y - a.y)) {
    const r = rows.find((q) => Math.abs(q.y - k.y) < PITCH / 2);
    if (r) r.keys.push(k);
    else rows.push({ y: k.y, keys: [k] });
  }
  return rows.map(({ keys: ks }) => {
    const pts = ks.flatMap(keyCorners);
    const xs = new Set<number>();
    for (const k of ks)
      for (const sx of [-1, 1]) {
        const ext = Math.max(...keyCorners(k).map((p) => sx * p[0])) * sx;
        xs.add(Math.round(ext * 1000) / 1000);
      }
    // krawędź jest dobra, gdy nie wchodzi w żaden klawisz rzędu
    const edges = [...xs].filter((x) =>
      ks.every((k) => {
        const c = keyCorners(k).map((p) => p[0]);
        return x <= Math.min(...c) + 1e-3 || x >= Math.max(...c) - 1e-3;
      }),
    );
    return { top: Math.max(...pts.map((p) => p[1])), bottom: Math.min(...pts.map((p) => p[1])), edges: edges.sort((a, b) => a - b) };
  });
}

/**
 * Wyznacza podział, gdy płyta (z marginesem) albo spód (z luzem i ścianką) nie mieści się
 * na stole. Zwraca null, gdy cięcie nie jest potrzebne albo wyłączone.
 */
export function planSplit(keys: Key[], island: IslandGeom | null, margin: number, caseExtra: number | null, pp: PrintParams): PrintSplit | null {
  if (pp.mode === 'off' || !keys.length) return null;
  const pb = plateBounds(keys, island, margin);
  const ext = caseExtra ?? 0;
  const cb = { x0: pb.x0 - ext, x1: pb.x1 + ext, y0: pb.y0 - ext, y1: pb.y1 + ext };
  if (fitsBed(cb.x1 - cb.x0, cb.y1 - cb.y0, pp)) return null;

  const rows = rowsOf(keys);
  if (rows.some((r) => !r.edges.length)) return null;
  const H = pb.y1 - pb.y0;
  const isl = island?.rect;
  const far = 50;

  let best: { score: number; split: PrintSplit } | null = null;
  const targets: number[] = [];
  for (let x = pb.x0; x <= pb.x1; x += 1) targets.push(x);
  for (const T of targets) {
    const xs = rows.map((r) => r.edges.reduce((b, e) => (Math.abs(e - T) < Math.abs(b - T) ? e : b)));
    // pierwszy i ostatni odcinek przechodzą przez ramkę: nie mogą trafić w wyspę
    if (isl) {
      const crosses = (x: number, y0: number, y1: number) => x > isl.x0 - 3 && x < isl.x1 + 3 && y1 > isl.y0 && y0 < isl.y1;
      if (crosses(xs[0], rows[0].top, pb.y1 + far) || crosses(xs[xs.length - 1], pb.y0 - far, rows[rows.length - 1].bottom)) continue;
    }
    const seam: [number, number][] = [[xs[0], pb.y1 + far]];
    for (let i = 0; i < rows.length; i++) {
      const yb = i < rows.length - 1 ? (rows[i].bottom + rows[i + 1].top) / 2 : pb.y0 - far;
      seam.push([xs[i], yb]);
      if (i < rows.length - 1 && Math.abs(xs[i + 1] - xs[i]) > 1e-6) seam.push([xs[i + 1], yb]);
    }
    const sMin = Math.min(...xs);
    const sMax = Math.max(...xs);
    const plateParts: [number, number][] = [
      [sMax + DOVETAIL.depth - pb.x0, H],
      [pb.x1 - sMin, H],
    ];
    // szew spodu: po tej stronie, gdzie części wychodzą bardziej równe
    let caseX: number | null = null;
    let caseParts: [number, number][] = [];
    let caseScore = Infinity;
    for (const d of CASE_SEAM_OFFSETS)
      for (const cx of [sMax + d, sMin - d]) {
        const parts: [number, number][] = [
          [cx - cb.x0, cb.y1 - cb.y0],
          [cb.x1 - cx, cb.y1 - cb.y0],
        ];
        if (parts.some(([w]) => w < 20)) continue;
        const ok = parts.every(([w, h]) => fitsBed(w, h, pp));
        const sc = Math.max(parts[0][0], parts[1][0]) + (ok ? 0 : 1e4);
        if (sc < caseScore - 1e-6) {
          caseScore = sc;
          caseX = cx;
          caseParts = parts;
        }
      }
    if (caseX === null) continue;
    const fits = plateParts.every(([w, h]) => fitsBed(w, h, pp)) && caseParts.every(([w, h]) => fitsBed(w, h, pp));
    let jog = 0;
    for (let i = 1; i < xs.length; i++) jog += Math.abs(xs[i] - xs[i - 1]);
    const score = (fits ? 0 : 1e5) + Math.max(plateParts[0][0], plateParts[1][0]) + 0.1 * jog + (caseScore % 1e4) * 0.01;
    const dovetails: [number, number][] = [
      [xs[0], rows[0].top + margin / 2],
      [xs[xs.length - 1], rows[rows.length - 1].bottom - margin / 2],
    ];
    if (!best || score < best.score - 1e-6) best = { score, split: { seam, dovetails, caseX, plateParts, caseParts, fits } };
  }
  return best?.split ?? null;
}

/**
 * Obszar lewej części płyty jako wielokąt: wszystko na lewo od szwu plus wypusty zamków.
 * Luz dodaje geometry.ts przez offset wielokąta (zwężenie dla lewej części, poszerzenie
 * dla wycięcia z prawej).
 */
export function leftRegion(split: PrintSplit): [number, number][] {
  const s = split.seam;
  const farX = Math.min(...s.map((p) => p[0])) - 1000;
  const [dTop, dBot] = split.dovetails;
  const { depth, neck, head } = DOVETAIL;
  // wypust idzie w prawo od pionowego odcinka szwu; obchodzimy wielokąt zgodnie z ruchem wskazówek
  const tab = (x: number, y: number): [number, number][] => [
    [x, y + neck / 2],
    [x + depth, y + head / 2],
    [x + depth, y - head / 2],
    [x, y - neck / 2],
  ];
  const pts: [number, number][] = [[farX, s[0][1]]];
  for (let i = 0; i < s.length; i++) {
    pts.push(s[i]);
    if (i === 0) pts.push(...tab(s[0][0], dTop[1]));
    if (i === s.length - 2) pts.push(...tab(s[i][0], dBot[1]));
  }
  pts.push([farX, s[s.length - 1][1]]);
  return dedupe(pts);
}

function dedupe(pts: [number, number][]): [number, number][] {
  return pts.filter((p, i) => {
    const q = pts[(i + pts.length - 1) % pts.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
}

/** Do której części należy klawisz (0 = lewa, 1 = prawa). */
export function pieceOf(split: PrintSplit, x: number, y: number): 0 | 1 {
  return pointInPoly(x, y, leftRegion(split)) ? 0 : 1;
}

export function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Odległość punktu od linii szwu (mm). */
export function distToSeam(split: PrintSplit, x: number, y: number): number {
  let d = Infinity;
  const s = split.seam;
  for (let i = 0; i < s.length - 1; i++) {
    const [ax, ay] = s[i];
    const [bx, by] = s[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return d;
}

/** Miejsca, w pobliżu których muszą być śruby: po obu stronach szwu płyty i szwu spodu, u góry i u dołu. */
export function seamScrewTargets(split: PrintSplit, keys: Key[], margin: number): [number, number][] {
  const ys = keys.flatMap(keyCorners).map((p) => p[1]);
  const top = Math.max(...ys) + margin / 2;
  const bot = Math.min(...ys) - margin / 2;
  const [dTop, dBot] = split.dovetails;
  const off = 9;
  return [
    [dTop[0] - off, top],
    [dTop[0] + DOVETAIL.depth + off, top],
    [dBot[0] - off, bot],
    [dBot[0] + DOVETAIL.depth + off, bot],
    [split.caseX - 7, top],
    [split.caseX + 7, top],
    [split.caseX - 7, bot],
    [split.caseX + 7, bot],
  ];
}
