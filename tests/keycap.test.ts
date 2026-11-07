// Nakładki: wymiary, pasowanie do modelu Cherry MX (spoczynek i pełne wciśnięcie), sąsiedzi,
// obudowa (split, 60% z klinem OLED) i Dactyl.
import { beforeAll, describe, expect, test } from 'vitest';
import { makeBox, makeCylinder, measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep, switchStep } from './oc';
import { loadSwitch } from '../src/lib/switch-model';
import { buildKeycap, buildCalibration, keycapHull, printPose } from '../src/lib/keycap';
import {
  CALIBRATION_CLEARANCES,
  DEFAULT_KEYCAP,
  MX,
  STEM,
  capLevels,
  capSet,
  capStems,
  capType,
  capWarnings,
  topPreset,
  type KeycapParams,
} from '../src/lib/keycap-spec';
import { buildCase, buildWedge, cutMany, isValidShape, loadCell } from '../src/lib/geometry';
import { ANSI_60, PITCH, SPLIT_4x6_4, TEMPLATES, keyCorners, polysOverlap, splitLeft, switchSpots, type Key } from '../src/lib/layout';
import { DEFAULT_ISLAND, islandFor, type IslandParams } from '../src/lib/island';
import { caseLayout, DEFAULT_CASE, SCREW_MARGIN } from '../src/lib/case';
import { buildDactyl, DACTYL_DEFAULT, CAP, capCollisions, type DKey } from '../src/lib/dactyl';
import { placeShape, shellBody } from '../src/lib/dactyl-geometry';

const vol = (s: Shape3D) => {
  try {
    return measureVolume(s);
  } catch {
    return 0;
  }
};
const meet = (a: Shape3D, b: Shape3D) => vol(a.clone().intersect(b.clone()) as Shape3D);
const FLAT: KeycapParams = { ...DEFAULT_KEYCAP, ...topPreset('flat') };
const place = (s: Shape3D, k: Key, x = k.x, y = k.y, dz = 0) => s.clone().rotate(k.rot, [0, 0, 0], [0, 0, 1]).translate(x, y, dz) as Shape3D;

beforeAll(async () => {
  await initOC();
}, 60000);

describe('nakładka: wymiary', () => {
  test('profil domyślny: spód 18,0, góra 12,8, krawędź ≥ 4,6 mm nad płytą, nad kołnierzem po wciśnięciu', () => {
    for (const p of [DEFAULT_KEYCAP, FLAT]) {
      const L = capLevels(p);
      expect(L.z0).toBeGreaterThanOrEqual(4.6);
      expect(L.z0 - MX.travel).toBeGreaterThanOrEqual(MX.flangeTop + 0.3 - 1e-9);
      expect(L.ceiling - MX.travel).toBeGreaterThanOrEqual(MX.housingTop + 0.3);
      expect(L.socketTop).toBeGreaterThan(MX.stemTop);
      expect(L.socketTop - L.stemBottom).toBeGreaterThanOrEqual(3.5);
      expect(capWarnings(p)).toEqual([]);
    }
    // obie odmiany mają dolną krawędź na tej samej wysokości
    expect(capLevels(FLAT).z0).toBeCloseTo(capLevels(DEFAULT_KEYCAP).z0, 6);
    expect(capLevels(DEFAULT_KEYCAP).height).toBeCloseTo(7.4, 6);
    // za wysoka nakładka jest przycinana i ostrzega
    expect(capWarnings({ ...DEFAULT_KEYCAP, height: 9 })).toContain('capTooTall');
    expect(capLevels({ ...DEFAULT_KEYCAP, height: 9 }).z0 - MX.travel).toBeCloseTo(MX.flangeTop + 0.3, 6);
  });

  test('bryła 1U: poprawna, obrys 18 × 18, misa 0,8 mm', () => {
    const cap = buildKeycap(DEFAULT_KEYCAP, capType({ w: 1, h: 1 }, 'cherry'));
    expect(isValidShape(cap)).toBe(true);
    const bb = cap.boundingBox.bounds;
    expect(bb[1][0] - bb[0][0]).toBeCloseTo(18.0, 2);
    expect(bb[1][1] - bb[0][1]).toBeCloseTo(18.0, 2);
    const L = capLevels(DEFAULT_KEYCAP);
    expect(bb[0][2]).toBeCloseTo(L.z0, 2);
    expect(bb[1][2]).toBeCloseTo(L.topEdge, 2);
    // środek góry: materiał do dna misy, nad nim pusto
    expect(meet(cap, makeBox([-0.5, -0.5, L.topLow - 0.3], [0.5, 0.5, L.topLow - 0.05]))).toBeGreaterThan(0.24);
    expect(meet(cap, makeBox([-0.5, -0.5, L.topLow + 0.05], [0.5, 0.5, L.topEdge]))).toBeLessThan(0.01);
    // gniazdo: krzyż z luzem wolny na całej głębokości
    const c = DEFAULT_KEYCAP.clearance;
    const arm = makeBox([-(MX.crossLen + c) / 2 + 0.02, -(MX.crossX + c) / 2 + 0.02, L.stemBottom], [(MX.crossLen + c) / 2 - 0.02, (MX.crossX + c) / 2 - 0.02, L.socketTop - 0.02]);
    expect(meet(cap, arm)).toBeLessThan(0.001);
    // ścianka walca gniazda istnieje (nie przebita przez krzyż)
    const ring = makeCylinder(STEM.od / 2 - 0.05, 2, [0, 0, 8], [0, 0, 1]).cut(makeCylinder(2.4, 2, [0, 0, 8], [0, 0, 1])) as Shape3D;
    expect(meet(cap, ring) / vol(ring)).toBeGreaterThan(0.5);
  });

  test('ustawienie do druku: misa na krawędzi, płaska do góry nogami; obie leżą na z = 0', () => {
    const t = capType({ w: 1, h: 1 }, 'cherry');
    const a = printPose(DEFAULT_KEYCAP, buildKeycap(DEFAULT_KEYCAP, t)).boundingBox.bounds;
    const b = printPose(FLAT, buildKeycap(FLAT, t)).boundingBox.bounds;
    expect(a[0][2]).toBeCloseTo(0, 3);
    expect(b[0][2]).toBeCloseTo(0, 3);
    expect(a[1][2]).toBeCloseTo(capLevels(DEFAULT_KEYCAP).height, 2);
  });

  test('plik kalibracji: 4 gniazda o rosnącym luzie, poprawna bryła', () => {
    const cal = buildCalibration(DEFAULT_KEYCAP);
    expect(isValidShape(cal)).toBe(true);
    const bb = cal.boundingBox.bounds;
    expect(bb[0][2]).toBeCloseTo(0, 3);
    expect(bb[1][0] - bb[0][0]).toBeLessThan(50);
    // szersze ramię krzyża przy większym luzie: pasek o szerokości pomiędzy luzami 1 i 4
    const L = capLevels(DEFAULT_KEYCAP);
    const zTip = 1.6 + L.ceiling - L.stemBottom;
    const w = MX.crossX + (CALIBRATION_CLEARANCES[0] + CALIBRATION_CLEARANCES[3]) / 2;
    const probe = (x: number) => meet(cal, makeBox([x - 1, -w / 2, zTip - 2], [x + 1, w / 2, zTip - 0.5]));
    expect(probe(0)).toBeGreaterThan(0.05);
    expect(probe(3 * 13)).toBeLessThan(0.001);
  });
});

describe('nakładka na przełączniku MX', () => {
  let sw: Shape3D;
  let housing: Shape3D;
  let housingWithOpening: Shape3D;
  beforeAll(async () => {
    sw = await loadSwitch({ step: switchStep(), up: '+Y' });
    // nieruchoma obudowa: wszystko poniżej podstawy krzyża (krzyż i suwak jadą razem z nakładką)
    housing = sw.clone().intersect(makeBox([-20, -20, -20], [20, 20, MX.housingTop])) as Shape3D;
    // model ma pełny wierzch obudowy; w prawdziwym MX suwak z krzyżem wychodzi okrągłym otworem,
    // w który przy wciśnięciu wjeżdża walec gniazda nakładki (dlatego O-ringi na walcu skracają skok)
    housingWithOpening = cutMany(housing.clone(), [makeCylinder(STEM.od / 2 + 0.2, 10, [0, 0, 0], [0, 0, 1])]);
  }, 60000);

  for (const [name, p] of [['misa', DEFAULT_KEYCAP], ['płaska', FLAT]] as const)
    test(`1U (${name}): bez kolizji w spoczynku i po wciśnięciu 4 mm`, () => {
      const cap = buildKeycap(p, capType({ w: 1, h: 1 }, 'cherry'));
      expect(meet(cap, sw)).toBeLessThan(0.001);
      const down = cap.clone().translate(0, 0, -MX.travel) as Shape3D;
      expect(meet(down, housingWithOpening)).toBeLessThan(0.001);
      // poza walcem gniazda (ścianki, wnętrze, sufit) nakładka nie dotyka obudowy ani płyty
      const shell = cutMany(down.clone(), [makeCylinder(STEM.od / 2 + 0.01, 20, [0, 0, -5], [0, 0, 1])]);
      expect(meet(shell, housing)).toBeLessThan(0.001);
      expect(meet(down, makeBox([-20, -20, -5], [20, 20, 0]))).toBe(0);
    });

  test('rząd ze stabilizatorem i z dwoma MX (2,25U), spacja 6,25U: gniazda nad trzpieniami, bez kolizji', () => {
    const tpl = TEMPLATES.find((t) => t.id === 'ansi-60')!.params;
    const keys = splitLeft({ ...tpl, rowLayout: [ANSI_60[2], ANSI_60[4]] });
    for (const stabs of ['cherry', 'mx', 'none'] as const) {
      for (const k of keys.filter((k) => k.w >= 2)) {
        const t = capType(k, stabs);
        const cap = place(buildKeycap(DEFAULT_KEYCAP, t), k);
        expect(isValidShape(cap)).toBe(true);
        const spots = switchSpots(k, stabs);
        expect(t.stems.filter((s) => !s.stab).length).toBe(spots.length);
        for (const [x, y] of spots) {
          const s = place(sw, k, x, y);
          expect(meet(cap, s)).toBeLessThan(0.001);
          const down = cap.clone().translate(0, 0, -MX.travel) as Shape3D;
          expect(meet(down, place(housingWithOpening, k, x, y))).toBeLessThan(0.001);
        }
      }
    }
    // trzpienie stabilizatora Cherry: tam, gdzie wycięcia w płycie
    expect(capStems({ w: 2.25, h: 1 }, 'cherry').map((s) => s.d)).toEqual([-11.9, 0, 11.9]);
    expect(capStems({ w: 6.25, h: 1 }, 'mx').map((s) => s.d)).toEqual([-50, 0, 50]);
    expect(capStems({ w: 2, h: 1 }, 'none').map((s) => s.d)).toEqual([0]);
  }, 300000);
});

describe('nakładki w układach', () => {
  test('sąsiedzi: obrys spodu nakładek nie nachodzi na siebie w żadnym szablonie (też kciuk z wachlarzem)', () => {
    const g = DEFAULT_KEYCAP.gap;
    const shrink = (k: Key): [number, number][] => keyCorners({ ...k, w: k.w - g / PITCH, h: k.h - g / PITCH });
    for (const tpl of TEMPLATES) {
      const keys = splitLeft(tpl.params);
      for (let i = 0; i < keys.length; i++)
        for (let j = i + 1; j < keys.length; j++) expect(polysOverlap(shrink(keys[i]), shrink(keys[j])), `${tpl.id} ${keys[i].id}/${keys[j].id}`).toBe(false);
    }
    // nakładka nie wychodzi poza obrys swojego spodu (zwęża się ku górze)
    const bb = buildKeycap(DEFAULT_KEYCAP, capType({ w: 1.5, h: 1 }, 'cherry')).boundingBox.bounds;
    expect(bb[1][0] - bb[0][0]).toBeCloseTo(1.5 * PITCH - g, 2);
  });

  test('zestaw 60% ANSI: typy i liczba sztuk', () => {
    const keys = splitLeft(TEMPLATES.find((t) => t.id === 'ansi-60')!.params);
    const set = capSet(keys, 'cherry');
    expect(set.reduce((a, s) => a + s.count, 0)).toBe(61);
    expect(set[0].type.id).toBe('1u');
    expect(set.find((s) => s.type.id === '6.25u-stab')!.count).toBe(1);
  });

  const caseCheck = (name: string, keys: Key[], island: ReturnType<typeof islandFor>) =>
    test(`obudowa ${name}: nakładki (w spoczynku i wciśnięte) nie dotykają obudowy ani klina OLED`, async () => {
      const cell = await loadCell({ step: cellStep(), up: 'auto' }, 'hotswap');
      const opts = { fillGaps: 4, margin: SCREW_MARGIN, stabs: 'cherry' as const };
      const lay = caseLayout(keys, island, cell.height, DEFAULT_CASE);
      const parts = [buildCase(keys, opts, island, cell.height, DEFAULT_CASE, lay)];
      if (island?.wedge) parts.push(buildWedge(island));
      const hulls = new Map<string, Shape3D>();
      for (const k of keys) {
        const id = `${k.w}x${k.h}`;
        if (!hulls.has(id)) hulls.set(id, keycapHull(DEFAULT_KEYCAP, k.w, k.h));
        for (const dz of [0, -MX.travel]) {
          const c = place(hulls.get(id)!, k, k.x, k.y, dz);
          for (const part of parts) expect(meet(c, part), `${k.id} dz=${dz}`).toBeLessThan(0.001);
        }
      }
    }, 600000);

  {
    const tpl = TEMPLATES.find((t) => t.id === 'ansi-60')!.params;
    const ip: IslandParams = { ...DEFAULT_ISLAND, position: 'top', align: 'end', tilt: 25 };
    caseCheck('60% ANSI z klinem 25°', splitLeft(tpl), islandFor(tpl, ip, 'left', 'hotswap', 8.58, SCREW_MARGIN));
  }
  caseCheck('split 4×6+4', splitLeft(SPLIT_4x6_4), islandFor(SPLIT_4x6_4, DEFAULT_ISLAND, 'left', 'hotswap', 8.58, SCREW_MARGIN));
});

describe('nakładki w Dactylu', () => {
  test('uproszczona nakładka w ostrzeżeniach Dactyla odpowiada prawdziwej', () => {
    const L = capLevels(DEFAULT_KEYCAP);
    expect(CAP.size).toBeCloseTo(PITCH - DEFAULT_KEYCAP.gap, 6);
    expect(CAP.top).toBeCloseTo(DEFAULT_KEYCAP.topSize, 6);
    expect(CAP.z0).toBeCloseTo(L.z0, 6);
    expect(CAP.z1).toBeCloseTo(L.topEdge, 6);
    expect(capCollisions(buildDactyl(DACTYL_DEFAULT, { cellHeight: 8.58 }))).toEqual([]);
  });

  test('domyślny Dactyl: sąsiednie nakładki (spoczynek i wciśnięte) i skorupa bez kolizji', () => {
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: 8.58 });
    const p = m.params;
    const size = (k: DKey): [number, number] => {
      const wide = p.widePinky && k.col === p.cols - 1 && k.row !== p.rows - 1;
      const tall = k.thumb === 'tl' || k.thumb === 'tr';
      return [wide ? 1.5 : 1, tall ? 1.5 : 1];
    };
    const hulls = new Map<string, Shape3D>();
    const capAt = (k: DKey, dz: number) => {
      const [w, h] = size(k);
      const id = `${w}x${h}`;
      if (!hulls.has(id)) hulls.set(id, keycapHull(DEFAULT_KEYCAP, w, h));
      return placeShape(hulls.get(id)!.clone().translate(0, 0, dz) as Shape3D, k.frame);
    };
    const centre = (k: DKey) => k.frame.t;
    let pairs = 0;
    for (let i = 0; i < m.keys.length; i++)
      for (let j = i + 1; j < m.keys.length; j++) {
        const a = m.keys[i], b = m.keys[j];
        if (Math.hypot(...centre(a).map((v, n) => v - centre(b)[n])) > 40) continue;
        pairs++;
        for (const [da, db] of [[0, 0], [-MX.travel, 0], [0, -MX.travel]])
          expect(meet(capAt(a, da), capAt(b, db)), `${a.id}/${b.id} ${da}/${db}`).toBeLessThan(0.001);
      }
    expect(pairs).toBeGreaterThan(50);
    const shell = shellBody(m, { floor: 4, bossHeight: 7, controller: null });
    for (const k of m.keys)
      for (const dz of [0, -MX.travel]) expect(meet(capAt(k, dz), shell), `${k.id} ${dz}`).toBeLessThan(0.001);
  }, 600000);
});
