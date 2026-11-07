// SPDX-License-Identifier: AGPL-3.0-or-later
// Skorupa Dactyla „organiczna”: bloki klawiszy łączone morfologią na wokselach (Manifold levelSet).
// Wklęsłe naroża dostają materiał (domknięcie), wypukłe krawędzie są zaokrąglane (otwarcie),
// ściany schodzą pionowo z jednego wygładzonego obrysu (ten sam obrys ma dno). Płyta pod MX,
// komórka i miejsce na przełącznik z nakładką są dokładne (wycinane po wygładzeniu).
// Opcjonalnie wzór Woronoja na ściankach: płaskorzeźba (rowki) albo ażur (otwory), z górą
// każdego oczka zwężoną najwyżej pod 45°, żeby drukował się bez podpór.

import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import { apply, insidePoly, type DactylModel, type DKey, type V3 } from './dactyl';
import type { OrganicParams } from './dactyl-blanket';
import { cellSideOpenings, cellTopOpening, KEY_CLEAR, type DactylBuild } from './dactyl-geometry';
import { box, fromShape, mat4 } from './dactyl-mesh';
import type { Cell } from './geometry';

export { DEFAULT_ORGANIC, ORGANIC_OUTLINE, type OrganicParams, type OrganicPattern } from './dactyl-blanket';

/** krok wokseli (mm) */
export const ORGANIC_VOXEL = 0.6;
/** rozmycie pola odległości (woksele): usuwa schodki wokseli */
const SMOOTH = 2.5;
/** odstęp wzoru od klawiszy, od dna i od tulei/kontrolera (mm) */
const PATTERN_KEEP = { keys: 1.5, floor: 4, parts: 2.5 };
/** oczka mniejsze niż tyle mm² pomijamy (za drobne do druku dyszą 0,4) */
const PATTERN_MIN_AREA = 20;
/** wydłużenie oczek w pionie (mniej materiału do domknięcia u góry pod kątem 45°) */
const PATTERN_STRETCH = 1.2;

type Grid = { nx: number; ny: number; nz: number; x0: number; y0: number; z0: number; h: number };
const idx = (g: Grid, i: number, j: number, k: number) => (i * g.ny + j) * g.nz + k;

/** Odległość euklidesowa (Felzenszwalb) w wokselach do najbliższego `on`, dla siatki nx × ny × nz. */
export function edt3(on: Uint8Array, nx: number, ny: number, nz: number): Float32Array {
  const INF = 1e20, N = nx * ny * nz;
  const f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = on[i] ? 0 : INF;
  const n = Math.max(nx, ny, nz);
  const v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float64Array(n), out = new Float64Array(n);
  const pass = (len: number, base: number, stride: number) => {
    for (let i = 0; i < len; i++) g[i] = f[base + i * stride];
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      if (g[q] >= INF && g[v[k]] >= INF) continue;
      let s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) ** 2 + g[v[k]]; }
    for (let i = 0; i < len; i++) f[base + i * stride] = Math.min(out[i], INF);
  };
  if (nz > 1) for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) pass(nz, (i * ny + j) * nz, 1);
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) pass(ny, i * ny * nz + k, nz);
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) pass(nx, j * nz + k, ny * nz);
  for (let i = 0; i < N; i++) f[i] = Math.sqrt(f[i]);
  return f;
}

/** Rozmycie Gaussa 3D (σ w wokselach). */
export function blur3(f: Float32Array, nx: number, ny: number, nz: number, sig: number): Float32Array {
  if (sig <= 0) return f;
  const r = Math.ceil(2.5 * sig), w: number[] = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * sig * sig)));
  const sw = w.reduce((a, b) => a + b, 0);
  let a = f, b = new Float32Array(f.length);
  const run = (len: number, base: number, stride: number) => {
    for (let q = 0; q < len; q++) {
      let acc = 0;
      for (let t = -r; t <= r; t++) acc += w[t + r] * a[base + Math.min(len - 1, Math.max(0, q + t)) * stride];
      b[base + q * stride] = acc / sw;
    }
  };
  if (nz > 1) { for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) run(nz, (i * ny + j) * nz, 1); [a, b] = [b, a]; }
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) run(ny, i * ny * nz + k, nz);
  [a, b] = [b, a];
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) run(nx, j * nz + k, ny * nz);
  return b;
}

/** Bryła na siatce wokseli: przekroje co krok, wypełnianie wierszy parzysto-nieparzyste. */
function voxelize(g: Grid, sol: Manifold): Uint8Array {
  const occ = new Uint8Array(g.nx * g.ny * g.nz);
  for (let k = 0; k < g.nz; k++) {
    const polys = sol.slice(g.z0 + k * g.h).toPolygons();
    if (!polys.length) continue;
    for (let j = 0; j < g.ny; j++) {
      const y = g.y0 + j * g.h;
      const xs: number[] = [];
      for (const p of polys)
        for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
          const [xa, ya] = p[a], [xb, yb] = p[b];
          if (ya > y !== yb > y) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
        }
      xs.sort((a, b) => a - b);
      for (let t = 0; t + 1 < xs.length; t += 2) {
        const i0 = Math.max(0, Math.ceil((xs[t] - g.x0) / g.h)), i1 = Math.min(g.nx - 1, Math.floor((xs[t + 1] - g.x0) / g.h));
        for (let i = i0; i <= i1; i++) occ[idx(g, i, j, k)] = 1;
      }
    }
  }
  return occ;
}

/** Wartość pola w punkcie (interpolacja trójliniowa); poza siatką `fill`. */
function sample(g: Grid, f: Float32Array, p: Vec3, fill: number): number {
  const fx = (p[0] - g.x0) / g.h, fy = (p[1] - g.y0) / g.h, fz = (p[2] - g.z0) / g.h;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  if (i < 0 || j < 0 || k < 0 || i >= g.nx - 1 || j >= g.ny - 1 || k >= g.nz - 1) return fill;
  const u = fx - i, v = fy - j, w = fz - k;
  let s = 0;
  for (let a = 0; a < 2; a++)
    for (let b = 0; b < 2; b++)
      for (let c = 0; c < 2; c++) s += (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w) * f[idx(g, i + a, j + b, k + c)];
  return s;
}

const blockPts = (k: DKey, web: number): V3[] => {
  const p: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, -web]) p.push(apply(k.frame, [sx * k.hw, sy * k.hh, z]));
  return p;
};

/** Pole „czy w obrysie” na siatce 2D (nx × ny). */
function rasterLoop(g: Grid, loop: [number, number][]): Uint8Array {
  const m = new Uint8Array(g.nx * g.ny);
  for (let i = 0; i < g.nx; i++) for (let j = 0; j < g.ny; j++) if (insidePoly([g.x0 + i * g.h, g.y0 + j * g.h], loop)) m[i * g.ny + j] = 1;
  return m;
}

/** Pętla obrysu jako funkcja długości łuku: punkt i normalna do środka (wygładzona). */
function wallPath(loop: [number, number][]) {
  const n = loop.length, acc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) acc[i + 1] = acc[i] + Math.hypot(loop[(i + 1) % n][0] - loop[i][0], loop[(i + 1) % n][1] - loop[i][1]);
  const len = acc[n];
  // pętla przeciwnie do wskazówek zegara: środek po lewej stronie kierunku
  const segN = loop.map((p, i) => {
    const q = loop[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l] as [number, number];
  });
  const vN = loop.map((_, i) => {
    const a = segN[(i + n - 1) % n], b = segN[i], x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1;
    return [x / l, y / l] as [number, number];
  });
  const at = (s: number): { p: [number, number]; n: [number, number] } => {
    s = ((s % len) + len) % len;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (acc[m] <= s) lo = m; else hi = m - 1; }
    const i = lo, j = (i + 1) % n, t = (s - acc[i]) / Math.max(1e-9, acc[i + 1] - acc[i]);
    const nx = vN[i][0] * (1 - t) + vN[j][0] * t, ny = vN[i][1] * (1 - t) + vN[j][1] * t, nl = Math.hypot(nx, ny) || 1;
    return { p: [loop[i][0] + (loop[j][0] - loop[i][0]) * t, loop[i][1] + (loop[j][1] - loop[i][1]) * t], n: [nx / nl, ny / nl] };
  };
  return { len, at };
}

/** krok rastra wzoru na rozwiniętej ścianie (mm) */
export const PAT_RES = 0.2;

/**
 * Wzór Woronoja na rozwiniętej ścianie (s wzdłuż obrysu, z w górę), jako przekrój 2D.
 * Dozwolony pas: od PATTERN_KEEP.floor do zLim(s) (koniec pionowej ściany albo bliskość klawiszy,
 * tulei, kontrolera). Oczka (wnętrza komórek bez żeberek) przycięte do pasa, potem od góry w dół
 * warstwa po warstwie: woksel zostaje, gdy jest w zasięgu jednego kroku od oczka warstwę wyżej
 * (ściana pod 45°), a każdy nowy fragment zaczyna się od jednego punktu (wierzchołek łuku).
 * Tak każda górna krawędź otworu ma nachylenie co najmniej 45° i drukuje się bez podpór.
 */
export function patternSection(len: number, zLim: Float32Array, zMax: number, op: OrganicParams): { rows: [number, number, number][]; ns: number } {
  const r = PAT_RES, ns = Math.round(len / r), nz = Math.ceil(zMax / r) + 2;
  const SP = op.patternCell, SZ = SP * PATTERN_STRETCH, half = op.patternRib / 2, sq = 1 / PATTERN_STRETCH;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const na = Math.max(3, Math.round(len / SP)), sp = len / na, nb = Math.ceil(zMax / SZ) + 2;
  const seeds: [number, number][] = [];
  for (let a = 0; a < na; a++) for (let b = 0; b < nb; b++) seeds.push([(a + 0.15 + 0.7 * rnd()) * sp, -SZ + (b + 0.15 + 0.7 * rnd()) * SZ]);
  const per = (d: number) => d - len * Math.round(d / len);
  // R: oczka w pasie
  const R = new Uint8Array(ns * nz);
  for (let i = 0; i < ns; i++) {
    const s = i * r, a0 = Math.floor(s / sp), lim = zLim[i] - half;
    for (let k = 0; k < nz; k++) {
      const z = k * r;
      if (z < PATTERN_KEEP.floor + half || z > lim) continue;
      const b0 = Math.floor((z + SZ) / SZ);
      let d1 = 1e9, d2 = 1e9;
      for (let a = a0 - 1; a <= a0 + 1; a++)
        for (let b = b0 - 1; b <= b0 + 1; b++) {
          if (b < 0 || b >= nb) continue;
          const q = seeds[(((a % na) + na) % na) * nb + b];
          const d = Math.hypot(per(s - q[0]), (z - q[1]) * sq);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
      if ((d2 - d1) / 2 > half) R[i * nz + k] = 1;
    }
  }
  // od góry w dół: łuki 45°
  const S = new Uint8Array(ns * nz);
  for (let k = nz - 2; k >= 0; k--) {
    let i = 0;
    while (i < ns) {
      if (!R[i * nz + k]) { i++; continue; }
      let e = i;
      while (e + 1 < ns && R[(e + 1) * nz + k]) e++;
      let touched = false;
      for (let q = i; q <= e; q++) {
        const up = S[q * nz + k + 1] || S[((q + 1) % ns) * nz + k + 1] || S[((q - 1 + ns) % ns) * nz + k + 1];
        if (up) { S[q * nz + k] = 1; touched = true; }
      }
      if (!touched) S[((i + e) >> 1) * nz + k] = 1; // nowy wierzchołek łuku
      i = e + 1;
    }
  }
  // spójne kawałki (8-sąsiedztwo, jak podparcie pod 45°); za małe pomijamy
  const lab = new Int32Array(ns * nz).fill(-1), sizes: number[] = [];
  for (let c = 0; c < ns * nz; c++) {
    if (!S[c] || lab[c] >= 0) continue;
    const id = sizes.length, st = [c];
    lab[c] = id;
    let n = 0;
    while (st.length) {
      const v = st.pop()!;
      n++;
      const i = Math.floor(v / nz), k = v % nz;
      for (const di of [-1, 0, 1])
        for (const dk of [-1, 0, 1]) {
          if ((!di && !dk) || k + dk < 0 || k + dk >= nz) continue;
          const w = ((i + di + ns) % ns) * nz + k + dk;
          if (S[w] && lab[w] < 0) { lab[w] = id; st.push(w); }
        }
    }
    sizes.push(n);
  }
  const minPx = PATTERN_MIN_AREA / (r * r);
  // wiersze (s0, s1, z) pikseli kawałków dość dużych; szew pętli przesuwamy na kolumnę bez oczek
  let shift = 0;
  for (let i = 0; i < ns; i++) {
    let any = false;
    for (let k = 0; k < nz && !any; k++) if (S[i * nz + k] && sizes[lab[i * nz + k]] >= minPx) any = true;
    if (!any) { shift = i; break; }
  }
  const rows: [number, number, number][] = [];
  for (let k = 0; k < nz; k++) {
    let st = -1;
    for (let u = 0; u <= ns; u++) {
      const i = (u + shift) % ns, c = i * nz + k;
      const on = u < ns && S[c] && sizes[lab[c]] >= minPx;
      if (on && st < 0) st = u;
      if (!on && st >= 0) { rows.push([(st + shift) * r, (u + shift) * r, k * r]); st = -1; }
    }
  }
  return { rows, ns };
}

/**
 * Skorupa organiczna jako siatka. `model` musi mieć obrys (withBlanket): wyznacza pionowe ściany
 * i dno, a śruby są już przesunięte do środka ściany.
 */
export function organicShellMesh(M: ManifoldToplevel, model: DactylModel, op: OrganicParams, cell: Cell, b: DactylBuild): Manifold {
  const { outer: outerLoop, inner: innerLoop } = model.outline!;
  const H = ORGANIC_VOXEL, RC = op.fill, RO = op.round, WALL = model.params.wallThickness;
  const web = model.web;
  // bryła wyjściowa: bloki klawiszy z pionem do podłogi i materiał za bocznymi kanałami gniazd
  const parts0: Manifold[] = model.keys.map((k) => {
    const p = blockPts(k, web);
    return M.Manifold.hull([...p, ...p.map((q) => [q[0], q[1], -5] as V3)]);
  });
  const open = cellSideOpenings(cell);
  const covers: Manifold[] = [];
  for (const k of model.keys)
    for (const o of open) {
      const ax = o.x1 - o.x0 < o.y1 - o.y0 ? 0 : 1, sg = ax === 0 ? Math.sign(o.x0 + o.x1) : Math.sign(o.y0 + o.y1);
      const s = ax === 0 ? k.hw : k.hh, a = sg > 0 ? s - 1 : -s - 2.5, e = sg > 0 ? s + 2.5 : -s + 1;
      const zz = { z0: o.z0 - 0.5, z1: Math.min(-2.5, o.z1 + 1.5), m: k.frame };
      covers.push(box(M, ax === 0 ? { x0: a, x1: e, y0: o.y0 - 1.5, y1: o.y1 + 1.5, ...zz } : { y0: a, y1: e, x0: o.x0 - 1.5, x1: o.x1 + 1.5, ...zz }));
    }
  const solid = M.Manifold.union([...parts0, ...covers]);
  const bb = solid.boundingBox();
  const xs = outerLoop.map((p) => p[0]), ys = outerLoop.map((p) => p[1]);
  const pad = 4;
  const x0 = Math.min(bb.min[0], ...xs) - pad, y0 = Math.min(bb.min[1], ...ys) - pad, z0 = -6;
  const g: Grid = {
    x0, y0, z0, h: H,
    nx: Math.ceil((Math.max(bb.max[0], ...xs) + pad - x0) / H) + 1,
    ny: Math.ceil((Math.max(bb.max[1], ...ys) + pad - y0) / H) + 1,
    nz: Math.ceil((bb.max[2] + RC + pad - z0) / H) + 1,
  };
  const { nx, ny, nz } = g, N = nx * ny * nz, N2 = nx * ny;
  const occ = voxelize(g, solid);
  solid.delete();

  // jednolity obrys: wszystko w obrysie wypełnione do gładkiej wysokości (Laplace między klawiszami)
  const outl = rasterLoop(g, outerLoop);
  const ht = new Float32Array(N2).fill(-1), cov = new Uint8Array(N2);
  for (let c = 0; c < N2; c++) {
    const base = c * nz;
    for (let k = nz - 1; k >= 0; k--) if (occ[base + k]) { ht[c] = k; cov[c] = 1; break; }
    if (cov[c]) outl[c] = 1;
  }
  let hA = new Float32Array(N2), hB: Float32Array;
  let m0 = 0, c0 = 0;
  for (let c = 0; c < N2; c++) if (cov[c]) { m0 += ht[c]; c0++; }
  for (let c = 0; c < N2; c++) hA[c] = cov[c] ? ht[c] : m0 / Math.max(1, c0);
  hB = new Float32Array(hA);
  for (let it = 0; it < 3000; it++) {
    for (let i = 1; i < nx - 1; i++)
      for (let j = 1; j < ny - 1; j++) {
        const q = i * ny + j;
        if (cov[q] || !outl[q]) continue;
        let s = 0, c = 0;
        if (outl[q - ny]) { s += hA[q - ny]; c++; }
        if (outl[q + ny]) { s += hA[q + ny]; c++; }
        if (outl[q - 1]) { s += hA[q - 1]; c++; }
        if (outl[q + 1]) { s += hA[q + 1]; c++; }
        hB[q] = c ? s / c : hA[q];
      }
    [hA, hB] = [hB, hA];
  }
  for (let c = 0; c < N2; c++) {
    if (!outl[c]) continue;
    const top = Math.min(nz - 1, Math.floor(cov[c] ? ht[c] : hA[c]));
    for (let k = 0; k <= top; k++) occ[c * nz + k] = 1;
  }

  const thr = (d: Float32Array, r: number, inside: boolean) => {
    const o = new Uint8Array(N);
    for (let i = 0; i < N; i++) o[i] = (inside ? d[i] > r : d[i] <= r) ? 1 : 0;
    return o;
  };
  const inv = (a: Uint8Array) => {
    const o = new Uint8Array(N);
    for (let i = 0; i < N; i++) o[i] = a[i] ? 0 : 1;
    return o;
  };
  // domknięcie: rozdmuchanie i zwężenie o RC
  const dil = thr(edt3(occ, nx, ny, nz), RC / H, false);
  const clo = thr(edt3(inv(dil), nx, ny, nz), RC / H, true);
  for (let i = 0; i < N; i++) if (occ[i]) clo[i] = 1;
  // miejsce na przełącznik i nakładkę przed zaokrąglaniem: brzegi kieszeni też się zaokrąglą
  const clrM = M.Manifold.union(model.keys.map((k) => box(M, { x0: -k.hw, x1: k.hw, y0: -k.hh, y1: k.hh, z0: -0.6, z1: KEY_CLEAR.height + 10, m: k.frame })));
  const clr = voxelize(g, clrM);
  clrM.delete();
  for (let i = 0; i < N; i++) if (clr[i]) clo[i] = 0;
  // otwarcie: zwężenie o RO, potem pole odległości od zwężonego (rozmyte) → zewnętrzna powierzchnia
  const ero = thr(edt3(inv(clo), nx, ny, nz), RO / H, true);
  const dist = blur3(edt3(ero, nx, ny, nz), nx, ny, nz, SMOOTH);
  const dIn = edt3(inv(clo), nx, ny, nz);
  const bounds = { min: [x0 + H, y0 + H, z0 + H] as Vec3, max: [x0 + (nx - 2) * H, y0 + (ny - 2) * H, z0 + (nz - 2) * H] as Vec3 };
  const zmax = bounds.max[2] + 5;
  const outerPrism = M.Manifold.extrude(new M.CrossSection([outerLoop], 'Positive'), zmax + 6).translate([0, 0, -6]);
  const innerPrism = M.Manifold.extrude(new M.CrossSection([innerLoop], 'Positive'), zmax + 8).translate([0, 0, -7]);
  const outer = M.Manifold.levelSet((p) => RO / H - sample(g, dist, p, 1e3), bounds, H).intersect(outerPrism);
  const inner = M.Manifold.levelSet((p) => sample(g, dIn, p, 0) - WALL / H, bounds, H).intersect(innerPrism);
  const blocks = M.Manifold.union(model.keys.map((k) => M.Manifold.hull(blockPts(k, web))));
  // dokładny rdzeń klawisza: pierścień płyty pod kołnierzem MX zawsze, reszta w obrębie bryły
  const ringTop = M.Manifold.union(model.keys.map((k) => box(M, { x0: -8.3, x1: 8.3, y0: -8.3, y1: 8.3, z0: -2, z1: 0, m: k.frame })));
  const coreAll = M.Manifold.union(model.keys.map((k) => box(M, { x0: -k.hw + 0.6, x1: k.hw - 0.6, y0: -k.hh + 0.6, y1: k.hh - 0.6, z0: -web, z1: 0, m: k.frame })));
  const core = ringTop.add(coreAll.intersect(outer));
  const extra: Manifold[] = [];
  for (const [x, y] of model.screws) extra.push(M.Manifold.cylinder(b.bossHeight, model.screw.boss / 2, model.screw.boss / 2, 48).translate([x, y, 0]));
  if (b.controller) for (const a of b.controller.shellAdd) extra.push(box(M, a));
  const floorCut = M.Manifold.cube([1e4, 1e4, 1e4]).translate([-5e3, -5e3, 0]);
  let body = M.Manifold.union([outer.subtract(inner.subtract(blocks)), core, ...extra]).intersect(floorCut);

  if (op.pattern !== 'none') {
    const path = wallPath(outerLoop);
    const depth = op.pattern === 'holes' ? WALL + 1 : op.patternDepth;
    // strefa: z dala od klawiszy, tulei śrub i kontrolera
    const grow = PATTERN_KEEP.parts;
    const keep = M.Manifold.union([
      ...model.keys.map((k) => M.Manifold.hull(blockPts(k, web))),
      ...covers,
      ...model.screws.map(([x, y]) => M.Manifold.cylinder(b.bossHeight + 4, model.screw.boss / 2 + grow, model.screw.boss / 2 + grow, 32).translate([x, y, -1])),
      ...(b.controller ? [...b.controller.shellAdd, ...b.controller.shellCut].map((a) => box(M, { ...a, x0: a.x0 - grow, x1: a.x1 + grow, y0: a.y0 - grow, y1: a.y1 + grow, z0: a.z0 - grow, z1: a.z1 + grow })) : []),
    ]);
    const kv = voxelize(g, keep);
    keep.delete();
    const dK = edt3(kv, nx, ny, nz);
    // zLim(s): najwyżej, dokąd ściana jest pionowa i wolna na całej głębokości wzoru
    const ns = Math.round(path.len / PAT_RES);
    const zLim = new Float32Array(ns);
    let zMax = 0;
    for (let i = 0; i < ns; i++) {
      const w = path.at(i * PAT_RES);
      let z = PATTERN_KEEP.floor;
      for (; z < bounds.max[2]; z += 0.3) {
        let ok = true;
        // zewnętrzna powierzchnia nadal na obrysie: tuż pod nią materiał (koniec ściany = zaokrąglenie)
        for (const t of [0.3, depth / 2, depth]) {
          const q: Vec3 = [w.p[0] + w.n[0] * t, w.p[1] + w.n[1] * t, z];
          if (sample(g, dK, q, 0) * H < PATTERN_KEEP.keys) { ok = false; break; }
        }
        const qo: Vec3 = [w.p[0] + w.n[0] * 0.3, w.p[1] + w.n[1] * 0.3, z + RO];
        if (sample(g, dist, qo, 1e3) > RO / H) ok = false;
        if (!ok) break;
      }
      zLim[i] = z - 0.3;
      zMax = Math.max(zMax, zLim[i]);
    }
    const { rows } = patternSection(path.len, zLim, zMax, op);
    if (rows.length) {
      const rects = rows.map(([s0, s1, z]) => [[s0, z], [s1, z], [s1, z + PAT_RES], [s0, z + PAT_RES]] as [number, number][]);
      // schodki 0,2 mm wygładzone (domknięcie i otwarcie o pół piksela), potem uproszczone
      const cs = new M.CrossSection(rects, 'Positive').offset(0.15, 'Round').offset(-0.3, 'Round').offset(0.15, 'Round').simplify(0.03);
      // (s, z, −t): lustro, bo (styczna, pion, normal do środka) to układ lewoskrętny
      let cut = M.Manifold.extrude(cs, depth + 1).translate([0, 0, -1]).scale([1, 1, -1]).refineToLength(1);
      cut = cut.warp((v) => {
        const w = path.at(v[0]);
        const t = -v[2], z = v[1];
        v[0] = w.p[0] + w.n[0] * t;
        v[1] = w.p[1] + w.n[1] * t;
        v[2] = z;
      });
      body = body.subtract(cut);
    }
  }

  let neg = negCache.get(cell);
  if (!neg) negCache.set(cell, (neg = fromShape(M, cell.negative)));
  const hole = cellTopOpening(cell);
  const tools: Manifold[] = [];
  for (const k of model.keys) {
    tools.push(neg.transform(mat4(k.frame)), box(M, { ...hole, m: k.frame }));
    const i = KEY_CLEAR.inset;
    tools.push(box(M, { x0: -k.hw + i, x1: k.hw - i, y0: -k.hh + i, y1: k.hh - i, z0: 0, z1: KEY_CLEAR.height, m: k.frame }));
  }
  for (const [x, y] of model.screws)
    tools.push(M.Manifold.cylinder(b.bossHeight - 1 + 0.5, model.screw.pilot / 2, model.screw.pilot / 2, 32).translate([x, y, -0.5]));
  if (b.controller) for (const c of b.controller.shellCut) tools.push(box(M, c));
  const out = body.subtract(M.Manifold.union(tools));
  const parts = out.decompose();
  parts.sort((a, c) => c.volume() - a.volume());
  return parts[0];
}

const negCache = new WeakMap<Cell, Manifold>();
