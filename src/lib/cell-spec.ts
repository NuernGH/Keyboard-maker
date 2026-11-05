// SPDX-License-Identifier: AGPL-3.0-or-later
// Stałe i typy komórki, bez zależności od jądra CAD (UI importuje je bez ładowania WASM).

export type CellVariant = 'hotswap' | 'no-hotswap' | 'thin-plate';

/** Wysokość komórki bez hot-swap: płyta 1,27 + ścianki z wybraniem (decyzja Marcina). */
export const NO_HOTSWAP_HEIGHT = 5.08;
export const THIN_PLATE_THICKNESS = 1.5;
export const MX_HOLE = 14.0;

export type UpAxis = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

export interface PlateOptions {
  /** promień domknięcia szczelin między klawiszami (mm), 0 = bez wypełniania */
  fillGaps: number;
  /** margines płyty poza obrysem klawiszy (mm) */
  margin: number;
  /**
   * Klawisze od 2U: `cherry` = wycięcia na stabilizatory Cherry/Costar montowane w płycie,
   * `mx` = zamiast stabilizatora przełączniki MX w miejscu jego trzpieni (2–2,75U: dwa, bez
   * środkowego; dłuższe: trzy), `none` = sam przełącznik na środku.
   */
  stabs?: 'cherry' | 'mx' | 'none';
}

export const DEFAULT_PLATE_OPTIONS: PlateOptions = { fillGaps: 4, margin: 0, stabs: 'cherry' };

/** Grubość górnej warstwy komórki (płyta, w którą wpina się przełącznik i stabilizator). */
export const PLATE_LIP = 1.27;
/** Obudowa MX ma 15,6 mm: gdy trzpień stabilizatora jest bliżej środka, środkowy przełącznik się nie zmieści. */
export const MX_BODY = 15.6;
/** Poziom, na którym w zwykłej klawiaturze leży PCB (mm pod wierzchem płyty): pod nim nie ma drutu stabilizatora. */
export const PCB_LEVEL = 5.08;

/**
 * Rozstaw stabilizatora Cherry (od środka klawisza do środka obudowy, mm) dla szerokości w U.
 * Wartości ze specyfikacji Cherry (te same co w kalkulatorach płyt, np. swillkb). Poniżej 2U: brak.
 */
export function stabOffset(u: number): number | null {
  if (u < 2 - 1e-6) return null;
  const table: [number, number][] = [
    [2.75, 11.9],
    [3, 19.05],
    [4, 28.575],
    [4.5, 34.671],
    [5.5, 42.8625],
    [6, 47.5],
    [6.25, 50],
    [6.5, 52.38],
    [7, 57.15],
  ];
  for (const [maxU, off] of table) if (u <= maxU + 1e-6) return off;
  return 66.675;
}
