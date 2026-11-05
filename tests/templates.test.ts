// Każdy szablon daje poprawną, jedną bryłę z wyspą po obu stronach.
import { beforeAll, expect, test } from 'vitest';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, isValidShape } from '../src/lib/geometry';
import { TEMPLATES, splitLeft, mirrorKeys } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND } from '../src/lib/island';
beforeAll(initOC, 60000);
for (const t of TEMPLATES)
  for (const side of ['left', 'right'] as const)
    test(`${t.id} ${side}`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const base = splitLeft(t.params);
      const keys = side === 'left' ? base : mirrorKeys(base);
      const plate = buildPlate(keys, cell, undefined, islandFor(t.params, DEFAULT_ISLAND, side, 'hotswap', cell.height));
      expect(isValidShape(plate)).toBe(true);
      expect(plate.solids.length).toBe(1);
    }, 180000);
