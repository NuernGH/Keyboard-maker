// SPDX-License-Identifier: AGPL-3.0-or-later
// Dodatki w Dactylu (opcje, domyślnie wyłączone): włącznik baterii, gniazdo kabla między połówkami
// i bateria LiPo. Części leżą na dnie: włącznik i gniazdo w kołysce przy ścianie skorupy, przez ścianę
// szczelina albo otwór; bateria w ramce na dnie. Skorupa dostaje nad częścią kieszeń (jak przy uchwycie
// kontrolera), ale tylko tam, gdzie nad częścią nie ma komórek ani mostków między klawiszami.
// Modele części (wymiary) są wspólne z płaską obudową (case-extras.ts). Model liczymy dla prawej
// połówki, lewa to lustro.

import { apply, floorLoop, mul, polyDist, Rz, T, type DactylModel, type Mat, type V3 } from './dactyl';
import type { DactylController, PartBox } from './dactyl-parts';
import { wallPartSpec, type CaseExtras, type ExtraWarn, type LBox, type LCut, type WallSide, type PartSpec } from './case-extras';

/** Grubość ścianki płaskiej obudowy, do której są dobrane części (dźwignia, tulejka). */
const REF_WALL = 2.4;
/** Kołyska na dnie: ścianki po bokach części (mm), luz, wysokość względem części. */
export const CRADLE = { wall: 1.2, gap: 0.3, height: 0.7, battRail: 2 };
/** Luz kieszeni w skorupie nad częścią i odstęp od komórek/mostków (mm). */
const POCKET = { gap: 0.3, above: 0.5 };

export type DactylExtrasPart = DactylController & { warns: ExtraWarn[] };

type P2 = [number, number];

function hull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop();
    lo.push(q);
  }
  const up: P2[] = [];
  for (const q of p.reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-9) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** Czy dwa wielokąty wypukłe zachodzą na siebie (twierdzenie o osi rozdzielającej). */
function overlap(a: P2[], b: P2[], tol = 0.01): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1, ny = x1 - x2;
      const pa = a.map(([x, y]) => x * nx + y * ny);
      const pb = b.map(([x, y]) => x * nx + y * ny);
      const len = Math.hypot(nx, ny) || 1;
      if (Math.max(...pa) <= Math.min(...pb) + tol * len || Math.max(...pb) <= Math.min(...pa) + tol * len) return false;
    }
  return true;
}

/** Narożniki pudełka w świecie (8 punktów). */
function corners(b: PartBox): V3[] {
  const out: V3[] = [];
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) out.push(b.m ? apply(b.m, [x, y, z]) : [x, y, z]);
  return out;
}
const foot = (b: PartBox): P2[] => hull(corners(b).map((p) => [p[0], p[1]]));

/**
 * Najniższa wysokość skorupy nad obszarem (komórki, mostki): otoczki, które nie sięgają podłogi
 * (ściany sięgają i te wolno wyciąć), zachodzące na obszar w XY. Infinity, gdy nad obszarem nic nie ma.
 */
const ceilCache = new WeakMap<DactylModel, { poly: P2[]; z: number; box: [number, number, number, number] }[]>();
function ceilings(model: DactylModel) {
  let c = ceilCache.get(model);
  if (c) return c;
  c = [];
  const add = (pts: V3[]) => {
    const poly = hull(pts.map((p) => [p[0], p[1]] as P2));
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    c!.push({ poly, z: Math.min(...pts.map((p) => p[2])), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  };
  for (const h of model.hulls) if (Math.min(...h.map((p) => p[2])) >= 0.3) add(h);
  // komórki klawiszy (gniazdo hot-swap pod spodem bloku): blok od wierzchu płyty w dół o wysokość mostka
  for (const k of model.keys) {
    const pts: V3[] = [];
    for (const x of [-k.hw, k.hw]) for (const y of [-k.hh, k.hh]) for (const z of [-model.web, 0]) pts.push(apply(k.frame, [x, y, z]));
    add(pts);
  }
  ceilCache.set(model, c);
  return c;
}
function ceilingOver(model: DactylModel, area: P2[]): number {
  const xs = area.map((p) => p[0]), ys = area.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  let low = Infinity;
  for (const c of ceilings(model)) {
    if (c.z >= low || c.box[0] > x1 || c.box[2] < x0 || c.box[1] > y1 || c.box[3] < y0) continue;
    if (overlap(c.poly, area)) low = c.z;
  }
  return low;
}

/** Kierunek na zewnątrz i wzdłuż ścianki dla prawej połówki (wewnętrzna = −X, w stronę kciuka). */
function dirs(side: WallSide): { n: P2; t: P2 } {
  switch (side) {
    case 'back':
      return { n: [0, 1], t: [1, 0] };
    case 'front':
      return { n: [0, -1], t: [1, 0] };
    case 'inner':
      return { n: [-1, 0], t: [0, -1] };
    case 'outer':
      return { n: [1, 0], t: [0, -1] };
  }
}

/** Przecięcie prostej p·t = a z pętlą: punkt najdalej na zewnątrz (max p·n) i kąt odcinka. */
function wallAt(loop: P2[], n: P2, t: P2, a: number): { p: P2; ang: number } | null {
  let best: { s: number; p: P2; ang: number } | null = null;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    const pa = p[0] * t[0] + p[1] * t[1], qa = q[0] * t[0] + q[1] * t[1];
    if ((pa - a) * (qa - a) > 0 || pa === qa) continue;
    const f = (a - pa) / (qa - pa);
    const x: P2 = [p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])];
    const s = x[0] * n[0] + x[1] * n[1];
    if (!best || s > best.s) best = { s, p: x, ang: (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI };
  }
  return best && { p: best.p, ang: best.ang };
}

/** Pudełko lokalne części (u, v, w) → PartBox w układzie uchwytu: x = u, y = −v (na zewnątrz), z = w. */
const lbox = (b: { u0: number; u1: number; v0: number; v1: number; w0: number; w1: number }, m: Mat, dv: number): PartBox => ({
  x0: b.u0,
  x1: b.u1,
  y0: -(b.v1 + dv),
  y1: -(b.v0 + dv),
  z0: b.w0,
  z1: b.w1,
  m,
});

interface Busy {
  area: P2[];
}

function placeWall(
  model: DactylModel,
  spec: PartSpec,
  side: WallSide,
  pos: number,
  busy: Busy[],
): { part: Omit<DactylController, 'usb'> & { area: P2[] }; dist: number } | { part: null; tooTall: boolean } {
  const loop = floorLoop(model);
  const { n, t } = dirs(side);
  const wt = model.params.wallThickness;
  // część dobrana do ścianki 2,4 mm: przy grubszej ścianie wysuwamy ją w ścianę o różnicę
  const dv = -Math.max(wt - REF_WALL, 0);
  const as = loop.map((p) => p[0] * t[0] + p[1] * t[1]);
  const uMax = Math.max(...spec.body.map((b) => Math.max(-b.u0, b.u1))) + CRADLE.gap + CRADLE.wall;
  const lo = Math.min(...as) + uMax + 2;
  const hi = Math.max(...as) - uMax - 2;
  if (hi <= lo) return { part: null, tooTall: false };
  const want = lo + ((hi - lo) * Math.min(Math.max(pos, 0), 100)) / 100;
  const cand: number[] = [];
  for (let a = lo; a <= hi + 1e-6; a += 1) cand.push(a);
  cand.sort((p, q) => Math.abs(p - want) - Math.abs(q - want));
  const top = Math.max(...spec.body.map((b) => b.w1));
  let tooTall = false;
  for (const a of cand) {
    const w = wallAt(loop, n, t, a);
    if (!w) continue;
    // ściana w miarę prosta na szerokości części (gładkie ściany są łukami)
    const e0 = wallAt(loop, n, t, a - uMax), e1 = wallAt(loop, n, t, a + uMax);
    if (!e0 || !e1) continue;
    const s = (p: P2) => p[0] * n[0] + p[1] * n[1];
    if (Math.abs(s(e0.p) - s(w.p)) > 2.5 || Math.abs(s(e1.p) - s(w.p)) > 2.5) continue;
    // oś Y na zewnątrz (zgodnie z n), oś X wzdłuż ściany
    let ang = w.ang;
    // lokalna oś Y po obrocie Rz(ang) to (−sin, cos); ma wskazywać na zewnątrz
    const ly = [-Math.sin((ang * Math.PI) / 180), Math.cos((ang * Math.PI) / 180)];
    if (ly[0] * n[0] + ly[1] * n[1] < 0) ang += 180;
    const m = mul(T(w.p[0], w.p[1], 0), Rz(ang));
    const body = spec.body.map((b) => lbox(b, m, dv));
    // kieszeń w skorupie: obrys części z kołyską i luzem, od dna do wierzchu części + luz
    const inV1 = Math.max(...spec.body.map((b) => b.v1));
    const pocket: PartBox = { x0: -uMax - POCKET.gap, x1: uMax + POCKET.gap, y0: -(inV1 + dv) - CRADLE.gap - CRADLE.wall - POCKET.gap, y1: -dv + POCKET.gap, z0: -1, z1: top + POCKET.gap, m };
    const area = foot(pocket);
    if (busy.some((o) => overlap(o.area, area))) continue;
    if (ceilingOver(model, area) < top + POCKET.above) {
      tooTall = true;
      continue;
    }
    // śruby: tuleja w skorupie i łeb w dnie
    const r = model.screw.boss / 2 + 1;
    if (model.screws.some(([x, y]) => overlap(area, [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]))) continue;
    const cuts: PartBox[] = spec.cuts(REF_WALL).map((c: LCut) => {
      if (c.type === 'box') return lbox({ ...c, v0: Math.min(c.v0, -25) }, m, dv);
      // walec (oś wzdłuż Y uchwytu): otwór przez całą ścianę albo wgłębienie od zewnątrz
      const through = c.v0 <= -REF_WALL - 0.5 && c.v1 >= 0;
      const v0 = through ? -25 : c.v0;
      return { ...lbox({ u0: -c.r, u1: c.r, v0, v1: c.v1, w0: c.wc - c.r, w1: c.wc + c.r }, m, dv), round: true };
    });
    const shellCut = [pocket, ...cuts].map((c) => ({ ...c, late: true }));
    // kołyska: ścianki po bokach i z tyłu, do 70 % wysokości części
    const b0 = spec.body[0];
    const cH = Math.max(b0.w1 * CRADLE.height, 1.5);
    const g = CRADLE.gap, cw = CRADLE.wall;
    const v1 = b0.v1 + dv;
    const bottomAdd: PartBox[] = [
      { x0: b0.u0 - g - cw, x1: b0.u0 - g, y0: -v1 - g - cw, y1: -0.4, z0: -1, z1: cH, m },
      { x0: b0.u1 + g, x1: b0.u1 + g + cw, y0: -v1 - g - cw, y1: -0.4, z0: -1, z1: cH, m },
    ];
    // tylna ścianka tylko przy gnieździe (włącznik ma z tyłu nóżki z przewodami)
    if (b0.kind !== 'switch') bottomAdd.push({ x0: b0.u0 - g - cw, x1: b0.u1 + g + cw, y0: -v1 - g - cw, y1: -v1 - g, z0: -1, z1: cH, m });
    const ghosts = spec.body.map((b: LBox, i) => ({ kind: b.kind as DactylController['ghosts'][number]['kind'], box: body[i] }));
    return { part: { shellAdd: [], shellCut, bottomAdd, bottomCut: [], ghosts, area }, dist: Math.abs(a - want) };
  }
  return { part: null, tooTall };
}

function placeBattery(
  model: DactylModel,
  bp: NonNullable<CaseExtras['battery']>,
  busy: Busy[],
  target: P2,
): (Omit<DactylController, 'usb'> & { area: P2[] }) | null | 'tooTall' {
  const loop = floorLoop(model);
  const xs = loop.map((p) => p[0]), ys = loop.map((p) => p[1]);
  const g = 0.5, rw = CRADLE.wall;
  const r = model.screw.boss / 2 + 1;
  const screwAreas = model.screws.map(([x, y]) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]] as P2[]);
  const cand: [number, number, number, number, number][] = [];
  for (const [L, W] of [
    [bp.l, bp.w],
    [bp.w, bp.l],
  ])
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1) cand.push([Math.hypot(x - target[0], y - target[1]), x, y, L, W]);
  cand.sort((p, q) => p[0] - q[0]);
  let tooTall = false;
  for (const [, cx, cy, L, W] of cand) {
    const hx = L / 2 + g + rw, hy = W / 2 + g + rw;
    const area: P2[] = [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
    // cała ramka w środku, co najmniej 1 mm od wewnętrznej strony ściany
    if (area.some((p) => polyDist(p, loop).d < 1) || !area.every((p) => polyDist(p, loop).d >= 1)) continue;
    if (busy.some((o) => overlap(o.area, area))) continue;
    if (screwAreas.some((s) => overlap(s, area))) continue;
    if (ceilingOver(model, area) < bp.t + POCKET.above) {
      tooTall = true;
      continue;
    }
    const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): PartBox => ({ x0, y0, z0, x1, y1, z1 });
    const ix = L / 2 + g, iy = W / 2 + g;
    const h = CRADLE.battRail;
    const bottomAdd = [
      box(cx - ix - rw, cy - iy - rw, -1, cx - ix, cy + iy + rw, h),
      box(cx + ix, cy - iy - rw, -1, cx + ix + rw, cy + iy + rw, h),
      box(cx - ix, cy - iy - rw, -1, cx + ix, cy - iy, h),
      box(cx - ix, cy + iy, -1, cx + ix, cy + iy + rw, h),
    ];
    return { shellAdd: [], shellCut: [], bottomAdd, bottomCut: [], ghosts: [{ kind: 'battery', box: box(cx - L / 2, cy - W / 2, 0, cx + L / 2, cy + W / 2, bp.t) }], area };
  }
  return tooTall ? 'tooTall' : null;
}

/**
 * Dodatki Dactyla dla prawej połówki. `holder` (uchwyt kontrolera) jest omijany, bateria staje
 * jak najbliżej niego. Kolejność: włącznik, gniazdo, bateria.
 */
export function dactylExtras(model: DactylModel, extras: CaseExtras | undefined, holder: DactylController | null): DactylExtrasPart | null {
  if (!extras || !(extras.power?.on || extras.link?.on || extras.battery?.on)) return null;
  const busy: Busy[] = [];
  if (holder) for (const b of [...holder.bottomAdd, ...holder.shellCut.filter((c) => c.z0 < 0)]) busy.push({ area: foot(b) });
  const out: DactylExtrasPart = { shellAdd: [], shellCut: [], bottomAdd: [], bottomCut: [], ghosts: [], usb: holder?.usb ?? [0, 0], warns: [] };
  const take = (p: Omit<DactylController, 'usb'> & { area: P2[] }) => {
    out.shellCut.push(...p.shellCut);
    out.bottomAdd.push(...p.bottomAdd);
    out.ghosts.push(...p.ghosts);
    busy.push({ area: p.area });
  };
  const wallPart = (part: 'power' | 'link', spec: PartSpec, side: WallSide, pos: number) => {
    let tooTall = false;
    for (const s of [...new Set<WallSide>([side, 'back', 'outer', 'front', 'inner'])]) {
      const r = placeWall(model, spec, s, pos, busy);
      if (!r.part) {
        tooTall ||= r.tooTall;
        continue;
      }
      if (s !== side) out.warns.push({ part, kind: 'otherSide', side: s });
      else if ((r as { dist: number }).dist > 10) out.warns.push({ part, kind: 'moved' });
      take(r.part);
      return;
    }
    out.warns.push({ part, kind: tooTall ? 'tooTall' : 'noSpot' });
  };
  if (extras.power?.on) wallPart('power', wallPartSpec('power'), extras.power.side, extras.power.pos);
  if (extras.link?.on) wallPart('link', wallPartSpec(extras.link.kind), extras.link.side, extras.link.pos);
  if (extras.battery?.on) {
    const loop = floorLoop(model);
    const target: P2 = holder ? holder.usb : [loop.reduce((s, p) => s + p[0], 0) / loop.length, loop.reduce((s, p) => s + p[1], 0) / loop.length];
    const b = placeBattery(model, extras.battery, busy, target);
    if (b && b !== 'tooTall') take(b);
    else out.warns.push({ part: 'battery', kind: b === 'tooTall' ? 'tooTall' : 'noSpot' });
  }
  return out;
}

/** Uchwyt kontrolera i dodatki razem (skorupa i dno biorą z jednego obiektu). */
export function mergeParts(a: DactylController | null, b: DactylController | null): DactylController | null {
  if (!a) return b;
  if (!b) return a;
  return {
    shellAdd: [...a.shellAdd, ...b.shellAdd],
    shellCut: [...a.shellCut, ...b.shellCut],
    bottomAdd: [...a.bottomAdd, ...b.bottomAdd],
    bottomCut: [...a.bottomCut, ...b.bottomCut],
    ghosts: [...a.ghosts, ...b.ghosts],
    usb: a.usb,
  };
}
