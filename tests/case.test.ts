import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, buildLedge, footprint, screwPilots, isValidShape } from '../src/lib/geometry';
import { SPLIT_4x6_4, TEMPLATES, PITCH, splitLeft, mirrorKeys } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND } from '../src/lib/island';
import { makeBox, type Shape3D } from 'replicad';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN, SCREW_SPECS, LEDGE, type ScrewSize } from '../src/lib/case';

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
      for (const size of ['M3', 'M2.5'] as ScrewSize[])
      test(`${c.name}, ${variant}, ${size}`, async () => {
        const cp = { ...DEFAULT_CASE, screwSize: size };
        const sp = SCREW_SPECS[size];
        const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
        const base = splitLeft(c.p);
        const keys = c.side === 'left' ? base : mirrorKeys(base);
        const island = islandFor(c.p, c.ip, c.side, variant, cell.height, SCREW_MARGIN);
        const lay = caseLayout(keys, island, cell.height, cp);
        expect(lay.screw).toEqual(sp);
        expect(lay.screws.length).toBeGreaterThanOrEqual(4);
        expect(lay.usbCuts.length).toBeGreaterThanOrEqual(1);
        // otwory pilotowe trafiają w pełny materiał płyty (ubywa dokładnie ich objętości)
        const plain = buildPlate(keys, cell, opts, island);
        const pilots = screwPilots(lay.screws, cell.height, lay.pilotDepth, lay.screw);
        const plate = buildPlate(keys, cell, opts, island, pilots);
        expect(isValidShape(plate)).toBe(true);
        expect(plate.solids.length).toBe(1);
        const holeVol = lay.screws.length * Math.PI * (sp.pilot / 2) ** 2 * lay.pilotDepth;
        expect(measureVolume(plain) - measureVolume(plate)).toBeCloseTo(holeVol, 0);
        const shell = buildCase(keys, opts, island, cell.height, cp, lay);
        expect(isValidShape(shell)).toBe(true);
        // słupki i dno nie wchodzą w kontroler, USB ani moduł OLED
        for (const g of island!.ghosts) {
          const b = g.box;
          const hit = shell.clone().intersect(makeBox([b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1]));
          expect(measureVolume(hit as never), g.kind).toBeLessThan(0.01);
        }
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
        // wtyk USB-C z obudową (12,4 × 6,5 mm) na wysokości gniazda: od krawędzi płyty na zewnątrz
        // przechodzi przez płytę i ściankę bez kolizji (gniazdo nice!nano leży nisko, we wcięciu płytki)
        const usb = island!.ghosts.find((g) => g.kind === 'usb')!.box;
        const cx = (usb.x0 + usb.x1) / 2;
        const cz = (usb.z0 + usb.z1) / 2;
        const plug = makeBox([cx - 6.2, usb.y1 + 0.05, cz - 3.25], [cx + 6.2, usb.y1 + 15, cz + 3.25]);
        expect(measureVolume(plate.clone().intersect(plug.clone()) as never)).toBeLessThan(0.01);
        expect(measureVolume(shell.clone().intersect(plug) as never)).toBeLessThan(0.01);
      }, 240000);
});

describe('gzyms pod płytą', () => {
  for (const c of cases)
    for (const variant of ['hotswap', 'no-hotswap'] as const)
      test(`${c.name}, ${variant}`, async () => {
        const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
        const base = splitLeft(c.p);
        const keys = c.side === 'left' ? base : mirrorKeys(base);
        const island = islandFor(c.p, c.ip, c.side, variant, cell.height)!;
        const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE);
        const ledge = buildLedge(footprint(keys, opts, island), island, cell.height, DEFAULT_CASE, opts.margin, lay.floorTop)!;
        expect(ledge).not.toBeNull();
        expect(isValidShape(ledge)).toBe(true);
        // od dna do 0,1 mm pod płytą
        const bb = ledge.boundingBox.bounds;
        expect(bb[1][2]).toBeCloseTo(-cell.height - LEDGE.gap, 3);
        expect(bb[0][2]).toBeLessThanOrEqual(lay.floorTop);
        const vol = (a: Shape3D, b: Shape3D) => measureVolume(a.clone().intersect(b) as never);
        const plate = buildPlate(keys, cell, opts, island);
        expect(vol(ledge, plate)).toBeLessThan(0.01);
        // z dala od komórek (z przełącznikami i gniazdami hot-swap): klawisz poszerzony o 1 mm (w narożniku 1,41 < 1,5 mm), od dna do płyty
        for (const k of keys) {
          const hw = (k.w * PITCH) / 2 + 1;
          const hh = (k.h * PITCH) / 2 + 1;
          const box = makeBox([-hw, -hh, lay.floorTop - 1], [hw, hh, 0]).rotate(k.rot, [0, 0, 0], [0, 0, 1]).translate(k.x, k.y, 0) as Shape3D;
          expect(vol(ledge, box)).toBeLessThan(0.01);
        }
        // nie wchodzi w wyspę (kontroler, OLED) ani w gniazda i drogę wtyku USB
        const r = island.rect;
        expect(vol(ledge, makeBox([r.x0, r.y0, -50], [r.x1, r.y1, 0]) as Shape3D)).toBeLessThan(0.01);
        for (const g of island.ghosts)
          expect(vol(ledge, makeBox([g.box.x0, g.box.y0, g.box.z0], [g.box.x1, g.box.y1, g.box.z1]) as Shape3D)).toBeLessThan(0.01);
        for (const u of lay.usbCuts) expect(vol(ledge, makeBox([u.x0, u.y0, u.z0], [u.x1, u.y1, u.z1]) as Shape3D)).toBeLessThan(0.01);
        // obudowa z gzymsem: ma go (więcej materiału) i dalej nie zachodzi na płytę
        const without = buildCase(keys, opts, island, cell.height, { ...DEFAULT_CASE, ledge: 0 }, lay);
        const shell = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, lay);
        expect(isValidShape(shell)).toBe(true);
        expect(shell.solids.length).toBe(1);
        expect(measureVolume(shell) - measureVolume(without)).toBeGreaterThan(100);
        expect(vol(shell, plate)).toBeLessThan(0.01);
      }, 240000);

  test('pod kciukami płyta leży na gzymsie', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(SPLIT_4x6_4);
    const island = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'left', 'hotswap', cell.height);
    const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE);
    const ledge = buildLedge(footprint(keys, opts, island), island, cell.height, DEFAULT_CASE, opts.margin, lay.floorTop)!;
    const thumbs = keys.filter((k) => Math.abs(k.rot) > 1e-6);
    expect(thumbs.length).toBeGreaterThan(0);
    for (const k of thumbs) {
      // pas 6 mm poniżej klawisza (w układzie klawisza), tuż pod płytą
      const hh = (k.h * PITCH) / 2;
      const box = makeBox([-(k.w * PITCH) / 2, -hh - 6, -cell.height - 0.5], [(k.w * PITCH) / 2, hh + 6, -cell.height]).rotate(k.rot, [0, 0, 0], [0, 0, 1]).translate(k.x, k.y, 0) as Shape3D;
      expect(measureVolume(ledge.clone().intersect(box) as never)).toBeGreaterThan(5);
    }
  }, 240000);
});
