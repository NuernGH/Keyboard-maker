// SPDX-License-Identifier: AGPL-3.0-or-later
// Geometria CAD (replicad / OpenCascade). Działa w Web Workerze i w Node (testy).
//
// Zasada: płyta = (obrys wszystkich klawiszy, wyciągnięty na wysokość komórki)
//                 − („negatywy” komórek w pozycjach klawiszy).
// Negatyw komórki = jej prostopadłościan obrysu minus sama komórka, czyli dokładnie
// to, co Part1.STEP wycina (otwór 14×14, wybranie 15,2, kieszeń hot-swap, otwory pinów).
// Dzięki temu obrócone klawisze kciuka nie zasypują sobie nawzajem otworów, a szczeliny
// między nimi wypełnia obrys (domknięcie offsetem +r / −r).

import {
  cast,
  drawRectangle,
  getOC,
  importSTEP,
  makeBox,
  measureVolume,
  type Drawing,
  type Shape3D,
} from 'replicad';
import { PITCH, type Key } from './layout';

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
   * Oś „do góry” komórki w pliku (strona płyty). Part1.STEP z SolidWorks ma ją wzdłuż +X.
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
export function footprint(keys: Key[], opts: PlateOptions): Drawing {
  let d: Drawing | null = null;
  for (const k of keys) {
    const r = drawRectangle(k.w * PITCH, k.h * PITCH).rotate(k.rot).translate(k.x, k.y);
    d = d ? d.fuse(r) : r;
  }
  if (!d) throw new Error('Brak klawiszy');
  if (opts.fillGaps > 0) d = d.offset(opts.fillGaps).offset(-opts.fillGaps);
  if (opts.margin > 0) d = d.offset(opts.margin);
  return d;
}

export function buildPlate(keys: Key[], cell: Cell, opts: PlateOptions = DEFAULT_PLATE_OPTIONS): Shape3D {
  const outline = footprint(keys, opts);
  const body = outline.sketchOnPlane('XY', -cell.height).extrude(cell.height) as Shape3D;
  const negatives = keys.map((k) =>
    cell.negative.clone().rotate(k.rot, [0, 0, 0], [0, 0, 1]).translate(k.x, k.y, 0),
  );
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
