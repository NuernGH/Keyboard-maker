// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Opisy nakładek z keymapy (przycisk „Wstaw opisy z keymapy” w tabeli legend):
 * główna = warstwa podstawowa (0), Shift = znak z Shift dla klawiszy znaków, Fn = warstwa, na którą
 * przechodzi pierwszy klawisz &mo z warstwy podstawowej (np. FN), bez &trans i &none.
 *
 * Teksty są tylko ze znaków, które ma czcionka legend (Noto Sans Black nie ma strzałek ani emoji),
 * dlatego strzałki to słowa (Up, Down…).
 */
import type { LegendSet } from './legend';
import { parseBinding, type KeymapData } from './keymap';
import { splitMods } from './keymap-keys';

/** nazwa na nakładkę dla kodu ZMK (bez modyfikatorów) */
const NAMES: Record<string, string> = {
  ESC: 'Esc', TAB: 'Tab', CAPS: 'Caps', RET: 'Enter', BSPC: 'Back', DEL: 'Del', INS: 'Ins', SPACE: '',
  LSHFT: 'Shift', RSHFT: 'Shift', LCTRL: 'Ctrl', RCTRL: 'Ctrl', LALT: 'Alt', RALT: 'AltGr', LGUI: 'Win', RGUI: 'Win', K_APP: 'Menu',
  MINUS: '-', EQUAL: '=', LBKT: '[', RBKT: ']', BSLH: '\\', SEMI: ';', SQT: "'", GRAVE: '`', COMMA: ',', DOT: '.', FSLH: '/',
  NON_US_BSLH: '\\', NON_US_HASH: '#',
  UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right', HOME: 'Home', END: 'End', PG_UP: 'PgUp', PG_DN: 'PgDn',
  PSCRN: 'PrtSc', SLCK: 'ScrLk', PAUSE_BREAK: 'Pause', KP_NUMLOCK: 'Num',
  C_VOL_UP: 'Vol+', C_VOL_DN: 'Vol-', C_MUTE: 'Mute', C_PP: 'Play', C_NEXT: 'Next', C_PREV: 'Prev', C_STOP: 'Stop',
  C_BRI_UP: 'Bri+', C_BRI_DN: 'Bri-',
};
const SHIFTED: Record<string, string> = {
  N1: '!', N2: '@', N3: '#', N4: '$', N5: '%', N6: '^', N7: '&', N8: '*', N9: '(', N0: ')',
  MINUS: '_', EQUAL: '+', LBKT: '{', RBKT: '}', BSLH: '|', SEMI: ':', SQT: '"', GRAVE: '~', COMMA: '<', DOT: '>', FSLH: '?',
};
const MOD_NAMES: Record<string, string> = { LC: 'Ctrl', LS: 'Shift', LA: 'Alt', LG: 'Win', RC: 'Ctrl', RS: 'Shift', RA: 'AltGr', RG: 'Win' };
const PL_ALTGR: Record<string, string> = { A: 'ą', C: 'ć', E: 'ę', L: 'ł', N: 'ń', O: 'ó', S: 'ś', X: 'ź', Z: 'ż' };
const RAW: Record<string, string> = { '&studio_unlock': 'Studio', '&bootloader': 'Boot', '&sys_reset': 'Reset', '&caps_word': 'CapsW', '&key_repeat': 'Rep' };

function keyName(expr: string): string {
  const { mods, key } = splitMods(expr);
  if (mods.length === 1 && mods[0] === 'RA' && PL_ALTGR[key]) return PL_ALTGR[key];
  let base = NAMES[key];
  if (base === undefined) {
    const m = /^N(\d)$/.exec(key) ?? /^KP_N(\d)$/.exec(key);
    base = m ? m[1] : /^[A-Z]$/.test(key) || /^F\d{1,2}$/.test(key) ? key : key.replace(/^C_/, '').toLowerCase();
  }
  return mods.length ? `${mods.map((m) => MOD_NAMES[m]).join('+')}+${base}` : base;
}

/** nazwa warstwy na nakładkę: FN → Fn, inne bez zmian */
const layerName = (n: string | undefined, i: number) => (n ? (n.toUpperCase() === 'FN' ? 'Fn' : n) : `L${i}`);

/** opis wiązania na nakładkę ('' = bez opisu) */
export function bindingLegend(s: string, km: KeymapData): string {
  const b = parseBinding(s);
  switch (b.kind) {
    case 'trans':
    case 'none':
      return '';
    case 'kp':
    case 'lt':
    case 'mt':
      return keyName(b.key);
    case 'mo':
    case 'tog':
    case 'to':
      return layerName(km.layers[b.layer]?.name, b.layer);
    case 'raw':
      return RAW[b.text] ?? '';
  }
}

/** warstwa Fn: cel pierwszego &mo na warstwie podstawowej, inaczej warstwa 1 */
export function fnLayerOf(km: KeymapData): number | null {
  for (const s of Object.values(km.layers[0]?.keys ?? {})) {
    const b = parseBinding(s);
    if (b.kind === 'mo' && b.layer > 0 && b.layer < km.layers.length) return b.layer;
  }
  return km.layers.length > 1 ? 1 : null;
}

/** legendy (główna, Shift, Fn) dla podanych klawiszy `strona:id` z keymapy */
export function keymapLegends(km: KeymapData, refs: string[]): Record<string, LegendSet> {
  const fn = fnLayerOf(km);
  const out: Record<string, LegendSet> = {};
  for (const ref of refs) {
    const base = km.layers[0]?.keys[ref];
    const set: LegendSet = {};
    if (base) {
      const main = bindingLegend(base, km);
      if (main) set.main = main;
      const b = parseBinding(base);
      if (b.kind === 'kp' && !splitMods(b.key).mods.length && SHIFTED[b.key]) set.shift = SHIFTED[b.key];
    }
    if (fn !== null) {
      const f = km.layers[fn]?.keys[ref];
      const t = f ? bindingLegend(f, km) : '';
      if (t && t !== set.main) set.fn = t;
    }
    out[ref] = set;
  }
  return out;
}
