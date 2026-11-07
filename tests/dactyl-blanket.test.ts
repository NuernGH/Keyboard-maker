// Dactyl, skorupa „koc” (Manifold): zamknięta bryła, płyty i komórki nietknięte, miejsce na
// przełączniki, nakładki, kontroler i gniazdo USB wolne, kanały gniazd hot-swap zakryte.
import { beforeAll, describe, expect, test } from 'vitest';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { initOC, cellStep } from './oc';
import { loadCell, type Cell } from '../src/lib/geometry';
import { buildDactyl, capBox, DACTYL_DEFAULT } from '../src/lib/dactyl';
import { withBlanket } from '../src/lib/dactyl-blanket';
import { cellSideOpenings } from '../src/lib/dactyl-geometry';
import { controllerHolder, DEFAULT_DACTYL_CONTROLLER } from '../src/lib/dactyl-parts';
import { blanketShellMesh, box, fromShape, manifoldLib, mat4 } from '../src/lib/dactyl-mesh';

let M: ManifoldToplevel;
let cell: Cell;
beforeAll(async () => {
  await initOC();
  M = await manifoldLib();
  cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
}, 60000);

const vol = (a: Manifold, b: Manifold) => a.intersect(b).volume();

describe('Dactyl: skorupa „koc”', () => {
  test('zamknięta jedna bryła; płyty, komórki, przełączniki, nakładki, kontroler i USB bez kolizji', () => {
    const m = withBlanket(buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height }));
    const controller = controllerHolder(m, DEFAULT_DACTYL_CONTROLLER);
    const t0 = performance.now();
    const shell = blanketShellMesh(M, m, m.blanket, cell, { floor: 4, bossHeight: 7, controller, chamfer: 1 });
    expect((performance.now() - t0) / 1000).toBeLessThan(60);
    expect(shell.status()).toBe('NoError');
    expect(shell.decompose().length).toBe(1);
    expect(shell.boundingBox().min[2]).toBeGreaterThanOrEqual(-1e-3);

    const neg = fromShape(M, cell.negative);
    const ring = box(M, { x0: -7.9, x1: 7.9, y0: -7.9, y1: 7.9, z0: -0.3, z1: 0 });
    const plate = ring.volume() - vol(ring, neg);
    for (const k of m.keys) {
      const f = mat4(k.frame);
      // płyta pod kołnierzem przełącznika (15,6 mm) cała
      expect(vol(shell, ring.transform(f))).toBeGreaterThan(0.99 * plate);
      // komórka (gniazdo hot-swap, otwór) pusta
      expect(vol(shell, neg.transform(f))).toBeLessThan(0.05);
      // nad płytą: korpus przełącznika i nakładka mają wolne miejsce
      expect(vol(shell, box(M, { x0: -7.9, x1: 7.9, y0: -7.9, y1: 7.9, z0: 0.01, z1: 6.6, m: k.frame }))).toBeLessThan(0.05);
      const cb = capBox(m, k);
      const cap = box(M, { x0: -cb.h[0], x1: cb.h[0], y0: -cb.h[1], y1: cb.h[1], z0: cb.c[2] - cb.h[2], z1: cb.c[2] + cb.h[2], m: k.frame });
      expect(vol(shell, cap)).toBeLessThan(0.05);
    }

    // kanały gniazd hot-swap nie wychodzą na zewnątrz: tuż za bokiem klawisza jest materiał
    const open = cellSideOpenings(cell);
    let checked = 0;
    for (const k of m.keys)
      for (const o of open) {
        const ax = o.x1 - o.x0 < o.y1 - o.y0 ? 0 : 1;
        const sg = ax === 0 ? Math.sign(o.x0 + o.x1) : Math.sign(o.y0 + o.y1);
        const s = ax === 0 ? k.hw : k.hh;
        const zs = { z0: o.z0 + 1.2, z1: o.z1 - 1.2 };
        const b = ax === 0
          ? { x0: sg > 0 ? s + 0.05 : -s - 0.6, x1: sg > 0 ? s + 0.6 : -s - 0.05, y0: o.y0 + 1.2, y1: o.y1 - 1.2, ...zs, m: k.frame }
          : { y0: sg > 0 ? s + 0.05 : -s - 0.6, y1: sg > 0 ? s + 0.6 : -s - 0.05, x0: o.x0 + 1.2, x1: o.x1 - 1.2, ...zs, m: k.frame };
        const outside = box(M, b);
        // albo kanał jest zakryty materiałem tuż za bokiem, albo kończy się w pustym wnętrzu obudowy
        // pod kocem (w obrysie wewnętrznym, nad nim jest koc), czyli nie widać go z zewnątrz
        const inner = M.Manifold.extrude(new M.CrossSection([m.outline!.inner], 'Positive'), 200).translate([0, 0, -1]);
        const covered = vol(shell, outside) > 0.9 * outside.volume();
        const underBlanket = vol(outside, inner) > 0.99 * outside.volume() && vol(shell, box(M, { ...b, z0: o.z1, z1: 0 })) > 0.05;
        expect(covered || underBlanket).toBe(true);
        checked++;
      }
    expect(checked).toBe(m.keys.length * open.length);

    // kontroler: płytka i gniazdo USB (duchy) oraz otwór na wtyk wolne
    for (const g of controller.ghosts) expect(vol(shell, box(M, g.box))).toBeLessThan(0.05);
    for (const c of controller.shellCut) expect(vol(shell, box(M, c))).toBeLessThan(0.05);
    // tuleje śrub z otworem pilotowym
    for (const [x, y] of m.screws) {
      const r = m.screw.pilot / 2;
      expect(vol(shell, M.Manifold.cylinder(5, r * 0.9, r * 0.9, 24).translate([x, y, 0.2]))).toBeLessThan(0.05);
      const ringB = M.Manifold.cylinder(5, m.screw.boss / 2 - 0.2, m.screw.boss / 2 - 0.2, 24).subtract(M.Manifold.cylinder(5, r + 0.2, r + 0.2, 24)).translate([x, y, 0.5]);
      expect(vol(shell, ringB)).toBeGreaterThan(0.95 * ringB.volume());
    }
  }, 600000);
});
