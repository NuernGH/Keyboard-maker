// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decodeLink,
  encodeLink,
  linkFromHash,
  makeProject,
  mergeDefaults,
  parseProject,
  LINK_KEY,
} from '../src/lib/project';
import { TEMPLATES } from '../src/lib/layout';
import { DEFAULT_ISLAND } from '../src/lib/island';
import { DEFAULT_CASE } from '../src/lib/case';
import { DACTYL_DEFAULT } from '../src/lib/dactyl';

describe('mergeDefaults', () => {
  it('brakujące pola z domyślnych, zapisane nadpisują', () => {
    const d = { a: 1, b: { c: 2, d: 'x' }, e: [1, 2] };
    expect(mergeDefaults(d, { b: { c: 5 } })).toEqual({ a: 1, b: { c: 5, d: 'x' }, e: [1, 2] });
    expect(mergeDefaults(d, { e: [9] })).toEqual({ a: 1, b: { c: 2, d: 'x' }, e: [9] });
  });
  it('zły typ i NaN pomijane, nowe pola opcjonalne zostają', () => {
    const d = { a: 1, s: 'x' };
    expect(mergeDefaults(d, { a: 'zły', s: 3, extra: { q: 1 } })).toEqual({ a: 1, s: 'x', extra: { q: 1 } });
    expect(mergeDefaults({ a: 1 }, { a: NaN })).toEqual({ a: 1 });
  });
  it('nie zmienia domyślnych', () => {
    const before = structuredClone(DEFAULT_CASE);
    mergeDefaults(DEFAULT_CASE, { wall: 9 });
    expect(DEFAULT_CASE).toEqual(before);
  });
});

describe('plik projektu', () => {
  const flat = makeProject('flat', {
    templateId: TEMPLATES[0].id,
    params: TEMPLATES[0].params,
    island: { ...DEFAULT_ISLAND, controller: 'kb2040' },
    caseP: { ...DEFAULT_CASE, wall: 3 },
    print: {},
    variant: 'no-hotswap',
    plate: {},
    up: 'auto',
    show: 'both',
    showElectronics: true,
    showSwitches: false,
    cell: { name: 'moja.step', data: bytesToBase64(new Uint8Array([1, 2, 3, 250])) },
  });

  it('zapis i odczyt dają to samo', () => {
    const back = parseProject(JSON.stringify(flat));
    expect(back).toEqual(flat);
    expect(Array.from(base64ToBytes(back.flat!.cell!.data))).toEqual([1, 2, 3, 250]);
  });

  it('odrzuca obce pliki i nowszą wersję', () => {
    expect(() => parseProject('nie json')).toThrow('not-json');
    expect(() => parseProject('{"a":1}')).toThrow('not-project');
    expect(() => parseProject(JSON.stringify({ ...flat, version: 999 }))).toThrow('newer-version');
  });

  it('link: bez komórki STEP, wraca te same ustawienia', async () => {
    const code = await encodeLink(flat);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(linkFromHash(`#${LINK_KEY}=${code}`)).toBe(code);
    const back = await decodeLink(code);
    expect(back.flat!.cell).toBeUndefined();
    expect(back.flat!.caseP).toEqual(flat.flat!.caseP);
    expect(back.flat!.variant).toBe('no-hotswap');
    expect(flat.flat!.cell).toBeDefined(); // oryginał nietknięty
  });

  it('link Dactyla mieści się w rozsądnym adresie', async () => {
    const d = makeProject('dactyl', {
      params: DACTYL_DEFAULT,
      variant: 'hotswap',
      show: 'both',
      ctrlOn: true,
      ctrl: {},
      floor: 4,
      screwSize: 'M3',
      explode: 20,
      showCaps: true,
    });
    const code = await encodeLink(d);
    expect(code.length).toBeLessThan(4000);
    expect((await decodeLink(code)).dactyl!.params).toEqual(DACTYL_DEFAULT);
  });

  it('uszkodzony link', async () => {
    await expect(decodeLink('abc')).rejects.toThrow();
    expect(linkFromHash('#cos')).toBeNull();
  });
});
