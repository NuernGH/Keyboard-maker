// SPDX-License-Identifier: AGPL-3.0-or-later
// Instrukcja okablowania jako samodzielny dokument HTML z rysunkami SVG: zasada diody,
// macierz z góry, druty od spodu (tak się lutuje), piny kontrolera, fragment firmware.

import { PITCH, splitLeft, switchSpots, type SplitParams } from './layout';
import {
  CONTROLLER_PINS,
  SWITCH_PINS,
  assignPins,
  genericPins,
  matrixOf,
  mirrorMatrix,
  placeRow,
  type Assignment,
  type ControllerPins,
  type Matrix,
  type PinDef,
  type Role,
  type WKey,
} from './wiring';
import { islandFor, type ControllerId, type IslandParams } from './island';
import type { CellVariant } from './cell-spec';
import { apply, applyDir, type DactylModel } from './dactyl';

export type DocLang = 'pl' | 'en';
type Rect = { x0: number; y0: number; x1: number; y1: number };

export interface WiringHalf {
  side: 'left' | 'right' | 'single';
  matrix: Matrix;
  /** wyspa z kontrolerem (ten sam układ współrzędnych co klawisze) */
  island?: Rect | null;
  /** moduł OLED + EC11 na tej połówce */
  module: boolean;
}

export interface WiringInput {
  lang: DocLang;
  /** nazwa układu, np. „Split 4×6 + 4 kciukowe” */
  layout: string;
  halves: WiringHalf[];
  ctrl: ControllerPins;
  stabs: 'cherry' | 'mx' | 'none';
  hotswap: boolean;
  /** kontroler odwrócony w wyspie (domyślnie w generatorze) */
  flipped: boolean;
  /** Dactyl: lewa połówka to lustro całej bryły */
  dactyl?: boolean;
}

const ROWC = ['#1f6fd1', '#0e9aa7', '#6a3fc1', '#c2185b', '#2e7d32', '#8d6e00', '#d84315', '#455a64'];
const COLC = '#e07b00';
const MOD = '#2e7d32';
const rowColor = (r: number) => ROWC[r % ROWC.length];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (v: number) => (Math.round(v * 100) / 100).toString();

const TXT = {
  pl: {
    title: 'Instrukcja okablowania',
    intro: 'Ręczne okablowanie (handwire): każdy przełącznik ma własną diodę, przełączniki łączą się w rzędy i kolumny, a rzędy i kolumny idą do pinów kontrolera.',
    rules: 'Zasada: jeden przełącznik, jedna dioda',
    rulesList: [
      '<b>Pin 1</b> przełącznika (niżej, bliżej środka) idzie do <b>kolumny</b>. <b>Pin 2</b> (wyżej, przy górnej krawędzi) idzie przez <b>diodę</b> do <b>rzędu</b>.',
      'Kierunek diody <b>COL2ROW</b>: czarna kreska (katoda) od strony <b>rzędu</b>, goły koniec (anoda) do pinu 2.',
      'Dioda <b>1N4148</b> (przewlekana DO-35) albo pod gniazdami hot-swap SMD 1N4148W (SOD-123). Kreska zawsze do rzędu.',
      'Lutujesz od spodu, a od spodu wszystko jest <b>w lustrze</b>. Rysunki „od spodu” są już odbite.',
      '<b>Rzędy</b>: goły drut albo połączone nóżki diod, poziomo przy górnej krawędzi klawiszy. <b>Kolumny</b>: drut <b>w izolacji</b> (26–28 AWG lub nawojowy), bo przy każdym klawiszu krzyżują się z rzędem.',
      'Do kontrolera: cienka linka silikonowa 28–30 AWG, z zapasem 2–3 cm.',
    ],
    hotswap: 'Hot-swap: gniazda Kailh w kieszeniach komórek, lutujesz do ich padów (pad przy pinie 1 = kolumna, pad przy pinie 2 = dioda).',
    noHotswap: 'Bez hot-swap: najpierw wciśnij przełączniki w płytę, potem lutuj bezpośrednio do ich nóżek.',
    mx: 'Klawisze z kilkoma przełącznikami zamiast stabilizatora: przełączniki jednego klawisza łączysz <b>równolegle</b> (pin 1 z pinem 1, pin 2 z pinem 2), jedna dioda na klawisz. Na rysunku przerywana linia.',
    steps: 'Kolejność pracy',
    stepsList: [
      'Diody: anoda do pinu 2 (padu) każdego klawisza, katodę zegnij w stronę rzędu.',
      'Rzędy: połącz katody klawiszy jednego rzędu.',
      'Kolumny: drut w izolacji przez pin 1 (pad) wszystkich klawiszy kolumny; izolację zdejmij tylko w miejscu lutowania.',
      'Test multimetrem (tryb diody), jeszcze bez kontrolera: czerwona sonda na kolumnę, czarna na rząd, wciśnij klawisz: ok. 0,5–0,7 V. Bez wciśnięcia nic nie przewodzi.',
      'Linki do kontrolera według tabeli pinów.',
      'Wgraj firmware i sprawdź każdy klawisz.',
    ],
    matrix: 'Macierz z góry',
    matrixNote: (r: number, c: number, split: boolean) =>
      `Macierz ${r} × ${c}${split ? ' na połówkę' : ''}. K0 jest zawsze po lewej patrząc z góry${split ? ', także na prawej połówce (w firmware prawa ma przesunięcie kolumn)' : ''}. Klawisze kciuka i dodatkowe mają własny rząd pod głównymi.`,
    bottom: 'Od spodu (tak lutujesz)',
    left: 'Lewa połówka',
    right: 'Prawa połówka',
    single: 'Płyta',
    legend: 'Pomarańczowe pionowe = kolumny K (w izolacji), kolorowe poziome = rzędy R. Dioda: pomarańczowe szkło, czarna kreska przy rzędzie.',
    pins: 'Piny kontrolera',
    signal: 'Sygnał',
    pin: 'Pin (napis na płytce)',
    fw: 'W firmware',
    rows: 'Rzędy',
    cols: 'Kolumny',
    module: 'Moduł OLED 1,3" + EC11',
    sda: 'OLED SDA',
    scl: 'OLED SCL',
    encA: 'enkoder A (TRA)',
    encB: 'enkoder B (TRB)',
    push: 'PUSH (wciśnięcie)',
    con: 'CON (mikrostyk)',
    bak: 'BAK (mikrostyk)',
    split: 'dane między połówkami (TRRS)',
    power: 'Zasilanie modułu: VCC do 3,3 V kontrolera, GND do GND. Nazwy pinów modułu sprawdź na swoim egzemplarzu.',
    moduleNote: 'Wspólny styk enkodera i przycisków jest na module połączony z GND, dlatego te przyciski idą wprost do pinów, bez diod.',
    battery: 'Bateria: plus przez wyłącznik do B+, minus do GND (B−).',
    trrs: 'Połówki łączy kabel TRRS: VCC, GND i linia danych. Generator nie robi jeszcze otworu na gniazdo TRRS.',
    flipped: 'Kontroler leży w wyspie odwrócony: lutuj według napisów na płytce, nie według położenia z rysunku (rysunek jest od strony elementów).',
    missing: 'Za mało pinów, brak przypisania dla',
    notDrawn: 'Kolejność pinów na listwach tej płytki nie jest pewna, więc jest tylko tabela. Lutuj według numerów GPIO na płytce.',
    custom: 'Własny kontroler: generator nie zna jego pinów. Poniżej role i liczba potrzebnych pinów; dobierz piny według dokumentacji płytki.',
    firmware: 'Firmware',
    dactyl: 'Dactyl: rysunek to rzut z góry zakrzywionej bryły. Klawisze stoją pod różnymi kątami, więc druty prowadź luźno, z małymi pętlami.',
    pinFree: 'wolne',
    avoid: 'nie używać',
    view: 'widok od strony elementów',
    generated: 'Wygenerowano w Keyboard maker',
  },
  en: {
    title: 'Wiring guide',
    intro: 'Handwiring: every switch gets its own diode, switches are joined into rows and columns, and rows and columns go to controller pins.',
    rules: 'Rule: one switch, one diode',
    rulesList: [
      'Switch <b>pin 1</b> (lower, nearer the centre) goes to the <b>column</b>. <b>Pin 2</b> (higher, near the top edge) goes through the <b>diode</b> to the <b>row</b>.',
      'Diode direction <b>COL2ROW</b>: the black band (cathode) faces the <b>row</b>, the bare end (anode) goes to pin 2.',
      '<b>1N4148</b> diode (through-hole DO-35) or SMD 1N4148W (SOD-123) under hot-swap sockets. Band always to the row.',
      'You solder from below, and from below everything is <b>mirrored</b>. The “from below” drawings are already mirrored.',
      '<b>Rows</b>: bare wire or joined diode legs, horizontal along the top edge of the keys. <b>Columns</b>: <b>insulated</b> wire (26–28 AWG or enamelled), because they cross a row at every key.',
      'To the controller: thin silicone wire 28–30 AWG, 2–3 cm spare.',
    ],
    hotswap: 'Hot-swap: Kailh sockets sit in the cell pockets; solder to their pads (pad at pin 1 = column, pad at pin 2 = diode).',
    noHotswap: 'No hot-swap: press the switches into the plate first, then solder directly to their legs.',
    mx: 'Keys with several switches instead of a stabilizer: wire the switches of one key in <b>parallel</b> (pin 1 to pin 1, pin 2 to pin 2), one diode per key. Dashed line in the drawing.',
    steps: 'Order of work',
    stepsList: [
      'Diodes: anode to pin 2 (pad) of each key, bend the cathode towards the row.',
      'Rows: join the cathodes of one row.',
      'Columns: insulated wire through pin 1 (pad) of every key in the column; strip only where you solder.',
      'Multimeter test (diode mode), before the controller: red probe on the column, black on the row, press the key: about 0.5–0.7 V. Nothing conducts when released.',
      'Wires to the controller as in the pin table.',
      'Flash the firmware and test every key.',
    ],
    matrix: 'Matrix from above',
    matrixNote: (r: number, c: number, split: boolean) =>
      `Matrix ${r} × ${c}${split ? ' per half' : ''}. K0 is always on the left seen from above${split ? ', also on the right half (the firmware offsets its columns)' : ''}. Thumb and extra keys get their own row below the main ones.`,
    bottom: 'From below (as you solder)',
    left: 'Left half',
    right: 'Right half',
    single: 'Plate',
    legend: 'Orange vertical = columns K (insulated), coloured horizontal = rows R. Diode: orange glass, black band at the row.',
    pins: 'Controller pins',
    signal: 'Signal',
    pin: 'Pin (board label)',
    fw: 'In firmware',
    rows: 'Rows',
    cols: 'Columns',
    module: '1.3" OLED + EC11 module',
    sda: 'OLED SDA',
    scl: 'OLED SCL',
    encA: 'encoder A (TRA)',
    encB: 'encoder B (TRB)',
    push: 'PUSH (press)',
    con: 'CON (micro switch)',
    bak: 'BAK (micro switch)',
    split: 'data between halves (TRRS)',
    power: 'Module power: VCC to the controller 3.3 V, GND to GND. Check the module pin names on your board.',
    moduleNote: 'The common contact of the encoder and buttons is tied to GND on the module, so these buttons go straight to pins, without diodes.',
    battery: 'Battery: plus through a switch to B+, minus to GND (B−).',
    trrs: 'The halves are joined by a TRRS cable: VCC, GND and the data line. The generator does not cut a TRRS jack hole yet.',
    flipped: 'The controller sits upside down in the island: solder by the labels on the board, not by the position in the drawing (drawn from the component side).',
    missing: 'Not enough pins, unassigned',
    notDrawn: 'The header order of this board is not certain, so there is only a table. Solder by the GPIO numbers on the board.',
    custom: 'Custom controller: the generator does not know its pins. Below are the roles and the pin count; pick pins from the board documentation.',
    firmware: 'Firmware',
    dactyl: 'Dactyl: the drawing is a top projection of the curved shell. Keys sit at different angles, so route wires loosely with small loops.',
    pinFree: 'free',
    avoid: 'do not use',
    view: 'component side view',
    generated: 'Generated with Keyboard maker',
  },
};
type T = (typeof TXT)['pl'];

export function roleName(t: T, r: Role): string {
  switch (r.kind) {
    case 'row':
      return `R${r.n}`;
    case 'col':
      return `K${r.n}`;
    default:
      return t[r.kind];
  }
}
const roleColor = (r: Role) => (r.kind === 'row' ? rowColor(r.n) : r.kind === 'col' ? COLC : r.kind === 'split' ? '#b00' : MOD);

// ---------------------------------------------------------------- geometria rysunku

const rot = (x: number, y: number, d: number): [number, number] => {
  const a = (d * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};

/** Punkt w układzie klawisza (lokalnie, widok z góry) → współrzędne SVG (y w dół), od spodu lustro. */
function at(k: { x: number; y: number; rot: number }, lx: number, ly: number, bottom: boolean, dx = 0): [number, number] {
  const [x, y] = rot(lx, ly, k.rot);
  const X = k.x + x + dx;
  return [bottom ? -X : X, -(k.y + y)];
}

function keyPoly(k: WKey, bottom: boolean, dx = 0, inset = 0) {
  const hw = (k.w * PITCH) / 2 - inset;
  const hh = (k.h * PITCH) / 2 - inset;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]
    .map(([x, y]) => at(k, x, y, bottom, dx).map(f).join(','))
    .join(' ');
}

class Box {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  add(x: number, y: number) {
    this.x0 = Math.min(this.x0, x);
    this.y0 = Math.min(this.y0, y);
    this.x1 = Math.max(this.x1, x);
    this.y1 = Math.max(this.y1, y);
  }
  view(m: [number, number, number, number]) {
    return `${f(this.x0 - m[3])} ${f(this.y0 - m[0])} ${f(this.x1 - this.x0 + m[1] + m[3])} ${f(this.y1 - this.y0 + m[0] + m[2])}`;
  }
}

function svg(viewBox: string, body: string, maxW = 900): string {
  const [, , w, h] = viewBox.split(' ').map(Number);
  const width = maxW;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${f(width)}" height="${f((width * h) / w)}" font-family="system-ui, sans-serif">${body}</svg>`;
}

function diode(a: [number, number], c: [number, number], w = 1.6): string {
  const p = (t: number) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t].map(f).join(' ');
  return (
    `<path d="M${p(0)} L${p(1)}" stroke="#777" stroke-width="0.3"/>` +
    `<path d="M${p(0.2)} L${p(0.72)}" stroke="#f0a040" stroke-width="${w}"/>` +
    `<path d="M${p(0.72)} L${p(0.86)}" stroke="#111" stroke-width="${w}"/>`
  );
}

/** Rysunek jednego przełącznika: z góry, od spodu i schemat COL2ROW. */
export function switchSvg(lang: DocLang): string {
  const t = lang === 'pl' ? { top: 'Z góry', bot: 'Od spodu', c: 'kolumna', r: 'rząd', d: 'dioda', up: '↑ górny rząd' } : { top: 'From above', bot: 'From below', c: 'column', r: 'row', d: 'diode', up: '↑ top row' };
  const k = { x: 0, y: 0, rot: 0 };
  let body = '';
  ([false, true] as const).forEach((bottom, i) => {
    const dx = i * 34;
    const g = (lx: number, ly: number) => {
      const [x, y] = at(k, lx, ly, bottom);
      return [x + dx, y] as [number, number];
    };
    body += `<rect x="${dx - 9.5}" y="-9.5" width="19" height="19" fill="#eef1f5" stroke="#9aa4b1" stroke-width="0.3"/>`;
    body += `<rect x="${dx - 7}" y="-7" width="14" height="14" fill="#fff" stroke="#c7cdd6" stroke-width="0.2"/>`;
    body += `<circle cx="${dx}" cy="0" r="2" fill="none" stroke="#888" stroke-width="0.2"/>`;
    const cp = g(...SWITCH_PINS.col);
    const dp = g(...SWITCH_PINS.diode);
    if (bottom) {
      for (const pad of [SWITCH_PINS.colPad, SWITCH_PINS.diodePad]) {
        const [x, y] = g(...pad);
        body += `<rect x="${f(x - 1.3)}" y="${f(y - 1.3)}" width="2.6" height="2.6" fill="#d9b25b" stroke="#7a5c12" stroke-width="0.15"/>`;
      }
    }
    body += `<circle cx="${f(cp[0])}" cy="${f(cp[1])}" r="1.45" fill="${COLC}" stroke="#333" stroke-width="0.15"/>`;
    body += `<circle cx="${f(dp[0])}" cy="${f(dp[1])}" r="1.45" fill="#ccc" stroke="#333" stroke-width="0.15"/>`;
    body += `<path d="M${f(cp[0])} ${f(cp[1] + 1.5)} L${f(cp[0])} 10.5" stroke="#8a4b00" stroke-width="0.2"/>`;
    body += `<text x="${f(cp[0])}" y="12.5" font-size="1.7" text-anchor="middle" fill="#8a4b00">1 → ${t.c}</text>`;
    body += `<path d="M${f(dp[0])} ${f(dp[1] - 1.5)} L${f(dp[0])} -10.5" stroke="#1f6fd1" stroke-width="0.2"/>`;
    body += `<text x="${f(dp[0])}" y="-11.3" font-size="1.7" text-anchor="middle" fill="#1f6fd1">2 → ${t.d} → ${t.r}</text>`;
    body += `<text x="${dx}" y="-17" font-size="2.4" font-weight="bold" text-anchor="middle">${bottom ? t.bot : t.top}</text>`;
    body += `<text x="${dx}" y="-14.2" font-size="1.5" text-anchor="middle" fill="#666">${t.up}</text>`;
  });
  // schemat
  const x0 = 62;
  body += `<path d="M${x0} -10 V10" stroke="${COLC}" stroke-width="0.9"/><text x="${x0}" y="-11" font-size="2" text-anchor="middle" fill="#8a4b00" font-weight="bold">${t.c.toUpperCase()}</text>`;
  body += `<path d="M${x0 - 3} 8 H${x0 + 22}" stroke="#1f6fd1" stroke-width="0.9"/><text x="${x0 + 22}" y="11" font-size="2" text-anchor="end" fill="#1f6fd1" font-weight="bold">${t.r.toUpperCase()}</text>`;
  body += `<path d="M${x0} -5 H${x0 + 5}" stroke="#000" stroke-width="0.3"/><rect x="${x0 + 5}" y="-6.5" width="4" height="3" fill="#fff" stroke="#000" stroke-width="0.3"/>`;
  body += `<path d="M${x0 + 9} -5 H${x0 + 14} V-2" stroke="#000" stroke-width="0.3"/>`;
  body += `<path d="M${x0 + 12.8} -2 H${x0 + 15.2} L${x0 + 14} 0.4 Z" fill="#000"/><path d="M${x0 + 12.7} 0.5 H${x0 + 15.3}" stroke="#000" stroke-width="0.6"/>`;
  body += `<path d="M${x0 + 14} 0.5 V8" stroke="#000" stroke-width="0.3"/><circle cx="${x0 + 14}" cy="8" r="0.5"/><circle cx="${x0}" cy="-5" r="0.5"/>`;
  body += `<text x="${x0 + 16}" y="-0.5" font-size="1.8">1N4148</text>`;
  body += diode([x0 + 2, 4], [x0 + 12, 4], 2.2);
  body += `<text x="${x0 + 10.8}" y="2" font-size="1.6" text-anchor="middle">${lang === 'pl' ? 'kreska' : 'band'}</text>`;
  return svg('-16 -20 104 35', body, 820);
}

/** Macierz z góry: wszystkie połówki obok siebie, klawisze opisane R/K (prawa z przesunięciem kolumn). */
export function topSvg(halves: WiringHalf[], t: T): string {
  const box = new Box();
  let body = '';
  let dx = 0;
  let prevRight = 0;
  const split = halves.length > 1;
  halves.forEach((h, i) => {
    const ks = h.matrix.keys;
    if (i > 0) dx = prevRight - Math.min(...ks.map((k) => k.x)) + 2.5 * PITCH;
    prevRight = Math.max(...ks.map((k) => k.x)) + dx;
    const off = split && h.side === 'right' ? h.matrix.cols : 0;
    for (const k of ks) {
      body += `<polygon points="${keyPoly(k, false, dx)}" fill="${rowColor(k.row)}" fill-opacity="0.2" stroke="#555" stroke-width="0.3"/>`;
      const [x, y] = at(k, 0, 0, false, dx);
      body += `<text x="${f(x)}" y="${f(y - 0.8)}" font-size="3.4" text-anchor="middle">R${k.row}</text><text x="${f(x)}" y="${f(y + 3.4)}" font-size="3.4" text-anchor="middle">K${k.col + off}</text>`;
      for (const [cx, cy] of [
        [-1, -1],
        [1, 1],
      ])
        box.add(...at(k, (cx * k.w * PITCH) / 2, (cy * k.h * PITCH) / 2, false, dx));
      box.add(...at(k, (-k.w * PITCH) / 2, (k.h * PITCH) / 2, false, dx));
      box.add(...at(k, (k.w * PITCH) / 2, (-k.h * PITCH) / 2, false, dx));
    }
    const lx = (Math.min(...ks.map((k) => k.x)) + Math.max(...ks.map((k) => k.x))) / 2 + dx;
    const ly = -Math.max(...ks.map((k) => k.y)) - PITCH;
    body += `<text x="${f(lx)}" y="${f(ly)}" font-size="5" font-weight="bold" text-anchor="middle">${h.side === 'left' ? t.left : h.side === 'right' ? t.right : t.single}${off ? ` (K${off}–K${off + h.matrix.cols - 1})` : ''}</text>`;
    box.add(lx, ly - 5);
  });
  return svg(box.view([4, 6, 6, 6]), body, 1000);
}

/** Druty od spodu jednej połówki: kolumny, rzędy, diody, wyspa i opisy pinów. */
export function bottomSvg(h: WiringHalf, a: Assignment, stabs: WiringInput['stabs'], t: T, ctrlName = ''): string {
  const B = true;
  const box = new Box();
  let keys = '';
  let wires = '';
  let marks = '';
  const keysArr = h.matrix.keys;
  const main = (k: WKey) => {
    // przełącznik najbliżej środka klawisza dostaje diodę
    const spots = switchSpots(k, stabs);
    const local = spots.map(([sx, sy]) => rot(sx - k.x, sy - k.y, -k.rot));
    local.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
    return local;
  };
  const sw = (k: WKey, o: [number, number], p: [number, number]) => at(k, o[0] + p[0], o[1] + p[1], B);
  for (const k of keysArr) {
    keys += `<polygon points="${keyPoly(k, B)}" fill="#eef1f5" stroke="#9aa4b1" stroke-width="0.3"/>`;
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      box.add(...at(k, (cx * k.w * PITCH) / 2, (cy * k.h * PITCH) / 2, B));
    const spots = main(k);
    spots.forEach((o) => {
      const hole = [
        [-7, -7],
        [7, -7],
        [7, 7],
        [-7, 7],
      ]
        .map(([x, y]) => sw(k, o, [x, y]).map(f).join(','))
        .join(' ');
      keys += `<polygon points="${hole}" fill="#fff" stroke="#c7cdd6" stroke-width="0.2"/>`;
    });
    // przełączniki równoległe: przerywane połączenia pinów
    for (let i = 1; i < spots.length; i++) {
      for (const pin of [SWITCH_PINS.colPad, SWITCH_PINS.diodePad]) {
        const p0 = sw(k, spots[0], pin);
        const p1 = sw(k, spots[i], pin);
        marks += `<path d="M${f(p0[0])} ${f(p0[1])} L${f(p1[0])} ${f(p1[1])}" stroke="#555" stroke-width="0.5" stroke-dasharray="1.2 0.8" fill="none"/>`;
        marks += `<circle cx="${f(p1[0])}" cy="${f(p1[1])}" r="0.9" fill="#ccc" stroke="#333" stroke-width="0.15"/>`;
      }
    }
  }
  // kolumny: opisy nad klawiszami, a gdy tam stoi wyspa, pod nimi
  const keyTop = Math.min(...keysArr.map((k) => at(k, 0, 0, B)[1]));
  const below = !!h.island && -h.island.y1 < keyTop && -h.island.y0 < keyTop + PITCH;
  const keyBottom = Math.max(...keysArr.map((k) => at(k, 0, 0, B)[1])) + PITCH / 2;
  for (let c = 0; c < h.matrix.cols; c++) {
    const ks = keysArr.filter((k) => k.col === c).sort((p, q) => q.y - p.y);
    if (!ks.length) continue;
    const pts = ks.map((k) => sw(k, main(k)[0], SWITCH_PINS.colPad));
    const lastP = pts[pts.length - 1];
    const top: [number, number] = below ? [lastP[0], keyBottom + 4] : [pts[0][0], pts[0][1] - 9];
    const line = below ? [...pts, top] : [top, ...pts];
    wires += `<polyline points="${line.map((p) => p.map(f).join(',')).join(' ')}" fill="none" stroke="${COLC}" stroke-width="0.8"/>`;
    for (const p of pts) marks += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="0.9" fill="${COLC}" stroke="#333" stroke-width="0.15"/>`;
    const pin = a.cols[c];
    const ty = below ? top[1] + 3.2 : top[1] - 4.2;
    marks += `<text x="${f(top[0])}" y="${f(ty)}" font-size="3" font-weight="bold" text-anchor="middle" fill="#8a4b00">K${c}</text>`;
    marks += `<text x="${f(top[0])}" y="${f(ty + 3.2)}" font-size="2.4" text-anchor="middle" fill="#8a4b00">${esc(pin ? pin.label.split(' · ')[0] : '?')}</text>`;
    box.add(top[0], below ? top[1] + 8 : top[1] - 7);
  }
  // wyspa: rzędy schodzą się po jej stronie
  let isl: Rect | null = null;
  if (h.island) {
    const r = h.island;
    isl = { x0: -r.x1, x1: -r.x0, y0: -r.y1, y1: -r.y0 };
    keys += `<rect x="${f(isl.x0)}" y="${f(isl.y0)}" width="${f(isl.x1 - isl.x0)}" height="${f(isl.y1 - isl.y0)}" rx="2" fill="#e6f2e6" stroke="${MOD}" stroke-width="0.4"/>`;
    keys += `<text x="${f((isl.x0 + isl.x1) / 2)}" y="${f(isl.y1 - 3)}" font-size="3.2" font-weight="bold" text-anchor="middle" fill="${MOD}">${esc(ctrlName)}</text>`;
    box.add(isl.x0, isl.y0);
    box.add(isl.x1, isl.y1);
  }
  const allX = keysArr.map((k) => at(k, 0, 0, B)[0]);
  const midX = (Math.min(...allX) + Math.max(...allX)) / 2;
  const toLeft = isl ? (isl.x0 + isl.x1) / 2 < midX : true;
  // rzędy
  for (let r = 0; r < h.matrix.rows; r++) {
    const ks = keysArr.filter((k) => k.row === r);
    if (!ks.length) continue;
    const ends = ks.map((k) => {
      const o = main(k)[0];
      const an = sw(k, o, SWITCH_PINS.diodePad);
      const ca = sw(k, o, [SWITCH_PINS.diodePad[0], 8.2]);
      marks += diode(an, ca);
      marks += `<circle cx="${f(an[0])}" cy="${f(an[1])}" r="0.9" fill="#ddd" stroke="#333" stroke-width="0.15"/>`;
      return ca;
    });
    ends.sort((p, q) => p[0] - q[0]);
    const e = toLeft ? ends[0] : ends[ends.length - 1];
    // przy wyspie drut kończy się na jej krawędzi, opis wchodzi do środka wyspy
    const inIsl = isl && e[1] > isl.y0 + 2 && e[1] < isl.y1 - 6;
    const tail: [number, number] = [inIsl ? (toLeft ? isl!.x1 : isl!.x0) : e[0] + (toLeft ? -12 : 12), e[1]];
    const pts = toLeft ? [tail, ...ends] : [...ends, tail];
    wires += `<polyline points="${pts.map((p) => p.map(f).join(',')).join(' ')}" fill="none" stroke="${rowColor(r)}" stroke-width="0.9"/>`;
    const pin = a.rows[r];
    const lx = inIsl ? tail[0] + (toLeft ? -1.2 : 1.2) : tail[0] + (toLeft ? -0.8 : 0.8);
    marks += `<text x="${f(lx)}" y="${f(tail[1] + 1)}" font-size="2.8" font-weight="bold" text-anchor="${toLeft ? 'end' : 'start'}" fill="${rowColor(r)}">R${r} ${esc(pin ? pin.label.split(' · ')[0] : '?')}</text>`;
    box.add(tail[0] + (toLeft ? -16 : 16), tail[1]);
  }
  return svg(box.view([4, 4, 4, 4]), keys + wires + marks, 900);
}

/** Listwy kontrolera z przypisaniem (widok od strony elementów). */
export function pinoutSvg(c: ControllerPins, a: Assignment, t: T, lang: DocLang): string {
  if (c.leftInner || c.rightInner) return pinoutDoubleSvg(c, a, t, lang);
  const n = Math.max(c.left.length, c.right.length);
  const pitch = 2.54;
  const W = c.left.length > 14 ? 25 : 18;
  const H = n * pitch + 4 + (c.extra.length ? 4 : 0);
  let b = `<rect x="0" y="0" width="${W}" height="${f(H)}" rx="1" fill="#2f3b52" stroke="#000" stroke-width="0.2"/>`;
  const usbY = c.usb === 'top' ? -1.5 : H - 0.5;
  b += `<rect x="${f(W / 2 - 4.5)}" y="${f(usbY)}" width="9" height="2" fill="#bbb" stroke="#000" stroke-width="0.15"/>`;
  b += `<text x="${f(W / 2)}" y="${f(c.usb === 'top' ? -2.4 : H + 4)}" font-size="2" text-anchor="middle">USB</text>`;
  const pinRow = (p: PinDef, x: number, y: number, side: -1 | 1) => {
    let s = `<circle cx="${f(x)}" cy="${f(y)}" r="0.7" fill="#e8c060" stroke="#000" stroke-width="0.1"/>`;
    s += `<text x="${f(x - side * 1.3)}" y="${f(y + 0.6)}" font-size="1.5" fill="#fff" text-anchor="${side < 0 ? 'start' : 'end'}">${esc(p.label)}</text>`;
    const role = a.byPin.get(p.id);
    let lab = '';
    let col = '#999';
    if (role) {
      lab = roleName(t, role);
      col = roleColor(role);
    } else if (p.avoid) lab = `${t.avoid} (${p.avoid[lang]})`;
    else if (p.kind === 'bat') {
      lab = lang === 'pl' ? 'bateria + (przez wyłącznik)' : 'battery + (via switch)';
      col = '#b00';
    }
    if (lab) {
      s += `<path d="M${f(x)} ${f(y)} H${f(x + side * 3)}" stroke="${col}" stroke-width="0.4"/>`;
      s += `<text x="${f(x + side * 3.4)}" y="${f(y + 0.6)}" font-size="1.7" font-weight="bold" fill="${col}" text-anchor="${side < 0 ? 'end' : 'start'}">${esc(lab)}</text>`;
    }
    return s;
  };
  c.left.forEach((p, i) => (b += pinRow(p, 1.3, 2.5 + i * pitch, -1)));
  c.right.forEach((p, i) => (b += pinRow(p, W - 1.3, 2.5 + i * pitch, 1)));
  c.extra.forEach((p, i) => {
    const x = W / 2 - ((c.extra.length - 1) * pitch) / 2 + i * pitch;
    const y = H - 2.2;
    const role = a.byPin.get(p.id);
    b += `<circle cx="${f(x)}" cy="${f(y)}" r="0.7" fill="#e8c060" stroke="#000" stroke-width="0.1"/>`;
    b += `<text x="${f(x)}" y="${f(y - 1.2)}" font-size="1.2" fill="#fff" text-anchor="middle">${esc(p.label.split(' · ')[1] ?? p.label)}</text>`;
    if (role) b += `<text x="${f(x)}" y="${f(H + 2.5 + (i % 2) * 2)}" font-size="1.6" font-weight="bold" fill="${roleColor(role)}" text-anchor="middle">${esc(roleName(t, role))}</text>`;
  });
  b += `<text x="${f(W / 2)}" y="${f(H + (c.extra.length ? 7.5 : 3))}" font-size="1.7" text-anchor="middle" fill="#555">${t.view}</text>`;
  return svg(`-30 -6 ${W + 60} ${f(H + 15)}`, b, 560);
}

/** Krótka nazwa roli do opisu wewnątrz płytki (mało miejsca między listwami). */
function shortRole(t: T, r: Role): string {
  const m: Partial<Record<Role['kind'], string>> = { sda: 'SDA', scl: 'SCL', encA: 'ENC A', encB: 'ENC B', push: 'PUSH', con: 'CON', bak: 'BAK', split: 'TRRS' };
  return m[r.kind] ?? roleName(t, r);
}

/**
 * Płytka z podwójnymi listwami (S2 mini): zewnętrzne piny opisane na zewnątrz płytki,
 * wewnętrzne do środka. Rozstaw jak na płytce: listwy ±11,45 i ±8,91 mm od osi, raster 2,54.
 */
function pinoutDoubleSvg(c: ControllerPins, a: Assignment, t: T, lang: DocLang): string {
  const n = Math.max(c.left.length, c.right.length, c.leftInner?.length ?? 0, c.rightInner?.length ?? 0);
  const pitch = 2.54;
  const W = 25.4;
  const top = 9;
  const H = top + n * pitch + 6;
  let b = `<rect x="0" y="0" width="${W}" height="${f(H)}" rx="1.5" fill="#2f3b52" stroke="#000" stroke-width="0.2"/>`;
  b += `<rect x="${f(W / 2 - 6)}" y="1.2" width="12" height="5" fill="#556" stroke="#000" stroke-width="0.1"/><text x="${f(W / 2)}" y="4.4" font-size="1.5" fill="#ddd" text-anchor="middle">${lang === 'pl' ? 'antena' : 'antenna'}</text>`;
  b += `<rect x="${f(W / 2 - 4.5)}" y="${f(H - 1)}" width="9" height="2.4" fill="#bbb" stroke="#000" stroke-width="0.15"/>`;
  b += `<text x="${f(W / 2)}" y="${f(H + 4)}" font-size="2" text-anchor="middle">USB</text>`;
  const info = (p: PinDef): [string, string] => {
    const role = a.byPin.get(p.id);
    if (role) return [roleName(t, role), roleColor(role)];
    if (p.avoid) return [`${t.avoid} (${p.avoid[lang]})`, '#999'];
    return ['', '#999'];
  };
  const dot = (x: number, y: number) => `<circle cx="${f(x)}" cy="${f(y)}" r="0.75" fill="#e8c060" stroke="#000" stroke-width="0.1"/>`;
  const num = (p: PinDef) => esc(p.label.replace(/^IO/, ''));
  const outer = (p: PinDef, x: number, y: number, side: -1 | 1) => {
    const [lab, col] = info(p);
    let s = dot(x, y);
    s += `<text x="${f(x + side * 1.4)}" y="${f(y + 0.6)}" font-size="1.6" text-anchor="${side < 0 ? 'end' : 'start'}">${num(p)}</text>`;
    if (lab) {
      s += `<path d="M${f(x + side * 5)} ${f(y)} H${f(x + side * 7)}" stroke="${col}" stroke-width="0.4"/>`;
      s += `<text x="${f(x + side * 7.4)}" y="${f(y + 0.6)}" font-size="1.7" font-weight="bold" fill="${col}" text-anchor="${side < 0 ? 'end' : 'start'}">${esc(lab)}</text>`;
    }
    return s;
  };
  const inner = (p: PinDef, x: number, y: number, side: -1 | 1) => {
    const role = a.byPin.get(p.id);
    let s = dot(x, y);
    s += `<text x="${f(x - side * 1.3)}" y="${f(y + 0.55)}" font-size="1.4" fill="#fff" text-anchor="${side < 0 ? 'start' : 'end'}">${num(p)}</text>`;
    const lab = role ? shortRole(t, role) : p.avoid ? '✕' : '';
    const col = role ? roleColor(role) : '#bbb';
    if (lab) s += `<text x="${f(x - side * 4.4)}" y="${f(y + 0.55)}" font-size="1.5" font-weight="bold" fill="${col}" text-anchor="${side < 0 ? 'start' : 'end'}">${esc(lab)}</text>`;
    return s;
  };
  const yAt = (i: number) => top + 1.3 + i * pitch;
  c.left.forEach((p, i) => (b += outer(p, 1.25, yAt(i), -1)));
  (c.leftInner ?? []).forEach((p, i) => (b += inner(p, 3.79, yAt(i), -1)));
  c.right.forEach((p, i) => (b += outer(p, W - 1.25, yAt(i), 1)));
  (c.rightInner ?? []).forEach((p, i) => (b += inner(p, W - 3.79, yAt(i), 1)));
  const note = lang === 'pl' ? 'opisy w środku płytki = wewnętrzna listwa' : 'labels inside the board = inner header';
  b += `<text x="${f(W / 2)}" y="${f(H + 7.5)}" font-size="1.7" text-anchor="middle" fill="#555">${t.view} · ${note}</text>`;
  return svg(`-36 -3 ${W + 72} ${f(H + 13)}`, b, 680);
}

// ---------------------------------------------------------------- firmware

function firmware(inp: WiringInput, as: Assignment[]): string {
  const { ctrl, halves } = inp;
  const split = halves.length > 1;
  const fwOf = (p: PinDef | undefined) => p?.fw ?? '?';
  const L = as[0];
  const lines: string[] = [];
  const allKeys = halves.flatMap((h, i) => h.matrix.keys.map((k) => ({ k, off: split && h.side === 'right' ? h.matrix.cols : 0, half: i })));
  const ordered = [...allKeys].sort((p, q) => p.k.row - q.k.row || p.half - q.half || p.k.col - q.k.col);
  if (ctrl.firmware === 'zmk') {
    const nCols = halves.reduce((s, h) => s + h.matrix.cols, 0);
    lines.push(`// matrix transform: ${halves[0].matrix.rows} × ${nCols}`);
    lines.push('default_transform: keymap_transform_0 {', '    compatible = "zmk,matrix-transform";', `    columns = <${nCols}>;`, `    rows = <${halves[0].matrix.rows}>;`);
    lines.push(`    map = <${ordered.map((o) => `RC(${o.k.row},${o.k.col + o.off})`).join(' ')}>;`, '};', '');
    halves.forEach((h, i) => {
      const a = as[i];
      lines.push(`// ${h.side === 'single' ? 'kscan' : `${h.side}.overlay`}`);
      lines.push('kscan0: kscan_0 {', '    compatible = "zmk,kscan-gpio-matrix";', '    diode-direction = "col2row";');
      lines.push(`    row-gpios = ${a.rows.map((p) => `<${fwOf(p)} (GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)>`).join(', ')};`);
      lines.push(`    col-gpios = ${a.cols.map((p) => `<${fwOf(p)} GPIO_ACTIVE_HIGH>`).join(', ')};`, '};');
      if (h.side === 'right') lines.push(`&default_transform { col-offset = <${halves[0].matrix.cols}>; };`);
      if (a.module.encA && a.module.encB)
        lines.push(
          'encoder: encoder {',
          '    compatible = "alps,ec11";',
          `    a-gpios = <${fwOf(a.module.encA)} (GPIO_ACTIVE_HIGH | GPIO_PULL_UP)>;`,
          `    b-gpios = <${fwOf(a.module.encB)} (GPIO_ACTIVE_HIGH | GPIO_PULL_UP)>;`,
          '    steps = <80>;',
          '};',
        );
      if (a.module.push)
        lines.push(
          `// PUSH/CON/BAK: zmk,kscan-gpio-direct (GPIO_ACTIVE_LOW | GPIO_PULL_UP) + zmk,kscan-composite: ${[a.module.push, a.module.con, a.module.bak].filter(Boolean).map((p) => fwOf(p)).join(', ')}`,
          '// OLED SH1106: sinowealth,sh1106 on &pro_micro_i2c',
        );
      lines.push('');
    });
  } else if (ctrl.firmware === 'qmk') {
    const j: Record<string, unknown> = {
      diode_direction: 'COL2ROW',
      matrix_pins: { rows: L.rows.map(fwOf), cols: L.cols.map(fwOf) },
    };
    if (split) {
      const R = as[1];
      j.split = {
        enabled: true,
        serial: { pin: fwOf(L.split) },
        matrix_pins: { right: { rows: R.rows.map(fwOf), cols: R.cols.map(fwOf) } },
      };
    }
    if (L.module.encA && L.module.encB) j.encoder = { rotary: [{ pin_a: fwOf(L.module.encA), pin_b: fwOf(L.module.encB) }] };
    lines.push('// keyboard.json (QMK)', JSON.stringify(j, null, 2));
    if (L.module.sda) lines.push('', `// OLED SH1106 (I2C): SDA ${fwOf(L.module.sda)}, SCL ${fwOf(L.module.scl)}; PUSH/CON/BAK: direct pins ${[L.module.push, L.module.con, L.module.bak].filter(Boolean).map(fwOf).join(', ')}`);
  } else {
    halves.forEach((h, i) => {
      const a = as[i];
      lines.push(`# code.py (KMK)${h.side === 'single' ? '' : ` – ${h.side}`}`);
      lines.push('from kmk.scanners import DiodeOrientation');
      lines.push(`keyboard.row_pins = (${a.rows.map(fwOf).join(', ')})`);
      lines.push(`keyboard.col_pins = (${a.cols.map(fwOf).join(', ')})`);
      lines.push('keyboard.diode_orientation = DiodeOrientation.COL2ROW');
      if (a.split) lines.push(`# Split(split_type=SplitType.UART, data_pin=${fwOf(a.split)})`);
      if (a.module.encA) lines.push(`# EncoderHandler: pins = ((${fwOf(a.module.encA)}, ${fwOf(a.module.encB)}, ${fwOf(a.module.push)}),)`);
      if (a.module.sda) lines.push(`# Display (SH1106, I2C): busio.I2C(${fwOf(a.module.scl)}, ${fwOf(a.module.sda)})`);
      lines.push('');
    });
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- dokument

export function wiringAssignments(inp: WiringInput): Assignment[] {
  return inp.halves.map((h) => assignPins(inp.ctrl, h.matrix, { module: h.module, split: inp.halves.length > 1 }));
}

export function wiringHtml(inp: WiringInput): string {
  const t = TXT[inp.lang];
  const as = wiringAssignments(inp);
  const split = inp.halves.length > 1;
  const h0 = inp.halves[0].matrix;
  const mx = inp.halves.some((h) => h.matrix.keys.some((k) => switchSpots(k, inp.stabs).length > 1));
  const custom = inp.ctrl.left.length && inp.ctrl.left[0].label.startsWith('GPIO ?');
  const li = (xs: string[]) => `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  let html = `<h1>${t.title}: ${esc(inp.layout)} · ${esc(inp.ctrl.name)}</h1><p>${t.intro}</p>`;
  html += `<h2>1. ${t.rules}</h2><div class="fig">${switchSvg(inp.lang)}</div>${li([...t.rulesList, inp.hotswap ? t.hotswap : t.noHotswap, ...(mx ? [t.mx] : [])])}`;
  html += `<h2>2. ${t.steps}</h2><ol>${t.stepsList.map((s) => `<li>${s}</li>`).join('')}</ol>`;
  html += `<h2>3. ${t.matrix}</h2><p>${t.matrixNote(h0.rows, h0.cols, split)}</p><div class="fig">${topSvg(inp.halves, t)}</div>`;
  if (inp.dactyl) html += `<p class="note">${t.dactyl}</p>`;
  html += `<h2>4. ${t.bottom}</h2><p class="muted">${t.legend}</p>`;
  inp.halves.forEach((h, i) => {
    html += `<h3>${h.side === 'left' ? t.left : h.side === 'right' ? t.right : t.single}</h3><div class="fig">${bottomSvg(h, as[i], inp.stabs, t, inp.ctrl.name)}</div>`;
  });
  html += `<h2>5. ${t.pins}: ${esc(inp.ctrl.name)}</h2>`;
  if (custom) html += `<p class="note">${t.custom}</p>`;
  else if (inp.flipped) html += `<p class="note">${t.flipped}</p>`;
  if (inp.ctrl.note) html += `<p class="note">${esc(inp.ctrl.note[inp.lang])}</p>`;
  if (!inp.ctrl.drawn && !custom) html += `<p class="muted">${t.notDrawn}</p>`;
  inp.halves.forEach((h, i) => {
    const a = as[i];
    if (split) html += `<h3>${h.side === 'left' ? t.left : t.right}</h3>`;
    if (inp.ctrl.drawn && !custom) html += `<div class="fig">${pinoutSvg(inp.ctrl, a, t, inp.lang)}</div>`;
    const row = (sig: string, p: PinDef | undefined, color: string) =>
      `<tr><td style="color:${color};font-weight:600">${esc(sig)}</td><td>${p ? esc(p.label) : '—'}</td><td><code>${p?.fw ? esc(p.fw) : '—'}</code></td></tr>`;
    let tb = `<table><tr><th>${t.signal}</th><th>${t.pin}</th><th>${t.fw}</th></tr>`;
    a.rows.forEach((p, n) => (tb += row(`R${n}`, p, rowColor(n))));
    a.cols.forEach((p, n) => (tb += row(`K${n}`, p, COLC)));
    for (const k of ['sda', 'scl', 'encA', 'encB', 'push', 'con', 'bak'] as const) if (a.module[k]) tb += row(t[k], a.module[k], MOD);
    if (a.split) tb += row(t.split, a.split, '#b00');
    tb += '</table>';
    html += tb;
    if (h.module && a.module.sda) html += `<p class="muted">${t.power} ${t.moduleNote}</p>`;
    if (a.missing.length) html += `<p class="warn">${t.missing}: ${a.missing.map((r) => roleName(t, r)).join(', ')}</p>`;
  });
  if (inp.ctrl.wireless) html += `<p class="muted">${t.battery}</p>`;
  else if (split) html += `<p class="muted">${t.trrs}</p>`;
  html += `<h2>6. ${t.firmware} (${inp.ctrl.firmware.toUpperCase()})</h2><pre>${esc(firmware(inp, as))}</pre>`;
  html += `<p class="muted small">${t.generated} · https://nuerngh.github.io/Keyboard-maker/</p>`;
  return `<!doctype html><html lang="${inp.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t.title}</title><style>${CSS}</style></head><body>${html}</body></html>`;
}

const CSS = `
body{font:15px/1.5 system-ui,sans-serif;color:#1d2330;background:#fff;max-width:1000px;margin:0 auto;padding:16px 20px 40px}
h1{font-size:22px;margin:8px 0 4px}h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid #dde2ea;padding-bottom:4px}h3{font-size:15px;margin:18px 0 6px}
.fig{overflow-x:auto;margin:8px 0}.fig svg{max-width:100%;height:auto;display:block}
table{border-collapse:collapse;margin:8px 0;font-size:14px}td,th{border:1px solid #dde2ea;padding:3px 10px;text-align:left}th{background:#f3f5f8}
pre{background:#f3f5f8;padding:10px;overflow-x:auto;font-size:12px;border-radius:6px}
.note{background:#fff7e0;border-left:3px solid #e0a000;padding:6px 10px}.warn{color:#b00;font-weight:600}.muted{color:#566070}.small{font-size:12px}
@media print{.fig{break-inside:avoid}h2{break-after:avoid}}
`;

// ---------------------------------------------------------------- wejście z generatorów


export function pinsFor(controller: ControllerId | 'custom', customName?: string) {
  return controller === 'custom' ? genericPins(customName || 'Custom') : CONTROLLER_PINS[controller];
}

/** Wejście instrukcji dla płaskiej klawiatury (split, macropad, 60%). */
export function splitWiringInput(o: {
  params: SplitParams;
  island: IslandParams;
  variant: CellVariant;
  cellHeight: number;
  margin: number;
  stabs: 'cherry' | 'mx' | 'none';
  lang: DocLang;
  layout: string;
}): WiringInput {
  const p = o.params;
  const single = !!p.single;
  const left = matrixOf(splitLeft(p), !!p.rowLayout?.length);
  // tak jak w App.svelte: macropad ma moduł na jedynej płycie albo wcale, split ma wyspę przy wewnętrznej kolumnie
  const ip: IslandParams = { ...o.island };
  if (single) ip.moduleSide = ip.moduleSide === 'none' ? 'none' : 'left';
  else ip.position = 'inner';
  const isl = (s: 'left' | 'right') => (ip.enabled ? (islandFor(p, ip, s, o.variant, o.cellHeight, o.margin)?.rect ?? null) : null);
  const mod = (s: 'left' | 'right') => ip.enabled && (ip.moduleSide === 'both' || ip.moduleSide === s);
  const halves: WiringHalf[] = single
    ? [{ side: 'single', matrix: left, island: isl('left'), module: mod('left') }]
    : [
        { side: 'left', matrix: left, island: isl('left'), module: mod('left') },
        { side: 'right', matrix: mirrorMatrix(left), island: isl('right'), module: mod('right') },
      ];
  return {
    lang: o.lang,
    layout: o.layout,
    halves,
    ctrl: pinsFor(ip.controller, ip.custom?.name),
    stabs: o.stabs,
    hotswap: o.variant === 'hotswap',
    flipped: ip.flip ?? true,
  };
}

/**
 * Macierz Dactyla. Model jest liczony dla prawej połówki: kolumna 0 to wewnętrzna kolumna palca
 * wskazującego (po lewej patrząc z góry), więc na prawej K = col, a na lewej (lustro) K = cols − 1 − col.
 * Kciuk dostaje własny rząd. Pozycje to rzut z góry środków klawiszy.
 */
export function dactylMatrix(m: DactylModel): Matrix {
  const nr = m.params.rows;
  const nc = m.params.cols;
  const flat = m.keys.map((k) => {
    const [x, y] = apply(k.frame, [0, 0, 0]);
    const [ux, uy] = applyDir(k.frame, [1, 0, 0]);
    const r = (Math.atan2(uy, ux) * 180) / Math.PI;
    return { id: k.id, x, y, rot: r, w: (2 * k.hw) / PITCH, h: (2 * k.hh) / PITCH, src: k };
  });
  const keys: WKey[] = [];
  for (const k of flat) if (k.src.col !== undefined) keys.push({ id: k.id, x: k.x, y: k.y, rot: k.rot, w: k.w, h: k.h, row: k.src.row!, col: k.src.col });
  // kciuk: najpierw puste miejsca dolnego rzędu (stoją tuż nad kciukiem), reszta w nowym rzędzie,
  // każdy klawisz do najbliższej kolumny
  const colX = Array.from({ length: nc }, (_, c) => {
    const xs = keys.filter((k) => k.col === c).map((k) => k.x);
    return xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
  });
  const last = nr - 1;
  const empty = colX.map((_, c) => c).filter((c) => !keys.some((k) => k.row === last && k.col === c));
  const thumbs = flat.filter((k) => k.src.thumb).sort((a, b) => b.y - a.y);
  const up = thumbs.slice(0, Math.min(empty.length, thumbs.length));
  const cs = placeRow(
    up.map((k) => k.x),
    empty.map((c) => colX[c]),
  )!;
  up.forEach((k, i) => keys.push({ id: k.id, x: k.x, y: k.y, rot: k.rot, w: k.w, h: k.h, row: last, col: empty[cs[i]] }));
  const rest = thumbs.slice(up.length);
  let rows = nr;
  for (let i = 0; i < rest.length; i += nc) {
    const part = rest.slice(i, i + nc);
    const c2 = placeRow(
      part.map((k) => k.x),
      colX,
    )!;
    part.forEach((k, j) => keys.push({ id: k.id, x: k.x, y: k.y, rot: k.rot, w: k.w, h: k.h, row: rows, col: c2[j] }));
    rows++;
  }
  return { rows, cols: nc, keys };
}

export function dactylWiringInput(o: { model: DactylModel; controller: ControllerId | null; hotswap: boolean; lang: DocLang }): WiringInput {
  const right: Matrix = dactylMatrix(o.model);
  const left: Matrix = mirrorMatrix(right);
  return {
    lang: o.lang,
    layout: `Dactyl ${o.model.params.rows}×${o.model.params.cols}`,
    halves: [
      { side: 'left', matrix: left, island: null, module: false },
      { side: 'right', matrix: right, island: null, module: false },
    ],
    ctrl: pinsFor(o.controller ?? 'nicenano'),
    stabs: 'none',
    hotswap: o.hotswap,
    flipped: false,
    dactyl: true,
  };
}
