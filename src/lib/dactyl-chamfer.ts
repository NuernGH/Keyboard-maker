// SPDX-License-Identifier: AGPL-3.0-or-later
// Fazka ostrych wypukłych krawędzi na wierzchu skorupy Dactyla (łączniki kciuka, uskoki między
// klawiszami). OpenCascade nie umie sfazować tej bryły (setki płaskich ścian z otoczek), więc
// wzdłuż każdej ostrej krawędzi odejmujemy klin o przekroju fazki 45°.

import type { Edge, Face, Shape3D } from 'replicad';
import qh from 'quickhull3d/dist/quickhull3d.js';
import type { V3 } from './dactyl';

export interface ChamferOpts {
  /** szerokość fazki na każdej ze ścian (mm) */
  size: number;
  /** najmniejszy kąt między ścianami (stopnie), od którego krawędź jest „ostra” */
  minAngle: number;
  /** krawędzie niższe niż to pomijamy (podłoga, tuleje śrub, uchwyt kontrolera) */
  minZ: number;
  /** krótsze krawędzie same nie zaczynają fazki (mogą być jej przedłużeniem) */
  minLength: number;
  /** przedłużenie fazki na sąsiednie krawędzie w tej samej linii od tego kąta (stopnie) */
  growAngle: number;
  /** długość wygaszania fazki na wolnym końcu (mm) */
  taper: number;
}

export const DACTYL_CHAMFER: ChamferOpts = { size: 1, minAngle: 35, minZ: 12, minLength: 3, growAngle: 10, taper: 3 };

type Plane = { n: V3; d: number };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const vec = (p: { x: number; y: number; z: number }): V3 => [p.x, p.y, p.z];

/** Test „punkt w bryle” na otoczkach wypukłych (bryła skorupy to ich suma, nad podłogą). */
export function hullTester(hulls: V3[][]): (p: V3) => boolean {
  const polys: { planes: Plane[]; lo: V3; hi: V3 }[] = [];
  for (const pts of hulls) {
    let faces: number[][];
    try { faces = qh(pts); } catch { continue; }
    const c = pts.reduce((s, q) => add(s, q, 1 / pts.length), [0, 0, 0] as V3);
    const planes: Plane[] = [];
    for (const f of faces) {
      let n = cross(add(pts[f[1]], pts[f[0]], -1), add(pts[f[2]], pts[f[0]], -1));
      if (Math.hypot(...n) < 1e-9) continue;
      n = unit(n);
      let d = dot(n, pts[f[0]]);
      if (dot(n, c) > d) { n = [-n[0], -n[1], -n[2]]; d = -d; }
      planes.push({ n, d });
    }
    if (planes.length < 4) continue;
    const lo = [0, 1, 2].map((i) => Math.min(...pts.map((q) => q[i]))) as V3;
    const hi = [0, 1, 2].map((i) => Math.max(...pts.map((q) => q[i]))) as V3;
    polys.push({ planes, lo, hi });
  }
  return (p) =>
    p[2] > 0 &&
    polys.some((h) => p.every((v, i) => v >= h.lo[i] - 1e-6 && v <= h.hi[i] + 1e-6) && h.planes.every((pl) => dot(pl.n, p) <= pl.d + 1e-6));
}

/**
 * Kliny do odjęcia wzdłuż ostrych wypukłych krawędzi wierzchu. Zwraca punkty otoczek klinów.
 * inside: test punktu w bryle (bez komórek).
 */
export function chamferWedges(body: Shape3D, inside: (p: V3) => boolean, o: ChamferOpts): V3[][] {
  const byHash = new Map<number, { e: Edge; n: V3[] }[]>();
  for (const f of body.faces as Face[]) {
    if (f.geomType !== 'PLANE') continue;
    const n = unit(vec(f.normalAt()));
    for (const e of f.edges) {
      const list = byHash.get(e.hashCode) ?? [];
      let hit = list.find((q) => q.e.isSame(e));
      if (!hit) list.push((hit = { e, n: [] }));
      hit.n.push(n);
      byHash.set(e.hashCode, list);
    }
  }
  type Cand = { p0: V3; p1: V3; t: V3; A: { d: V3; n: V3 }; B: { d: V3; n: V3 }; ang: number };
  const cands: Cand[] = [];
  const cosLow = Math.cos((o.growAngle * Math.PI) / 180);
  for (const list of byHash.values())
    for (const { e, n } of list) {
      if (n.length !== 2 || e.geomType !== 'LINE') continue;
      if (Math.abs(dot(n[0], n[1])) > cosLow) continue; // prawie płasko
      const p0 = vec(e.startPoint), p1 = vec(e.endPoint);
      if (Math.min(p0[2], p1[2]) < o.minZ) continue;
      const t = unit(add(p1, p0, -1));
      const m = add(p0, add(p1, p0, -1), 0.5);
      // dla każdej ściany: kierunek w głąb ściany (prostopadle do krawędzi) i normalna na zewnątrz,
      // ustalone próbkami: tuż pod ścianą jest materiał, tuż nad nią nie
      const side = (nr: V3): { d: V3; n: V3 } | null => {
        const found: { d: V3; n: V3 }[] = [];
        for (const sd of [1, -1]) {
          const d = add([0, 0, 0], cross(nr, t), sd);
          const q = add(m, d, 0.04);
          const a = inside(add(q, nr, 0.01)), b = inside(add(q, nr, -0.01));
          if (a !== b) found.push({ d, n: a ? [-nr[0], -nr[1], -nr[2]] : nr });
        }
        return found.length === 1 ? found[0] : null; // dwa = krawędź wklęsła
      };
      const A = side(n[0]), B = side(n[1]);
      if (!A || !B) continue;
      if (dot(A.d, B.n) >= -1e-3 || dot(B.d, A.n) >= -1e-3) continue; // nie wypukła
      if (A.n[2] < -0.3 || B.n[2] < -0.3) continue; // spód skorupy
      cands.push({ p0, p1, t, A, B, ang: (Math.acos(Math.max(-1, Math.min(1, dot(A.n, B.n)))) * 180) / Math.PI });
    }
  // ostre krawędzie, a potem ich przedłużenia (łagodniejsze krawędzie dalej w tej samej linii),
  // żeby fazka nie urywała się w pół drogi
  const key = (p: V3) => p.map((v) => Math.round(v * 100)).join(',');
  const sel = new Set(cands.filter((c) => c.ang >= o.minAngle && Math.hypot(...add(c.p1, c.p0, -1)) >= o.minLength));
  const at = new Map<string, Cand[]>();
  for (const c of cands) for (const p of [c.p0, c.p1]) at.set(key(p), [...(at.get(key(p)) ?? []), c]);
  for (let grown = true; grown; ) {
    grown = false;
    for (const c of sel)
      for (const p of [c.p0, c.p1])
        for (const d of at.get(key(p)) ?? [])
          if (!sel.has(d) && Math.abs(dot(d.t, c.t)) > 0.85) {
            sel.add(d);
            grown = true;
          }
  }
  const out: V3[][] = [];
  for (const c of sel) {
    const L = Math.hypot(...add(c.p1, c.p0, -1));
    const section = (p: V3): V3[] => [
      add(add(p, c.A.d, o.size), c.A.n, 0.2),
      add(add(p, c.B.d, o.size), c.B.n, 0.2),
      add(p, add(c.A.n, c.B.n), 0.6),
    ];
    const tip = (p: V3): V3[] => [add(p, c.A.n, 0.01), add(p, c.B.n, 0.01), add(p, add(c.A.n, c.B.n), 0.6)];
    const pts: V3[] = [];
    // koniec bez przedłużenia: fazka wygasa na długości TAPER zamiast urywać się uskokiem
    for (const [p, dir] of [[c.p0, 1], [c.p1, -1]] as const) {
      const cont = (at.get(key(p)) ?? []).some((d) => d !== c && sel.has(d) && Math.abs(dot(d.t, c.t)) > 0.85);
      if (cont) pts.push(...section(p));
      else pts.push(...tip(p), ...section(add(p, c.t, dir * Math.min(o.taper, L / 2))));
    }
    out.push(pts);
  }
  return out;
}
