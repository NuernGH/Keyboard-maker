import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, screwPilots, isValidShape } from '../src/lib/geometry';
import { SPLIT_4x6_4, TEMPLATES, splitLeft, mirrorKeys } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND } from '../src/lib/island';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN, CASE_SCREW } from '../src/lib/case';

beforeAll(initOC, 60000);
const opts = { fillGaps: 4, margin: SCREW_MARGIN };

const cases = [
  { name: 'split 4x6+4 lewa', p: SPLIT_4x6_4, side: 'left' as const, ip: DEFAULT_ISLAND },
  { name: 'split 4x6+4 prawa', p: SPLIT_4x6_4, side: 'right' as const, ip: DEFAULT_ISLAND },
  { name: 'macropad 3x3, wyspa u góry', p: TEMPLATES.find((t) => t.id === 'macropad-3x3')!.params, side: 'left' as const, ip: { ...DEFAULT_ISLAND, position: 'top' as const } },
];

describe('spód obudowy', () => {
  for (const c of cases)
    for (const variant of ['hotswap', 'no-hotswap'] as const)
      test(`${c.name}, ${variant}`, async () => {
        const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
        const base = splitLeft(c.p);
        const keys = c.side === 'left' ? base : mirrorKeys(base);
        const island = islandFor(c.p, c.ip, c.side, variant, cell.height);
        const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE);
        expect(lay.screws.length).toBeGreaterThanOrEqual(4);
        expect(lay.usbCuts.length).toBeGreaterThanOrEqual(1);
        // otwory pilotowe trafiają w pełny materiał płyty (ubywa dokładnie ich objętości)
        const plain = buildPlate(keys, cell, opts, island);
        const pilots = screwPilots(lay.screws, cell.height, lay.pilotDepth);
        const plate = buildPlate(keys, cell, opts, island, pilots);
        expect(isValidShape(plate)).toBe(true);
        expect(plate.solids.length).toBe(1);
        const holeVol = lay.screws.length * Math.PI * (CASE_SCREW.pilot / 2) ** 2 * lay.pilotDepth;
        expect(measureVolume(plain) - measureVolume(plate)).toBeCloseTo(holeVol, 0);
        const shell = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, lay);
        expect(isValidShape(shell)).toBe(true);
        expect(shell.solids.length).toBe(1);
        // płyta mieści się w obudowie bez kolizji
        const clash = plate.clone().intersect(shell.clone());
        expect(measureVolume(clash as never)).toBeLessThan(0.01);
        expect(lay.screwLength).toBeGreaterThan(0);
        // podkładka dociska kontroler: kończy się 0,2 mm pod płytką
        expect(lay.pads.length).toBe(1);
        const board = island!.ghosts.find((g) => g.kind === 'nano')!.box;
        expect(board.z0 - lay.pads[0].z1).toBeCloseTo(0.2, 6);
        expect(lay.pads[0].x0).toBeGreaterThan(board.x0);
        expect(lay.pads[0].x1).toBeLessThan(board.x1);
      }, 240000);
});
