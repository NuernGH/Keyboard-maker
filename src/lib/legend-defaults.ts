// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Domyślne legendy (nazwy klawiszy): 60% ANSI jak na zwykłej klawiaturze, split i Dactyl w QWERTY,
 * macropad numerami. Klucz w wyniku to id klawisza z layout.ts / dactyl.ts; strona podawana osobno,
 * bo w splicie prawa połówka ma te same id co lewa (pozycje lustrzane).
 */
import type { Key, SplitParams } from './layout';
import type { LegendSet } from './legend';

type KeyLegends = LegendSet;
type Side = 'left' | 'right';

const ANSI60_MAIN: string[][] = [
  ['Esc', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Back'],
  ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
  ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'],
  ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'],
  ['Ctrl', 'Win', 'Alt', '', 'Alt', 'Fn', 'Menu', 'Ctrl'],
];
const ANSI60_SHIFT: string[][] = [
  ['~', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+'],
  ['', '', '', '', '', '', '', '', '', '', '', '{', '}', '|'],
  ['', '', '', '', '', '', '', '', '', '', ':', '"'],
  ['', '', '', '', '', '', '', '', '<', '>', '?'],
];

/** rzędy splitu od kolumny wewnętrznej na zewnątrz (ostatnia pozycja = klawisz skrajny) */
const SPLIT_ROWS = {
  num: { left: ['5', '4', '3', '2', '1', 'Esc'], right: ['6', '7', '8', '9', '0', 'Back'] },
  top: { left: ['T', 'R', 'E', 'W', 'Q', 'Tab'], right: ['Y', 'U', 'I', 'O', 'P', '\\'] },
  home: { left: ['G', 'F', 'D', 'S', 'A', 'Ctrl'], right: ['H', 'J', 'K', 'L', ';', "'"] },
  bottom: { left: ['B', 'V', 'C', 'X', 'Z', 'Shift'], right: ['N', 'M', ',', '.', '/', 'Shift'] },
} as const;
const SPLIT_SHIFT: Record<string, string> = { '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '\\': '|' };
const THUMBS: Record<Side, string[]> = { left: ['Alt', 'Space', 'Win', 'Ctrl', 'Esc', 'Fn'], right: ['AltGr', 'Space', 'Enter', 'Back', 'Del', 'Fn'] };

/** czy układ rzędami to 60% ANSI (5 rzędów: 14, 14, 13, 12, 8 klawiszy) */
export function isAnsi60(rows: number[][] | undefined): boolean {
  if (!rows || rows.length !== 5) return false;
  const ref = [14, 14, 13, 12, 8];
  return rows.every((r, i) => r.filter((v) => v > 0).length === ref[i]);
}

const withShift = (main: string, shift?: string): KeyLegends => (shift ? { main, shift } : main ? { main } : {});

function splitRow(rows: number, r: number) {
  const order = rows >= 4 ? (['num', 'top', 'home', 'bottom'] as const) : (['top', 'home', 'bottom'] as const);
  return order[r];
}

/** legendy płaskiej klawiatury (szablon split, 60%, macropad, własne rzędy) */
export function defaultLegends(templateId: string, p: SplitParams, keys: Key[], side: Side): Record<string, KeyLegends> {
  const out: Record<string, KeyLegends> = {};
  const ansi = isAnsi60(p.rowLayout);
  const macro = templateId.startsWith('macropad');
  for (const k of keys) {
    const m = /^k-(\d+)-(\d+)$/.exec(k.id);
    const t = /^t-(\d+)$/.exec(k.id);
    if (m) {
      const r = +m[1], c = +m[2];
      if (ansi) out[k.id] = withShift(ANSI60_MAIN[r]?.[c] ?? '', ANSI60_SHIFT[r]?.[c] || undefined);
      else if (p.rowLayout?.length || macro) out[k.id] = { main: String(r * Math.max(1, p.cols) + c + 1) };
      else {
        const row = splitRow(p.rows, r);
        const main = row ? (SPLIT_ROWS[row][side][p.cols - 1 - c] ?? '') : '';
        out[k.id] = withShift(main, SPLIT_SHIFT[main]);
      }
    } else if (t) out[k.id] = withShift(THUMBS[side][+t[1]] ?? '');
  }
  return out;
}

/** legendy Dactyla (model = prawa połówka: kolumna 0 wewnętrzna, ostatnia zewnętrzna; lewa to lustro) */
export function dactylLegends(keys: { id: string; col?: number; row?: number; thumb?: string }[], rows: number, side: Side): Record<string, KeyLegends> {
  const out: Record<string, KeyLegends> = {};
  const thumbOrder = ['tl', 'tr', 'ml', 'mr', 'bl', 'br'];
  for (const k of keys) {
    if (k.thumb) {
      out[k.id] = withShift(THUMBS[side][Math.max(0, thumbOrder.indexOf(k.thumb))] ?? '');
      continue;
    }
    if (k.col === undefined || k.row === undefined) continue;
    // 5+ rzędów: rząd cyfr na górze; ostatni rząd (niepełny) bez nazw
    const order = rows >= 5 ? (['num', 'top', 'home', 'bottom'] as const) : (['top', 'home', 'bottom'] as const);
    const row = order[k.row];
    const main = row ? (SPLIT_ROWS[row][side][k.col] ?? '') : '';
    out[k.id] = withShift(main, SPLIT_SHIFT[main]);
  }
  return out;
}
