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
}

export const pcbOf = (c: Controller) => c.pcb ?? 1.6;
/** spód gniazda USB nad spodem płytki */
export const usbBottomOf = (c: Controller) => c.usbZ0 ?? pcbOf(c);
/** środek gniazda USB nad spodem płytki */
export const usbCenterOf = (c: Controller) => (usbBottomOf(c) + c.height) / 2;
/** Wtyk kabla USB-C razem z obudową (mm), z zapasem na grubsze kable. */
export const USB_PLUG = { w: 12.5, h: 7 };

/** Uproszczone wymiary kontrolerów (zmierzone z modeli, zaokrąglone w górę). */
export const CONTROLLERS: Record<ControllerId, Controller> = {
  // nice!nano v2 wg modelu Woovie (CC0): płytka 17,78 × 33,10 × 0,8, USB-C 8,99 × 3,2 we wcięciu płytki,
  // spodem równo ze spodem płytki, wystaje 1,52. Grubość płytki i wysokość USB do sprawdzenia suwmiarką.
  nicenano: { name: 'nice!nano v2', w: 17.78, h: 33.1, height: 3.2, usbOverhang: 1.52, usbW: 10, usbH: 5.4, pcb: 0.8, usbZ0: 0, model: 'controllers/nice-nano-v2.stl' },
  // Pro Micro USB-C (model GrabCAD od Marcina, zgodny z modelem qwelyt/waddle): płytka 18,3 × 34,7 × 1,5,
  // USB-C na płytce, wystaje 1,5, razem 4,66.
  'promicro-c': { name: 'Pro Micro USB-C', w: 18.3, h: 34.7, height: 4.7, usbOverhang: 1.5, usbW: 10, usbH: 5.4, pcb: 1.5 },
  // Pro Micro micro-USB (modele GrabCAD i Joe Scotto): płytka 17,8 × 33,0, micro-USB na płytce, wystaje 1,57, razem 4,25.
  'promicro-micro': { name: 'Pro Micro micro-USB', w: 17.8, h: 33.0, height: 4.3, usbOverhang: 1.6, usbW: 9, usbH: 4.6 },
  kb2040: { name: 'Adafruit KB2040', w: 17.8, h: 33.0, height: 4.8, usbOverhang: 1.2, usbW: 10, usbH: 5.4 },
  // Wemos S2 mini (model GrabCAD od Marcina, obrys z rysunku wemos.cc): płytka 25,4 × 34,3 × 0,9, USB-C równo
  // z krawędzią, łapki 0,35 pod płytką (liczymy od spodu płytki), góra gniazda 4,12 nad spodem płytki.
  s2mini: { name: 'Wemos S2 mini', w: 25.4, h: 34.3, height: 4.2, usbOverhang: 0, usbW: 10, usbH: 5.0, pcb: 0.9, usbZ0: 0 },
  // ESP32-S3 DevKit, klon z dwoma USB-C (wersja Marcina, model GrabCAD „ESP32-S3-WROOM-1 Devkit”, N16R8):
  // płytka 28,3 × 57,0 × 1,5, rzędy pinów co 25,4; moduł z anteną wystaje 6,4 za drugi koniec płytki, więc
  // długość h liczy płytkę z modułem (63,4). Dwa USB-C (GCT USB4105) na płytce, środki −6,2 i +6,1,
  // wystają 0,73, góra 4,81 nad spodem płytki (wierzch modułu 5,45 mieści się w kieszeni: height + 0,6).
  // Oryginał Espressif v1.1 (25,4 × 62,74, dwa micro-USB) ma inne wymiary.
  esp32s3: { name: 'ESP32-S3 DevKit (2 × USB-C)', w: 28.3, h: 63.4, height: 4.9, usbOverhang: 0.8, usbW: 10, usbH: 5.4, pcb: 1.5, ports: [-6.2, 6.1] },
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
  align: 'center',
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
const usbSlots = (c: Controller, cx: number, nTop: number, edge: number, D: number, zN: number): Box[] =>
  (c.ports ?? [0]).map((dx) => box(cx + dx - c.usbW / 2, nTop - 2, -D - 1, cx + dx + c.usbW / 2, edge + 1, zN + c.usbH));
const usbGhosts = (c: Controller, cx: number, nTop: number, edge: number, zN: number): GhostPart[] =>
  (c.ports ?? [0]).map((dx) => ({
    kind: 'usb' as const,
    box: box(cx + dx - 4.5, nTop - 6.5, zN + usbBottomOf(c), cx + dx + 4.5, edge, zN + Math.min(c.height, c.usbH - 0.4)),
  }));

/**
 * Materiał nad kontrolerem (mm od wierzchu płyty). Kontroler siedzi wysoko, tuż pod wierzchem,
 * żeby gniazdo USB było na wysokości ścianki obudowy i wyspa nie musiała być głębsza niż płyta.
 * Gdy nad nim leży płasko moduł OLED, schodzi pod gniazdo modułu.
 */
export const CTRL_ROOF = 2.5;
const ctrlRoof = (moduleFlatAbove: boolean, c?: Controller) => {
  if (!moduleFlatAbove) return CTRL_ROOF;
  const roof = MODULE.pcb + MODULE.underClearance + 1.4;
  // szeroki kontroler (np. ESP32-S3 28,3 mm) sięga pod otwory na śruby modułu (rozstaw 29 mm):
  // wtedy kontroler schodzi niżej, pod końce otworów pilotowych
  const wide = c && c.w / 2 + CTRL_CLEARANCE > MODULE_HOLES.dx / 2 - MODULE_HOLES.pilot / 2 - 0.5;
  return wide ? Math.max(roof, MODULE.pcb + MODULE_HOLES.depth + 0.5) : roof;
};
/** Spód płytki kontrolera (z) przy danym dachu; luz 0,6 mm nad elementami. */
const ctrlBottom = (c: Controller, roof: number) => -roof - 0.6 - c.height;

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
  const D = Math.max(ip.depth, cellHeight, -ctrlBottom(ctrl, ctrlRoof(flatModule, ctrl)));
  const pos = ip.position ?? 'inner';
  // długi kontroler (np. ESP32-S3) nie mieści się w poprzek poziomej wyspy z modułem: USB wtedy z końca
  const edgeFits = !mod || ctrl.h + ctrl.usbOverhang + CTRL_CLEARANCE + 1 <= ISLAND_W;
  if ((pos === 'top' || pos === 'bottom') && (ip.usbOut ?? 'edge') === 'edge' && edgeFits) {
    const g = edgeIsland(p, ip, ctrl, mod, D, variant, cellHeight, pos, margin);
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
  const zN = Math.max(-D, ctrlBottom(ctrl, ctrlRoof(mod, ctrl)));
  const pocketTop = zN + ctrl.height + 0.6;
  const ctrlCuts: Box[] = [
    // kieszeń kontrolera od spodu
    box(cx - cw / 2, nBot - CTRL_CLEARANCE, -D - 1, cx + cw / 2, nTop + CTRL_CLEARANCE, pocketTop),
    // otwory na gniazda USB w górnej ściance wyspy
    ...usbSlots(ctrl, cx, nTop, edgeY, D, zN),
  ];
  const ctrlGhosts: GhostPart[] = [
    { kind: 'nano', box: box(cx - ctrl.w / 2, nBot, zN, cx + ctrl.w / 2, nTop, zN + pcbOf(ctrl)), model: ctrl.model },
    ...usbGhosts(ctrl, cx, nTop, edgeY, zN),
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
      cuts.push(box(px - 1.6, mTop - 53.5, -D - 1, px + 1.6, mTop - 31, 1));
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

  let g: IslandGeom = { rect: { x0, y0, x1, y1 }, depth: D, cuts, ghosts };
  if (local) g = place(g, pos, p, ip);
  if (side === 'left') return g;
  const { x0: gx0, x1: gx1 } = g.rect;
  return {
    rect: { ...g.rect, x0: -gx1, x1: -gx0 },
    depth: D,
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
): IslandGeom {
  const cw = ctrl.w + 2 * CTRL_CLEARANCE;
  const L = mod ? ISLAND_H : cw + 2 * SMALL_WALL;
  const T = mod ? ISLAND_W : ctrl.h + ctrl.usbOverhang + 2 * CTRL_CLEARANCE + SMALL_WALL + 2;
  const mw = MODULE.w + 2 * MODULE.clearance; // w poprzek (y)
  const mh = MODULE.h + 2 * MODULE.clearance; // wzdłuż (x)
  const my = T / 2;
  const mL = -mh / 2; // lewy koniec gniazda modułu (strona enkodera)
  const slotX0 = mL + 31;
  const slotX1 = mL + 53.5;
  // kontroler: przy samym module tuż przed przepustami, ale nie dalej niż do otworów na śruby
  let ccx = 0;
  if (mod) {
    const leftLimit = -MODULE_HOLES.dy / 2 + MODULE_HOLES.pilot / 2 + 1;
    ccx = Math.max(slotX0 - 1 - cw / 2, leftLimit + cw / 2);
  }
  const tilt = mod ? Math.max(0, Math.min(60, ip.tilt ?? 0)) : 0;
  // gniazdo USB równo z krawędzią płyty (wyspa + margines), kontroler wysoko pod wierzchem
  const edgeY = T + margin;
  const nTop = edgeY - ctrl.usbOverhang;
  const nBot = nTop - ctrl.h;
  const zN = Math.max(-D, ctrlBottom(ctrl, ctrlRoof(mod && !tilt, ctrl)));
  const pocketTop = zN + ctrl.height + 0.6;
  const cuts: Box[] = [
    box(ccx - cw / 2, nBot - CTRL_CLEARANCE, -D - 1, ccx + cw / 2, nTop + CTRL_CLEARANCE, pocketTop),
    ...usbSlots(ctrl, ccx, nTop, edgeY, D, zN),
  ];
  const ghosts: GhostPart[] = [
    { kind: 'nano', box: box(ccx - ctrl.w / 2, nBot, zN, ccx + ctrl.w / 2, nTop, zN + pcbOf(ctrl)), model: ctrl.model },
    ...usbGhosts(ctrl, ccx, nTop, edgeY, zN),
  ];
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
      // jedna za kieszenią kontrolera, druga za przepustami pinów
      const sy = T / 2;
      for (const sx of [mL + 4.5, slotX1 + 4.5]) {
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
  const cx = alongCenter(kx0, kx1, L, ip.align) + ip.offsetX;
  // oś obrotu klina: krawędź wyspy przy klawiszach; pod siatką y jest odbite, więc kąt zmienia znak
  const hingeY = (pos === 'top' ? ky1 : ky0) + ip.offsetY;
  const tiltOut = (b: Box): Box['tilt'] =>
    b.tilt ? { deg: pos === 'top' ? b.tilt.deg : -b.tilt.deg, y: hingeY, z: b.tilt.z } : undefined;
  const tb = <B extends Box>(b: B): B =>
    pos === 'top'
      ? { ...b, x0: cx + b.x0, x1: cx + b.x1, y0: ky1 + b.y0 + ip.offsetY, y1: ky1 + b.y1 + ip.offsetY, tilt: tiltOut(b) }
      : { ...b, x0: cx + b.x0, x1: cx + b.x1, y0: ky0 - b.y1 + ip.offsetY, y1: ky0 - b.y0 + ip.offsetY, tilt: tiltOut(b) };
  const r = tb(box(-L / 2, 0, 0, L / 2, T, 0));
  return {
    rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
    depth: D,
    cuts: cuts.map(tb),
    ghosts: ghosts.map((gp) => ({ ...gp, box: tb(gp.box) })),
    wedge: tilt
      ? {
          x0: r.x0,
          x1: r.x1,
          y0: r.y0,
          y1: r.y1,
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
