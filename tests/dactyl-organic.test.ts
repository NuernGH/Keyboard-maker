// Dactyl, skorupa organiczna (Manifold, woksele): jedna bryła, płyty i komórki nietknięte, miejsce
// na przełączniki, nakładki i kontroler wolne; wzór Woronoja drukowalny bez podpór (góra oczek ≥ 45°).
import { beforeAll, describe, expect, test } from 'vitest';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { initOC, cellStep } from './oc';
import { loadCell, type Cell } from '../src/lib/geometry';
import { buildDactyl, capBox, DACTYL_DEFAULT } from '../src/lib/dactyl';
import { DEFAULT_ORGANIC, ORGANIC_OUTLINE, withBlanket } from '../src/lib/dactyl-blanket';
import { controllerHolder, DEFAULT_DACTYL_CONTROLLER } from '../src/lib/dactyl-parts';
import { box, fromShape, manifoldLib, mat4 } from '../src/lib/dactyl-mesh';
import { organicShellMesh, PAT_RES, patternSection } from '../src/lib/dactyl-organic';

let M: ManifoldToplevel;
let cell: Cell;
beforeAll(async () => {
  await initOC();
  M = await manifoldLib();
  cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
}, 60000);

const vol = (a: Manifold, b: Manifold) => a.intersect(b).volume();

describe('Dactyl: skorupa organiczna', () => {
  test('wzór Woronoja: każdy wiersz otworu w zasięgu kroku od wiersza wyżej albo pojedynczy wierzchołek', () => {
    const len = 300, zLim = new Float32Array(Math.round(len / PAT_RES));
    for (let i = 0; i < zLim.length; i++) zLim[i] = 20 + 10 * Math.sin(i / 200);
    const { rows } = patternSection(len, zLim, 31, { ...DEFAULT_ORGANIC, pattern: 'holes' });
    expect(rows.length).toBeGreaterThan(100);
    const byZ = new Map<number, [number, number][]>();
    for (const [a, b, z] of rows) {
      const k = Math.round(z / PAT_RES);
      byZ.set(k, [...(byZ.get(k) ?? []), [Math.round(a / PAT_RES), Math.round(b / PAT_RES)]]);
    }
    let bad = 0;
    for (const [k, runs] of byZ) {
      const up = byZ.get(k + 1) ?? [];
      for (const [a, b] of runs) {
        // pojedynczy piksel = wierzchołek łuku; w szerszym kawałku każdy piksel ma nad sobą
        // (±1 piksel) otwór wiersz wyżej, czyli strop otworu schodzi najwyżej pod 45°
        if (b - a <= 1) continue;
        for (let x = a; x < b; x++) if (!up.some(([c, d]) => x >= c - 1 && x <= d)) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  for (const pattern of ['none', 'holes'] as const)
    test(`jedna bryła; płyty, komórki, przełączniki, nakładki i kontroler bez kolizji (wzór: ${pattern})`, () => {
      const m = withBlanket(buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height }), ORGANIC_OUTLINE);
      const controller = controllerHolder(m, DEFAULT_DACTYL_CONTROLLER);
      const t0 = performance.now();
      const shell = organicShellMesh(M, m, { ...DEFAULT_ORGANIC, pattern }, cell, { floor: 4, bossHeight: 7, controller, chamfer: 1 });
      expect((performance.now() - t0) / 1000).toBeLessThan(150);
      expect(shell.status()).toBe('NoError');
      expect(shell.decompose().length).toBe(1);
      expect(shell.boundingBox().min[2]).toBeGreaterThanOrEqual(-1e-3);

      const neg = fromShape(M, cell.negative);
      const ring = box(M, { x0: -7.9, x1: 7.9, y0: -7.9, y1: 7.9, z0: -0.3, z1: 0 });
      const plate = ring.volume() - vol(ring, neg);
      for (const k of m.keys) {
        const f = mat4(k.frame);
        expect(vol(shell, ring.transform(f))).toBeGreaterThan(0.99 * plate);
        expect(vol(shell, neg.transform(f))).toBeLessThan(0.05);
        expect(vol(shell, box(M, { x0: -7.9, x1: 7.9, y0: -7.9, y1: 7.9, z0: 0.01, z1: 6.6, m: k.frame }))).toBeLessThan(0.05);
        const cb = capBox(m, k);
        expect(vol(shell, box(M, { x0: -cb.h[0], x1: cb.h[0], y0: -cb.h[1], y1: cb.h[1], z0: cb.c[2] - cb.h[2], z1: cb.c[2] + cb.h[2], m: k.frame }))).toBeLessThan(0.05);
      }
      // kontroler i wtyk USB mieszczą się, wycięcia kontrolera są puste
      for (const g of controller.ghosts) expect(vol(shell, box(M, g))).toBeLessThan(0.05);
      for (const c of controller.shellCut) expect(vol(shell, box(M, c))).toBeLessThan(0.05);
      // tuleje śrub stoją (materiał wokół otworu pilotowego)
      for (const [x, y] of m.screws) {
        const r = m.screw.boss / 2;
        const ringB = M.Manifold.cylinder(5, r - 0.2, r - 0.2, 32).subtract(M.Manifold.cylinder(5, m.screw.pilot / 2 + 0.2, m.screw.pilot / 2 + 0.2, 32)).translate([x, y, 0.5]);
        expect(vol(shell, ringB)).toBeGreaterThan(0.95 * ringB.volume());
      }
      // skorupa leży w obrysie dna
      const bb = shell.boundingBox();
      const xs = m.outline!.outer.map((p) => p[0]);
      expect(bb.min[0]).toBeGreaterThan(Math.min(...xs) - 0.5);
      expect(bb.max[0]).toBeLessThan(Math.max(...xs) + 0.5);
    }, 300000);
});
