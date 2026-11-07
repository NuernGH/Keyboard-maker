// SPDX-License-Identifier: AGPL-3.0-or-later
// Składane nóżki pod spodem płaskiej obudowy (opcja, domyślnie wyłączona).
//
// Nóżka wciskana bez osi z filamentu: dwa sprężyste ramiona (kształt W) z półokrągłymi czopami.
// Czopy wjeżdżają po rampach w kieszeni i wskakują w gniazda w ściankach. Złożona nóżka trzyma się
// na zatrzasku: dwa języczki w ściankach kieszeni (szczeliny obok) z guzkiem, który wchodzi w dołek
// z boku nóżki. Rozłożona opiera się o tylną ściankę kieszeni (ok. 98°), ciężar dociska ją do ścianki.
//
// Dwa tryby:
//  - 'bar': listwa przykręcana na istniejące tylne śruby (obudowa bez zmian), z przodu podkładki
//    tej samej grubości na narożnych śrubach. Kieszenie są w listwie.
//  - 'pocket': kieszenie w dnie spodu (dno pogrubione od środka), szeroki rozstaw nóżek,
//    4 gumowe stopki w płytkich kieszeniach.
// Wymiary sprawdzone wydrukiem (2026-11-07): nóżka v1 + schodek pod paznokieć zamiast rowka.
// Tu same liczby i rozmieszczenie; bryły buduje feet-geometry.ts.

import { keyCorners, type Key } from './layout';
import type { Box, IslandGeom } from './island';
import type { PrintSplit } from './split';

export type FeetMode = 'none' | 'bar' | 'pocket';

export interface FeetParams {
  mode: FeetMode;
  /** listwa i podkładki z występami w wybrania na łby w spodzie (brak = tak); bez nich obie strony płaskie */
  pegs?: boolean;
}

/**
 * Nóżka w układzie własnym: oś zawiasu = oś X przez (y = 0, z = 0), nóżka złożona leży w kierunku −y,
 * strona z = −thick/2 patrzy na zewnątrz (do blatu).
 */
export const LEG = {
  width: 24,
  thick: 3.2,
  /** od osi do końca nóżki */
  len: 12,
  /** sprężyste ramiona przy osi: szerokość, szczelina obok, koniec szczeliny (y) */
  arm: 2,
  slot: 1,
  armY0: -8,
  /** czopy: promień, ile wystają poza bok ramienia, długość części walcowej (reszta to półkula) */
  nubR: 1.2,
  nubOut: 0.8,
  nubCyl: 0.4,
  /** schodek pod paznokieć na końcu od spodu: szerokość, długość, głębokość */
  step: { w: 10, l: 2.5, d: 1 },
} as const;

/** Kieszeń na nóżkę (od powierzchni, z której nóżka wychodzi, w głąb materiału). */
export const POCKET = {
  /** szerokość (luz 0,2 mm na stronę) */
  width: 24.4,
  depth: 3.5,
  /** materiał nad kieszenią */
  ceiling: 1.2,
  /** luz przed końcem nóżki */
  front: 0.5,
  /** tylna ścianka: luz za nóżką, przy którym nóżka zatrzymuje się na ok. 98° */
  stopGap: 0.28,
  /** gniazdo czopu w ściance: promień, głębokość */
  socketR: 1.3,
  socketD: 1,
  /** rampa wjazdowa pod czopem: głębokość przy wejściu, połowa szerokości (y) */
  ramp: 0.9,
  rampHalf: 1.3,
  /** wycięcie na palec przed nóżką: promień, głębokość */
  notchR: 5,
  notchD: 2.5,
} as const;

/** Zatrzask złożonej nóżki: języczek w ściance (szczelina obok), guzek na nim, dołek w nóżce. */
export const LATCH = {
  beam: 1.5,
  slot: 0.8,
  /** zakres języczka wzdłuż y (od osi); przymocowany z tyłu, wolny z przodu */
  y0: -12.5,
  y1: -4,
  bumpR: 0.6,
  /** ile guzek wchodzi do kieszeni */
  bumpOut: 0.45,
  bumpY: -11,
  dimpleR: 0.75,
} as const;

/** Listwa na śruby i przednie podkładki (tryb 'bar'). */
export const BAR = { thick: 5, depth: 24, padR: 5.5, edge: 0.2, end: 3 } as const;

/** Gumowe stopki (tryb 'pocket'): kieszeń Ø10,2 × 1 mm, stopka ok. 2 mm wystaje. */
export const BUMPER = { r: 5.1, depth: 1, out: 2 } as const;

/** Kąt rozłożonej nóżki (oparcie o tylną ściankę) i podniesienie pod powierzchnią (mm). */
export const DEPLOYED = { deg: 98, lift: 10.15 } as const;

/** Zasięg kieszeni z zatrzaskiem w poprzek (od środka nóżki) i odstęp od innych elementów. */
export const POCKET_HALF = POCKET.width / 2 + LATCH.beam + LATCH.slot; // 14,5
const CLEAR = 1.5;
/** szeroki rozstaw: środek nóżki tyle mm od bocznej krawędzi klawiszy */
const SIDE_INSET = 17.5;

export type FeetWarn = 'noSpot' | 'thinFloor' | 'barLong' | 'padSmall';

export interface FeetLayout {
  mode: Exclude<FeetMode, 'none'>;
  /** środki nóżek (x) */
  legs: number[];
  /** oś zawiasów (y) */
  pivotY: number;
  /** powierzchnia, z której wychodzą nóżki (z): spód obudowy albo spód listwy */
  baseZ: number;
  /** listwa (tryb 'bar') i śruby, na których wisi */
  bar?: { x0: number; x1: number; y0: number; y1: number; screws: [number, number][] };
  /** podkładki z przodu (tryb 'bar'): środek i promień */
  pads?: { x: number; y: number; r: number }[];
  /** gumowe stopki (tryb 'pocket') */
  bumpers?: [number, number][];
  /** pogrubienie dna od środka (tryb 'pocket') */
  thicken?: Box[];
  /** długość śrub pod listwą i podkładkami (tryb 'bar') i głębokość wybrania na łeb w listwie */
  screwLength?: number;
  barHead?: number;
  /** pochylenie po rozłożeniu (°) */
  tilt: number;
  warns: FeetWarn[];
}

interface Ctx {
  keys: Key[];
  island: IslandGeom | null;
  screws: [number, number][];
  headR: number;
  bossR: number;
  /** pas od krawędzi klawiszy do zewnętrznej krawędzi obudowy */
  reach: number;
  /** pas od krawędzi klawiszy do wewnętrznej strony ścianki */
  innerReach: number;
  bottom: number;
  floorTop: number;
  cellHeight: number;
  /** najwyższe z dozwolone dla wierzchu pogrubionego dna (pod komórkami i pinami przełączników, z luzem) */
  topLimit: number;
  split: PrintSplit | null;
  /** miejsca zajęte w dnie (kieszenie dodatków, podkładki kontrolera, wycięcia USB) */
  keepouts: Box[];
  /** śruby: bieżąca długość, wybranie na łeb w spodzie, wysokość łba, głębokość otworu w płycie, standardowe długości */
  screw: { length: number; headDepth: number; head: number; pilotDepth: number; lengths: number[]; biteMin: number };
}

function keyBounds(keys: Key[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const k of keys)
    for (const [x, y] of keyCorners(k)) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  return { x0, x1, y0, y1 };
}

/** Odległość punktu od sumy prostokątów klawiszy (0 w środku). */
function distToKeys(keys: Key[], x: number, y: number): number {
  let best = Infinity;
  for (const k of keys) {
    const c = keyCorners(k);
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    const dx = Math.max(Math.min(...xs) - x, 0, x - Math.max(...xs));
    const dy = Math.max(Math.min(...ys) - y, 0, y - Math.max(...ys));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

const boxHit = (b: Box, x0: number, x1: number, y0: number, y1: number, m = 0) =>
  b.x0 < x1 + m && b.x1 > x0 - m && b.y0 < y1 + m && b.y1 > y0 - m;
const circleHit = ([cx, cy]: [number, number], r: number, x0: number, x1: number, y0: number, y1: number) => {
  const dx = Math.max(x0 - cx, 0, cx - x1), dy = Math.max(y0 - cy, 0, cy - y1);
  return Math.hypot(dx, dy) < r;
};

/** Obszar zajęty przez kieszeń z zatrzaskiem (z pogrubieniem w trybie 'pocket'). */
export function pocketArea(xc: number, pivotY: number, grow = 0) {
  return {
    x0: xc - POCKET_HALF - grow,
    x1: xc + POCKET_HALF + grow,
    y0: pivotY + LATCH.y0 - LATCH.slot - grow,
    y1: pivotY + LEG.thick / 2 + POCKET.stopGap + grow,
  };
}

/** Pochylenie: rozłożona nóżka podnosi tył o `lift` mm względem przodu, przód podparty w y = frontY. */
const tiltOf = (lift: number, pivotY: number, frontY: number) => (Math.atan2(lift, pivotY + 2 - frontY) * 180) / Math.PI;

/**
 * Śruba pod listwą: łeb schodzi o grubość listwy niżej. Wybieramy najdłuższą standardową śrubę,
 * która przy wybraniu na łeb w listwie od wysokości łba do (grubość − 0,6) mm wkręca się w płytę
 * tak samo bezpiecznie jak dotąd. Zwraca długość i głębokość wybrania w listwie.
 */
function barScrew(c: Ctx['screw'], bite0: number): { length: number; head: number } | null {
  // nad wybraniem zostaje 0,6 mm listwy, za nim czop (pełny pierścień wokół otworu)
  const rMin = c.head, rMax = BAR.thick - 0.6;
  for (const l of [...c.lengths].reverse()) {
    // wkręcenie przy wybraniu r: bite0 + (r − headDepth) + (l − length) − grubość listwy
    const base = bite0 + l - c.length - BAR.thick - c.headDepth;
    const lo = Math.max(base + rMin, c.biteMin), hi = Math.min(base + rMax, c.pilotDepth);
    if (lo > hi + 1e-6) continue;
    const target = Math.min(Math.max(bite0, lo), hi);
    return { length: l, head: target - base };
  }
  return null;
}

export function feetLayout(p: FeetParams | undefined, c: Ctx): FeetLayout | undefined {
  if (!p || p.mode === 'none') return undefined;
  const kb = keyBounds(c.keys);
  const warns: FeetWarn[] = [];
  // tylna krawędź korpusu (bez wyspy wystającej z tyłu): oś tak, żeby za tylną ścianką kieszeni zostały 2 mm
  const backOuter = kb.y1 + c.reach;
  let pivotY = backOuter - 2 - LEG.thick / 2 - POCKET.stopGap;
  const free = (xc: number, py: number, grow: number) => {
    const a = pocketArea(xc, py, grow);
    if (p.mode === 'pocket' && c.screws.some((s) => circleHit(s, c.bossR + 1, a.x0, a.x1, a.y0, a.y1))) return false;
    if (c.split && Math.abs(c.split.caseX - xc) < POCKET_HALF + grow + 2) return false;
    if (c.screws.some((s) => circleHit(s, c.headR + 1, a.x0, a.x1, a.y0, a.y1))) return false;
    if (p.mode === 'pocket') {
      if (c.keepouts.some((b) => boxHit(b, a.x0, a.x1, a.y0, a.y1, 1))) return false;
      const r = c.island?.rect;
      if (r && boxHit({ ...r, z0: 0, z1: 0 }, a.x0, a.x1, a.y0, a.y1, 1)) return false;
      if (a.x0 < kb.x0 - c.innerReach + 0.5 || a.x1 > kb.x1 + c.innerReach - 0.5) return false;
    } else if (a.x0 < kb.x0 - c.reach + 1 || a.x1 > kb.x1 + c.reach - 1) return false;
    return true;
  };

  if (p.mode === 'bar') {
    const baseZ = c.bottom - BAR.thick;
    // tylne śruby: w tylnym pasie płyty
    const back = c.screws.filter(([, y]) => y > kb.y1 - 1e-6);
    // listwa trzyma się na co najmniej 2 śrubach (przy schodkowych kolumnach splitu bywa jedna: wtedy kieszenie w dnie)
    if (back.length < 2) return { mode: 'bar', legs: [], pivotY, baseZ, tilt: 0, warns: ['noSpot'] };
    const sx0 = Math.min(...back.map((s) => s[0])), sx1 = Math.max(...back.map((s) => s[0]));
    // nóżki tuż za skrajnymi tylnymi śrubami; gdy się nie mieszczą, przesuwamy do środka
    const near = c.headR + 1 + POCKET_HALF;
    const legs: number[] = [];
    for (const [start, dir] of [[sx0 - near, -1], [sx1 + near, 1]] as const) {
      let xc = start;
      for (let i = 0; i < 40 && !free(xc, pivotY, 0); i++) xc -= dir * 2;
      if (free(xc, pivotY, 0)) legs.push(xc);
    }
    if (legs.length < 2 || legs[1] - legs[0] < 2 * POCKET_HALF + 4) warns.push('noSpot');
    const y1 = backOuter - BAR.edge;
    const bar = {
      x0: Math.min(sx0 - c.headR - 2, ...legs.map((x) => x - POCKET_HALF - BAR.end)),
      x1: Math.max(sx1 + c.headR + 2, ...legs.map((x) => x + POCKET_HALF + BAR.end)),
      y0: y1 - BAR.depth,
      y1,
      screws: back,
    };
    // przednie podkładki na skrajnych przednich śrubach (narożnych)
    const front = c.screws.filter(([, y]) => y < kb.y0 + 1e-6);
    const pick = front.length
      ? [front.reduce((a, b) => (b[0] < a[0] ? b : a)), front.reduce((a, b) => (b[0] > a[0] ? b : a))]
      : [];
    const pads = pick.map(([x, y]) => {
      const r = Math.min(BAR.padR, c.reach - distToKeys(c.keys, x, y) - 0.3);
      if (r < c.headR + 1.2) warns.push('padSmall');
      return { x, y, r: Math.max(r, c.headR + 1.2) };
    });
    // śruby dłuższe o grubość listwy (łeb schodzi niżej o tyle samo)
    const bs = barScrew(c.screw, c.bottom + c.screw.headDepth + c.screw.length + c.cellHeight);
    if (!bs) warns.push('barLong');
    const screwLength = bs?.length ?? c.screw.length + BAR.thick;
    const barHead = bs?.head ?? c.screw.head;
    const frontY = pads.length ? Math.min(...pads.map((q) => q.y)) : kb.y0;
    return { mode: 'bar', legs, pivotY, baseZ, bar, pads, screwLength, barHead, tilt: tiltOf(DEPLOYED.lift, pivotY, frontY), warns };
  }

  // 'pocket': szeroki rozstaw, przy bokach; oś przed wyspą, jeśli wyspa zasłania tylną krawędź
  const baseZ = c.bottom;
  const thickTop = c.bottom + POCKET.depth + POCKET.ceiling;
  if (thickTop > c.topLimit) warns.push('thinFloor');
  // szeroko: ok. 17,5 mm od krawędzi klawiszy (jak na obrazku 8, wybór Marcina)
  const leftX = Math.max(kb.x0 + SIDE_INSET, kb.x0 - c.innerReach + POCKET_HALF + CLEAR + 0.5);
  const rightX = Math.min(kb.x1 - SIDE_INSET, kb.x1 + c.innerReach - POCKET_HALF - CLEAR - 0.5);
  const tryAt = (py: number, steps: number) => {
    const out: number[] = [];
    for (const [start, dir] of [[leftX, 1], [rightX, -1]] as const) {
      let xc = start;
      for (let i = 0; i < steps && !free(xc, py, CLEAR); i++) xc += dir;
      if (free(xc, py, CLEAR)) out.push(xc);
    }
    return out.length === 2 && out[1] - out[0] >= 2 * (POCKET_HALF + CLEAR) + 2 ? out : null;
  };
  // najpierw przesuwamy oś do przodu (np. przed wyspę), nóżki zostają przy bokach;
  // dopiero gdy się nie da, nóżki wędrują do środka
  let legs: number[] | null = null;
  const py0 = pivotY;
  for (let i = 0; i <= 20 && !legs; i++) if ((legs = tryAt(py0 - i, 12))) pivotY = py0 - i;
  if (!legs && (legs = tryAt(py0, 120))) pivotY = py0;
  if (!legs) {
    warns.push('noSpot');
    return { mode: 'pocket', legs: [], pivotY, baseZ, tilt: 0, warns };
  }
  const thicken: Box[] = legs.map((xc) => {
    const a = pocketArea(xc, pivotY, CLEAR);
    return { x0: a.x0, x1: a.x1, y0: a.y0, y1: Math.min(a.y1 + 2, backOuter - 0.5), z0: c.floorTop - 0.5, z1: thickTop };
  });
  // gumowe stopki: z przodu pod nóżkami, z tyłu obok nóżek (do środka)
  const frontY = kb.y0 + 8;
  const bumpers: [number, number][] = [];
  const bumperOk = ([x, y]: [number, number]) =>
    !c.screws.some((s) => Math.hypot(s[0] - x, s[1] - y) < c.headR + BUMPER.r + 0.8) &&
    !legs!.some((xc) => {
      const a = pocketArea(xc, pivotY, CLEAR);
      return circleHit([x, y], BUMPER.r + 0.5, a.x0, a.x1, a.y0, a.y1);
    }) &&
    !c.keepouts.some((b) => circleHit([x, y], BUMPER.r + 0.5, b.x0, b.x1, b.y0, b.y1));
  for (const [x, y, dx] of [
    [legs[0], frontY, 1],
    [legs[1], frontY, -1],
    [legs[0] + POCKET_HALF + CLEAR + BUMPER.r + 2, pivotY - 2, 1],
    [legs[1] - POCKET_HALF - CLEAR - BUMPER.r - 2, pivotY - 2, -1],
  ] as const) {
    let px: number = x;
    for (let i = 0; i < 20 && !bumperOk([px, y]); i++) px += dx * 2;
    bumpers.push([px, y]);
  }
  return {
    mode: 'pocket',
    legs,
    pivotY,
    baseZ,
    bumpers,
    thicken,
    tilt: tiltOf(DEPLOYED.lift - BUMPER.out, pivotY, frontY),
    warns,
  };
}
