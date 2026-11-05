// SPDX-License-Identifier: AGPL-3.0-or-later
// Geometria CAD (replicad / OpenCascade). Działa w Web Workerze i w Node (testy).
//
// Zasada: płyta = (obrys wszystkich klawiszy, wyciągnięty na wysokość komórki)
//                 − („negatywy” komórek w pozycjach klawiszy).
// Negatyw komórki = jej prostopadłościan obrysu minus sama komórka, czyli dokładnie
// to, co komórka wycina (otwór 14×14, wybranie 15,2, kieszeń hot-swap, otwory pinów).
// Dzięki temu obrócone klawisze kciuka nie zasypują sobie nawzajem otworów, a szczeliny
// między nimi wypełnia obrys (domknięcie offsetem +r / −r).

import {
  Blueprints,
  cast,
  CompoundBlueprint,
  Drawing,
  drawRectangle,
  getOC,
  importSTEP,
  makeBox,
  makeCylinder,
  measureVolume,
  type Shape3D,
} from 'replicad';
import { PITCH, type Key } from './layout';
import type { IslandGeom } from './island';
import { CASE_SCREW, type CaseLayout, type CaseParams } from './case';

import {
  DEFAULT_PLATE_OPTIONS,
  MX_HOLE,
  NO_HOTSWAP_HEIGHT,
  THIN_PLATE_THICKNESS,
  type CellVariant,
  type PlateOptions,
  type UpAxis,
} from './cell-spec';
export * from './cell-spec';

export interface Cell {
  /** negatyw komórki w układzie: środek w (0,0), górna powierzchnia płyty z = 0, oś Z w górę */
  negative: Shape3D;
  /** wysokość komórki (mm), komórka zajmuje z ∈ [−height, 0] */
  height: number;
  /** wymiar komórki w XY (mm) */
  size: number;
}

export interface CellSource {
  /** zawartość pliku STEP komórki 1U */
  step: Blob;
  /**
   * Oś „do góry” komórki w pliku (strona płyty). Komórki z SolidWorks od Marcina mają ją wzdłuż +X.
   * 'auto' wybiera najkrótszy wymiar obrysu i stronę, po której jest mniej materiału (płyta z otworem).
   */
  up: UpAxis | 'auto';
}

/** Ustawia komórkę tak, by płyta była na górze (z = 0), a środek w (0, 0). */
export function normalizeCell(shape: Shape3D, up: UpAxis): Shape3D {
  let s = shape;
  switch (up) {
    case '+X':
      s = s.rotate(-90, [0, 0, 0], [0, 1, 0]);
      break;
    case '-X':
      s = s.rotate(90, [0, 0, 0], [0, 1, 0]);
      break;
    case '+Y':
      s = s.rotate(90, [0, 0, 0], [1, 0, 0]);
      break;
    case '-Y':
      s = s.rotate(-90, [0, 0, 0], [1, 0, 0]);
      break;
    case '-Z':
      s = s.rotate(180, [0, 0, 0], [1, 0, 0]);
      break;
    case '+Z':
      break;
  }
  const bb = s.boundingBox;
  const [cx, cy] = bb.center;
  return s.translate(-cx, -cy, -bb.bounds[1][2]);
}

function sliceArea(s: Shape3D, axis: 0 | 1 | 2, at: number): number {
  const bb = s.boundingBox.bounds;
  const lo: [number, number, number] = [bb[0][0] - 1, bb[0][1] - 1, bb[0][2] - 1];
  const hi: [number, number, number] = [bb[1][0] + 1, bb[1][1] + 1, bb[1][2] + 1];
  const t = 0.05;
  lo[axis] = at - t / 2;
  hi[axis] = at + t / 2;
  const cut = s.clone().intersect(makeBox(lo, hi)) as Shape3D;
  return volumeOf(cut) / t;
}

function volumeOf(s: Shape3D): number {
  return measureVolume(s);
}

/** Wykrywa oś „do góry”: najkrótszy wymiar, strona z mniejszym przekrojem (płyta z otworem 14×14). */
export function detectUp(shape: Shape3D): UpAxis {
  const bb = shape.boundingBox.bounds;
  const dims = [0, 1, 2].map((i) => bb[1][i] - bb[0][i]);
  const axis = dims.indexOf(Math.min(...dims)) as 0 | 1 | 2;
  const name = ['X', 'Y', 'Z'][axis];
  const nearMax = sliceArea(shape, axis, bb[1][axis] - 0.3);
  const nearMin = sliceArea(shape, axis, bb[0][axis] + 0.3);
  return ((nearMax < nearMin ? '+' : '-') + name) as UpAxis;
}

export async function loadCell(src: CellSource, variant: CellVariant): Promise<Cell> {
  if (variant === 'thin-plate') return thinPlateCell();
  const imported = (await importSTEP(src.step)) as Shape3D;
  const up = src.up === 'auto' ? detectUp(imported) : src.up;
  const cell = normalizeCell(imported, up);
  const bb = cell.boundingBox.bounds;
  const size = Math.max(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1]);
  const fullHeight = -bb[0][2];
  const height = variant === 'no-hotswap' ? Math.min(NO_HOTSWAP_HEIGHT, fullHeight) : fullHeight;
  const box = makeBox([-size / 2, -size / 2, -height], [size / 2, size / 2, 0]);
  const solid = variant === 'no-hotswap' ? (cell.intersect(box.clone()) as Shape3D) : cell;
  const negative = box.cut(solid) as Shape3D;
  return { negative, height, size };
}

/** Cienka płyta 1,5 mm z samym otworem 14×14 (bez ścianek). */
export function thinPlateCell(hole = MX_HOLE): Cell {
  const h = THIN_PLATE_THICKNESS;
  const negative = makeBox([-hole / 2, -hole / 2, -h - 1], [hole / 2, hole / 2, 1]);
  return { negative, height: h, size: PITCH };
}

/** Obrys 2D: suma prostokątów klawiszy, domknięta offsetem. */
export function footprint(keys: Key[], opts: PlateOptions, island: IslandGeom | null = null): Drawing {
  let d: Drawing | null = null;
  for (const k of keys) {
    const r = drawRectangle(k.w * PITCH, k.h * PITCH).rotate(k.rot).translate(k.x, k.y);
    d = d ? d.fuse(r) : r;
  }
  if (d && island) {
    const r = island.rect;
    d = d.fuse(drawRectangle(r.x1 - r.x0, r.y1 - r.y0).translate((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2));
  }
  if (!d) throw new Error('Brak klawiszy');
  if (opts.fillGaps > 0) d = fillHoles(d.offset(opts.fillGaps).offset(-opts.fillGaps));
  if (opts.margin > 0) d = d.offset(opts.margin);
  return d;
}

/**
 * Usuwa zamknięte dziury z obrysu (np. szczelinę między dolnym klawiszem a kciukiem,
 * otoczoną z każdej strony klawiszami). Offset ich nie zamyka, a w płycie nie są potrzebne.
 */
export function fillHoles(d: Drawing): Drawing {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outer = (shape: any): any => {
    if (shape instanceof CompoundBlueprint) return shape.blueprints[0];
    if (shape instanceof Blueprints) return new Blueprints(shape.blueprints.map(outer));
    return shape;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Drawing(outer((d as any).innerShape));
}

/** Liczba zamkniętych dziur w obrysie. */
export function holeCount(d: Drawing): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = (shape: any): number => {
    if (shape instanceof CompoundBlueprint) return shape.blueprints.length - 1;
    if (shape instanceof Blueprints) return shape.blueprints.reduce((n: number, b: unknown) => n + count(b), 0);
    return 0;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return count((d as any).innerShape);
}

export function buildPlate(
  keys: Key[],
  cell: Cell,
  opts: PlateOptions = DEFAULT_PLATE_OPTIONS,
  island: IslandGeom | null = null,
  pilots: Shape3D[] = [],
): Shape3D {
  const outline = footprint(keys, opts, island);
  let body = outline.sketchOnPlane('XY', -cell.height).extrude(cell.height) as Shape3D;
  if (island && island.depth > cell.height + 1e-6) {
    const r = island.rect;
    body = body.fuse(makeBox([r.x0, r.y0, -island.depth], [r.x1, r.y1, 0])) as Shape3D;
  }
  const negatives = keys.map((k) =>
    cell.negative.clone().rotate(k.rot, [0, 0, 0], [0, 0, 1]).translate(k.x, k.y, 0),
  );
  if (island)
    for (const b of island.cuts)
      negatives.push(
        b.round
          ? (makeCylinder((b.x1 - b.x0) / 2, b.z1 - b.z0, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0], [0, 0, 1]) as Shape3D)
          : makeBox([b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1]),
      );
  negatives.push(...pilots);
  return cutMany(body, negatives);
}

/**
 * Odejmuje wiele narzędzi naraz (lista narzędzi w BRepAlgoAPI_Cut, nie compound).
 * Negatywy sąsiednich komórek stykają się ścianami (kanały kieszeni hot-swap wychodzą
 * na krawędź komórki). Gdy podamy je jako jeden compound, OpenCascade buduje
 * nieprawidłowe ściany dna i STEP po wczytaniu gubi materiał. Jako osobne narzędzia
 * wynik jest poprawny (sprawdza to test BRepCheck i ponowny import STEP).
 */
export function cutMany(base: Shape3D, tools: Shape3D[]): Shape3D {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc = getOC() as any;
  const args = new oc.NCollection_List_TopoDS_Shape();
  const list = new oc.NCollection_List_TopoDS_Shape();
  const builder = new oc.BRepAlgoAPI_Cut();
  try {
    args.Append(base.wrapped);
    for (const t of tools) list.Append(t.wrapped);
    builder.SetArguments(args);
    builder.SetTools(list);
    builder.Build();
    if (builder.HasErrors()) throw new Error('Operacja odejmowania brył nie powiodła się');
    builder.SimplifyResult(true, true, 1e-3);
    return cast(builder.Shape()) as Shape3D;
  } finally {
    builder.delete();
    list.delete();
    args.delete();
  }
}

/** Sprawdza poprawność bryły (BRepCheck_Analyzer). */
export function isValidShape(s: Shape3D): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oc = getOC() as any;
  const an = new oc.BRepCheck_Analyzer(s.wrapped, true, false, false);
  try {
    return an.IsValid(s.wrapped);
  } finally {
    an.delete();
  }
}

/** Otwory pilotowe pod śruby obudowy, od spodu płyty. */
export function screwPilots(screws: [number, number][], cellHeight: number, depth: number): Shape3D[] {
  return screws.map(
    ([x, y]) => makeCylinder(CASE_SCREW.pilot / 2, depth + 0.5, [x, y, -cellHeight - 0.5], [0, 0, 1]) as Shape3D,
  );
}

/**
 * Spód obudowy: wanna o obrysie płyty powiększonym o luz i ściankę, ścianki do górnej
 * powierzchni płyty, w środku słupki pod śruby (od spodu, łby schowane w dnie)
 * i wycięcia na wtyki USB.
 */
export function buildCase(
  keys: Key[],
  opts: PlateOptions,
  island: IslandGeom | null,
  cellHeight: number,
  cp: CaseParams,
  layout: CaseLayout,
): Shape3D {
  const outline = footprint(keys, opts, island);
  const inner = outline.offset(cp.gap);
  const outer = outline.offset(cp.gap + cp.wall);
  const { bottom, floorTop } = layout;
  let body = outer.sketchOnPlane('XY', bottom).extrude(-bottom) as Shape3D;
  const cavity = inner.sketchOnPlane('XY', floorTop).extrude(-floorTop + 1) as Shape3D;
  body = body.cut(cavity) as Shape3D;
  const standH = -cellHeight - floorTop;
  for (const [x, y] of layout.screws)
    if (standH > 0.01) body = body.fuse(makeCylinder(CASE_SCREW.boss / 2, standH + 0.01, [x, y, floorTop - 0.01], [0, 0, 1]) as Shape3D) as Shape3D;
  const tools: Shape3D[] = [];
  for (const [x, y] of layout.screws) {
    tools.push(makeCylinder(CASE_SCREW.clearance / 2, -bottom + 1, [x, y, bottom - 0.5], [0, 0, 1]) as Shape3D);
    tools.push(makeCylinder(CASE_SCREW.head / 2, CASE_SCREW.headDepth + 0.5, [x, y, bottom - 0.5], [0, 0, 1]) as Shape3D);
  }
  for (const b of layout.usbCuts) tools.push(makeBox([b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1]));
  return tools.length ? cutMany(body, tools) : body;
}
