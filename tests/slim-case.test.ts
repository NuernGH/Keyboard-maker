import { beforeAll, describe, expect, test } from 'vitest';
import { makeBox, measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, screwPilots, isValidShape } from '../src/lib/geometry';
import { TEMPLATES, splitLeft } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND, CONTROLLERS, type IslandParams } from '../src/lib/island';
import { caseLayout, DEFAULT_CASE, MX_PINS, SCREW_MARGIN, SLIM_CASE, STANDARD_LENGTHS, type CaseParams } from '../src/lib/case';

// Cienka obudowa: opcja dodatkowa, domyślne wartości bez zmian (analiza z 2026-11-07).
const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!.params;
const p60 = tpl('ansi-60');
const ip60: IslandParams = { ...DEFAULT_ISLAND, position: 'top', align: 'end', tilt: 25 };
const SLIM: CaseParams = { ...DEFAULT_CASE, ...SLIM_CASE, slim: true };

describe('cienka obudowa', () => {
  test('domyślnie wyłączona, 60% hot-swap bez zmian: 14,58 mm', () => {
    expect(DEFAULT_CASE.slim ?? false).toBe(false);
    const isl = islandFor(p60, ip60, 'left', 'hotswap', 8.58, SCREW_MARGIN);
    const cl = caseLayout(splitLeft(p60), isl, 8.58, DEFAULT_CASE);
    expect(cl.bottom).toBeCloseTo(-14.58, 6);
    expect(cl.screwLength).toBe(8);
  });

  test('60% hot-swap: 12,08 mm, M2,5×6 mieści się z łbem w dnie', () => {
    const isl = islandFor(p60, ip60, 'left', 'hotswap', 8.58, SCREW_MARGIN);
    const cl = caseLayout(splitLeft(p60), isl, 8.58, SLIM);
    expect(cl.bottom).toBeCloseTo(-12.08, 6);
    expect(cl.screw.size).toBe('M2.5');
    expect(cl.screwLength).toBe(6);
    expect(cl.screwWarn).toBeNull();
    expect(cl.headDepth).toBeGreaterThanOrEqual(cl.screw.headDepth - 1e-6);
  });

  test('bez hot-swap: dno pod końcami pinów MX (zawsze 0,8 mm, w cienkiej 1,2 mm)', () => {
    for (const id of ['ansi-60', 'macropad-3x3', 'split-4x6-4'])
      for (const isl of [true, false])
        for (const ctrl of Object.keys(CONTROLLERS)) {
          const p = tpl(id);
          const ip: IslandParams = { ...DEFAULT_ISLAND, enabled: isl, controller: ctrl as IslandParams['controller'], position: p.single ? 'top' : 'inner' };
          const g = islandFor(p, ip, 'left', 'no-hotswap', 5.08, SCREW_MARGIN);
          const keys = splitLeft(p);
          expect(caseLayout(keys, g, 5.08, DEFAULT_CASE).floorTop).toBeLessThanOrEqual(-MX_PINS.depth - MX_PINS.minGap + 1e-6);
          expect(caseLayout(keys, g, 5.08, SLIM).floorTop).toBeLessThanOrEqual(-MX_PINS.depth - MX_PINS.slimGap + 1e-6);
        }
    // 60% z nice!nano: 11,5 mm
    const g = islandFor(p60, ip60, 'left', 'no-hotswap', 5.08, SCREW_MARGIN);
    expect(caseLayout(splitLeft(p60), g, 5.08, SLIM).bottom).toBeCloseTo(-11.5, 6);
  });

  test('automatyczna długość śruby zawsze z listy pasujących, gdy jakaś pasuje', () => {
    for (const id of ['ansi-60', 'macropad-3x3', 'split-4x6-4'])
      for (const [variant, ch] of [['hotswap', 8.58], ['no-hotswap', 5.08]] as const)
        for (const cp of [DEFAULT_CASE, SLIM, { ...SLIM, screwSize: 'M3' as const }, { ...DEFAULT_CASE, floor: 4, space: 1 }]) {
          const p = tpl(id);
          const g = islandFor(p, { ...DEFAULT_ISLAND, position: p.single ? 'top' : 'inner' }, 'left', variant, ch, SCREW_MARGIN);
          const cl = caseLayout(splitLeft(p), g, ch, cp);
          expect(STANDARD_LENGTHS).toContain(cl.screwLength);
          if (cl.screwFits.length) {
            expect(cl.screwFits).toContain(cl.screwLength);
            // wkręcenie w płytę od 3 mm do dna otworu pilotowego
            const bite = cl.bottom + cl.headDepth + cl.screwLength + ch;
            expect(bite).toBeGreaterThanOrEqual(3 - 1e-6);
            expect(bite).toBeLessThanOrEqual(cl.pilotDepth + 1e-6);
          }
        }
  });
});

describe('cienka obudowa: bryły 60%', () => {
  beforeAll(initOC, 60000);
  test('spód i płyta poprawne, USB i kontroler wolne, spód cieńszy', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(p60);
    const island = islandFor(p60, ip60, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
    const opts = { fillGaps: 4, margin: SCREW_MARGIN, stabs: 'cherry' as const };
    const cl = caseLayout(keys, island, cell.height, SLIM, null, 'cherry');
    const plate = buildPlate(keys, cell, opts, island, screwPilots(cl.screws, cell.height, cl.pilotDepth));
    const shell = buildCase(keys, opts, island, cell.height, SLIM, cl);
    expect(isValidShape(shell)).toBe(true);
    expect(shell.boundingBox.bounds[0][2]).toBeCloseTo(-12.08, 2);
    const vol = (a: Shape3D, g: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }) =>
      measureVolume(a.clone().intersect(makeBox([g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1])));
    for (const gh of island.ghosts.filter((x) => x.kind === 'usb' || x.kind === 'nano')) {
      expect(vol(shell, gh.box)).toBeLessThan(0.01);
      expect(vol(plate, gh.box)).toBeLessThan(0.01);
    }
    // płyta i spód nie zachodzą na siebie
    expect(measureVolume(plate.clone().intersect(shell.clone()) as Shape3D)).toBeLessThan(0.05);
    // mniej materiału niż domyślny spód
    const clD = caseLayout(keys, island, cell.height, DEFAULT_CASE, null, 'cherry');
    const shellD = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, clD);
    expect(measureVolume(shell)).toBeLessThan(measureVolume(shellD) * 0.75);
  }, 240000);
});
