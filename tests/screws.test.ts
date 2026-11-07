import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, makeBox, makeCylinder, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildCase, buildPlate, footprint, isValidShape } from '../src/lib/geometry';
import { SPLIT_4x6_4, TEMPLATES, splitLeft } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND } from '../src/lib/island';
import { caseLayout, screwPositions, screwSpec, BOSS_SKIN, DEFAULT_CASE, SCREW_MARGIN, SCREW_BITE } from '../src/lib/case';

beforeAll(initOC, 60000);
const opts = { fillGaps: 4, margin: SCREW_MARGIN };
const boards = [
  { name: 'split 4x6+4', p: SPLIT_4x6_4, ip: DEFAULT_ISLAND, o: opts },
  { name: '60% ANSI', p: TEMPLATES.find((t) => t.id === 'ansi-60')!.params, ip: { ...DEFAULT_ISLAND, position: 'top' as const, align: 'end' as const }, o: { ...opts, stabs: 'cherry' as const } },
];

describe('słupki śrub w obrysie obudowy', () => {
  for (const b of boards)
    test(`${b.name}: słupek nie wystaje poza ściankę przy ściance 2,4 / 1,6 / 1,2 mm`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const keys = splitLeft(b.p);
      const island = islandFor(b.p, b.ip, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
      for (const size of ['M3', 'M2.5'] as const) {
        const sp = screwSpec(size);
        // domyślna ścianka: pozycje bez zmian
        const def = caseLayout(keys, island, cell.height, { ...DEFAULT_CASE, screwSize: size });
        expect(def.screws).toEqual(screwPositions(keys, island, DEFAULT_CASE.screws, null, sp));
        for (const wall of [2.4, 1.6, 1.2]) {
          const cp = { ...DEFAULT_CASE, wall, screwSize: size };
          const lay = caseLayout(keys, island, cell.height, cp);
          expect(lay.screws.length, `${size} ${wall}`).toBeGreaterThanOrEqual(4);
          const outer = footprint(keys, b.o, island).offset(cp.gap + wall).sketchOnPlane('XY', -1).extrude(2) as Shape3D;
          for (const [x, y] of lay.screws) {
            const c = makeCylinder(sp.boss / 2 + BOSS_SKIN - 0.02, 1, [x, y, -0.5], [0, 0, 1]) as Shape3D;
            expect(measureVolume(c.cut(outer) as never), `${size} ${wall} (${x.toFixed(1)}, ${y.toFixed(1)})`).toBeLessThan(1e-4);
          }
        }
      }
    }, 300000);

  test('split 4x6+4, ścianka 1,2 mm: obudowa poprawna, bez kolizji z płytą i elektroniką, nic poza obrysem', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(SPLIT_4x6_4);
    const island = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
    const cp = { ...DEFAULT_CASE, wall: 1.2 };
    const lay = caseLayout(keys, island, cell.height, cp);
    const shell = buildCase(keys, opts, island, cell.height, cp, lay);
    expect(isValidShape(shell)).toBe(true);
    expect(shell.solids.length).toBe(1);
    const outer = footprint(keys, opts, island).offset(cp.gap + cp.wall).sketchOnPlane('XY', lay.bottom - 1).extrude(-lay.bottom + 2) as Shape3D;
    const bb = shell.boundingBox.bounds;
    const around = makeBox([bb[0][0] - 5, bb[0][1] - 5, bb[0][2] - 1], [bb[1][0] + 5, bb[1][1] + 5, bb[1][2] + 1]).cut(outer) as Shape3D;
    expect(measureVolume(shell.clone().intersect(around) as never)).toBeLessThan(0.001);
    for (const g of island.ghosts)
      expect(measureVolume(shell.clone().intersect(makeBox([g.box.x0, g.box.y0, g.box.z0], [g.box.x1, g.box.y1, g.box.z1])) as never), g.kind).toBeLessThan(0.01);
    const plate = buildPlate(keys, cell, opts, island);
    expect(measureVolume(plate.intersect(shell) as never)).toBeLessThan(0.01);
  }, 300000);
});

describe('długość śrub', () => {
  test('dobór automatyczny bez zmian, lista pasujących, za długa: ostrzeżenie i grubość dna', async () => {
    for (const variant of ['hotswap', 'no-hotswap'] as const) {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
      const auto = caseLayout([], null, cell.height, DEFAULT_CASE);
      expect(auto.screwWarn).toBeNull();
      // bez hot-swap i bez wyspy dno schodzi pod końce pinów MX, więc łeb może siedzieć głębiej w słupku
      if (variant === 'hotswap') expect(auto.headDepth).toBe(screwSpec('M3').headDepth);
      else expect(auto.headDepth).toBeGreaterThanOrEqual(screwSpec('M3').headDepth);
      expect(auto.screwFits).toContain(auto.screwLength);
      const bite = (l: typeof auto) => l.bottom + l.headDepth + l.screwLength + cell.height;
      for (const len of [6, 8, 10, 12, 14, 16, 20]) {
        const lay = caseLayout([], null, cell.height, { ...DEFAULT_CASE, screwLength: len });
        expect(lay.screwLength).toBe(len);
        if (auto.screwFits.includes(len)) {
          expect(lay.screwWarn, `${variant} ${len}`).toBeNull();
          expect(bite(lay)).toBeGreaterThanOrEqual(SCREW_BITE.min - 1e-6);
          expect(bite(lay)).toBeLessThanOrEqual(lay.pilotDepth + 1e-6);
        } else {
          expect(lay.screwWarn?.kind, `${variant} ${len}`).toBe('long');
          const floor = (lay.screwWarn as { floor: number }).floor;
          expect(floor).toBeGreaterThan(DEFAULT_CASE.floor);
          // przy podanym dnie śruba pasuje
          const fixed = caseLayout([], null, cell.height, { ...DEFAULT_CASE, screwLength: len, floor });
          expect(fixed.screwWarn, `${variant} ${len} dno ${floor}`).toBeNull();
          expect(bite(fixed)).toBeLessThanOrEqual(fixed.pilotDepth + 1e-6);
        }
      }
    }
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    expect(caseLayout([], null, cell.height, { ...DEFAULT_CASE, screwLength: 10 }).screwWarn).toEqual({ kind: 'long', floor: 4.2 });
  });

  test('krótka śruba przy dużym miejscu na przewody: łeb chowa się głębiej w słupku', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const cp = { ...DEFAULT_CASE, space: 8, screwLength: 6 };
    const lay = caseLayout([], null, cell.height, cp);
    expect(lay.screwWarn).toBeNull();
    expect(lay.headDepth).toBeGreaterThan(screwSpec('M3').headDepth + 3);
    const b = lay.bottom + lay.headDepth + 6 + cell.height;
    expect(b).toBeGreaterThanOrEqual(SCREW_BITE.min);
    // nad wybraniem zostaje materiał słupka pod płytą
    expect(-cell.height - (lay.bottom + lay.headDepth)).toBeGreaterThanOrEqual(0.6 - 1e-6);
  });
});
