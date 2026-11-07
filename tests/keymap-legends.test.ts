// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { TEMPLATES } from '../src/lib/layout';
import { DEFAULT_ISLAND } from '../src/lib/island';
import { splitWiringInput, wiringAssignments } from '../src/lib/wiring-doc';
import { defaultKeymap, keymapLayout } from '../src/lib/keymap';
import { fnLayerOf, keymapLegends } from '../src/lib/keymap-legends';

const p = TEMPLATES.find((t) => t.id === 'ansi-60')!.params;
const inp = splitWiringInput({ params: p, island: { ...DEFAULT_ISLAND, controller: 's2mini' }, variant: 'hotswap', cellHeight: 8.58, margin: 0, stabs: 'cherry', lang: 'pl', layout: 'ansi-60' });
const lay = keymapLayout(inp, wiringAssignments(inp));
const km = defaultKeymap({ layout: lay, ansi60: true, s2mini60: true, macropad: false, legends: {} });
const refs = lay.slots.filter((s) => s.kind === 'key').map((s) => s.ref);
const leg = keymapLegends(km, refs);

describe('opisy nakładek z keymapy (60% S2 mini)', () => {
  test('warstwa Fn = cel &mo z BASE', () => expect(fnLayerOf(km)).toBe(2));
  test('dolny rząd jak w firmware: Win i Fn, spacja bez opisu', () => {
    const row = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => leg[`left:k-4-${c}`].main ?? '');
    expect(row).toEqual(['Ctrl', 'Win', 'Alt', '', 'AltGr', 'Win', 'Fn', 'Ctrl']);
  });
  test('Shift dla znaków i Fn z warstwy FN', () => {
    expect(leg['left:k-0-1']).toEqual({ main: '1', shift: '!', fn: 'F1' });
    expect(leg['left:k-0-0']).toEqual({ main: 'Esc', fn: '`' });
    expect(leg['left:k-1-8']).toEqual({ main: 'I', fn: 'Up' });
    expect(leg['left:k-2-5']).toEqual({ main: 'G', fn: 'GAME' });
    expect(leg['left:k-1-13']).toEqual({ main: '\\', shift: '|', fn: 'Studio' });
  });
  test('każdy znak opisów jest w czcionce legend (Noto Sans Black)', () => {
    const buf = readFileSync(new URL('../public/fonts/NotoSans-Black.ttf', import.meta.url));
    const f = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const text = Object.values(leg).flatMap((s) => Object.values(s)).join('');
    const missing = [...new Set(text)].filter((ch) => f.charToGlyphIndex(ch) === 0);
    expect(missing).toEqual([]);
  });
});
