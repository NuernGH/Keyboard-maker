import { beforeAll, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeBox, makeCylinder, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { measureController, parseSTL, unindex } from '../src/lib/controller-measure';
import { islandFor, DEFAULT_ISLAND, CONTROLLERS, sanitizeController, controllerOf, FIT_PRESETS, type Controller } from '../src/lib/island';
import { controllerPads } from '../src/lib/case';
import { loadCell, buildPlate, isValidShape } from '../src/lib/geometry';
import { SPLIT_4x6_4, splitLeft } from '../src/lib/layout';

beforeAll(initOC, 60000);

const nanoStl = () => {
  const b = readFileSync(fileURLToPath(new URL('../public/controllers/nice-nano-v2.stl', import.meta.url)));
  return parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};

/**
 * Sztuczny kontroler: płytka 28 × 50 × 1,5 (x w poprzek, y wzdłuż, USB w +y, elementy w +z),
 * dwa gniazda USB-C 9 × 7,5 × 3,2 na płytce (środki −6 i +6,5, wystają 1 mm), moduł 18 × 12 × 3
 * wystający 5 mm za drugi koniec, rzędy pinów Ø1 na ±11,43 co 2,54 (od 3 do 46,18), para otworów Ø2,2 (±9, 10 mm od końca).
 */
function fakeBoard(): Shape3D {
  let s = makeBox([-14, 0, 0], [14, 50, 1.5]) as Shape3D;
  for (const x of [-11.43, 11.43])
    for (let y = 3; y <= 47; y += 2.54) s = s.cut(makeCylinder(0.5, 4, [x, y, -1], [0, 0, 1])) as Shape3D;
  for (const x of [-9, 9]) s = s.cut(makeCylinder(1.1, 4, [x, 10, -1], [0, 0, 1])) as Shape3D;
  for (const x of [-6, 6.5]) s = s.fuse(makeBox([x - 4.5, 43.5, 1.5], [x + 4.5, 51, 4.7])) as Shape3D;
  s = s.fuse(makeBox([-9, -5, 1.5], [9, 7, 4.5])) as Shape3D;
  return s;
}
const trisOf = (s: Shape3D) => {
  const m = s.mesh({ tolerance: 0.02, angularTolerance: 0.2 });
  return unindex(m.vertices, m.triangles);
};

function expectFake(c: Controller) {
  expect(c.w).toBeCloseTo(28, 0);
  expect(Math.abs(c.w - 28)).toBeLessThan(0.15);
  // od krawędzi z USB do końca modułu: 50 + 5
  expect(Math.abs(c.h - 55)).toBeLessThan(0.3);
  expect(Math.abs(c.pcb! - 1.5)).toBeLessThan(0.06);
  expect(Math.abs(c.height - 4.7)).toBeLessThan(0.1);
  expect(Math.abs(c.usbOverhang - 1)).toBeLessThan(0.25);
  expect(c.usbZ0).toBeUndefined(); // gniazda leżą na płytce
  expect(c.ports!.length).toBe(2);
  expect(Math.abs(c.ports![0] + 6)).toBeLessThan(0.25);
  expect(Math.abs(c.ports![1] - 6.5)).toBeLessThan(0.25);
  expect(c.pins!.x.length).toBe(1);
  expect(Math.abs(c.pins!.x[0] - 11.43)).toBeLessThan(0.25);
  // piny od 3 do 46,18 mm od dalszego końca płytki = od 3,82 do 47 mm od krawędzi z USB
  expect(Math.abs(c.pins!.y0 - 3.82)).toBeLessThan(0.4);
  expect(Math.abs(c.pins!.y1 - 47.0)).toBeLessThan(0.4);
  expect(c.holes!.length).toBe(1);
  expect(Math.abs(c.holes![0].x - 9)).toBeLessThan(0.25);
  expect(Math.abs(c.holes![0].y - 40)).toBeLessThan(0.3);
}

describe('pomiar kontrolera z modelu', () => {
  test('nice!nano (STL z public/controllers) daje liczby z kodu', () => {
    const r = measureController(nanoStl(), 'nice!nano');
    const c = r.controller;
    const ref = CONTROLLERS.nicenano;
    expect(Math.abs(c.w - ref.w)).toBeLessThan(0.15);
    expect(Math.abs(c.h - ref.h)).toBeLessThan(0.3);
    expect(Math.abs(c.height - ref.height)).toBeLessThan(0.15);
    expect(Math.abs(c.pcb! - ref.pcb!)).toBeLessThan(0.1);
    // gniazdo we wcięciu płytki, wystaje 0,2 pod płaską stronę
    expect(Math.abs(c.usbZ0! - ref.usbZ0!)).toBeLessThan(0.1);
    expect(Math.abs(c.usbOverhang - ref.usbOverhang)).toBeLessThan(0.3);
    expect(Math.abs(c.pins!.x[0] - 7.62)).toBeLessThan(0.15);
    expect(r.ports.length).toBe(1);
    expect(r.warnings.filter((w) => w.key !== 'mNoPins')).toEqual([]);
  });

  test('sztuczny kontroler w swoim układzie', () => {
    expectFake(measureController(trisOf(fakeBoard()), 'fake').controller);
  }, 60000);

  // ten sam model obrócony dowolnie (bez odbicia): wynik ten sam, także znaki środków gniazd
  for (const [name, rot] of [
    ['USB w −X, elementy w +Y', (s: Shape3D) => s.rotate(90, [0, 0, 0], [0, 0, 1]).rotate(-90, [0, 0, 0], [1, 0, 0])],
    ['do góry nogami', (s: Shape3D) => s.rotate(180, [0, 0, 0], [0, 1, 0])],
    ['USB w −Z', (s: Shape3D) => s.rotate(90, [0, 0, 0], [1, 0, 0])],
  ] as const)
    test(`obrócony: ${name}`, () => {
      expectFake(measureController(trisOf(rot(fakeBoard()) as Shape3D), 'fake').controller);
    }, 60000);

  test('opcje: USB z drugiej strony, odwrócenie, jednostki', () => {
    const tris = trisOf(fakeBoard());
    const other = measureController(tris, 'fake', { usbEnd: '-' });
    expect(other.usbEnd).toBe('-');
    expect(other.controller.ports ?? []).not.toHaveLength(2);
    const flipped = measureController(tris, 'fake', { flip: true });
    expect(flipped.controller.height).toBeLessThan(2);
    // model w cm (×0,1): mnożnik 10 przywraca wymiary
    const cm = tris.map((v) => v / 10);
    const small = measureController(cm, 'fake');
    expect(small.warnings.some((w) => w.key === 'mUnits')).toBe(true);
    expectFake(measureController(cm, 'fake', { scale: 10 }).controller);
  }, 60000);

  test('siatka do podglądu: spód płytki na Y = 0, dalszy koniec na Z = 0, USB w +Z', () => {
    const r = measureController(trisOf(fakeBoard()), 'fake');
    let [minY, minZ, maxZ] = [Infinity, Infinity, -Infinity];
    for (let i = 0; i < r.positions.length; i += 3) {
      minY = Math.min(minY, r.positions[i + 1]);
      minZ = Math.min(minZ, r.positions[i + 2]);
      maxZ = Math.max(maxZ, r.positions[i + 2]);
    }
    expect(minY).toBeCloseTo(0, 3);
    expect(minZ).toBeCloseTo(0, 3);
    expect(maxZ).toBeCloseTo(56, 1); // 5 (moduł) + 50 + 1 (USB)
  }, 60000);
});

describe('własny kontroler w generatorze', () => {
  test('sanitizeController przycina liczby i uzupełnia braki', () => {
    const c = sanitizeController({ name: ' X ', w: 500, h: -3, height: NaN, ports: [99] } as never);
    expect(c.name).toBe('X');
    expect(c.w).toBe(80);
    expect(c.h).toBe(5);
    expect(c.height).toBe(CONTROLLERS.nicenano.height);
    expect(c.ports).toEqual([40]);
    expect(controllerOf({ controller: 'custom' })).toBe(CONTROLLERS.nicenano);
  });

  test('wyspa i płyta z kontrolerem zmierzonym z modelu', async () => {
    const custom = measureController(trisOf(fakeBoard()), 'fake').controller;
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    for (const flip of [true, false]) {
      const g = islandFor(SPLIT_4x6_4, { ...DEFAULT_ISLAND, controller: 'custom', custom, moduleSide: 'none', flip, pins: true }, 'left', 'hotswap', cell.height)!;
      const board = g.ghosts.find((p) => p.kind === 'nano')!.box;
      expect(board.x1 - board.x0).toBeCloseTo(custom.w, 6);
      expect(board.y1 - board.y0).toBeCloseTo(custom.h, 6);
      // dwa gniazda, w lustrze przy odwróconej płytce (patrzymy z góry)
      const cx = (board.x0 + board.x1) / 2;
      const ports = g.ghosts.filter((p) => p.kind === 'usb').map((u) => (u.box.x0 + u.box.x1) / 2 - cx).sort((a, b) => a - b);
      const want = custom.ports!.map((x) => (flip ? -x : x)).sort((a, b) => a - b);
      expect(ports[0]).toBeCloseTo(want[0], 6);
      expect(ports[1]).toBeCloseTo(want[1], 6);
      // odwrócony: otwory pilotowe na wkręty w parze otworów
      expect(g.cuts.filter((k) => k.round).length).toBe(flip ? 2 : 0);
      const plate = buildPlate(splitLeft(SPLIT_4x6_4), cell, undefined, g);
      expect(isValidShape(plate)).toBe(true);
      expect(plate.solids.length).toBe(1);
    }
  }, 240000);
});

describe('dopasowanie w pionie', () => {
  const geom = (fit: 'standard' | 'snug' | 'press' | 'custom', flip: boolean, extra = {}) =>
    islandFor(SPLIT_4x6_4, { ...DEFAULT_ISLAND, moduleSide: 'none', flip, fit, ...extra }, 'left', 'hotswap', 8.58)!;
  const boardOf = (g: ReturnType<typeof geom>) => g.ghosts.find((p) => p.kind === 'nano')!.box;
  const pocketOf = (g: ReturnType<typeof geom>) => {
    const b = boardOf(g);
    return g.cuts.find((k) => k.x0 <= b.x0 && k.x1 >= b.x1 && k.y0 <= b.y0 && k.y1 >= b.y1 && k.z0 < b.z0)!;
  };

  for (const fit of ['standard', 'snug', 'press'] as const) {
    const { top, bottom } = FIT_PRESETS[fit];
    test(`${fit}: elementami do góry — strop ${top} nad elementami, podkładka ${bottom} pod płytką`, () => {
      const g = geom(fit, false);
      const b = boardOf(g);
      const c = CONTROLLERS.nicenano;
      // płytka zostaje na miejscu niezależnie od dopasowania (gniazdo USB w tej samej wysokości)
      expect(b.z0).toBeCloseTo(boardOf(geom('standard', false)).z0, 9);
      expect(pocketOf(g).z1 - (b.z0 + c.height)).toBeCloseTo(top, 9);
      const pads = controllerPads(g, b.z0 - 5);
      expect(pads.length).toBe(1);
      expect(b.z0 - pads[0].z1).toBeCloseTo(bottom, 9);
    });
    test(`${fit}: odwrócony — płytka przy płycie, podest ${bottom} pod gniazdem`, () => {
      const g = geom(fit, true);
      const b = boardOf(g);
      expect(pocketOf(g).z1).toBeCloseTo(b.z1, 9);
      const usb = g.ghosts.find((p) => p.kind === 'usb')!.box;
      const pads = controllerPads(g, usb.z0 - 5);
      expect(pads.length).toBe(1);
      expect(usb.z0 - pads[0].z1).toBeCloseTo(bottom, 9);
    });
  }

  test('własne luzy, z ograniczeniem do rozsądnych wartości', () => {
    const g = geom('custom', false, { fitTop: 0.3, fitBottom: -5 });
    const b = boardOf(g);
    expect(pocketOf(g).z1 - (b.z0 + CONTROLLERS.nicenano.height)).toBeCloseTo(0.3, 9);
    expect(b.z0 - controllerPads(g, b.z0 - 5)[0].z1).toBeCloseTo(-0.6, 9);
  });
});
