import { beforeAll, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, type Font } from 'opentype.js';
import { measureVolume, makeBox, type Shape3D } from 'replicad';
import { initOC } from './oc';
import { applyLegend, buildKeycap, legendPart, printPose } from '../src/lib/keycap';
import { DEFAULT_KEYCAP, capBottom, capLevels, capType, topInset, topPreset } from '../src/lib/keycap-spec';
import { DEFAULT_LEGEND, area, legendLayout, nestContours, strokeWidth, textContours, type Contour } from '../src/lib/legend';
import { isValidShape } from '../src/lib/geometry';

let font: Font;
const vol = (s: Shape3D) => measureVolume(s);
const FLAT = { ...DEFAULT_KEYCAP, ...topPreset('flat') };

beforeAll(async () => {
  await initOC();
  const b = readFileSync('public/fonts/NotoSans-Bold.ttf');
  font = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}, 60000);

/** Kontury ułożonych legend jednego klawisza (jak w panelu). */
function placed(set: Parameters<typeof legendLayout>[1], p = DEFAULT_KEYCAP, w = 1, h = 1): Contour[] {
  const [bw, bh] = capBottom(p, w, h);
  const ins = topInset(p);
  return legendLayout(font, set, bw - 2 * ins, bh - 2 * ins).flatMap((l) =>
    textContours(font, l.text, l.size).contours.map((c) => c.map(([x, y]) => [x + l.x, y + l.y] as [number, number])),
  );
}

describe('legendy: kontury i układ', () => {
  test('litera o zadanej wysokości, otwór w „A” i „O” jako zagnieżdżony kontur', () => {
    const a = textContours(font, 'A', 4);
    expect(a.height).toBeCloseTo(4, 1);
    const n = nestContours(a.contours);
    expect(n.filter((c) => c.depth === 0)).toHaveLength(1);
    expect(n.filter((c) => c.depth === 1)).toHaveLength(1);
    const o = nestContours(textContours(font, 'O', 4).contours);
    expect(o.map((c) => c.depth)).toEqual([0, 1]);
    // polskie znaki są w czcionce
    expect(textContours(font, 'ĄŚŻ', 4).contours.length).toBeGreaterThanOrEqual(3);
  });

  test('kreska legendy głównej ≥ 0,8 mm (kolor), pomocniczych ≥ 0,5 mm (rowek)', () => {
    expect(strokeWidth(font, DEFAULT_LEGEND.mainSize)).toBeGreaterThan(0.8);
    expect(strokeWidth(font, DEFAULT_LEGEND.subSize)).toBeGreaterThan(0.5);
  });

  test('układ: główna na środku, Shift/Fn/AltGr w rogach, wszystko w obrysie góry z marginesem', () => {
    const [bw, bh] = capBottom(DEFAULT_KEYCAP, 1, 1);
    const ins = topInset(DEFAULT_KEYCAP);
    const [tw, th] = [bw - 2 * ins, bh - 2 * ins];
    const one = legendLayout(font, { main: 'Q' }, tw, th);
    expect(one).toHaveLength(1);
    expect(one[0].x).toBeCloseTo(0, 6);
    const four = legendLayout(font, { main: '1', shift: '!', fn: 'F1', altgr: '¡' }, tw, th);
    expect(four.map((l) => l.layer).sort()).toEqual(['altgr', 'fn', 'main', 'shift']);
    for (const l of four) {
      const c = textContours(font, l.text, l.size);
      expect(Math.abs(l.x) + c.width / 2).toBeLessThanOrEqual(tw / 2 - DEFAULT_LEGEND.margin + 1e-6);
      expect(Math.abs(l.y) + c.height / 2).toBeLessThanOrEqual(th / 2 - DEFAULT_LEGEND.margin + 1e-6);
    }
    // długi napis zmniejszony, by zmieścił się na 1U
    const long = legendLayout(font, { main: 'Backspace' }, tw, th)[0];
    expect(long.size).toBeLessThan(DEFAULT_LEGEND.mainSize);
    expect(textContours(font, long.text, long.size).width).toBeLessThanOrEqual(tw - 2 * DEFAULT_LEGEND.margin + 1e-6);
  });
});

describe('legendy: bryły', () => {
  const t = capType({ w: 1, h: 1 }, 'cherry');
  test('rowek w misie: poprawna bryła, głębokość wzdłuż misy, reszta nakładki nietknięta', () => {
    const p = DEFAULT_KEYCAP;
    const cap = buildKeycap(p, t);
    const lg = { contours: placed({ main: 'H' }), method: 'groove' as const, depth: 0.6, raise: 0.6 };
    const g = applyLegend(p, t, cap, lg);
    expect(isValidShape(g)).toBe(true);
    const removed = vol(cap) - vol(g);
    // pole litery × głębokość
    const ar = lg.contours.reduce((s, c) => s + Math.abs(area(c)) * (nestContours([c])[0] ? 1 : 1), 0);
    expect(removed).toBeGreaterThan(0.5 * ar * 0.6);
    expect(removed).toBeLessThan(1.3 * ar * 0.6);
    // pod rowkiem zostaje materiał: góra nie przebita
    const L = capLevels(p);
    expect(vol(g.clone().intersect(makeBox([-0.3, -0.3, L.ceiling + 0.05], [0.3, 0.3, L.topLow - 0.65])) as Shape3D)).toBeGreaterThan(0.1);
  }, 60000);

  test('wypukła legenda na płaskiej górze: osobna część od góry nakładki, druk górą do góry', () => {
    const cap = buildKeycap(FLAT, t);
    const lg = { contours: placed({ main: 'A', shift: '!' }, FLAT), method: 'color' as const, depth: 0.6, raise: 0.6 };
    const part = legendPart(FLAT, lg)!;
    expect(isValidShape(part)).toBe(true);
    const L = capLevels(FLAT);
    expect(part.boundingBox.bounds[0][2]).toBeCloseTo(L.topEdge, 3);
    expect(part.boundingBox.bounds[1][2]).toBeCloseTo(L.topEdge + 0.6, 3);
    const full = applyLegend(FLAT, t, cap, lg);
    expect(isValidShape(full)).toBe(true);
    expect(vol(full) - vol(cap)).toBeCloseTo(vol(part), 0);
    const posed = printPose(FLAT, full, t, true);
    expect(posed.boundingBox.bounds[0][2]).toBeCloseTo(0, 3);
    // zmiana filamentu na wysokości góry nakładki w pozycji druku
    expect(posed.boundingBox.bounds[1][2]).toBeCloseTo(L.topEdge - L.z0 + 0.6, 3);
  }, 60000);

  test('rowek przy druku na boku i na płaskiej górze: poprawne bryły', () => {
    const lg = { contours: placed({ main: 'Ż', fn: 'F5' }), method: 'groove' as const, depth: 0.6, raise: 0.6 };
    const g = applyLegend(FLAT, t, buildKeycap(FLAT, t), lg);
    expect(isValidShape(g)).toBe(true);
    expect(vol(buildKeycap(FLAT, t)) - vol(g)).toBeGreaterThan(1);
  }, 60000);
});
