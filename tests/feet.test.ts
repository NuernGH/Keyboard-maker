import { beforeAll, describe, expect, test } from 'vitest';
import { measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep } from './oc';
import { loadCell, buildPlate, buildCase, screwPilots, isValidShape } from '../src/lib/geometry';
import { TEMPLATES, splitLeft, mirrorKeys } from '../src/lib/layout';
import { islandFor, DEFAULT_ISLAND, type IslandParams } from '../src/lib/island';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN, type CaseParams } from '../src/lib/case';
import { planSplit, DEFAULT_PRINT } from '../src/lib/split';
import { DEFAULT_EXTRAS, BATTERY_PRESETS } from '../src/lib/case-extras';
import { pocketArea } from '../src/lib/feet';
import { makeBox } from 'replicad';
import { DEPLOYED, LEG, POCKET, POCKET_HALF, type FeetMode } from '../src/lib/feet';
import { buildLeg, buildFeetBar, buildFeetPads, placeLeg } from '../src/lib/feet-geometry';

const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!.params;
const ISL60: IslandParams = { ...DEFAULT_ISLAND, controller: 's2mini', position: 'top', align: 'end', tilt: 25 };

function setup(id: string, ip: IslandParams, variant: 'hotswap' | 'no-hotswap', mode: FeetMode, side: 'left' | 'right' = 'left', cp0: CaseParams = DEFAULT_CASE) {
  const ch = variant === 'hotswap' ? 8.58 : 5.08;
  const p = tpl(id);
  const base = splitLeft(p);
  const keys = side === 'left' ? base : mirrorKeys(base);
  const isl = islandFor(p, ip, side, variant, ch, SCREW_MARGIN);
  const split = p.single ? planSplit(keys, isl, SCREW_MARGIN, cp0.gap + cp0.wall, DEFAULT_PRINT) : null;
  const cp: CaseParams = { ...cp0, feet: { mode } };
  const lay = caseLayout(keys, isl, ch, cp, split, 'cherry', { half: side, single: !!p.single });
  const plain = caseLayout(keys, isl, ch, cp0, split, 'cherry', { half: side, single: !!p.single });
  return { ch, keys, isl, lay, plain, cp };
}

describe('nóżki: rozmieszczenie (bez CAD)', () => {
  test('domyślnie wyłączone, obudowa bez zmian', () => {
    expect(DEFAULT_CASE.feet).toBeUndefined();
    const { lay, plain } = setup('ansi-60', ISL60, 'hotswap', 'none');
    expect(lay).toEqual(plain);
    expect(lay.feet).toBeUndefined();
  });

  for (const variant of ['hotswap', 'no-hotswap'] as const) {
    test(`60% listwa, ${variant}`, () => {
      const { lay, plain } = setup('ansi-60', ISL60, variant, 'bar');
      const f = lay.feet!;
      expect(f.warns).toEqual([]);
      expect(f.legs.length).toBe(2);
      // obudowa się nie zmienia (śruby, podpory, dno)
      expect(lay.screws).toEqual(plain.screws);
      expect(lay.supports).toEqual(plain.supports);
      expect(lay.bottom).toBe(plain.bottom);
      // listwa na tylnych śrubach mieści się na stole 245
      expect(f.bar!.x1 - f.bar!.x0).toBeLessThan(DEFAULT_PRINT.bedX - 10);
      expect(f.bar!.screws.length).toBeGreaterThanOrEqual(2);
      expect(f.pads!.length).toBe(2);
      expect(f.screwLength).toBeGreaterThan(lay.screwLength);
      expect(f.tilt).toBeGreaterThan(4);
      expect(f.tilt).toBeLessThan(8);
    });
    test(`60% kieszenie w dnie, ${variant}`, () => {
      const { lay, isl, plain } = setup('ansi-60', ISL60, variant, 'pocket');
      const f = lay.feet!;
      expect(f.warns).toEqual([]);
      expect(f.legs.length).toBe(2);
      // szeroki rozstaw (wybór Marcina: ok. 248 mm)
      expect(f.legs[1] - f.legs[0]).toBeGreaterThan(230);
      // kieszenie przed wyspą
      expect(f.pivotY + LEG.thick / 2 + POCKET.stopGap + 1).toBeLessThan(isl!.rect.y0);
      // śruby bez zmian; podpory tylko bez tych, które stały na kieszeniach
      expect(lay.screws).toEqual(plain.screws);
      for (const s of lay.supports) expect(plain.supports).toContainEqual(s);
      // pogrubione dno pod komórkami
      for (const b of f.thicken!) expect(b.z1).toBeLessThan(-8.3);
      expect(f.bumpers!.length).toBe(4);
      expect(f.tilt).toBeGreaterThan(4);
    });
  }

  test('bateria ustępuje nóżkom w dnie; bez nóżek i z listwą zostaje na miejscu', () => {
    for (const b of BATTERY_PRESETS) {
      const cp0: CaseParams = { ...DEFAULT_CASE, extras: { ...DEFAULT_EXTRAS, battery: { on: true, l: b.l, w: b.w, t: b.t } } };
      const plain = setup('ansi-60', ISL60, 'hotswap', 'none', 'left', cp0).lay;
      const bar = setup('ansi-60', ISL60, 'hotswap', 'bar', 'left', cp0).lay;
      const pocket = setup('ansi-60', ISL60, 'hotswap', 'pocket', 'left', cp0).lay;
      const bat = (l: typeof plain) => l.extras.ghosts.find((g) => g.kind === 'battery')!.box;
      expect(bat(bar)).toEqual(bat(plain));
      const f = pocket.feet!;
      expect(f.warns, b.id).toEqual([]);
      expect(f.legs[1] - f.legs[0]).toBeGreaterThan(230);
      const bb = bat(pocket);
      for (const xc of f.legs) {
        const a = pocketArea(xc, f.pivotY, 1.5);
        expect(bb.x1 < a.x0 || bb.x0 > a.x1 || bb.y1 < a.y0 || bb.y0 > a.y1, `${b.id} ${xc}`).toBe(true);
      }
      expect(pocket.extras.warns.filter((w) => w.part === 'battery')).toEqual([]);
    }
  });

  test('inne szablony: bez błędów, nóżki z dala od śrub', () => {
    for (const id of ['split-4x6-4', 'split-3x5-3', 'macropad-3x3'])
      for (const mode of ['bar', 'pocket'] as const)
        for (const side of ['left', 'right'] as const) {
          const { lay } = setup(id, id === 'macropad-3x3' ? { ...DEFAULT_ISLAND, position: 'top', flip: false } : DEFAULT_ISLAND, 'hotswap', mode, side);
          const f = lay.feet!;
          expect(f).toBeDefined();
          if (f.warns.includes('noSpot')) continue;
          for (const xc of f.legs)
            for (const [x, y] of lay.screws) {
              const dx = Math.max(Math.abs(x - xc) - POCKET_HALF, 0);
              const dy = Math.max(f.pivotY - 14 - y, 0, y - f.pivotY - 2);
              expect(Math.hypot(dx, dy), `${id} ${mode} ${side}`).toBeGreaterThan(lay.screw.head / 2);
            }
        }
  });
});

describe('nóżki: bryły (CAD)', () => {
  beforeAll(initOC, 60000);
  const vol = (s: Shape3D) => (s.solids?.length ? measureVolume(s) : 0);
  const opts = { fillGaps: 4, margin: SCREW_MARGIN };

  test('nóżka i listwa: obrót bez kolizji, zatrzask i oparcie', () => {
    const { lay } = setup('ansi-60', ISL60, 'hotswap', 'bar');
    const f = lay.feet!;
    const leg = buildLeg();
    expect(isValidShape(leg)).toBe(true);
    const bb = leg.boundingBox.bounds;
    expect(bb[1][0] - bb[0][0]).toBeCloseTo(24 + 1.6, 1);
    const bar = buildFeetBar(f, lay.bottom, lay.screw, lay.headDepth)!;
    expect(isValidShape(bar)).toBe(true);
    expect(bar.solids.length).toBe(1);
    for (const p of buildFeetPads(f, lay.bottom, lay.screw, lay.headDepth)) expect(isValidShape(p)).toBe(true);
    const hit = (deg: number) => vol(placeLeg(leg, f, f.legs[0], deg).intersect(bar.clone()) as Shape3D);
    // złożona: tylko guzki zatrzasku w dołkach (bez kolizji), w drodze: klik, potem swobodnie, na końcu oparcie
    expect(hit(0)).toBeLessThan(0.01);
    expect(hit(7)).toBeGreaterThan(0.001);
    for (const a of [25, 60, 90]) expect(hit(a), `${a}°`).toBeLessThan(0.01);
    expect(hit(DEPLOYED.deg + 3)).toBeGreaterThan(0.01);
  }, 240000);

  test('kieszenie w dnie 60%: spód poprawny, nóżka obraca się, płyta bez kolizji', async () => {
    const { keys, isl, lay, cp } = setup('ansi-60', ISL60, 'hotswap', 'pocket');
    const f = lay.feet!;
    const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
    const shell = buildCase(keys, opts, isl, cell.height, cp, lay);
    expect(isValidShape(shell)).toBe(true);
    expect(shell.solids.length).toBe(1);
    const plate = buildPlate(keys, cell, opts, isl, screwPilots(lay.screws, cell.height, lay.pilotDepth, lay.screw));
    expect(vol(plate.intersect(shell.clone()) as Shape3D)).toBeLessThan(0.05);
    const leg = buildLeg();
    for (const xc of f.legs)
      for (const a of [0, 45, 90]) expect(vol(placeLeg(leg, f, xc, a).intersect(shell.clone()) as Shape3D), `${xc} ${a}°`).toBeLessThan(0.01);
    // z baterią: spód poprawny, ogniwo nie wchodzi w spód
    {
      const cpB: CaseParams = { ...DEFAULT_CASE, extras: { ...DEFAULT_EXTRAS, battery: { on: true, l: 40, w: 45, t: 3 } } };
      const s2 = setup('ansi-60', ISL60, 'hotswap', 'pocket', 'left', cpB);
      const sh = buildCase(s2.keys, opts, s2.isl, cell.height, { ...cpB, feet: { mode: 'pocket' } }, s2.lay);
      expect(isValidShape(sh)).toBe(true);
      const g = s2.lay.extras.ghosts.find((q) => q.kind === 'battery')!.box;
      expect(vol(makeBox([g.x0, g.y0, g.z0], [g.x1, g.y1, g.z1]).intersect(sh) as Shape3D)).toBeLessThan(0.05);
    }
    // rozłożona wystaje pod spód
    const dep = placeLeg(leg, f, f.legs[0], DEPLOYED.deg).boundingBox.bounds;
    expect(lay.bottom - dep[0][2]).toBeGreaterThan(POCKET.depth / 2 + 8);
  }, 300000);
});
