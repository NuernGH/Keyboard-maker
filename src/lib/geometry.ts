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
  draw,
  drawRectangle,
  getOC,
  importSTEP,
  makeBox,
  makeCylinder,
  measureVolume,
  type Shape3D,
} from 'replicad';
import { PITCH, outlineSpots, switchSpots, type Key } from './layout';
import { wedgeZ, type Box, type IslandGeom } from './island';
import { LEDGE, SUPPORT, bossFilletSize, chamferSize, ledgeKeepouts, ledgeWidth, screwSpec, type ScrewSpec, type CaseLayout, type CaseParams } from './case';
import { CASE_DOVETAIL, leftRegion, type PrintSplit } from './split';
import type { ExtrasLayout } from './case-extras';
import { caseFeetParts } from './feet-geometry';

import {
  DEFAULT_PLATE_OPTIONS,
  MX_HOLE,
  NO_HOTSWAP_HEIGHT,
  PCB_LEVEL,
  PLATE_LIP,
  stabOffset,
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
    // przełączniki w miejscu stabilizatora mogą wystawać poza klawisz (Backspace 2U): obrys je obejmuje
    for (const [x, y] of outlineSpots(k, opts.stabs))
      if (Math.hypot(x - k.x, y - k.y) > 1e-6) d = d.fuse(drawRectangle(PITCH, PITCH).rotate(k.rot).translate(x, y));
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
  const stabs = opts.stabs ?? 'cherry';
  const negatives: Shape3D[] = [];
  for (const k of keys) {
    for (const [x, y] of switchSpots(k, stabs))
      negatives.push(cell.negative.clone().rotate(k.rot, [0, 0, 0], [0, 0, 1]).translate(x, y, 0));
  }
  if (island) for (const b of island.cuts) negatives.push(boxSolid(b));
  if (stabs === 'cherry') for (const k of keys) negatives.push(...stabCuts(k, cell.height));
  negatives.push(...pilots);
  return cutMany(body, negatives);
}

/** Pudełko (albo walec) z wyspy jako bryła, z obrotem klina, jeśli jest. */
export function boxSolid(b: Box): Shape3D {
  let sh = b.round
    ? (makeCylinder((b.x1 - b.x0) / 2, b.z1 - b.z0, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0], [0, 0, 1]) as Shape3D)
    : makeBox([b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1]);
  if (b.tilt) sh = sh.rotate(b.tilt.deg, [0, b.tilt.y, b.tilt.z], [1, 0, 0]) as Shape3D;
  return sh;
}

/**
 * Klin pod moduł OLED z enkoderem: osobna część stawiana na płaskiej wyspie. Przekrój to
 * podstawa `base` mm i trójkąt nad nią (krawędź przy klawiszach na wysokości podstawy).
 * Drukuje się podstawą w dół, bez podpór.
 */
export function buildWedge(island: IslandGeom): Shape3D {
  const w = island.wedge;
  if (!w) throw new Error('Wyspa nie ma klina');
  const zA = wedgeZ(w, w.y0);
  const zB = wedgeZ(w, w.y1);
  // w układzie płaszczyzny YZ: pierwsza współrzędna to y, druga z
  const pts: [number, number][] = [[w.y0, 0], [w.y1, 0], [w.y1, zB], [w.y0, zA]];
  let pen = draw(pts[0]);
  for (const p of pts.slice(1)) pen = pen.lineTo(p);
  const body = pen.close().sketchOnPlane('YZ', w.x0).extrude(w.x1 - w.x0) as Shape3D;
  return cutMany(body, w.cuts.map(boxSolid));
}

/**
 * Wycięcia na stabilizator Cherry/Costar montowany w płycie, dla klawisza od 2U.
 * W warstwie płyty (1,27 mm) otwór wg specyfikacji Cherry (6,75 × 12,3 z wycięciami na zatrzaski
 * i drut). Pod nią kieszeń na obudowę stabilizatora przez całą wysokość i kanał na drut
 * łączący obie obudowy, do poziomu PCB (5,08 mm), więc dno komórki z gniazdem zostaje nietknięte.
 * Drut jest od strony użytkownika (dół klawisza).
 */
export function stabCuts(k: Key, cellHeight: number): Shape3D[] {
  const vertical = k.h > k.w;
  const s = stabOffset(vertical ? k.h : k.w);
  if (s === null) return [];
  const h = cellHeight;
  const thin = h <= PLATE_LIP + 0.5;
  const out: Shape3D[] = [];
  const b = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => out.push(makeBox([x0, y0, z0], [x1, y1, z1]));
  const zt = -h - 1;
  for (const sx of [-1, 1]) {
    const c = sx * s;
    // otwór w płycie (w układzie z osią Y w górę: drut na dole)
    b(c - 3.375, -6.77, zt, c + 3.375, 5.53, 1);
    b(c - 1.65, -7.97, zt, c + 1.65, -6.7, 1);
    // wycięcie na zatrzask po zewnętrznej stronie
    b(sx > 0 ? c + 3.3 : c - 4.2, -0.5, zt, sx > 0 ? c + 4.2 : c - 3.3, 2.3, 1);
    if (!thin) b(c - 4.5, -8.4, zt, c + 4.5, 6.6, -PLATE_LIP);
  }
  if (!thin) {
    const zb = h <= PCB_LEVEL + 0.01 ? zt : -PCB_LEVEL;
    b(-s, -8.4, zb, s, -5.2, -PLATE_LIP);
  }
  const rot = k.rot + (vertical ? 90 : 0);
  return out.map((sh) => sh.rotate(rot, [0, 0, 0], [0, 0, 1]).translate(k.x, k.y, 0) as Shape3D);
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
export function screwPilots(
  screws: [number, number][],
  cellHeight: number,
  depth: number,
  sp: ScrewSpec = screwSpec(),
): Shape3D[] {
  return screws.map(
    ([x, y]) => makeCylinder(sp.pilot / 2, depth + 0.5, [x, y, -cellHeight - 0.5], [0, 0, 1]) as Shape3D,
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
  // faza zewnętrznej górnej krawędzi: przed wycięciem wnętrza górna ściana ma tylko obrys zewnętrzny
  const ch = chamferSize(cp);
  if (ch > 0) body = body.chamfer(ch, (e) => e.inPlane('XY', 0)) as Shape3D;
  const cavity = inner.sketchOnPlane('XY', floorTop).extrude(-floorTop + 1) as Shape3D;
  body = body.cut(cavity) as Shape3D;
  const sp = layout.screw ?? screwSpec(cp.screwSize);
  const standH = -cellHeight - floorTop;
  const fr = bossFilletSize(cp, standH);
  const collars: Shape3D[] = [];
  for (const [x, y] of layout.screws)
    if (standH > 0.01) {
      body = body.fuse(makeCylinder(sp.boss / 2, standH + 0.01, [x, y, floorTop - 0.01], [0, 0, 1]) as Shape3D) as Shape3D;
      if (fr > 0) collars.push(bossCollar(sp.boss / 2, fr, cp.bossFilletKind ?? 'chamfer', x, y, floorTop));
    }
  if (collars.length) {
    // słupek przy zaokrąglonym narożniku: kołnierz przechodzi przez ściankę, więc przycinamy go
    // do zewnętrznego obrysu (to, co w ściance, zlewa się z nią; z zewnątrz ścianka zostaje gładka)
    const clip = outer.sketchOnPlane('XY', floorTop - 1).extrude(fr + 2) as Shape3D;
    const all = collars.slice(1).reduce((u, c) => u.fuse(c) as Shape3D, collars[0]);
    body = body.fuse(all.intersect(clip) as Shape3D) as Shape3D;
  }
  for (const b of layout.pads ?? []) body = body.fuse(makeBox([b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1])) as Shape3D;
  // podpory pod płytą: od dna do 0,1 mm pod spód płyty
  const supH = -cellHeight - SUPPORT.gap - floorTop;
  if (supH > 0.3)
    for (const [x, y] of layout.supports ?? [])
      body = body.fuse(makeCylinder(SUPPORT.d / 2, supH + 0.01, [x, y, floorTop - 0.01], [0, 0, 1]) as Shape3D) as Shape3D;
  const ledge = buildLedge(outline, island, cellHeight, cp, opts.margin, floorTop, layout.extras?.keepouts ?? []);
  if (ledge) body = body.fuse(ledge) as Shape3D;
  // składane nóżki w dnie (opcja): pogrubienie dna, kieszenie z zatrzaskiem, kieszenie na stopki
  const feet = caseFeetParts(layout.feet);
  for (const a of feet.add) body = body.fuse(a) as Shape3D;
  const tools: Shape3D[] = [...feet.cut];
  // łeb M3 (3,2 mm) bywa głębszy niż dno, wtedy wybranie wchodzi w słupek; bez słupka zostaw 0,6 mm dna
  const headDepth = layout.headDepth ?? Math.min(sp.headDepth, cp.floor - 0.6 + Math.max(standH, 0));
  for (const [x, y] of layout.screws) {
    tools.push(makeCylinder(sp.clearance / 2, -bottom + 1, [x, y, bottom - 0.5], [0, 0, 1]) as Shape3D);
    tools.push(makeCylinder(sp.head / 2, headDepth + 0.5, [x, y, bottom - 0.5], [0, 0, 1]) as Shape3D);
  }
  for (const b of layout.usbCuts) tools.push(makeBox([b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1]));
  // dodatki: szczelina włącznika, otwór gniazda, kieszenie w dnie (bateria, zanurzone części)
  tools.push(...extraCaseCuts(layout.extras));
  const out = tools.length ? cutMany(body, tools) : body;
  return feet.after.reduce((u, b) => u.fuse(b) as Shape3D, out);
}

/** Wycięcia dodatków w spodzie obudowy: ścianka (prostopadłościany, walce) i kieszenie w dnie. */
export function extraCaseCuts(ex: ExtrasLayout | undefined): Shape3D[] {
  if (!ex) return [];
  const out: Shape3D[] = [];
  for (const c of ex.wallCuts)
    out.push(c.type === 'box' ? boxSolid(c.box) : (makeCylinder(c.r, c.len, c.from, c.dir) as Shape3D));
  for (const b of ex.floorPockets) out.push(boxSolid(b));
  return out;
}

/** Kieszenie dodatków od spodu płyty (korpus włącznika, gniazda), do odjęcia przy budowie płyty. */
export function extraPlatePockets(ex: ExtrasLayout | undefined): Shape3D[] {
  return (ex?.platePockets ?? []).map(boxSolid);
}

/**
 * Kołnierz u podstawy słupka (bryła obrotowa wokół osi słupka): pierścień od promienia słupka r0
 * do r0 + r na dnie, zwężający się do r0 na wysokości r. Zaokrąglenie (wklęsły łuk styczny
 * do dna i słupka) albo faza 45°. Zaczyna się 0,01 mm w dnie i w słupku, żeby fuzja była czysta.
 */
export function bossCollar(r0: number, r: number, kind: 'fillet' | 'chamfer', x: number, y: number, z: number): Shape3D {
  const a = r0 - 0.01;
  let pen = draw([a, -0.01]).lineTo([r0 + r, -0.01]).lineTo([r0 + r, 0]);
  pen = kind === 'fillet' ? pen.threePointsArcTo([r0, r], [r0 + r - r * Math.SQRT1_2, r - r * Math.SQRT1_2]) : pen.lineTo([r0, r]);
  const solid = pen.lineTo([a, r]).close().sketchOnPlane('XZ').revolve() as Shape3D;
  return solid.translate([x, y, z]) as Shape3D;
}

/**
 * Gzyms: pas od wnętrza ścianki (0,5 mm w ściankę, żeby nie było wspólnych ścian przy fuzji)
 * do `w` mm pod płytą, od dna do 0,1 mm pod spód płyty. Bez wyspy i drogi wtyku USB.
 */
export function buildLedge(
  outline: Drawing,
  island: IslandGeom | null,
  cellHeight: number,
  cp: CaseParams,
  plateMargin: number,
  floorTop: number,
  extra: Box[] = [],
): Shape3D | null {
  const w = ledgeWidth(cp, plateMargin);
  const top = -cellHeight - LEDGE.gap;
  if (w <= 0 || top - floorTop < 0.3) return null;
  const z0 = floorTop - 0.01;
  let ring = outline.offset(cp.gap + 0.5).sketchOnPlane('XY', z0).extrude(top - z0) as Shape3D;
  ring = ring.cut(outline.offset(-w).sketchOnPlane('XY', z0 - 1).extrude(top - z0 + 2) as Shape3D) as Shape3D;
  const keep = ledgeKeepouts(island, cellHeight, cp, extra).map((b) => makeBox([b.x0, b.y0, z0 - 1], [b.x1, b.y1, top + 1]) as Shape3D);
  return keep.length ? cutMany(ring, keep) : ring;
}

/** Pryzmat z wielokąta XY, od z0 do z1. */
function prism(poly: [number, number][], z0: number, z1: number, grow = 0): Shape3D {
  let pen = draw(poly[0]);
  for (const p of poly.slice(1)) pen = pen.lineTo(p);
  let d: Drawing = pen.close();
  if (grow) d = d.offset(grow);
  return d.sketchOnPlane('XY', z0).extrude(z1 - z0) as Shape3D;
}

/**
 * Część płyty po podziale do druku: 0 = lewa (z wypustami zamków), 1 = prawa (z gniazdami).
 * Lewa jest zwężona o 1/3 luzu, z prawej wycinamy obszar poszerzony o 2/3 luzu, więc
 * płaszczyzna cięcia nie pokrywa się ze ściankami komórek.
 */
export function platePiece(plate: Shape3D, split: PrintSplit, clearance: number, piece: 0 | 1): Shape3D {
  const bb = plate.boundingBox.bounds;
  const z0 = bb[0][2] - 1;
  const z1 = bb[1][2] + 1;
  const poly = leftRegion(split);
  if (piece === 0) return plate.clone().intersect(prism(poly, z0, z1, -clearance / 3)) as Shape3D;
  return plate.clone().cut(prism(poly, z0, z1, (2 * clearance) / 3)) as Shape3D;
}

/**
 * Część spodu obudowy po cięciu prostym w x = caseX. Z `tabs` w dnie (od spodu do floorTop)
 * zostają zamki na jaskółczy ogon: wypust na lewej części zwężony o 1/3 luzu, gniazdo
 * w prawej poszerzone o 2/3 luzu, jak w płycie.
 */
export function casePiece(
  shell: Shape3D,
  caseX: number,
  piece: 0 | 1,
  tabs: { ys: number[]; floorTop: number; clearance: number } | null = null,
): Shape3D {
  const bb = shell.boundingBox.bounds;
  const lo: [number, number, number] = [bb[0][0] - 1, bb[0][1] - 1, bb[0][2] - 1];
  const hi: [number, number, number] = [bb[1][0] + 1, bb[1][1] + 1, bb[1][2] + 1];
  if (piece === 0) hi[0] = caseX;
  else lo[0] = caseX;
  const half = shell.clone().intersect(makeBox(lo, hi)) as Shape3D;
  if (!tabs || !tabs.ys.length) return half;
  const z0 = bb[0][2] - 1;
  const { depth, neck, head } = CASE_DOVETAIL;
  const prisms = tabs.ys.map((y) => {
    const poly: [number, number][] = [
      [caseX - 1, y + neck / 2],
      [caseX, y + neck / 2],
      [caseX + depth, y + head / 2],
      [caseX + depth, y - head / 2],
      [caseX, y - neck / 2],
      [caseX - 1, y - neck / 2],
    ];
    return piece === 0 ? prism(poly, z0, tabs.floorTop, -tabs.clearance / 3) : prism(poly, z0, tabs.floorTop + 0.5, (2 * tabs.clearance) / 3);
  });
  if (piece === 0) {
    const extra = prisms.map((p) => shell.clone().intersect(p) as Shape3D);
    return extra.reduce((u, e) => u.fuse(e) as Shape3D, half);
  }
  return cutMany(half, prisms);
}
