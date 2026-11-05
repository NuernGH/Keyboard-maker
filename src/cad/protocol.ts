// SPDX-License-Identifier: AGPL-3.0-or-later
import type { UpAxis, CellVariant, PlateOptions } from '../lib/cell-spec';
import type { Key } from '../lib/layout';
import type { IslandGeom } from '../lib/island';
import type { CaseLayout, CaseParams } from '../lib/case';

export interface BuildInput {
  keys: Key[];
  variant: CellVariant;
  plate: PlateOptions;
  /** identyfikator komórki (np. nazwa pliku + rozmiar), do cache */
  cellId: string;
  cellStep: ArrayBuffer;
  up: UpAxis | 'auto';
  island: IslandGeom | null;
  /** co zbudować: płytę (domyślnie) albo spód obudowy */
  part?: 'plate' | 'case';
  /** obudowa: parametry i wyliczone pozycje śrub; przy płycie dodaje otwory pilotowe */
  case?: { params: CaseParams; layout: CaseLayout } | null;
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
