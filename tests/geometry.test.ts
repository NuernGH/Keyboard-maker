import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, importSTEP, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, detectUp, isValidShape, footprint, holeCount, NO_HOTSWAP_HEIGHT } from '../src/lib/geometry';
import { PITCH, splitLeft, SPLIT_4x6_4, type Key } from '../src/lib/layout';

const grid = (cols: number, rows: number): Key[] =>
  Array.from({ length: cols * rows }, (_, i) => ({
    id: `${i}`, x: (i % cols) * PITCH, y: -Math.floor(i / cols) * PITCH, rot: 0, w: 1, h: 1,
  }));

beforeAll(initOC, 60000);

describe('komórka key socket.STEP', () => {
  test('wykrywa oś płyty +X', async () => {
    const s = (await importSTEP(cellStep())) as Shape3D;
    expect(detectUp(s)).toBe('+X');
  });

  test('hot-swap: siatka 2×2 ma objętość 4 komórek i wymiary 1:1', async () => {
    const original = measureVolume((await importSTEP(cellStep())) as Shape3D);
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    expect(cell.height).toBeCloseTo(8.58, 2);
    expect(cell.size).toBeCloseTo(19.05, 3);
    const plate = buildPlate(grid(2, 2), cell, { fillGaps: 0, margin: 0 });
    expect(measureVolume(plate)).toBeCloseTo(4 * original, 0);
    const b = plate.boundingBox.bounds;
    expect(b[1][0] - b[0][0]).toBeCloseTo(2 * PITCH, 3);
    expect(b[1][2] - b[0][2]).toBeCloseTo(8.58, 2);
  }, 60000);

  test('bez hot-swap: tylko górne 5,08 mm', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'no-hotswap');
    expect(cell.height).toBeCloseTo(NO_HOTSWAP_HEIGHT, 3);
    const plate = buildPlate(grid(1, 1), cell, { fillGaps: 0, margin: 0 });
    const b = plate.boundingBox.bounds;
    expect(b[1][2] - b[0][2]).toBeCloseTo(5.08, 3);
    // płyta 1,27 z otworem 14×14: (19,05² − 14²)·1,27 to dolne ograniczenie
    expect(measureVolume(plate)).toBeGreaterThan((PITCH ** 2 - 14 ** 2) * 1.27);
  }, 60000);
});

describe('pełna połówka 4×6 + 4', () => {
  for (const variant of ['hotswap', 'no-hotswap', 'thin-plate'] as const) {
    test(`${variant}: poprawna bryła, STEP wczytuje się bez strat`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
      const plate = buildPlate(splitLeft(SPLIT_4x6_4), cell);
      expect(isValidShape(plate)).toBe(true);
      expect(plate.solids.length).toBe(1);
      const reimported = (await importSTEP(plate.blobSTEP())) as Shape3D;
      expect(measureVolume(reimported)).toBeCloseTo(measureVolume(plate), 0);
    }, 120000);
  }
});

describe('obrys', () => {
  test('zamknięta szczelina pod klawiszem jest wypełniona', () => {
    // przypadek ze zrzutu Marcina: 3 rzędy, 5 kolumn, kciuk pod kolumną 4, wachlarz −17°
    const keys = splitLeft({ ...SPLIT_4x6_4, rows: 3, cols: 5, stagger: [0, 0, 4.76, 7.14, 4.76], thumbAnchorCol: 3, thumbSplay: -17 });
    expect(holeCount(footprint(keys, { fillGaps: 0, margin: 0 }))).toBeGreaterThan(0);
    expect(holeCount(footprint(keys, { fillGaps: 4, margin: 0 }))).toBe(0);
  });
});

import { islandFor, DEFAULT_ISLAND, NANO, MODULE } from '../src/lib/island';
import { mirrorKeys } from '../src/lib/layout';

describe('wyspa na elektronikę', () => {
  test('mieści nice!nano i moduł, zostawia strop między nimi', () => {
    const g = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'left', 'hotswap', 8.58)!;
    const [seat, under, nano] = g.cuts;
    expect(seat.x1 - seat.x0).toBeGreaterThan(MODULE.w);
    expect(seat.y1 - seat.y0).toBeGreaterThan(MODULE.h);
    expect(nano.x1 - nano.x0).toBeGreaterThan(NANO.w);
    expect(nano.y1 - nano.y0).toBeGreaterThan(NANO.h);
    expect(nano.z1 + g.depth).toBeGreaterThan(NANO.height);
    expect(under.z0 - nano.z1).toBeGreaterThanOrEqual(1.2);
    // wyspa nie zachodzi na klawisze
    const keys = splitLeft(SPLIT_4x6_4);
    const maxKeyX = Math.max(...keys.filter((k) => k.id.startsWith('k')).map((k) => k.x + PITCH / 2));
    expect(g.rect.x0).toBeGreaterThanOrEqual(maxKeyX - 1e-6);
  });

  for (const variant of ['hotswap', 'no-hotswap'] as const)
    for (const side of ['left', 'right'] as const)
      test(`${variant} ${side}: płyta z wyspą jest poprawna, STEP bez strat`, async () => {
        const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
        const base = splitLeft(SPLIT_4x6_4);
        const keys = side === 'left' ? base : mirrorKeys(base);
        const g = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, side, variant, cell.height);
        const plate = buildPlate(keys, cell, undefined, g);
        expect(isValidShape(plate)).toBe(true);
        expect(plate.solids.length).toBe(1);
        const b = plate.boundingBox.bounds;
        expect(-b[0][2]).toBeCloseTo(g!.depth, 3);
        // pod płaskim modułem kontroler potrzebuje głębszej wyspy, bez modułu wystarcza głębokość płyty.
        // Odwrócony nice!nano: dach 4,9 mm pod modułem (gniazdo modułu 3,7 + 0,8 + wnęka na USB 0,4),
        // 3,3 mm bez modułu (otwór na wtyk), plus wysokość kontrolera i 0,6 mm luzu
        expect(g!.depth).toBeCloseTo(Math.max(cell.height, (side === 'left' ? 4.9 : 3.3) + 0.6 + NANO.height), 3);
        const re = (await importSTEP(plate.blobSTEP())) as Shape3D;
        expect(measureVolume(re)).toBeCloseTo(measureVolume(plate), 0);
      }, 180000);
});

describe('nice!nano przy krawędzi', () => {
  test('gniazdo USB-C kończy się na górnej ściance wyspy', () => {
    const g = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'left', 'hotswap', 8.58)!;
    const usb = g.ghosts.find((p) => p.kind === 'usb')!;
    expect(usb.box.y1).toBeCloseTo(g.rect.y1, 6);
    const nano = g.ghosts.find((p) => p.kind === 'nano')!;
    expect(g.rect.y1 - nano.box.y1).toBeCloseTo(NANO.usbOverhang, 6);
  });
});

import { MODULE_HOLES } from '../src/lib/island';
describe('mocowanie modułu', () => {
  test('4 otwory pod śruby w rozstawie 59 × 29 mm, poza kanałami', () => {
    const g = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'left', 'hotswap', 8.58)!;
    const holes = g.cuts.filter((c) => c.round);
    expect(holes.length).toBe(4);
    const xs = holes.map((h) => (h.x0 + h.x1) / 2);
    const ys = holes.map((h) => (h.y0 + h.y1) / 2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(MODULE_HOLES.dx, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(MODULE_HOLES.dy, 6);
    const under = g.cuts[1];
    for (const y of ys) expect(y < under.y0 || y > under.y1).toBe(true);
  });
});

import { CONTROLLERS, islandSize, type ControllerId } from '../src/lib/island';
describe('kontrolery i połówka z modułem', () => {
  test('domyślnie moduł tylko na lewej, prawa ma małą wyspę bez modułu', () => {
    const l = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'left', 'hotswap', 8.58)!;
    const r = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'right', 'hotswap', 8.58)!;
    expect(l.ghosts.some((g) => g.kind === 'display')).toBe(true);
    expect(r.ghosts.some((g) => g.kind === 'display')).toBe(false);
    expect(r.cuts.some((c) => c.round)).toBe(false);
    expect(r.rect.x1 - r.rect.x0).toBeLessThan(l.rect.x1 - l.rect.x0);
    expect(r.rect.y1 - r.rect.y0).toBeLessThan(l.rect.y1 - l.rect.y0);
  });

  for (const id of Object.keys(CONTROLLERS) as ControllerId[])
    test(`${id}: kieszeń mieści płytkę, USB kończy się na ściance`, () => {
      const c = CONTROLLERS[id];
      for (const moduleSide of ['left', 'none'] as const) {
        const ip = { ...DEFAULT_ISLAND, controller: id, moduleSide };
        const g = islandFor(SPLIT_4x6_4, ip, 'left', 'hotswap', 8.58)!;
        const pocket = g.cuts[moduleSide === 'left' ? 2 : 0];
        expect(pocket.x1 - pocket.x0).toBeGreaterThan(c.w);
        expect(pocket.y1 - pocket.y0).toBeGreaterThan(c.h);
        expect(pocket.z1 + g.depth).toBeGreaterThan(c.height);
        expect(pocket.x0).toBeGreaterThan(g.rect.x0);
        expect(pocket.x1).toBeLessThan(g.rect.x1);
        expect(pocket.y0).toBeGreaterThan(g.rect.y0);
        const usb = g.ghosts.find((p) => p.kind === 'usb')!;
        expect(usb.box.y1).toBeCloseTo(g.rect.y1, 6);
        expect(islandSize(ip, 'left').w).toBeCloseTo(g.rect.x1 - g.rect.x0, 6);
      }
    });

  test('mała wyspa (prawa) daje poprawną bryłę', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = mirrorKeys(splitLeft(SPLIT_4x6_4));
    const g = islandFor(SPLIT_4x6_4, { ...DEFAULT_ISLAND, controller: 's2mini' }, 'right', 'hotswap', cell.height);
    const plate = buildPlate(keys, cell, undefined, g);
    expect(isValidShape(plate)).toBe(true);
    expect(plate.solids.length).toBe(1);
  }, 180000);
});

import { TEMPLATES, keyCorners, polysOverlap } from '../src/lib/layout';
describe('wyspa nie wchodzi na klawisze w żadnym szablonie', () => {
  for (const t of TEMPLATES)
    for (const moduleSide of ['left', 'none'] as const)
      test(`${t.id}, moduł: ${moduleSide}`, () => {
        const g = islandFor(t.params, { ...DEFAULT_ISLAND, moduleSide }, 'left', 'hotswap', 8.58)!;
        const r = g.rect;
        const rp: [number, number][] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
        for (const k of splitLeft(t.params)) expect(polysOverlap(keyCorners(k), rp)).toBe(false);
      });
});

describe('macropad: położenie wyspy', () => {
  const mp = TEMPLATES.find((t) => t.id === 'macropad-3x3')!.params;
  for (const position of ['top', 'inner', 'outer', 'bottom'] as const)
    for (const moduleSide of ['left', 'none'] as const)
      test(`${position}, moduł: ${moduleSide}`, async () => {
        const g = islandFor(mp, { ...DEFAULT_ISLAND, position, moduleSide }, 'left', 'hotswap', 8.58)!;
        const r = g.rect;
        const rp: [number, number][] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
        const keys = splitLeft(mp);
        for (const k of keys) expect(polysOverlap(keyCorners(k), rp)).toBe(false);
        // wyspa styka się z siatką (jedna bryła) i wszystkie wycięcia są w jej obrysie w XY
        for (const c of g.cuts.filter((c) => c.z1 > -8)) {
          expect(c.x0).toBeGreaterThanOrEqual(r.x0 - 1.01);
          expect(c.x1).toBeLessThanOrEqual(r.x1 + 1.01);
        }
        const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
        const plate = buildPlate(keys, cell, undefined, g);
        expect(isValidShape(plate)).toBe(true);
        expect(plate.solids.length).toBe(1);
      }, 180000);
});

describe('macropad: USB długą krawędzią', () => {
  const mp = TEMPLATES.find((t) => t.id === 'macropad-3x3')!.params;
  for (const position of ['top', 'bottom'] as const)
    for (const controller of Object.keys(CONTROLLERS) as ControllerId[])
      test(`${position}, ${controller}`, async () => {
        const g = islandFor(mp, { ...DEFAULT_ISLAND, position, controller, usbOut: 'edge' }, 'left', 'hotswap', 8.58)!;
        const usb = g.ghosts.find((p) => p.kind === 'usb')!.box;
        if (controller === 'esp32s3') {
          // za długi, żeby stać w poprzek wyspy z modułem: USB wychodzi z końca wyspy
          expect(Math.min(Math.abs(usb.x0 - g.rect.x0), Math.abs(usb.x1 - g.rect.x1))).toBeLessThan(1e-6);
        } else if (position === 'top') expect(usb.y1).toBeCloseTo(g.rect.y1, 6);
        else expect(usb.y0).toBeCloseTo(g.rect.y0, 6);
        // w wyspie obróconej (ESP32-S3) kolejność: gniazdo modułu, miejsce na luty, kieszeń
        const pocket = g.cuts[controller === 'esp32s3' ? 2 : 0];
        // kieszeń kontrolera nie rusza otworów pod śruby (szeroki kontroler może być pod nimi, niżej)
        for (const h of g.cuts.filter((c) => c.round))
          expect(h.x1 <= pocket.x0 || h.x0 >= pocket.x1 || h.y1 <= pocket.y0 || h.y0 >= pocket.y1 || h.z0 >= pocket.z1 - 0.02).toBe(true);
        // od strony klawiszy zostaje ścianka
        if (controller === 'esp32s3') { /* wyspa obrócona, ścianka sprawdzona wyżej */ }
        else if (position === 'top') expect(pocket.y0).toBeGreaterThan(g.rect.y0);
        else expect(pocket.y1).toBeLessThan(g.rect.y1);
        const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
        const plate = buildPlate(splitLeft(mp), cell, undefined, g);
        expect(isValidShape(plate)).toBe(true);
        expect(plate.solids.length).toBe(1);
      }, 180000);
});

describe('macropad: wyrównanie wyspy i dodatkowe klawisze', () => {
  const mp = { ...TEMPLATES.find((t) => t.id === 'macropad-4x4')!.params, cols: 6, stagger: Array(6).fill(0) };
  const grid = splitLeft(mp).flatMap(keyCorners);
  const kx0 = Math.min(...grid.map((q) => q[0]));
  const kx1 = Math.max(...grid.map((q) => q[0]));
  const ky0 = Math.min(...grid.map((q) => q[1]));
  const ky1 = Math.max(...grid.map((q) => q[1]));
  for (const usbOut of ['edge', 'end'] as const)
    test(`góra, USB ${usbOut}: do lewej, środek, do prawej`, () => {
      const r = (align: 'start' | 'center' | 'end') =>
        islandFor(mp, { ...DEFAULT_ISLAND, position: 'top', usbOut, align }, 'left', 'hotswap', 8.58)!.rect;
      expect(r('start').x0).toBeCloseTo(kx0, 6);
      expect(r('end').x1).toBeCloseTo(kx1, 6);
      expect((r('center').x0 + r('center').x1) / 2).toBeCloseTo((kx0 + kx1) / 2, 6);
    });
  for (const position of ['inner', 'outer'] as const)
    test(`${position}: do góry, środek, do dołu`, () => {
      const r = (align: 'start' | 'center' | 'end') =>
        islandFor(mp, { ...DEFAULT_ISLAND, position, align }, 'left', 'hotswap', 8.58)!.rect;
      expect(r('start').y1).toBeCloseTo(ky1, 6);
      expect(r('end').y0).toBeCloseTo(ky0, 6);
      expect((r('center').y0 + r('center').y1) / 2).toBeCloseTo((ky0 + ky1) / 2, 6);
    });

  test('dodatkowe klawisze obok wyspy nie przesuwają jej i dają jedną bryłę', async () => {
    // wyspa u góry do lewej (68 mm), w wolnym miejscu z prawej dwa klawisze nad siatką
    const p = { ...mp, extra: [{ col: 4, row: -1, w: 1, rot: 0 }, { col: 5, row: -1, w: 1, rot: 0 }] };
    const ip = { ...DEFAULT_ISLAND, position: 'top' as const, align: 'start' as const };
    const g = islandFor(p, ip, 'left', 'hotswap', 8.58)!;
    expect(g.rect).toEqual(islandFor(mp, ip, 'left', 'hotswap', 8.58)!.rect);
    const keys = splitLeft(p);
    expect(keys.filter((k) => k.id.startsWith('e-')).length).toBe(2);
    const r = g.rect;
    const rp: [number, number][] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
    for (const k of keys) expect(polysOverlap(keyCorners(k), rp)).toBe(false);
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const plate = buildPlate(keys, cell, undefined, g);
    expect(isValidShape(plate)).toBe(true);
    expect(plate.solids.length).toBe(1);
  }, 180000);
});

describe('ESP32-S3 z dwoma gniazdami USB', () => {
  for (const moduleSide of ['left', 'none'] as const)
    test(`moduł: ${moduleSide}`, async () => {
      const ip = { ...DEFAULT_ISLAND, controller: 'esp32s3' as const, moduleSide };
      const g = islandFor(SPLIT_4x6_4, ip, 'left', 'hotswap', 8.58)!;
      const usb = g.ghosts.filter((p) => p.kind === 'usb');
      expect(usb.length).toBe(2);
      for (const u of usb) expect(u.box.y1).toBeCloseTo(g.rect.y1, 6);
      // gniazda na −6,2 i +6,1 od środka płytki (klon z dwoma USB-C, patrząc od elementów);
      // płytka domyślnie odwrócona, więc z góry gniazda są w lustrze: −6,1 i +6,2
      const cx = (g.rect.x0 + g.rect.x1) / 2;
      const centers = usb.map((u) => (u.box.x0 + u.box.x1) / 2 - cx).sort((a, b) => a - b);
      expect(centers[0]).toBeCloseTo(-6.1, 6);
      expect(centers[1]).toBeCloseTo(6.2, 6);
      // elementami do góry: bez lustra
      const up = islandFor(SPLIT_4x6_4, { ...ip, flip: false }, 'left', 'hotswap', 8.58)!;
      const cu = up.ghosts.filter((p) => p.kind === 'usb').map((u) => (u.box.x0 + u.box.x1) / 2 - cx).sort((a, b) => a - b);
      expect(cu[0]).toBeCloseTo(-6.2, 6);
      expect(cu[1]).toBeCloseTo(6.1, 6);
      // prawa połówka (lustro lewej): gniazda fizycznie w tym samym miejscu płytki
      const r = islandFor(SPLIT_4x6_4, ip, 'right', 'hotswap', 8.58)!;
      const rcx = (r.rect.x0 + r.rect.x1) / 2;
      const cr = r.ghosts.filter((p) => p.kind === 'usb').map((u) => (u.box.x0 + u.box.x1) / 2 - rcx).sort((a, b) => a - b);
      expect(cr[0]).toBeCloseTo(-6.1, 6);
      expect(cr[1]).toBeCloseTo(6.2, 6);
      const pocket = g.cuts[moduleSide === 'left' ? 2 : 0];
      // kieszeń mieści płytkę z wystającym modułem (63,4) i szerokość 28,3
      expect(pocket.y1 - pocket.y0).toBeGreaterThanOrEqual(63.4);
      expect(pocket.x1 - pocket.x0).toBeGreaterThanOrEqual(28.3);
      expect(pocket.y0).toBeGreaterThan(g.rect.y0);
      for (const h of g.cuts.filter((c) => c.round))
        expect(h.x1 <= pocket.x0 || h.x0 >= pocket.x1 || h.y1 <= pocket.y0 || h.y0 >= pocket.y1 || h.z0 >= pocket.z1 - 0.02).toBe(true);
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const plate = buildPlate(splitLeft(SPLIT_4x6_4), cell, undefined, g);
      expect(isValidShape(plate)).toBe(true);
      expect(plate.solids.length).toBe(1);
    }, 180000);
});
