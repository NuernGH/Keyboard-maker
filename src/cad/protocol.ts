// SPDX-License-Identifier: AGPL-3.0-or-later
import type { UpAxis, CellVariant, PlateOptions } from '../lib/cell-spec';
import type { Key } from '../lib/layout';

export interface BuildInput {
  keys: Key[];
  variant: CellVariant;
  plate: PlateOptions;
  /** identyfikator komórki (np. nazwa pliku + rozmiar), do cache */
  cellId: string;
  cellStep: ArrayBuffer;
  up: UpAxis | 'auto';
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
