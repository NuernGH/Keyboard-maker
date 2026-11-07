// SPDX-License-Identifier: AGPL-3.0-or-later
// Bryły składanych nóżek: nóżka (v1 ze schodkiem pod paznokieć), kieszeń z zatrzaskiem,
// listwa na tylne śruby i przednie podkładki. Liczby i rozmieszczenie: feet.ts.

import { draw, makeBox, makeCompound, makeCylinder, makeSphere, type Shape3D } from 'replicad';
import { cutMany } from './geometry';
import { BAR, BUMPER, DEPLOYED, LATCH, LEG, POCKET, type FeetLayout } from './feet';
import type { ScrewSpec } from './case';

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  makeBox([Math.min(x0, x1), Math.min(y0, y1), z0], [Math.max(x0, x1), Math.max(y0, y1), z1]) as Shape3D;
/** walec wzdłuż X od x0 do x1 (oś w y, z) */
const cylX = (r: number, x0: number, x1: number, y: number, z: number) =>
  makeCylinder(r, Math.abs(x1 - x0), [Math.min(x0, x1), y, z], [1, 0, 0]) as Shape3D;
const cylZ = (r: number, x: number, y: number, z0: number, z1: number) =>
  makeCylinder(r, z1 - z0, [x, y, z0], [0, 0, 1]) as Shape3D;
/** Kula ze szwem obróconym na zewnątrz (strona s), żeby szew nie przecinał bryły, od której odejmujemy. */
const sphere = (r: number, s: number, x: number, y: number, z: number) =>
  (s < 0 ? (makeSphere(r).rotate(180, [0, 0, 0], [0, 0, 1]) as Shape3D) : (makeSphere(r) as Shape3D)).translate([x, y, z]) as Shape3D;
const fuse = (a: Shape3D, ...b: Shape3D[]) => b.reduce((u, s) => u.fuse(s) as Shape3D, a);

/**
 * Pryzmat o przekroju w płaszczyźnie XZ (punkty [x, z]) od y0 do y1.
 * Rysunek na XY, wyciągnięcie wzdłuż Z i obrót o 90° wokół X: (x, v, w) → (x, −w, v).
 */
function prismXZ(pts: [number, number][], y0: number, y1: number): Shape3D {
  let pen = draw(pts[0]);
  for (const p of pts.slice(1)) pen = pen.lineTo(p);
  const s = pen.close().sketchOnPlane('XY').extrude(y1 - y0) as Shape3D;
  return s.rotate(90, [0, 0, 0], [1, 0, 0]).translate([0, y1, 0]) as Shape3D;
}

/**
 * Czop: walec nubCyl mm od boku ramienia + spłaszczona półkula (półelipsa w przekroju),
 * razem nubOut mm. Bryła obrotowa wokół X, dla s = −1 lustrzana.
 */
function nub(s: 1 | -1, xa: number): Shape3D {
  const { nubR: r, nubCyl: c, nubOut: o } = LEG;
  const a = o - c;
  const pts: [number, number][] = [[-0.01, 0], [-0.01, r], [c, r]];
  const n = 12;
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2);
    pts.push([c + a * Math.sin(t), Math.max(r * Math.cos(t), 0)]);
  }
  let pen = draw(pts[0]);
  for (const p of pts.slice(1, -1)) pen = pen.lineTo(p);
  pen = pen.lineTo([o, 0]);
  let solid = pen.close().sketchOnPlane('XY').revolve([1, 0, 0]) as Shape3D;
  if (s < 0) solid = solid.rotate(180, [0, 0, 0], [0, 0, 1]) as Shape3D;
  return solid.translate([xa, 0, 0]) as Shape3D;
}

/** środek guzka zatrzasku od środka nóżki (x) */
export const BUMP_X = POCKET.width / 2 + LATCH.bumpR - LATCH.bumpOut;

/**
 * Nóżka w układzie własnym (oś zawiasu = oś X, złożona leży w kierunku −y, strona −z do blatu).
 * Kształt W: środek i dwa sprężyste ramiona przy osi, na ramionach czopy; dołki zatrzasku z boków,
 * schodek pod paznokieć na końcu od spodu.
 */
export function buildLeg(): Shape3D {
  const { width: W, thick: T, len: L, arm: A, slot: S, armY0 } = LEG;
  const h = T / 2;
  let body = fuse(box(-W / 2, W / 2, -L + h, 0, -h, h), cylX(h, -W / 2, W / 2, -L + h, 0), cylX(h, -W / 2 + A, W / 2 - A, 0, 0));
  const cuts: Shape3D[] = [];
  for (const s of [1, -1] as const) cuts.push(box(s * (W / 2 - A - S), s * (W / 2 + 1), armY0, 2, -2, 2));
  body = cutMany(body, cuts);
  for (const s of [1, -1] as const) {
    const xo = (s * W) / 2, xi = s * (W / 2 - A);
    body = fuse(body, box(xo, xi, armY0 - 0.01, 0, -h, h), cylX(h, Math.min(xo, xi), Math.max(xo, xi), 0, 0), nub(s, xo));
  }
  const tools: Shape3D[] = [];
  for (const s of [1, -1]) tools.push(sphere(LATCH.dimpleR, s, s * BUMP_X, LATCH.bumpY, 0));
  const st = LEG.step;
  tools.push(box(-st.w / 2, st.w / 2, -L - 1, -L + st.l, -h - 1, -h + st.d));
  return cutMany(body, tools);
}

/**
 * Wycięcie kieszeni z zatrzaskiem: od powierzchni baseZ w górę (nóżka wychodzi w dół), oś w y = py.
 * `slotTop`: do jakiej wysokości przechodzą szczeliny języczków (cała grubość materiału).
 */
export function pocketTools(xc: number, py: number, baseZ: number, slotTop: number): Shape3D[] {
  const { width: PW, depth: PD } = POCKET;
  const pz = baseZ + PD / 2;
  const y0 = py - LEG.len - POCKET.front;
  const y1 = py + LEG.thick / 2 + POCKET.stopGap;
  const out: Shape3D[] = [box(xc - PW / 2, xc + PW / 2, y0, y1, baseZ - 1, baseZ + PD)];
  out.push(cylZ(POCKET.notchR, xc, y0, baseZ - 1, baseZ + POCKET.notchD));
  for (const s of [1, -1]) {
    const xw = xc + (s * PW) / 2;
    // gniazdo czopu
    out.push(cylX(POCKET.socketR, xw, xw + s * POCKET.socketD, py, pz));
    // rampa wjazdowa: od wejścia kieszeni (ramp mm w ściance) do zera tuż pod gniazdem
    const r = POCKET.ramp;
    const pts: [number, number][] = [[xw - s * 0.01, baseZ - 1], [xw + s * r, baseZ - 1], [xw + s * r, baseZ], [xw + s * 0.01, pz - 1.24], [xw - s * 0.01, pz - 1.24]];
    out.push(prismXZ(pts, py - POCKET.rampHalf, py + POCKET.rampHalf));
    // języczek zatrzasku: szczelina za ścianką + poprzeczne cięcie z przodu (przymocowany z tyłu)
    const sx0 = xw + s * LATCH.beam, sx1 = xw + s * (LATCH.beam + LATCH.slot);
    out.push(box(sx0, sx1, py + LATCH.y0 - LATCH.slot, py + LATCH.y1, baseZ - 1, slotTop + 1));
    out.push(box(xw - s * 0.5, sx1, py + LATCH.y0 - LATCH.slot, py + LATCH.y0, baseZ - 1, slotTop + 1));
  }
  return out;
}

/** Guzki zatrzasku na języczkach (dodawane po wycięciu kieszeni). */
export function pocketBumps(xc: number, py: number, baseZ: number): Shape3D[] {
  const pz = baseZ + POCKET.depth / 2;
  return [1, -1].map((s) => sphere(LATCH.bumpR, s, xc + s * BUMP_X, py + LATCH.bumpY, pz));
}

/** Występ w stare wybranie na łeb, otwór na śrubę i nowe wybranie na łeb w listwie/podkładce. */
function screwSeat(x: number, y: number, bottom: number, f: FeetLayout, sp: ScrewSpec, caseHead: number, pegs: boolean) {
  const base = f.baseZ;
  const peg = pegs ? Math.min(3, caseHead - 0.2) : 0;
  return {
    add: peg > 0.4 ? [cylZ(sp.head / 2 - 0.1, x, y, bottom - 0.01, bottom + peg)] : [],
    cut: [cylZ(sp.clearance / 2, x, y, base - 1, bottom + peg + 1), cylZ(sp.head / 2, x, y, base - 1, base + (f.barHead ?? sp.headDepth))],
  };
}

/**
 * Listwa z kieszeniami (tryb 'bar') w położeniu na obudowie: od f.baseZ do spodu obudowy,
 * występy w wybrania na łby (opcjonalnie).
 */
export function buildFeetBar(f: FeetLayout, bottom: number, sp: ScrewSpec, caseHead: number, pegs = true): Shape3D | null {
  if (!f.bar || !f.legs.length) return null;
  const b = f.bar;
  let bar = box(b.x0, b.x1, b.y0, b.y1, f.baseZ, bottom);
  const tools: Shape3D[] = [];
  const adds: Shape3D[] = [];
  for (const [x, y] of b.screws) {
    const s = screwSeat(x, y, bottom, f, sp, caseHead, pegs);
    adds.push(...s.add);
    tools.push(...s.cut);
  }
  if (adds.length) bar = fuse(bar, ...adds);
  for (const xc of f.legs) tools.push(...pocketTools(xc, f.pivotY, f.baseZ, bottom));
  bar = cutMany(bar, tools);
  return fuse(bar, ...f.legs.flatMap((xc) => pocketBumps(xc, f.pivotY, f.baseZ)));
}

/** Przednie podkładki (tryb 'bar') w położeniu na obudowie. */
export function buildFeetPads(f: FeetLayout, bottom: number, sp: ScrewSpec, caseHead: number, pegs = true): Shape3D[] {
  return (f.pads ?? []).map((p) => {
    const s = screwSeat(p.x, p.y, bottom, f, sp, caseHead, pegs);
    return cutMany(fuse(cylZ(p.r, p.x, p.y, f.baseZ, bottom), ...s.add), s.cut);
  });
}

/** Nóżka w położeniu na obudowie: kąt 0 = złożona, DEPLOYED.deg = rozłożona. */
export function placeLeg(leg: Shape3D, f: FeetLayout, xc: number, deg = 0): Shape3D {
  return leg.clone().rotate(deg, [0, 0, 0], [1, 0, 0]).translate([xc, f.pivotY, f.baseZ + POCKET.depth / 2]) as Shape3D;
}

/** Zmiany w spodzie obudowy (tryb 'pocket'): pogrubienie dna (fuzja) i wycięcia (kieszenie, stopki), guzki po wycięciu. */
export function caseFeetParts(f: FeetLayout | undefined): { add: Shape3D[]; cut: Shape3D[]; after: Shape3D[] } {
  if (!f || f.mode !== 'pocket' || !f.legs.length) return { add: [], cut: [], after: [] };
  const add = (f.thicken ?? []).map((b) => box(b.x0, b.x1, b.y0, b.y1, b.z0, b.z1));
  const top = Math.max(...(f.thicken ?? []).map((b) => b.z1));
  const cut = f.legs.flatMap((xc) => pocketTools(xc, f.pivotY, f.baseZ, top));
  for (const [x, y] of f.bumpers ?? []) cut.push(cylZ(BUMPER.r, x, y, f.baseZ - 1, f.baseZ + BUMPER.depth));
  const after = f.legs.flatMap((xc) => pocketBumps(xc, f.pivotY, f.baseZ));
  return { add, cut, after };
}

/**
 * Wszystkie luźne części nóżek: listwa, podkładki i nóżki (tryb 'bar') albo same nóżki (tryb 'pocket').
 * 'place': na swoich miejscach pod obudową, nóżki rozłożone (podgląd).
 * 'print': ułożone na stole: listwa i podkładki tak jak leżą (kieszenie i wybrania na łby do stołu,
 * występy do góry), nóżki płasko schodkiem do góry, wszystko od z = 0.
 */
export function buildFeetSet(
  f: FeetLayout,
  bottom: number,
  sp: ScrewSpec,
  caseHead: number,
  pegs: boolean,
  pose: 'place' | 'print',
  /** podgląd części spodu po podziale: tylko nóżki i podkładki po tej stronie (listwa przy pierwszej) */
  piece?: { caseX: number; piece: 0 | 1 },
): Shape3D | null {
  if (!f.legs.length) return null;
  const mine = (x: number) => !piece || (x < piece.caseX ? 0 : 1) === piece.piece;
  const leg = buildLeg();
  const bar = f.mode === 'bar' ? buildFeetBar(f, bottom, sp, caseHead, pegs) : null;
  const pads = f.mode === 'bar' ? buildFeetPads(f, bottom, sp, caseHead, pegs) : [];
  if (pose === 'place') {
    const parts = [
      ...(bar && (!piece || piece.piece === 0) ? [bar] : []),
      ...pads.filter((_, i) => mine(f.pads![i].x)),
      ...f.legs.filter(mine).map((xc) => placeLeg(leg, f, xc, DEPLOYED.deg)),
    ];
    return parts.length ? (makeCompound(parts) as Shape3D) : null;
  }
  const gap = 5;
  const parts: Shape3D[] = [];
  let x = 0;
  let y = 0;
  if (bar && f.bar) {
    parts.push(bar.translate([-f.bar.x0, -f.bar.y0, -f.baseZ]) as Shape3D);
    y = -gap;
  }
  // nóżki: obrót o 180° wokół osi Y (schodek do góry), rząd przed listwą
  const flat = leg.clone().rotate(180, [0, 0, 0], [0, 1, 0]) as Shape3D;
  const lw = LEG.width + 2 * LEG.nubOut;
  for (let i = 0; i < f.legs.length; i++) {
    parts.push(flat.clone().translate([x + lw / 2, y - LEG.thick / 2, LEG.thick / 2]) as Shape3D);
    x += lw + gap;
  }
  for (const p of pads) {
    const bb = p.boundingBox.bounds;
    parts.push(p.translate([x - bb[0][0], y - bb[1][1], -bb[0][2]]) as Shape3D);
    x += bb[1][0] - bb[0][0] + gap;
  }
  flat.delete?.();
  return makeCompound(parts) as Shape3D;
}
