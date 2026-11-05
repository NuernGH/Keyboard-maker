// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Klawiatura typu Dactyl-Manuform: rozmieszczenie klawiszy na krzywiźnie, klaster kciuka,
// mostki między klawiszami i ściany do podłogi. Tu same liczby i zbiory punktów; bryły
// (otoczki wypukłe w OpenCascade) buduje dactyl-geometry.ts.
//
// Port algorytmów i wartości domyślnych z Dactyl Configurator
// (https://github.com/rianadon/dactyl-configurator, AGPL-3.0, Ryan Adolf i autorzy
// dactyl-keyboard / dactyl-manuform: Matthew Adereth, Tom Short, ibnuda):
//   src/cljs/dactyl_generator/common.cljs   apply-key-geometry, wall-locate*, screw-insert
//   src/cljs/dactyl_generator/manuform.cljs connectors, thumb-*-place, thumb-connector-six,
//                                           *-wall, pinky-*, second-thumb-to-body, screw-placement
// Zmiany względem oryginału: nasza komórka 19,05 mm (zamiast płytki 17,4 mm) wyznacza rogi
// słupków, grubość mostków = wysokość komórki, model podnosi się sam, gdy komórka
// schodziłaby pod dno, i pomijamy wewnętrzny kawałek ściany pod szerokim małym palcem.

import { PITCH } from './layout';

export type V3 = [number, number, number];

/** Przekształcenie sztywne: macierz obrotu 3×3 (wierszami) i przesunięcie. */
export interface Mat {
  r: number[];
  t: V3;
}

export const IDENT: Mat = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

/** a ∘ b: najpierw b, potem a. */
export function mul(a: Mat, b: Mat): Mat {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a.r[i * 3 + k] * b.r[k * 3 + j];
  return { r, t: apply(a, b.t) };
}

export function apply(m: Mat, p: readonly number[]): V3 {
  const [x, y, z] = p;
  return [
    m.r[0] * x + m.r[1] * y + m.r[2] * z + m.t[0],
    m.r[3] * x + m.r[4] * y + m.r[5] * z + m.t[1],
    m.r[6] * x + m.r[7] * y + m.r[8] * z + m.t[2],
  ];
}

/** Sam obrót (kierunek), bez przesunięcia. */
export function applyDir(m: Mat, p: readonly number[]): V3 {
  return apply({ r: m.r, t: [0, 0, 0] }, p);
}

export const T = (x: number, y: number, z: number): Mat => ({ r: IDENT.r.slice(), t: [x, y, z] });
const deg = Math.PI / 180;
export function Rx(a: number): Mat {
  const c = Math.cos(a * deg), s = Math.sin(a * deg);
  return { r: [1, 0, 0, 0, c, -s, 0, s, c], t: [0, 0, 0] };
}
export function Ry(a: number): Mat {
  const c = Math.cos(a * deg), s = Math.sin(a * deg);
  return { r: [c, 0, s, 0, 1, 0, -s, 0, c], t: [0, 0, 0] };
}
export function Rz(a: number): Mat {
  const c = Math.cos(a * deg), s = Math.sin(a * deg);
  return { r: [c, -s, 0, s, c, 0, 0, 0, 1], t: [0, 0, 0] };
}
const chain = (...ms: Mat[]) => ms.reduce((a, b) => mul(a, b), IDENT);

export type ThumbName = 'tl' | 'tr' | 'ml' | 'mr' | 'bl' | 'br';
export const THUMB_NAMES: ThumbName[] = ['tl', 'tr', 'ml', 'mr', 'bl', 'br'];

export interface ThumbPose {
  /** obrót wokół X, Y, Z (stopnie, w tej kolejności) */
  rot: V3;
  /** przesunięcie od punktu zaczepienia klastra (mm) */
  off: V3;
}

export interface DactylParams {
  rows: number;
  cols: number;
  /** krzywizna kolumny (stopnie między rzędami) */
  alpha: number;
  /** krzywizna kolumn małego palca (kolumna 4 i dalej) */
  pinkyAlpha: number;
  /** krzywizna rzędu (stopnie między kolumnami) */
  beta: number;
  /** kolumna, wokół której wygina się rząd */
  centercol: number;
  /** tenting (stopnie) */
  tent: number;
  /** pochylenie całości do przodu (stopnie) */
  rotX: number;
  /** podniesienie nad podłogę (mm); model podnosi się sam, gdy komórka schodziłaby niżej */
  zOffset: number;
  /** stagger kolumn [y, z] w mm: palec wskazujący, środkowy, serdeczny, mały */
  stagger: { index: [number, number]; middle: [number, number]; ring: [number, number]; pinky: [number, number] };
  /** zewnętrzna kolumna małego palca 1,5U */
  widePinky: boolean;
  /** przesunięcie całego klastra kciuka (mm) */
  thumbOffset: V3;
  thumbs: Record<ThumbName, ThumbPose>;
  /** dodatkowy odstęp klawiszy w rzędzie i w kolumnie (mm), jak w oryginale */
  extraWidth: number;
  extraHeight: number;
  /** grubość ściany (mm) */
  wallThickness: number;
}

/** Domyślny model Dactyl Configuratora (manuform.json): 5×6, kciuk 6, alpha 15°, beta 5°, tenting 12°. */
export const DACTYL_DEFAULT: DactylParams = {
  rows: 5,
  cols: 6,
  alpha: 15,
  pinkyAlpha: 15,
  beta: 5,
  centercol: 4,
  tent: 12,
  rotX: 1,
  zOffset: 4,
  stagger: { index: [0, 0], middle: [2.8, -6.5], ring: [0, 0], pinky: [-13, 6] },
  widePinky: true,
  thumbOffset: [6, -3, 7],
  thumbs: {
    tl: { rot: [10, -23, 10], off: [-35, -15, -2] },
    tr: { rot: [10, -23, 10], off: [-12, -16, 3] },
    ml: { rot: [6, -34, 40], off: [-52, -26, -12] },
    mr: { rot: [-6, -34, 48], off: [-29, -41, -13] },
    bl: { rot: [-4, -35, 52], off: [-56.3, -43.3, -23.5] },
    br: { rot: [-16, -33, 54], off: [-37.8, -55.3, -25.3] },
  },
  extraWidth: 2.5,
  extraHeight: 1,
  wallThickness: 3,
};

// stałe oryginału (przełącznik MX, profil SA)
const MOUNT = 14.4 + 3; // płytka przełącznika w oryginale, z niej liczone promienie krzywizn
const PLATE_T = 4; // grubość płytki w oryginale: od jej spodu do wierzchu
const CAP_TOP = PLATE_T + 12.7;
const WALL_XY = 5;
const WALL_Z = -15;
const POST_ADJ = 0.05;
/** promień tulei pod śrubę (jak w spodzie płaskiej obudowy, Ø6,5) i jej zakładka na ścianę */
const BOSS_R = 3.25;
const SCREW_BITE = 1.2;
/** pół szerokości klawisza 1,5U (szeroki mały palec, dwa górne klawisze kciuka) */
const HALF_15U = (1.5 * PITCH) / 2;

const centerRow = (n: number) => n - (n === 3 ? 2.5 : n === 2 ? 2 : 3);

/** Położenie „kształtu” klawisza (spód płytki w oryginale) dla kolumny i rzędu, także ułamkowych. */
export function keyGeometry(p: DactylParams, col: number, row: number, zOffset = p.zOffset): Mat {
  const alpha = col >= 4 ? p.pinkyAlpha : p.alpha;
  const rowR = ((MOUNT + p.extraHeight) / 2) / Math.sin((alpha * deg) / 2) + CAP_TOP;
  const colR = ((MOUNT + p.extraWidth) / 2) / Math.sin((p.beta * deg) / 2) + CAP_TOP;
  const last = p.rows - 1;
  const xo = p.widePinky && col === p.cols - 1 && row !== last ? 5.5 : 0;
  const s = col === 2 ? p.stagger.middle : col === 3 ? p.stagger.ring : col >= 4 ? p.stagger.pinky : p.stagger.index;
  return chain(
    T(0, 0, zOffset),
    Rx(p.rotX),
    Ry(p.tent),
    T(0, s[0], s[1]),
    T(0, 0, colR),
    Ry(p.beta * (p.centercol - col)),
    T(0, 0, -colR),
    T(0, 0, rowR),
    Rx(alpha * (centerRow(p.rows) - row)),
    T(0, 0, -rowR),
    T(xo, 0, 0),
  );
}

export interface DKey {
  id: string;
  /** układ klawisza: środek w (0,0), wierzch płyty z = 0, oś Z w górę */
  frame: Mat;
  /** pół szerokości i pół wysokości bloku klawisza (mm); komórka 1U jest zawsze na środku */
  hw: number;
  hh: number;
  col?: number;
  row?: number;
  thumb?: ThumbName;
}

/** Słupek: pionowy odcinek w rogu klawisza (od wierzchu płyty w dół o grubość mostka). */
export interface Post {
  m: Mat;
  x: number;
  y: number;
}

export interface DactylModel {
  params: DactylParams;
  keys: DKey[];
  /** otoczki wypukłe (zbiory punktów): bloki klawiszy, mostki i ściany */
  hulls: V3[][];
  /** śruby: środki XY tulei pod wkręty od spodu */
  screws: [number, number][];
  /**
   * ślady ścian przy podłodze: 8 punktów XY na kawałek ściany, w kolejności
   * [a wewn. ×2, a zewn. ×2, b wewn. ×2, b zewn. ×2] (góra i dół słupka)
   */
  floorQuads: [number, number][][];
  /** wysokość mostków i bloków (mm) = wysokość komórki */
  web: number;
  /** o ile podniesiono model ponad zOffset, żeby komórki nie schodziły pod podłogę */
  lift: number;
}

export interface DactylOptions {
  /** wysokość komórki (mm): hot-swap 8,58, bez hot-swap 5,08 */
  cellHeight: number;
  /** minimalny odstęp spodu komórki od podłogi (mm) */
  floorClear?: number;
}

/** Słupki klawisza: rogi 1U (lub bloku 1,5U dla kciuka tl/tr) z wcięciem jak w oryginale. */
const corner = (k: DKey, sx: number, sy: number, hw = k.hw, hh = k.hh): Post => ({
  m: k.frame,
  x: sx * (hw - POST_ADJ),
  y: sy * (hh - POST_ADJ),
});

export function buildDactyl(p: DactylParams, o: DactylOptions): DactylModel {
  const H = o.cellHeight;
  const floorClear = o.floorClear ?? 2;
  const nr = p.rows, nc = p.cols;
  const last = nr - 1, cornerRow = nr - 2, lastCol = nc - 1;
  if (nr < 3 || nc < 5) throw new Error('Dactyl: co najmniej 3 rzędy i 5 kolumn');
  const wt = p.wallThickness;
  const half = PITCH / 2;

  const thumbPlace = (n: ThumbName, z: number): Mat => {
    const tp = p.thumbs[n];
    const origin = apply(keyGeometry(p, 1, cornerRow, z), [MOUNT / 2, -MOUNT / 2, 0]);
    const o2 = [0, 1, 2].map((i) => origin[i] + p.thumbOffset[i] + tp.off[i]) as V3;
    return chain(T(...o2), Rz(tp.rot[2]), Ry(tp.rot[1]), Rx(tp.rot[0]), T(0, 0, PLATE_T));
  };

  const makeKeys = (z: number): DKey[] => {
    const keys: DKey[] = [];
    for (let c = 0; c < nc; c++)
      for (let r = 0; r < nr; r++) {
        if (r === last && c < 2) continue;
        keys.push({ id: `k${c}-${r}`, frame: mul(keyGeometry(p, c, r, z), T(0, 0, PLATE_T)), hw: half, hh: half, col: c, row: r });
      }
    for (const n of THUMB_NAMES) {
      const tall = n === 'tl' || n === 'tr';
      keys.push({ id: `t-${n}`, frame: thumbPlace(n, z), hw: half, hh: tall ? HALF_15U : half, thumb: n });
    }
    return keys;
  };

  // podniesienie: najniższy róg spodu bloku klawisza ma być floorClear nad podłogą
  let keys = makeKeys(p.zOffset);
  let minZ = Infinity;
  for (const k of keys)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) minZ = Math.min(minZ, apply(k.frame, [sx * k.hw, sy * k.hh, -H])[2]);
  const lift = Math.max(0, floorClear - minZ);
  const z = p.zOffset + lift;
  if (lift > 0) keys = makeKeys(z);

  const K = (c: number, r: number) => {
    const k = keys.find((q) => q.col === c && q.row === r);
    if (!k) throw new Error(`Dactyl: brak klawisza ${c},${r}`);
    return {
      tl: corner(k, -1, 1),
      tr: corner(k, 1, 1),
      bl: corner(k, -1, -1),
      br: corner(k, 1, -1),
      // szeroki mały palec: słupki 1,5U po zewnętrznej stronie
      wtr: p.widePinky && c === lastCol ? corner(k, 1, 1, HALF_15U) : corner(k, 1, 1),
      wbr: p.widePinky && c === lastCol ? corner(k, 1, -1, HALF_15U) : corner(k, 1, -1),
    };
  };
  const TH = (n: ThumbName) => {
    const k = keys.find((q) => q.thumb === n)!;
    return { tl: corner(k, -1, 1), tr: corner(k, 1, 1), bl: corner(k, -1, -1), br: corner(k, 1, -1) };
  };
  // „left-key-place”: słupek w układzie świata, 10 mm na zewnątrz od lewej krawędzi kolumny 0
  const LK = (row: number, dir: number): Post => {
    const w = apply(keyGeometry(p, 0, row, z), [-half, dir * half, 0]);
    return { m: T(w[0] - 10, w[1], w[2] - 3 + PLATE_T), x: 0, y: 0 };
  };

  const pts = (q: Post, off: readonly number[] = [0, 0, 0]): V3[] => [
    apply(q.m, [q.x + off[0], q.y + off[1], off[2]]),
    apply(q.m, [q.x + off[0], q.y + off[1], off[2] - H]),
  ];
  const loc1 = (dx: number, dy: number): V3 => [dx * wt, dy * wt, -1];
  const loc2 = (dx: number, dy: number): V3 => [dx * WALL_XY, dy * WALL_XY, WALL_Z];
  const loc3 = (dx: number, dy: number): V3 => [dx * (WALL_XY + wt), dy * (WALL_XY + wt), WALL_Z];
  const floor = (ps: V3[]): V3[] => [...ps, ...ps.map((q) => [q[0], q[1], 0] as V3)];

  const hulls: V3[][] = [];
  const floorQuads: [number, number][][] = [];
  const hull = (...posts: (Post | V3[])[]) =>
    hulls.push(posts.flatMap((q) => (Array.isArray(q) ? q : pts(q))));
  const tri = (...posts: Post[]) => {
    for (let i = 0; i + 2 < posts.length; i++) hull(posts[i], posts[i + 1], posts[i + 2]);
  };
  const wall = (a: Post, dx1: number, dy1: number, b: Post, dx2: number, dy2: number) => {
    hulls.push([
      ...pts(a), ...pts(a, loc1(dx1, dy1)), ...pts(a, loc2(dx1, dy1)), ...pts(a, loc3(dx1, dy1)),
      ...pts(b), ...pts(b, loc1(dx2, dy2)), ...pts(b, loc2(dx2, dy2)), ...pts(b, loc3(dx2, dy2)),
    ]);
    const low = [...pts(a, loc2(dx1, dy1)), ...pts(a, loc3(dx1, dy1)), ...pts(b, loc2(dx2, dy2)), ...pts(b, loc3(dx2, dy2))];
    hulls.push(floor(low));
    floorQuads.push(low.map((q) => [q[0], q[1]]));
  };

  // bloki klawiszy (komórka zostanie w nie wycięta)
  for (const k of keys) hull(corner(k, -1, 1, k.hw + POST_ADJ, k.hh + POST_ADJ), corner(k, 1, 1, k.hw + POST_ADJ, k.hh + POST_ADJ),
    corner(k, -1, -1, k.hw + POST_ADJ, k.hh + POST_ADJ), corner(k, 1, -1, k.hw + POST_ADJ, k.hh + POST_ADJ));

  // --- connectors (pełny ostatni rząd, kolumna wewnętrzna „normie”) ---
  const skip01 = (c: number) => c === 0 || c === 1;
  for (let c = 0; c < nc - 1; c++)
    for (let r = 0; r <= last; r++) {
      if (r === last && skip01(c)) continue;
      tri(K(c + 1, r).tl, K(c, r).tr, K(c + 1, r).bl, K(c, r).br);
    }
  for (let c = 0; c < nc; c++)
    for (let r = 0; r < last; r++) {
      if (r === cornerRow && skip01(c)) continue;
      tri(K(c, r).br, K(c, r).bl, K(c, r + 1).tr, K(c, r + 1).tl);
    }
  for (let c = 0; c < nc - 1; c++)
    for (let r = 0; r < last; r++) {
      if (r === cornerRow && skip01(c)) continue;
      tri(K(c, r).br, K(c, r + 1).tr, K(c + 1, r).bl, K(c + 1, r + 1).tl);
    }

  // --- szeroki mały palec ---
  if (p.widePinky) {
    for (let r = 0; r <= last; r++) tri(K(lastCol, r).tr, K(lastCol, r).wtr, K(lastCol, r).br, K(lastCol, r).wbr);
    for (let r = 0; r < last; r++) tri(K(lastCol, r).br, K(lastCol, r).wbr, K(lastCol, r + 1).tr, K(lastCol, r + 1).wtr);
  }

  // --- kciuk: 6 klawiszy ---
  const tl = TH('tl'), tr = TH('tr'), ml = TH('ml'), mr = TH('mr'), bl = TH('bl'), br = TH('br');
  tri(tl.tr, tl.br, tr.tl, tr.bl);
  tri(br.tr, mr.tl, br.br, mr.bl);
  tri(ml.tl, ml.bl, bl.tr, bl.br);
  tri(br.tl, bl.bl, br.tr, bl.br, mr.tl, ml.bl, mr.tr, ml.br);
  tri(ml.tr, tl.tl, ml.br, tl.bl, ml.bl, mr.tl);
  tri(mr.tl, tl.bl, mr.tr, tl.br, mr.br, tr.bl, tr.br);
  tri(
    tl.tl, K(0, cornerRow).bl, tl.tr, K(0, cornerRow).br, tr.tl, K(1, cornerRow).bl, tr.tr, K(1, cornerRow).br,
    tr.br, K(2, cornerRow).bl, K(2, last).bl, K(2, last).bl, K(2, last).br, tr.br, K(3, last).bl,
  );
  tri(K(1, cornerRow).br, K(2, last).tl, K(2, cornerRow).bl, K(2, last).tr, K(2, cornerRow).br, K(3, cornerRow).bl);

  // --- ściany ---
  // tył
  for (let c = 0; c < nc; c++) wall(K(c, 0).tl, 0, 1, K(c, 0).tr, 0, 1);
  for (let c = 1; c < nc; c++) wall(K(c, 0).tl, 0, 1, K(c - 1, 0).tr, 0, 1);
  if (!p.widePinky) wall(K(lastCol, 0).tr, 0, 1, K(lastCol, 0).tr, 1, 0);
  // prawa (zewnętrzna strona małego palca)
  wall(K(lastCol, 0).wtr, 0, 1, K(lastCol, 0).wtr, 1, 0);
  for (let r = 0; r <= last; r++) wall(K(lastCol, r).wtr, 1, 0, K(lastCol, r).wbr, 1, 0);
  for (let r = 1; r <= last; r++) wall(K(lastCol, r - 1).wbr, 1, 0, K(lastCol, r).wtr, 1, 0);
  wall(K(lastCol, last).wbr, 0, -1, K(lastCol, last).wbr, 1, 0);
  // lewa (wewnętrzna, przy kolumnie 0)
  for (let r = 0; r < last; r++) {
    wall(LK(r, 1), -1, 0, LK(r, -1), -1, 0);
    hull(K(0, r).tl, K(0, r).bl, LK(r, 1), LK(r, -1));
  }
  for (let r = 1; r < last; r++) {
    wall(LK(r - 1, -1), -1, 0, LK(r, 1), -1, 0);
    hull(K(0, r).tl, K(0, r - 1).bl, LK(r, 1), LK(r - 1, -1));
  }
  wall(K(0, 0).tl, 0, 1, LK(0, 1), 0, 1);
  wall(LK(0, 1), 0, 1, LK(0, 1), -1, 0);
  // przód
  wall(tr.br, 0, -1, K(3, last).bl, 0, -1);
  wall(K(3, last).bl, 0, -1, K(3, last).br, 0.5, -1);
  wall(K(3, last).br, 0.5, -1, K(4, last).bl, 0, -1);
  for (let c = 4; c < nc; c++) wall(K(c, last).bl, 0, -1, K(c, last).br, 0, -1);
  for (let c = 5; c < nc; c++) wall(K(c, last).bl, 0, -1, K(c - 1, last).br, 0, -1);
  if (p.widePinky) {
    wall(K(lastCol, last).br, 0, -1, K(lastCol, last).wbr, 0, -1);
    wall(K(lastCol, 0).tr, 0, 1, K(lastCol, 0).wtr, 0, 1);
  }
  // kciuk
  wall(tr.br, 0, -1, mr.br, 0, -1);
  wall(mr.br, 0, -1, mr.bl, 0, -1);
  wall(mr.bl, 0, -1, br.br, 0, -1);
  wall(br.br, 0, -1, br.bl, 0, -1);
  wall(br.bl, 0, -1, br.bl, -1, 0);
  wall(br.bl, -1, 0, br.tl, -1, 0);
  wall(br.tl, -1, 0, bl.bl, -1, 0);
  wall(bl.bl, -1, 0, bl.tl, -1, 0);
  wall(bl.tl, -1, 0, bl.tl, 0, 1);
  wall(bl.tl, 0, 1, bl.tr, -1.1, 1);
  wall(bl.tr, -1.1, 1, ml.tl, -1.1, 1);
  wall(ml.tl, -1.1, 1, ml.tr, 0, 1);
  // second-thumb-to-body: szczelina między kciukiem a lewą ścianą
  const lc = LK(cornerRow, -1);
  const gap = [...pts(lc, loc2(-1, 0)), ...pts(lc, loc3(-1, 0)), ...pts(ml.tr, loc2(-0.3, 1)), ...pts(ml.tr, loc3(-0.3, 1))];
  hulls.push(floor(gap));
  floorQuads.push(gap.map((q) => [q[0], q[1]]));
  hull(gap, tl.tl);
  hull(lc, pts(lc, loc1(-1, 0)), pts(lc, loc2(-1, 0)), pts(lc, loc3(-1, 0)), tl.tl);
  hull(lc, pts(lc, loc1(-1, 0)), K(0, cornerRow).bl, pts(K(0, cornerRow).bl, loc1(-1, 0)), tl.tl);
  hull(ml.tr, pts(ml.tr, loc1(0, 1)), pts(ml.tr, loc2(0, 1)), pts(ml.tr, loc3(0, 1)), tl.tl);

  // --- śruby (screw-placement): środek tulei 0,5 mm do środka od wewnętrznej strony ściany,
  // liczony jak dolna krawędź ściany (wall-locate2), żeby tuleja zawsze przylegała do ściany ---
  const inset = WALL_XY - 0.5;
  const screwAt = (c: number, r: number): [number, number] => {
    const f = mul(keyGeometry(p, c, r, z), T(0, 0, PLATE_T));
    let q: V3;
    if (c === 0) {
      const w = apply(keyGeometry(p, 0, r, z), [-half, 0, 0]);
      q = [w[0] - 10 - inset, w[1], 0];
    } else if (r === 0) q = apply(f, [0, half + inset, WALL_Z - H / 2]);
    else if (r >= last) q = apply(f, [0, -half - inset, WALL_Z - H / 2]);
    else q = apply(f, [half + inset, 0, WALL_Z - H / 2]);
    return [q[0], q[1]];
  };
  const screws: [number, number][] = [
    screwAt(0, 0),
    screwAt(0, last - 0.8),
    screwAt(2, last + 0.2),
    screwAt(3, 0),
    screwAt(lastCol + (p.widePinky ? 0.5 : 0.1), 1),
  ];

  const model: DactylModel = { params: p, keys, hulls, screws, floorQuads, web: H, lift };
  // tuleja ma wchodzić w ścianę na SCREW_BITE mm, a resztą stać w środku obudowy
  const loop = floorLoop(model);
  model.screws = screws.map((s) => settleInside(s, loop, BOSS_R - SCREW_BITE));
  return model;
}

/**
 * Wewnętrzny obrys podłogi: kawałki ścian połączone w pętlę (zachłannie, od końca do najbliższego
 * początku), z każdego wewnętrzna krawędź. Razem ze śladami ścian daje pełny obrys dna.
 */
export function floorLoop(m: DactylModel): [number, number][] {
  // z dwóch punktów wewnętrznej krawędzi (góra i dół słupka) ten dalej od zewnętrznej
  const inner = (i0: number[], i1: number[], o0: number[], o1: number[]): [number, number] => {
    const ox = (o0[0] + o1[0]) / 2, oy = (o0[1] + o1[1]) / 2;
    const d0 = Math.hypot(i0[0] - ox, i0[1] - oy), d1 = Math.hypot(i1[0] - ox, i1[1] - oy);
    const q = d0 >= d1 ? i0 : i1;
    return [q[0], q[1]];
  };
  const segs = m.floorQuads.map((q) => ({ a: inner(q[0], q[1], q[2], q[3]), b: inner(q[4], q[5], q[6], q[7]) }));
  const used = new Array(segs.length).fill(false);
  const out: [number, number][] = [segs[0].a, segs[0].b];
  used[0] = true;
  let end = segs[0].b;
  for (let n = 1; n < segs.length; n++) {
    let best = -1, flip = false, bd = Infinity;
    segs.forEach((s, i) => {
      if (used[i]) return;
      const da = Math.hypot(s.a[0] - end[0], s.a[1] - end[1]);
      const db = Math.hypot(s.b[0] - end[0], s.b[1] - end[1]);
      if (da < bd) { bd = da; best = i; flip = false; }
      if (db < bd) { bd = db; best = i; flip = true; }
    });
    used[best] = true;
    const s = segs[best];
    const [p0, p1] = flip ? [s.b, s.a] : [s.a, s.b];
    out.push(p0, p1);
    end = p1;
  }
  // bez powtórzonych punktów
  return out.filter((q, i) => i === 0 || Math.hypot(q[0] - out[i - 1][0], q[1] - out[i - 1][1]) > 1e-3);
}

function segDist(q: [number, number], a: [number, number], b: [number, number]): { d: number; c: [number, number] } {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  const c: [number, number] = [a[0] + t * vx, a[1] + t * vy];
  return { d: Math.hypot(q[0] - c[0], q[1] - c[1]), c };
}

export function insidePoly(q: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Odległość punktu od brzegu wielokąta, ujemna na zewnątrz, i najbliższy punkt brzegu. */
export function polyDist(q: [number, number], poly: [number, number][]): { d: number; c: [number, number] } {
  let best = { d: Infinity, c: q };
  for (let i = 0; i < poly.length; i++) {
    const r = segDist(q, poly[i], poly[(i + 1) % poly.length]);
    if (r.d < best.d) best = r;
  }
  return { d: insidePoly(q, poly) ? best.d : -best.d, c: best.c };
}

/** Przesuwa punkt tak, by leżał w wielokącie dokładnie `depth` mm od najbliższego brzegu. */
function settleInside(q: [number, number], poly: [number, number][], depth: number): [number, number] {
  let p = q;
  for (let it = 0; it < 20; it++) {
    const { d, c } = polyDist(p, poly);
    if (Math.abs(d - depth) < 0.01) break;
    let nx = p[0] - c[0], ny = p[1] - c[1];
    const len = Math.hypot(nx, ny);
    if (len < 1e-9) break;
    nx /= len; ny /= len;
    if (d < 0) { nx = -nx; ny = -ny; }
    // kierunek do środka; przesuwamy o brakującą odległość
    p = [c[0] + nx * depth, c[1] + ny * depth];
  }
  return p;
}

/** Rogi bloku klawisza (8 punktów) w układzie świata. */
export function keyBoxCorners(k: DKey, H: number): V3[] {
  const out: V3[] = [];
  for (const z of [0, -H]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push(apply(k.frame, [sx * k.hw, sy * k.hh, z]));
  return out;
}

/** Czy dwa prostopadłościany (układ, połowy wymiarów, środek) nachodzą na siebie (test osi rozdzielających). */
export function boxesOverlap(a: { m: Mat; h: V3; c: V3 }, b: { m: Mat; h: V3; c: V3 }, eps = 0.01): boolean {
  const axes = (m: Mat): V3[] => [0, 1, 2].map((i) => [m.r[i], m.r[3 + i], m.r[6 + i]] as V3);
  const A = axes(a.m), B = axes(b.m);
  const ca = apply(a.m, a.c), cb = apply(b.m, b.c);
  const d: V3 = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
  const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const cand: V3[] = [...A, ...B];
  for (const u of A) for (const v of B) cand.push(cross(u, v));
  for (const ax of cand) {
    const len = Math.hypot(...ax);
    if (len < 1e-9) continue;
    const n: V3 = [ax[0] / len, ax[1] / len, ax[2] / len];
    const ra = A.reduce((s, u, i) => s + a.h[i] * Math.abs(dot(u, n)), 0);
    const rb = B.reduce((s, u, i) => s + b.h[i] * Math.abs(dot(u, n)), 0);
    if (Math.abs(dot(d, n)) > ra + rb - eps) return false;
  }
  return true;
}

/**
 * Pary klawiszy, których komórki wchodzą w siebie głębiej niż na grubość ścianki komórki
 * (19,05 − 15,2 = 3,85 mm na dwie strony). Płytsze zachodzenie łączy tylko pełne ścianki
 * (tak jest przy domyślnym kciuku: 0,7 mm), a otwory i kieszenie zostają nietknięte.
 */
export function cellCollisions(m: DactylModel, H = m.web, wall = (PITCH - 15.2) / 2): [string, string][] {
  const hs = PITCH / 2 - wall / 2;
  const box = (k: DKey) => ({ m: k.frame, h: [hs, hs, H / 2] as V3, c: [0, 0, -H / 2] as V3 });
  const out: [string, string][] = [];
  for (let i = 0; i < m.keys.length; i++)
    for (let j = i + 1; j < m.keys.length; j++) if (boxesOverlap(box(m.keys[i]), box(m.keys[j]))) out.push([m.keys[i].id, m.keys[j].id]);
  return out;
}

/** Lustrzane odbicie punktu (lewa połówka = odbicie prawej względem płaszczyzny YZ). */
export const mirrorX = (q: V3): V3 => [-q[0], q[1], q[2]];

/** Nakładka (uproszczona, dwa prostopadłościany): podstawa 18,2 mm, wierzch 13 mm, od 6,6 do 14 mm nad płytą. */
export const CAP = { size: 18.2, top: 13, z0: 6.6, zMid: 9.5, z1: 14 };

/** Wymiary nakładki klawisza w jego układzie: 1,5U dla kciuka tl/tr (wzdłuż Y) i szerokiego małego palca (wzdłuż X). */
export function capBox(m: DactylModel, k: DKey): { m: Mat; h: V3; c: V3 } {
  const p = m.params;
  const wide = p.widePinky && k.col === p.cols - 1 && k.row !== p.rows - 1;
  const tall = k.thumb === 'tl' || k.thumb === 'tr';
  const ex = wide ? 0.5 * PITCH : 0, ey = tall ? 0.5 * PITCH : 0;
  return { m: k.frame, h: [(CAP.size + ex) / 2, (CAP.size + ey) / 2, (CAP.zMid - CAP.z0) / 2], c: [0, 0, (CAP.z0 + CAP.zMid) / 2] };
}

/** Górna, zwężona część nakładki. */
function capTopBox(m: DactylModel, k: DKey): { m: Mat; h: V3; c: V3 } {
  const b = capBox(m, k);
  const d = (CAP.size - CAP.top) / 2;
  return { m: k.frame, h: [b.h[0] - d, b.h[1] - d, (CAP.z1 - CAP.zMid) / 2], c: [0, 0, (CAP.zMid + CAP.z1) / 2] };
}

/** Pary klawiszy, których nakładki zachodzą na siebie (przy mocnej krzywiźnie albo zbyt ciasnym kciuku). */
export function capCollisions(m: DactylModel): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < m.keys.length; i++)
    for (let j = i + 1; j < m.keys.length; j++)
      for (const [f, g] of [[capBox, capBox], [capTopBox, capTopBox], [capBox, capTopBox], [capTopBox, capBox]] as const)
        if (boxesOverlap(f(m, m.keys[i]), g(m, m.keys[j]), 0.05)) {
          out.push([m.keys[i].id, m.keys[j].id]);
          break;
        }
  return out;
}

/** Obrys całości w mm (od podłogi). */
export function modelSize(m: DactylModel): { x: number; y: number; z: number } {
  const pts = m.hulls.flat();
  const r = (i: number) => Math.max(...pts.map((q) => q[i])) - Math.min(...pts.map((q) => (i === 2 ? Math.max(0, q[i]) : q[i])));
  return { x: r(0), y: r(1), z: Math.max(...pts.map((q) => q[2])) };
}
