// Szybki podgląd skorupy Dactyla (siatka Manifold) ma się pokrywać z dokładną bryłą z OpenCascade.
import { beforeAll, expect, test } from 'vitest';
import { measureVolume } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell } from '../src/lib/geometry';
import { buildDactyl, DACTYL_DEFAULT } from '../src/lib/dactyl';
import { buildDactylShell } from '../src/lib/dactyl-geometry';
import { controllerHolder, DEFAULT_DACTYL_CONTROLLER } from '../src/lib/dactyl-parts';
import { hullsShellPreview, manifoldLib } from '../src/lib/dactyl-mesh';

beforeAll(async () => {
  await initOC();
}, 60000);

test('podgląd skorupy (Manifold) ≈ dokładna skorupa (OpenCascade): objętość i wymiary', async () => {
  const M = await manifoldLib();
  const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
  const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: cell.height });
  const b = { floor: 4, bossHeight: 7, controller: controllerHolder(m, DEFAULT_DACTYL_CONTROLLER) };
  const t0 = performance.now();
  const fast = hullsShellPreview(M, m, cell, b);
  const tFast = performance.now() - t0;
  expect(fast.status()).toBe('NoError');
  const t1 = performance.now();
  const exact = buildDactylShell(m, cell, b);
  const tExact = performance.now() - t1;
  console.log(`podgląd ${Math.round(tFast)} ms, dokładna ${Math.round(tExact)} ms`);
  const ve = measureVolume(exact);
  expect(Math.abs(fast.volume() - ve) / ve).toBeLessThan(0.01);
  const bb = fast.boundingBox();
  const eb = exact.boundingBox.bounds;
  for (let i = 0; i < 3; i++) {
    expect(bb.min[i]).toBeCloseTo(eb[0][i], 0);
    expect(bb.max[i]).toBeCloseTo(eb[1][i], 0);
  }
  expect(tFast * 5).toBeLessThan(tExact);
}, 300000);
