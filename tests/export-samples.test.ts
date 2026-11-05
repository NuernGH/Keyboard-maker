// Jednorazowy generator próbnych eksportów: OUT=/ścieżka npx vitest run tests/export-samples.test.ts
import { beforeAll, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, screwPilots } from '../src/lib/geometry';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN } from '../src/lib/case';
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
      const island = islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, side, variant, cell.height);
      const opts = { fillGaps: 4, margin: SCREW_MARGIN };
      const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE);
      const plate = buildPlate(keys, cell, opts, island, screwPilots(lay.screws, cell.height, lay.pilotDepth));
      const shell = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, lay);
      for (const [part, shape] of [['plate', plate], ['case', shell]] as const) {
        const name = `${OUT}/${part}-${side}-${variant}`;
        writeFileSync(`${name}.step`, Buffer.from(await shape.blobSTEP().arrayBuffer()));
        writeFileSync(`${name}.stl`, Buffer.from(await shape.blobSTL({ binary: true }).arrayBuffer()));
      }
    }
  }
}, 600000);
