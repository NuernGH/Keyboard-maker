// Dactyl w OpenCascade: poprawność brył i kolizje z kluczowymi częściami (komórki, kontroler, USB).
import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { isValidShape, loadCell } from '../src/lib/geometry';
import { buildDactyl, DACTYL_DEFAULT } from '../src/lib/dactyl';
import { boxOf, buildDactylBottom, buildDactylShell, placeShape, shellBody } from '../src/lib/dactyl-geometry';
import { controllerHolder, DEFAULT_DACTYL_CONTROLLER } from '../src/lib/dactyl-parts';

beforeAll(async () => {
  await initOC();
}, 60000);

const vol = (a: Shape3D, b: Shape3D) => measureVolume(a.clone().intersect(b) as Shape3D);

describe('Dactyl: bryły', () => {
  test('skorupa hot-swap: poprawna, komórki nietknięte, kontroler i gniazdo bez kolizji, dno poprawne', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height });
    const controller = controllerHolder(m, DEFAULT_DACTYL_CONTROLLER);
    const b = { floor: 3, bossHeight: 7, controller };
    // płytka i gniazdo USB nie mogą wchodzić w skorupę (przed wycięciami)
    const body = shellBody(m, { ...b, controller: null });
    for (const g of controller.ghosts) expect(vol(body, boxOf(g.box))).toBeLessThan(0.01);
    for (const t of controller.bottomAdd) expect(vol(body, boxOf(t))).toBeLessThan(0.01);
    const shell = buildDactylShell(m, cell, b);
    expect(isValidShape(shell)).toBe(true);
    // żadna komórka (otwór, wybranie, kieszeń hot-swap) nie jest zasypana materiałem skorupy
    for (const k of m.keys) expect(vol(shell, placeShape(cell.negative.clone(), k.frame))).toBeLessThan(0.5);
    // otwór USB przechodzi przez ścianę: wtyk (9 × 3,4 mm) od gniazda na zewnątrz jest wolny
    const usb = controller.shellCut[0];
    const plug = { ...usb, x0: -4.5, x1: 4.5, y0: -0.5, y1: 12, z0: usb.z0 + 1, z1: usb.z1 - 1 };
    expect(vol(shell, boxOf(plug))).toBeLessThan(0.01);
    const bottom = buildDactylBottom(m, b);
    expect(isValidShape(bottom)).toBe(true);
    expect(measureVolume(bottom)).toBeGreaterThan(50000);
    // płytka leży w korytku dna bez kolizji
    for (const g of controller.ghosts) expect(vol(bottom, boxOf(g.box))).toBeLessThan(0.01);
  }, 300000);

  test('skorupa bez hot-swap: poprawna, komórki nietknięte', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'no-hotswap');
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height });
    const shell = buildDactylShell(m, cell, { floor: 3, bossHeight: 7, controller: controllerHolder(m, DEFAULT_DACTYL_CONTROLLER) });
    expect(isValidShape(shell)).toBe(true);
    for (const k of m.keys) expect(vol(shell, placeShape(cell.negative.clone(), k.frame))).toBeLessThan(0.5);
  }, 300000);
});
