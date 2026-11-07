import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, makeBox, makeCylinder, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, buildWedge, screwPilots, isValidShape, stabCuts, platePiece, casePiece } from '../src/lib/geometry';
import { TEMPLATES, splitLeft, switchOffsets, switchSpots, ANSI_60, parseRowLayout, rowLayoutToText, keysOverlap, PITCH } from '../src/lib/layout';
import { islandFor, gridBounds, DEFAULT_ISLAND, type IslandParams } from '../src/lib/island';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN, SCREW_SPECS, type ScrewSize } from '../src/lib/case';
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
  test('stół 245 × 245: dwie części, każda się mieści, szwy w różnych miejscach', () => {
    const sp = planSplit(keys, island, SCREW_MARGIN, caseExtra, DEFAULT_PRINT)!;
    expect(sp).not.toBeNull();
    expect(sp.fits).toBe(true);
    for (const [w, h] of [...sp.plateParts, ...sp.caseParts]) expect(Math.min(w, h)).toBeLessThanOrEqual(245);
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

  test('klin 25° pod OLED jako osobna część przykręcana do płaskiej wyspy', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(tpl);
    const flat = islandFor(tpl, ip, 'left', 'hotswap', cell.height)!;
    const wedge = islandFor(tpl, { ...ip, tilt: 25 }, 'left', 'hotswap', cell.height)!;
    const w = wedge.wedge!;
    expect(w.deg).toBe(25);
    expect(w.screws.length).toBe(2);
    expect(wedge.rect).toEqual(flat.rect);
    // płyta zostaje płaska: nic nie wystaje ponad z = 0
    const plate = buildPlate(keys, cell, opts, wedge);
    expect(isValidShape(plate)).toBe(true);
    expect(plate.solids.length).toBe(1);
    expect(plate.boundingBox.bounds[1][2]).toBeLessThan(0.01);
    // klin: jedna bryła na z = 0, tył ok. 3 + 38 · tg 25° ≈ 20,7 mm
    const part = buildWedge(wedge);
    expect(isValidShape(part)).toBe(true);
    expect(part.solids.length).toBe(1);
    const bb = part.boundingBox.bounds;
    expect(bb[0][2]).toBeCloseTo(0, 3);
    expect(bb[1][2]).toBeCloseTo(3 + 38 * Math.tan((25 * Math.PI) / 180), 1);
    // klin nie wchodzi w płytę
    expect(measureVolume(part.intersect(plate))).toBeLessThan(0.01);
    // śruby: otwór w wyspie (płyta ma tam mniej materiału niż płaska wyspa bez klina)
    for (const [x, y] of w.screws) {
      expect(x).toBeGreaterThan(w.x0 + 3);
      expect(x).toBeLessThan(w.x1 - 3);
      expect(y).toBeGreaterThan(w.y0 + 3);
      expect(y).toBeLessThan(w.y1 - 3);
    }
    // pokrętło pochylone razem z klinem
    const knob = (g: typeof flat) => g.ghosts.find((x) => x.kind === 'knob')!.box;
    expect(knob(wedge).tilt?.deg).toBe(25);
    // klin pod klawiaturą (wyspa u dołu) pochyla się w drugą stronę
    const below = islandFor(tpl, { ...ip, position: 'bottom', tilt: 25 }, 'left', 'hotswap', cell.height)!;
    expect(below.wedge?.deg).toBe(-25);
    const pb = buildPlate(keys, cell, opts, below);
    expect(isValidShape(pb)).toBe(true);
    expect(pb.solids.length).toBe(1);
    const wb = buildWedge(below);
    expect(isValidShape(wb)).toBe(true);
    expect(wb.solids.length).toBe(1);
  }, 240000);

  test('USB-C: gniazdo przy krawędzi płyty, wolna droga dla wtyku przez płytę i ściankę obudowy', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(tpl);
    const island = islandFor(tpl, { ...ip, tilt: 25 }, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
    // wyspa nie jest głębsza niż płyta: bez schodka pod spodem
    expect(island.depth).toBeCloseTo(cell.height, 6);
    const usb = island.ghosts.find((g) => g.kind === 'usb')!.box;
    const nano = island.ghosts.find((g) => g.kind === 'nano')!.box;
    const edge = island.rect.y1 + SCREW_MARGIN;
    // gniazdo kończy się równo z krawędzią płyty; kontroler wysoko, 2,5 mm materiału nad nim
    expect(usb.y1).toBeCloseTo(edge, 6);
    expect(nano.z0).toBeGreaterThan(-cell.height);
    const cl = caseLayout(keys, island, cell.height, DEFAULT_CASE, null, 'cherry');
    const plate = buildPlate(keys, cell, opts, island, screwPilots(cl.screws, cell.height, cl.pilotDepth));
    const shell = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, cl);
    expect(isValidShape(plate)).toBe(true);
    expect(isValidShape(shell)).toBe(true);
    expect(plate.boundingBox.bounds[0][2]).toBeCloseTo(-cell.height, 3);
    const vol = (a: Shape3D, b: [number, number, number], c: [number, number, number]) =>
      measureVolume(a.intersect(makeBox(b, c)));
    // kontroler i gniazdo nie zachodzą na płytę ani na spód
    for (const g of [usb, nano]) {
      expect(vol(plate, [g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1])).toBeLessThan(0.01);
      expect(vol(shell, [g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1])).toBeLessThan(0.01);
    }
    // wtyk z obudową (12,4 × 6,5 mm) od krawędzi płyty na zewnątrz, przez ściankę obudowy
    const cx = (usb.x0 + usb.x1) / 2;
    const cz = (usb.z0 + usb.z1) / 2;
    const p0: [number, number, number] = [cx - 6.2, edge + 0.05, cz - 3.25];
    const p1: [number, number, number] = [cx + 6.2, edge + 15, cz + 3.25];
    expect(vol(plate, p0, p1)).toBeLessThan(0.01);
    expect(vol(shell, p0, p1)).toBeLessThan(0.01);
    // wtyk wchodzi w gniazdo: przed gniazdem w płycie jest wolne miejsce na jego blaszkę
    expect(vol(plate, [cx - 4.2, edge - 3, cz - 1.5], [cx + 4.2, edge + 0.05, cz + 1.5])).toBeLessThan(0.01);
    // nad kontrolerem został dach płyty
    expect(vol(plate, [nano.x0, nano.y0, -2.4], [nano.x1, nano.y1, -0.1])).toBeGreaterThan(0.9 * (nano.x1 - nano.x0) * (nano.y1 - nano.y0) * 2.3);
  }, 240000);

  test('ESP32-S3 z klinem: płytka wzdłuż wyspy, USB z krótkiego końca, klin działa', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(tpl);
    const island = islandFor(tpl, { ...ip, controller: 'esp32s3', tilt: 25 }, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
    const w = island.wedge!;
    expect(w.deg).toBe(25);
    expect(island.depth).toBeCloseTo(cell.height, 6);
    const usbs = island.ghosts.filter((g) => g.kind === 'usb').map((g) => g.box);
    const nano = island.ghosts.find((g) => g.kind === 'nano')!.box;
    expect(usbs.length).toBe(2);
    // płytka wzdłuż wyspy, oba gniazda równo z prawą krawędzią płyty (wyspa wyrównana do prawej)
    expect(nano.x1 - nano.x0).toBeGreaterThan(nano.y1 - nano.y0);
    const edge = island.rect.x1 + SCREW_MARGIN;
    for (const u of usbs) expect(u.x1).toBeCloseTo(edge, 6);
    // śruby klina poza kieszenią kontrolera
    for (const [x, y] of w.screws) expect(y - 2.5).toBeGreaterThan(nano.y1 + 0.3);
    // nice!nano z USB z końca wyspy: też klin i płytka wzdłuż
    const end = islandFor(tpl, { ...ip, usbOut: 'end', tilt: 25 }, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
    expect(end.wedge?.deg).toBe(25);
    const en = end.ghosts.find((g) => g.kind === 'nano')!.box;
    expect(en.x1 - en.x0).toBeGreaterThan(en.y1 - en.y0);
    const cl = caseLayout(keys, island, cell.height, DEFAULT_CASE, null, 'cherry');
    const plate = buildPlate(keys, cell, opts, island, screwPilots(cl.screws, cell.height, cl.pilotDepth));
    const shell = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, cl);
    const wedge = buildWedge(island);
    for (const s of [plate, shell, wedge]) expect(isValidShape(s)).toBe(true);
    expect(wedge.solids.length).toBe(1);
    expect(plate.boundingBox.bounds[1][2]).toBeLessThan(0.01);
    const vol = (a: Shape3D, b: [number, number, number], c: [number, number, number]) =>
      measureVolume(a.intersect(makeBox(b, c)));
    expect(measureVolume(wedge.intersect(plate))).toBeLessThan(0.01);
    for (const g of [nano, ...usbs]) {
      expect(vol(plate, [g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1])).toBeLessThan(0.01);
      expect(vol(shell, [g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1])).toBeLessThan(0.01);
    }
    // wtyki (12,4 × 6,5) od krawędzi płyty na zewnątrz przez ściankę obudowy
    for (const u of usbs) {
      const cy = (u.y0 + u.y1) / 2;
      const cz = (u.z0 + u.z1) / 2;
      const p0: [number, number, number] = [edge + 0.05, cy - 6.2, cz - 3.25];
      const p1: [number, number, number] = [edge + 15, cy + 6.2, cz + 3.25];
      expect(vol(plate, p0, p1)).toBeLessThan(0.01);
      expect(vol(shell, p0, p1)).toBeLessThan(0.01);
    }
  }, 300000);

  // wyrównanie 'end' (wyspa po prawej): USB w lewo idzie do środka klawiatury, kontroler przy tylnej krawędzi
  for (const [controller, dir, align] of [
    ['esp32s3', 'left', 'end'],
    ['esp32s3', 'right', 'end'],
    ['esp32s3', 'back', 'end'],
    ['nicenano', 'left', 'end'],
    ['nicenano', 'left', 'start'],
    ['nicenano', 'right', 'start'],
    ['nicenano', 'back', 'end'],
    ['s2mini', 'left', 'end'],
  ] as const)
    test(`kierunek USB ${dir} (${controller}, wyspa ${align}) z klinem: gniazdo przy krawędzi płyty, wolna droga wtyku, klin bez kolizji`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const keys = splitLeft(tpl);
      const island = islandFor(tpl, { ...ip, align, controller, tilt: 25, usbDir: dir }, 'left', 'hotswap', cell.height, SCREW_MARGIN)!;
      // wyspa zostaje tam, gdzie ją wyrównano, niezależnie od kierunku USB; tylko długi ESP32-S3
      // (bez miejsca na śruby klina obok kieszeni) dosuwa ją do krawędzi po stronie USB
      const { kx0, kx1 } = gridBounds(tpl);
      const forced = controller === 'esp32s3' && dir !== 'back';
      const at = forced ? (dir === 'left' ? 'start' : 'end') : align;
      if (at === 'end') expect(island.rect.x1).toBeCloseTo(kx1, 6);
      else expect(island.rect.x0).toBeCloseTo(kx0, 6);
      const inward = !forced && ((dir === 'left' && align === 'end') || (dir === 'right' && align === 'start'));
      const w = island.wedge!;
      expect(w.deg).toBe(25);
      const r = island.rect;
      const usbs = island.ghosts.filter((g) => g.kind === 'usb').map((g) => g.box);
      const nano = island.ghosts.find((g) => g.kind === 'nano')!.box;
      expect(usbs.length).toBeGreaterThan(0);
      // klin zawsze 38 mm głęboki, od krawędzi klawiszy; wyspa może być głębsza (długi kontroler w tył)
      expect(w.y1 - w.y0).toBeCloseTo(38, 6);
      expect(w.y0).toBeCloseTo(r.y0, 6);
      if (dir === 'back') {
        expect(nano.y1 - nano.y0).toBeGreaterThan(nano.x1 - nano.x0);
        if (controller === 'esp32s3') expect(r.y1 - r.y0).toBeGreaterThan(65);
      } else expect(nano.x1 - nano.x0).toBeGreaterThan(nano.y1 - nano.y0);
      // śruby klina poza kieszenią kontrolera
      for (const [x, y] of w.screws) {
        const out = x + 2.5 < nano.x0 - 0.3 || x - 2.5 > nano.x1 + 0.3 || y + 2.5 < nano.y0 - 0.3 || y - 2.5 > nano.y1 + 0.3;
        expect(out).toBe(true);
      }
      if (inward) {
        // kontroler przy tylnej krawędzi wyspy: wtyk (12,5 mm) cały ponad brzegiem obudowy obok wyspy
        expect(nano.y0 - r.y0).toBeGreaterThan((r.y1 - r.y0) / 4);
        for (const u of usbs) expect((u.y0 + u.y1) / 2 - 6.25).toBeGreaterThan(r.y0 + SCREW_MARGIN + DEFAULT_CASE.gap + DEFAULT_CASE.wall + 1);
      }
      // gniazdo równo z krawędzią płyty po wybranej stronie; kierunek wyjścia wtyku
      const edge = dir === 'left' ? r.x0 - SCREW_MARGIN : dir === 'right' ? r.x1 + SCREW_MARGIN : r.y1 + SCREW_MARGIN;
      for (const u of usbs) expect(dir === 'left' ? u.x0 : dir === 'right' ? u.x1 : u.y1).toBeCloseTo(edge, 6);
      const cl = caseLayout(keys, island, cell.height, DEFAULT_CASE, null, 'cherry');
      const plate = buildPlate(keys, cell, opts, island, screwPilots(cl.screws, cell.height, cl.pilotDepth));
      const shell = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, cl);
      const wedge = buildWedge(island);
      for (const s of [plate, shell, wedge]) expect(isValidShape(s)).toBe(true);
      expect(plate.solids.length).toBe(1);
      expect(wedge.solids.length).toBe(1);
      expect(measureVolume(wedge.clone().intersect(plate.clone()))).toBeLessThan(0.01);
      expect(measureVolume(plate.clone().intersect(shell.clone()) as never)).toBeLessThan(0.01);
      const vol = (a: Shape3D, b: [number, number, number], c: [number, number, number]) =>
        measureVolume(a.clone().intersect(makeBox(b, c)));
      for (const g of [nano, ...usbs]) expect(vol(wedge, [g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1])).toBeLessThan(0.01);
      for (const g of [nano, ...usbs]) {
        expect(vol(plate, [g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1])).toBeLessThan(0.01);
        expect(vol(shell, [g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1])).toBeLessThan(0.01);
      }
      // słupki śrub obudowy nie wchodzą w kontroler
      for (const [x, y] of cl.screws) {
        const rr = cl.screw.boss / 2;
        const hit = x + rr > nano.x0 && x - rr < nano.x1 && y + rr > nano.y0 && y - rr < nano.y1;
        expect(hit).toBe(false);
      }
      // wtyk z obudową (12,4 × 6,5 mm) od krawędzi płyty na zewnątrz przez ściankę obudowy
      for (const u of usbs) {
        const cz = (u.z0 + u.z1) / 2;
        let p0: [number, number, number], p1: [number, number, number];
        if (dir === 'back') {
          const cx = (u.x0 + u.x1) / 2;
          p0 = [cx - 6.2, edge + 0.05, cz - 3.25];
          p1 = [cx + 6.2, edge + 15, cz + 3.25];
        } else {
          const cy = (u.y0 + u.y1) / 2;
          const s = dir === 'left' ? -1 : 1;
          p0 = [Math.min(edge + s * 0.05, edge + s * 15), cy - 6.2, cz - 3.25];
          p1 = [Math.max(edge + s * 0.05, edge + s * 15), cy + 6.2, cz + 3.25];
        }
        expect(vol(plate, p0, p1)).toBeLessThan(0.01);
        expect(vol(shell, p0, p1)).toBeLessThan(0.01);
      }
    }, 300000);

  test('kanały na przewody w komórce hot-swap: otwarte na boki X i od spodu, wyspa bez wnęki', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const h = cell.size / 2;
    const vol = (a: [number, number, number], b: [number, number, number]) => measureVolume(cell.negative.clone().intersect(makeBox(a, b)));
    // kanały wychodzą na boki w osi X, przy samym dnie (przewód może zejść w dół pod płytę)
    expect(vol([-h, -h, -cell.height], [-h + 0.3, h, -cell.height + 0.3])).toBeGreaterThan(0.1);
    expect(vol([h - 0.3, -h, -cell.height], [h, h, -cell.height + 0.3])).toBeGreaterThan(0.1);
    expect(vol([-h, -h, -cell.height], [h, -h + 0.3, -cell.height + 3])).toBeLessThan(0.001);
    expect(vol([-h, h - 0.3, -cell.height], [h, h, -cell.height + 3])).toBeLessThan(0.001);
    const notch = (g: NonNullable<ReturnType<typeof islandFor>>) => g.cuts.some((c) => Math.abs(c.z1 - (-cell.height + 2.4)) < 1e-6);
    expect(notch(islandFor(tpl, { ...ip, tilt: 25 }, 'left', 'hotswap', cell.height)!)).toBe(false);
    const split = TEMPLATES.find((t) => !t.params.single)!.params;
    expect(notch(islandFor(split, DEFAULT_ISLAND, 'left', 'hotswap', cell.height)!)).toBe(false);
  }, 120000);

  test('cała płyta i spód hot-swap, podział na części', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(tpl);
    const island = islandFor(tpl, ip, 'left', 'hotswap', cell.height);
    const sp = planSplit(keys, island, SCREW_MARGIN, caseExtra, DEFAULT_PRINT)!;
    const lay = caseLayout(keys, island, cell.height, { ...DEFAULT_CASE, screws: 6 }, sp);
    // podpory w środku klawiatury, z dala od śrub i szwu spodu
    expect(lay.supports.length).toBeGreaterThanOrEqual(4);
    for (const [x, y] of lay.supports) {
      expect(Math.abs(x - sp.caseX)).toBeGreaterThan(3);
      expect(lay.screws.every(([a, b]) => Math.hypot(a - x, b - y) >= 15)).toBe(true);
    }
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
      expect(bb[1][0] - bb[0][0]).toBeLessThanOrEqual(245);
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
      expect(bb[1][0] - bb[0][0]).toBeLessThanOrEqual(245);
    }
    expect(measureVolume(cparts[0]) + measureVolume(cparts[1])).toBeCloseTo(measureVolume(shell), 0);
    expect(measureVolume(plate.clone().intersect(shell.clone()) as never)).toBeLessThan(0.01);
    // podpory dochodzą pod płytę: podniesiony o 0,2 mm spód zderza się z płytą tylko przez podpory
    const lifted = measureVolume(plate.clone().intersect(shell.clone().translate(0, 0, 0.2)) as never);
    expect(lifted).toBeGreaterThan(0);
  }, 600000);

  for (const size of ['M3', 'M2.5'] as ScrewSize[])
    test(`śruby ${size}: słupki bez kolizji z płytą, kontrolerem, USB i modułem, łeb schowany w dnie`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const keys = splitLeft(tpl);
      const island = islandFor(tpl, ip, 'left', 'hotswap', cell.height);
      const sp = planSplit(keys, island, SCREW_MARGIN, caseExtra, DEFAULT_PRINT)!;
      const cp = { ...DEFAULT_CASE, screwSize: size };
      const lay = caseLayout(keys, island, cell.height, cp, sp);
      expect(lay.screw).toEqual(SCREW_SPECS[size]);
      expect(lay.screws.length).toBeGreaterThanOrEqual(6);
      // słupek z dala od szwu spodu i od podpór
      for (const [x, y] of lay.screws) {
        expect(Math.abs(x - sp.caseX)).toBeGreaterThanOrEqual(lay.screw.boss / 2 + 1.5 - 1e-6);
        for (const [a, b] of lay.supports) expect(Math.hypot(a - x, b - y)).toBeGreaterThanOrEqual(15);
      }
      const plate = buildPlate(keys, cell, opts, island, screwPilots(lay.screws, cell.height, lay.pilotDepth, lay.screw));
      const shell = buildCase(keys, opts, island, cell.height, cp, lay);
      expect(isValidShape(shell)).toBe(true);
      expect(measureVolume(plate.clone().intersect(shell.clone()) as never)).toBeLessThan(0.01);
      for (const g of island!.ghosts) {
        const b = g.box;
        expect(measureVolume(shell.clone().intersect(makeBox([b.x0, b.y0, b.z0], [b.x1, b.y1, b.z1])) as never), g.kind).toBeLessThan(0.01);
      }
      // wokół wybrania na łeb jest pełny pierścień materiału 1,2 mm (łeb nie przebija ścianki)
      const h = Math.min(lay.screw.headDepth, cp.floor);
      for (const [x, y] of lay.screws) {
        const r = lay.screw.head / 2;
        const ring = makeCylinder(r + 1.2, h, [x, y, lay.bottom], [0, 0, 1]).cut(makeCylinder(r + 0.01, h, [x, y, lay.bottom], [0, 0, 1]));
        const full = measureVolume(ring as never);
        expect(measureVolume(shell.clone().intersect(ring) as never) / full).toBeGreaterThan(0.999);
      }
      console.log(size, 'śruby', lay.screws.length, 'długość', lay.screwLength, 'podpory', lay.supports.length);
    }, 240000);
});
