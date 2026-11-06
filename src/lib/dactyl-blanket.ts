// SPDX-License-Identifier: AGPL-3.0-or-later
// Skorupa „koc”: wierzch to jedna gładka powierzchnia z(x, y), która przechodzi dokładnie przez
// płytę każdego klawisza, a między klawiszami płynnie przechodzi z jednej płaszczyzny w drugą.
// Spód koca to te same płaszczyzny przesunięte o grubość komórki. Ściany schodzą pionowo do dna
// z wygładzonego obrysu wszystkich klawiszy. Zamiast łączników Dactyla (słupki + otoczki).

import { apply, insidePoly, polyDist, SCREW_BITE, settleInside, type DactylModel, type DKey } from './dactyl';

export interface BlanketParams {
  /** zasięg przenikania płaszczyzn sąsiednich klawiszy (mm): większy = łagodniejsze zbocza */
  blend: number;
  /** odstęp zewnętrznej strony ściany od klawiszy (mm) */
  margin: number;
  /** promień domknięcia obrysu (mm): wypełnia wcięcia między kciukiem a resztą */
  close: number;
  /** krok siatki powierzchni (mm) */
  grid: number;
  /** rozmycie wysokości przed budową powierzchni (mm) */
  smooth: number;
}

export const DEFAULT_BLANKET: BlanketParams = { blend: 8, margin: 4, close: 10, grid: 2, smooth: 0 };

type P2 = [number, number];
type Plane = { n: [number, number, number]; t: [number, number, number] };

/** Ślad płyty klawisza na podłodze (rzut górnego prostokąta), przeciwnie do wskazówek zegara. */
export function keyFootprint(k: DKey): P2[] {
  const q = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => apply(k.frame, [sx * k.hw, sy * k.hh, 0]));
  const pts = q.map((p) => [p[0], p[1]] as P2);
  let a = 0;
  for (let i = 0; i < 4; i++) a += pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1];
  return a < 0 ? pts.reverse() : pts;
}

/** Rzut całego bloku klawisza (płyta + komórka pod nią) na podłogę: otoczka 8 rogów. */
export function blockFootprint(k: DKey, depth: number): P2[] {
  const pts: P2[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, -depth]) {
    const p = apply(k.frame, [sx * k.hw, sy * k.hh, z]);
    pts.push([p[0], p[1]]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (ps: P2[]) => {
    const h: P2[] = [];
    for (const q of ps) {
      while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], q) <= 1e-9) h.pop();
      h.push(q);
    }
    return h.slice(0, -1);
  };
  return [...half(pts), ...half([...pts].reverse())];
}

const plane = (k: DKey, dz: number): Plane => {
  const r = k.frame.r;
  const n: [number, number, number] = [r[2], r[5], r[8]];
  const t = apply(k.frame, [0, 0, dz]);
  return { n, t };
};
const zOn = (pl: Plane, x: number, y: number) => pl.t[2] - (pl.n[0] * (x - pl.t[0]) + pl.n[1] * (y - pl.t[1])) / pl.n[2];

/**
 * Wysokość koca w (x, y): średnia płaszczyzn klawiszy z wagą 1/d² · exp(−(d/blend)²), gdzie d to
 * odległość od śladu klawisza. W śladzie d = 0, więc powierzchnia jest dokładnie płytą klawisza,
 * a przy jego brzegu łagodnie przechodzi w sąsiednie (styczna ciągła). Gdzie ślady dwóch klawiszy
 * zachodzą na siebie (np. kciuk nad środkowym palcem), wygrywa wyższy.
 * Zwraca [wierzch, spód]; spód to płaszczyzny przesunięte o −depth wzdłuż normalnej klawisza.
 */
export function blanketHeight(model: DactylModel, bp: BlanketParams, depth: number): (x: number, y: number) => [number, number] {
  const keys = model.keys.map((k) => ({ foot: keyFootprint(k), top: plane(k, 0), bot: plane(k, -depth) }));
  return (x, y) => {
    let num = 0, numB = 0, den = 0;
    let hit: (typeof keys)[number] | null = null;
    for (const k of keys) {
      if (insidePoly([x, y], k.foot)) {
        if (!hit || zOn(k.top, x, y) > zOn(hit.top, x, y)) hit = k;
        continue;
      }
      const d = polyDist([x, y], k.foot).d;
      const w = Math.exp(-((d / bp.blend) ** 2)) / (d * d);
      num += w * zOn(k.top, x, y);
      numB += w * zOn(k.bot, x, y);
      den += w;
    }
    if (hit) return [zOn(hit.top, x, y), zOn(hit.bot, x, y)];
    return [num / den, numB / den];
  };
}

/** Rozmycie Gaussa siatki nx × ny (σ w krokach siatki), brzegi powielone. */
function blur(z: Float64Array, nx: number, ny: number, sigma: number): Float64Array {
  if (sigma <= 0) return z;
  const r = Math.ceil(3 * sigma);
  const w: number[] = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sw = w.reduce((a, b) => a + b, 0);
  const tmp = new Float64Array(z.length), out = new Float64Array(z.length);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      let acc = 0;
      for (let q = -r; q <= r; q++) acc += w[q + r] * z[i * ny + Math.min(ny - 1, Math.max(0, j + q))];
      tmp[i * ny + j] = acc / sw;
    }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      let acc = 0;
      for (let q = -r; q <= r; q++) acc += w[q + r] * tmp[Math.min(nx - 1, Math.max(0, i + q)) * ny + j];
      out[i * ny + j] = acc / sw;
    }
  return out;
}

/** Dokładna odległość euklidesowa (Felzenszwalb) od komórek `on` na siatce nx × ny (w krokach). */
function edt(on: Uint8Array, nx: number, ny: number): Float64Array {
  const INF = 1e20;
  const f = new Float64Array(nx * ny);
  for (let i = 0; i < f.length; i++) f[i] = on[i] ? 0 : INF;
  const pass = (get: (i: number) => number, set: (i: number, v: number) => void, n: number) => {
    const v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float64Array(n);
    for (let i = 0; i < n; i++) g[i] = get(i);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      set(q, (q - v[k]) ** 2 + g[v[k]]);
    }
  };
  for (let i = 0; i < nx; i++) pass((j) => f[i * ny + j], (j, v) => (f[i * ny + j] = v), ny);
  for (let j = 0; j < ny; j++) pass((i) => f[i * ny + j], (i, v) => (f[i * ny + j] = v), nx);
  for (let i = 0; i < f.length; i++) f[i] = Math.sqrt(f[i]);
  return f;
}

/** Kontur poziomicy `level` pola odległości (marching squares), najdłuższa zamknięta pętla. */
function contour(sd: Float64Array, nx: number, ny: number, x0: number, y0: number, h: number, level: number): P2[] {
  const at = (i: number, j: number) => sd[i * ny + j] - level;
  // punkt na krawędzi siatki o kanonicznym id (krawędź pozioma: (i,j)-(i+1,j), pionowa: (i,j)-(i,j+1))
  const pts = new Map<string, P2>();
  const edge = (i0: number, j0: number, i1: number, j1: number): string => {
    if (i0 > i1 || j0 > j1) [i0, j0, i1, j1] = [i1, j1, i0, j0];
    const id = `${i0},${j0},${i1 - i0}`;
    if (!pts.has(id)) {
      const a = at(i0, j0), b = at(i1, j1), t = a / (a - b);
      pts.set(id, [x0 + (i0 + (i1 - i0) * t) * h, y0 + (j0 + (j1 - j0) * t) * h]);
    }
    return id;
  };
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  };
  for (let i = 0; i + 1 < nx; i++)
    for (let j = 0; j + 1 < ny; j++) {
      const c = [at(i, j) < 0, at(i + 1, j) < 0, at(i + 1, j + 1) < 0, at(i, j + 1) < 0];
      const corner = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const cut = [0, 1, 2, 3].filter((k) => c[k] !== c[(k + 1) % 4]);
      const id = (k: number) => edge(corner[k][0], corner[k][1], corner[(k + 1) % 4][0], corner[(k + 1) % 4][1]);
      if (cut.length === 2) link(id(cut[0]), id(cut[1]));
      else if (cut.length === 4) {
        // siodło: łączymy tak, by środek (c[0]) był spójny
        if (c[0]) { link(id(3), id(0)); link(id(1), id(2)); } else { link(id(0), id(1)); link(id(2), id(3)); }
      }
    }
  const seen = new Set<string>();
  const loops: P2[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: P2[] = [];
    let prev = '', cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      loop.push(pts.get(cur)!);
      const nb = (adj.get(cur) ?? []).filter((q) => q !== prev && !seen.has(q));
      prev = cur;
      cur = nb[0];
    }
    loops.push(loop);
  }
  loops.sort((a, b) => b.length - a.length);
  return loops[0];
}

/** Wygładzenie Chaikina i przerzedzenie pętli do kroku ~step mm. */
function smoothLoop(p: P2[], step: number, iters = 3): P2[] {
  let q = p;
  for (let it = 0; it < iters; it++) {
    const r: P2[] = [];
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length];
      r.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    q = r;
  }
  const out: P2[] = [q[0]];
  for (const pt of q) if (Math.hypot(pt[0] - out[out.length - 1][0], pt[1] - out[out.length - 1][1]) >= step) out.push(pt);
  if (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < step / 2) out.pop();
  let a = 0;
  for (let i = 0; i < out.length; i++) a += out[i][0] * out[(i + 1) % out.length][1] - out[(i + 1) % out.length][0] * out[i][1];
  return a < 0 ? out.reverse() : out;
}

export interface Blanket {
  params: BlanketParams;
  /** siatka wysokości wierzchu i spodu koca: x0 + i·h, y0 + j·h, z[i·ny + j] */
  x0: number;
  y0: number;
  h: number;
  nx: number;
  ny: number;
  top: Float64Array;
  bot: Float64Array;
}

/**
 * Model z kocem: obrys ścian liczony z śladów klawiszy (domknięty, odsunięty o margin, wygładzony),
 * śruby przesunięte do nowej ściany. Siatka wysokości do budowy powierzchni w OpenCascade.
 */
export function withBlanket(model: DactylModel, bp: BlanketParams = DEFAULT_BLANKET): DactylModel & { blanket: Blanket } {
  const wt = model.params.wallThickness;
  const feet = model.keys.map((k) => blockFootprint(k, model.web));
  const all = feet.flat();
  const pad = bp.margin + bp.close + 10;
  const x0 = Math.min(...all.map((p) => p[0])) - pad, y0 = Math.min(...all.map((p) => p[1])) - pad;
  const x1 = Math.max(...all.map((p) => p[0])) + pad, y1 = Math.max(...all.map((p) => p[1])) + pad;
  // obrys na rastrze 0,5 mm: ślady → domknięcie (rozszerz o close, zwęź o close) → odsunięcie o margin
  const r = 0.5;
  const nx = Math.ceil((x1 - x0) / r) + 1, ny = Math.ceil((y1 - y0) / r) + 1;
  const on = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const q: P2 = [x0 + i * r, y0 + j * r];
      if (feet.some((f) => insidePoly(q, f))) on[i * ny + j] = 1;
    }
  const dOut = edt(on, nx, ny);
  const grown = new Uint8Array(nx * ny);
  for (let i = 0; i < grown.length; i++) grown[i] = dOut[i] * r <= bp.close ? 1 : 0;
  // dziury w środku (np. między kciukiem a kolumnami) wypełniamy: zostaje tylko to, co sięga brzegu
  const outside = new Uint8Array(nx * ny);
  const stack: number[] = [0];
  outside[0] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const i = Math.floor(c / ny), j = c % ny;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = a * ny + b;
      if (!outside[n] && !grown[n]) { outside[n] = 1; stack.push(n); }
    }
  }
  const dIn = edt(outside, nx, ny); // odległość od zewnętrza rozrośniętego obszaru
  // closed = rozrośnięty obszar zwężony o close; sd = odległość od niego (ujemna w środku)
  const closedOn = new Uint8Array(nx * ny);
  for (let i = 0; i < closedOn.length; i++) closedOn[i] = dIn[i] * r > bp.close ? 1 : 0;
  for (let i = 0; i < closedOn.length; i++) if (on[i]) closedOn[i] = 1;
  const dC = edt(closedOn, nx, ny);
  const notC = new Uint8Array(nx * ny);
  for (let i = 0; i < notC.length; i++) notC[i] = closedOn[i] ? 0 : 1;
  const dC2 = edt(notC, nx, ny);
  const sd = new Float64Array(nx * ny);
  for (let i = 0; i < sd.length; i++) sd[i] = (dC[i] - dC2[i]) * r;
  const outer = smoothLoop(contour(sd, nx, ny, x0, y0, r, bp.margin), 3);
  const inner = smoothLoop(contour(sd, nx, ny, x0, y0, r, bp.margin - wt), 3);

  // siatka wysokości koca nad całym obrysem (z zapasem, żeby powierzchnia wychodziła poza ściany)
  const h = bp.grid;
  const ox = Math.min(...outer.map((p) => p[0])) - 6, oy = Math.min(...outer.map((p) => p[1])) - 6;
  const gx = Math.ceil((Math.max(...outer.map((p) => p[0])) + 6 - ox) / h) + 1;
  const gy = Math.ceil((Math.max(...outer.map((p) => p[1])) + 6 - oy) / h) + 1;
  // wysokości liczone gęsto (1 mm) i rozmyte (σ = smooth): skok tam, gdzie ślady klawiszy zachodzą
  // na siebie, robi się stromym zboczem, a powierzchnia B-spline nie faluje; potem próbki co h
  const f = blanketHeight(model, bp, model.web);
  const fs = 1, k = Math.round(h / fs);
  const fx = (gx - 1) * k + 1, fy = (gy - 1) * k + 1;
  const tf = new Float64Array(fx * fy), bf = new Float64Array(fx * fy);
  for (let i = 0; i < fx; i++)
    for (let j = 0; j < fy; j++) {
      const [zt, zb] = f(ox + i * fs, oy + j * fs);
      tf[i * fy + j] = zt;
      bf[i * fy + j] = zb;
    }
  const ts = blur(tf, fx, fy, bp.smooth / fs), bs = blur(bf, fx, fy, bp.smooth / fs);
  const top = new Float64Array(gx * gy), bot = new Float64Array(gx * gy);
  for (let i = 0; i < gx; i++)
    for (let j = 0; j < gy; j++) {
      top[i * gy + j] = ts[i * k * fy + j * k];
      bot[i * gy + j] = bs[i * k * fy + j * k];
    }
  const screws = model.screws.map((s) => settleInside(s, inner, model.screw.boss / 2 - SCREW_BITE));
  return {
    ...model,
    outline: { outer, inner },
    screws,
    blanket: { params: bp, x0: ox, y0: oy, h, nx: gx, ny: gy, top, bot },
  };
}
