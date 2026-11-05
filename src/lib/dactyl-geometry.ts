// SPDX-License-Identifier: AGPL-3.0-or-later
// Bryły klawiatury Dactyl w OpenCascade: otoczki wypukłe z dactyl.ts łączone w jedną skorupę,
// w nią wycięte komórki, od spodu płaskie dno przykręcane śrubami i uchwyt kontrolera.

import { cast, getOC, iterTopo, makeBox, makeCylinder, makePolygon, makeSolid, measureVolume, type Shape3D } from 'replicad';
import qh from 'quickhull3d/dist/quickhull3d.js';
import { cutMany, isValidShape, type Cell } from './geometry';
import { draw } from 'replicad';
import { floorLoop, type DactylModel, type Mat, type V3 } from './dactyl';
import { CASE_SCREW } from './case';
import type { DactylController } from './dactyl-parts';

/** Bryła otoczki wypukłej zbioru punktów (trójkąty z quickhull, zszyte w bryłę). */
export function hullSolid(points: V3[]): Shape3D {
  const uniq: V3[] = [];
  for (const q of points) if (!uniq.some((u) => Math.abs(u[0] - q[0]) + Math.abs(u[1] - q[1]) + Math.abs(u[2] - q[2]) < 1e-6)) uniq.push(q);
  const faces = qh(uniq);
  const polys = faces.map((f) => makePolygon(f.map((i) => uniq[i])));
  return makeSolid(polys) as unknown as Shape3D;
}

/** Przekształca bryłę układem klawisza. */
export function placeShape(s: Shape3D, m: Mat): Shape3D {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc = getOC() as any;
  const tr = new oc.gp_Trsf();
  const r = m.r;
  tr.SetValues(r[0], r[1], r[2], m.t[0], r[3], r[4], r[5], m.t[1], r[6], r[7], r[8], m.t[2]);
  const b = new oc.BRepBuilderAPI_Transform(s.wrapped, tr, true, false);
  try {
    return cast(b.Shape()) as Shape3D;
  } finally {
    b.delete();
    tr.delete();
  }
}

/** Suma wielu brył naraz (BRepAlgoAPI_Fuse z listą argumentów i narzędzi). */
export function fuseMany(shapes: Shape3D[], fuzzy = 0): Shape3D {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc = getOC() as any;
  const args = new oc.NCollection_List_TopoDS_Shape();
  const tools = new oc.NCollection_List_TopoDS_Shape();
  const builder = new oc.BRepAlgoAPI_Fuse();
  try {
    args.Append(shapes[0].wrapped);
    for (const s of shapes.slice(1)) tools.Append(s.wrapped);
    builder.SetArguments(args);
    builder.SetTools(tools);
    if (fuzzy) builder.SetFuzzyValue(fuzzy);
    builder.Build();
    if (builder.HasErrors()) throw new Error('Łączenie brył skorupy nie powiodło się');
    return singleSolid(cast(builder.Shape()) as Shape3D);
  } finally {
    builder.delete();
    tools.delete();
    args.delete();
  }
}

/** Gdy wynik to zbiór z jedną bryłą, zwraca samą bryłę (dalsze odejmowanie działa wtedy poprawnie). */
export function singleSolid(s: Shape3D): Shape3D {
  const solids = Array.from(iterTopo(s.wrapped, 'solid'));
  return solids.length === 1 ? (cast(solids[0]) as Shape3D) : s;
}

/** Scala współpłaszczyznowe ściany (trójkąty otoczek) w większe płaszczyzny. */
export function unifyFaces(s: Shape3D): Shape3D {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc = getOC() as any;
  const u = new oc.ShapeUpgrade_UnifySameDomain(s.wrapped, true, true, false);
  try {
    u.SetLinearTolerance(1e-4);
    u.SetAngularTolerance(1e-5);
    u.Build();
    return cast(u.Shape()) as Shape3D;
  } finally {
    u.delete();
  }
}

export interface DactylBuild {
  /** grubość dna (mm); dno leży pod skorupą, z ∈ [−floor, 0] */
  floor: number;
  /** wysokość tulei pod śruby w skorupie (mm) */
  bossHeight: number;
  controller: DactylController | null;
}

export const DEFAULT_DACTYL_BUILD: DactylBuild = { floor: 3, bossHeight: 7, controller: null };

/** Bryła skorupy bez komórek (otoczki + tuleje), przycięta do podłogi z = 0. */
export function shellBody(model: DactylModel, b: DactylBuild): Shape3D {
  // płaskie otoczki (wszystkie punkty w jednej płaszczyźnie, np. przy cienkiej komórce bez hot-swap)
  // nie mają objętości i psują łączenie, więc je pomijamy
  const solids = model.hulls.map(hullSolid).filter((h) => measureVolume(h) > 0.01 && isValidShape(h));
  for (const [x, y] of model.screws)
    solids.push(makeCylinder(CASE_SCREW.boss / 2, b.bossHeight, [x, y, 0], [0, 0, 1]) as Shape3D);
  if (b.controller) solids.push(...b.controller.shellAdd.map(boxOf));
  let body = fuseMany(solids);
  // podłoga: wszystko poniżej z = 0 odcinamy
  const bb = body.boundingBox.bounds;
  body = body.intersect(makeBox([bb[0][0] - 5, bb[0][1] - 5, 0], [bb[1][0] + 5, bb[1][1] + 5, bb[1][2] + 5])) as Shape3D;
  return body;
}

type BoxSpec = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; m?: Mat };
export function boxOf(b: BoxSpec): Shape3D {
  const s = makeBox([b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1]);
  return b.m ? placeShape(s, b.m) : s;
}

/** Skorupa: otoczki, komórki wycięte w pozycjach klawiszy, otwory pilotowe śrub, otwór USB. */
export function buildDactylShell(model: DactylModel, cell: Cell, b: DactylBuild = DEFAULT_DACTYL_BUILD): Shape3D {
  const body = shellBody(model, b);
  const tools: Shape3D[] = model.keys.map((k) => placeShape(cell.negative.clone(), k.frame));
  for (const [x, y] of model.screws)
    tools.push(makeCylinder(CASE_SCREW.pilot / 2, b.bossHeight - 1 + 0.5, [x, y, -0.5], [0, 0, 1]) as Shape3D);
  if (b.controller) tools.push(...b.controller.shellCut.map(boxOf));
  return singleSolid(unifyFaces(cutMany(body, tools)));
}

const FLOOR_FUZZ = 1e-3;

/** Pryzmat z wielokąta XY między z0 i z1. */
function polyPrism(poly: [number, number][], z0: number, z1: number): Shape3D {
  let pen = draw(poly[0]);
  for (const p of poly.slice(1)) pen = pen.lineTo(p);
  return pen.close().sketchOnPlane('XY', z0).extrude(z1 - z0) as Shape3D;
}

/**
 * Płyta o obrysie podłogi skorupy: ślady ścian przy podłodze plus wielokąt z ich wewnętrznych
 * krawędzi (pętla), połączone w 3D (2D suma wielu wielokątów dawała w OpenCascade złe bryły).
 */
export function floorSlab(model: DactylModel, z0: number, z1: number): Shape3D {
  const parts = model.floorQuads.map(hull2d).filter((h) => h.length >= 3).map((h) => polyPrism(h, z0, z1));
  parts.unshift(polyPrism(floorLoop(model), z0, z1));
  return fuseMany(parts, FLOOR_FUZZ);
}

/** Dno: płyta pod skorupą z otworami na śruby (łby schowane od spodu) i uchwytem kontrolera. */
export function buildDactylBottom(model: DactylModel, b: DactylBuild = DEFAULT_DACTYL_BUILD): Shape3D {
  let body = floorSlab(model, -b.floor, 0);
  if (b.controller) for (const a of b.controller.bottomAdd) body = body.fuse(boxOf(a)) as Shape3D;
  const tools: Shape3D[] = [];
  for (const [x, y] of model.screws) {
    tools.push(makeCylinder(CASE_SCREW.clearance / 2, b.floor + 1, [x, y, -b.floor - 0.5], [0, 0, 1]) as Shape3D);
    tools.push(makeCylinder(CASE_SCREW.head / 2, Math.min(CASE_SCREW.headDepth, b.floor - 1) + 0.5, [x, y, -b.floor - 0.5], [0, 0, 1]) as Shape3D);
  }
  if (b.controller) tools.push(...b.controller.bottomCut.map(boxOf));
  return singleSolid(cutMany(body, tools));
}

/** Wypukła otoczka punktów 2D (monotone chain), przeciwnie do ruchu wskazówek zegara. */
export function hull2d(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-9) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-9) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export const volume = measureVolume;
