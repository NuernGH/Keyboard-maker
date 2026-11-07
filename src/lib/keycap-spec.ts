// SPDX-License-Identifier: AGPL-3.0-or-later
// Nakładki (keycaps) pod Cherry MX: parametry i wymiary bez jądra CAD (UI importuje je bez WASM).
// Profil jest własny (niski, góra z misą albo płaska); wymiary przełącznika zmierzone na modelu
// z public/switches/cherry-mx.step (wierzch płyty z = 0).

import { PITCH, switchOffsets, type Key } from './layout';
import { stabOffset } from './cell-spec';

/** Przełącznik Cherry MX (z modelu): wysokości nad wierzchem płyty, mm. */
export const MX = {
  /** wierzch obudowy, a zarazem podstawa krzyża trzpienia */
  housingTop: 6.45,
  /** połowa obrysu obudowy przy wierzchu (z uwzględnieniem przesunięcia w Y), z zapasem */
  housingTopHalf: 5.7,
  /** czubek krzyża */
  stemTop: 10.05,
  /** kołnierz obudowy na płycie: 15,64 × 16,33 mm do tej wysokości */
  flangeTop: 0.9,
  /** krzyż: długość ramion i grubość ramienia wzdłuż X / wzdłuż Y */
  crossLen: 4.5,
  crossX: 1.15,
  crossY: 1.35,
  /** skok */
  travel: 4.0,
} as const;

/** Stałe gniazda w nakładce. */
export const STEM = {
  /** średnica walca gniazda (jak w zwykłych nakładkach MX) */
  od: 5.5,
  /** spód walca nad podstawą krzyża w spoczynku */
  seatGap: 0.1,
  /** wolne miejsce nad czubkiem krzyża */
  topGap: 0.15,
} as const;

/** Najmniejsze odstępy, które pilnuje generator. */
export const CAP_LIMITS = {
  /** sufit wnętrza nad wierzchem obudowy po pełnym wciśnięciu */
  ceilingClear: 0.35,
  /** krawędź nakładki nad kołnierzem przełącznika po pełnym wciśnięciu */
  skirtClear: 0.3,
  /** najcieńsza ścianka przy suficie wnętrza */
  minWall: 0.8,
  /** o ile wnętrze zwęża się od dołu do sufitu (na stronę) */
  cavityTaper: 1.2,
} as const;

export interface KeycapParams {
  /** góra: misa kulista (A) albo płaska (B) */
  top: 'dish' | 'flat';
  /** wysokość od krawędzi dolnej do krawędzi górnej (mm) */
  height: number;
  /** bok góry nakładki 1U (mm); dłuższe nakładki mają ten sam uskok na stronę */
  topSize: number;
  /** głębokość misy (mm), tylko przy misie */
  dish: number;
  /** ścianka boczna przy dolnej krawędzi (mm) */
  wall: number;
  /** grubość góry pod najniższym punktem misy (mm) */
  topThickness: number;
  /** promień zaokrąglenia naroży (mm) */
  radius: number;
  /** luz krzyża w gnieździe (mm, łącznie na szerokość ramienia), z pliku kalibracji */
  clearance: number;
  /** szczelina między nakładkami (spód 1U = 19,05 − gap) */
  gap: number;
  /**
   * Ustawienie do druku: `upright` = normalnie (misa do góry, płaska do góry nogami),
   * `side` = na przedniej ściance, bez podpór (wnętrze o stałej ściance, nawis 45°).
   */
  orient: 'upright' | 'side';
  /** gniazdo przy druku na boku: A = żebro do odłamania, B = osobna wkładka wklejana w sufit */
  sideStem: 'rib' | 'insert';
  /**
   * wymiary gniazda: `calc` = krzyż MX powiększony o luz z listy, walec Ø5,5;
   * `proven` = gotowe wymiary ze sprawdzonej, wpinającej się nakładki (PROVEN_SOCKET), luz pomijany
   */
  socket?: 'calc' | 'proven';
}

/**
 * Gniazdo zmierzone w nakładce Marcina (keycap_Short_widerRing.STL), która pewnie wpina się na MX:
 * otwór krzyża 4,2 × 1,4 mm (oba ramiona tak samo), walec Ø5,72. To wymiary otworu, bez dodatkowego luzu.
 */
export const PROVEN_SOCKET = { od: 5.72, len: 4.2, arm: 1.4 };

/** Średnica walca gniazda dla wybranych wymiarów gniazda. */
export function stemOd(p: Pick<KeycapParams, 'socket'>): number {
  return p.socket === 'proven' ? PROVEN_SOCKET.od : STEM.od;
}

export const DEFAULT_KEYCAP: KeycapParams = {
  top: 'dish',
  height: 7.4,
  topSize: 12.8,
  dish: 0.8,
  wall: 1.5,
  topThickness: 1.5,
  radius: 1.5,
  clearance: 0.3,
  gap: 1.05,
  orient: 'upright',
  sideStem: 'insert',
  socket: 'calc',
};

/** Druk na boku: zbieżność boków (stopnie) i ścianka równoległa do zewnętrznej, by sufit wnętrza miał nawis 45°. */
export const SIDE = {
  taper: 22.5,
  /** ścianka; grubsza dotknęłaby obudowy MX po wciśnięciu */
  wall: 0.85,
  /** żebro pod gniazdem (wariant A) */
  rib: 0.6,
  /** bolec wkładki (wariant B): średnica, długość, płaska ścianka w odległości od osi, luz w otworze */
  pin: { d: 3.2, len: 1.3, flat: 1.1, fit: 0.15 },
  /** sfazowanie wejścia krzyża we wkładce (leży na stole) */
  mouth: 0.3,
} as const;

/** Bok góry 1U, przy którym boki mają zbieżność SIDE.taper. */
export const sideTopSize = (p: Pick<KeycapParams, 'height' | 'gap'>) =>
  Math.round((PITCH - p.gap - 2 * p.height * Math.tan((SIDE.taper * Math.PI) / 180)) * 100) / 100;

/** Zmiana ustawienia do druku: przy druku na boku węższa góra i cieńsza ścianka, przy normalnym domyślne. */
export function orientPreset(p: KeycapParams, orient: KeycapParams['orient']): Partial<KeycapParams> {
  return orient === 'side'
    ? { orient, topSize: sideTopSize(p), wall: SIDE.wall }
    : { orient, topSize: DEFAULT_KEYCAP.topSize, wall: DEFAULT_KEYCAP.wall };
}

/** Zbieżność boków (stopnie od osi nakładki). */
export const sideAngle = (p: KeycapParams) => (Math.atan(topInset(p) / capLevels(p).height) * 180) / Math.PI;

/**
 * Obrys obudowy MX (największa połowa w X lub Y) na wysokościach nad płytą, z modelu w repo.
 * Służy do sprawdzenia, czy wnętrze nakładki mieści obudowę po pełnym wciśnięciu.
 */
export const MX_HOUSING_HALF: [number, number][] = [
  [1, 6.96], [1.5, 6.87], [2, 6.78], [2.5, 6.69], [3, 6.6], [3.5, 6.51], [4, 6.42], [4.5, 6.34],
  [5, 6.25], [5.5, 6.16], [6, 6.06], [6.25, 5.67], [6.45, 5.67],
];

/**
 * Domyślne wartości zależne od góry: płaska ma grubszą górę (miejsce na rowek legendy 0,8–1,0 mm)
 * i krawędź na tej samej wysokości co misa.
 */
export function topPreset(top: KeycapParams['top']): Pick<KeycapParams, 'top' | 'topThickness' | 'height'> {
  return top === 'flat' ? { top, topThickness: 2.3, height: DEFAULT_KEYCAP.height } : { top, topThickness: DEFAULT_KEYCAP.topThickness, height: DEFAULT_KEYCAP.height };
}

/** Luzy w pliku kalibracji. */
export const CALIBRATION_CLEARANCES = [0.2, 0.25, 0.3, 0.35];

/** Wysokości charakterystyczne nakładki (w spoczynku, nad wierzchem płyty). */
export interface CapLevels {
  /** dolna krawędź */
  z0: number;
  /** sufit wnętrza (spód góry) */
  ceiling: number;
  /** najniższy punkt góry (dno misy) */
  topLow: number;
  /** górna krawędź */
  topEdge: number;
  /** spód walca gniazda i wierzch wycięcia krzyża */
  stemBottom: number;
  socketTop: number;
  /** wysokość po przycięciu do dopuszczalnej */
  height: number;
  /** największa dopuszczalna wysokość (krawędź nad kołnierzem po wciśnięciu) */
  maxHeight: number;
}

export function capLevels(p: KeycapParams): CapLevels {
  const ceiling = MX.housingTop + MX.travel + CAP_LIMITS.ceilingClear;
  const topLow = ceiling + p.topThickness;
  const topEdge = topLow + (p.top === 'dish' ? p.dish : 0);
  const minZ0 = MX.flangeTop + CAP_LIMITS.skirtClear + MX.travel;
  const maxHeight = topEdge - minZ0;
  const height = Math.min(Math.max(p.height, topEdge - ceiling + 0.5), maxHeight);
  return {
    z0: topEdge - height,
    ceiling,
    topLow,
    topEdge,
    stemBottom: MX.housingTop + STEM.seatGap,
    socketTop: MX.stemTop + STEM.topGap,
    height,
    maxHeight,
  };
}

/** Rozmiar nakładki: spód (mm) dla klawisza w × h U. */
export function capBottom(p: KeycapParams, w: number, h: number): [number, number] {
  return [w * PITCH - p.gap, h * PITCH - p.gap];
}

/** Uskok góry na stronę (mm). */
export const topInset = (p: KeycapParams) => (PITCH - p.gap - p.topSize) / 2;

/** Gniazdo w nakładce: przesunięcie wzdłuż dłuższego boku i czy to trzpień stabilizatora. */
export interface CapStem {
  d: number;
  stab: boolean;
}

/** Typ nakładki: rozmiar i gniazda (wspólny dla wszystkich klawiszy o tych samych wartościach). */
export interface CapType {
  id: string;
  w: number;
  h: number;
  stems: CapStem[];
}

/**
 * Gniazda nakładki wg płyty: przy stabilizatorze Cherry środek i trzpienie stabilizatora,
 * przy „dwa MX” tam, gdzie stoją przełączniki, bez stabilizatora tylko środek.
 */
export function capStems(k: Pick<Key, 'w' | 'h'>, stabs: 'cherry' | 'mx' | 'none'): CapStem[] {
  if (stabs === 'cherry') {
    const s = stabOffset(Math.max(k.w, k.h));
    return s === null ? [{ d: 0, stab: false }] : [{ d: -s, stab: true }, { d: 0, stab: false }, { d: s, stab: true }];
  }
  return switchOffsets(k as Key, stabs).map((d) => ({ d, stab: false }));
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

export function capType(k: Pick<Key, 'w' | 'h'>, stabs: 'cherry' | 'mx' | 'none'): CapType {
  const stems = capStems(k, stabs);
  const kind = stems.length === 1 ? '' : stabs === 'cherry' ? '-stab' : `-${stems.length}mx`;
  const size = k.h > k.w ? `${fmt(k.h)}u-v` : k.h !== 1 ? `${fmt(k.w)}x${fmt(k.h)}u` : `${fmt(k.w)}u`;
  return { id: size + kind, w: k.w, h: k.h, stems };
}

/** Typy nakładek układu z liczbą sztuk, od najczęstszego. */
export function capSet(keys: Pick<Key, 'w' | 'h'>[], stabs: 'cherry' | 'mx' | 'none'): { type: CapType; count: number }[] {
  const m = new Map<string, { type: CapType; count: number }>();
  for (const k of keys) {
    const t = capType(k, stabs);
    const e = m.get(t.id);
    if (e) e.count++;
    else m.set(t.id, { type: t, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.type.w - b.type.w);
}

/** Połowa zewnętrznego obrysu 1U na wysokości z (w spoczynku). */
export function outerHalf(p: KeycapParams, z: number): number {
  const L = capLevels(p);
  const b = (PITCH - p.gap) / 2;
  const t = p.topSize / 2;
  return b + ((t - b) * (z - L.z0)) / (L.topEdge - L.z0);
}

/** Połowa wnętrza 1U na wysokości z: przy druku normalnym zwęża się o cavityTaper, na boku ma stałą ściankę. */
export function innerHalf(p: KeycapParams, z: number): number {
  if (p.orient === 'side') return outerHalf(p, z) - p.wall;
  const L = capLevels(p);
  const b = (PITCH - p.gap) / 2 - p.wall;
  return b - (CAP_LIMITS.cavityTaper * (z - L.z0)) / (L.ceiling - L.z0);
}

/** Najcieńsza ścianka przy suficie wnętrza (mm) dla nakładki 1U. */
export function wallAtCeiling(p: KeycapParams): number {
  const L = capLevels(p);
  return outerHalf(p, L.ceiling) - innerHalf(p, L.ceiling);
}

/** Najmniejszy odstęp wnętrza od obudowy MX po pełnym wciśnięciu (mm, na stronę). */
export function pressedCavityClear(p: KeycapParams): number {
  const L = capLevels(p);
  let m = Infinity;
  for (const [h, half] of MX_HOUSING_HALF) {
    const z = h + MX.travel;
    if (z < L.z0 || z > L.ceiling) continue;
    m = Math.min(m, innerHalf(p, z) - half);
  }
  return m;
}

/** Ostrzeżenia dla parametrów (klucze tekstów w i18n). */
export function capWarnings(p: KeycapParams): string[] {
  const out: string[] = [];
  const L = capLevels(p);
  if (p.height > L.maxHeight + 1e-6) out.push('capTooTall');
  if (wallAtCeiling(p) < CAP_LIMITS.minWall) out.push('capThinWall');
  if (pressedCavityClear(p) < 0.3 - 1e-6) out.push('capCavityTight');
  if (p.orient === 'side' && sideAngle(p) < SIDE.taper - 0.2) out.push('capSideOverhang');
  return out;
}
