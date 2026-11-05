import { beforeAll, describe, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { measureVolume, makeBox, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildWedge, buildFront, buildFrontLocal, isValidShape } from '../src/lib/geometry';
import { TEMPLATES, splitLeft, PITCH } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND, FRONT, frontHeight, type IslandParams } from '../src/lib/island';
import { SCREW_MARGIN } from '../src/lib/case';

const tpl = TEMPLATES.find((t) => t.id === 'ansi-60')!.params;
const ip: IslandParams = { ...DEFAULT_ISLAND, position: 'top', align: 'end', tilt: 25, front: true };
const opts = { fillGaps: 4, margin: SCREW_MARGIN, stabs: 'cherry' as const };

beforeAll(async () => {
  await initOC();
}, 60000);

const vol = (s: Shape3D) => measureVolume(s);
const slab = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => makeBox([x0, y0, z0], [x1, y1, z1]);

describe('front modułu OLED', () => {
  test('bryła frontu: jedna, poprawna, wymiary i otwory', () => {
    const f = buildFrontLocal();
    expect(isValidShape(f)).toBe(true);
    expect(f.solids.length).toBe(1);
    const [lo, hi] = f.boundingBox.bounds;
    expect(hi[0] - lo[0]).toBeCloseTo(65.4 + 2 * FRONT.wall, 2);
    expect(hi[1] - lo[1]).toBeCloseTo(35.4 + 2 * FRONT.wall, 2);
    expect(lo[2]).toBeCloseTo(0, 3);
    expect(hi[2]).toBeCloseTo(frontHeight(), 3);
    const H = frontHeight();
    // okno, otwór enkodera i otwory na wkręty są przelotowe w czole
    const through = (x: number, y: number) => vol(f.clone().intersect(slab(x - 0.2, y - 0.2, FRONT.post, x + 0.2, y + 0.2, H)));
    expect(through(FRONT.win.u, FRONT.win.v)).toBeLessThan(1e-4);
    expect(through(FRONT.enc.u, FRONT.enc.v)).toBeLessThan(1e-4);
    expect(through(29.5, 14.5)).toBeLessThan(1e-4);
    // czoło jest pełne obok okna
    expect(through(-5, -15)).toBeGreaterThan(0.1);
    // krążek przycisku: materiał w środku, szczelina wokół
    expect(through(FRONT.btn.u, FRONT.btn.v)).toBeGreaterThan(0.1);
    const ringR = FRONT.btn.d / 2 + FRONT.btn.slot / 2;
    expect(vol(f.clone().intersect(slab(FRONT.btn.u - ringR - 0.05, FRONT.btn.v - 0.05, FRONT.post, FRONT.btn.u - ringR + 0.05, FRONT.btn.v + 0.05, H)))).toBeLessThan(1e-5);
    // kołeczek pod krążkiem kończy się tuż nad mikrostykiem
    const nub = f.clone().intersect(slab(FRONT.btn.u - 1, FRONT.btn.v - 1, 0, FRONT.btn.u + 1, FRONT.btn.v + 1, FRONT.post));
    expect(nub.boundingBox.bounds[0][2]).toBeCloseTo(FRONT.btn.top + FRONT.btn.nubGap, 2);
    // nad szkłem (do 3,1 mm nad płytką) nic nie ma
    expect(vol(f.clone().intersect(slab(-6.6, -11.5, 0, 28.4, 11.5, 3.15)))).toBeLessThan(1e-4);
  }, 120000);

  test('60%: wyspa szersza, narożnik frontu nie wchodzi nad klawisze, front stoi na klinie', async () => {
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const keys = splitLeft(tpl);
    const isl = islandFor(tpl, ip, 'left', 'hotswap', cell.height)!;
    const noFront = islandFor(tpl, { ...ip, front: false }, 'left', 'hotswap', cell.height)!;
    expect(isl.front).toBeDefined();
    expect(noFront.front).toBeUndefined();
    expect(isl.rect.y1 - isl.rect.y0).toBeGreaterThan(41);
    expect(isl.rect.x1 - isl.rect.x0).toBeGreaterThanOrEqual(68.99);
    // przepusty na listwę 9 pinów modułu (22,9 mm) mają zapas na obu końcach
    const slots = isl.wedge!.cuts.filter((c) => Math.abs(c.x1 - c.x0 - 23.4) < 0.01);
    expect(slots.length).toBeGreaterThanOrEqual(2);
    const front = buildFront(isl);
    expect(isValidShape(front)).toBe(true);
    const fb = front.boundingBox.bounds;
    // krawędź komórek przy wyspie: dół wyspy (wyspa nad klawiszami)
    const keyEdge = isl.rect.y0;
    expect(fb[0][1]).toBeGreaterThan(keyEdge + 0.2);
    // nic z frontu nie leży nad komórkami klawiszy
    const maxKeyY = Math.max(...keys.map((k) => k.y + PITCH / 2));
    expect(maxKeyY).toBeCloseTo(keyEdge, 3);
    // front nie wchodzi w klin ani w płytę, ale do klina przylega (stoi na nim)
    const wedge = buildWedge(isl);
    expect(isValidShape(wedge)).toBe(true);
    expect(vol(front.clone().intersect(wedge))).toBeLessThan(0.05);
    const plate = buildPlate(keys, cell, opts, isl);
    expect(vol(front.clone().intersect(plate))).toBeLessThan(0.01);
    const touching = vol(front.clone().translate(0, 0, -0.05).intersect(wedge));
    expect(touching).toBeGreaterThan(1);
    if (process.env.OUT) {
      const out = process.env.OUT;
      writeFileSync(`${out}/front-60-placed.step`, Buffer.from(await front.blobSTEP().arrayBuffer()));
      writeFileSync(`${out}/wedge-60.step`, Buffer.from(await wedge.blobSTEP().arrayBuffer()));
      writeFileSync(`${out}/plate-60.step`, Buffer.from(await plate.blobSTEP().arrayBuffer()));
      writeFileSync(`${out}/front-print.step`, Buffer.from(await buildFront(isl, true).blobSTEP().arrayBuffer()));
      writeFileSync(`${out}/front-local.step`, Buffer.from(await buildFrontLocal().blobSTEP().arrayBuffer()));
      writeFileSync(`${out}/front-60.json`, JSON.stringify(isl));
    }
  }, 300000);

  test('druk: czołem do stołu', () => {
    const isl = islandFor(tpl, ip, 'left', 'hotswap', 8.58)!;
    const p = buildFront(isl, true);
    const [lo, hi] = p.boundingBox.bounds;
    expect(lo[2]).toBeCloseTo(0, 3);
    expect(hi[2]).toBeCloseTo(frontHeight(), 3);
    // przy stole jest pełne czoło (duża powierzchnia na pierwszej warstwie)
    expect(vol(p.clone().intersect(slab(-50, -50, 0, 50, 50, 0.2)))).toBeGreaterThan(0.2 * 600);
  }, 120000);

  test('prawa połówka i wyspa pod klawiszami: front obrócony, a nie odbity', () => {
    const r = islandFor({ ...tpl, single: false }, ip, 'right', 'hotswap', 8.58);
    if (r?.front) {
      const l = islandFor({ ...tpl, single: false }, ip, 'left', 'hotswap', 8.58)!;
      expect(r.front.s).toBe(-1);
      expect(r.front.origin[0]).toBeCloseTo(-l.front!.origin[0], 6);
    }
    const below = islandFor(tpl, { ...ip, position: 'bottom' }, 'left', 'hotswap', 8.58)!;
    expect(below.front!.deg).toBe(-25);
    const fb = buildFront(below).boundingBox.bounds;
    // pod klawiszami: front nie wchodzi nad komórki (górna krawędź wyspy to krawędź komórek)
    expect(fb[1][1]).toBeLessThan(below.rect.y1 - 0.2);
  }, 120000);
});
