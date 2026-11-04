// Jednorazowy generator próbnych eksportów: OUT=/ścieżka npx vitest run tests/export-samples.test.ts
import { beforeAll, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate } from '../src/lib/geometry';
import { SPLIT_4x6_4, splitLeft, mirrorKeys } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND } from '../src/lib/island';

const OUT = process.env.OUT;
beforeAll(async () => { if (OUT) await initOC(); }, 60000);
test.skipIf(!OUT)('eksport próbek', async () => {
  for (const variant of ['hotswap', 'no-hotswap'] as const) {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
    for (const side of ['left', 'right'] as const) {
      const base = splitLeft(SPLIT_4x6_4);
      const keys = side === 'left' ? base : mirrorKeys(base);
      const plate = buildPlate(keys, cell, undefined, islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, side, variant, cell.height));
      const name = `${OUT}/plate-${side}-${variant}`;
      writeFileSync(`${name}.step`, Buffer.from(await plate.blobSTEP().arrayBuffer()));
      writeFileSync(`${name}.stl`, Buffer.from(await plate.blobSTL({ binary: true }).arrayBuffer()));
    }
  }
}, 600000);
