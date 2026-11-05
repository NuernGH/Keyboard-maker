// SPDX-License-Identifier: AGPL-3.0-or-later
// Wyspa na elektronikę (wariant A): pole obok wewnętrznej kolumny, drukowane razem z płytą.
// Połówka z modułem: na wierzchu moduł OLED 1,3" z enkoderem EC11 (płytka 65 × 35 mm), pod nim
// w kieszeni od spodu kontroler przy górnej krawędzi, z gniazdem USB równo ze ścianką.
// Połówka bez modułu: mała wyspa na sam kontroler.
// Wymiary modułu zmierzone z modelu referencyjnego Marcina (GrabCAD, tylko lokalnie);
// kontrolery z modeli producentów, też tylko lokalnie. Tu same liczby, bez CAD.

import { PITCH, splitLeft, keyCorners, polysOverlap, type SplitParams } from './layout';
import type { CellVariant } from './cell-spec';

export type ControllerId = 'nicenano' | 'promicro-c' | 'promicro-micro' | 'kb2040' | 's2mini';
export type ModuleSide = 'left' | 'right' | 'both' | 'none';

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
}

/** Uproszczone wymiary kontrolerów (zmierzone z modeli, zaokrąglone w górę). */
export const CONTROLLERS: Record<ControllerId, Controller> = {
  nicenano: { name: 'nice!nano v2', w: 18, h: 33.3, height: 4.8, usbOverhang: 1.0, usbW: 10, usbH: 5.4 },
  'promicro-c': { name: 'Pro Micro USB-C', w: 18.3, h: 29.5, height: 4.7, usbOverhang: 6.7, usbW: 10, usbH: 5.4 },
  'promicro-micro': { name: 'Pro Micro micro-USB', w: 17.8, h: 29.2, height: 4.3, usbOverhang: 5.4, usbW: 9, usbH: 4.6 },
  kb2040: { name: 'Adafruit KB2040', w: 17.8, h: 33.0, height: 4.8, usbOverhang: 1.2, usbW: 10, usbH: 5.4 },
  s2mini: { name: 'Wemos S2 mini', w: 25.4, h: 34.3, height: 4.1, usbOverhang: 0, usbW: 10, usbH: 5.0 },
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
}

export const DEFAULT_ISLAND: IslandParams = {
  enabled: true,
  depth: 10.5,
  offsetX: 0,
  offsetY: 0,
  controller: 'nicenano',
  moduleSide: 'left',
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
}

export interface IslandGeom {
  /** obrys wyspy w XY */
  rect: { x0: number; y0: number; x1: number; y1: number };
  depth: number;
  /** bryły do odjęcia (kieszenie, gniazdo, przepusty) */
  cuts: Box[];
  /** uproszczone bryły elektroniki do podglądu (nie trafiają do eksportu) */
  ghosts: GhostPart[];
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({
  x0: Math.min(x0, x1),
  y0: Math.min(y0, y1),
  z0: Math.min(z0, z1),
  x1: Math.max(x0, x1),
  y1: Math.max(y0, y1),
  z1: Math.max(z0, z1),
});

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
): IslandGeom | null {
  if (!ip.enabled) return null;
  const ctrl = CONTROLLERS[ip.controller] ?? NANO;
  const mod = hasModule(ip, side);
  const { w: W, h: H } = islandSize(ip, side);
  const D = Math.max(ip.depth, cellHeight, ctrl.height + 1.5);
  const inner = p.cols - 1;
  const x0 = inner * PITCH + PITCH / 2 + ip.offsetX;
  const x1 = x0 + W;
  // Wyspa stoi przy górze wewnętrznej kolumny. Gdy płyta ma mało rzędów, dół wyspy wchodziłby
  // na klawisze kciuka, więc podnosimy ją, aż zostanie między nimi KEY_GAP luzu.
  let y1 = (p.stagger[inner] ?? 0) + PITCH / 2 + ip.offsetY;
  const keyPolys = splitLeft(p).map(keyCorners);
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
  const nTop = y1 - ctrl.usbOverhang;
  const nBot = nTop - ctrl.h;
  const pocketTop = -D + ctrl.height + 0.6;
  const ctrlCuts: Box[] = [
    // kieszeń kontrolera od spodu
    box(cx - cw / 2, nBot - CTRL_CLEARANCE, -D - 1, cx + cw / 2, nTop + CTRL_CLEARANCE, pocketTop),
    // otwór na gniazdo USB w górnej ściance wyspy
    box(cx - ctrl.usbW / 2, nTop - 2, -D - 1, cx + ctrl.usbW / 2, y1 + 1, -D + ctrl.usbH),
  ];
  const ctrlGhosts: GhostPart[] = [
    { kind: 'nano', box: box(cx - ctrl.w / 2, nBot, -D, cx + ctrl.w / 2, nTop, -D + 1.6) },
    { kind: 'usb', box: box(cx - 4.5, nTop - 6.5, -D + 1.6, cx + 4.5, y1, -D + Math.min(ctrl.height, ctrl.usbH - 0.4)) },
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
  // przy hot-swap kieszenie gniazd wewnętrznej kolumny wychodzą na bok komórki: zostawiamy im miejsce
  if (variant === 'hotswap') cuts.push(box(x0 - 0.01, y0 - 1, -cellHeight - 1, x0 + 2.5, y1 + 1, -cellHeight + 2.4));

  const g: IslandGeom = { rect: { x0, y0, x1, y1 }, depth: D, cuts, ghosts };
  if (side === 'left') return g;
  return {
    rect: { x0: -x1, y0, x1: -x0, y1 },
    depth: D,
    cuts: cuts.map(mirrorBox),
    ghosts: ghosts.map((gp) => ({ ...gp, box: mirrorBox(gp.box) })),
  };
}
