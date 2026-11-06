// Dactyl bez hot-swap w osobnym pliku: każdy plik testów ma świeżą instancję OpenCascade,
// a kilka dużych skorup z rzędu w jednej instancji wyczerpuje pamięć WASM.
import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { isValidShape, loadCell } from '../src/lib/geometry';
import { buildDactyl, DACTYL_DEFAULT } from '../src/lib/dactyl';
import { buildDactylShell, placeShape } from '../src/lib/dactyl-geometry';
import { controllerHolder, DEFAULT_DACTYL_CONTROLLER } from '../src/lib/dactyl-parts';

beforeAll(async () => {
  await initOC();
}, 60000);

const vol = (a: Shape3D, b: Shape3D) => measureVolume(a.clone().intersect(b) as Shape3D);

describe('Dactyl: bryły bez hot-swap', () => {
  test('skorupa bez hot-swap: poprawna, komórki nietknięte', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'no-hotswap');
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height });
    const shell = buildDactylShell(m, cell, { floor: 3, bossHeight: 7, controller: controllerHolder(m, DEFAULT_DACTYL_CONTROLLER) });
    expect(isValidShape(shell)).toBe(true);
    for (const k of m.keys) expect(vol(shell, placeShape(cell.negative.clone(), k.frame))).toBeLessThan(0.5);
  }, 300000);
});
