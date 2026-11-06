// SPDX-License-Identifier: AGPL-3.0-or-later
// Wyspa na elektronikę (wariant A): pole obok wewnętrznej kolumny, drukowane razem z płytą.
// Połówka z modułem: na wierzchu moduł OLED 1,3" z enkoderem EC11 (płytka 65 × 35 mm), pod nim
// w kieszeni od spodu kontroler przy górnej krawędzi, z gniazdem USB równo ze ścianką.
// Połówka bez modułu: mała wyspa na sam kontroler.
// Wymiary modułu zmierzone z modelu referencyjnego Marcina (GrabCAD, tylko lokalnie);
// kontrolery z modeli producentów, też tylko lokalnie. Tu same liczby, bez CAD.

import { PITCH, splitLeft, keyCorners, polysOverlap, type SplitParams } from './layout';
import type { CellVariant } from './cell-spec';

export type ControllerId = 'nicenano' | 'promicro-c' | 'promicro-micro' | 'kb2040' | 's2mini' | 'esp32s3';
export type ModuleSide = 'left' | 'right' | 'both' | 'none';
/**
 * Gdzie stoi wyspa: `inner` przy wewnętrznej kolumnie (split, prawa strona macropada),
 * `outer` po drugiej stronie, `top`/`bottom` nad lub pod siatką klawiszy (wyspa leży poziomo).
 */
export type IslandPosition = 'inner' | 'outer' | 'top' | 'bottom';

export interface Controller {
  name: string;
  /** szerokość i długość płytki (mm), długość wzdłuż osi Y, gniazdo USB u góry */
  w: number;
  h: number;
  /** wysokość razem z gniazdem USB */
  height: number;
  /** o ile gniazdo USB wystaje poza płytkę */
  usbOverhang: number;
  /** otwór na wtyk w ściance */
  usbW: number;
  usbH: number;
  /** środki gniazd USB względem środka płytki (mm); domyślnie jedno gniazdo na środku */
  ports?: number[];
  /** grubość płytki (mm), domyślnie 1,6 */
  pcb?: number;
  /**
   * spód gniazda USB nad spodem płytki (mm); domyślnie gniazdo leży na płytce (= pcb),
   * 0 = gniazdo osadzone we wcięciu płytki (mid-mount), spodem równo ze spodem płytki
   */
  usbZ0?: number;
  /** model do podglądu w public/ (X w poprzek, Y w górę, Z wzdłuż płytki, USB po stronie +Z) */
  model?: string;
  /**
   * Rzędy pinów (z modeli): odległości środków rzędów od osi płytki i zakres od pierwszego do ostatniego
   * pinu, mierzony od krawędzi płytki z USB. Domyślnie jeden rząd 1,27 mm od każdego dłuższego boku na całej długości.
   */
  pins?: { x: number[]; y0: number; y1: number };
  /** otwory montażowe: x od osi płytki (dla obu stron ±x), y od krawędzi płytki z USB, średnica */
  holes?: { x: number; y: number; d: number }[];
}

export const pcbOf = (c: Controller) => c.pcb ?? 1.6;
/** spód gniazda USB nad spodem płytki */
export const usbBottomOf = (c: Controller) => c.usbZ0 ?? pcbOf(c);
/** środek gniazda USB nad spodem płytki */
export const usbCenterOf = (c: Controller) => (usbBottomOf(c) + c.height) / 2;
/** Wtyk kabla USB-C razem z obudową (mm), z zapasem na grubsze kable. */
export const USB_PLUG = { w: 12.5, h: 7 };
/** Otwór na wtyk w ściance sięga tyle nad środek gniazda (jak przy płytce leżącej elementami do góry). */
const usbAbove = (c: Controller) => Math.max(c.usbH - usbCenterOf(c), USB_PLUG.h / 2 + 0.2);
/** Rzędy pinów kontrolera (z domyślnymi dla płytek bez pomiaru). */
export const pinsOf = (c: Controller) => c.pins ?? { x: [c.w / 2 - 1.27], y0: 1.27, y1: c.h - 1.27 };

/** Uproszczone wymiary kontrolerów (zmierzone z modeli, zaokrąglone w górę). */
export const CONTROLLERS: Record<ControllerId, Controller> = {
  // nice!nano v2 zmierzony suwmiarką przez Marcina (2026-11-06): 17,8 × 33,8 (razem z USB) × 3,3 (przy USB),
  // płytka 1,2. Zgodne z modelem Joe Scotto: płytka 33,0, USB-C wystaje 0,8. Gniazdo osadzone we wcięciu
  // płytki (mid-mount), wystaje ok. 0,2 pod spód płytki, więc góra gniazda 3,1 nad spodem płytki.
  // Podgląd: model Woovie (CC0) przeskalowany do tych wymiarów.
  // Piny (model Joe Scotto): rzędy ±7,62, od 3,8 do 31,7 mm od krawędzi z USB.
  nicenano: {
    name: 'nice!nano v2', w: 17.8, h: 33.0, height: 3.1, usbOverhang: 0.8, usbW: 10, usbH: 5.4, pcb: 1.2, usbZ0: -0.2,
    model: 'controllers/nice-nano-v2.stl', pins: { x: [7.62], y0: 3.79, y1: 31.73 },
  },
  // Pro Micro USB-C (model GrabCAD od Marcina, zgodny z modelem qwelyt/waddle): płytka 18,3 × 34,7 × 1,5,
  // USB-C na płytce, wystaje 1,5, razem 4,66.
  'promicro-c': { name: 'Pro Micro USB-C', w: 18.3, h: 34.7, height: 4.7, usbOverhang: 1.5, usbW: 10, usbH: 5.4, pcb: 1.5 },
  // Pro Micro micro-USB (modele GrabCAD i Joe Scotto): płytka 17,8 × 33,0, micro-USB na płytce, wystaje 1,57, razem 4,25.
  'promicro-micro': { name: 'Pro Micro micro-USB', w: 17.8, h: 33.0, height: 4.3, usbOverhang: 1.6, usbW: 9, usbH: 4.6 },
  kb2040: { name: 'Adafruit KB2040', w: 17.8, h: 33.0, height: 4.8, usbOverhang: 1.2, usbW: 10, usbH: 5.4 },
  // Wemos S2 mini (model GrabCAD od Marcina, obrys z rysunku wemos.cc): płytka 25,4 × 34,3 × 0,9, USB-C równo
  // z krawędzią, łapki 0,35 pod płytką (liczymy od spodu płytki), góra gniazda 4,12 nad spodem płytki.
  // Piny: dwa podwójne rzędy (±8,91 i ±11,45), od 8,7 do 26,5 mm od krawędzi z USB; dwa otwory Ø2,0
  // przy drugim końcu (±10,2, 30,45 od krawędzi z USB) na wkręty M2.
  s2mini: {
    name: 'Wemos S2 mini', w: 25.4, h: 34.3, height: 4.2, usbOverhang: 0, usbW: 10, usbH: 5.0, pcb: 0.9, usbZ0: 0,
    pins: { x: [8.91, 11.45], y0: 8.67, y1: 26.45 }, holes: [{ x: 10.2, y: 30.45, d: 2.0 }],
  },
  // ESP32-S3 DevKit, klon z dwoma USB-C (wersja Marcina, model GrabCAD „ESP32-S3-WROOM-1 Devkit”, N16R8):
  // płytka 28,3 × 57,0 × 1,5, rzędy pinów co 25,4; moduł z anteną wystaje 6,4 za drugi koniec płytki, więc
  // długość h liczy płytkę z modułem (63,4). Dwa USB-C (GCT USB4105) na płytce, środki −6,2 i +6,1,
  // wystają 0,73, góra 4,81 nad spodem płytki (wierzch modułu 5,45 mieści się w kieszeni: height + 0,6).
  // Oryginał Espressif v1.1 (25,4 × 62,74, dwa micro-USB) ma inne wymiary.
  // Piny: rzędy ±12,7, od 1,85 do 55,2 mm od krawędzi z USB.
  esp32s3: {
    name: 'ESP32-S3 DevKit (2 × USB-C)', w: 28.3, h: 63.4, height: 4.9, usbOverhang: 0.8, usbW: 10, usbH: 5.4, pcb: 1.5, ports: [-6.2, 6.1],
    pins: { x: [12.7], y0: 1.85, y1: 55.19 },
  },
};

export interface IslandParams {
  enabled: boolean;
  /** głębokość wyspy od górnej powierzchni płyty w dół (mm); musi zmieścić moduł i kontroler */
  depth: number;
  /** przesunięcie wyspy względem domyślnej pozycji przy wewnętrznej kolumnie (mm) */
  offsetX: number;
  offsetY: number;
  controller: ControllerId;
  /** na której połówce jest moduł OLED z enkoderem; druga dostaje małą wyspę na sam kontroler */
  moduleSide: ModuleSide;
  position?: IslandPosition;
  /**
   * Przy wyspie nad lub pod klawiszami: `edge` = USB wychodzi długą, zewnętrzną krawędzią wyspy
   * (od góry przy położeniu „góra”), `end` = USB wychodzi z krótkiego końca wyspy.
   */
  usbOut?: 'edge' | 'end';
  /** wyrównanie wzdłuż krawędzi siatki (macropad): do początku (lewo/góra), środka albo końca */
  align?: 'start' | 'center' | 'end';
  /**
   * Pochylenie modułu OLED z enkoderem (stopnie, 0 = płasko). Wyspa nad lub pod klawiszami
   * staje się klinem: krawędź przy klawiszach zostaje na wysokości płyty, tył się podnosi,
   * a ekran i pokrętło patrzą na piszącego.
   */
  tilt?: number;
  /**
   * Kierunek gniazda USB przy wyspie z klinem: `auto` = w tył, gdy kontroler mieści się w poprzek,
   * inaczej z końca wyspy po stronie wyrównania; `left`/`right` = z lewego/prawego końca
   * (kontroler wzdłuż wyspy); `back` = w tył (kontroler w poprzek; długi kontroler wydłuża wyspę do tyłu).
   */
  usbDir?: 'auto' | 'left' | 'right' | 'back';
  /**
   * Kontroler odwrócony: płaska strona płytki (bez elementów) przylega do płyty od spodu i jest
   * przyklejona (albo przykręcona, gdy płytka ma otwory, np. S2 mini). Elementy i gniazdo USB w dół.
   * Domyślnie włączone; false = elementami do góry, dociśnięty podkładką z dna obudowy.
   */
  flip?: boolean;
  /** przylutowane goldpiny: przy odwróconym kontrolerze rowki w płycie na końcówki pinów */
  pins?: boolean;
}

export const DEFAULT_ISLAND: IslandParams = {
  enabled: true,
  depth: 0,
  offsetX: 0,
  offsetY: 0,
  controller: 'nicenano',
  moduleSide: 'left',
  position: 'inner',
  usbOut: 'edge',
  usbDir: 'auto',
  align: 'center',
  flip: true,
  pins: false,
};

export const ISLAND_W = 38;
export const ISLAND_H = 68;
/** ścianka wokół kontrolera na wyspie bez modułu */
export const SMALL_WALL = 3;
/** minimalny odstęp wyspy od klawiszy kciuka (mm) */
export const KEY_GAP = 1;

/** Moduł OLED + EC11 ułożony pionowo: 35 mm w poprzek, 65 mm wzdłuż, enkoder u góry. */
export const MODULE = { w: 35, h: 65, pcb: 1.2, clearance: 0.2, underClearance: 2.5 };
/**
 * Otwory montażowe modułu odczytane z modelu STEP: 4 × Ø3,0 w rozstawie 59 × 29 mm.
 * Pod śruby M2,5: w wyspie otwór pilotowy Ø2,2 na wkręcenie w plastik (śruba M2,5 × 6).
 */
export const MODULE_HOLES = { dx: 29, dy: 59, pcbHole: 3.0, pilot: 2.2, depth: 6, boss: 6.5 };
export const CTRL_CLEARANCE = 0.3;
/** zgodność wstecz: nice!nano */
export const NANO = CONTROLLERS.nicenano;

export const hasModule = (ip: IslandParams, side: 'left' | 'right') =>
  ip.moduleSide === 'both' || ip.moduleSide === side;

/** Rozmiar wyspy w XY dla danej połówki. */
export function islandSize(ip: IslandParams, side: 'left' | 'right'): { w: number; h: number } {
  if (hasModule(ip, side)) return { w: ISLAND_W, h: ISLAND_H };
  const c = CONTROLLERS[ip.controller];
  return { w: c.w + 2 * CTRL_CLEARANCE + 2 * SMALL_WALL, h: c.h + c.usbOverhang + 2 * CTRL_CLEARANCE + SMALL_WALL + 2 };
}

export interface Box {
  /** true: walec wpisany w obrys pudełka (oś Z), np. otwór pod śrubę */
  round?: boolean;
  /** obrót bryły wokół osi X przechodzącej przez (y, z), w stopniach (klin modułu) */
  tilt?: { deg: number; y: number; z: number };
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export interface GhostPart {
  kind: 'nano' | 'usb' | 'pcb' | 'display' | 'encoder' | 'knob';
  box: Box;
  /** model kontrolera do podglądu (zamiast pudełek płytki i gniazda) */
  model?: string;
  /** płytka kontrolera odwrócona: elementy w dół, płaska strona na górze pudełka */
  flip?: boolean;
}

export interface IslandGeom {
  /** obrys wyspy w XY */
  rect: { x0: number; y0: number; x1: number; y1: number };
  depth: number;
  /** bryły do odjęcia (kieszenie, gniazdo, przepusty) */
  cuts: Box[];
  /** uproszczone bryły elektroniki do podglądu (nie trafiają do eksportu) */
  ghosts: GhostPart[];
  /**
   * Klin pod modułem: osobna część stawiana na płaskiej wyspie i przykręcana od spodu wyspy.
   * Podstawa ma `base` mm, wierzch to płaszczyzna przez linię (y = hingeY, z = base),
   * pochylona o `deg` wokół osi X (dodatni kąt podnosi stronę y > hingeY).
   */
  wedge?: {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
    deg: number;
    hingeY: number;
    base: number;
    /** bryły do odjęcia z klina (gniazdo modułu, otwory, przepusty, otwory pilotowe śrub) */
    cuts: Box[];
    /** śruby mocujące klin (XY), wkręcane od spodu wyspy */
    screws: [number, number][];
  };
}

/** Klin: grubość podstawy (mm) i śruby M2,5 od spodu wyspy (przelot, łeb w wybraniu, pilot w klinie). */
export const WEDGE = { base: 3, clearance: 2.9, head: 5.0, headDepth: 2.6, pilot: 2.2, pilotDepth: 6 };

/** Wysokość wierzchu klina nad płytą w punkcie y. */
export const wedgeZ = (w: NonNullable<IslandGeom['wedge']>, y: number) =>
  w.base + (y - w.hingeY) * Math.tan((w.deg * Math.PI) / 180);

/** Obrót punktu (y, z) wokół osi X przez (hingeY, hingeZ). */
export function tiltPoint(y: number, z: number, deg: number, hingeY = 0, hingeZ = 0): [number, number] {
  const a = (deg * Math.PI) / 180;
  const dy = y - hingeY;
  const dz = z - hingeZ;
  return [hingeY + dy * Math.cos(a) - dz * Math.sin(a), hingeZ + dy * Math.sin(a) + dz * Math.cos(a)];
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({
  x0: Math.min(x0, x1),
  y0: Math.min(y0, y1),
  z0: Math.min(z0, z1),
  x1: Math.max(x0, x1),
  y1: Math.max(y0, y1),
  z1: Math.max(z0, z1),
});

/** Otwory w ściance na każde gniazdo USB kontrolera (płytka na środku `cx`, ścianka na `edge`). */
const usbSlots = (c: Controller, cx: number, nTop: number, edge: number, D: number, z: CtrlZ): Box[] =>
  (c.ports ?? [0]).map((dx) => box(cx + dx - c.usbW / 2, nTop - 2, -D - 1, cx + dx + c.usbW / 2, edge + 1, z.slotTop));
const usbGhosts = (c: Controller, cx: number, nTop: number, edge: number, z: CtrlZ): GhostPart[] =>
  (c.ports ?? [0]).map((dx) => ({
    kind: 'usb' as const,
    box: box(cx + dx - 4.5, nTop - 6.5, z.usb[0], cx + dx + 4.5, edge, z.usb[1]),
  }));

/**
 * Materiał nad kontrolerem (mm od wierzchu płyty). Kontroler siedzi wysoko, tuż pod wierzchem,
 * żeby gniazdo USB było na wysokości ścianki obudowy i wyspa nie musiała być głębsza niż płyta.
 * Gdy nad nim leży płasko moduł OLED, schodzi pod gniazdo modułu.
 */
export const CTRL_ROOF = 2.5;
/** Rowki na końcówki goldpinów (głębokość w płycie, pół szerokości wokół środka rzędu). */
export const PIN_GROOVE = { depth: 2.5, half: 1.3 };
/** Wkręty M2 przez otwory płytki kontrolera: otwór pilotowy w płycie. */
export const CTRL_SCREW = { pilot: 1.7, depth: 3.5 };
/** Najcieńszy materiał nad wycięciem w dachu kieszeni (mm). */
const ROOF_SKIN = 1.0;

/** Szeroki kontroler (np. ESP32-S3 28,3 mm) sięga pod otwory na śruby modułu (rozstaw 29 mm). */
const wideCtrl = (c: Controller) => c.w / 2 + CTRL_CLEARANCE > MODULE_HOLES.dx / 2 - MODULE_HOLES.pilot / 2 - 0.5;

/** Jak wysoko nad płaską stroną odwróconej płytki sięgają wycięcia w dachu (rowki, wkręty, gniazdo USB). */
const flipUp = (c: Controller, pins: boolean) =>
  Math.max(pins ? PIN_GROOVE.depth : 0, c.holes?.length ? CTRL_SCREW.depth : 0, usbBottomOf(c) < 0 ? -usbBottomOf(c) + 0.2 : 0);

const ctrlRoof = (moduleFlatAbove: boolean, c: Controller, flip = false, pins = false) => {
  if (!flip) {
    if (!moduleFlatAbove) return CTRL_ROOF;
    const roof = MODULE.pcb + MODULE.underClearance + 1.4;
    // szeroki kontroler schodzi niżej, pod końce otworów pilotowych modułu
    return wideCtrl(c) ? Math.max(roof, MODULE.pcb + MODULE_HOLES.depth + 0.5) : roof;
  }
  // odwrócony: płytka przyklejona pod dachem; dach musi zmieścić rowki, wkręty i otwór na wtyk
  // (wtyk jest wyżej niż przy płytce elementami do góry, bo gniazdo jest tuż pod płaską stroną)
  const up = flipUp(c, pins);
  let roof = Math.max(CTRL_ROOF, up + ROOF_SKIN, usbAbove(c) - usbCenterOf(c) + 0.8);
  if (moduleFlatAbove) {
    roof = Math.max(roof, MODULE.pcb + MODULE.underClearance + 0.8 + up);
    if (wideCtrl(c)) roof = Math.max(roof, MODULE.pcb + MODULE_HOLES.depth + 0.5 + up);
  }
  return roof;
};

/** Położenie kontrolera w pionie (z = 0 to wierzch płyty). */
interface CtrlZ {
  flip: boolean;
  /** płytka: spód i wierzch */
  board: [number, number];
  /** gniazdo USB (podgląd) */
  usb: [number, number];
  /** górna krawędź otworu na wtyk w ściance */
  slotTop: number;
  /** strop kieszeni od spodu */
  pocketTop: number;
  /** najniższy punkt kontrolera z luzem (do głębokości wyspy) */
  lowest: number;
  /** płaska strona odwróconej płytki */
  face: number;
}

function ctrlZ(c: Controller, roof: number, flip: boolean): CtrlZ {
  const usbTop = Math.min(c.height, c.usbH - 0.4);
  if (!flip) {
    // płytka elementami do góry, luz 0,6 mm nad elementami
    const zN = -roof - 0.6 - c.height;
    return {
      flip,
      board: [zN, zN + pcbOf(c)],
      usb: [zN + usbBottomOf(c), zN + usbTop],
      slotTop: zN + c.usbH,
      pocketTop: zN + c.height + 0.6,
      lowest: zN,
      face: zN,
    };
  }
  const zF = -roof;
  return {
    flip,
    board: [zF - pcbOf(c), zF],
    usb: [zF - usbTop, zF - usbBottomOf(c)],
    slotTop: zF - usbCenterOf(c) + usbAbove(c),
    pocketTop: zF,
    lowest: zF - c.height - 0.6,
    face: zF,
  };
}

/**
 * Wycięcia w dachu nad odwróconą płytką, w układzie płytki: u w poprzek od osi, v od krawędzi z USB
 * w głąb płytki. `at` zamienia (u0, u1, v0, v1, z0, z1) na pudełko w układzie wyspy.
 */
function flipCuts(
  c: Controller,
  z: CtrlZ,
  pins: boolean,
  at: (u0: number, u1: number, v0: number, v1: number, z0: number, z1: number) => Box,
): Box[] {
  if (!z.flip) return [];
  const out: Box[] = [];
  const f = z.face;
  // gniazdo USB wystające ponad płaską stronę (nice!nano 0,2 mm): wnęka z luzem 0,2
  if (usbBottomOf(c) < 0)
    for (const dx of c.ports ?? [0]) out.push(at(dx - 4.8, dx + 4.8, -c.usbOverhang - 0.5, 7.5, f - 0.01, f - usbBottomOf(c) + 0.2));
  if (pins) {
    const p = pinsOf(c);
    const inner = Math.min(...p.x) - PIN_GROOVE.half;
    const outer = c.w / 2 + CTRL_CLEARANCE;
    for (const s of [-1, 1])
      out.push(at(s * inner, s * outer, p.y0 - PIN_GROOVE.half, p.y1 + PIN_GROOVE.half, f - 0.01, f + PIN_GROOVE.depth));
  }
  for (const h of c.holes ?? [])
    for (const s of [-1, 1]) {
      const r = CTRL_SCREW.pilot / 2;
      out.push({ ...at(s * h.x - r, s * h.x + r, h.y - r, h.y + r, f - 0.01, f + CTRL_SCREW.depth), round: true });
    }
  return out;
}

/** Kontroler w poprzek wyspy z modułem, USB w długiej krawędzi. */
const fitsAcross = (c: Controller) => c.h + c.usbOverhang + CTRL_CLEARANCE + 1 <= ISLAND_W;
/** Wolny pas wzdłuż tylnej krawędzi wyspy na śruby klina, gdy kontroler leży wzdłuż. */
const WEDGE_SCREW_BAND = 8;
/** Kontroler wzdłuż płaskiej wyspy pod klinem, USB z krótkiego końca. */
const fitsAlong = (c: Controller) =>
  c.h + c.usbOverhang + 2 * CTRL_CLEARANCE + 2 <= ISLAND_H && c.w + 2 * CTRL_CLEARANCE + 1 + WEDGE_SCREW_BAND <= ISLAND_W;

const mirrorBox = (b: Box): Box => ({ ...b, x0: -b.x1, x1: -b.x0 });

/**
 * Geometria wyspy dla danej połówki; prawa to lustro w osi X (jak pozycje klawiszy).
 * Przepusty na piny modułu są po obu stronach, więc moduł pasuje w obu połówkach.
 */
export function islandFor(
  p: SplitParams,
  ip: IslandParams,
  side: 'left' | 'right',
  variant: CellVariant,
  cellHeight: number,
  /** margines płyty wokół obrysu: kontroler przesuwamy o tyle na zewnątrz, żeby USB było przy krawędzi płyty */
  margin = 0,
): IslandGeom | null {
  if (!ip.enabled) return null;
  const ctrl = CONTROLLERS[ip.controller] ?? NANO;
  const mod = hasModule(ip, side);
  const { w: W, h: H } = islandSize(ip, side);
  // moduł płasko nad kontrolerem: przy klinie moduł jest na osobnej części, wyspa zostaje płaska
  const flatModule = mod && !((ip.position === 'top' || ip.position === 'bottom') && (ip.tilt ?? 0) > 0);
  // głębokość: tyle co płyta, chyba że kontroler pod płaskim modułem potrzebuje więcej
  const flip = ip.flip ?? true;
  const pins = flip && !!ip.pins;
  const D = Math.max(ip.depth, cellHeight, -ctrlZ(ctrl, ctrlRoof(flatModule, ctrl, flip, pins), flip).lowest);
  const pos = ip.position ?? 'inner';
  // długi kontroler (np. ESP32-S3) nie mieści się w poprzek poziomej wyspy z modułem: USB wtedy z końca.
  // Przy klinie moduł jest na osobnej części, więc kontroler może leżeć wzdłuż płaskiej wyspy.
  const dir = ip.usbDir ?? 'auto';
  const wedgeAlong = mod && (ip.tilt ?? 0) > 0 && (fitsAlong(ctrl) || dir === 'back');
  const edgeFits = !mod || fitsAcross(ctrl) || wedgeAlong;
  // z klinem także przy wyjściu USB z końca: kontroler wzdłuż wyspy (wyspa zostaje płaska)
  if ((pos === 'top' || pos === 'bottom') && (((ip.usbOut ?? 'edge') === 'edge' && edgeFits) || wedgeAlong)) {
    const g = edgeIsland(p, ip, ctrl, mod, D, variant, cellHeight, pos, margin, flip, pins);
    if (side === 'left') return g;
    return {
      rect: { ...g.rect, x0: -g.rect.x1, x1: -g.rect.x0 },
      depth: D,
      cuts: g.cuts.map(mirrorBox),
      ghosts: g.ghosts.map((gp) => ({ ...gp, box: mirrorBox(gp.box) })),
      wedge: g.wedge
        ? { ...g.wedge, x0: -g.wedge.x1, x1: -g.wedge.x0, cuts: g.wedge.cuts.map(mirrorBox), screws: g.wedge.screws.map(([x, y]) => [-x, y]) }
        : undefined,
    };
  }
  const inner = p.cols - 1;
  // przy innych położeniach liczymy wyspę w układzie lokalnym (lewy górny róg w 0,0), potem obracamy
  const local = pos !== 'inner';
  const x0 = local ? 0 : inner * PITCH + PITCH / 2 + ip.offsetX;
  const x1 = x0 + W;
  // Wyspa stoi przy górze wewnętrznej kolumny. Gdy płyta ma mało rzędów, dół wyspy wchodziłby
  // na klawisze kciuka, więc podnosimy ją, aż zostanie między nimi KEY_GAP luzu.
  let y1 = local ? 0 : (p.stagger[inner] ?? 0) + PITCH / 2 + ip.offsetY;
  if (!local && p.single) {
    // macropad: wyspa z boku wyrównana do góry, środka albo dołu siatki
    const { ky0, ky1 } = gridBounds(p);
    y1 = alongCenter(ky1, ky0, -H, ip.align) + H / 2 + ip.offsetY;
  }
  const keyPolys = local || p.single ? [] : splitLeft(p).map(keyCorners);
  const hits = (top: number) => {
    const r: [number, number][] = [[x0, top - H - KEY_GAP], [x1, top - H - KEY_GAP], [x1, top], [x0, top]];
    return keyPolys.some((k) => polysOverlap(k, r));
  };
  for (let i = 0; i < 400 && hits(y1); i++) y1 += 0.25;
  const y0 = y1 - H;
  const cx = (x0 + x1) / 2;

  const cw = ctrl.w + 2 * CTRL_CLEARANCE;
  // kontroler przy samej górnej krawędzi: gniazdo USB kończy się równo ze ścianką wyspy,
  // więc kabel wchodzi od razu, bez kanału
  // gniazdo USB kończy się równo z krawędzią płyty (wyspa + margines)
  const edgeY = y1 + margin;
  const nTop = edgeY - ctrl.usbOverhang;
  const nBot = nTop - ctrl.h;
  // moduł leży tu zawsze płasko nad kontrolerem (także przy pochyleniu, gdy nie ma klina)
  const z = ctrlZ(ctrl, ctrlRoof(mod, ctrl, flip, pins), flip);
  const Di = Math.max(D, -z.lowest);
  const ctrlCuts: Box[] = [
    // kieszeń kontrolera od spodu
    box(cx - cw / 2, nBot - CTRL_CLEARANCE, -Di - 1, cx + cw / 2, nTop + CTRL_CLEARANCE, z.pocketTop),
    // otwory na gniazda USB w górnej ściance wyspy
    ...usbSlots(ctrl, cx, nTop, edgeY, Di, z),
    // odwrócona płytka: rowki na piny, otwory na wkręty, wnęka na gniazdo
    ...flipCuts(ctrl, z, pins, (u0, u1, v0, v1, z0, z1) => box(cx + u0, nTop - v0, z0, cx + u1, nTop - v1, z1)),
  ];
  const ctrlGhosts: GhostPart[] = [
    { kind: 'nano', box: box(cx - ctrl.w / 2, nBot, z.board[0], cx + ctrl.w / 2, nTop, z.board[1]), model: ctrl.model, flip },
    ...usbGhosts(ctrl, cx, nTop, edgeY, z),
  ];

  const cuts: Box[] = [];
  const ghosts: GhostPart[] = [];
  if (mod) {
    const mw = MODULE.w + 2 * MODULE.clearance;
    const mh = MODULE.h + 2 * MODULE.clearance;
    const mTop = y1 - (H - mh) / 2;
    const mBot = mTop - mh;
    const mCy = (mTop + mBot) / 2;
    cuts.push(
      // gniazdo płytki modułu (płytka leży równo z wierzchem płyty)
      box(cx - mw / 2, mBot, -MODULE.pcb, cx + mw / 2, mTop, 1),
      // miejsce pod płytką na luty i nóżki elementów; przy końcach zostaje materiał pod śruby
      box(cx - mw / 2 + 2.5, mBot + MODULE_HOLES.boss, -MODULE.pcb - MODULE.underClearance, cx + mw / 2 - 2.5, mTop - MODULE_HOLES.boss, 0),
      ...ctrlCuts,
    );
    // otwory pilotowe pod 4 śruby M2,5
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const hx = cx + (sx * MODULE_HOLES.dx) / 2;
        const hy = mCy + (sy * MODULE_HOLES.dy) / 2;
        const r = MODULE_HOLES.pilot / 2;
        cuts.push({ ...box(hx - r, hy - r, -MODULE.pcb - MODULE_HOLES.depth, hx + r, hy + r, 0), round: true });
      }
    // przepusty na piny modułu: listwa 9 pinów przy dłuższym boku, 31–53 mm od góry modułu
    for (const s of [-1, 1]) {
      const px = cx + s * 15.5;
      cuts.push(box(px - 1.6, mTop - 53.5, -Di - 1, px + 1.6, mTop - 31, 1));
    }
    ghosts.push(
      ...ctrlGhosts,
      { kind: 'pcb', box: box(cx - MODULE.w / 2, mTop - MODULE.clearance - MODULE.h, -MODULE.pcb, cx + MODULE.w / 2, mTop - MODULE.clearance, 0) },
      { kind: 'display', box: box(cx - 11.5, mTop - 61, 0, cx + 11.5, mTop - 26, 3.1) },
      { kind: 'encoder', box: box(cx - 6, mTop - 18.9, 0, cx + 6, mTop - 4.4, 9.5) },
      { kind: 'knob', box: box(cx - 6.3, mTop - 18, 13.3, cx + 6.3, mTop - 5.3, 23.9) },
    );
  } else {
    cuts.push(...ctrlCuts);
    ghosts.push(...ctrlGhosts);
  }
  // Kanały na przewody rzędu w komórce hot-swap wychodzą na boki komórki, ale są otwarte od spodu:
  // przy wyspie przewód schodzi w dół, w miejsce na kable pod płytą, więc wyspa nie potrzebuje wnęki.
  void variant;

  let g: IslandGeom = { rect: { x0, y0, x1, y1 }, depth: Di, cuts, ghosts };
  if (local) g = place(g, pos, p, ip);
  if (side === 'left') return g;
  const { x0: gx0, x1: gx1 } = g.rect;
  return {
    rect: { ...g.rect, x0: -gx1, x1: -gx0 },
    depth: Di,
    cuts: g.cuts.map(mirrorBox),
    ghosts: g.ghosts.map((gp) => ({ ...gp, box: mirrorBox(gp.box) })),
  };
}

/** Obrys samej siatki klawiszy (bez dodatkowych klawiszy, żeby nie przesuwały wyspy). */
function gridBounds(p: SplitParams) {
  const pts = splitLeft(p)
    .filter((k) => !k.id.startsWith('e-'))
    .flatMap(keyCorners);
  return {
    kx0: Math.min(...pts.map((q) => q[0])),
    kx1: Math.max(...pts.map((q) => q[0])),
    ky0: Math.min(...pts.map((q) => q[1])),
    ky1: Math.max(...pts.map((q) => q[1])),
  };
}

/** Środek wyspy o długości `len` wzdłuż odcinka [a, b] przy danym wyrównaniu. */
const alongCenter = (a: number, b: number, len: number, align: IslandParams['align']) =>
  align === 'start' ? a + len / 2 : align === 'end' ? b - len / 2 : (a + b) / 2;

/**
 * Przenosi wyspę z układu lokalnego (bok przy klawiszach x = 0, USB na górze y = 0)
 * na wybrane miejsce przy siatce klawiszy. Obroty o 90° zostawiają pudełka pudełkami.
 */
function place(g: IslandGeom, pos: IslandPosition, p: SplitParams, ip: IslandParams): IslandGeom {
  const { kx0, kx1, ky0, ky1 } = gridBounds(p);
  const H = g.rect.y1 - g.rect.y0;
  const cx = alongCenter(kx0, kx1, H, ip.align);
  let f: (x: number, y: number) => [number, number];
  if (pos === 'outer') {
    // lustro: bok przy klawiszach po lewej stronie siatki, USB nadal u góry
    // (start = góra siatki, end = dół)
    const top = alongCenter(ky1, ky0, -H, ip.align) + H / 2;
    f = (x, y) => [kx0 - x, top + y];
  } else if (pos === 'top') {
    // obrót o 90° w lewo: bok przy klawiszach na dole wyspy, USB na lewym końcu
    f = (x, y) => [cx - H / 2 - y, ky1 + x];
  } else {
    // obrót o 90° w prawo: bok przy klawiszach u góry wyspy, USB na prawym końcu
    f = (x, y) => [cx + H / 2 + y, ky0 - x];
  }
  const tb = <T extends Box>(b: T): T => {
    const [ax, ay] = f(b.x0, b.y0);
    const [bx, by] = f(b.x1, b.y1);
    return {
      ...b,
      x0: Math.min(ax, bx) + ip.offsetX,
      x1: Math.max(ax, bx) + ip.offsetX,
      y0: Math.min(ay, by) + ip.offsetY,
      y1: Math.max(ay, by) + ip.offsetY,
    };
  };
  const r = tb({ x0: g.rect.x0, y0: g.rect.y0, z0: 0, x1: g.rect.x1, y1: g.rect.y1, z1: 0 });
  return {
    rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
    depth: g.depth,
    cuts: g.cuts.map(tb),
    ghosts: g.ghosts.map((gp) => ({ ...gp, box: tb(gp.box) })),
  };
}

/**
 * Wyspa leżąca poziomo nad (lub pod) siatką, z USB w długiej, zewnętrznej krawędzi.
 * Układ lokalny: x wzdłuż wyspy (0 = środek siatki), y od boku przy klawiszach (0) na zewnątrz.
 * Moduł leży poziomo, enkoder z lewej; kontroler pod modułem, w lewej części, między
 * śrubami a przepustami na piny.
 */
function edgeIsland(
  p: SplitParams,
  ip: IslandParams,
  ctrl: Controller,
  mod: boolean,
  D: number,
  variant: CellVariant,
  cellHeight: number,
  pos: 'top' | 'bottom',
  margin = 0,
  flip = false,
  pins = false,
): IslandGeom {
  const cw = ctrl.w + 2 * CTRL_CLEARANCE;
  const L = mod ? ISLAND_H : cw + 2 * SMALL_WALL;
  // głębokość części wyspy pod modułem (i klinem)
  const TW = mod ? ISLAND_W : ctrl.h + ctrl.usbOverhang + 2 * CTRL_CLEARANCE + SMALL_WALL + 2;
  const tilt = mod ? Math.max(0, Math.min(60, ip.tilt ?? 0)) : 0;
  const dir = tilt ? (ip.usbDir ?? 'auto') : 'auto';
  // długi kontroler w poprzek (USB w tył) pod klinem: wyspa wydłużona do tyłu, klin zostaje 38 mm
  const longBack = tilt > 0 && dir === 'back' && !fitsAcross(ctrl);
  const T = longBack ? ctrl.h + ctrl.usbOverhang + 2 * CTRL_CLEARANCE + 2 : TW;
  const mw = MODULE.w + 2 * MODULE.clearance; // w poprzek (y)
  const mh = MODULE.h + 2 * MODULE.clearance; // wzdłuż (x)
  const my = TW / 2;
  const mL = -mh / 2; // lewy koniec gniazda modułu (strona enkodera)
  const slotX0 = mL + 31;
  const slotX1 = mL + 53.5;
  // kontroler: przy samym module tuż przed przepustami, ale nie dalej niż do otworów na śruby
  let ccx = 0;
  if (mod) {
    const leftLimit = -MODULE_HOLES.dy / 2 + MODULE_HOLES.pilot / 2 + 1;
    ccx = Math.max(slotX0 - 1 - cw / 2, leftLimit + cw / 2);
  }
  // kontroler pod klinem leży wzdłuż wyspy, przy krawędzi od klawiszy, USB z krótkiego końca:
  // na życzenie (lewo/prawo) albo w trybie auto, gdy nie mieści się w poprzek lub wybrano USB z końca
  // (wtedy od strony wyrównania wyspy); przy tylnej krawędzi zostaje pas na śruby klina
  const along =
    mod &&
    tilt > 0 &&
    (((dir === 'left' || dir === 'right') && fitsAlong(ctrl)) || (dir === 'auto' && (!fitsAcross(ctrl) || ip.usbOut === 'end')));
  const z = ctrlZ(ctrl, ctrlRoof(mod && !tilt, ctrl, flip, pins), flip);
  const cuts: Box[] = [];
  const ghosts: GhostPart[] = [];
  if (!along) {
    // gniazdo USB równo z krawędzią płyty (wyspa + margines), kontroler wysoko pod wierzchem
    const edgeY = T + margin;
    const nTop = edgeY - ctrl.usbOverhang;
    const nBot = nTop - ctrl.h;
    cuts.push(
      box(ccx - cw / 2, nBot - CTRL_CLEARANCE, -D - 1, ccx + cw / 2, nTop + CTRL_CLEARANCE, z.pocketTop),
      ...usbSlots(ctrl, ccx, nTop, edgeY, D, z),
      ...flipCuts(ctrl, z, pins, (u0, u1, v0, v1, z0, z1) => box(ccx + u0, nTop - v0, z0, ccx + u1, nTop - v1, z1)),
    );
    ghosts.push(
      { kind: 'nano', box: box(ccx - ctrl.w / 2, nBot, z.board[0], ccx + ctrl.w / 2, nTop, z.board[1]), model: ctrl.model, flip },
      ...usbGhosts(ctrl, ccx, nTop, edgeY, z),
    );
  } else {
    const sx = dir === 'left' ? -1 : dir === 'right' ? 1 : ip.align === 'start' ? -1 : 1;
    const edgeX = L / 2 + margin;
    const nEnd = edgeX - ctrl.usbOverhang; // koniec płytki od strony USB (|x|)
    const nStart = nEnd - ctrl.h;
    const cy = 1 + cw / 2;
    const X = (a: number, b: number): [number, number] => (sx > 0 ? [a, b] : [-b, -a]);
    const [px0, px1] = X(nStart - CTRL_CLEARANCE, nEnd + CTRL_CLEARANCE);
    cuts.push(box(px0, cy - cw / 2, -D - 1, px1, cy + cw / 2, z.pocketTop));
    cuts.push(
      ...flipCuts(ctrl, z, pins, (u0, u1, v0, v1, z0, z1) => {
        const [a, b] = X(nEnd - v1, nEnd - v0);
        return box(a, cy + u0, z0, b, cy + u1, z1);
      }),
    );
    const [bx0, bx1] = X(nStart, nEnd);
    ghosts.push({ kind: 'nano', box: box(bx0, cy - ctrl.w / 2, z.board[0], bx1, cy + ctrl.w / 2, z.board[1]), model: ctrl.model, flip });
    for (const dy of ctrl.ports ?? [0]) {
      const [sx0, sx1] = X(nEnd - 2, edgeX + 1);
      cuts.push(box(sx0, cy + dy - ctrl.usbW / 2, -D - 1, sx1, cy + dy + ctrl.usbW / 2, z.slotTop));
      const [gx0, gx1] = X(nEnd - 6.5, edgeX);
      ghosts.push({ kind: 'usb', box: box(gx0, cy + dy - 4.5, z.usb[0], gx1, cy + dy + 4.5, z.usb[1]) });
    }
  }
  // elementy modułu w układzie pochylonym (przy tilt = 0 bez zmian)
  // przy klinie moduł leży na nim: wszystko, co dotyczy modułu, wycinamy z klina, nie z wyspy
  const zb0 = tilt ? WEDGE.base : 0;
  const T0 = { deg: tilt, y: 0, z: zb0 };
  const lift = <B extends Box>(b: B): B => ({ ...b, z0: b.z0 + zb0, z1: b.z1 + zb0 });
  const tl = <B extends Box>(b: B): B => (tilt ? { ...lift(b), tilt: T0 } : b);
  const wCuts: Box[] = [];
  const wScrews: [number, number][] = [];
  if (mod) {
    const firstModCut = cuts.length;
    cuts.push(
      box(mL, my - mw / 2, -MODULE.pcb, -mL, my + mw / 2, 1),
      box(mL + MODULE_HOLES.boss, my - mw / 2 + 2.5, -MODULE.pcb - MODULE.underClearance, -mL - MODULE_HOLES.boss, my + mw / 2 - 2.5, 0),
    );
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const hx = (sx * MODULE_HOLES.dy) / 2;
        const hy = my + (sy * MODULE_HOLES.dx) / 2;
        const r = MODULE_HOLES.pilot / 2;
        cuts.push({ ...box(hx - r, hy - r, -MODULE.pcb - MODULE_HOLES.depth, hx + r, hy + r, 0), round: true });
      }
    if (tilt) wCuts.push(...cuts.splice(firstModCut).map(tl));
    for (const sy of [-1, 1]) {
      const py = my + sy * 15.5;
      if (!tilt) cuts.push(box(slotX0, py - 1.6, -D - 1, slotX1, py + 1.6, 1));
      else {
        // przepust prostopadły do płytki na głębokość pinów, dalej pionowo w dół przez klin i wyspę
        const pinDepth = MODULE.pcb + 6;
        wCuts.push(tl(box(slotX0, py - 1.6, -pinDepth, slotX1, py + 1.6, 1)));
        const [yb, zb] = tiltPoint(py, zb0 - pinDepth + 0.5, tilt, 0, zb0);
        const drop = box(slotX0, yb - 1.6, -D - 1, slotX1, yb + 1.6, zb);
        cuts.push(drop);
        wCuts.push(drop);
      }
    }
    if (tilt) {
      // dwie śruby: w połowie głębokości klina (tam jest najgrubszy pod gniazdem modułu),
      // jedna za kieszenią kontrolera, druga za przepustami pinów; przy kontrolerze wzdłuż wyspy
      // w pasie przy tylnej krawędzi, za kieszenią kontrolera
      const sy = along ? TW - WEDGE_SCREW_BAND / 2 : TW / 2;
      // długi kontroler w poprzek zajmuje lewą część wyspy aż do przepustów: lewa śruba tuż za kieszenią
      const xs = longBack ? [ccx + cw / 2 + 5.5, slotX1 + 4.5] : [mL + 4.5, slotX1 + 4.5];
      for (const sx of xs) {
        wScrews.push([sx, sy]);
        const c = WEDGE.clearance / 2;
        const h = WEDGE.head / 2;
        cuts.push({ ...box(sx - c, sy - c, -D - 1, sx + c, sy + c, 1), round: true });
        cuts.push({ ...box(sx - h, sy - h, -D - 1, sx + h, sy + h, -D + WEDGE.headDepth), round: true });
        const pr = WEDGE.pilot / 2;
        wCuts.push({ ...box(sx - pr, sy - pr, -1, sx + pr, sy + pr, WEDGE.pilotDepth), round: true });
      }
    }
    const pL = mL + MODULE.clearance;
    const firstModGhost = ghosts.length;
    ghosts.push(
      { kind: 'pcb', box: box(pL, my - MODULE.w / 2, -MODULE.pcb, pL + MODULE.h, my + MODULE.w / 2, 0) },
      { kind: 'display', box: box(mL + 26, my - 11.5, 0, mL + 61, my + 11.5, 3.1) },
      { kind: 'encoder', box: box(mL + 4.4, my - 6, 0, mL + 18.9, my + 6, 9.5) },
      { kind: 'knob', box: box(mL + 5.3, my - 6.3, 13.3, mL + 18, my + 6.3, 23.9) },
    );
    for (let i = firstModGhost; i < ghosts.length; i++) ghosts[i] = { ...ghosts[i], box: tl(ghosts[i].box) };
  }

  // przeniesienie na siatkę: nad nią (y w górę) albo pod nią (y w dół)
  const { kx0, kx1, ky0, ky1 } = gridBounds(p);
  // USB w lewo/prawo: wyspa dosunięta do tej krawędzi klawiatury, żeby gniazdo wyszło na brzeg płyty
  const align = along && dir === 'left' ? 'start' : along && dir === 'right' ? 'end' : ip.align;
  const cx = alongCenter(kx0, kx1, L, align) + ip.offsetX;
  // oś obrotu klina: krawędź wyspy przy klawiszach; pod siatką y jest odbite, więc kąt zmienia znak
  const hingeY = (pos === 'top' ? ky1 : ky0) + ip.offsetY;
  const tiltOut = (b: Box): Box['tilt'] =>
    b.tilt ? { deg: pos === 'top' ? b.tilt.deg : -b.tilt.deg, y: hingeY, z: b.tilt.z } : undefined;
  const tb = <B extends Box>(b: B): B =>
    pos === 'top'
      ? { ...b, x0: cx + b.x0, x1: cx + b.x1, y0: ky1 + b.y0 + ip.offsetY, y1: ky1 + b.y1 + ip.offsetY, tilt: tiltOut(b) }
      : { ...b, x0: cx + b.x0, x1: cx + b.x1, y0: ky0 - b.y1 + ip.offsetY, y1: ky0 - b.y0 + ip.offsetY, tilt: tiltOut(b) };
  const r = tb(box(-L / 2, 0, 0, L / 2, T, 0));
  const wr = tb(box(-L / 2, 0, 0, L / 2, TW, 0));
  return {
    rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
    depth: D,
    cuts: cuts.map(tb),
    ghosts: ghosts.map((gp) => ({ ...gp, box: tb(gp.box) })),
    wedge: tilt
      ? {
          x0: wr.x0,
          x1: wr.x1,
          y0: wr.y0,
          y1: wr.y1,
          deg: pos === 'top' ? tilt : -tilt,
          hingeY,
          base: WEDGE.base,
          cuts: wCuts.map(tb),
          screws: wScrews.map(([x, y]) => {
            const b = tb(box(x, y, 0, x, y, 0));
            return [b.x0, b.y0] as [number, number];
          }),
        }
      : undefined,
  };
}
