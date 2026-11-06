// Dactyl w OpenCascade: poprawność brył i kolizje z kluczowymi częściami (komórki, kontroler, USB).
import { beforeAll, describe, expect, test } from 'vitest';
import { makeCylinder, measureVolume, type Shape3D } from 'replicad';
import { dactylHeadDepth } from '../src/lib/case';
import { initOC, cellStep } from './oc';
import { isValidShape, loadCell } from '../src/lib/geometry';
import { buildDactyl, DACTYL_DEFAULT } from '../src/lib/dactyl';
import { boxOf, buildDactylBottom, buildDactylShell, placeShape, shellBody } from '../src/lib/dactyl-geometry';
import { controllerHolder, DEFAULT_DACTYL_CONTROLLER, HOLDER } from '../src/lib/dactyl-parts';

beforeAll(async () => {
  await initOC();
}, 60000);

const vol = (a: Shape3D, b: Shape3D) => measureVolume(a.clone().intersect(b) as Shape3D);

describe('Dactyl: bryły', () => {
  for (const size of ['M3', 'M2.5'] as const)
  test(`skorupa hot-swap, śruby ${size}: poprawna, komórki nietknięte, kontroler i gniazdo bez kolizji, dno poprawne`, async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height, screwSize: size });
    const controller = controllerHolder(m, DEFAULT_DACTYL_CONTROLLER);
    const b = { floor: 4, bossHeight: 7, controller };
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
    // obudowa wtyku (12,4 × 6,5 mm) na wysokości środka gniazda nie zahacza o skorupę ani o dno
    const usbG = controller.ghosts.find((g) => g.kind === 'usb')!.box;
    const cz = (usbG.z0 + usbG.z1) / 2;
    const overmold = { ...usb, x0: -6.2, x1: 6.2, y0: HOLDER.plugFrom + 0.05, y1: 12, z0: cz - 3.25, z1: cz + 3.25 };
    expect(overmold.z0).toBeGreaterThan(0);
    expect(vol(shell, boxOf(overmold))).toBeLessThan(0.01);
    const bottom = buildDactylBottom(m, b);
    expect(isValidShape(bottom)).toBe(true);
    expect(vol(bottom, boxOf(overmold))).toBeLessThan(0.01);
    expect(measureVolume(bottom)).toBeGreaterThan(50000);
    // płytka leży w korytku dna bez kolizji
    for (const g of controller.ghosts) expect(vol(bottom, boxOf(g.box))).toBeLessThan(0.01);
    // podest na całą długość płytki pod jej środkiem i zaczep L nad jej końcem (trzyma od góry)
    const bd = controller.ghosts.find((g) => g.kind === 'board')!.box;
    const under = { ...bd, x0: -4, x1: 4, z0: bd.z0 - 0.5, z1: bd.z0 - 0.05 };
    expect(vol(bottom, boxOf(under))).toBeGreaterThan(0.95 * 8 * (bd.y1 - bd.y0) * 0.45);
    const lip = { ...bd, x0: -4, x1: 4, y1: bd.y0 + 1, z0: bd.z1 + 0.3, z1: bd.z1 + 1.3 };
    expect(vol(bottom, boxOf(lip))).toBeGreaterThan(0.95 * 8 * 1 * 1);
    // łeb chowa się w dnie 4 mm, nad nim zostaje 1 mm dna, a wokół łba pełny pierścień 1,2 mm
    const sp = m.screw;
    expect(dactylHeadDepth(sp, b.floor)).toBeGreaterThanOrEqual(sp.headDepth - 0.2);
    for (const [x, y] of m.screws) {
      const h = dactylHeadDepth(sp, b.floor);
      const ring = makeCylinder(sp.head / 2 + 1.2, h, [x, y, -b.floor], [0, 0, 1]).cut(makeCylinder(sp.head / 2 + 0.01, h, [x, y, -b.floor], [0, 0, 1]));
      expect(vol(bottom, ring as Shape3D) / measureVolume(ring as Shape3D)).toBeGreaterThan(0.999);
    }
  }, 300000);

  test('skorupa bez hot-swap: poprawna, komórki nietknięte', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'no-hotswap');
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height });
    const shell = buildDactylShell(m, cell, { floor: 3, bossHeight: 7, controller: controllerHolder(m, DEFAULT_DACTYL_CONTROLLER) });
    expect(isValidShape(shell)).toBe(true);
    for (const k of m.keys) expect(vol(shell, placeShape(cell.negative.clone(), k.frame))).toBeLessThan(0.5);
  }, 300000);
});
