// SPDX-License-Identifier: AGPL-3.0-or-later
// Okablowanie ręczne (handwire): macierz rzędów i kolumn dla układu klawiszy oraz przypisanie
// pinów kontrolera. Bez zależności od jądra CAD, więc działa w UI i w testach.
//
// Zasady (takie same dla wszystkich układów):
// - diody COL2ROW: kolumna → przełącznik → dioda → rząd, katoda (kreska) od strony rzędu;
// - K0 jest zawsze po lewej patrząc z góry, także na prawej połówce (firmware: col-offset);
// - klawisze kciuka i dodatkowe dostają własny rząd pod głównymi.

import { PITCH, type Key } from './layout';
import type { ControllerId } from './island';

/** Klawisz z miejscem w macierzy. Pozycja jak w `Key` (widok z góry, mm). */
export interface WKey extends Key {
  row: number;
  col: number;
}

export interface Matrix {
  rows: number;
  cols: number;
  keys: WKey[];
}

/**
 * Położenie pinów przełącznika MX w komórce generatora (widok z góry, mm od środka klawisza,
 * oś Y do górnego rzędu), odczytane z public/cells/mx-hotswap.step po ustawieniu płytą do góry.
 * Pin 1 idzie do kolumny, pin 2 przez diodę do rzędu. Pady gniazda Kailh obok pinów.
 */
export const SWITCH_PINS = {
  col: [-3.81, 2.54] as [number, number],
  diode: [2.54, 5.08] as [number, number],
  colPad: [-7.085, 2.54] as [number, number],
  diodePad: [5.842, 5.08] as [number, number],
};

/**
 * Rozdziela klawisze jednego rzędu na kolumny: każdy do najbliższej kolumny (po X), z zachowaniem
 * kolejności od lewej i bez powtórzeń. Gdy klawiszy jest więcej niż kolumn, zwraca null.
 */
export function placeRow(xs: number[], colX: number[]): number[] | null {
  const n = xs.length;
  const m = colX.length;
  if (n > m) return null;
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const nearest = (x: number) => {
    let best = 0;
    for (let c = 1; c < m; c++) if (Math.abs(colX[c] - x) < Math.abs(colX[best] - x) - 1e-6) best = c;
    return best;
  };
  const cs: number[] = [];
  order.forEach(([x], j) => cs.push(Math.max(j === 0 ? 0 : cs[j - 1] + 1, nearest(x))));
  for (let j = n - 1; j >= 0; j--) cs[j] = Math.min(cs[j], m - 1 - (n - 1 - j), j === n - 1 ? m - 1 : cs[j + 1] - 1);
  const out = new Array<number>(n);
  order.forEach(([, i], j) => (out[i] = cs[j]));
  return out;
}

/** Dzieli listę klawiszy (już posortowaną od lewej) na rzędy po najwyżej `m` klawiszy. */
function placeChunks(keys: Key[], colX: number[], firstRow: number, out: WKey[]): number {
  if (!keys.length) return firstRow;
  const sorted = [...keys].sort((a, b) => a.x - b.x);
  let row = firstRow;
  for (let i = 0; i < sorted.length; i += colX.length) {
    const part = sorted.slice(i, i + colX.length);
    const cs = placeRow(
      part.map((k) => k.x),
      colX,
    )!;
    part.forEach((k, j) => out.push({ ...k, row, col: cs[j] }));
    row++;
  }
  return row;
}

/**
 * Macierz lewej połówki (albo jedynej płyty) układu z generatora płaskiego.
 * Rozpoznaje klawisze po identyfikatorach z layout.ts: `k-r-c` (siatka albo rząd układu
 * rzędami), `t-i` (kciuk), `e-i` (dodatkowe).
 */
export function matrixOf(keys: Key[], rowMode: boolean): Matrix {
  const main = keys.filter((k) => k.id.startsWith('k-'));
  const thumbs = keys.filter((k) => k.id.startsWith('t-'));
  const extra = keys.filter((k) => k.id.startsWith('e-'));
  const out: WKey[] = [];
  const rowOf = (k: Key) => Number(k.id.split('-')[1]);
  const nRows = main.length ? Math.max(...main.map(rowOf)) + 1 : 0;
  let colX: number[];
  if (rowMode) {
    // kolumny wyznacza najdłuższy rząd; krótsze rzędy trafiają do najbliższych kolumn
    const rows = Array.from({ length: nRows }, (_, r) => main.filter((k) => rowOf(k) === r));
    const longest = rows.reduce((a, b) => (b.length > a.length ? b : a), [] as Key[]);
    colX = longest.map((k) => k.x).sort((a, b) => a - b);
    rows.forEach((ks, r) => {
      const cs = placeRow(
        ks.map((k) => k.x),
        colX,
      )!;
      ks.forEach((k, j) => out.push({ ...k, row: r, col: cs[j] }));
    });
  } else {
    const nCols = main.length ? Math.max(...main.map((k) => Number(k.id.split('-')[2]))) + 1 : 1;
    colX = Array.from({ length: nCols }, (_, c) => c * PITCH);
    for (const k of main) out.push({ ...k, row: rowOf(k), col: Number(k.id.split('-')[2]) });
  }
  let next = placeChunks(thumbs, colX, nRows, out);
  next = placeChunks(extra, colX, next, out);
  return { rows: next, cols: colX.length, keys: out };
}

/** Macierz prawej połówki: te same rzędy, kolumny liczone od lewej patrząc z góry. */
export function mirrorMatrix(m: Matrix): Matrix {
  return { ...m, keys: m.keys.map((k) => ({ ...k, x: -k.x, rot: -k.rot, col: m.cols - 1 - k.col })) };
}

// ---------------------------------------------------------------- kontrolery

export type PinKind = 'gpio' | 'gnd' | 'vcc' | 'bat' | 'raw' | 'rst';

export interface PinDef {
  /** identyfikator w przypisaniu i w firmware */
  id: string;
  /** napis na płytce (i ewentualnie drugi, np. klonu) */
  label: string;
  kind: PinKind;
  /** odwołanie w firmware (ZMK `&pro_micro 4`, QMK `D4`, KMK `board.IO4`) */
  fw?: string;
  /** krótka uwaga, gdy pinu lepiej nie używać */
  avoid?: { pl: string; en: string };
}

export type Firmware = 'zmk' | 'qmk' | 'kmk';

/**
 * Element na wierzchu płytki, rysowany dla orientacji (żeby było widać, że to strona elementów).
 * x od osi płytki (mm), fy: położenie wzdłuż płytki od krawędzi z USB (0) do drugiego końca (1).
 */
export interface BoardPart {
  kind: 'chip' | 'can' | 'button' | 'led';
  x: number;
  fy: number;
  w: number;
  h: number;
  rot?: number;
  label?: string;
}

export interface ControllerPins {
  name: string;
  /** scalak, moduł, przyciski: tylko do rysunku */
  parts?: BoardPart[];
  firmware: Firmware;
  wireless: boolean;
  /** listwy w kolejności od USB (lewa i prawa patrząc od strony elementów) i piny dodatkowe */
  left: PinDef[];
  right: PinDef[];
  /** płytki z podwójnymi listwami (S2 mini): wewnętrzne rzędy pinów, w tej samej kolejności co zewnętrzne */
  leftInner?: PinDef[];
  rightInner?: PinDef[];
  extra: PinDef[];
  /** gdzie jest USB na rysunku */
  usb: 'top' | 'bottom';
  /** czy rysować listwy (gdy kolejność pinów na płytce jest pewna) */
  drawn: boolean;
  rowPref: string[];
  colPref: string[];
  i2c: [string, string];
  /** enkoder A, B, wciśnięcie, mikrostyki CON, BAK */
  modulePref: string[];
  /** pin linii danych między połówkami (split na kablu TRRS) */
  splitPin?: string;
  note?: { pl: string; en: string };
}

const G = (id: string, label: string, fw: string, avoid?: PinDef['avoid']): PinDef => ({ id, label, kind: 'gpio', fw, avoid });
const P = (kind: PinKind, label: string): PinDef => ({ id: `${kind}:${label}`, label, kind });

const nn = (d: number, p: string) => G(`D${d}`, `D${d} · ${p.replace(/^P(\d)\.(\d\d)$/, '$1$2')}`, `&pro_micro ${d}`);
const NICENANO: ControllerPins = {
  name: 'nice!nano v2',
  firmware: 'zmk',
  wireless: true,
  usb: 'top',
  drawn: true,
  left: [nn(1, 'P0.06'), nn(0, 'P0.08'), P('gnd', 'GND'), P('gnd', 'GND'), nn(2, 'P0.17'), nn(3, 'P0.20'), nn(4, 'P0.22'), nn(5, 'P0.24'), nn(6, 'P1.00'), nn(7, 'P0.11'), nn(8, 'P1.04'), nn(9, 'P1.06')],
  right: [P('bat', 'B+'), P('gnd', 'GND'), P('rst', 'RST'), P('vcc', 'VCC'), nn(21, 'P0.31'), nn(20, 'P0.29'), nn(19, 'P0.02'), nn(18, 'P1.15'), nn(15, 'P1.13'), nn(14, 'P1.11'), nn(16, 'P0.10'), nn(10, 'P0.09')],
  extra: [G('P1.01', 'P1.01 · 101', '&gpio1 1'), G('P1.02', 'P1.02 · 102', '&gpio1 2'), G('P1.07', 'P1.07 · 107', '&gpio1 7')],
  parts: [{ kind: 'chip', x: 0, fy: 0.58, w: 6, h: 6, rot: 45, label: 'nRF52840' }],
  rowPref: ['D4', 'D5', 'D6', 'D7', 'D8', 'D9'],
  colPref: ['D21', 'D20', 'D19', 'D18', 'D15', 'D14', 'D16', 'D10'],
  i2c: ['D2', 'D3'],
  modulePref: ['D1', 'D0', 'D9', 'D16', 'D10'],
  note: {
    pl: 'Klon „ProMicro NRF52840” ma te same piny opisane numerem pinu procesora (np. 022 = D4) oraz osobne piny B+ i B− przy USB. W ZMK buduj go jako nice_nano_v2.',
    en: 'The “ProMicro NRF52840” clone has the same pins labelled with the MCU pin number (e.g. 022 = D4) and separate B+ / B− pins next to USB. Build ZMK for nice_nano_v2.',
  },
};

const pm = (silk: string, port: string) => G(port, `${silk} · ${port}`, port);
const PROMICRO = (name: string): ControllerPins => ({
  name,
  firmware: 'qmk',
  wireless: false,
  usb: 'top',
  drawn: true,
  left: [pm('TX0', 'D3'), pm('RX1', 'D2'), P('gnd', 'GND'), P('gnd', 'GND'), pm('2', 'D1'), pm('3', 'D0'), pm('4', 'D4'), pm('5', 'C6'), pm('6', 'D7'), pm('7', 'E6'), pm('8', 'B4'), pm('9', 'B5')],
  right: [P('raw', 'RAW'), P('gnd', 'GND'), P('rst', 'RST'), P('vcc', 'VCC'), pm('A3', 'F4'), pm('A2', 'F5'), pm('A1', 'F6'), pm('A0', 'F7'), pm('15', 'B1'), pm('14', 'B3'), pm('16', 'B2'), pm('10', 'B6')],
  extra: [],
  parts: [{ kind: 'chip', x: 0, fy: 0.55, w: 6, h: 6, rot: 45, label: 'ATmega32U4' }],
  rowPref: ['D4', 'C6', 'D7', 'E6', 'B4', 'B5'],
  colPref: ['F4', 'F5', 'F6', 'F7', 'B1', 'B3', 'B2', 'B6'],
  i2c: ['D1', 'D0'],
  modulePref: ['D3', 'B6', 'B2', 'B3', 'B1'],
  splitPin: 'D2',
});

const kb = (silk: string, gp: number) => G(`GP${gp}`, `${silk} · GP${gp}`, `GP${gp}`);
const KB2040: ControllerPins = {
  name: 'Adafruit KB2040',
  firmware: 'qmk',
  wireless: false,
  usb: 'top',
  drawn: true,
  left: [kb('D0', 0), kb('D1', 1), P('gnd', 'GND'), P('gnd', 'GND'), kb('D2', 2), kb('D3', 3), kb('D4', 4), kb('D5', 5), kb('D6', 6), kb('D7', 7), kb('D8', 8), kb('D9', 9)],
  right: [P('raw', 'RAW'), P('gnd', 'GND'), P('rst', 'RST'), P('vcc', '3V'), kb('A3', 29), kb('A2', 28), kb('A1', 27), kb('A0', 26), kb('SCK', 18), kb('MI', 20), kb('MO', 19), kb('D10', 10)],
  extra: [],
  parts: [{ kind: 'chip', x: 0, fy: 0.55, w: 6, h: 6, rot: 45, label: 'RP2040' }],
  rowPref: ['GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9'],
  colPref: ['GP29', 'GP28', 'GP27', 'GP26', 'GP18', 'GP20', 'GP19', 'GP10'],
  i2c: ['GP2', 'GP3'],
  modulePref: ['GP0', 'GP10', 'GP19', 'GP20', 'GP18'],
  splitPin: 'GP1',
};

const io = (n: number, avoid?: PinDef['avoid'], silk = `IO${n}`) => G(`IO${n}`, silk, `board.IO${n}`, avoid);
const STRAP = { pl: 'pin startowy', en: 'strapping pin' };
const ESP32S3: ControllerPins = {
  name: 'ESP32-S3 DevKit',
  firmware: 'kmk',
  wireless: false,
  usb: 'bottom',
  drawn: true,
  left: [P('vcc', '3V3'), P('vcc', '3V3'), P('rst', 'RST'), io(4), io(5), io(6), io(7), io(15), io(16), io(17), io(18), io(8), io(3, STRAP), io(46, STRAP), io(9), io(10), io(11), io(12), io(13), io(14), P('raw', '5V'), P('gnd', 'GND')],
  right: [
    P('gnd', 'GND'), io(43, undefined, 'TX · IO43'), io(44, undefined, 'RX · IO44'), io(1), io(2), io(42), io(41), io(40), io(39),
    io(38, { pl: 'dioda RGB', en: 'RGB LED' }), io(37, { pl: 'PSRAM', en: 'PSRAM' }), io(36, { pl: 'PSRAM', en: 'PSRAM' }), io(35, { pl: 'PSRAM', en: 'PSRAM' }),
    io(0, undefined, 'IO0 · BOOT'), io(45, STRAP), io(48, { pl: 'dioda RGB', en: 'RGB LED' }), io(47), io(21), io(20, { pl: 'USB D+', en: 'USB D+' }), io(19, { pl: 'USB D−', en: 'USB D−' }), P('gnd', 'GND'), P('gnd', 'GND'),
  ],
  extra: [],
  parts: [{ kind: 'can', x: 0, fy: 0.7, w: 18, h: 17.6, label: 'ESP32-S3-WROOM' }],
  rowPref: ['IO4', 'IO5', 'IO6', 'IO7', 'IO15', 'IO1', 'IO2'],
  colPref: ['IO16', 'IO17', 'IO18', 'IO8', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13', 'IO14', 'IO21', 'IO47', 'IO1', 'IO2', 'IO39', 'IO40'],
  i2c: ['IO41', 'IO42'],
  modulePref: ['IO39', 'IO40', 'IO0', 'IO43', 'IO44'],
  splitPin: 'IO43',
  note: {
    pl: 'Klon z dwoma USB-C może mieć inną kolejność pinów niż oryginał Espressif: lutuj według numerów IO na płytce. Klawiatura działa przez port natywny „USB”. ZMK oficjalnie nie obsługuje ESP32-S3, dlatego fragment jest dla KMK (CircuitPython).',
    en: 'The 2×USB-C clone may order pins differently from the Espressif original: solder by the IO numbers printed on the board. The keyboard uses the native “USB” port. ZMK does not officially support ESP32-S3, so the snippet is for KMK (CircuitPython).',
  },
};

// Wemos S2 mini v1.0.0: dwie podwójne listwy, kolejność od anteny do USB (pinout oprosthetics.org, v1 rev 5).
const S2MINI: ControllerPins = {
  name: 'Wemos S2 mini',
  firmware: 'kmk',
  wireless: false,
  usb: 'bottom',
  drawn: true,
  left: [P('rst', 'EN'), io(3), io(5), io(7), io(9), io(11), io(12), P('vcc', '3V3')],
  leftInner: [io(1), io(2), io(4), io(6), io(8), io(10), io(13), io(14)],
  right: [io(39), io(37), io(35), io(33), io(18), io(16), P('gnd', 'GND'), P('raw', 'VBUS')],
  rightInner: [io(40), io(38), io(36), io(34), io(21), io(17), P('gnd', 'GND'), io(15, { pl: 'dioda LED', en: 'LED' })],
  extra: [],
  // rzędy na lewej zewnętrznej listwie, kolumny na lewej wewnętrznej i prawej wewnętrznej, moduł na prawej zewnętrznej
  parts: [
    { kind: 'chip', x: 0, fy: 0.6, w: 7, h: 7, label: 'ESP32-S2' },
    { kind: 'button', x: -8.3, fy: 0.08, w: 3, h: 4.4, label: 'RST' },
    { kind: 'button', x: 8.3, fy: 0.08, w: 3, h: 4.4, label: '0' },
    { kind: 'led', x: 5.2, fy: 0.05, w: 1, h: 1.6, label: '15' },
  ],
  rowPref: ['IO3', 'IO5', 'IO7', 'IO9', 'IO11', 'IO12'],
  colPref: ['IO1', 'IO2', 'IO4', 'IO6', 'IO8', 'IO10', 'IO13', 'IO14', 'IO40', 'IO38', 'IO36', 'IO34', 'IO21', 'IO17'],
  i2c: ['IO39', 'IO37'],
  modulePref: ['IO35', 'IO33', 'IO18', 'IO21', 'IO17'],
  splitPin: 'IO16',
  note: {
    pl: 'Płytka ma po dwie listwy z każdej strony (zewnętrzną i wewnętrzną). Nie używamy IO15 (dioda LED na płytce); IO0 to przycisk BOOT i nie wychodzi na listwę. Wgrywanie: przytrzymaj przycisk 0, naciśnij RST, puść 0.',
    en: 'The board has two headers on each side (outer and inner). IO15 is not used (on-board LED); IO0 is the BOOT button and is not on a header. Flashing: hold button 0, press RST, release 0.',
  },
};

export const CONTROLLER_PINS: Record<ControllerId, ControllerPins> = {
  nicenano: NICENANO,
  'promicro-c': PROMICRO('Pro Micro USB-C'),
  'promicro-micro': PROMICRO('Pro Micro micro-USB'),
  kb2040: KB2040,
  s2mini: S2MINI,
  esp32s3: ESP32S3,
};

/** Kontroler bez znanych pinów (własny model): piny opisane tylko rolą. */
export function genericPins(name: string, count = 40): ControllerPins {
  const left = Array.from({ length: count }, (_, i) => G(`GPIO${i + 1}`, `GPIO ?${i + 1}`, `GPIO${i + 1}`));
  const ids = left.map((p) => p.id);
  return {
    name,
    firmware: 'qmk',
    wireless: false,
    usb: 'top',
    drawn: false,
    left,
    right: [],
    extra: [],
    rowPref: ids.slice(0, 8),
    colPref: ids.slice(8, 30),
    i2c: [ids[30], ids[31]],
    modulePref: ids.slice(32, 37),
    splitPin: ids[37],
  };
}

export type Role =
  | { kind: 'row'; n: number }
  | { kind: 'col'; n: number }
  | { kind: 'sda' }
  | { kind: 'scl' }
  | { kind: 'encA' }
  | { kind: 'encB' }
  | { kind: 'push' }
  | { kind: 'con' }
  | { kind: 'bak' }
  | { kind: 'split' };

export interface Assignment {
  rows: PinDef[];
  cols: PinDef[];
  /** piny modułu OLED + EC11 (tylko gdy moduł jest na tej połówce i starczyło pinów) */
  module: Partial<Record<'sda' | 'scl' | 'encA' | 'encB' | 'push' | 'con' | 'bak', PinDef>>;
  split?: PinDef;
  /** role, dla których zabrakło pinu */
  missing: Role[];
  byPin: Map<string, Role>;
}

const allPins = (c: ControllerPins) => [...c.left, ...(c.leftInner ?? []), ...c.right, ...(c.rightInner ?? []), ...c.extra];

/**
 * Przypisuje piny: najpierw I2C modułu i enkoder, potem linia między połówkami, rzędy, kolumny,
 * a na końcu przyciski modułu (gdy zabraknie pinów, przyciski odpadają pierwsze).
 */
export function assignPins(c: ControllerPins, m: Matrix, opts: { module: boolean; split: boolean }): Assignment {
  const gpio = allPins(c).filter((p) => p.kind === 'gpio');
  const byId = new Map(gpio.map((p) => [p.id, p]));
  const used = new Set<string>();
  const usable = gpio.filter((p) => !p.avoid);
  const take = (pref: string[]): PinDef | undefined => {
    for (const id of pref) {
      const p = byId.get(id);
      if (p && !p.avoid && !used.has(id)) {
        used.add(id);
        return p;
      }
    }
    const p = usable.find((q) => !used.has(q.id));
    if (p) used.add(p.id);
    return p;
  };
  const missing: Role[] = [];
  const byPin = new Map<string, Role>();
  const a: Assignment = { rows: [], cols: [], module: {}, missing, byPin };
  const free = () => usable.filter((p) => !used.has(p.id)).length;
  const matrixNeed = m.rows + m.cols + (opts.split && !c.wireless && c.splitPin ? 1 : 0);
  // I2C ekranu i enkoder tylko wtedy, gdy macierz nadal się zmieści
  if (opts.module && free() >= matrixNeed + 4) {
    for (const [k, id] of [
      ['sda', c.i2c[0]],
      ['scl', c.i2c[1]],
    ] as const) {
      const p = take([id]);
      if (p) a.module[k] = p;
    }
    for (const [k, id] of [
      ['encA', c.modulePref[0]],
      ['encB', c.modulePref[1]],
    ] as const) {
      const p = take([id]);
      if (p) a.module[k] = p;
    }
  } else if (opts.module) missing.push({ kind: 'sda' }, { kind: 'scl' }, { kind: 'encA' }, { kind: 'encB' });
  if (opts.split && !c.wireless && c.splitPin) {
    a.split = take([c.splitPin]);
    if (!a.split) missing.push({ kind: 'split' });
  }
  for (let r = 0; r < m.rows; r++) {
    const p = take(c.rowPref);
    if (p) a.rows.push(p);
    else missing.push({ kind: 'row', n: r });
  }
  for (let k = 0; k < m.cols; k++) {
    const p = take(c.colPref);
    if (p) a.cols.push(p);
    else missing.push({ kind: 'col', n: k });
  }
  if (opts.module && a.module.sda) {
    for (const [k, i] of [
      ['push', 2],
      ['con', 3],
      ['bak', 4],
    ] as const) {
      const p = take([c.modulePref[i]]);
      if (p) a.module[k] = p;
      else missing.push({ kind: k });
    }
  }
  a.rows.forEach((p, n) => byPin.set(p.id, { kind: 'row', n }));
  a.cols.forEach((p, n) => byPin.set(p.id, { kind: 'col', n }));
  for (const [k, p] of Object.entries(a.module)) byPin.set(p.id, { kind: k } as Role);
  if (a.split) byPin.set(a.split.id, { kind: 'split' });
  return a;
}
