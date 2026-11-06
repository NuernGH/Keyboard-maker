// SPDX-License-Identifier: AGPL-3.0-or-later
// Spód obudowy: wanna pod płytą. Ścianki otaczają płytę do jej górnej powierzchni, w środku
// zostaje miejsce na przewody, a płyta leży brzegiem na gzymsie przy ściance i na słupkach
// w środku; jest przykręcona od spodu śrubami M2,5.
// Tu same liczby (pozycje śrub, wymiary); bryłę buduje geometry.ts.

import { PITCH, type Key } from './layout';
import { stabOffset } from './cell-spec';
import { USB_PLUG, type Box, type IslandGeom } from './island';
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
  /** podpory od dna do spodu płyty w środku klawiatury, żeby płyta nie uginała się przy nacisku */
  supports?: boolean;
  /** rozmiar śrub spodu; brak = M3 */
  screwSize?: ScrewSize;
  /**
   * Gzyms wzdłuż wewnętrznej ścianki: pas od dna do 0,1 mm pod spód płyty, na którym płyta
   * leży brzegiem. Wartość = ile mm gzyms wchodzi pod płytę (0 = bez gzymsu). Musi być
   * mniejsza niż margines płyty, żeby nie dotykał komórek.
   */
  ledge?: number;
  /**
   * Faza 45° na zewnętrznej górnej krawędzi ścianki (mm, 0 = ostra krawędź). Nad płytą zawsze
   * zostaje co najmniej CHAMFER.minLand mm płaskiej góry ścianki.
   */
  chamfer?: number;
  /**
   * Wzmocnienie u podstawy słupków pod śruby: faza 45° (lub zaokrąglenie) między słupkiem a dnem,
   * mm (0 = bez). Słupek nie urywa się przy dokręcaniu. Przycinane przez bossFilletSize.
   */
  bossFillet?: number;
  /** kształt wzmocnienia: faza 45° (domyślnie, wybór Marcina) albo zaokrąglenie */
  bossFilletKind?: 'fillet' | 'chamfer';
}

export const DEFAULT_CASE: CaseParams = {
  enabled: true,
  wall: 2.4,
  gap: 0.3,
  floor: 3,
  space: 3,
  screws: 6,
  explode: 25,
  supports: true,
  screwSize: 'M3',
  ledge: 4.5,
  chamfer: 1,
  bossFillet: 1.5,
  bossFilletKind: 'chamfer',
};

/** Faza górnej krawędzi: najmniej płaskiej góry ścianki, która zostaje przy płycie (mm). */
export const CHAMFER = { minLand: 0.8 };

/** Faza górnej krawędzi z parametrów, przycięta tak, żeby została płaska góra ścianki. */
export function chamferSize(cp: CaseParams): number {
  const c = Math.min(cp.chamfer ?? 0, cp.wall - CHAMFER.minLand);
  return c >= 0.2 ? c : 0;
}

/**
 * Wzmocnienie podstawy słupka: najwyżej `max` mm, co najmniej `minTop` mm prostego słupka nad nim
 * i co najmniej `belowParts` mm pod najniższą częścią pod płytą (wyspa, komórki), czyli r ≤ space − belowParts.
 */
export const BOSS_FILLET = { max: 3, minTop: 1, belowParts: 0.5 };

/**
 * Promień wzmocnienia podstawy słupka (mm) dla słupka o wysokości standH. Przy podziale spodu
 * do druku słupek stoi co najmniej sp.boss/2 + 1,5 mm od cięcia, więc kołnierz nie sięga cięcia.
 */
export function bossFilletSize(cp: CaseParams, standH: number): number {
  const r = Math.min(cp.bossFillet ?? 0, BOSS_FILLET.max, standH - BOSS_FILLET.minTop, cp.space - BOSS_FILLET.belowParts);
  return r >= 0.2 ? r : 0;
}

export type ScrewSize = 'M3' | 'M2.5';

/**
 * Wymiary pod śrubę spodu (mm): otwór przelotowy w spodzie, wybranie na łeb od dołu
 * (łeb walcowy z gniazdem, ISO 4762: M3 Ø5,5 × 3, M2,5 Ø4,5 × 2,5, plus luz), otwór pilotowy
 * w płycie do wkręcenia w plastik, średnica słupka pod płytą.
 */
export interface ScrewSpec {
  size: ScrewSize;
  clearance: number;
  head: number;
  headDepth: number;
  pilot: number;
  boss: number;
}

export const SCREW_SPECS: Record<ScrewSize, ScrewSpec> = {
  M3: { size: 'M3', clearance: 3.4, head: 6.0, headDepth: 3.2, pilot: 2.5, boss: 7.5 },
  'M2.5': { size: 'M2.5', clearance: 2.9, head: 5.0, headDepth: 2.6, pilot: 2.2, boss: 6.5 },
};

export const DEFAULT_SCREW: ScrewSize = 'M3';

export function screwSpec(size: ScrewSize | undefined = DEFAULT_SCREW): ScrewSpec {
  return SCREW_SPECS[size] ?? SCREW_SPECS[DEFAULT_SCREW];
}

/** Dactyl: głębokość wybrania na łeb w dnie; nad łbem zostaje co najmniej 1 mm dna (dociska je tuleja skorupy). */
export function dactylHeadDepth(sp: ScrewSpec, floor: number): number {
  return Math.max(Math.min(sp.headDepth, floor - 1), 0);
}

/** @deprecated wymiary M2,5; nowy kod bierze screwSpec(rozmiar). */
export const CASE_SCREW = SCREW_SPECS['M2.5'];
/** Pas płyty wokół klawiszy, w którym są śruby (mm). Płyta dostaje co najmniej taki margines. */
export const SCREW_MARGIN = 6;
/** Odległość osi śruby od krawędzi klawisza (mm). */
const SCREW_INSET = SCREW_MARGIN / 2;
/** Minimalna odległość osi śruby od komórek: promień otworu pilotowego plus ścianka ok. 1,65 mm. */
const screwClear = (sp: ScrewSpec) => Math.max(2.9, sp.pilot / 2 + 1.65);
const STANDARD_LENGTHS = [6, 8, 10, 12, 14, 16, 20];

export interface CaseLayout {
  /** wymiary śruby (otwory, łeb, słupek) */
  screw: ScrewSpec;
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
  /** podpory pod płytą (środki XY), od dna do 0,1 mm pod spód płyty */
  supports: [number, number][];
}

/** Luz między podkładką a płytką kontrolera (mm) i pas wolny od pinów przy dłuższych bokach. */
export const PAD = { gap: 0.2, pinBand: 4, end: 4 };

/**
 * Podkładka pod kontrolerem: od dna do 0,2 mm pod płytką, węższa o pasy z pinami i lutami
 * na dłuższych bokach, krótsza o 4 mm z każdego końca. Odwrócony kontroler jest przyklejony
 * (albo przykręcony) pod płytą, a pod nim są elementy, więc nie dostaje podkładki.
 */
export function controllerPads(island: IslandGeom | null, floorTop: number): Box[] {
  if (!island) return [];
  return island.ghosts
    .filter((g) => g.kind === 'nano' && !g.flip)
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
  sp: ScrewSpec = screwSpec(),
): [number, number][] {
  const s = SCREW_INSET;
  const clear = screwClear(sp);
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
      keys.every((k) => distToKey(k, x, y) >= clear - 1e-6) &&
      // słupek pod płytą nie może dotykać ścianek wyspy (schodzą niżej niż płyta)
      (!island || distToRect(island.rect, x, y) >= Math.max(clear + 1, sp.boss / 2 + 0.5)) &&
      // przy podziale: z dala od szwu płyty i zamków (otwór pilotowy) i od szwu spodu (słupek)
      (!split ||
        (distToSeam(split, x, y) >= 3 + DOVETAIL.depth &&
          Math.abs(x - split.caseX) >= sp.boss / 2 + 1.5)),
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
  // najniższy spód wtyku: środek gniazda USB minus połowa wysokości obudowy wtyku
  const plugBottom = Math.min(
    ...island.ghosts.filter((g) => g.kind === 'usb').map((g) => (g.box.z0 + g.box.z1) / 2 - USB_PLUG.h / 2),
    Infinity,
  );
  // najwyższy wierzch wtyku
  const plugTop = Math.max(
    ...island.ghosts.filter((g) => g.kind === 'usb').map((g) => (g.box.z0 + g.box.z1) / 2 + USB_PLUG.h / 2),
    -Infinity,
  );
  for (const c of island.cuts) {
    if (c.round) continue;
    const up = c.y1 > r.y1 + 1e-6;
    const down = c.y0 < r.y0 - 1e-6;
    const right = c.x1 > r.x1 + 1e-6;
    const left = c.x0 < r.x0 - 1e-6;
    // tylko otwory od spodu wyspy, wychodzące jedną stroną (pas pod gniazda hot-swap wychodzi dwiema)
    if (!(up || down || right || left) || (up && down) || (left && right)) continue;
    if (c.z0 > -island.depth - 0.5) continue;
    // ścianka wycięta też pod spodem wyspy, jeśli wtyk z obudową sięga niżej niż otwór w płycie
    // (gniazdo osadzone we wcięciu płytki leży nisko, np. nice!nano v2)
    const z0 = Math.min(c.z0, plugBottom);
    // cienki pasek nad otworem by się łamał: wtedy wycięcie otwarte od góry
    // (górę wycięcia wyznacza wierzch obudowy wtyku na wysokości gniazda)
    const top = Number.isFinite(plugTop) ? plugTop : c.z1 + plug;
    const z1 = top > -1.5 ? 0 : top;
    // otwór w płycie kończy się 1 mm za jej krawędzią (gniazdo USB równo z krawędzią płyty),
    // więc ściankę wycinamy od krawędzi płyty na zewnątrz, z miejscem na obudowę wtyku
    if (up || down)
      out.push({ x0: c.x0 - plug, x1: c.x1 + plug, y0: up ? c.y1 - 1.5 : c.y0 - ext, y1: up ? c.y1 + ext : c.y0 + 1.5, z0, z1 });
    else out.push({ y0: c.y0 - plug, y1: c.y1 + plug, x0: right ? c.x1 - 1.5 : c.x0 - ext, x1: right ? c.x1 + ext : c.x0 + 1.5, z0, z1 });
  }
  return out;
}

export function caseLayout(
  keys: Key[],
  island: IslandGeom | null,
  cellHeight: number,
  cp: CaseParams,
  split: PrintSplit | null = null,
  stabs: 'cherry' | 'mx' | 'none' = 'cherry',
): CaseLayout {
  const lowest = Math.max(cellHeight, island?.depth ?? 0);
  const floorTop = -lowest - cp.space;
  const bottom = floorTop - cp.floor;
  const sp = screwSpec(cp.screwSize);
  const pilotDepth = Math.max(Math.min(6, cellHeight - 1.5), 2);
  // śruba od spodu: reszta dna pod łbem + słupek do płyty + wkręcenie w płytę
  const below = cp.floor - sp.headDepth + (-cellHeight - floorTop);
  const fit = STANDARD_LENGTHS.filter((l) => l - below >= 3 && l - below <= pilotDepth);
  const screwLength = fit.length ? fit[fit.length - 1] : Math.ceil(below + Math.min(4, pilotDepth));
  const screws = screwPositions(keys, island, cp.screws, split, sp);
  return {
    screw: sp,
    screws,
    supports: cp.supports === false ? [] : supportPositions(keys, island, screws, split, stabs),
    pilotDepth,
    floorTop,
    bottom,
    screwLength,
    usbCuts: usbCaseCuts(island, cp),
    pads: controllerPads(island, floorTop),
  };
}

/** Gzyms: luz pod płytą, minimalny odstęp od komórek i od wyspy (mm). */
export const LEDGE = { gap: 0.1, fromCells: 1.5, fromIsland: 1, fromUsb: 2 };

/** Szerokość gzymsu pod płytą: z parametrów, ale nie bliżej komórek niż LEDGE.fromCells. */
export function ledgeWidth(cp: CaseParams, plateMargin: number): number {
  const w = Math.min(cp.ledge ?? 0, plateMargin - LEDGE.fromCells);
  return w > 0.3 ? w : 0;
}

/**
 * Obszary bez gzymsu (XY): wyspa (sięga niżej niż płyta) i otwory z wyspy wychodzące poza nią
 * (gniazdo USB z miejscem na wtyk) i cała droga wtyku do ścianki, żeby gzyms jej nie zasłaniał.
 */
export function ledgeKeepouts(island: IslandGeom | null, cellHeight: number, cp: CaseParams): Box[] {
  if (!island) return [];
  const r = island.rect;
  const out: Box[] = [];
  const g = LEDGE.fromIsland;
  if (island.depth > cellHeight - 1e-6) out.push({ x0: r.x0 - g, x1: r.x1 + g, y0: r.y0 - g, y1: r.y1 + g, z0: 0, z1: 0 });
  for (const c of island.cuts) {
    if (c.round) continue;
    const outside = c.x0 < r.x0 - 1e-6 || c.x1 > r.x1 + 1e-6 || c.y0 < r.y0 - 1e-6 || c.y1 > r.y1 + 1e-6;
    if (!outside || c.z0 > -cellHeight) continue; // tylko otwory schodzące pod płytę
    const u = LEDGE.fromUsb;
    out.push({ x0: c.x0 - u, x1: c.x1 + u, y0: c.y0 - u, y1: c.y1 + u, z0: 0, z1: 0 });
  }
  // droga wtyku od gniazda przez ściankę (te same wycięcia co w ściance, z zapasem)
  for (const b of usbCaseCuts(island, cp)) out.push({ ...b, x0: b.x0 - 0.5, x1: b.x1 + 0.5, y0: b.y0 - 0.5, y1: b.y1 + 0.5 });
  return out;
}

/** Podpory: średnica, odstęp od spodu płyty, minimalne odległości (mm). */
export const SUPPORT = { d: 4, gap: 0.1, spacing: 30, fromScrew: 12, fromEdge: 12 };

/**
 * Pozycje podpór: na granicach rzędów, w miejscach, gdzie krawędź klawisza dochodzi do
 * granicy (tam dno komórek jest pełne, a przewody kolumn idą przy pinach, nie przy krawędzi).
 * Pomija skrajne granice (tam są śruby), okolice kieszeni stabilizatorów, wyspę i szew spodu.
 * Wybór jak najdalej od siebie i od śrub, co najmniej co `spacing` mm.
 */
export function supportPositions(
  keys: Key[],
  island: IslandGeom | null,
  screws: [number, number][],
  split: PrintSplit | null,
  stabs: 'cherry' | 'mx' | 'none',
): [number, number][] {
  const flat = keys.filter((k) => Math.abs(k.rot) < 1e-6);
  if (flat.length < 2) return [];
  const r = SUPPORT.d / 2;
  const ys = [...new Set(flat.map((k) => Math.round((k.y - (k.h * PITCH) / 2) * 1000) / 1000))];
  const xs0 = Math.min(...flat.map((k) => k.x - (k.w * PITCH) / 2));
  const xs1 = Math.max(...flat.map((k) => k.x + (k.w * PITCH) / 2));
  const cand: [number, number][] = [];
  for (const yb of ys) {
    const above = flat.filter((k) => Math.abs(k.y - (k.h * PITCH) / 2 - yb) < 1e-3);
    const below = flat.filter((k) => Math.abs(k.y + (k.h * PITCH) / 2 - yb) < 1e-3);
    if (!above.length || !below.length) continue; // granica zewnętrzna
    for (const k of [...above, ...below])
      for (const sx of [-1, 1]) {
        const x = k.x + (sx * k.w * PITCH) / 2;
        if (x < xs0 + SUPPORT.fromEdge || x > xs1 - SUPPORT.fromEdge) continue;
        cand.push([x, yb]);
      }
  }
  const nearStab = (x: number, y: number) =>
    flat.some((k) => {
      const s = stabOffset(Math.max(k.w, k.h));
      if (s === null || stabs === 'none') return false;
      if (Math.abs(y - k.y) > (k.h * PITCH) / 2 + r + 0.01) return false;
      // kieszeń stabilizatora ±4,5 mm albo dodatkowa komórka MX (jej rogi są pełne, więc tylko kieszeń)
      return stabs === 'cherry' && [-s, s].some((d) => Math.abs(x - (k.x + d)) < 4.5 + r + 0.5);
    });
  const ok = cand.filter(
    ([x, y]) =>
      !nearStab(x, y) &&
      (!island || distToRect(island.rect, x, y) >= r + 3) &&
      (!split || Math.abs(x - split.caseX) >= r + 2) &&
      screws.every(([sx, sy]) => Math.hypot(sx - x, sy - y) >= SUPPORT.fromScrew),
  );
  const uniq = ok.filter((p, i) => ok.findIndex((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5) === i);
  if (!uniq.length) return [];
  const cx = (xs0 + xs1) / 2;
  const cy = uniq.reduce((a, p) => a + p[1], 0) / uniq.length;
  const picked: [number, number][] = [uniq.reduce((b, p) => (Math.hypot(p[0] - cx, p[1] - cy) < Math.hypot(b[0] - cx, b[1] - cy) ? p : b))];
  const dist = (p: [number, number]) => Math.min(...picked.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  for (;;) {
    const next = uniq.reduce((b, p) => (dist(p) > dist(b) ? p : b));
    if (dist(next) < SUPPORT.spacing) break;
    picked.push(next);
  }
  return picked;
}
