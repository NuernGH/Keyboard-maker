// SPDX-License-Identifier: AGPL-3.0-or-later
// Wyspa na elektronikę (wariant A): pole obok wewnętrznej kolumny, drukowane razem z płytą.
// Na wierzchu leży moduł OLED 1,3" z enkoderem EC11 (płytka 65 × 35 mm), pod nim w kieszeni
// od spodu nice!nano v2 (18 × 33,3 mm) przy górnej krawędzi, z gniazdem USB-C równo ze ścianką.
// Wymiary modułu zmierzone z modelu referencyjnego Marcina (GrabCAD, tylko lokalnie);
// nice!nano z uproszczonego modelu w models/controllers. Tu same liczby, bez CAD.

import { PITCH, type SplitParams } from './layout';
import type { CellVariant } from './cell-spec';

export interface IslandParams {
  enabled: boolean;
  /** głębokość wyspy od górnej powierzchni płyty w dół (mm); musi zmieścić moduł i nice!nano */
  depth: number;
  /** przesunięcie wyspy względem domyślnej pozycji przy wewnętrznej kolumnie (mm) */
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_ISLAND: IslandParams = { enabled: true, depth: 10.5, offsetX: 0, offsetY: 0 };

export const ISLAND_W = 38;
export const ISLAND_H = 68;

/** Moduł OLED + EC11 ułożony pionowo: 35 mm w poprzek, 65 mm wzdłuż, enkoder u góry. */
export const MODULE = { w: 35, h: 65, pcb: 1.2, clearance: 0.2, underClearance: 2.5 };
export const NANO = { w: 18, h: 33.3, height: 4.8, clearance: 0.3, usbW: 10, usbH: 5.4, usbOverhang: 1.0 };

export interface Box {
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
 * Geometria wyspy dla lewej połówki; prawa to lustro w osi X (jak pozycje klawiszy).
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
  const D = Math.max(ip.depth, cellHeight);
  const inner = p.cols - 1;
  const x0 = inner * PITCH + PITCH / 2 + ip.offsetX;
  const y1 = (p.stagger[inner] ?? 0) + PITCH / 2 + ip.offsetY;
  const x1 = x0 + ISLAND_W;
  const y0 = y1 - ISLAND_H;
  const cx = (x0 + x1) / 2;

  const mw = MODULE.w + 2 * MODULE.clearance;
  const mh = MODULE.h + 2 * MODULE.clearance;
  const mTop = y1 - (ISLAND_H - mh) / 2;
  const mBot = mTop - mh;
  const mCy = (mTop + mBot) / 2;

  const nw = NANO.w + 2 * NANO.clearance;
  const nh = NANO.h + 2 * NANO.clearance;
  // nice!nano przy samej górnej krawędzi: gniazdo USB-C (wystaje 1 mm poza płytkę) kończy się
  // równo ze ścianką wyspy, więc kabel wchodzi od razu, bez kanału.
  const nTop = y1 - NANO.usbOverhang;
  const nCy = nTop - NANO.h / 2;

  const cuts: Box[] = [
    // gniazdo płytki modułu (płytka leży równo z wierzchem płyty)
    box(cx - mw / 2, mBot, -MODULE.pcb, cx + mw / 2, mTop, 1),
    // miejsce pod płytką na luty i nóżki elementów
    box(cx - mw / 2 + 2.5, mBot + 2.5, -MODULE.pcb - MODULE.underClearance, cx + mw / 2 - 2.5, mTop - 2.5, 0),
    // kieszeń nice!nano od spodu
    box(cx - nw / 2, nCy - nh / 2, -D - 1, cx + nw / 2, nCy + nh / 2, -D + NANO.usbH),
    // otwór na gniazdo USB-C w górnej ściance wyspy
    box(cx - NANO.usbW / 2, nCy, -D - 1, cx + NANO.usbW / 2, y1 + 1, -D + NANO.usbH),
  ];
  // przepusty na piny modułu: listwa 9 pinów przy dłuższym boku, 31–53 mm od góry modułu
  for (const s of [-1, 1]) {
    const px = cx + s * 15.5;
    cuts.push(box(px - 1.6, mTop - 53.5, -D - 1, px + 1.6, mTop - 31, 1));
  }
  // przy hot-swap kieszenie gniazd wewnętrznej kolumny wychodzą na bok komórki: zostawiamy im miejsce
  if (variant === 'hotswap') cuts.push(box(x0 - 0.01, y0 - 1, -cellHeight - 1, x0 + 2.5, y1 + 1, -cellHeight + 2.4));

  const ghosts: GhostPart[] = [
    { kind: 'nano', box: box(cx - NANO.w / 2, nTop - NANO.h, -D, cx + NANO.w / 2, nTop, -D + 1.6) },
    { kind: 'usb', box: box(cx - 4.5, nTop - 6.5, -D + 1.6, cx + 4.5, y1, -D + 4.8) },
    { kind: 'pcb', box: box(cx - MODULE.w / 2, mTop - MODULE.clearance - MODULE.h, -MODULE.pcb, cx + MODULE.w / 2, mTop - MODULE.clearance, 0) },
    { kind: 'display', box: box(cx - 11.5, mTop - 61, 0, cx + 11.5, mTop - 26, 3.1) },
    { kind: 'encoder', box: box(cx - 6, mTop - 18.9, 0, cx + 6, mTop - 4.4, 9.5) },
    { kind: 'knob', box: box(cx - 6.3, mTop - 18, 13.3, cx + 6.3, mTop - 5.3, 23.9) },
  ];

  const g: IslandGeom = { rect: { x0, y0, x1, y1 }, depth: D, cuts, ghosts };
  if (side === 'left') return g;
  return {
    rect: { x0: -x1, y0, x1: -x0, y1 },
    depth: D,
    cuts: cuts.map(mirrorBox),
    ghosts: ghosts.map((gp) => ({ ...gp, box: mirrorBox(gp.box) })),
  };
}
