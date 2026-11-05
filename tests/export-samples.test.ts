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

// 60% ANSI z podziałem pod stół 250 × 250: OUT60=/ścieżka npx vitest run tests/export-samples.test.ts
const OUT60 = process.env.OUT60;
test.skipIf(!OUT60)('eksport próbek 60%', async () => {
  const { TEMPLATES } = await import('../src/lib/layout');
  const { planSplit, DEFAULT_PRINT } = await import('../src/lib/split');
  const { platePiece, casePiece } = await import('../src/lib/geometry');
  await initOC();
  const p = TEMPLATES.find((t) => t.id === 'ansi-60')!.params;
  const ip = { ...DEFAULT_ISLAND, position: 'top' as const, align: 'end' as const };
  const opts = { fillGaps: 4, margin: SCREW_MARGIN, stabs: 'cherry' as const };
  for (const variant of ['hotswap', 'no-hotswap'] as const) {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
    const keys = splitLeft(p);
    const island = islandFor(p, ip, 'left', variant, cell.height);
    const sp = planSplit(keys, island, SCREW_MARGIN, DEFAULT_CASE.gap + DEFAULT_CASE.wall, DEFAULT_PRINT)!;
    const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE, sp);
    const plate = buildPlate(keys, cell, opts, island, screwPilots(lay.screws, cell.height, lay.pilotDepth));
    const shell = buildCase(keys, opts, island, cell.height, DEFAULT_CASE, lay);
    for (const pc of [0, 1] as const) {
      const parts = [
        ['plate', platePiece(plate, sp, DEFAULT_PRINT.clearance, pc)],
        ['case', casePiece(shell, sp.caseX, pc)],
      ] as const;
      for (const [part, shape] of parts) {
        const name = `${OUT60}/60-${part}-${pc + 1}of2-${variant}`;
        writeFileSync(`${name}.step`, Buffer.from(await shape.blobSTEP().arrayBuffer()));
        writeFileSync(`${name}.stl`, Buffer.from(await shape.blobSTL({ binary: true }).arrayBuffer()));
      }
    }
  }
}, 900000);

// Dactyl 5×6 + 6 kciuk (domyślny z Dactyl Configuratora): OUTD=/ścieżka npx vitest run tests/export-samples.test.ts
const OUTD = process.env.OUTD;
test.skipIf(!OUTD)('eksport próbek Dactyl', async () => {
  const { buildDactyl, DACTYL_DEFAULT } = await import('../src/lib/dactyl');
  const { buildDactylShell, buildDactylBottom } = await import('../src/lib/dactyl-geometry');
  const { controllerHolder, DEFAULT_DACTYL_CONTROLLER } = await import('../src/lib/dactyl-parts');
  await initOC();
  const write = async (name: string, shape: import('replicad').Shape3D) => {
    writeFileSync(`${OUTD}/${name}.step`, Buffer.from(await shape.blobSTEP().arrayBuffer()));
    writeFileSync(`${OUTD}/${name}.stl`, Buffer.from(await shape.blobSTL({ binary: true }).arrayBuffer()));
  };
  for (const variant of ['hotswap', 'no-hotswap'] as const) {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height });
    const b = { floor: 4, bossHeight: 7, controller: controllerHolder(m, DEFAULT_DACTYL_CONTROLLER) };
    const shell = buildDactylShell(m, cell, b);
    await write(`dactyl-5x6-right-shell-${variant}`, shell);
    await write(`dactyl-5x6-left-shell-${variant}`, shell.clone().mirror('YZ', [0, 0, 0]) as import('replicad').Shape3D);
    if (variant === 'hotswap') {
      const bottom = buildDactylBottom(m, b);
      await write('dactyl-5x6-right-bottom', bottom);
      await write('dactyl-5x6-left-bottom', bottom.clone().mirror('YZ', [0, 0, 0]) as import('replicad').Shape3D);
    }
  }
}, 900000);
