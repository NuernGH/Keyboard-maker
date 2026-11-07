// SPDX-License-Identifier: AGPL-3.0-or-later
// Skorupa Dactyla „koc” liczona siatką trójkątów w Manifold (zamiast OpenCascade, w którym
// odejmowanie komórek od gładkiej powierzchni nie działało). Wynik: zamknięta siatka (podgląd, STL).

import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import type { Shape3D } from 'replicad';
import { apply, type DactylModel, type DKey, type Mat, type V3 } from './dactyl';
import { blanketHeight, type BlanketParams } from './dactyl-blanket';
import { cellSideOpenings, cellTopOpening, KEY_CLEAR, SLOT_COVER, type BoxSpec, type DactylBuild } from './dactyl-geometry';
import type { Cell } from './geometry';

/** Siatka trójkątów: wierzchołki xyz i indeksy trójkątów (przeciwnie do wskazówek zegara od zewnątrz). */
export interface TriMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
}

let lib: Promise<ManifoldToplevel> | null = null;
/** Moduł Manifold (WASM), ładowany raz. `wasmUrl` podaje plik .wasm w przeglądarce. */
export function manifoldLib(wasmUrl?: string): Promise<ManifoldToplevel> {
  if (!lib)
    lib = (Module as unknown as (o: object) => Promise<ManifoldToplevel>)(wasmUrl ? { locateFile: () => wasmUrl } : {}).then((m) => {
      m.setup();
      return m;
    });
  return lib;
}

/** Macierz układu klawisza w kolejności kolumnowej (Manifold). */
export function mat4(m: Mat): Mat4 {
  const r = m.r, t = m.t;
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1];
}

/** Bryła OpenCascade jako Manifold (siatka z OC, wierzchołki na wspólnych krawędziach scalone). */
export function fromShape(M: ManifoldToplevel, s: Shape3D, tolerance = 0.01): Manifold {
  const m = s.mesh({ tolerance, angularTolerance: 0.1 });
  const mesh = new M.Mesh({ numProp: 3, vertProperties: new Float32Array(m.vertices), triVerts: new Uint32Array(m.triangles) });
  mesh.merge();
  const out = new M.Manifold(mesh);
  if (out.status() !== 'NoError') throw new Error('Siatka komórki nie jest zamkniętą bryłą: ' + out.status());
  return out;
}

const negCache = new WeakMap<Cell, Manifold>();

/** Prostopadłościan (opcjonalnie w układzie klawisza) jako Manifold. */
export function box(M: ManifoldToplevel, b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; m?: Mat }): Manifold {
  const c = M.Manifold.cube([b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0]).translate([b.x0, b.y0, b.z0]);
  return b.m ? c.transform(mat4(b.m)) : c;
}

/** krok siatki powierzchni koca (mm) */
export const BLANKET_STEP = 0.6;
/** obniżenie koca pod płytami: płytę daje dokładny blok klawisza, nie próbki powierzchni (mm) */
const UNDER_PLATE = 0.02;

/**
 * Płat pod powierzchnią z = f(x, y) nad prostokątem: regularna siatka wierzchołków co BLANKET_STEP
 * na wierzchu (na powierzchni) i na spodzie (z = zLow), boki zszyte paskami.
 */
function heightSlab(M: ManifoldToplevel, rect: [number, number, number, number], f: (x: number, y: number) => number, zLow: number): Manifold {
  const [x0, y0, x1, y1] = rect;
  const nx = Math.ceil((x1 - x0) / BLANKET_STEP) + 1, ny = Math.ceil((y1 - y0) / BLANKET_STEP) + 1;
  const hx = (x1 - x0) / (nx - 1), hy = (y1 - y0) / (ny - 1);
  const N = nx * ny;
  const v = new Float32Array(2 * N * 3);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const x = x0 + i * hx, y = y0 + j * hy, k = i * ny + j;
      v.set([x, y, f(x, y)], 3 * k);
      v.set([x, y, zLow], 3 * (N + k));
    }
  const t: number[] = [];
  const T = (i: number, j: number) => i * ny + j, B = (i: number, j: number) => N + i * ny + j;
  for (let i = 0; i + 1 < nx; i++)
    for (let j = 0; j + 1 < ny; j++) {
      t.push(T(i, j), T(i + 1, j), T(i + 1, j + 1), T(i, j), T(i + 1, j + 1), T(i, j + 1));
      t.push(B(i, j), B(i + 1, j + 1), B(i + 1, j), B(i, j), B(i, j + 1), B(i + 1, j + 1));
    }
  // boki: obwód przeciwnie do wskazówek zegara (patrząc z góry), ściany na zewnątrz
  const ring: [number, number][] = [];
  for (let i = 0; i < nx - 1; i++) ring.push([i, 0]);
  for (let j = 0; j < ny - 1; j++) ring.push([nx - 1, j]);
  for (let i = nx - 1; i > 0; i--) ring.push([i, ny - 1]);
  for (let j = ny - 1; j > 0; j--) ring.push([0, j]);
  for (let r = 0; r < ring.length; r++) {
    const [ai, aj] = ring[r], [bi, bj] = ring[(r + 1) % ring.length];
    t.push(B(ai, aj), B(bi, bj), T(bi, bj), B(ai, aj), T(bi, bj), T(ai, aj));
  }
  const out = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: v, triVerts: new Uint32Array(t) }));
  if (out.status() !== 'NoError') throw new Error('Siatka koca nie jest zamkniętą bryłą: ' + out.status());
  return out;
}

/** Pętla przesunięta do środka o d (wzdłuż normalnych w wierzchołkach), pętla przeciwnie do wskazówek zegara. */
function insetLoop(p: [number, number][], d: number): [number, number][] {
  return p.map((q, i) => {
    const a = p[(i + p.length - 1) % p.length], b = p[(i + 1) % p.length];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [q[0] - (d * ty) / l, q[1] + (d * tx) / l];
  });
}

/** Pętla z punktami co najwyżej co `step` mm. */
function densify(p: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Który bok komórki (0: +X, 1: −X, 2: +Y, 3: −Y) ma kanał z cellSideOpenings. */
function sideOf(o: BoxSpec): number {
  const ax = o.x1 - o.x0 < o.y1 - o.y0 ? 0 : 1;
  const sg = ax === 0 ? o.x0 + o.x1 : o.y0 + o.y1;
  return ax * 2 + (sg > 0 ? 0 : 1);
}

/** Blok klawisza: płyta + komórka pod nią (ślad 1U/1,5U), w układzie świata. */
function keyBlock(k: DKey, depth: number): V3[] {
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, -depth]) pts.push(apply(k.frame, [sx * k.hw, sy * k.hh, z]));
  return pts;
}

/** szerokość pasa pod bokiem bloku klawisza (mm) */
const SKIRT = 1.5;

/** Bok bloku klawisza: oś prostopadła (0 = X), znak, odległość boku od środka i połowa długości. */
type Side = { ax: 0 | 1; sg: 1 | -1; s: number; L: number; slot: boolean };

/**
 * Boki bloku klawisza. Fartuch dostaje bok z kanałem gniazda tylko wtedy, gdy kanał wychodzi nad
 * koc (koc tuż za bokiem jest niżej niż góra kanału + 1 mm); w środku koca kanał i tak jest zakryty.
 */
function keySides(k: DKey, slots: Map<number, BoxSpec>, top: (x: number, y: number) => number): Side[] {
  return ([[0, 1], [0, -1], [1, 1], [1, -1]] as const).map(([ax, sg], i) => {
    const d: Side = { ax, sg, s: ax === 0 ? k.hw : k.hh, L: ax === 0 ? k.hh : k.hw, slot: false };
    const o = slots.get(i);
    if (o) {
      const [l0, l1] = ax === 0 ? [o.y0, o.y1] : [o.x0, o.x1];
      for (let t = 0; t <= 4 && !d.slot; t++) {
        const l = l0 + ((l1 - l0) * t) / 4;
        const e = sidePt(k, d, d.s, l, o.z1 + 1), q = sidePt(k, d, d.s + 0.6, l, 0);
        if (top(q[0], q[1]) < e[2]) d.slot = true;
      }
    }
    return d;
  });
}

/** Punkt w układzie klawisza: n wzdłuż normalnej boku, l wzdłuż boku. */
const sidePt = (k: DKey, d: Side, n: number, l: number, z: number): V3 => apply(k.frame, d.ax === 0 ? [d.sg * n, l, z] : [l, d.sg * n, z]);
const down = (p: V3): V3 => [p[0], p[1], -1];

/**
 * Pod bokiem bloku: pionowy pas (SKIRT mm do środka) od wierzchu bloku w dół, a na boku z kanałem
 * gniazda hot-swap fartuch jak w zwykłej skorupie (pochyły, SLOT_COVER mm na zewnątrz przy spodzie
 * komórki) i dalej pionowo w dół. Dół przycina potem koc, więc przy uskoku nie zostaje szczelina.
 */
function sideSkirt(k: DKey, d: Side, depth: number, ch: number): [V3[], V3[]] {
  const end = (l: number): V3[] => {
    if (d.slot) {
      // na samym końcu fartuch schodzi do boku bloku (45°), żeby na rogu nie sterczało „ucho”;
      // między sąsiednimi klawiszami lukę wypełnia mostek
      const li = l - Math.sign(l) * SLOT_COVER;
      const a = sidePt(k, d, d.s - 1, l, -depth), b = sidePt(k, d, d.s, l, -depth), c = sidePt(k, d, d.s + SLOT_COVER, li, -depth);
      return [sidePt(k, d, d.s - 1, l, 0), a, b, c, down(a), down(b), down(c)];
    }
    // cały bok bloku (pochylony klawisz ma dół boku dalej niż górę) i pion w dół od niego
    const pts: V3[] = [];
    for (const z of [-(ch + 0.1), -depth])
      for (const n of [d.s - SKIRT, d.s]) {
        const p = sidePt(k, d, n, l, z);
        pts.push(p, down(p));
      }
    return pts;
  };
  return [end(-d.L), end(d.L)];
}

type SkirtEnd = { pts: V3[]; slot: boolean; key: number; n: V3 };

/**
 * Mostki między końcami pasów/fartuchów sąsiednich klawiszy (np. kolejne rzędy kolumny pochylone
 * względem siebie): bez nich na styku zostaje ząbek.
 */
function skirtBridges(M: ManifoldToplevel, ends: SkirtEnd[]): Manifold[] {
  const out: Manifold[] = [];
  const c = (p: V3[]) => p[2];
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i], b = ends[j];
      if (a.key === b.key || a.slot !== b.slot) continue;
      // tylko boki zwrócone w tę samą stronę (np. ten sam bok kolejnych rzędów kolumny)
      if (a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] < 0.8) continue;
      const p = c(a.pts), q = c(b.pts);
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 4) out.push(M.Manifold.hull([...a.pts, ...b.pts]));
    }
  return out;
}

/** Klin fazki 45° wzdłuż górnej krawędzi boku bloku (odcina też to, co nad linią fazki na zewnątrz). */
function sideWedge(M: ManifoldToplevel, k: DKey, d: Side, ch: number): Manifold {
  const pts: V3[] = [];
  for (const l of [-d.L - 0.5, d.L + 0.5])
    pts.push(sidePt(k, d, d.s - ch, l, 0), sidePt(k, d, d.s - ch, l, 3), sidePt(k, d, d.s + 1, l, 3), sidePt(k, d, d.s + 1, l, -ch - 1));
  return M.Manifold.hull(pts);
}

/** Czy bok wystaje nad koc (uskok): koc tuż za bokiem jest niżej niż dół fazki. */
function isCliff(k: DKey, d: Side, top: (x: number, y: number) => number, ch: number): boolean {
  let low = 0;
  for (const t of [-0.8, -0.4, 0, 0.4, 0.8]) {
    const e = sidePt(k, d, d.s, t * d.L, 0), o = sidePt(k, d, d.s + 1.2, t * d.L, 0);
    if (top(o[0], o[1]) < e[2] - Math.max(ch, 0.5)) low++;
  }
  return low >= 2;
}

/**
 * Skorupa „koc” jako siatka: gładki wierzch przez płyty wszystkich klawiszy, pionowe ściany
 * z obrysu (model.outline) sfazowane przy wierzchu, w środku pusto do podłogi; komórki, tuleje
 * śrub i uchwyt kontrolera jak w zwykłej skorupie.
 */
export function blanketShellMesh(M: ManifoldToplevel, model: DactylModel, bp: BlanketParams, cell: Cell, b: DactylBuild): Manifold {
  const { outer, inner } = model.outline!;
  const ch = b.chamfer ?? 0;
  const f = blanketHeight(model, bp, model.web);
  const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
  const rect: [number, number, number, number] = [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2];
  const top = (x: number, y: number) => f(x, y)[0] - UNDER_PLATE;
  const bot = (x: number, y: number) => f(x, y)[1];
  let zmax = 0;
  for (const k of model.keys) zmax = Math.max(zmax, k.frame.t[2] + 30);
  const add: Manifold[] = [];
  // środek: pod kocem, do obrysu cofniętego o fazkę; pas przy ścianie: fazka 45° i pionowa ściana
  const p = densify(outer, 1);
  const q = ch > 0 ? insetLoop(p, ch) : p;
  add.push(M.Manifold.extrude(new M.CrossSection([q], 'Positive'), zmax).intersect(heightSlab(M, rect, top, -5)));
  if (ch > 0)
    for (let i = 0; i < p.length; i++) {
      const j = (i + 1) % p.length;
      const pts: V3[] = [];
      for (const r of [p[i], p[j]]) pts.push([r[0], r[1], 0], [r[0], r[1], top(r[0], r[1]) - ch]);
      for (const r of [q[i], q[j]]) pts.push([r[0], r[1], 0], [r[0], r[1], top(r[0], r[1])]);
      add.push(M.Manifold.hull(pts));
    }
  // bloki klawiszy (dokładne płyty), pod ich bokami pasy i fartuchy do koca, fazki na uskokach
  const slots = new Map(cellSideOpenings(cell).map((o) => [sideOf(o), o] as const));
  const skirts: Manifold[] = [];
  const wedges: Manifold[] = [];
  const ends: SkirtEnd[] = [];
  model.keys.forEach((k, ki) => {
    add.push(M.Manifold.hull(keyBlock(k, model.web)));
    for (const d of keySides(k, slots, top)) {
      const [e0, e1] = sideSkirt(k, d, model.web, ch);
      skirts.push(M.Manifold.hull([...e0, ...e1]));
      const o = sidePt(k, d, 0, 0, 0), e = sidePt(k, d, 1, 0, 0);
      const n: V3 = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
      ends.push({ pts: e0, slot: d.slot, key: ki, n }, { pts: e1, slot: d.slot, key: ki, n });
      if (ch > 0 && isCliff(k, d, top, ch)) wedges.push(sideWedge(M, k, d, ch));
    }
  });
  skirts.push(...skirtBridges(M, ends));
  add.push(M.Manifold.union(skirts).subtract(heightSlab(M, rect, (x, y) => top(x, y) - 1, -10)));
  const hollow = M.Manifold.extrude(new M.CrossSection([inner], 'Positive'), zmax + 2).translate([0, 0, -1]).intersect(heightSlab(M, rect, bot, -5));
  // tuleje śrub i dodatki kontrolera po wydrążeniu (stoją w pustym wnętrzu na podłodze)
  const extra: Manifold[] = [];
  for (const [x, y] of model.screws) extra.push(M.Manifold.cylinder(b.bossHeight, model.screw.boss / 2, model.screw.boss / 2, 48).translate([x, y, 0]));
  if (b.controller) for (const a of b.controller.shellAdd) extra.push(box(M, a));
  const body = M.Manifold.union([M.Manifold.union(add).subtract(hollow), ...extra]).intersect(M.Manifold.cube([1e4, 1e4, 1e4]).translate([-5e3, -5e3, 0]));

  let neg = negCache.get(cell);
  if (!neg) negCache.set(cell, (neg = fromShape(M, cell.negative)));
  const hole = cellTopOpening(cell);
  const tools: Manifold[] = [];
  for (const k of model.keys) {
    tools.push(neg.transform(mat4(k.frame)));
    tools.push(box(M, { ...hole, m: k.frame }));
    const i = KEY_CLEAR.inset;
    tools.push(box(M, { x0: -k.hw + i, x1: k.hw - i, y0: -k.hh + i, y1: k.hh - i, z0: KEY_CLEAR.above, z1: KEY_CLEAR.height, m: k.frame }));
  }
  for (const [x, y] of model.screws)
    tools.push(M.Manifold.cylinder(b.bossHeight - 1 + 0.5, model.screw.pilot / 2, model.screw.pilot / 2, 32).translate([x, y, -0.5]));
  if (b.controller) for (const c of b.controller.shellCut) tools.push(box(M, c));
  tools.push(...wedges);
  const out = body.subtract(M.Manifold.union(tools));
  // zostawiamy największą część (okruchy po odejmowaniu nie są drukowalne)
  const parts = out.decompose();
  parts.sort((a, c) => c.volume() - a.volume());
  return parts[0];
}

/** Siatka Manifold jako zwykłe tablice (do podglądu i zapisu). */
export function toTriMesh(m: Manifold): TriMesh {
  const g = m.getMesh();
  const n = g.numVert;
  const v = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) v[3 * i + j] = g.vertProperties[i * g.numProp + j];
  return { vertices: v, triangles: new Uint32Array(g.triVerts) };
}

/** Lustro w płaszczyźnie YZ (lewa połówka): x → −x i odwrócona kolejność wierzchołków. */
export function mirrorX(t: TriMesh): TriMesh {
  const v = t.vertices.slice();
  for (let i = 0; i < v.length; i += 3) v[i] = -v[i];
  const tr = t.triangles.slice();
  for (let i = 0; i < tr.length; i += 3) [tr[i + 1], tr[i + 2]] = [tr[i + 2], tr[i + 1]];
  return { vertices: v, triangles: tr };
}

/** Obrys siatki [[minx,miny,minz],[maxx,maxy,maxz]]. */
export function meshBounds(t: TriMesh): [[number, number, number], [number, number, number]] {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.vertices.length; i += 3)
    for (let j = 0; j < 3; j++) {
      lo[j] = Math.min(lo[j], t.vertices[i + j]);
      hi[j] = Math.max(hi[j], t.vertices[i + j]);
    }
  return [lo, hi];
}

/** Normalne do podglądu: płaskie, każdy trójkąt ma własne wierzchołki. */
export function flatShaded(t: TriMesh): { vertices: Float32Array; normals: Float32Array; triangles: Uint32Array } {
  const n = t.triangles.length;
  const v = new Float32Array(n * 3), nr = new Float32Array(n * 3), tr = new Uint32Array(n);
  for (let i = 0; i < n; i += 3) {
    const p = [0, 1, 2].map((k) => t.triangles[i + k] * 3);
    const a = [0, 1, 2].map((j) => t.vertices[p[1] + j] - t.vertices[p[0] + j]);
    const c = [0, 1, 2].map((j) => t.vertices[p[2] + j] - t.vertices[p[0] + j]);
    let nx = a[1] * c[2] - a[2] * c[1], ny = a[2] * c[0] - a[0] * c[2], nz = a[0] * c[1] - a[1] * c[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 3; j++) v[(i + k) * 3 + j] = t.vertices[p[k] + j];
      nr[(i + k) * 3] = nx; nr[(i + k) * 3 + 1] = ny; nr[(i + k) * 3 + 2] = nz;
      tr[i + k] = i + k;
    }
  }
  return { vertices: v, normals: nr, triangles: tr };
}

/** Binarny STL. */
export function stlBinary(t: TriMesh): ArrayBuffer {
  const n = t.triangles.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((k) => t.triangles[3 * i + k] * 3);
    const P = (k: number, j: number) => t.vertices[p[k] + j];
    const a = [0, 1, 2].map((j) => P(1, j) - P(0, j)), c = [0, 1, 2].map((j) => P(2, j) - P(0, j));
    const nn = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    const l = Math.hypot(...nn) || 1;
    for (const x of nn) { dv.setFloat32(o, x / l, true); o += 4; }
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) { dv.setFloat32(o, P(k, j), true); o += 4; }
    o += 2;
  }
  return buf;
}

