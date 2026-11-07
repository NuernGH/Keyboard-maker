// Nakładki: wymiary, pasowanie do modelu Cherry MX (spoczynek i pełne wciśnięcie), sąsiedzi,
// obudowa (split, 60% z klinem OLED) i Dactyl.
import { beforeAll, describe, expect, test } from 'vitest';
import { makeBox, makeCylinder, measureVolume, type Shape3D } from 'replicad';
import { initOC, cellStep, switchStep } from './oc';
import { loadSwitch } from '../src/lib/switch-model';
import { buildKeycap, buildCalibration, buildInsert, insertPinLen, insertPrintPose, keycapHull, printPose } from '../src/lib/keycap';
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
  orientPreset,
  pressedCavityClear,
  sideAngle,
  SIDE,
  PROVEN_SOCKET,
  socketCross,
  stemOd,
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
const OD = stemOd(DEFAULT_KEYCAP);
/**
 * Model MX z repo ma krzyż 4,5 mm, a prawdziwy Cherry ok. 4,1 (sprawdzona nakładka z otworem 4,2 wpina się
 * na przełącznik). Do testów kolizji krzyż modelu zastępujemy krzyżem 4,1 × 1,15/1,35.
 */
const REAL_CROSS = 4.1;
function realCross(sw: Shape3D): Shape3D {
  const top = MX.housingTop;
  const body = cutMany(sw, [makeBox([-2.6, -2.6, top], [2.6, 2.6, top + 5])]);
  return body
    .fuse(makeBox([-REAL_CROSS / 2, -MX.crossX / 2, top - 0.01], [REAL_CROSS / 2, MX.crossX / 2, MX.stemTop]))
    .fuse(makeBox([-MX.crossY / 2, -REAL_CROSS / 2, top - 0.01], [MX.crossY / 2, REAL_CROSS / 2, MX.stemTop])) as Shape3D;
}
/** Pudełka „ramię krzyża wolne” (wzdłuż X i Y) dla gniazda w (x, y), zmniejszone o 0,02. */
function crossFree(p: KeycapParams, x: number, y: number, z0: number, z1: number, turned = false): Shape3D[] {
  const { len, ax, ay } = socketCross(p, turned);
  return [
    makeBox([x - len / 2 + 0.02, y - ax / 2 + 0.02, z0], [x + len / 2 - 0.02, y + ax / 2 - 0.02, z1]),
    makeBox([x - ay / 2 + 0.02, y - len / 2 + 0.02, z0], [x + ay / 2 - 0.02, y + len / 2 - 0.02, z1]),
  ];
}
const sideOf = (p: KeycapParams, sideStem: KeycapParams['sideStem'] = 'insert'): KeycapParams => ({ ...p, ...orientPreset(p, 'side'), sideStem });
/** Pole (mm²) powierzchni zwróconych w dół bardziej niż `lim` od pionu, powyżej `above` mm nad stołem. */
function overhangArea(s: Shape3D, above: number, lim = 45): number {
  const m = s.mesh({ tolerance: 0.02, angularTolerance: 0.1 });
  const c = -Math.cos((lim * Math.PI) / 180) - 0.02;
  let area = 0;
  for (let i = 0; i < m.triangles.length; i += 3) {
    const [a, b, d] = [0, 1, 2].map((j) => { const k = m.triangles[i + j]; return [m.vertices[3 * k], m.vertices[3 * k + 1], m.vertices[3 * k + 2]]; });
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n);
    if (len > 1e-12 && n[2] / len < c && Math.min(a[2], b[2], d[2]) > above) area += len / 2;
  }
  return area;
}
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
    for (const arm of crossFree(DEFAULT_KEYCAP, 0, 0, L.stemBottom, L.socketTop - 0.02)) expect(meet(cap, arm)).toBeLessThan(0.001);
    // ścianka walca gniazda istnieje (nie przebita przez krzyż)
    const ring = makeCylinder(OD / 2 - 0.05, 2, [0, 0, 8], [0, 0, 1]).cut(makeCylinder(2.4, 2, [0, 0, 8], [0, 0, 1])) as Shape3D;
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

  test('plik kalibracji: 4 gniazda o rosnącym luzie + sprawdzone gniazdo, poprawna bryła', () => {
    const cal = buildCalibration(DEFAULT_KEYCAP);
    expect(isValidShape(cal)).toBe(true);
    const bb = cal.boundingBox.bounds;
    expect(bb[0][2]).toBeCloseTo(0, 3);
    expect(bb[1][0] - bb[0][0]).toBeLessThan(65);
    // szersze ramię krzyża przy większym luzie: pasek o szerokości pomiędzy luzami 1 i 4
    const L = capLevels(DEFAULT_KEYCAP);
    const zTip = 1.6 + L.ceiling - L.stemBottom;
    const w = MX.crossX + (CALIBRATION_CLEARANCES[0] + CALIBRATION_CLEARANCES[3]) / 2;
    const probe = (x: number) => meet(cal, makeBox([x - 1, -w / 2, zTip - 2], [x + 1, w / 2, zTip - 0.5]));
    expect(probe(0)).toBeGreaterThan(0.05);
    expect(probe(3 * 13)).toBeLessThan(0.001);
    // piąte gniazdo: otwór 4,2 × 1,4 (koniec ramienia 4,5 już w materiale), walec Ø5,72
    const x5 = 4 * 13;
    const P = PROVEN_SOCKET;
    expect(meet(cal, makeBox([x5 - P.len / 2 + 0.03, -P.arm / 2 + 0.03, zTip - 3], [x5 + P.len / 2 - 0.03, P.arm / 2 - 0.03, zTip - 0.1]))).toBeLessThan(0.001);
    expect(meet(cal, makeBox([x5 + P.len / 2 + 0.03, -0.3, zTip - 3], [x5 + 2.25, 0.3, zTip - 0.1]))).toBeGreaterThan(0.01);
    expect(meet(cal, makeBox([x5 + 2.75 + 0.03, -0.2, zTip - 1], [x5 + P.od / 2 - 0.03, 0.2, zTip - 0.5]))).toBeGreaterThan(0.005);
  });

  test('gniazdo „sprawdzone”: walec Ø5,72, krzyż 4,2 × 1,4 bez luzu z listy, nakładka i wkładka poprawne', () => {
    const p = { ...DEFAULT_KEYCAP, socket: 'proven' as const, clearance: 0.35 };
    const L = capLevels(p);
    const P = PROVEN_SOCKET;
    const cap = buildKeycap(p, capType({ w: 1, h: 1 }, 'cherry'));
    expect(isValidShape(cap)).toBe(true);
    const z = [L.stemBottom + 0.3, L.socketTop - 0.1] as const;
    for (const turned of [false, true]) {
      const ins = buildInsert(sideOf(p), turned);
      expect(isValidShape(ins)).toBe(true);
    }
    // oba ramiona 1,4 wolne, ramię dłuższe niż 4,2 w materiale (luz 0,35 pominięty)
    expect(meet(cap, makeBox([-P.len / 2 + 0.03, -P.arm / 2 + 0.03, z[0]], [P.len / 2 - 0.03, P.arm / 2 - 0.03, z[1]]))).toBeLessThan(0.001);
    expect(meet(cap, makeBox([-P.arm / 2 + 0.03, -P.len / 2 + 0.03, z[0]], [P.arm / 2 - 0.03, P.len / 2 - 0.03, z[1]]))).toBeLessThan(0.001);
    expect(meet(cap, makeBox([P.len / 2 + 0.03, -0.3, z[0]], [P.len / 2 + 0.3, 0.3, z[1]]))).toBeGreaterThan(0.01);
    expect(meet(cap, makeBox([2.75 + 0.03, -0.2, z[0]], [P.od / 2 - 0.03, 0.2, z[1]]))).toBeGreaterThan(0.005);
  });
});

describe('nakładka na przełączniku MX', () => {
  let sw: Shape3D;
  let housing: Shape3D;
  let housingWithOpening: Shape3D;
  beforeAll(async () => {
    sw = realCross(await loadSwitch({ step: switchStep(), up: '+Y' }));
    // nieruchoma obudowa: wszystko poniżej podstawy krzyża (krzyż i suwak jadą razem z nakładką)
    housing = sw.clone().intersect(makeBox([-20, -20, -20], [20, 20, MX.housingTop])) as Shape3D;
    // model ma pełny wierzch obudowy; w prawdziwym MX suwak z krzyżem wychodzi okrągłym otworem,
    // w który przy wciśnięciu wjeżdża walec gniazda nakładki (dlatego O-ringi na walcu skracają skok)
    housingWithOpening = cutMany(housing.clone(), [makeCylinder(OD / 2 + 0.2, 10, [0, 0, 0], [0, 0, 1])]);
  }, 60000);

  for (const [name, p] of [['misa', DEFAULT_KEYCAP], ['płaska', FLAT]] as const)
    test(`1U (${name}): bez kolizji w spoczynku i po wciśnięciu 4 mm`, () => {
      const cap = buildKeycap(p, capType({ w: 1, h: 1 }, 'cherry'));
      expect(meet(cap, sw)).toBeLessThan(0.001);
      const down = cap.clone().translate(0, 0, -MX.travel) as Shape3D;
      expect(meet(down, housingWithOpening)).toBeLessThan(0.001);
      // poza walcem gniazda (ścianki, wnętrze, sufit) nakładka nie dotyka obudowy ani płyty
      const shell = cutMany(down.clone(), [makeCylinder(OD / 2 + 0.01, 20, [0, 0, -5], [0, 0, 1])]);
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

describe('druk na boku (bez podpór)', () => {
  test('parametry: zbieżność 22,5°, góra 11,9, ścianka 0,85, wnętrze mieści obudowę po wciśnięciu', () => {
    for (const base of [DEFAULT_KEYCAP, FLAT]) {
      const p = sideOf(base);
      expect(sideAngle(p)).toBeCloseTo(SIDE.taper, 1);
      expect(p.topSize).toBeCloseTo(11.87, 2);
      expect(pressedCavityClear(p)).toBeGreaterThanOrEqual(0.3);
      expect(capWarnings(p)).toEqual([]);
      // nad otworem na bolec wkładki zostaje min. 0,4 mm góry
      expect(p.topThickness - insertPinLen(p)).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
    // powrót do druku normalnego przywraca domyślną górę i ściankę
    const back = { ...sideOf(DEFAULT_KEYCAP), ...orientPreset(sideOf(DEFAULT_KEYCAP), 'upright') };
    expect(back.topSize).toBe(DEFAULT_KEYCAP.topSize);
    expect(back.wall).toBe(DEFAULT_KEYCAP.wall);
  });

  test('kompletna nakładka (z wkładką) bez kolizji z MX w spoczynku i po wciśnięciu', async () => {
    const sw = realCross(await loadSwitch({ step: switchStep(), up: '+Y' }));
    const housing = sw.clone().intersect(makeBox([-20, -20, -20], [20, 20, MX.housingTop])) as Shape3D;
    for (const base of [DEFAULT_KEYCAP, FLAT]) {
      const cap = buildKeycap(sideOf(base), capType({ w: 1, h: 1 }, 'cherry'));
      expect(isValidShape(cap)).toBe(true);
      expect(meet(cap, sw)).toBeLessThan(0.001);
      const down = cap.clone().translate(0, 0, -MX.travel) as Shape3D;
      const shell = cutMany(down.clone(), [makeCylinder(OD / 2 + 0.01, 20, [0, 0, -5], [0, 0, 1])]);
      expect(meet(shell, housing)).toBeLessThan(0.001);
    }
  }, 120000);

  for (const [name, t] of [
    ['1U', capType({ w: 1, h: 1 }, 'cherry')],
    ['2,25U ze stabilizatorem', capType({ w: 2.25, h: 1 }, 'cherry')],
    ['pionowa 2U, dwa MX', capType({ w: 1, h: 2 }, 'mx')],
  ] as const)
    test(`${name}: na boku leży płasko, wnętrze bez nawisów > 45° (B), żebra pod gniazdami (A)`, () => {
      const pB = sideOf(DEFAULT_KEYCAP, 'insert');
      const shell = printPose(pB, buildKeycap(pB, t, { sockets: 'holes' }), t);
      expect(isValidShape(shell)).toBe(true);
      expect(shell.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
      // przednia (dłuższa) ścianka na stole: duża powierzchnia styku
      const [bw, bh] = [t.w * PITCH - 1.05, t.h * PITCH - 1.05];
      const foot = vol(shell.clone().intersect(makeBox([-99, -99, 0], [99, 99, 0.2])) as Shape3D) / 0.2;
      expect(foot).toBeGreaterThan(0.6 * Math.max(bw, bh) * 7.4 * 0.85);
      // nawisy tylko przy zaokrąglonych krawędziach tuż przy stole
      expect(overhangArea(shell, 1.0)).toBeLessThan(0.05);
      // A: żebro dochodzi do ścianki na stole i podpiera najniższą linię walca
      const pA = sideOf(DEFAULT_KEYCAP, 'rib');
      const withRib = buildKeycap(pA, t, { ribs: true });
      const without = buildKeycap(pA, t);
      expect(isValidShape(withRib)).toBe(true);
      const ribVol = vol(withRib) - vol(without);
      expect(ribVol).toBeGreaterThan(t.stems.length * SIDE.rib * 4 * 3);
      // krzyż w gnieździe nadal wolny (żebro nie wchodzi do środka)
      const L = capLevels(pA);
      const along = t.w >= t.h;
      for (const s of t.stems) {
        const [x, y] = along ? [s.d, 0] : [0, s.d];
        for (const arm of crossFree(pA, x, y, L.stemBottom, L.socketTop - 0.02, s.stab && !along)) expect(meet(withRib, arm)).toBeLessThan(0.001);
      }
      // A w pozycji druku: najniższy punkt walca gniazda podparty (tuż pod nim jest materiał żebra)
      const posed = printPose(pA, withRib, t);
      expect(posed.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
    }, 300000);

  test('wkładka B: krzyż z luzem, bolec D pasuje w otwór, wkładka drukuje się bez podpór', () => {
    const p = sideOf(DEFAULT_KEYCAP);
    const L = capLevels(p);
    const ins = buildInsert(p);
    expect(isValidShape(ins)).toBe(true);
    // złożona: wkładka w otworze skorupy nie zachodzi na skorupę (luz bolca), a razem dają kompletną nakładkę
    const t = capType({ w: 1, h: 1 }, 'cherry');
    const shell = buildKeycap(p, t, { sockets: 'holes' });
    expect(meet(shell, ins)).toBeLessThan(0.001);
    const full = buildKeycap(p, t);
    const assembled = vol(shell) + vol(ins);
    // pełna nakładka i złożenie różnią się tylko bolcem i luzem w otworze
    expect(Math.abs(assembled - vol(full))).toBeLessThan(5);
    // krzyż wolny na całej głębokości
    for (const arm of crossFree(p, 0, 0, L.stemBottom, L.socketTop - 0.02)) expect(meet(ins, arm)).toBeLessThan(0.001);
    const posed = insertPrintPose(p, ins);
    expect(posed.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
    // jedyne powierzchnie w dół to sufit krzyża (mostek ok. 1,5 mm) i stopień sfazowania wejścia
    expect(overhangArea(posed, 0.05)).toBeLessThan(20);
  });

  test('wkładka B w pionowej nakładce: otwór D obrócony do stołu, wkładka „obrócona” daje krzyż zwykłego MX', () => {
    // gniazdo „calc”: ramiona krzyża różnej grubości, więc widać, czy krzyż jest obrócony
    const p = sideOf({ ...DEFAULT_KEYCAP, socket: 'calc' });
    const L = capLevels(p);
    const t = capType({ w: 1, h: 2 }, 'mx');
    const shell = buildKeycap(p, t, { sockets: 'holes' });
    const c = p.clearance;
    for (const s of t.stems) {
      // wkładka obrócona (krzyż o 90°) włożona w otwór obrócony o −90°
      const ins = buildInsert(p, true).rotate(-90, [0, 0, 0], [0, 0, 1]).translate(0, s.d, 0) as Shape3D;
      expect(meet(shell, ins)).toBeLessThan(0.001);
      // ramię wzdłuż X wolne na grubość zwykłego MX, a tuż obok jest już materiał (krzyż nie jest obrócony)
      const free = makeBox([-(MX.crossLen + c) / 2 + 0.02, s.d - (MX.crossX + c) / 2 + 0.02, L.stemBottom + 0.5], [(MX.crossLen + c) / 2 - 0.02, s.d + (MX.crossX + c) / 2 - 0.02, L.socketTop - 0.1]);
      expect(meet(ins, free)).toBeLessThan(0.001);
      const side = makeBox([-1.5, s.d + (MX.crossX + c) / 2 + 0.03, L.stemBottom + 0.5], [1.5, s.d + (MX.crossY + c) / 2 - 0.03, L.socketTop - 0.1]);
      expect(meet(ins, side)).toBeGreaterThan(0.01);
    }
  });
});
