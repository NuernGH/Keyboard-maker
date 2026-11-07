// Dactyl: rozmieszczenie klawiszy (zgodność z portem referencyjnym z planu, sprawdzonym
// z model.stl Dactyl Configuratora), kolizje nakładek i komórek, obrys podłogi i śruby.
import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { SCREW_SPECS } from '../src/lib/case';
import {
  apply,
  boxesOverlap,
  T,
  buildDactyl,
  capCollisions,
  cellCollisions,
  DACTYL_DEFAULT,
  floorLoop,
  insidePoly,
  modelSize,
  polyDist,
} from '../src/lib/dactyl';

function selfCross(p: [number, number][]): number {
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let n = 0;
  for (let i = 0; i < p.length; i++)
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      const a = p[i], b = p[i + 1], c = p[j], d = p[(j + 1) % p.length];
      if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) n++;
    }
  return n;
}

/** buildDM z /mnt/project-files/dactyl/plan-dactyl.html (three.js), bez lustra. */
function referenceDM(s: { rows: number; cols: number; alpha: number; beta: number; tent: number }) {
  const d = Math.PI / 180, X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const R = (ax: THREE.Vector3, a: number) => new THREE.Matrix4().makeRotationAxis(ax, a);
  const mount = 17.4, capTop = 4 + 12.7, plateT = 4;
  const alpha = s.alpha * d, beta = s.beta * d, tent = s.tent * d, rotX = 1 * d, zOff = 4;
  const rowR = (mount + 1) / 2 / Math.sin(alpha / 2) + capTop;
  const colR = (mount + 2.5) / 2 / Math.sin(beta / 2) + capTop;
  const nrows = s.rows, ncols = s.cols, cr = nrows - 3, cc = 4, last = nrows - 1, corner = nrows - 2;
  const stag = (c: number) => (c === 2 ? [0, 2.8, -6.5] : c === 3 ? [0, 0, 0] : c >= 4 ? [0, -13, 6] : [0, 0, 0]);
  const geo = (c: number, r: number) => {
    const st = stag(c), xo = c === ncols - 1 && r !== last ? 5.5 : 0;
    return T(0, 0, zOff).multiply(R(X, rotX)).multiply(R(Y, tent)).multiply(T(st[0], st[1], st[2]))
      .multiply(T(0, 0, colR)).multiply(R(Y, beta * (cc - c))).multiply(T(0, 0, -colR))
      .multiply(T(0, 0, rowR)).multiply(R(X, alpha * (cr - r))).multiply(T(0, 0, -rowR)).multiply(T(xo, 0, 0));
  };
  const keys: { id: string; m: THREE.Matrix4 }[] = [];
  for (let c = 0; c < ncols; c++) for (let r = 0; r < nrows; r++) {
    if (r === last && c < 2) continue;
    keys.push({ id: `k${c}-${r}`, m: geo(c, r).multiply(T(0, 0, plateT)) });
  }
  const o = new THREE.Vector3(mount / 2, -mount / 2, 0).applyMatrix4(geo(1, corner)).add(new THREE.Vector3(6, -3, 7));
  const TH: Record<string, number[][]> = { tl: [[10, -23, 10], [-35, -15, -2]], tr: [[10, -23, 10], [-12, -16, 3]], ml: [[6, -34, 40], [-52, -26, -12]],
    mr: [[-6, -34, 48], [-29, -41, -13]], bl: [[-4, -35, 52], [-56.3, -43.3, -23.5]], br: [[-16, -33, 54], [-37.8, -55.3, -25.3]] };
  for (const [n, [a, off]] of Object.entries(TH))
    keys.push({ id: `t-${n}`, m: T(o.x + off[0], o.y + off[1], o.z + off[2]).multiply(R(Z, a[2] * d)).multiply(R(Y, a[1] * d)).multiply(R(X, a[0] * d)).multiply(T(0, 0, plateT)) });
  return keys;
}

describe('Dactyl: rozmieszczenie', () => {
  test('zgodne z portem referencyjnym (środki i osie klawiszy)', () => {
    // bez podnoszenia: porównujemy z oryginałem (zOffset 4)
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: 8.58, floorClear: -100 });
    expect(m.lift).toBe(0);
    const ref = referenceDM(DACTYL_DEFAULT);
    expect(m.keys.length).toBe(ref.length);
    for (const r of ref) {
      const k = m.keys.find((q) => q.id === r.id)!;
      for (const p of [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]]) {
        const a = apply(k.frame, p);
        const b = new THREE.Vector3(...p).applyMatrix4(r.m);
        expect(Math.hypot(a[0] - b.x, a[1] - b.y, a[2] - b.z)).toBeLessThan(1e-6);
      }
    }
  });

  test('domyślny model: 34 klawisze, bez kolizji nakładek i komórek, mieści się na stole 245 × 245', () => {
    for (const h of [8.58, 5.08]) {
      const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: h });
      expect(m.keys.length).toBe(34);
      expect(capCollisions(m)).toEqual([]);
      expect(cellCollisions(m)).toEqual([]);
      const s = modelSize(m);
      expect(s.x).toBeLessThan(245);
      expect(s.y).toBeLessThan(245);
      // spód najniższej komórki co najmniej 2 mm nad podłogą
      const minZ = Math.min(...m.keys.flatMap((k) => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => apply(k.frame, [sx * k.hw, sy * k.hh, -h])[2]))));
      expect(minZ).toBeGreaterThan(2 - 1e-6);
    }
  });

  for (const size of ['M3', 'M2.5'] as const)
  test(`pętla podłogi zamknięta, śruby ${size} w środku przy ścianie`, () => {
    const sp = SCREW_SPECS[size];
    const bases = [DACTYL_DEFAULT, { ...DACTYL_DEFAULT, rows: 4 }, { ...DACTYL_DEFAULT, cols: 5, widePinky: false }];
    for (const p of (['off', 'corners', 'smooth'] as const).flatMap((w) => bases.map((b) => ({ ...b, wallSmooth: w })))) {
      const m = buildDactyl(p, { cellHeight: 8.58, screwSize: size });
      // wygładzone ściany: obrys dna bez samoprzecięć
      if (m.outline) for (const poly of [m.outline.outer, m.outline.inner]) expect(selfCross(poly)).toBe(0);
      expect(m.screw).toEqual(sp);
      const loop = floorLoop(m);
      expect(loop.length).toBeGreaterThan(20);
      // kolejne punkty pętli blisko siebie (bez dużych przeskoków między kawałkami ścian)
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(40);
      }
      expect(m.screws.length).toBe(5);
      // tuleja (Ø7,5 albo Ø6,5 × 7 mm) nie wchodzi w żaden blok klawisza
      for (const [x, y] of m.screws)
        for (const k of m.keys)
          expect(boxesOverlap({ m: T(x, y, 0), h: [sp.boss / 2, sp.boss / 2, 3.5], c: [0, 0, 3.5] }, { m: k.frame, h: [k.hw, k.hh, 4.29], c: [0, 0, -4.29] })).toBe(false);
      for (const s of m.screws) {
        expect(insidePoly(s, loop)).toBe(true);
        expect(polyDist(s, loop).d).toBeCloseTo(sp.boss / 2 - 1.2, 1);
      }
    }
  });
});
