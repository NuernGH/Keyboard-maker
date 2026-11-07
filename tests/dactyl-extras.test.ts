// Dactyl: włącznik, gniazdo między połówkami i bateria (opcje) bez kolizji z komórkami, kontrolerem i śrubami.
import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { isValidShape, loadCell } from '../src/lib/geometry';
import { buildDactyl, DACTYL_DEFAULT, apply } from '../src/lib/dactyl';
import { boxOf, buildDactylBottom, buildDactylShell, placeShape } from '../src/lib/dactyl-geometry';
import { controllerHolder, DEFAULT_DACTYL_CONTROLLER, type PartBox } from '../src/lib/dactyl-parts';
import { dactylExtras, mergeParts } from '../src/lib/dactyl-extras';
import { DEFAULT_EXTRAS, BATTERY_PRESETS, type CaseExtras, type LinkKind, type WallSide } from '../src/lib/case-extras';

const ex = (kind: LinkKind, side: WallSide = 'back'): CaseExtras => ({
  power: { ...DEFAULT_EXTRAS.power, on: true, side },
  link: { ...DEFAULT_EXTRAS.link, on: true, kind, side },
  battery: { on: true, l: BATTERY_PRESETS[4].l, w: BATTERY_PRESETS[4].w, t: BATTERY_PRESETS[4].t },
});
const pts = (b: PartBox) => {
  const out: number[][] = [];
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) out.push(b.m ? apply(b.m, [x, y, z]) : [x, y, z]);
  return out;
};

describe('Dactyl: dodatki (bez CAD)', () => {
  test('wyłączone = brak zmian', () => {
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: 8.58 });
    expect(dactylExtras(m, undefined, null)).toBeNull();
    expect(dactylExtras(m, DEFAULT_EXTRAS, null)).toBeNull();
  });
  for (const H of [8.58, 5.08])
    for (const side of ['back', 'front', 'inner', 'outer'] as const)
      test(`${H === 8.58 ? 'hot-swap' : 'bez hot-swap'}, ścianka ${side}: wszystko ustawione, z dala od śrub`, () => {
        const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: H });
        const h = controllerHolder(m, DEFAULT_DACTYL_CONTROLLER);
        const e = dactylExtras(m, ex('trrs', side), h)!;
        expect(e.warns.filter((w) => w.kind === 'noSpot' || w.kind === 'tooTall')).toEqual([]);
        expect(e.ghosts.map((g) => g.kind)).toEqual(expect.arrayContaining(['switch', 'jack', 'battery']));
        // części leżą na dnie (z ≥ 0) i z dala od tulei śrub
        for (const g of e.ghosts) {
          const p = pts(g.box);
          expect(Math.min(...p.map((q) => q[2]))).toBeGreaterThanOrEqual(-1e-6);
          for (const [x, y] of m.screws) for (const q of p) expect(Math.hypot(q[0] - x, q[1] - y)).toBeGreaterThan(m.screw.boss / 2);
        }
      });
});

describe('Dactyl: dodatki w bryłach (CAD)', () => {
  beforeAll(initOC, 60000);
  const vol = (a: Shape3D, b: Shape3D) => measureVolume(a.clone().intersect(b) as Shape3D);
  for (const kind of ['trrs', 'usbc'] as const)
    test(`skorupa i dno z włącznikiem, ${kind} i baterią: komórki nietknięte, części bez kolizji`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height });
      const holder = controllerHolder(m, DEFAULT_DACTYL_CONTROLLER);
      const extras = dactylExtras(m, ex(kind), holder)!;
      const controller = mergeParts(holder, extras)!;
      const b = { floor: 4, bossHeight: 7, controller };
      const shell = buildDactylShell(m, cell, b);
      expect(isValidShape(shell)).toBe(true);
      // komórki (otwór, kieszeń hot-swap) nie są zasypane ani rozcięte przez kieszenie części
      for (const k of m.keys) expect(vol(shell, placeShape(cell.negative.clone(), k.frame))).toBeLessThan(0.5);
      // części nie wchodzą w skorupę ani w dno, kołyski nie wchodzą w części
      const bottom = buildDactylBottom(m, b);
      expect(isValidShape(bottom)).toBe(true);
      for (const g of extras.ghosts) {
        const s = boxOf(g.box);
        expect(vol(shell, s), `${g.kind} w skorupie`).toBeLessThan(0.05);
        expect(vol(bottom, s), `${g.kind} w dnie`).toBeLessThan(0.05);
        // ani w kontroler i jego gniazdo
        for (const c of holder.ghosts) expect(vol(boxOf(c.box), s), `${g.kind} w kontrolerze`).toBeLessThan(0.01);
      }
    }, 600000);
});
