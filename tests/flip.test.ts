import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, makeBox } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, isValidShape } from '../src/lib/geometry';
import { SPLIT_4x6_4, splitLeft, mirrorKeys } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND, CONTROLLERS, PIN_GROOVE, CTRL_SCREW, pinsOf, type ControllerId, type IslandGeom } from '../src/lib/island';

beforeAll(initOC, 60000);

/** Wycięcia w dachu nad odwróconą płytką (zaczynają się 0,01 mm pod jej płaską stroną). */
const roofCuts = (g: IslandGeom) => {
  const board = g.ghosts.find((p) => p.kind === 'nano')!.box;
  return g.cuts.filter((c) => Math.abs(c.z0 - (board.z1 - 0.01)) < 1e-9);
};
type Cut = IslandGeom['cuts'][number];
/** objętość wycięcia ponad płaszczyzną z = face (pod nią jest już kieszeń) */
const vol = (c: Cut, face: number) => {
  const h = c.z1 - Math.max(c.z0, face);
  return c.round ? Math.PI * ((c.x1 - c.x0) / 2) ** 2 * h : (c.x1 - c.x0) * (c.y1 - c.y0) * h;
};
const overlap = (a: Cut, b: Cut) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) *
  Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));

describe('odwrócony kontroler', () => {
  for (const controller of ['nicenano', 's2mini', 'esp32s3'] as ControllerId[])
    for (const side of ['left', 'right'] as const)
      for (const pins of [false, true])
        test(`${controller}, ${side === 'left' ? 'z modułem' : 'bez modułu'}, goldpiny: ${pins}`, async () => {
          const c = CONTROLLERS[controller];
          const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
          const base = splitLeft(SPLIT_4x6_4);
          const keys = side === 'left' ? base : mirrorKeys(base);
          const g = islandFor(SPLIT_4x6_4, { ...DEFAULT_ISLAND, controller, pins }, side, 'hotswap', cell.height)!;
          const board = g.ghosts.find((p) => p.kind === 'nano')!;
          expect(board.flip).toBe(true);
          const b = board.box;
          // płaska strona płytki leży na stropie kieszeni (do przyklejenia)
          const pocket = g.cuts.find((k) => k.x0 <= b.x0 && k.x1 >= b.x1 && k.y0 <= b.y0 && k.y1 >= b.y1 && k.z0 < b.z0)!;
          expect(pocket.z1).toBeCloseTo(b.z1, 9);
          // gniazdo USB w dół od płaskiej strony (nice!nano wystaje 0,2 mm ponad nią, do wnęki)
          const usb = g.ghosts.find((p) => p.kind === 'usb')!.box;
          expect(usb.z1).toBeCloseTo(b.z1 - (c.usbZ0 ?? c.pcb ?? 1.6), 9);
          const roof = roofCuts(g);
          if ((c.usbZ0 ?? 0) < 0) expect(roof.some((r) => r.z1 >= usb.z1 + 0.2 - 1e-9 && r.x0 <= usb.x0 && r.x1 >= usb.x1)).toBe(true);
          // rowki na piny tylko przy goldpinach, wkręty tylko przy płytce z otworami
          const grooves = roof.filter((r) => !r.round && Math.abs(r.z1 - b.z1 - PIN_GROOVE.depth) < 1e-9);
          expect(grooves.length).toBe(pins ? 2 : 0);
          const pilots = roof.filter((r) => r.round);
          expect(pilots.length).toBe(2 * (c.holes?.length ?? 0));
          for (const p of pilots) expect(p.z1 - b.z1).toBeCloseTo(CTRL_SCREW.depth + 0.01 - 0.01, 6);
          // rowki obejmują rzędy pinów na całej długości
          if (pins) {
            const along = b.y1 - b.y0 > b.x1 - b.x0;
            const len = (r: typeof b) => (along ? r.y1 - r.y0 : r.x1 - r.x0);
            const p = pinsOf(c);
            for (const gr of grooves) expect(len(gr)).toBeCloseTo(p.y1 - p.y0 + 2 * PIN_GROOVE.half, 6);
          }
          // nad wycięciami zostaje co najmniej 1 mm płyty
          for (const r of roof) expect(r.z1).toBeLessThanOrEqual(-1 + 1e-9);
          const plate = buildPlate(keys, cell, undefined, g);
          expect(isValidShape(plate)).toBe(true);
          expect(plate.solids.length).toBe(1);
          // rowki i otwory pilotowe trafiają w pełny materiał: nie przebijają się do gniazda modułu ani na wierzch.
          // Wyjątek: przy szerokim ESP32 pod modułem rowek zahacza o przelotowy przepust na piny modułu.
          const holes = [...grooves, ...pilots];
          if (holes.length) {
            const plain = buildPlate(keys, cell, undefined, { ...g, cuts: g.cuts.filter((k) => !holes.includes(k)) });
            const slots = g.cuts.filter((k) => !k.round && !holes.includes(k) && k !== pocket && k.z1 >= 1);
            const expected = holes.reduce((s, h) => s + vol(h, b.z1) - slots.reduce((t, k) => t + overlap(h, k), 0), 0);
            expect(measureVolume(plain) - measureVolume(plate)).toBeCloseTo(expected, 0);
          }
          // wtyk USB-C z obudową (12,4 × 6,5 mm) przechodzi przez krawędź płyty bez kolizji
          const cx = (usb.x0 + usb.x1) / 2;
          const cz = (usb.z0 + usb.z1) / 2;
          const plug = makeBox([cx - 6.2, usb.y1 + 0.05, cz - 3.25], [cx + 6.2, usb.y1 + 15, cz + 3.25]);
          expect(measureVolume(plate.clone().intersect(plug) as never)).toBeLessThan(0.01);
        }, 240000);

  test('bez odwrócenia płytka leży elementami do góry, bez rowków', () => {
    const g = islandFor(SPLIT_4x6_4, { ...DEFAULT_ISLAND, flip: false, pins: true }, 'left', 'hotswap', 8.58)!;
    const board = g.ghosts.find((p) => p.kind === 'nano')!;
    expect(board.flip).toBe(false);
    expect(roofCuts(g).length).toBe(0);
  });
});
