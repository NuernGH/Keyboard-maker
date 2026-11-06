// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { TEMPLATES, splitLeft } from '../src/lib/layout';
import { DEFAULT_ISLAND, type ControllerId } from '../src/lib/island';
import { CONTROLLER_PINS, assignPins, matrixOf, mirrorMatrix, placeRow } from '../src/lib/wiring';
import { dactylWiringInput, splitWiringInput, wiringAssignments, wiringHtml } from '../src/lib/wiring-doc';
import { DACTYL_DEFAULT, buildDactyl } from '../src/lib/dactyl';

const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!.params;
const input = (id: string, controller: ControllerId | 'custom' = 'nicenano', extra: Partial<typeof DEFAULT_ISLAND> = {}) =>
  splitWiringInput({
    params: tpl(id),
    island: { ...DEFAULT_ISLAND, controller, ...(tpl(id).single ? { position: 'top' as const } : {}), ...extra },
    variant: 'hotswap',
    cellHeight: 8.58,
    margin: 0,
    stabs: 'cherry',
    lang: 'pl',
    layout: id,
  });

describe('macierz', () => {
  test('placeRow: kolejność od lewej, bez powtórzeń, najbliższa kolumna', () => {
    expect(placeRow([0, 1, 2], [0, 1, 2, 3])).toEqual([0, 1, 2]);
    expect(placeRow([2.6, 0.1], [0, 1, 2, 3])).toEqual([3, 0]);
    expect(placeRow([3.9, 4.0], [0, 1, 2, 3])).toEqual([2, 3]);
    expect(placeRow([0, 1, 2], [0, 1])).toBeNull();
  });

  test('split 4×6+4: 5 rzędów × 6 kolumn, kciuki w rzędzie 4 pod kolumnami 2–5', () => {
    const m = matrixOf(splitLeft(tpl('split-4x6-4')), false);
    expect([m.rows, m.cols, m.keys.length]).toEqual([5, 6, 28]);
    expect(m.keys.filter((k) => k.row === 4).map((k) => k.col).sort()).toEqual([2, 3, 4, 5]);
    const r = mirrorMatrix(m);
    // prawa połówka: K0 po lewej patrząc z góry
    const k0 = r.keys.filter((k) => k.col === 0 && k.row === 0)[0];
    expect(k0.x).toBeCloseTo(Math.max(...r.keys.filter((k) => k.row === 0).map((k) => -k.x)) * -1);
  });

  test('60% ANSI: 5 × 14, każda pozycja macierzy najwyżej raz', () => {
    const m = matrixOf(splitLeft(tpl('ansi-60')), true);
    expect([m.rows, m.cols, m.keys.length]).toEqual([5, 14, 61]);
    const pos = new Set(m.keys.map((k) => `${k.row},${k.col}`));
    expect(pos.size).toBe(61);
    // Backspace i Enter w ostatniej kolumnie
    const last = (r: number) => m.keys.filter((k) => k.row === r).sort((a, b) => b.x - a.x)[0].col;
    expect([last(0), last(2), last(4)]).toEqual([13, 13, 13]);
  });

  test('wszystkie szablony mają unikalne pozycje w macierzy', () => {
    for (const t of TEMPLATES) {
      const m = matrixOf(splitLeft(t.params), !!t.params.rowLayout?.length);
      const pos = new Set(m.keys.map((k) => `${k.row},${k.col}`));
      expect(pos.size, t.id).toBe(m.keys.length);
    }
  });
});

describe('piny', () => {
  test('nice!nano, split 4×6+4 z modułem po lewej: piny jak w instrukcji', () => {
    const inp = input('split-4x6-4');
    const [L, R] = wiringAssignments(inp);
    expect(L.rows.map((p) => p.id)).toEqual(['D4', 'D5', 'D6', 'D7', 'D8']);
    expect(L.cols.map((p) => p.id)).toEqual(['D21', 'D20', 'D19', 'D18', 'D15', 'D14']);
    expect(Object.fromEntries(Object.entries(L.module).map(([k, p]) => [k, p.id]))).toEqual({
      sda: 'D2', scl: 'D3', encA: 'D1', encB: 'D0', push: 'D9', con: 'D16', bak: 'D10',
    });
    expect(R.rows.map((p) => p.id)).toEqual(L.rows.map((p) => p.id));
    expect(R.cols.map((p) => p.id)).toEqual(L.cols.map((p) => p.id));
    expect(L.missing).toEqual([]);
  });

  test('60% z ESP32-S3: piny jak w instrukcji', () => {
    const inp = input('ansi-60', 'esp32s3', { tilt: 25 });
    const [A] = wiringAssignments(inp);
    expect(A.rows.map((p) => p.id)).toEqual(['IO4', 'IO5', 'IO6', 'IO7', 'IO15']);
    expect(A.cols.map((p) => p.id)).toEqual(['IO16', 'IO17', 'IO18', 'IO8', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13', 'IO14', 'IO21', 'IO47', 'IO1', 'IO2']);
    expect(A.module.sda?.id).toBe('IO41');
    expect(A.module.push?.id).toBe('IO0');
    expect(A.missing).toEqual([]);
  });

  test('pin nigdy nie jest użyty dwa razy, a piny „nie używać” wcale', () => {
    for (const t of TEMPLATES)
      for (const c of [...Object.keys(CONTROLLER_PINS), 'custom'] as (ControllerId | 'custom')[]) {
        const inp = input(t.id, c);
        for (const a of wiringAssignments(inp)) {
          const ids = [...a.rows, ...a.cols, ...Object.values(a.module), ...(a.split ? [a.split] : [])];
          expect(new Set(ids.map((p) => p.id)).size, `${t.id} ${c}`).toBe(ids.length);
          expect(ids.some((p) => p.avoid), `${t.id} ${c}`).toBe(false);
        }
      }
  });

  test('za mało pinów: najpierw odpadają przyciski modułu, macierz zostaje', () => {
    const m = matrixOf(splitLeft(tpl('ansi-60')), true);
    const a = assignPins(CONTROLLER_PINS.nicenano, m, { module: true, split: false });
    expect(a.rows.length + a.cols.length).toBe(19);
    expect(a.missing.some((r) => r.kind === 'row' || r.kind === 'col')).toBe(false);
  });

  test('Pro Micro w splicie dostaje linię TRRS', () => {
    const [L] = wiringAssignments(input('split-3x5-3', 'promicro-c'));
    expect(L.split?.id).toBe('D2');
  });
});

describe('dokument', () => {
  const out = process.env.OUT;
  const cases: [string, ReturnType<typeof input>][] = [
    ['split-4x6-4-nicenano', input('split-4x6-4')],
    ['ansi-60-esp32s3', input('ansi-60', 'esp32s3', { tilt: 25 })],
    ['ansi-60-mx-promicro', { ...input('ansi-60', 'promicro-c', { tilt: 25 }), stabs: 'mx' }],
    ['macropad-3x3-kb2040', input('macropad-3x3', 'kb2040')],
    ['split-3x5-3-s2mini', input('split-3x5-3', 's2mini')],
    ['split-4x6-4-custom', input('split-4x6-4', 'custom')],
  ];
  const dactyl = dactylWiringInput({ model: buildDactyl(DACTYL_DEFAULT, { cellHeight: 8.58 }), controller: 'nicenano', hotswap: true, lang: 'pl' });
  cases.push(['dactyl-5x6-nicenano', dactyl]);
  test.each(cases)('%s: HTML z rysunkami i tabelą', (name, inp) => {
    const html = wiringHtml(inp);
    expect(html).toContain('<svg');
    expect(html).toContain('COL2ROW');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/${name}.html`, html);
      writeFileSync(`${out}/${name}-en.html`, wiringHtml({ ...inp, lang: 'en' }));
    }
  });

  test('Dactyl: 6 rzędów (kciuk osobno) × 6 kolumn, 34 klawisze', () => {
    const m = dactyl.halves[1].matrix;
    expect([m.rows, m.cols, m.keys.length]).toEqual([6, 6, 34]);
    // dwa kciuki w pustych miejscach dolnego rzędu
    expect(m.keys.filter((k) => k.id.startsWith('t-') && k.row === 4).length).toBe(2);
    expect(new Set(m.keys.map((k) => `${k.row},${k.col}`)).size).toBe(34);
  });
});
