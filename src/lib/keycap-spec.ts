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
};

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

/** Najcieńsza ścianka przy suficie wnętrza (mm) dla nakładki 1U. */
export function wallAtCeiling(p: KeycapParams): number {
  const L = capLevels(p);
  const b = (PITCH - p.gap) / 2;
  const t = p.topSize / 2;
  const outer = b + ((t - b) * (L.ceiling - L.z0)) / (L.topEdge - L.z0);
  const inner = b - p.wall - CAP_LIMITS.cavityTaper;
  return outer - inner;
}

/** Ostrzeżenia dla parametrów (klucze tekstów w i18n). */
export function capWarnings(p: KeycapParams): string[] {
  const out: string[] = [];
  const L = capLevels(p);
  if (p.height > L.maxHeight + 1e-6) out.push('capTooTall');
  if (wallAtCeiling(p) < CAP_LIMITS.minWall) out.push('capThinWall');
  const inner = (PITCH - p.gap) / 2 - p.wall - CAP_LIMITS.cavityTaper;
  if (inner < MX.housingTopHalf + 0.3) out.push('capCavityTight');
  return out;
}
