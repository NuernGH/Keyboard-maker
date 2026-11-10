// Opcje przy wyspie (2026-11-09): śruby spodu przy wyspie, kieszeń na przewody w dnie, pusty klin pod modułem OLED.
import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, makeBox, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, buildWedge, screwPilots, isValidShape } from '../src/lib/geometry';
import { TEMPLATES, splitLeft, keyCorners } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND, type IslandParams, type ControllerId } from '../src/lib/island';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN, CABLE_POCKET, SLIM_CASE, type CaseParams } from '../src/lib/case';
import { DEFAULT_EXTRAS } from '../src/lib/case-extras';
import { planSplit, DEFAULT_PRINT } from '../src/lib/split';

const tpl = TEMPLATES.find((t) => t.id === 'ansi-60')!.params;
const keys = splitLeft(tpl);
const H = 8.58;
// klawiatura Marcina: 60% z S2 mini, wyspa w prawym górnym rogu, klin 25°, USB w lewo
const MARCIN: IslandParams = { ...DEFAULT_ISLAND, position: 'top', align: 'end', controller: 's2mini', tilt: 25, usbDir: 'left' };
const opts = { fillGaps: 4, margin: SCREW_MARGIN, stabs: 'mx' as const };
const ALL: Partial<CaseParams> = { islandScrews: true, cablePocket: 'island' };
const layout = (ip: IslandParams, cp: Partial<CaseParams> = {}) => {
  const g = islandFor(tpl, ip, 'left', 'hotswap', H, SCREW_MARGIN)!;
  const split = planSplit(keys, g, SCREW_MARGIN, DEFAULT_CASE.gap + DEFAULT_CASE.wall, DEFAULT_PRINT);
  return { g, split, cl: caseLayout(keys, g, H, { ...DEFAULT_CASE, ...cp }, split, 'mx', { single: true, margin: SCREW_MARGIN }) };
};
const overlap = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('opcje przy wyspie: domyślnie wyłączone', () => {
  test('bez opcji spód i klin jak dotąd', () => {
    const { g, cl } = layout(MARCIN);
    expect(cl.islandScrews).toBeUndefined();
    expect(cl.cablePocket).toBeUndefined();
    const off = islandFor(tpl, { ...MARCIN, wedgeHollow: false }, 'left', 'hotswap', H, SCREW_MARGIN)!;
    const none = islandFor(tpl, { ...MARCIN, wedgeHollow: undefined }, 'left', 'hotswap', H, SCREW_MARGIN)!;
    expect(off).toEqual(none);
    expect(g.wedge!.screws).toEqual(none.wedge!.screws);
    const on = layout(MARCIN, ALL).cl;
    // zwykłe śruby się nie zmieniają, dochodzą tylko dwie przy wyspie
    expect(on.screws.slice(0, cl.screws.length)).toEqual(cl.screws);
    expect(on.screws.length).toBe(cl.screws.length + 2);
  });
});

describe('śruby przy wyspie', () => {
  for (const [name, ip] of [
    ['60% S2 mini, USB w lewo (Marcin)', MARCIN],
    ['60% nice!nano, auto', { ...DEFAULT_ISLAND, position: 'top', align: 'end', tilt: 25 }],
    ['60% ESP32-S3 w tył', { ...MARCIN, controller: 'esp32s3' as ControllerId, usbDir: 'back' }],
  ] as [string, IslandParams][])
    test(`${name}: dwa narożniki od tyłu, poza kieszeniami, w obrysie`, () => {
      const { g, cl } = layout(ip, ALL);
      const s = cl.islandScrews!;
      expect(s.length).toBe(2);
      const r = g.rect;
      const R = cl.screw.boss / 2;
      for (const [x, y] of s) {
        // za wyspą (od strony bez klawiszy), przy narożniku
        expect(y).toBeGreaterThan(r.y1);
        expect(Math.min(Math.abs(x - r.x0), Math.abs(x - r.x1))).toBeLessThan(4);
        // słupek w obrysie obudowy: do krawędzi wyspy najwyżej margines + luz + ścianka − słupek − 0,4
        const dx = Math.max(r.x0 - x, 0, x - r.x1);
        expect(Math.hypot(dx, y - r.y1)).toBeLessThanOrEqual(SCREW_MARGIN + DEFAULT_CASE.gap + DEFAULT_CASE.wall - R - 0.4 + 1e-6);
        // słupek nie wchodzi w otwory wyspy schodzące pod płytę (kieszeń kontrolera, USB, przepusty, łby śrub klina)
        for (const c of g.cuts.filter((c) => c.z0 < -H)) expect(overlap({ x0: x - R, x1: x + R, y0: y - R, y1: y + R }, c) && Math.hypot(Math.max(c.x0 - x, 0, x - c.x1), Math.max(c.y0 - y, 0, y - c.y1)) < R).toBe(false);
        for (const k of keys) for (const [kx, ky] of keyCorners(k)) expect(Math.hypot(kx - x, ky - y)).toBeGreaterThan(3);
      }
    });

  test('Marcin: śruba A obok kontrolera po stronie USB, C w prawym tylnym narożniku', () => {
    const { g, cl } = layout(MARCIN, ALL);
    const [a, c] = cl.islandScrews!;
    expect(a[0]).toBeLessThan(g.rect.x0);
    expect(c[0]).toBeGreaterThan(g.rect.x1);
    // C po skosie 3 mm od narożnika wyspy
    const d = Math.hypot(c[0] - g.rect.x1, c[1] - g.rect.y1);
    expect(d).toBeGreaterThan(2.7);
    expect(d).toBeLessThan(3.3);
  });
});

describe('kieszeń na przewody w dnie', () => {
  test('pod kontrolerem i pod całą wyspą: 2 mm, w obrysie wyspy z kontrolerem', () => {
    const { g, cl } = layout(MARCIN, { cablePocket: 'controller' });
    const n = g.ghosts.find((x) => x.kind === 'nano')!.box;
    const p = cl.cablePocket!;
    expect(p.z1 - p.z0).toBeCloseTo(CABLE_POCKET.depth + 0.01, 6);
    expect(p.x0).toBeCloseTo(n.x0 + 1, 6);
    expect(p.x1).toBeCloseTo(n.x1 - 1, 6);
    const big = layout(MARCIN, { cablePocket: 'island' }).cl.cablePocket!;
    expect(big.x1 - big.x0).toBeGreaterThan(p.x1 - p.x0 + 30);
    expect(big.x1).toBeCloseTo(g.rect.x1 - 1, 6);
  });

  test('cienkie dno (2 mm): kieszeń 1 mm, zostaje 1 mm dna', () => {
    const { cl } = layout(MARCIN, { ...SLIM_CASE, cablePocket: 'island' });
    expect(cl.floorTop - cl.cablePocket!.z0).toBeCloseTo(1, 6);
    expect(cl.cablePocket!.z0 - cl.bottom).toBeCloseTo(CABLE_POCKET.minFloor, 6);
  });

  test('nóżki w dnie i bateria omijają kieszeń i śruby przy wyspie', () => {
    const cp: Partial<CaseParams> = { ...ALL, feet: { mode: 'pocket' }, extras: { ...DEFAULT_EXTRAS, battery: { ...DEFAULT_EXTRAS.battery, on: true } } };
    const { cl } = layout(MARCIN, cp);
    const p = cl.cablePocket!;
    const bat = cl.extras.floorPockets;
    expect(bat.length).toBeGreaterThan(0);
    for (const b of bat) expect(overlap(b, p)).toBe(false);
    expect(cl.feet!.legs.length).toBe(2);
    // nóżki tam, gdzie bez opcji (wyspa i tak je odsuwa)
    const plain = layout(MARCIN, { feet: { mode: 'pocket' }, extras: cp.extras }).cl;
    expect(cl.feet!.legs).toEqual(plain.feet!.legs);
  });
});

describe('bryły z opcjami (OpenCascade)', () => {
  beforeAll(async () => {
    await initOC();
  });

  for (const [name, ip] of [
    ['60% S2 mini, USB w lewo (Marcin)', MARCIN],
    ['60% nice!nano, auto', { ...DEFAULT_ISLAND, position: 'top', align: 'end', tilt: 25 }],
  ] as [string, IslandParams][])
    test(`${name}: płyta, spód i pusty klin bez kolizji z kontrolerem, USB, modułem`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const hollowIp = { ...ip, wedgeHollow: true };
      const g = islandFor(tpl, hollowIp, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
      const solid = islandFor(tpl, ip, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
      const split = planSplit(keys, g, SCREW_MARGIN, DEFAULT_CASE.gap + DEFAULT_CASE.wall, DEFAULT_PRINT);
      const cp: CaseParams = { ...DEFAULT_CASE, ...ALL, feet: { mode: 'pocket' }, extras: { ...DEFAULT_EXTRAS, battery: { ...DEFAULT_EXTRAS.battery, on: true } } };
      const cl = caseLayout(keys, g, cell.height, cp, split, 'mx', { single: true, margin: SCREW_MARGIN });
      const plate = buildPlate(keys, cell, opts, g, screwPilots(cl.screws, cell.height, cl.pilotDepth));
      const shell = buildCase(keys, opts, g, cell.height, cp, cl);
      const wedge = buildWedge(g);
      for (const s of [plate, shell, wedge]) expect(isValidShape(s)).toBe(true);
      for (const s of [plate, shell, wedge]) expect(s.solids.length).toBe(1);
      expect(measureVolume(plate.clone().intersect(shell.clone()) as never)).toBeLessThan(0.01);
      expect(measureVolume(wedge.clone().intersect(plate.clone()))).toBeLessThan(0.01);
      const vol = (a: Shape3D, b: number[], c: number[]) => measureVolume(a.clone().intersect(makeBox(b as never, c as never)));
      for (const gp of g.ghosts.filter((x) => x.kind === 'nano' || x.kind === 'usb')) {
        const b = gp.box;
        for (const s of [plate, shell, wedge]) expect(vol(s, [b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1])).toBeLessThan(0.01);
      }
      // klin pusty: dużo lżejszy, śruby klina i modułu w pełnym materiale
      const solidVol = measureVolume(buildWedge(solid));
      expect(measureVolume(wedge)).toBeLessThan(solidVol * 0.7);
      for (const [x, y] of g.wedge!.screws) {
        expect(vol(wedge, [x - 0.4, y - 0.4, 0.5], [x + 0.4, y + 0.4, 3])).toBeLessThan(0.01); // otwór pilotowy
        expect(vol(wedge, [x - 2.4, y - 2.4, 0], [x + 2.4, y + 2.4, 3])).toBeGreaterThan(40); // materiał wokół
      }
      // śruby przy wyspie: słupek od dna do płyty, otwór pilotowy w płycie
      for (const [x, y] of cl.islandScrews!) {
        expect(vol(shell, [x + 2.2, y - 0.3, cl.floorTop + 0.5], [x + 3.2, y + 0.3, -cell.height - 0.3])).toBeGreaterThan(0.1);
        expect(vol(plate, [x - 0.4, y - 0.4, -cell.height], [x + 0.4, y + 0.4, -cell.height + 3])).toBeLessThan(0.01);
      }
      // kieszeń w dnie: 1 mm dna pod nią
      const p = cl.cablePocket!;
      const cx = (p.x0 + p.x1) / 2 + 8;
      const cy = (p.y0 + p.y1) / 2;
      expect(vol(shell, [cx - 0.5, cy - 0.5, cl.bottom - 1], [cx + 0.5, cy + 0.5, cl.floorTop + 0.5])).toBeCloseTo(CABLE_POCKET.minFloor, 2);
    }, 300000);
});

describe('pusty klin: śruby jak w zwykłym klinie', () => {
  beforeAll(async () => {
    await initOC();
  });
  test('Marcin: ten sam rozstaw co zwykły klin, oba otwory na słupkach, klin w jednym kawałku', async () => {
    const solid = islandFor(tpl, MARCIN, 'left', 'hotswap', H, SCREW_MARGIN)!;
    const moved = islandFor(tpl, { ...MARCIN, wedgeHollow: true }, 'left', 'hotswap', H, SCREW_MARGIN)!;
    const kept = islandFor(tpl, { ...MARCIN, wedgeHollow: true, wedgeKeepScrews: true }, 'left', 'hotswap', H, SCREW_MARGIN)!;
    expect(kept.wedge!.screws).toEqual(solid.wedge!.screws);
    expect(moved.wedge!.screws).not.toEqual(solid.wedge!.screws);
    // otwory w wyspie jak przy zwykłym klinie: te same wycięcia (łby, przeloty)
    const round = (g: typeof solid) => g.cuts.filter((c) => c.round).map((c) => [c.x0, c.y0, c.x1, c.y1].map((v) => v.toFixed(3)).join());
    expect(round(kept).sort()).toEqual(round(solid).sort());
    const w = buildWedge(kept);
    expect(isValidShape(w)).toBe(true);
    expect(w.solids.length).toBe(1);
    const vol = (b: number[], c: number[]) => measureVolume(w.clone().intersect(makeBox(b as never, c as never)));
    for (const [x, y] of kept.wedge!.screws) {
      expect(vol([x - 0.4, y - 0.4, 0.5], [x + 0.4, y + 0.4, 3])).toBeLessThan(0.01);
      expect(vol([x - 2.4, y - 2.4, 0], [x + 2.4, y + 2.4, 3])).toBeGreaterThan(40);
    }
    expect(measureVolume(w)).toBeLessThan(measureVolume(buildWedge(solid)) * 0.75);
  }, 300000);
});


describe('przepusty modułu w płycie pod klinem', () => {
  // przedni rząd pinów leży nisko: jego przepust musi przechodzić przez wierzch płyty (wcześniej był zakryty 1,6 mm)
  for (const hollow of [false, true])
    test(hollow ? 'pusty klin' : 'pełny klin', () => {
      const g = islandFor(tpl, { ...MARCIN, wedgeHollow: hollow }, 'left', 'hotswap', H, SCREW_MARGIN)!;
      const drops = g.cuts.filter((c) => !c.tilt && !c.round && c.x1 - c.x0 > 20 && c.y1 - c.y0 < 4);
      expect(drops.length).toBe(2);
      for (const d of drops) expect(d.z1).toBeGreaterThanOrEqual(1);
    });
});
