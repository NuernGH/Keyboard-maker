// SPDX-License-Identifier: AGPL-3.0-or-later
import type { UpAxis, CellVariant, PlateOptions } from '../lib/cell-spec';
import type { Key } from '../lib/layout';
import type { IslandGeom } from '../lib/island';
import type { CaseLayout, CaseParams } from '../lib/case';
import type { PrintSplit } from '../lib/split';
import type { DactylParams } from '../lib/dactyl';
import type { ControllerParams } from '../lib/dactyl-parts';
import type { ScrewSize } from '../lib/case';
import type { CapType, KeycapParams } from '../lib/keycap-spec';

/** Nakładka (albo plik kalibracji luzu, gdy `cap` = null): w spoczynku na przełączniku albo ustawiona do druku. */
export interface KeycapInput {
  params: KeycapParams;
  cap: CapType | null;
  pose: 'rest' | 'print';
}

/** Dactyl: skorupa albo dno jednej połówki. Model liczymy dla prawej, lewa to lustro. */
export interface DactylInput {
  params: DactylParams;
  variant: 'hotswap' | 'no-hotswap';
  cellId: string;
  cellStep: ArrayBuffer;
  up: UpAxis | 'auto';
  part: 'shell' | 'bottom';
  side: 'left' | 'right';
  controller: ControllerParams | null;
  /** grubość dna (mm) */
  floor: number;
  /** rozmiar śrub dna; brak = M3 */
  screwSize?: ScrewSize;
}

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
  /** model przełącznika do podglądu (STEP, oś „do góry” w pliku) */
  | { id: number; type: 'switch'; step: ArrayBuffer; up: UpAxis }
  /** dowolny model STEP zamieniony na trójkąty (np. własny kontroler do pomiaru) */
  | { id: number; type: 'step-mesh'; step: ArrayBuffer }
  | { id: number; type: 'export'; format: 'stl' | 'step'; input: BuildInput }
  | { id: number; type: 'dactyl-mesh'; input: DactylInput }
  | { id: number; type: 'dactyl-export'; format: 'stl' | 'step'; input: DactylInput }
  | { id: number; type: 'keycap-mesh'; input: KeycapInput }
  | { id: number; type: 'keycap-export'; format: 'stl' | 'step'; input: KeycapInput };

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
