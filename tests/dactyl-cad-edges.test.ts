// Dactyl: zamknięte boczne kanały komórek (dziura przy kciuku) i fazka ostrych krawędzi wierzchu.
import { beforeAll, describe, expect, test } from 'vitest';
import { makeBox, measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { isValidShape, loadCell } from '../src/lib/geometry';
import { buildDactyl, capBox, DACTYL_DEFAULT } from '../src/lib/dactyl';
import { boxOf, buildDactylShell, cellSideOpenings, SLOT_COVER } from '../src/lib/dactyl-geometry';
import { controllerHolder, DEFAULT_DACTYL_CONTROLLER } from '../src/lib/dactyl-parts';

beforeAll(async () => {
  await initOC();
}, 60000);

const vol = (a: Shape3D, b: Shape3D) => measureVolume(a.clone().intersect(b) as Shape3D);

describe('Dactyl: dziura przy kciuku i fazka', () => {
  test('kanał gniazda hot-swap zakryty, fazka na uskoku kciuka, płyta pod przełącznikiem nietknięta', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const open = cellSideOpenings(cell);
    // komórka z Part1.STEP ma kanały na blaszki gniazda po obu bokach X
    expect(open.length).toBe(2);
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height });
    const controller = controllerHolder(m, DEFAULT_DACTYL_CONTROLLER);
    const shell = buildDactylShell(m, cell, { floor: 4, bossHeight: 7, controller, chamfer: 1 });
    expect(isValidShape(shell)).toBe(true);
    const tr = m.keys.find((k) => k.thumb === 'tr')!;
    // górny klawisz kciuka stoi nad środkowym palcem: tuż za bokiem z kanałem jest teraz materiał
    const o = open.find((q) => q.x0 > 0)!;
    const outside = boxOf({ x0: tr.hw + 0.05, x1: tr.hw + 0.6, y0: o.y0 + 1, y1: o.y1 - 1, z0: o.z0 + 0.2, z1: o.z1 - 1, m: tr.frame });
    expect(vol(shell, outside) / measureVolume(outside)).toBeGreaterThan(0.95);
    expect(SLOT_COVER).toBeGreaterThanOrEqual(1.5);
    // fazka: górna krawędź tego boku ścięta (narożnik 0,5 × 0,5 mm pusty)
    const edge = boxOf({ x0: tr.hw - 0.45, x1: tr.hw, y0: -3, y1: 3, z0: -0.45, z1: 0, m: tr.frame });
    expect(vol(shell, edge)).toBeLessThan(0.05 * measureVolume(edge));
    const ref = makeBox([-7.9, -7.9, -0.3], [7.9, 7.9, 0]);
    const plate = measureVolume(ref) - measureVolume(cell.negative.clone().intersect(ref.clone()) as Shape3D);
    for (const k of m.keys) {
      // płyta pod kołnierzem przełącznika (15,6 mm) cała, fazka jej nie podcina
      const ring = boxOf({ x0: -7.9, x1: 7.9, y0: -7.9, y1: 7.9, z0: -0.3, z1: 0, m: k.frame });
      expect(vol(shell, ring)).toBeGreaterThan(0.995 * plate);
      // nad płytą nic nie wystaje: korpus przełącznika i nakładka mają wolne miejsce
      const sw = boxOf({ x0: -7.9, x1: 7.9, y0: -7.9, y1: 7.9, z0: 0.01, z1: 6.6, m: k.frame });
      expect(vol(shell, sw)).toBeLessThan(0.01);
      const cb = capBox(m, k);
      const cap = boxOf({ x0: -cb.h[0], x1: cb.h[0], y0: -cb.h[1], y1: cb.h[1], z0: cb.c[2] - cb.h[2], z1: cb.c[2] + cb.h[2], m: k.frame });
      expect(vol(shell, cap)).toBeLessThan(0.01);
    }
  }, 600000);
});
