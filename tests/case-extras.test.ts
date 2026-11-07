import { beforeAll, describe, expect, test } from 'vitest';
import { makeBox, measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, screwPilots, extraPlatePockets, isValidShape } from '../src/lib/geometry';
import { TEMPLATES, splitLeft, mirrorKeys, keyCorners, polysOverlap, type Key } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND, type IslandParams, type Box } from '../src/lib/island';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN, SUPPORT, type CaseParams } from '../src/lib/case';
import { DEFAULT_EXTRAS, BATTERY_PRESETS, type CaseExtras, type LinkKind } from '../src/lib/case-extras';
import { planSplit, DEFAULT_PRINT } from '../src/lib/split';

const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!.params;
const extras = (link: LinkKind, battery = BATTERY_PRESETS[1]): CaseExtras => ({
  power: { ...DEFAULT_EXTRAS.power, on: true },
  link: { ...DEFAULT_EXTRAS.link, on: true, kind: link },
  battery: { on: true, l: battery.l, w: battery.w, t: battery.t },
});
const ov = (a: Box, b: Box, e = 0) =>
  a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.y0 < b.y1 - e && b.y0 < a.y1 - e && a.z0 < b.z1 - e && b.z0 < a.z1 - e;
const rp = (b: Box): [number, number][] => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
const distRect = (b: Box, x: number, y: number) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

interface Case {
  name: string;
  id: string;
  side: 'left' | 'right';
  ip: IslandParams;
}
const CASES: Case[] = [
  { name: 'split 4x6+4 lewa', id: 'split-4x6-4', side: 'left', ip: DEFAULT_ISLAND },
  { name: 'split 4x6+4 prawa', id: 'split-4x6-4', side: 'right', ip: DEFAULT_ISLAND },
  { name: 'split 3x5+3 lewa, S2 mini', id: 'split-3x5-3', side: 'left', ip: { ...DEFAULT_ISLAND, controller: 's2mini' } },
  { name: '60% z klinem', id: 'ansi-60', side: 'left', ip: { ...DEFAULT_ISLAND, position: 'top', align: 'end', tilt: 25 } },
  { name: 'macropad 3x3', id: 'macropad-3x3', side: 'left', ip: { ...DEFAULT_ISLAND, position: 'top', flip: false } },
];

function setup(c: Case, variant: 'hotswap' | 'no-hotswap', link: LinkKind, cp0: CaseParams = DEFAULT_CASE) {
  const ch = variant === 'hotswap' ? 8.58 : 5.08;
  const p = tpl(c.id);
  const base = splitLeft(p);
  const keys = c.side === 'left' ? base : mirrorKeys(base);
  const isl = islandFor(p, c.ip, c.side, variant, ch, SCREW_MARGIN);
  const split = p.single ? planSplit(keys, isl, SCREW_MARGIN, cp0.gap + cp0.wall, DEFAULT_PRINT) : null;
  const cp: CaseParams = { ...cp0, extras: extras(link) };
  const lay = caseLayout(keys, isl, ch, cp, split, 'cherry', { half: c.side, single: !!p.single });
  return { ch, keys, isl, lay, cp, split, single: !!p.single };
}

describe('dodatki w obudowie: rozmieszczenie i kolizje (bez CAD)', () => {
  test('domyślnie brak dodatków i układ bez zmian', () => {
    const p = tpl('split-4x6-4');
    const keys = splitLeft(p);
    const isl = islandFor(p, DEFAULT_ISLAND, 'left', 'hotswap', 8.58, SCREW_MARGIN);
    const a = caseLayout(keys, isl, 8.58, DEFAULT_CASE);
    const b = caseLayout(keys, isl, 8.58, { ...DEFAULT_CASE, extras: DEFAULT_EXTRAS });
    expect(DEFAULT_CASE.extras).toBeUndefined();
    expect(a.extras.ghosts).toEqual([]);
    expect(b.extras.ghosts).toEqual([]);
    expect(b.screws).toEqual(a.screws);
    expect(b.supports).toEqual(a.supports);
  });

  for (const c of CASES)
    for (const variant of ['hotswap', 'no-hotswap'] as const)
      for (const link of ['trrs', 'usbc'] as const)
        test(`${c.name}, ${variant}, ${link}`, () => {
          const { ch, keys, isl, lay, cp, single } = setup(c, variant, link);
          const ex = lay.extras;
          // wszystko ustawione (gniazdo tylko w splicie)
          expect(ex.warns.filter((w) => w.kind === 'noSpot' || w.kind === 'tooTall')).toEqual([]);
          const kinds = ex.ghosts.map((g) => g.kind);
          expect(kinds).toContain('switch');
          expect(kinds).toContain('battery');
          if (single) expect(kinds).not.toContain('jack');
          else expect(kinds).toContain(link === 'trrs' ? 'jack' : 'pcb');
          const bodies = ex.ghosts;
          // nie zachodzą na elektronikę wyspy (kontroler, USB, moduł OLED, enkoder)
          for (const g of bodies) for (const e of isl?.ghosts ?? []) expect(ov(g.box, e.box), `${g.kind} vs ${e.kind}`).toBe(false);
          // ani na wyspę i drogę wtyku USB kontrolera (w XY)
          for (const g of bodies) {
            if (isl) expect(polysOverlap(rp(g.box), rp({ ...isl.rect, z0: 0, z1: 0 }))).toBe(false);
            for (const u of lay.usbCuts) expect(polysOverlap(rp(g.box), rp(u))).toBe(false);
          }
          // nad spodem komórek (przełączniki, gniazda hot-swap) tylko poza obrysem klawiszy
          for (const g of bodies)
            if (g.box.z1 > -ch - 0.1) for (const k of keys) expect(polysOverlap(keyCorners(k), rp(g.box)), `${g.kind} nad komórką ${k.id}`).toBe(false);
          // nad częściami zostaje płyta (co najmniej 1,2 mm) i pod nimi dno (co najmniej 0,8 mm)
          for (const g of bodies) {
            expect(g.box.z1).toBeLessThanOrEqual(-1.2 + 1e-6);
            expect(g.box.z0).toBeGreaterThanOrEqual(lay.bottom + 0.8 - 1e-6);
          }
          // części nie zachodzą na siebie (różne części: włącznik, gniazdo, bateria)
          const groups = [bodies.filter((g) => ['switch', 'knob'].includes(g.kind) || (g.kind === 'usb' && !kinds.includes('jack') && g.box.z1 - g.box.z0 < 2)), bodies.filter((g) => g.kind === 'battery')];
          for (const a of groups[0]) for (const b of groups[1]) expect(ov(a.box, b.box)).toBe(false);
          // śruby i podpory omijają części i baterię
          const bat = bodies.find((g) => g.kind === 'battery')!.box;
          for (const [x, y] of lay.screws) for (const g of bodies) expect(distRect(g.box, x, y)).toBeGreaterThanOrEqual(lay.screw.boss / 2);
          for (const [x, y] of lay.supports) for (const g of bodies) expect(distRect(g.box, x, y), `podpora przy ${g.kind}`).toBeGreaterThanOrEqual(SUPPORT.d / 2 + 0.5);
          expect(lay.supports.every(([x, y]) => distRect(bat, x, y) >= SUPPORT.d / 2 + 0.5)).toBe(true);
          void cp;
        });
});

describe('dodatki w obudowie: bryły (CAD)', () => {
  beforeAll(initOC, 60000);
  const opts = { fillGaps: 4, margin: SCREW_MARGIN };
  const vol = (s: Shape3D) => (s.solids?.length ? measureVolume(s) : 0);
  for (const c of [CASES[0], CASES[1], CASES[3]])
    for (const variant of ['hotswap', 'no-hotswap'] as const)
      for (const link of (c.id === 'ansi-60' ? ['trrs'] : ['trrs', 'usbc']) as LinkKind[])
        test(`${c.name}, ${variant}, ${link}: części nie wchodzą w płytę ani w spód`, async () => {
          const { keys, isl, lay, cp } = setup(c, variant, link);
          const cell = await loadCell({ step: cellStep(), up: 'auto' }, variant);
          const plate = buildPlate(keys, cell, opts, isl, [...screwPilots(lay.screws, cell.height, lay.pilotDepth, lay.screw), ...extraPlatePockets(lay.extras)]);
          const shell = buildCase(keys, opts, isl, cell.height, cp, lay);
          expect(isValidShape(plate)).toBe(true);
          expect(isValidShape(shell)).toBe(true);
          expect(shell.solids.length).toBe(1);
          for (const g of lay.extras.ghosts) {
            const b = makeBox([g.box.x0, g.box.y0, g.box.z0], [g.box.x1, g.box.y1, g.box.z1]);
            expect(vol(b.clone().intersect(plate) as Shape3D), `${g.kind} w płycie`).toBeLessThan(0.05);
            expect(vol(b.intersect(shell) as Shape3D), `${g.kind} w spodzie`).toBeLessThan(0.05);
          }
          // przełączniki MX (nad płytą i w komórkach) nie mają styku z częściami: części leżą pod płytą poza komórkami
        }, 240000);
});
