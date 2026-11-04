import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, importSTEP, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, detectUp, isValidShape, NO_HOTSWAP_HEIGHT } from '../src/lib/geometry';
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
