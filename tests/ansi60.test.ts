import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, screwPilots, isValidShape, stabCuts, platePiece, casePiece } from '../src/lib/geometry';
import { TEMPLATES, splitLeft, switchOffsets, switchSpots, ANSI_60, parseRowLayout, rowLayoutToText, keysOverlap, PITCH } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND, type IslandParams } from '../src/lib/island';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN } from '../src/lib/case';
import { planSplit, plateBounds, pieceOf, seamScrewTargets, DEFAULT_PRINT } from '../src/lib/split';

const tpl = TEMPLATES.find((t) => t.id === 'ansi-60')!.params;
const ip: IslandParams = { ...DEFAULT_ISLAND, position: 'top', align: 'end' };
const opts = { fillGaps: 4, margin: SCREW_MARGIN, stabs: 'cherry' as const };
const caseExtra = DEFAULT_CASE.gap + DEFAULT_CASE.wall;

describe('układ 60% ANSI', () => {
  test('61 klawiszy, 15U szerokości, bez nakładania', () => {
    const keys = splitLeft(tpl);
    expect(keys.length).toBe(61);
    for (const row of ANSI_60) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(15, 6);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) expect(keysOverlap(keys[i], keys[j])).toBe(false);
    expect(keys.filter((k) => k.w >= 2).map((k) => k.w)).toEqual([2, 2.25, 2.25, 2.75, 6.25]);
  });

  test('tekst rzędów w obie strony, przerwy jako liczby ujemne', () => {
    expect(parseRowLayout(rowLayoutToText(ANSI_60))).toEqual(ANSI_60);
    const keys = splitLeft({ ...tpl, rowLayout: parseRowLayout('1 -0,5 1\n2') });
    expect(keys.length).toBe(3);
    expect(keys[1].x - keys[0].x).toBeCloseTo(1.5 * PITCH, 6);
  });

  test('wymiary jak na szkicu (ok. 298 × 145 mm z wyspą u góry)', () => {
    const keys = splitLeft(tpl);
    const island = islandFor(tpl, ip, 'left', 'hotswap', 8.58);
    const b = plateBounds(keys, island, SCREW_MARGIN);
    expect(b.x1 - b.x0).toBeCloseTo(15 * PITCH + 12, 1);
    expect(b.y1 - b.y0).toBeCloseTo(5 * PITCH + 38 + 12, 1);
    // wyspa w prawym górnym rogu, nad klawiszami
    expect(island!.rect.x1).toBeCloseTo(14.5 * PITCH, 3);
    expect(island!.rect.y0).toBeCloseTo(PITCH / 2, 3);
  });
});

describe('dwa MX zamiast stabilizatora', () => {
  test('2–2,75U: dwa przełączniki pod trzpieniami stabilizatora, spacja: trzy', () => {
    const keys = splitLeft(tpl);
    const by = (w: number) => keys.find((k) => k.w === w)!;
    expect(switchOffsets(by(2), 'mx')).toEqual([-11.9, 11.9]);
    expect(switchOffsets(by(2.75), 'mx')).toEqual([-11.9, 11.9]);
    expect(switchOffsets(by(6.25), 'mx')).toEqual([-50, 0, 50]);
    expect(switchOffsets(by(1.75), 'mx')).toEqual([0]);
    expect(switchOffsets(by(2), 'cherry')).toEqual([0]);
    // klawisz pionowy: przełączniki wzdłuż osi Y
    expect(switchSpots({ id: 'v', x: 0, y: 0, rot: 0, w: 1, h: 2 }, 'mx')).toEqual([[0, -11.9], [0, 11.9]]);
    // obudowy MX (15,6 mm) nie zderzają się w żadnym klawiszu
    const spots = keys.flatMap((k) => switchSpots(k, 'mx'));
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        if (Math.abs(spots[i][1] - spots[j][1]) < 1) expect(Math.abs(spots[i][0] - spots[j][0])).toBeGreaterThanOrEqual(15.6);
  });
});

describe('podział do druku', () => {
  const keys = splitLeft(tpl);
  const island = islandFor(tpl, ip, 'left', 'hotswap', 8.58);
  test('stół 250 × 250: dwie części, każda się mieści, szwy w różnych miejscach', () => {
    const sp = planSplit(keys, island, SCREW_MARGIN, caseExtra, DEFAULT_PRINT)!;
    expect(sp).not.toBeNull();
    expect(sp.fits).toBe(true);
    for (const [w, h] of [...sp.plateParts, ...sp.caseParts]) expect(Math.min(w, h)).toBeLessThanOrEqual(250);
    const xs = sp.seam.map((p) => p[0]);
    expect(Math.min(Math.abs(sp.caseX - Math.min(...xs)), Math.abs(sp.caseX - Math.max(...xs)))).toBeGreaterThanOrEqual(PITCH - 1e-6);
    // szew nie przecina klawiszy: każdy klawisz w całości po jednej stronie
    for (const k of keys) {
      const hw = (k.w * PITCH) / 2 - 0.5;
      expect(pieceOf(sp, k.x - hw, k.y)).toBe(pieceOf(sp, k.x + hw, k.y));
    }
    // wyspa w całości w jednej części
    const r = island!.rect;
    expect(pieceOf(sp, r.x0 + 0.5, r.y0 + 0.5)).toBe(pieceOf(sp, r.x1 - 0.5, r.y1 - 0.5));
    // śruby po obu stronach obu szwów
    const lay = caseLayout(keys, island, 8.58, { ...DEFAULT_CASE, screws: 6 }, sp);
    const near = (x: number) => lay.screws.filter((s) => Math.abs(s[0] - x) < 20);
    expect(near(sp.caseX).some((s) => s[0] < sp.caseX) && near(sp.caseX).some((s) => s[0] > sp.caseX)).toBe(true);
    expect(lay.screws.every((s) => Math.abs(s[0] - sp.caseX) > 4)).toBe(true);
    // przy każdym miejscu docelowym (oba szwy, góra i dół) jest śruba w promieniu 12 mm
    for (const t of seamScrewTargets(sp, keys, SCREW_MARGIN))
      expect(Math.min(...lay.screws.map((s) => Math.hypot(s[0] - t[0], s[1] - t[1])))).toBeLessThan(12);
  });
  test('duży stół: bez cięcia', () => {
    expect(planSplit(keys, island, SCREW_MARGIN, caseExtra, { ...DEFAULT_PRINT, bedX: 320, bedY: 320 })).toBeNull();
    expect(planSplit(keys, island, SCREW_MARGIN, caseExtra, { ...DEFAULT_PRINT, mode: 'off' })).toBeNull();
  });
});

describe('bryły 60%', () => {
  beforeAll(initOC, 60000);
  for (const variant of ['hotswap', 'no-hotswap', 'thin-plate'] as const)
    test(`stabilizatory, ${variant}`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
      // jeden klawisz 2U: płyta bez stabilizatorów minus z nimi = objętość wycięć poza komórką
      const k = [{ id: 'a', x: 0, y: 0, rot: 0, w: 2, h: 1 }];
      const o = { fillGaps: 0, margin: 2 };
      const without = buildPlate(k, cell, { ...o, stabs: 'none' });
      const withStab = buildPlate(k, cell, { ...o, stabs: 'cherry' });
      expect(isValidShape(withStab)).toBe(true);
      expect(withStab.solids.length).toBe(1);
      expect(measureVolume(without) - measureVolume(withStab)).toBeGreaterThan(50);
      expect(stabCuts({ ...k[0], w: 1.75 }, cell.height)).toEqual([]);
    }, 120000);

  for (const variant of ['hotswap', 'no-hotswap'] as const)
    test(`dwa MX zamiast stabilizatora, cały rząd z Backspace 2U, ${variant}`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
      const keys = splitLeft({ ...tpl, rowLayout: [ANSI_60[0], ANSI_60[4]] });
      const o = { fillGaps: 4, margin: 2 };
      const plate = buildPlate(keys, cell, { ...o, stabs: 'mx' });
      expect(isValidShape(plate)).toBe(true);
      expect(plate.solids.length).toBe(1);
      // więcej materiału ubywa niż przy samym przełączniku na środku
      expect(measureVolume(buildPlate(keys, cell, { ...o, stabs: 'none' }))).toBeGreaterThan(measureVolume(plate));
    }, 120000);

  test('cała płyta i spód hot-swap, podział na części', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(tpl);
    const island = islandFor(tpl, ip, 'left', 'hotswap', cell.height);
    const sp = planSplit(keys, island, SCREW_MARGIN, caseExtra, DEFAULT_PRINT)!;
    const lay = caseLayout(keys, island, cell.height, { ...DEFAULT_CASE, screws: 6 }, sp);
    let t = performance.now();
    const plate = buildPlate(keys, cell, opts, island, screwPilots(lay.screws, cell.height, lay.pilotDepth));
    console.log('płyta', Math.round(performance.now() - t), 'ms');
    expect(isValidShape(plate)).toBe(true);
    expect(plate.solids.length).toBe(1);
    t = performance.now();
    const parts = [platePiece(plate, sp, DEFAULT_PRINT.clearance, 0), platePiece(plate, sp, DEFAULT_PRINT.clearance, 1)];
    console.log('części płyty', Math.round(performance.now() - t), 'ms');
    const v = measureVolume(plate);
    for (const p of parts) {
      expect(isValidShape(p)).toBe(true);
      expect(p.solids.length).toBe(1);
      const bb = p.boundingBox.bounds;
      expect(bb[1][0] - bb[0][0]).toBeLessThanOrEqual(250);
    }
    // luz w szwie zabiera bardzo mało materiału
    const lost = v - measureVolume(parts[0]) - measureVolume(parts[1]);
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(400);
    // części nie nachodzą na siebie
    expect(measureVolume(parts[0].clone().intersect(parts[1].clone()) as never)).toBeLessThan(0.01);

    const shell = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, lay);
    expect(isValidShape(shell)).toBe(true);
    const cparts = [casePiece(shell, sp.caseX, 0), casePiece(shell, sp.caseX, 1)];
    for (const p of cparts) {
      expect(p.solids.length).toBe(1);
      const bb = p.boundingBox.bounds;
      expect(bb[1][0] - bb[0][0]).toBeLessThanOrEqual(250);
    }
    expect(measureVolume(cparts[0]) + measureVolume(cparts[1])).toBeCloseTo(measureVolume(shell), 0);
    expect(measureVolume(plate.clone().intersect(shell.clone()) as never)).toBeLessThan(0.01);
  }, 600000);
});
