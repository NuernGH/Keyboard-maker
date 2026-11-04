import { describe, expect, test } from 'vitest';
import { splitLeft, mirrorKeys, keysOverlap, SPLIT_4x6_4, PITCH } from '../src/lib/layout';

describe('układ 4×6 + 4', () => {
  const keys = splitLeft(SPLIT_4x6_4);
  test('ma 28 klawiszy', () => {
    expect(keys.length).toBe(28);
    expect(keys.filter((k) => k.id.startsWith('t-')).length).toBe(4);
  });
  test('raster 19,05 w kolumnie', () => {
    const c0 = keys.filter((k) => k.id.endsWith('-0') && k.id.startsWith('k-'));
    expect(c0[0].y - c0[1].y).toBeCloseTo(PITCH, 6);
  });
  test('klawisze nie nachodzą na siebie', () => {
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++)
        expect(keysOverlap(keys[i], keys[j]), `${keys[i].id} / ${keys[j].id}`).toBe(false);
  });
  test('prawa połówka to lustro', () => {
    const r = mirrorKeys(keys);
    expect(r[5].x).toBeCloseTo(-keys[5].x);
    expect(r[27].rot).toBeCloseTo(-keys[27].rot);
  });
});
