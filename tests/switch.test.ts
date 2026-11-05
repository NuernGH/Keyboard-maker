import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, makeBox, type Shape3D } from 'replicad';
import { initOC, cellStep, switchStep } from './oc';
import { loadCell, buildPlate } from '../src/lib/geometry';
import { loadSwitch } from '../src/lib/switch-model';
import { ANSI_60, splitLeft, switchSpots, TEMPLATES } from '../src/lib/layout';

const vol = (s: Shape3D) => {
  try {
    return measureVolume(s);
  } catch {
    return 0;
  }
};
const slab = (s: Shape3D, z0: number, z1: number) => (s.clone().intersect(makeBox([-50, -50, z0], [50, 50, z1])) as Shape3D).boundingBox.bounds;

describe('przełącznik Cherry MX w podglądzie', () => {
  let sw: Shape3D;
  beforeAll(async () => {
    await initOC();
    sw = await loadSwitch({ step: switchStep(), up: '+Y' });
  }, 60000);

  test('wymiary po ustawieniu: kołnierz na wierzchu płyty, trzpień na środku', () => {
    const bb = sw.boundingBox.bounds;
    expect(bb[1][2]).toBeCloseTo(10.05, 1); // czubek trzpienia
    expect(bb[0][2]).toBeCloseTo(-7.64, 1); // koniec pinów
    const stem = slab(sw, 8, 9);
    expect((stem[0][0] + stem[1][0]) / 2).toBeCloseTo(0, 2);
    expect((stem[0][1] + stem[1][1]) / 2).toBeCloseTo(0, 2);
    // tuż nad z = 0 kołnierz 15,64, tuż pod nim część w otworze płyty (≤ 14,0)
    const fl = slab(sw, 0.02, 0.1);
    expect(fl[1][0] - fl[0][0]).toBeCloseTo(15.64, 1);
    const fit = slab(sw, -1.2, -0.02);
    expect(fit[1][0] - fit[0][0]).toBeLessThanOrEqual(14.0);
    expect(fit[1][1] - fit[0][1]).toBeLessThanOrEqual(14.0);
  });

  for (const variant of ['hotswap', 'no-hotswap'] as const)
    test(`mieści się w płycie bez kolizji (${variant}, rząd ze stabilizatorem i z dwoma MX)`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
      const tpl = TEMPLATES.find((t) => t.id === 'ansi-60')!.params;
      const keys = splitLeft({ ...tpl, rowLayout: [ANSI_60[2]] }); // Caps … Enter 2,25U
      for (const stabs of ['cherry', 'mx'] as const) {
        const plate = buildPlate(keys, cell, { fillGaps: 4, margin: 2, stabs });
        for (const k of keys)
          for (const [x, y] of switchSpots(k, stabs)) {
            const s = sw.clone().rotate(k.rot, [0, 0, 0], [0, 0, 1]).translate(x, y, 0) as Shape3D;
            // 0,01 mm luzu na obwodzie otworu 14,0 daje ułamki mm³ z dokładności siatki
            expect(vol(s.intersect(plate.clone()) as Shape3D)).toBeLessThan(0.5);
          }
      }
    }, 300000);
});
