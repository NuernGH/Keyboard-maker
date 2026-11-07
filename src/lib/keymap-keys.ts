// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Kody klawiszy ZMK (dt-bindings/zmk/keys.h) z krótkim opisem na rysunek, nazwą do listy
 * i kodem przeglądarki (KeyboardEvent.code), żeby klawisz dało się wybrać naciśnięciem.
 *
 * KeyboardEvent.code to pozycja fizyczna klawisza (jak kod HID), niezależna od układu w systemie,
 * więc ta sama tabela działa w układzie polskim programisty i w US.
 */

export type KeyGroup = 'letters' | 'digits' | 'symbols' | 'edit' | 'mods' | 'nav' | 'fkeys' | 'keypad' | 'media' | 'intl';

export interface ZmkKey {
  /** nazwa w ZMK, np. `LBKT` */
  id: string;
  /** krótki opis na klawisz w rysunku */
  short: string;
  /** opis w liście */
  pl: string;
  en: string;
  group: KeyGroup;
  /** KeyboardEvent.code (może być kilka, np. stare nazwy OSLeft) */
  codes?: string[];
  /** dodatkowe słowa do wyszukiwania */
  alias?: string;
}

const k = (id: string, short: string, pl: string, en: string, group: KeyGroup, codes?: string[], alias?: string): ZmkKey => ({ id, short, pl, en, group, codes, alias });

const letters: ZmkKey[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => k(c, c, `Litera ${c}`, `Letter ${c}`, 'letters', [`Key${c}`]));
const digits: ZmkKey[] = '1234567890'.split('').map((d) => k(`N${d}`, d, `Cyfra ${d}`, `Digit ${d}`, 'digits', [`Digit${d}`]));
const fkeys: ZmkKey[] = Array.from({ length: 24 }, (_, i) => k(`F${i + 1}`, `F${i + 1}`, `F${i + 1}`, `F${i + 1}`, 'fkeys', [`F${i + 1}`]));
const keypadDigits: ZmkKey[] = '1234567890'.split('').map((d) => k(`KP_N${d}`, `Num ${d}`, `Klawiatura numeryczna ${d}`, `Keypad ${d}`, 'keypad', [`Numpad${d}`]));

export const ZMK_KEYS: ZmkKey[] = [
  ...letters,
  ...digits,
  k('MINUS', '-', 'Minus  - _', 'Minus  - _', 'symbols', ['Minus']),
  k('EQUAL', '=', 'Równa się  = +', 'Equal  = +', 'symbols', ['Equal']),
  k('LBKT', '[', 'Nawias kwadratowy lewy  [ {', 'Left bracket  [ {', 'symbols', ['BracketLeft']),
  k('RBKT', ']', 'Nawias kwadratowy prawy  ] }', 'Right bracket  ] }', 'symbols', ['BracketRight']),
  k('BSLH', '\\', 'Ukośnik wsteczny  \\ |', 'Backslash  \\ |', 'symbols', ['Backslash']),
  k('SEMI', ';', 'Średnik  ; :', 'Semicolon  ; :', 'symbols', ['Semicolon']),
  k('SQT', "'", "Apostrof  ' \"", "Quote  ' \"", 'symbols', ['Quote']),
  k('GRAVE', '` ~', 'Grawis  ` ~ (tylda)', 'Grave  ` ~', 'symbols', ['Backquote'], 'tilde tylda'),
  k('COMMA', ',', 'Przecinek  , <', 'Comma  , <', 'symbols', ['Comma']),
  k('DOT', '.', 'Kropka  . >', 'Period  . >', 'symbols', ['Period']),
  k('FSLH', '/', 'Ukośnik  / ?', 'Slash  / ?', 'symbols', ['Slash']),
  k('NON_US_BSLH', 'ISO \\', 'Klawisz ISO obok lewego Shift  \\ |', 'ISO key next to left Shift', 'intl', ['IntlBackslash']),
  k('NON_US_HASH', 'ISO #', 'Klawisz ISO # ~ (obok Enter)', 'ISO # ~ key (next to Enter)', 'intl'),
  k('ESC', 'Esc', 'Escape', 'Escape', 'edit', ['Escape']),
  k('TAB', 'Tab', 'Tabulator', 'Tab', 'edit', ['Tab']),
  k('SPACE', 'Spacja', 'Spacja', 'Space', 'edit', ['Space'], 'space'),
  k('RET', 'Enter', 'Enter', 'Enter (Return)', 'edit', ['Enter'], 'enter return'),
  k('BSPC', 'Bksp', 'Backspace', 'Backspace', 'edit', ['Backspace']),
  k('DEL', 'Del', 'Delete', 'Delete', 'edit', ['Delete']),
  k('INS', 'Ins', 'Insert', 'Insert', 'edit', ['Insert']),
  k('CAPS', 'Caps', 'Caps Lock', 'Caps Lock', 'edit', ['CapsLock']),
  k('PSCRN', 'PrtSc', 'Print Screen', 'Print Screen', 'edit', ['PrintScreen']),
  k('SLCK', 'ScrLk', 'Scroll Lock', 'Scroll Lock', 'edit', ['ScrollLock']),
  k('PAUSE_BREAK', 'Pause', 'Pause / Break', 'Pause / Break', 'edit', ['Pause']),
  k('K_APP', 'Menu', 'Menu kontekstowe', 'Context menu (App)', 'edit', ['ContextMenu']),
  k('LCTRL', 'Ctrl', 'Lewy Ctrl', 'Left Ctrl', 'mods', ['ControlLeft']),
  k('LSHFT', 'Shift', 'Lewy Shift', 'Left Shift', 'mods', ['ShiftLeft']),
  k('LALT', 'Alt', 'Lewy Alt', 'Left Alt', 'mods', ['AltLeft']),
  k('LGUI', 'Win', 'Lewy Win (GUI, Cmd)', 'Left GUI (Win, Cmd)', 'mods', ['MetaLeft', 'OSLeft']),
  k('RCTRL', 'Ctrl', 'Prawy Ctrl', 'Right Ctrl', 'mods', ['ControlRight']),
  k('RSHFT', 'Shift', 'Prawy Shift', 'Right Shift', 'mods', ['ShiftRight']),
  k('RALT', 'AltGr', 'Prawy Alt (AltGr)', 'Right Alt (AltGr)', 'mods', ['AltRight']),
  k('RGUI', 'Win', 'Prawy Win (GUI, Cmd)', 'Right GUI (Win, Cmd)', 'mods', ['MetaRight', 'OSRight']),
  k('UP', '↑', 'Strzałka w górę', 'Up arrow', 'nav', ['ArrowUp']),
  k('DOWN', '↓', 'Strzałka w dół', 'Down arrow', 'nav', ['ArrowDown']),
  k('LEFT', '←', 'Strzałka w lewo', 'Left arrow', 'nav', ['ArrowLeft']),
  k('RIGHT', '→', 'Strzałka w prawo', 'Right arrow', 'nav', ['ArrowRight']),
  k('HOME', 'Home', 'Home', 'Home', 'nav', ['Home']),
  k('END', 'End', 'End', 'End', 'nav', ['End']),
  k('PG_UP', 'PgUp', 'Page Up', 'Page Up', 'nav', ['PageUp']),
  k('PG_DN', 'PgDn', 'Page Down', 'Page Down', 'nav', ['PageDown']),
  ...fkeys,
  k('KP_NUMLOCK', 'NumLk', 'Num Lock', 'Num Lock', 'keypad', ['NumLock']),
  k('KP_DIVIDE', 'Num /', 'Klawiatura numeryczna /', 'Keypad /', 'keypad', ['NumpadDivide']),
  k('KP_MULTIPLY', 'Num *', 'Klawiatura numeryczna *', 'Keypad *', 'keypad', ['NumpadMultiply']),
  k('KP_MINUS', 'Num -', 'Klawiatura numeryczna -', 'Keypad -', 'keypad', ['NumpadSubtract']),
  k('KP_PLUS', 'Num +', 'Klawiatura numeryczna +', 'Keypad +', 'keypad', ['NumpadAdd']),
  k('KP_ENTER', 'Num ⏎', 'Klawiatura numeryczna Enter', 'Keypad Enter', 'keypad', ['NumpadEnter']),
  k('KP_DOT', 'Num .', 'Klawiatura numeryczna , (kropka)', 'Keypad .', 'keypad', ['NumpadDecimal']),
  k('KP_EQUAL', 'Num =', 'Klawiatura numeryczna =', 'Keypad =', 'keypad', ['NumpadEqual']),
  ...keypadDigits,
  k('C_VOL_UP', 'Vol+', 'Głośniej', 'Volume up', 'media', ['AudioVolumeUp', 'VolumeUp'], 'volume glosnosc'),
  k('C_VOL_DN', 'Vol−', 'Ciszej', 'Volume down', 'media', ['AudioVolumeDown', 'VolumeDown'], 'volume glosnosc'),
  k('C_MUTE', 'Mute', 'Wycisz', 'Mute', 'media', ['AudioVolumeMute', 'VolumeMute'], 'volume glosnosc'),
  k('C_PP', 'Play', 'Odtwórz / pauza', 'Play / pause', 'media', ['MediaPlayPause'], 'play pause'),
  k('C_NEXT', 'Next', 'Następny utwór', 'Next track', 'media', ['MediaTrackNext']),
  k('C_PREV', 'Prev', 'Poprzedni utwór', 'Previous track', 'media', ['MediaTrackPrevious']),
  k('C_STOP', 'Stop', 'Zatrzymaj', 'Stop', 'media', ['MediaStop']),
  k('C_BRI_UP', 'Jasn+', 'Jaśniej (ekran)', 'Brightness up', 'media', [], 'brightness jasnosc'),
  k('C_BRI_DN', 'Jasn−', 'Ciemniej (ekran)', 'Brightness down', 'media', [], 'brightness jasnosc'),
  k('C_AL_CALC', 'Kalk', 'Kalkulator', 'Calculator', 'media', ['LaunchApp2'], 'calculator'),
  k('C_AL_FILES', 'Pliki', 'Eksplorator plików', 'File browser', 'media', ['LaunchApp1'], 'explorer'),
  k('C_AL_WWW', 'WWW', 'Przeglądarka', 'Web browser', 'media', ['BrowserHome']),
  k('C_AL_MAIL', 'Poczta', 'Poczta', 'Mail', 'media', ['LaunchMail']),
  k('INT1', 'Ro', 'Japoński Ro (INT1)', 'International 1 (Ro)', 'intl', ['IntlRo']),
  k('INT3', 'Yen', 'Japoński Yen (INT3)', 'International 3 (Yen)', 'intl', ['IntlYen']),
  k('LANG1', 'Lang1', 'Przełącz język 1 (koreański/japoński)', 'Language 1', 'intl', ['Lang1']),
  k('LANG2', 'Lang2', 'Przełącz język 2', 'Language 2', 'intl', ['Lang2']),
];

export const KEY_BY_ID = new Map(ZMK_KEYS.map((x) => [x.id, x]));

/** popularne aliasy z keys.h, żeby wczytane albo wpisane ręcznie nazwy też miały opis */
const ALIASES: Record<string, string> = {
  ENTER: 'RET', RETURN: 'RET', ESCAPE: 'ESC', BACKSPACE: 'BSPC', SPC: 'SPACE', DELETE: 'DEL', INSERT: 'INS',
  LBRC: 'LBKT', RBRC: 'RBKT', BACKSLASH: 'BSLH', SEMICOLON: 'SEMI', APOS: 'SQT', SINGLE_QUOTE: 'SQT', GRAV: 'GRAVE',
  PERIOD: 'DOT', SLASH: 'FSLH', CAPSLOCK: 'CAPS', CLCK: 'CAPS', LCTL: 'LCTRL', LEFT_CONTROL: 'LCTRL', LSHIFT: 'LSHFT', LEFT_SHIFT: 'LSHFT',
  LEFT_ALT: 'LALT', LCMD: 'LGUI', LWIN: 'LGUI', LMETA: 'LGUI', RCTL: 'RCTRL', RSHIFT: 'RSHFT', RCMD: 'RGUI', RWIN: 'RGUI', RMETA: 'RGUI',
  PRINTSCREEN: 'PSCRN', SCROLLLOCK: 'SLCK', PAGE_UP: 'PG_UP', PAGE_DOWN: 'PG_DN', UP_ARROW: 'UP', DOWN_ARROW: 'DOWN', LEFT_ARROW: 'LEFT', RIGHT_ARROW: 'RIGHT',
  K_CONTEXT_MENU: 'K_APP', K_CMENU: 'K_APP', C_VOLUME_UP: 'C_VOL_UP', C_VOLUME_DOWN: 'C_VOL_DN', K_MUTE: 'C_MUTE', C_PLAY_PAUSE: 'C_PP',
  NUMBER_1: 'N1', NUMBER_2: 'N2', NUMBER_3: 'N3', NUMBER_4: 'N4', NUMBER_5: 'N5', NUMBER_6: 'N6', NUMBER_7: 'N7', NUMBER_8: 'N8', NUMBER_9: 'N9', NUMBER_0: 'N0',
};
export const keyInfo = (id: string): ZmkKey | undefined => KEY_BY_ID.get(id) ?? KEY_BY_ID.get(ALIASES[id] ?? '');

/** KeyboardEvent.code → nazwa ZMK */
export const CODE_TO_ZMK = new Map<string, string>(ZMK_KEYS.flatMap((x) => (x.codes ?? []).map((c) => [c, x.id] as [string, string])));
/** nazwa ZMK → KeyboardEvent.code (pierwszy), do opisów z układu systemu */
export const ZMK_TO_CODE = new Map<string, string>(ZMK_KEYS.filter((x) => x.codes?.length).map((x) => [x.id, x.codes![0]]));

/** modyfikatory: KeyboardEvent.code → funkcja ZMK (LC(…)) i nazwa klawisza */
export const MOD_CODES: Record<string, { fn: string; key: string }> = {
  ControlLeft: { fn: 'LC', key: 'LCTRL' },
  ShiftLeft: { fn: 'LS', key: 'LSHFT' },
  AltLeft: { fn: 'LA', key: 'LALT' },
  MetaLeft: { fn: 'LG', key: 'LGUI' },
  OSLeft: { fn: 'LG', key: 'LGUI' },
  ControlRight: { fn: 'RC', key: 'RCTRL' },
  ShiftRight: { fn: 'RS', key: 'RSHFT' },
  AltRight: { fn: 'RA', key: 'RALT' },
  MetaRight: { fn: 'RG', key: 'RGUI' },
  OSRight: { fn: 'RG', key: 'RGUI' },
};
const MOD_ORDER = ['LC', 'LS', 'LA', 'LG', 'RC', 'RS', 'RA', 'RG'];
export const MOD_FN_NAME: Record<string, string> = { LC: 'Ctrl', LS: 'Shift', LA: 'Alt', LG: 'Win', RC: 'RCtrl', RS: 'RShift', RA: 'AltGr', RG: 'RWin' };
/** modyfikatory do przytrzymania w &mt */
export const HOLD_MODS = ['LCTRL', 'LSHFT', 'LALT', 'LGUI', 'RCTRL', 'RSHFT', 'RALT', 'RGUI'];

/**
 * AltGr w Windows przychodzi jako lewy Ctrl + prawy Alt. Gdy prawy Alt jest wciśnięty razem z lewym Ctrl
 * (albo przeglądarka zgłasza AltGraph), lewy Ctrl jest fałszywy i odpada.
 */
export function realMods(held: string[], altGraph = false): string[] {
  const set = new Set(held.filter((c) => c in MOD_CODES));
  if (set.has('AltRight') && (altGraph || set.has('ControlLeft'))) set.delete('ControlLeft');
  return [...set];
}

/**
 * Kod ZMK z naciśniętego klawisza i trzymanych modyfikatorów, np. `KeyT` + Ctrl + Shift → `LC(LS(T))`,
 * AltGr + A → `RA(A)`. Zwraca null dla klawisza spoza tabeli.
 */
export function captureKey(code: string, held: string[], altGraph = false): string | null {
  const base = CODE_TO_ZMK.get(code);
  if (!base) return null;
  const fns = [...new Set(realMods(held, altGraph).filter((c) => c !== code).map((c) => MOD_CODES[c].fn))].sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return fns.reduceRight((acc, fn) => `${fn}(${acc})`, base);
}

/**
 * Sam modyfikator naciśnięty i puszczony (bez innego klawisza): kolejność naciśnięć `pressed`.
 * AltGr (lewy Ctrl + prawy Alt) daje RALT, inaczej ostatni naciśnięty.
 */
export function loneModifier(pressed: string[]): string | null {
  const mods = pressed.filter((c) => c in MOD_CODES);
  if (!mods.length) return null;
  if (mods.includes('AltRight')) return 'RALT';
  return MOD_CODES[mods[mods.length - 1]].key;
}

/** rozkłada `LC(LS(T))` na listę funkcji modyfikatorów i klawisz */
export function splitMods(expr: string): { mods: string[]; key: string } {
  const mods: string[] = [];
  let s = expr.trim();
  for (;;) {
    const m = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.*)\)$/.exec(s);
    if (!m) break;
    mods.push(m[1]);
    s = m[2].trim();
  }
  return { mods, key: s };
}

/** polskie znaki z AltGr (układ polski programisty): RA(A) → ą */
const PL_ALTGR: Record<string, string> = { A: 'ą', C: 'ć', E: 'ę', L: 'ł', N: 'ń', O: 'ó', S: 'ś', X: 'ź', Z: 'ż' };

/**
 * Opis wyrażenia klawisza na rysunek. `layoutMap` (opcjonalnie, z navigator.keyboard.getLayoutMap())
 * podaje znak z układu w systemie dla liter i znaków.
 */
/** krótkie opisy po angielsku tam, gdzie `short` jest polski */
const SHORT_EN: Record<string, string> = { SPACE: 'Space', C_BRI_UP: 'Bri+', C_BRI_DN: 'Bri−', C_AL_CALC: 'Calc', C_AL_FILES: 'Files', C_AL_MAIL: 'Mail' };
/** krótki opis klawisza z listy w wybranym języku */
export const keyShort = (x: ZmkKey, lang: 'pl' | 'en' = 'pl') => (lang === 'en' ? SHORT_EN[x.id] ?? x.short : x.short);

export function keyLabel(expr: string, layoutMap?: Map<string, string> | null, lang: 'pl' | 'en' = 'pl'): string {
  const { mods, key } = splitMods(expr);
  const info = keyInfo(key);
  let base = info ? keyShort(info, lang) : key;
  if (info && layoutMap && (info.group === 'letters' || info.group === 'symbols' || info.group === 'intl')) {
    const code = ZMK_TO_CODE.get(info.id);
    const ch = code ? layoutMap.get(code) : undefined;
    if (ch && ch.trim()) base = ch.toUpperCase();
  }
  if (mods.length === 1 && mods[0] === 'RA' && PL_ALTGR[info?.id ?? '']) return PL_ALTGR[info!.id];
  if (!mods.length) return base;
  return `${mods.map((m) => MOD_FN_NAME[m]).join('+')}+${base}`;
}

/** wyszukiwanie w liście kodów: po nazwie ZMK, opisie, skrócie i aliasach, bez polskich znaków */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');
export function searchKeys(q: string, lang: 'pl' | 'en' = 'pl'): ZmkKey[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return ZMK_KEYS;
  const scored = ZMK_KEYS.map((x) => {
    const id = x.id.toLowerCase();
    const hay = fold(`${x.id} ${x.short} ${x[lang]} ${lang === 'pl' ? x.en : x.pl} ${x.alias ?? ''}`);
    if (!words.every((w) => hay.includes(w))) return null;
    const w0 = words[0];
    const score = id === w0 || fold(x.short) === w0 ? 0 : id.startsWith(w0) ? 1 : 2;
    return { x, score };
  }).filter((v): v is { x: ZmkKey; score: number } => !!v);
  return scored.sort((a, b) => a.score - b.score).map((v) => v.x);
}
