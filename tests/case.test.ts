import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume } from 'replicad';
import { initOC, cellStep, switchStep } from './oc';
import { loadCell, buildPlate, buildCase, buildLedge, footprint, screwPilots, isValidShape, bossCollar } from '../src/lib/geometry';
import { loadSwitch } from '../src/lib/switch-model';
import { SPLIT_4x6_4, TEMPLATES, PITCH, splitLeft, mirrorKeys } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND } from '../src/lib/island';
import { makeBox, makeCylinder, type Shape3D } from 'replicad';
import { caseLayout, chamferSize, bossFilletSize, BOSS_FILLET, DEFAULT_CASE, SCREW_MARGIN, SCREW_SPECS, LEDGE, type ScrewSize } from '../src/lib/case';

beforeAll(initOC, 60000);
const opts = { fillGaps: 4, margin: SCREW_MARGIN };

const cases = [
  { name: 'split 4x6+4 lewa', p: SPLIT_4x6_4, side: 'left' as const, ip: DEFAULT_ISLAND },
  { name: 'split 4x6+4 prawa', p: SPLIT_4x6_4, side: 'right' as const, ip: DEFAULT_ISLAND },
  { name: 'macropad 3x3, wyspa u góry', p: TEMPLATES.find((t) => t.id === 'macropad-3x3')!.params, side: 'left' as const, ip: { ...DEFAULT_ISLAND, position: 'top' as const, flip: false } },
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
        const board = island!.ghosts.find((g) => g.kind === 'nano')!.box;
        if (c.ip.flip === false) {
          // podkładka dociska kontroler: kończy się 0,2 mm pod płytką
          expect(lay.pads.length).toBe(1);
          expect(board.z0 - lay.pads[0].z1).toBeCloseTo(0.2, 6);
          expect(lay.pads[0].x0).toBeGreaterThan(board.x0);
          expect(lay.pads[0].x1).toBeLessThan(board.x1);
        } else {
          // odwrócony kontroler jest przyklejony pod płytą: bez podkładki, płaska strona na stropie kieszeni
          expect(lay.pads.length).toBe(0);
          const pocket = island!.cuts.find((k) => k.x0 <= board.x0 && k.x1 >= board.x1 && k.y0 <= board.y0 && k.y1 >= board.y1 && k.z0 < board.z0)!;
          expect(pocket.z1).toBeCloseTo(board.z1, 6);
        }
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

  describe('faza górnej krawędzi', () => {
    const boards = [
      { name: 'split 4x6+4', p: SPLIT_4x6_4, ip: DEFAULT_ISLAND, o: opts },
      { name: '60% ANSI', p: TEMPLATES.find((t) => t.id === 'ansi-60')!.params, ip: { ...DEFAULT_ISLAND, position: 'top' as const, align: 'end' as const }, o: { ...opts, stabs: 'cherry' as const } },
    ];
    for (const b of boards)
      test(b.name, async () => {
        const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
        const keys = splitLeft(b.p);
        const island = islandFor(b.p, b.ip, 'left', 'hotswap', cell.height, SCREW_MARGIN);
        const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE);
        const c = chamferSize(DEFAULT_CASE);
        expect(c).toBe(1);
        const sharp = buildCase(keys, b.o, island, cell.height, { ...DEFAULT_CASE, chamfer: 0 }, lay);
        const shell = buildCase(keys, b.o, island, cell.height, DEFAULT_CASE, lay);
        expect(isValidShape(shell)).toBe(true);
        expect(shell.solids.length).toBe(1);
        const vol = (a: Shape3D, t: Shape3D) => measureVolume(a.clone().intersect(t) as never);
        // ubywa tylko klina przy zewnętrznej krawędzi: obwód × c²/2
        const fp = footprint(keys, b.o, island);
        const outer = fp.offset(DEFAULT_CASE.gap + DEFAULT_CASE.wall);
        const perim = measureVolume(outer.sketchOnPlane('XY', -1).extrude(1).cut(outer.offset(-0.1).sketchOnPlane('XY', -2).extrude(3) as Shape3D) as Shape3D) / 0.1;
        expect(measureVolume(sharp) - measureVolume(shell)).toBeCloseTo((perim * c * c) / 2, -1);
        // przy samej zewnętrznej krawędzi u góry nie ma materiału, przy płycie zostaje płaska góra
        const edge = outer.sketchOnPlane('XY', -0.3).extrude(0.3).cut(outer.offset(-0.6).sketchOnPlane('XY', -1).extrude(2) as Shape3D) as Shape3D;
        expect(vol(shell, edge)).toBeLessThan(0.01);
        const land = fp.offset(DEFAULT_CASE.gap + 0.8).sketchOnPlane('XY', -0.3).extrude(0.3).cut(fp.offset(DEFAULT_CASE.gap).sketchOnPlane('XY', -1).extrude(2) as Shape3D) as Shape3D;
        expect(vol(shell, land)).toBeCloseTo(vol(sharp, land), 1);
        // droga wtyku USB i płyta bez zmian
        for (const u of lay.usbCuts) expect(vol(shell, makeBox([u.x0, u.y0, u.z0], [u.x1, u.y1, u.z1]) as Shape3D)).toBeLessThan(0.01);
        const plate = buildPlate(keys, cell, b.o, island);
        expect(vol(shell, plate)).toBeLessThan(0.01);
      }, 240000);
    test('cienka ścianka: zostaje płaska góra', () => {
      expect(chamferSize({ ...DEFAULT_CASE, wall: 1.6, chamfer: 2 })).toBeCloseTo(0.8, 6);
      expect(chamferSize({ ...DEFAULT_CASE, chamfer: 0 })).toBe(0);
      expect(chamferSize({ ...DEFAULT_CASE, chamfer: undefined })).toBe(0);
    });
  });
});

describe('wzmocnienie u podstawy słupków śrub', () => {
  test('kołnierz: wymiary i objętość (zaokrąglenie i faza 45°)', () => {
    const r0 = 3.75, r = 1.5;
    const f = bossCollar(r0, r, 'fillet', 10, 20, -5);
    const bb = f.boundingBox.bounds;
    expect(bb[0][0]).toBeCloseTo(10 - r0 - r, 3);
    expect(bb[1][1]).toBeCloseTo(20 + r0 + r, 3);
    expect(bb[0][2]).toBeCloseTo(-5.01, 3);
    expect(bb[1][2]).toBeCloseTo(-5 + r, 3);
    expect(isValidShape(f)).toBe(true);
    // pierścień pod łukiem: przekrój r²(1 − π/4) na promieniu między r0 a r0 + r
    const A = r * r * (1 - Math.PI / 4);
    expect(measureVolume(f)).toBeGreaterThan(2 * Math.PI * r0 * A);
    expect(measureVolume(f)).toBeLessThan(2 * Math.PI * (r0 + r) * A + 1.5);
    // faza: stożek ścięty minus walec
    const c = bossCollar(r0, r, 'chamfer', 0, 0, 0);
    const cone = ((Math.PI * r) / 3) * ((r0 + r) ** 2 + (r0 + r) * r0 + r0 * r0) - Math.PI * r0 * r0 * r;
    // + 0,01 mm zakładki w dno i w słupek
    expect(Math.abs(measureVolume(c) - cone)).toBeLessThan(1);
  });

  test('przycinanie: zostaje prosty kawałek słupka, 0 wyłącza', () => {
    expect(bossFilletSize(DEFAULT_CASE, 5)).toBe(1.5);
    expect(bossFilletSize({ ...DEFAULT_CASE, bossFillet: 5, space: 6 }, 10)).toBe(BOSS_FILLET.max);
    expect(bossFilletSize({ ...DEFAULT_CASE, bossFillet: 5, space: 3 }, 10)).toBeCloseTo(3 - BOSS_FILLET.belowParts, 6);
    expect(bossFilletSize({ ...DEFAULT_CASE, bossFillet: 3 }, 2.5)).toBeCloseTo(2.5 - BOSS_FILLET.minTop, 6);
    expect(bossFilletSize({ ...DEFAULT_CASE, bossFillet: 0 }, 5)).toBe(0);
    expect(bossFilletSize({ ...DEFAULT_CASE, bossFillet: undefined }, 5)).toBe(0);
  });

  const boards = [
    { name: 'split 4x6+4', p: SPLIT_4x6_4, ip: DEFAULT_ISLAND, o: opts },
    { name: '60% ANSI', p: TEMPLATES.find((t) => t.id === 'ansi-60')!.params, ip: { ...DEFAULT_ISLAND, position: 'top' as const, align: 'end' as const }, o: { ...opts, stabs: 'cherry' as const } },
  ];
  // faza 45° o tym samym wymiarze obejmuje zaokrąglenie, więc kolizje sprawdzamy na fazie
  for (const b of boards)
    for (const variant of ['hotswap', 'no-hotswap'] as const)
      test(`${b.name}, ${variant}, faza ${BOSS_FILLET.max} mm: bez kolizji z płytą, przełącznikami, kontrolerem, USB`, async () => {
        const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
        const sw = await loadSwitch({ step: switchStep(), up: '+Y' });
        const keys = splitLeft(b.p);
        const island = islandFor(b.p, b.ip, 'left', variant, cell.height, SCREW_MARGIN)!;
        const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE);
        // największe wzmocnienie, jakie da się ustawić w panelu
        const cp = { ...DEFAULT_CASE, bossFillet: BOSS_FILLET.max, bossFilletKind: 'chamfer' as const };
        const fr = bossFilletSize(cp, -cell.height - lay.floorTop);
        expect(fr).toBeGreaterThan(0);
        const vol = (a: Shape3D, t: Shape3D) => measureVolume(a.clone().intersect(t) as never);
        const r0 = lay.screw.boss / 2;
        const collars = lay.screws.map(([x, y]) => bossCollar(r0, fr, 'chamfer', x, y, lay.floorTop));
        const all = collars.slice(1).reduce((u, c) => u.fuse(c) as Shape3D, collars[0]);
        // kołnierze kończą się poniżej wszystkiego, co wisi pod płytą (komórki, piny przełączników, wyspa)
        const swLow = sw.boundingBox.bounds[0][2];
        expect(lay.floorTop + fr).toBeLessThan(Math.min(-cell.height, -island.depth, swLow));
        expect(vol(all, buildPlate(keys, cell, b.o, island))).toBeLessThan(0.01);
        for (const g of island.ghosts)
          expect(vol(all, makeBox([g.box.x0, g.box.y0, g.box.z0], [g.box.x1, g.box.y1, g.box.z1]) as Shape3D), g.kind).toBeLessThan(0.01);
        for (const u of lay.usbCuts) expect(vol(all, makeBox([u.x0, u.y0, u.z0], [u.x1, u.y1, u.z1]) as Shape3D)).toBeLessThan(0.01);
        // pod żadnym przełącznikiem (obrys korpusu, od pinów do płyty)
        for (const k of keys) {
          const box = makeBox([-7.5, -7.5, swLow - 0.01], [7.5, 7.5, 0]).rotate(k.rot, [0, 0, 0], [0, 0, 1]).translate(k.x, k.y, 0) as Shape3D;
          expect(vol(all, box)).toBeLessThan(0.01);
        }
        // otwory na śruby wolne
        for (const [x, y] of lay.screws)
          expect(vol(all, makeCylinder(lay.screw.clearance / 2, 20, [x, y, lay.bottom - 1], [0, 0, 1]) as Shape3D)).toBeLessThan(0.01);
      }, 300000);

  for (const kind of ['fillet', 'chamfer'] as const)
    test(`split 4x6+4: obudowa z kołnierzami (${kind}) poprawna, pełny pierścień przy każdym słupku`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const keys = splitLeft(SPLIT_4x6_4);
      const island = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
      const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE);
      const cp = { ...DEFAULT_CASE, bossFilletKind: kind };
      const fr = bossFilletSize(cp, -cell.height - lay.floorTop);
      expect(fr).toBe(1.5);
      expect(DEFAULT_CASE.bossFilletKind).toBe('chamfer');
      const plain = buildCase(keys, opts, island, cell.height, { ...cp, bossFillet: 0 }, lay);
      const shell = buildCase(keys, opts, island, cell.height, cp, lay);
      expect(isValidShape(shell)).toBe(true);
      expect(shell.solids.length).toBe(1);
      const vol = (a: Shape3D, t: Shape3D) => measureVolume(a.clone().intersect(t) as never);
      // przybywa materiału (część kołnierzy wchodzi w gzyms przy ściance), nie więcej niż wszystkie kołnierze
      const one = measureVolume(bossCollar(lay.screw.boss / 2, fr, kind, 0, 0, 0));
      const added = measureVolume(shell) - measureVolume(plain);
      expect(added).toBeGreaterThan(0);
      expect(added).toBeLessThan(one * lay.screws.length + 1);
      const r0 = lay.screw.boss / 2;
      for (const [x, y] of lay.screws) {
        const ring = makeCylinder(r0 + 0.3, 0.2, [x, y, lay.floorTop + 0.1], [0, 0, 1]).cut(makeCylinder(r0 + 0.05, 1, [x, y, lay.floorTop], [0, 0, 1])) as Shape3D;
        expect(vol(shell, ring)).toBeCloseTo(measureVolume(ring), 2);
      }
    }, 300000);
});
