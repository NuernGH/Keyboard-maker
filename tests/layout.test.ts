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

import { zipStore, crc32 } from '../src/lib/zip';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('zip', () => {
  test('crc32 zgodny z wzorcem', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  test('archiwum przechodzi test unzip', async () => {
    const blob = zipStore([{ name: 'płyta.stl', data: new TextEncoder().encode('solid x') }]);
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const p = join(dir, 'a.zip');
    writeFileSync(p, Buffer.from(await blob.arrayBuffer()));
    expect(() => execFileSync('unzip', ['-t', p])).not.toThrow();
  });
});

import { TEMPLATES } from '../src/lib/layout';
describe('szablony', () => {
  for (const tpl of TEMPLATES) {
    test(`${tpl.id}: klawisze nie nachodzą na siebie`, () => {
      const keys = splitLeft(tpl.params);
      const rl = tpl.params.rowLayout;
      expect(keys.length).toBe(rl ? rl.flat().filter((w) => w > 0).length : tpl.params.rows * tpl.params.cols + tpl.params.thumbKeys);
      for (let i = 0; i < keys.length; i++)
        for (let j = i + 1; j < keys.length; j++)
          expect(keysOverlap(keys[i], keys[j]), `${keys[i].id} / ${keys[j].id}`).toBe(false);
    });
  }
  test('ułamkowa kolumna kciuka interpoluje pozycję', () => {
    const a = splitLeft({ ...SPLIT_4x6_4, thumbAnchorCol: 2 }).find((k) => k.id === 't-0')!;
    const b = splitLeft({ ...SPLIT_4x6_4, thumbAnchorCol: 2.5 }).find((k) => k.id === 't-0')!;
    expect(b.x - a.x).toBeCloseTo(PITCH / 2, 6);
  });
});
