// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEMPLATES, splitLeft } from '../src/lib/layout';
import { DEFAULT_ISLAND, type ControllerId } from '../src/lib/island';
import { splitWiringInput, wiringAssignments } from '../src/lib/wiring-doc';
import { defaultLegends } from '../src/lib/legend-defaults';
import { captureKey, loneModifier, keyLabel, searchKeys, CODE_TO_ZMK } from '../src/lib/keymap-keys';
import { bindingLabel, defaultKeymap, formatBinding, keymapFile, keymapLayout, layerNodes, parseBinding, removeLayer, swapLayers } from '../src/lib/keymap';

const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!.params;
const input = (id: string, controller: ControllerId = 'nicenano') =>
  splitWiringInput({
    params: tpl(id),
    island: { ...DEFAULT_ISLAND, controller, ...(tpl(id).single ? { position: 'top' as const } : {}) },
    variant: 'hotswap',
    cellHeight: 8.58,
    margin: 0,
    stabs: 'cherry',
    lang: 'pl',
    layout: id,
  });
const layoutOf = (id: string, c: ControllerId = 'nicenano') => {
  const inp = input(id, c);
  return keymapLayout(inp, wiringAssignments(inp));
};

function layerBindings(text: string) {
  return [...text.matchAll(/\n\s*bindings = <([^>]*)>/g)].map((m) =>
    m[1]
      .trim()
      .split(/(?=&)/)
      .map((s) => s.trim().replace(/\s+/g, ' ')),
  );
}
const sensorsOf = (text: string) => [...text.matchAll(/sensor-bindings = <([^>]*)>/g)].map((m) => m[1].trim().replace(/\s+/g, ' '));

describe('kolejność klawiszy', () => {
  test('60% S2 mini: tyle pozycji i w tej samej kolejności co matrix_transform shieldu s2mini_60', () => {
    const overlay = readFileSync(new URL('./fixtures/zmk-s2mini/s2mini_60.overlay', import.meta.url), 'utf8');
    const map = /map = <([^>]*)>/.exec(overlay)![1].match(/RC\(\d+,\d+\)/g)!;
    const inp = input('ansi-60', 's2mini');
    const as = wiringAssignments(inp);
    const lay = keymapLayout(inp, as);
    expect(lay.slots.length).toBe(map.length);
    // RC(rząd, kolumna) z macierzy generatora; przyciski modułu jako rząd 5, kolumny 0..2
    const keys = new Map(inp.halves[0].matrix.keys.map((k) => [`left:${k.id}`, k]));
    let btn = 0;
    const rc = lay.slots.map((s) => {
      const k = keys.get(s.ref);
      return k ? `RC(${k.row},${k.col})` : `RC(5,${btn++})`;
    });
    expect(rc).toEqual(map);
    expect(lay.sensors).toEqual(['left:enc']);
  });
  test('split: w rzędzie lewa połówka, potem prawa', () => {
    const lay = layoutOf('split-3x5-3');
    const row0 = lay.slots.filter((s) => s.row === 0 && s.kind === 'key').map((s) => s.ref.split(':')[0]);
    expect(row0).toEqual([...Array(5).fill('left'), ...Array(5).fill('right')]);
  });
});

describe('domyślna keymapa', () => {
  test('60% S2 mini: eksport daje te same wiązania i enkodery co s2mini_60.keymap z repo', () => {
    const repo = readFileSync(new URL('./fixtures/zmk-s2mini/s2mini_60.keymap', import.meta.url), 'utf8');
    const lay = layoutOf('ansi-60', 's2mini');
    const km = defaultKeymap({ layout: lay, ansi60: true, macropad: false, legends: {} });
    const out = keymapFile(km, lay, { title: 'test' });
    expect(out.problems).toEqual([]);
    expect(layerBindings(out.text)).toEqual(layerBindings(repo));
    expect(sensorsOf(out.text)).toEqual(sensorsOf(repo));
    expect(out.text).toContain('display-name = "Podstawowa"');
    expect(out.text).toContain('        fn {');
  });
  test('split: z domyślnych legend, prawa połówka z prawymi modyfikatorami', () => {
    const inp = input('split-4x6-4');
    const lay = keymapLayout(inp, wiringAssignments(inp));
    const p = tpl('split-4x6-4');
    const legends: Record<string, string> = {};
    for (const side of ['left', 'right'] as const)
      for (const [id, l] of Object.entries(defaultLegends('split-4x6-4', p, splitLeft(p), side))) legends[`${side}:${id}`] = l.main ?? '';
    const km = defaultKeymap({ layout: lay, ansi60: false, macropad: false, legends });
    const out = keymapFile(km, lay, { title: 'split' });
    expect(out.problems).toEqual([]);
    const base = Object.values(km.layers[0].keys);
    expect(base).toContain('&kp Q');
    expect(base).toContain('&kp RSHFT');
    expect(base.some((b) => b === '&mo 1' || b === '&lt 1 SPACE')).toBe(true);
    // każda pozycja ma wiązanie
    expect(layerBindings(out.text)[0].length).toBe(lay.slots.length);
  });
});

test('macropad: F13… i tylko warstwa podstawowa', () => {
  const lay = layoutOf('macropad-3x3');
  const km = defaultKeymap({ layout: lay, ansi60: false, macropad: true, legends: {} });
  expect(km.layers.length).toBe(1);
  expect(Object.values(km.layers[0].keys).slice(0, 2)).toEqual(['&kp F13', '&kp F14']);
  expect(keymapFile(km, lay, { title: '' }).problems).toEqual([]);
});

describe('wiązania', () => {
  test('parse/format w obie strony', () => {
    for (const s of ['&kp A', '&kp LC(LS(T))', '&mo 2', '&tog 1', '&to 0', '&lt 1 SPACE', '&mt LCTRL A', '&trans', '&none', '&studio_unlock', '&bt BT_SEL 0'])
      expect(formatBinding(parseBinding(s))).toBe(s);
    expect(parseBinding('&kp   RA(A)')).toEqual({ kind: 'kp', key: 'RA(A)' });
    expect(parseBinding('&bt BT_CLR').kind).toBe('raw');
  });
  test('problemy: zły kod i brak warstwy', () => {
    const lay = { slots: [{ ref: 'left:a', row: 0, kind: 'key' as const }], sensors: [] };
    const out = keymapFile({ layers: [{ name: 'A', keys: { 'left:a': '&mo 3' } }] }, lay, { title: '' });
    expect(out.problems[0].msg).toMatch(/warstwa 3/);
    const out2 = keymapFile({ layers: [{ name: 'A', keys: { 'left:a': '&kp lowercase' } }] }, lay, { title: '' });
    expect(out2.problems[0].msg).toMatch(/nieznany kod/);
  });
  test('usuwanie i zamiana warstw poprawia odwołania', () => {
    const km = { layers: [{ name: 'a', keys: { x: '&mo 1', y: '&lt 2 SPACE', z: '&kp A' } }, { name: 'b', keys: {} }, { name: 'c', keys: {} }] };
    expect(removeLayer(km, 1).layers[0].keys).toEqual({ x: '&none', y: '&lt 1 SPACE', z: '&kp A' });
    expect(removeLayer(km, 2).layers[0].keys.y).toBe('&kp SPACE');
    const sw = swapLayers(km, 1, 2);
    expect(sw.layers.map((l) => l.name)).toEqual(['a', 'c', 'b']);
    expect(sw.layers[0].keys).toEqual({ x: '&mo 2', y: '&lt 1 SPACE', z: '&kp A' });
  });
  test('nazwy węzłów: ASCII, unikalne, zaczynają się od litery', () => {
    expect(layerNodes([{ name: 'Podstawowa', keys: {} }, { name: 'Łączność', keys: {} }, { name: '1', keys: {} }, { name: 'Podstawowa', keys: {} }])).toEqual(['podstawowa', 'lacznosc', 'layer_2_1', 'podstawowa_3']);
  });
  test('opisy na rysunku', () => {
    const layers = [{ name: 'Baza' }, { name: 'Fn' }];
    expect(bindingLabel('&lt 1 SPACE', layers)).toEqual({ tap: 'Spacja', hold: 'Fn' });
    expect(bindingLabel('&kp RA(A)', layers).tap).toBe('ą');
    expect(bindingLabel('&kp LC(LS(T))', layers).tap).toBe('Ctrl+Shift+T');
    expect(bindingLabel('&trans', layers).dim).toBe(true);
    expect(keyLabel('SEMI', new Map([['Semicolon', 'ł']]))).toBe('Ł');
  });
});

describe('wybór naciśnięciem', () => {
  test('KeyboardEvent.code → kod ZMK', () => {
    expect(captureKey('KeyA', [])).toBe('A');
    expect(captureKey('Digit1', [])).toBe('N1');
    expect(captureKey('BracketLeft', [])).toBe('LBKT');
    expect(captureKey('KeyT', ['ControlLeft', 'ShiftLeft'])).toBe('LC(LS(T))');
    expect(captureKey('Unidentified', [])).toBeNull();
  });
  test('AltGr w Windows (lewy Ctrl + prawy Alt) → RA(x), fałszywy Ctrl odpada', () => {
    expect(captureKey('KeyA', ['ControlLeft', 'AltRight'], true)).toBe('RA(A)');
    expect(captureKey('KeyA', ['ControlLeft', 'AltRight'])).toBe('RA(A)');
    expect(captureKey('KeyA', ['ControlRight', 'AltRight'])).toBe('RC(RA(A))');
    expect(loneModifier(['ControlLeft', 'AltRight'])).toBe('RALT');
    expect(loneModifier(['ShiftRight'])).toBe('RSHFT');
    expect(loneModifier(['KeyA'])).toBeNull();
  });
  test('każdy kod w tabeli jest unikalny, wyszukiwanie po polsku', () => {
    expect(CODE_TO_ZMK.size).toBeGreaterThan(100);
    expect(searchKeys('glosnosc').map((k) => k.id)).toContain('C_VOL_UP');
    expect(searchKeys('srednik')[0].id).toBe('SEMI');
    expect(searchKeys('f1')[0].id).toBe('F1');
  });
});
