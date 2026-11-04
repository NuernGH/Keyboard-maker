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
}

export const DEFAULT_PLATE_OPTIONS: PlateOptions = { fillGaps: 4, margin: 0 };
