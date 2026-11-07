// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Keymapa ZMK dla układu z generatora: warstwy, przypisania klawiszy i eksport pliku `.keymap`.
 *
 * Przypisanie trzymamy jako tekst w składni ZMK (`&kp A`, `&mo 1`, `&lt 1 SPACE`, `&mt LCTRL A`, `&trans`),
 * a klawisz wskazujemy odnośnikiem `strona:id` (jak w legendach), więc keymapa nie zależy od kolejności.
 * Kolejność w pliku daje dopiero macierz z instrukcji okablowania: rzędy macierzy (w rzędzie lewa połówka,
 * potem prawa, kolumny od lewej), a na końcu przyciski modułu OLED (PUSH, CON, BAK). Tak samo układa
 * `matrix_transform` w shieldzie `s2mini_60` z repo zmk-s2mini.
 */
import type { WiringInput } from './wiring-doc';
import type { Assignment } from './wiring';
import { keyInfo, keyLabel, splitMods } from './keymap-keys';

/** jedna warstwa: przypisania po odnośnikach klawiszy i enkodery (`&inc_dec_kp …`) */
export interface KeymapLayer {
  /** nazwa pokazywana (display-name) */
  name: string;
  /** nazwa węzła w pliku (opcjonalnie, inaczej z nazwy) */
  node?: string;
  keys: Record<string, string>;
  sensors?: Record<string, string>;
}

export interface KeymapData {
  layers: KeymapLayer[];
}

export const TRANS = '&trans';
export const NONE = '&none';

// ---------------------------------------------------------------- przypisania

export type Binding =
  | { kind: 'kp'; key: string }
  | { kind: 'mo' | 'tog' | 'to'; layer: number }
  | { kind: 'lt'; layer: number; key: string }
  | { kind: 'mt'; mod: string; key: string }
  | { kind: 'trans' }
  | { kind: 'none' }
  | { kind: 'raw'; text: string };

export type BindingKind = Binding['kind'];

export function parseBinding(s: string): Binding {
  const t = s.trim().replace(/\s+/g, ' ');
  const parts = t.split(' ');
  const n = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : NaN);
  switch (parts[0]) {
    case '&trans':
      if (parts.length === 1) return { kind: 'trans' };
      break;
    case '&none':
      if (parts.length === 1) return { kind: 'none' };
      break;
    case '&kp':
      if (parts.length === 2) return { kind: 'kp', key: parts[1] };
      break;
    case '&mo':
    case '&tog':
    case '&to':
      if (parts.length === 2 && Number.isFinite(n(parts[1]))) return { kind: parts[0].slice(1) as 'mo' | 'tog' | 'to', layer: n(parts[1]) };
      break;
    case '&lt':
      if (parts.length === 3 && Number.isFinite(n(parts[1]))) return { kind: 'lt', layer: n(parts[1]), key: parts[2] };
      break;
    case '&mt':
      if (parts.length === 3) return { kind: 'mt', mod: parts[1], key: parts[2] };
      break;
  }
  return { kind: 'raw', text: t };
}

export function formatBinding(b: Binding): string {
  switch (b.kind) {
    case 'trans':
      return TRANS;
    case 'none':
      return NONE;
    case 'kp':
      return `&kp ${b.key}`;
    case 'mo':
    case 'tog':
    case 'to':
      return `&${b.kind} ${b.layer}`;
    case 'lt':
      return `&lt ${b.layer} ${b.key}`;
    case 'mt':
      return `&mt ${b.mod} ${b.key}`;
    case 'raw':
      return b.text.trim() || NONE;
  }
}

/** opis na rysunek: `tap` na środku, `hold` (przytrzymanie, warstwa) mniejszy u dołu */
export function bindingLabel(s: string, layers: { name: string }[], layoutMap?: Map<string, string> | null): { tap: string; hold?: string; dim?: boolean } {
  const b = parseBinding(s);
  const ln = (i: number) => layers[i]?.name || String(i);
  switch (b.kind) {
    case 'trans':
      return { tap: '▽', dim: true };
    case 'none':
      return { tap: '–', dim: true };
    case 'kp':
      return { tap: keyLabel(b.key, layoutMap) };
    case 'mo':
      return { tap: ln(b.layer), hold: 'warstwa' };
    case 'tog':
      return { tap: ln(b.layer), hold: 'przełącz' };
    case 'to':
      return { tap: ln(b.layer), hold: 'na stałe' };
    case 'lt':
      return { tap: keyLabel(b.key, layoutMap), hold: ln(b.layer) };
    case 'mt':
      return { tap: keyLabel(b.key, layoutMap), hold: keyLabel(b.mod) };
    case 'raw': {
      const special: Record<string, string> = { '&studio_unlock': 'Studio 🔓', '&bootloader': 'Boot', '&sys_reset': 'Reset' };
      return { tap: special[b.text] ?? b.text.replace(/^&/, '') };
    }
  }
}

/** gotowe zachowania spoza &kp do wyboru z listy */
export const SPECIAL_BINDINGS: { text: string; pl: string; en: string }[] = [
  { text: '&studio_unlock', pl: 'Odblokowanie ZMK Studio', en: 'Unlock ZMK Studio' },
  { text: '&bootloader', pl: 'Tryb wgrywania firmware (bootloader)', en: 'Enter bootloader' },
  { text: '&sys_reset', pl: 'Restart klawiatury', en: 'Reset keyboard' },
  { text: '&key_repeat', pl: 'Powtórz ostatni klawisz', en: 'Repeat last key' },
  { text: '&caps_word', pl: 'Caps Word (jedno słowo wielkimi)', en: 'Caps Word' },
];

/** sprawdzenie przypisania (zły kod klawisza albo warstwa poza listą); zwraca opis problemu */
export function checkBinding(s: string, layerCount: number): string | null {
  const b = parseBinding(s);
  const keyOk = (e: string) => {
    const { key } = splitMods(e);
    return !!keyInfo(key) || /^[A-Z][A-Z0-9_]*$/.test(key);
  };
  if ((b.kind === 'mo' || b.kind === 'tog' || b.kind === 'to' || b.kind === 'lt') && b.layer >= layerCount) return `warstwa ${b.layer} nie istnieje`;
  if ((b.kind === 'kp' || b.kind === 'lt' || b.kind === 'mt') && !keyOk(b.key)) return `nieznany kod ${b.key}`;
  if (b.kind === 'raw' && !/^&[a-z_][a-z0-9_]*( [A-Za-z0-9_()]+)*$/.test(b.text)) return `niepoprawne zachowanie „${b.text}”`;
  return null;
}

// ---------------------------------------------------------------- pozycje (kolejność w pliku)

export interface KeymapSlot {
  /** odnośnik `strona:id` (dla przycisków modułu `strona:mod-push` itd.) */
  ref: string;
  /** rząd do ładnego formatowania pliku (rząd macierzy; przyciski modułu w ostatnim) */
  row: number;
  kind: 'key' | 'button';
}

export interface KeymapLayout {
  slots: KeymapSlot[];
  /** enkodery (sensor-bindings), odnośnik `strona:enc` */
  sensors: string[];
}

const sideOf = (s: 'left' | 'right' | 'single') => (s === 'single' ? 'left' : s);

/** kolejność pozycji jak w matrix_transform z instrukcji okablowania (i w shieldzie s2mini_60) */
export function keymapLayout(inp: Pick<WiringInput, 'halves'>, as: Assignment[]): KeymapLayout {
  const all = inp.halves.flatMap((h, i) => h.matrix.keys.map((k) => ({ k, half: i, side: sideOf(h.side) })));
  all.sort((p, q) => p.k.row - q.k.row || p.half - q.half || p.k.col - q.k.col);
  const slots: KeymapSlot[] = all.map((o) => ({ ref: `${o.side}:${o.k.id}`, row: o.k.row, kind: 'key' }));
  const lastRow = all.length ? Math.max(...all.map((o) => o.k.row)) + 1 : 0;
  const sensors: string[] = [];
  inp.halves.forEach((h, i) => {
    const a = as[i];
    if (!a || !h.module) return;
    for (const b of ['push', 'con', 'bak'] as const) if (a.module[b]) slots.push({ ref: `${sideOf(h.side)}:mod-${b}`, row: lastRow, kind: 'button' });
    if (a.module.encA && a.module.encB) sensors.push(`${sideOf(h.side)}:enc`);
  });
  return { slots, sensors };
}

// ---------------------------------------------------------------- domyślna keymapa

/** keymapa 60% ANSI z shieldu s2mini_60 (repo zmk-s2mini), rząd po rzędzie jak w macierzy */
const ANSI60_BASE = [
  'ESC N1 N2 N3 N4 N5 N6 N7 N8 N9 N0 MINUS EQUAL BSPC',
  'TAB Q W E R T Y U I O P LBKT RBKT BSLH',
  'CAPS A S D F G H J K L SEMI SQT RET',
  'LSHFT Z X C V B N M COMMA DOT FSLH RSHFT',
  'LCTRL LGUI LALT SPACE RALT RGUI @mo1 RCTRL',
];
const ANSI60_FN = [
  'GRAVE F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 DEL',
  '_ _ _ _ _ _ _ PG_UP UP PG_DN PSCRN _ _ @studio_unlock',
  '_ _ _ _ _ _ HOME LEFT DOWN RIGHT END _ _',
  '_ _ _ _ _ _ _ _ _ _ _ _',
  '_ _ _ _ _ _ _ _',
];
const tok = (t: string) => (t === '_' ? TRANS : t === '@mo1' ? '&mo 1' : t.startsWith('@') ? `&${t.slice(1)}` : `&kp ${t}`);

/** nazwy z domyślnych legend → kody ZMK (split, Dactyl) */
const LEGEND_TO_ZMK: Record<string, string> = {
  Esc: 'ESC', Back: 'BSPC', Tab: 'TAB', Caps: 'CAPS', Enter: 'RET', Space: 'SPACE', Del: 'DEL', Home: 'HOME', Menu: 'K_APP',
  Win: 'LGUI', Alt: 'LALT', AltGr: 'RALT', Ctrl: 'LCTRL', Shift: 'LSHFT',
  '-': 'MINUS', '=': 'EQUAL', '[': 'LBKT', ']': 'RBKT', '\\': 'BSLH', ';': 'SEMI', "'": 'SQT', ',': 'COMMA', '.': 'DOT', '/': 'FSLH', '`': 'GRAVE',
};
function legendToBinding(main: string, side: 'left' | 'right'): string {
  if (main === 'Fn') return '&mo 1';
  if (/^[A-Z]$/.test(main)) return `&kp ${main}`;
  if (/^[0-9]$/.test(main)) return `&kp N${main}`;
  const z = LEGEND_TO_ZMK[main];
  if (!z) return NONE;
  // prawa połówka: prawe modyfikatory
  if (side === 'right' && /^L(CTRL|SHFT|ALT|GUI)$/.test(z)) return `&kp R${z.slice(1)}`;
  return `&kp ${z}`;
}

/**
 * Domyślna keymapa układu: dla 60% ANSI taka jak w shieldzie s2mini_60, dla innych z domyślnych legend
 * (warstwa podstawowa + pusta warstwa Fn), macropad pusty. Enkoder: głośność, na Fn jasność.
 */
export function defaultKeymap(o: {
  layout: KeymapLayout;
  ansi60: boolean;
  macropad: boolean;
  /** domyślne opisy klawiszy `strona:id` → główna legenda */
  legends: Record<string, string>;
}): KeymapData {
  const base: KeymapLayer = { name: 'Podstawowa', node: 'base', keys: {}, sensors: {} };
  const fn: KeymapLayer = { name: 'Fn', node: 'fn', keys: {}, sensors: {} };
  const keys = o.layout.slots.filter((s) => s.kind === 'key');
  if (o.ansi60) {
    const b = ANSI60_BASE.map((r) => r.split(' '));
    const f = ANSI60_FN.map((r) => r.split(' '));
    // odnośniki k-r-c, kolumna = kolejny klawisz w rzędzie układu
    for (const s of keys) {
      const m = /:k-(\d+)-(\d+)$/.exec(s.ref);
      if (!m) continue;
      const bt = b[+m[1]]?.[+m[2]];
      const ft = f[+m[1]]?.[+m[2]];
      base.keys[s.ref] = bt ? tok(bt) : NONE;
      fn.keys[s.ref] = ft ? tok(ft) : TRANS;
    }
  } else {
    for (const s of keys) {
      const side = s.ref.startsWith('right:') ? 'right' : 'left';
      base.keys[s.ref] = o.macropad ? NONE : legendToBinding(o.legends[s.ref] ?? '', side);
      fn.keys[s.ref] = TRANS;
    }
    // macropad: F13–F24 (wolne w systemie, do skrótów w programach), dalej &none
    if (o.macropad) keys.forEach((s, i) => (base.keys[s.ref] = i < 12 ? `&kp F${13 + i}` : NONE));
    // bez klawisza Fn w legendach: Fn po przytrzymaniu spacji (prawa połówka, gdy jest)
    if (!o.macropad && !Object.values(base.keys).includes('&mo 1')) {
      const spaces = keys.filter((s) => base.keys[s.ref] === '&kp SPACE');
      const sp = spaces.find((s) => s.ref.startsWith('right:')) ?? spaces[0];
      if (sp) base.keys[sp.ref] = '&lt 1 SPACE';
    }
  }
  const btn = o.layout.slots.filter((s) => s.kind === 'button');
  for (const s of btn) {
    const b = s.ref.split(':')[1];
    base.keys[s.ref] = b === 'mod-push' ? '&kp C_MUTE' : b === 'mod-con' ? '&kp C_PP' : '&kp C_NEXT';
    fn.keys[s.ref] = b === 'mod-push' ? TRANS : b === 'mod-con' ? '&kp C_PREV' : '&kp C_STOP';
  }
  for (const e of o.layout.sensors) {
    base.sensors![e] = '&inc_dec_kp C_VOL_UP C_VOL_DN';
    fn.sensors![e] = '&inc_dec_kp C_BRI_UP C_BRI_DN';
  }
  // macropad bez klawisza Fn: tylko warstwa podstawowa (Fn można dodać przyciskiem +)
  return { layers: o.macropad ? [base] : [base, fn] };
}

// ---------------------------------------------------------------- zmiany warstw

/** usuwa warstwę i poprawia odwołania: do niej → &none (lt → sam klawisz), dalsze o jeden w dół */
export function removeLayer(km: KeymapData, idx: number): KeymapData {
  const fix = (s: string) => {
    const b = parseBinding(s);
    if (b.kind === 'mo' || b.kind === 'tog' || b.kind === 'to' || b.kind === 'lt') {
      if (b.layer === idx) return b.kind === 'lt' ? `&kp ${b.key}` : NONE;
      if (b.layer > idx) return formatBinding({ ...b, layer: b.layer - 1 });
    }
    return s;
  };
  return {
    layers: km.layers
      .filter((_, i) => i !== idx)
      .map((l) => ({ ...l, keys: Object.fromEntries(Object.entries(l.keys).map(([r, s]) => [r, fix(s)])) })),
  };
}

/** zamienia miejscami warstwy `a` i `b` razem z odwołaniami do nich */
export function swapLayers(km: KeymapData, a: number, b: number): KeymapData {
  const map = (i: number) => (i === a ? b : i === b ? a : i);
  const fix = (s: string) => {
    const x = parseBinding(s);
    return x.kind === 'mo' || x.kind === 'tog' || x.kind === 'to' || x.kind === 'lt' ? formatBinding({ ...x, layer: map(x.layer) }) : s;
  };
  const layers = km.layers.map((l) => ({ ...l, keys: Object.fromEntries(Object.entries(l.keys).map(([r, s]) => [r, fix(s)])) }));
  [layers[a], layers[b]] = [layers[b], layers[a]];
  return { layers };
}

// ---------------------------------------------------------------- eksport

/** nazwa węzła warstwy: małe litery ASCII, cyfry i _, unikalna */
export function layerNodes(layers: KeymapLayer[]): string[] {
  const used = new Set<string>();
  return layers.map((l, i) => {
    let n = (l.node || l.name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!/^[a-z]/.test(n)) n = `layer_${i}${n ? `_${n}` : ''}`;
    while (used.has(n)) n = `${n}_${i}`;
    used.add(n);
    return n;
  });
}

const dtsString = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export interface KeymapExport {
  text: string;
  /** problemy w przypisaniach (warstwa, odnośnik, opis) */
  problems: { layer: number; ref: string; msg: string }[];
}

/** plik `.keymap` w stylu shieldu s2mini_60: kolumny wyrównane, rząd macierzy w jednej linii */
export function keymapFile(km: KeymapData, layout: KeymapLayout, o: { title: string }): KeymapExport {
  const problems: KeymapExport['problems'] = [];
  const nodes = layerNodes(km.layers);
  const used = km.layers.flatMap((l) => [...Object.values(l.keys), ...Object.values(l.sensors ?? {})]).join(' ');
  const includes = ['#include <behaviors.dtsi>', '#include <dt-bindings/zmk/keys.h>'];
  if (/&bt\b/.test(used)) includes.push('#include <dt-bindings/zmk/bt.h>');
  if (/&out\b/.test(used)) includes.push('#include <dt-bindings/zmk/outputs.h>');
  if (/&rgb_ug\b/.test(used)) includes.push('#include <dt-bindings/zmk/rgb.h>');
  const rows = [...new Set(layout.slots.map((s) => s.row))].sort((a, b) => a - b);
  // szerokość kolumn wspólna dla wszystkich warstw
  const colW: number[] = [];
  const cells = km.layers.map((l, li) =>
    rows.map((r) =>
      layout.slots
        .filter((s) => s.row === r)
        .map((s, ci) => {
          const v = l.keys[s.ref] ?? (li === 0 ? NONE : TRANS);
          const p = checkBinding(v, km.layers.length);
          if (p) problems.push({ layer: li, ref: s.ref, msg: p });
          colW[ci] = Math.max(colW[ci] ?? 0, v.length);
          return v;
        }),
    ),
  );
  const out: string[] = [
    '/*',
    ` * ${o.title}`,
    ' * Wygenerowane w Keyboard maker (zakładka Keymapa). Kolejność klawiszy jak w matrix_transform:',
    ' * rzędy macierzy od góry, w rzędzie kolumny od lewej; ostatni rząd to przyciski modułu OLED (PUSH, CON, BAK).',
    ' * SPDX-License-Identifier: MIT',
    ' */',
    ...includes,
    '',
    '/ {',
    '    keymap {',
    '        compatible = "zmk,keymap";',
  ];
  km.layers.forEach((l, li) => {
    out.push('', `        ${nodes[li]} {`, `            display-name = "${dtsString(l.name || nodes[li])}";`, '            bindings = <');
    for (const row of cells[li]) out.push(row.map((v, ci) => (ci === row.length - 1 ? v : v.padEnd(colW[ci]))).join(' '));
    out.push('            >;');
    if (layout.sensors.length) {
      const sb = layout.sensors.map((e) => l.sensors?.[e] ?? (li === 0 ? '&inc_dec_kp C_VOL_UP C_VOL_DN' : TRANS));
      out.push(`            sensor-bindings = <${sb.join(' ')}>;`);
    }
    out.push('        };');
  });
  out.push('    };', '};', '');
  return { text: out.join('\n'), problems };
}
