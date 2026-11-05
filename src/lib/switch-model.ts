// SPDX-License-Identifier: AGPL-3.0-or-later
// Model przełącznika do podglądu 3D (nie trafia do eksportu).
import { importSTEP, makeBox, measureVolume, type Shape3D } from 'replicad';
import type { UpAxis } from './cell-spec';

export interface SwitchSource {
  step: Blob;
  /** oś „do góry” (strona trzpienia) w pliku; model z public/switches ma +Y */
  up: UpAxis;
}

function slabBounds(s: Shape3D, z0: number, z1: number) {
  const c = s.clone().intersect(makeBox([-100, -100, z0], [100, 100, z1])) as Shape3D;
  return measureVolume(c) > 1e-4 ? c.boundingBox.bounds : null;
}

/**
 * Ustawia przełącznik jak komórkę: oś Z w górę, środek trzpienia w (0, 0),
 * spód kołnierza (czyli wierzch płyty) na z = 0.
 */
export function normalizeSwitch(shape: Shape3D, up: UpAxis): Shape3D {
  let s = shape;
  switch (up) {
    case '+X': s = s.rotate(-90, [0, 0, 0], [0, 1, 0]); break;
    case '-X': s = s.rotate(90, [0, 0, 0], [0, 1, 0]); break;
    case '+Y': s = s.rotate(90, [0, 0, 0], [1, 0, 0]); break;
    case '-Y': s = s.rotate(-90, [0, 0, 0], [1, 0, 0]); break;
    case '-Z': s = s.rotate(180, [0, 0, 0], [1, 0, 0]); break;
    case '+Z': break;
  }
  const bb = s.boundingBox.bounds;
  // trzpień: górne 2 mm
  const st = slabBounds(s, bb[1][2] - 2, bb[1][2] + 1);
  if (!st) throw new Error('Nie znaleziono trzpienia przełącznika');
  const cx = (st[0][0] + st[1][0]) / 2;
  const cy = (st[0][1] + st[1][1]) / 2;
  // kołnierz: najniższy poziom, na którym przekrój ma pełną szerokość modelu
  const full = bb[1][0] - bb[0][0];
  const isFull = (z0: number, z1: number) => {
    const b = slabBounds(s, z0, z1);
    return !!b && b[1][0] - b[0][0] > full - 0.05;
  };
  // zgrubnie co 0,25 mm z góry w dół, potem dokładnie (0,01 mm) dolną krawędź kołnierza
  let coarse = NaN;
  for (let z = bb[1][2]; z > bb[0][2]; z -= 0.25) {
    if (isFull(z - 0.25, z)) coarse = z - 0.25;
    else if (!Number.isNaN(coarse)) break;
  }
  if (Number.isNaN(coarse)) throw new Error('Nie znaleziono kołnierza przełącznika');
  // spód kołnierza leży w [coarse - 0,25, coarse + 0,25]
  let lo = coarse - 0.25;
  let hi = coarse + 0.25;
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    if (isFull(mid, mid + 0.01)) hi = mid;
    else lo = mid;
  }
  const flange = hi;
  return s.translate(-cx, -cy, -flange);
}

export async function loadSwitch(src: SwitchSource): Promise<Shape3D> {
  return normalizeSwitch((await importSTEP(src.step)) as Shape3D, src.up);
}
