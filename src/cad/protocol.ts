// SPDX-License-Identifier: AGPL-3.0-or-later
import type { UpAxis, CellVariant, PlateOptions } from '../lib/cell-spec';
import type { Key } from '../lib/layout';
import type { IslandGeom } from '../lib/island';
import type { CaseLayout, CaseParams } from '../lib/case';
import type { PrintSplit } from '../lib/split';

export interface BuildInput {
  keys: Key[];
  variant: CellVariant;
  plate: PlateOptions;
  /** identyfikator komórki (np. nazwa pliku + rozmiar), do cache */
  cellId: string;
  cellStep: ArrayBuffer;
  up: UpAxis | 'auto';
  island: IslandGeom | null;
  /** co zbudować: płytę (domyślnie), spód obudowy albo klin pod moduł OLED */
  part?: 'plate' | 'case' | 'wedge';
  /** obudowa: parametry i wyliczone pozycje śrub; przy płycie dodaje otwory pilotowe */
  case?: { params: CaseParams; layout: CaseLayout } | null;
  /** podział do druku; z `piece` zwraca jedną część (0 = lewa, 1 = prawa) zamiast całości */
  split?: { plan: PrintSplit; clearance: number } | null;
  piece?: 0 | 1;
}

export type Request =
  | { id: number; type: 'init' }
  | { id: number; type: 'mesh'; input: BuildInput }
  | { id: number; type: 'export'; format: 'stl' | 'step'; input: BuildInput };

export type Response =
  | { id: number; type: 'ready' }
  | {
      id: number;
      type: 'mesh';
      vertices: Float32Array;
      normals: Float32Array;
      triangles: Uint32Array;
      bounds: [[number, number, number], [number, number, number]];
      ms: number;
    }
  | { id: number; type: 'file'; data: ArrayBuffer; ms: number }
  | { id: number; type: 'error'; message: string };
