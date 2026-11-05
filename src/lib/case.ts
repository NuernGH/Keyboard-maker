// SPDX-License-Identifier: AGPL-3.0-or-later
// Spód obudowy: wanna pod płytą. Ścianki otaczają płytę do jej górnej powierzchni, w środku
// zostaje miejsce na przewody, a płyta leży na słupkach i jest przykręcona od spodu śrubami M2,5.
// Tu same liczby (pozycje śrub, wymiary); bryłę buduje geometry.ts.

import { PITCH, type Key } from './layout';
import type { Box, IslandGeom } from './island';
import { DOVETAIL, distToSeam, seamScrewTargets, type PrintSplit } from './split';

export interface CaseParams {
  enabled: boolean;
  /** grubość ścianki (mm) */
  wall: number;
  /** luz między płytą a ścianką (mm) */
  gap: number;
  /** grubość dna (mm) */
  floor: number;
  /** wolne miejsce pod płytą i wyspą na przewody (mm) */
  space: number;
  /** liczba śrub na połówkę */
  screws: number;
  /** odsunięcie spodu od płyty w podglądzie (mm), żeby było widać oba elementy */
  explode: number;
}

export const DEFAULT_CASE: CaseParams = { enabled: true, wall: 2.4, gap: 0.3, floor: 3, space: 3, screws: 6, explode: 25 };

/** Śruby M2,5: otwór przelotowy w spodzie, łeb w wybraniu od dołu, w płycie otwór pilotowy. */
export const CASE_SCREW = { clearance: 2.9, head: 5.0, headDepth: 2.6, pilot: 2.2, boss: 6.5 };
/** Pas płyty wokół klawiszy, w którym są śruby (mm). Płyta dostaje co najmniej taki margines. */
export const SCREW_MARGIN = 6;
/** Odległość osi śruby od krawędzi klawisza (mm). */
const SCREW_INSET = SCREW_MARGIN / 2;
/** Minimalna odległość osi śruby od komórek i wyspy (otwór Ø2,2 plus ścianka). */
const SCREW_CLEAR = 2.9;
const STANDARD_LENGTHS = [6, 8, 10, 12, 14, 16, 20];

export interface CaseLayout {
  /** pozycje śrub w XY */
  screws: [number, number][];
  /** głębokość otworu pilotowego w płycie (mm) */
  pilotDepth: number;
  /** z górnej powierzchni dna */
  floorTop: number;
  /** z spodu obudowy */
  bottom: number;
  /** zalecana długość śrub (mm) */
  screwLength: number;
  /** wycięcia w ściance na gniazda USB */
  usbCuts: Box[];
  /** podkładki na dnie, które po przykręceniu dociskają kontroler do kieszeni */
  pads: Box[];
}

/** Luz między podkładką a płytką kontrolera (mm) i pas wolny od pinów przy dłuższych bokach. */
export const PAD = { gap: 0.2, pinBand: 4, end: 4 };

/**
 * Podkładka pod kontrolerem: od dna do 0,2 mm pod płytką, węższa o pasy z pinami i lutami
 * na dłuższych bokach, krótsza o 4 mm z każdego końca.
 */
export function controllerPads(island: IslandGeom | null, floorTop: number): Box[] {
  if (!island) return [];
  return island.ghosts
    .filter((g) => g.kind === 'nano')
    .map(({ box: b }) => {
      const along = b.y1 - b.y0 >= b.x1 - b.x0 ? 'y' : 'x';
      const ix = along === 'y' ? PAD.pinBand : PAD.end;
      const iy = along === 'y' ? PAD.end : PAD.pinBand;
      return { x0: b.x0 + ix, x1: b.x1 - ix, y0: b.y0 + iy, y1: b.y1 - iy, z0: floorTop - 0.01, z1: b.z0 - PAD.gap };
    })
    .filter((b) => b.z1 > b.z0 + 0.3 && b.x1 > b.x0 && b.y1 > b.y0);
}

/** Odległość punktu od prostokąta klawisza (0 w środku). */
function distToKey(k: Key, x: number, y: number): number {
  const a = (-k.rot * Math.PI) / 180;
  const dx = x - k.x;
  const dy = y - k.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const ex = Math.max(Math.abs(lx) - (k.w * PITCH) / 2, 0);
  const ey = Math.max(Math.abs(ly) - (k.h * PITCH) / 2, 0);
  return Math.hypot(ex, ey);
}

function distToRect(r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): number {
  const ex = Math.max(r.x0 - x, 0, x - r.x1);
  const ey = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(ex, ey);
}

/**
 * Pozycje śrub w pasie marginesu wokół klawiszy: kandydaci przy narożnikach i środkach boków
 * każdego klawisza, odsunięci o SCREW_INSET na zewnątrz. Zostają tylko ci, którzy nie trafiają
 * w żadną komórkę ani w wyspę; z nich wybieramy `count` jak najdalej od siebie.
 */
export function screwPositions(
  keys: Key[],
  island: IslandGeom | null,
  count: number,
  split: PrintSplit | null = null,
): [number, number][] {
  const s = SCREW_INSET;
  const cand: [number, number][] = [];
  for (const k of keys) {
    const hw = (k.w * PITCH) / 2;
    const hh = (k.h * PITCH) / 2;
    const a = (k.rot * Math.PI) / 180;
    const local: [number, number][] = [];
    for (const sx of [-1, 0, 1])
      for (const sy of [-1, 0, 1]) if (sx || sy) local.push([sx * (hw + s), sy * (hh + s)]);
    // wzdłuż długich klawiszy (spacja, Shift) co pół U, żeby śruby mogły stać blisko szwów
    for (let lx = -hw + PITCH / 2; lx < hw - 1e-6; lx += PITCH / 2)
      for (const sy of [-1, 1]) local.push([lx, sy * (hh + s)]);
    for (let ly = -hh + PITCH / 2; ly < hh - 1e-6; ly += PITCH / 2)
      for (const sx of [-1, 1]) local.push([sx * (hw + s), ly]);
    for (const [lx, ly] of local) cand.push([k.x + lx * Math.cos(a) - ly * Math.sin(a), k.y + lx * Math.sin(a) + ly * Math.cos(a)]);
  }
  const ok = cand.filter(
    ([x, y]) =>
      keys.every((k) => distToKey(k, x, y) >= SCREW_CLEAR - 1e-6) &&
      (!island || distToRect(island.rect, x, y) >= SCREW_CLEAR + 1) &&
      // przy podziale: z dala od szwu płyty i zamków (otwór pilotowy) i od szwu spodu (słupek)
      (!split ||
        (distToSeam(split, x, y) >= 3 + DOVETAIL.depth &&
          Math.abs(x - split.caseX) >= CASE_SCREW.boss / 2 + 1.5)),
  );
  if (!ok.length || count <= 0) return [];
  const picked: [number, number][] = [];
  const far = (p: [number, number], set: [number, number][]) => Math.min(...set.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  if (split) {
    // najpierw śruby po obu stronach obu szwów: łączą części płyty przez spód i części spodu przez płytę
    for (const t of seamScrewTargets(split, keys, SCREW_MARGIN)) {
      const near = ok.reduce((b, p) => (Math.hypot(p[0] - t[0], p[1] - t[1]) < Math.hypot(b[0] - t[0], b[1] - t[1]) ? p : b));
      if (Math.hypot(near[0] - t[0], near[1] - t[1]) < 25 && (!picked.length || far(near, picked) >= 10)) picked.push(near);
    }
  }
  // pierwsza śruba: najdalej od środka, kolejne: najdalej od już wybranych
  const cx = ok.reduce((a, p) => a + p[0], 0) / ok.length;
  const cy = ok.reduce((a, p) => a + p[1], 0) / ok.length;
  if (!picked.length) picked.push(ok.reduce((b, p) => (far(p, [[cx, cy]]) > far(b, [[cx, cy]]) ? p : b)));
  const total = split ? count + picked.length : count;
  while (picked.length < Math.min(total, ok.length)) {
    const next = ok.reduce((b, p) => (far(p, picked) > far(b, picked) ? p : b));
    if (far(next, picked) < 15) break;
    picked.push(next);
  }
  return picked;
}

/** Wycięcia w ściance obudowy na wtyki USB: otwory z wyspy przedłużone na zewnątrz i poszerzone na wtyk. */
export function usbCaseCuts(island: IslandGeom | null, cp: CaseParams): Box[] {
  if (!island) return [];
  const r = island.rect;
  const ext = cp.gap + cp.wall + 2;
  const plug = 2; // wtyk z obudową jest większy niż gniazdo
  const out: Box[] = [];
  for (const c of island.cuts) {
    if (c.round) continue;
    const up = c.y1 > r.y1 + 1e-6;
    const down = c.y0 < r.y0 - 1e-6;
    const right = c.x1 > r.x1 + 1e-6;
    const left = c.x0 < r.x0 - 1e-6;
    // tylko otwory od spodu wyspy, wychodzące jedną stroną (pas pod gniazda hot-swap wychodzi dwiema)
    if (!(up || down || right || left) || (up && down) || (left && right)) continue;
    if (c.z0 > -island.depth - 0.5) continue;
    const z0 = c.z0;
    const z1 = Math.min(c.z1 + plug, 0);
    if (up || down)
      out.push({ x0: c.x0 - plug, x1: c.x1 + plug, y0: up ? r.y1 - 0.5 : r.y0 - ext, y1: up ? r.y1 + ext : r.y0 + 0.5, z0, z1 });
    else out.push({ y0: c.y0 - plug, y1: c.y1 + plug, x0: right ? r.x1 - 0.5 : r.x0 - ext, x1: right ? r.x1 + ext : r.x0 + 0.5, z0, z1 });
  }
  return out;
}

export function caseLayout(
  keys: Key[],
  island: IslandGeom | null,
  cellHeight: number,
  cp: CaseParams,
  split: PrintSplit | null = null,
): CaseLayout {
  const lowest = Math.max(cellHeight, island?.depth ?? 0);
  const floorTop = -lowest - cp.space;
  const bottom = floorTop - cp.floor;
  const pilotDepth = Math.max(Math.min(6, cellHeight - 1.5), 2);
  // śruba od spodu: reszta dna pod łbem + słupek do płyty + wkręcenie w płytę
  const below = cp.floor - CASE_SCREW.headDepth + (-cellHeight - floorTop);
  const fit = STANDARD_LENGTHS.filter((l) => l - below >= 3 && l - below <= pilotDepth);
  const screwLength = fit.length ? fit[fit.length - 1] : Math.ceil(below + Math.min(4, pilotDepth));
  return {
    screws: screwPositions(keys, island, cp.screws, split),
    pilotDepth,
    floorTop,
    bottom,
    screwLength,
    usbCuts: usbCaseCuts(island, cp),
    pads: controllerPads(island, floorTop),
  };
}
