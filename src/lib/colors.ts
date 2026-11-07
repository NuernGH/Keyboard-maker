// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Kolory podglądu 3D: obudowa, płyta, klin, nakładki (grupy i pojedyncze klawisze), legendy
 * i podświetlenie RGB pod obudową. Dotyczą wyłącznie podglądu; pliki STL/STEP się nie zmieniają.
 *
 * `on: false` (domyślnie) = podgląd wygląda dokładnie jak wcześniej (kolory z motywu jasny/ciemny).
 * Klawisz w ustawieniach to `strona:id`, np. `left:k-0-0` (split ma te same id w obu połówkach).
 */

export type CapGroup = 'alpha' | 'mod' | 'accent';
export const CAP_GROUPS: CapGroup[] = ['alpha', 'mod', 'accent'];

export interface PreviewColors {
  /** false = podgląd bez zmian (jak dotąd) */
  on: boolean;
  /** ostatnio wybrany motyw (punkt startu; potem każdy kolor można zmienić) */
  theme: string;
  /** tło sceny; pusty = z motywu strony (jasny/ciemny) */
  background: string;
  case: string;
  plate: string;
  wedge: string;
  caps: Record<CapGroup, string>;
  legends: {
    /** nazwy klawiszy na nakładkach (tylko podgląd, do czasu prawdziwych legend) */
    show: boolean;
    mode: 'group' | 'rainbow';
    colors: Record<CapGroup, string>;
  };
  /** klawisz przeniesiony do innej grupy niż wynika z nazwy i szerokości */
  keyGroup: Record<string, CapGroup>;
  /** własny kolor nakładki klawisza */
  keyColor: Record<string, string>;
  /** własny kolor legendy klawisza */
  keyLegend: Record<string, string>;
  glow: {
    on: boolean;
    mode: 'rainbow' | 'single';
    color: string;
    /** jasność 0–1 */
    strength: number;
  };
}

export interface ColorTheme {
  id: string;
  name: { pl: string; en: string };
  /** wartości nakładane na ustawienia (klawisze z własnymi kolorami zostają) */
  set: Omit<PreviewColors, 'on' | 'theme' | 'keyGroup' | 'keyColor' | 'keyLegend'>;
}

const BW: ColorTheme['set'] = {
  background: '#101317',
  case: '#16181b',
  plate: '#2a2d31',
  wedge: '#2a2d31',
  caps: { alpha: '#f2f2ef', mod: '#1e2023', accent: '#1e2023' },
  legends: { show: true, mode: 'rainbow', colors: { alpha: '#222222', mod: '#ffffff', accent: '#ff4d4d' } },
  glow: { on: true, mode: 'rainbow', color: '#ff2bd6', strength: 0.8 },
};

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'bw-rgb', name: { pl: 'Biało-czarny, RGB', en: 'White-black, RGB' }, set: BW },
  {
    id: 'retro',
    name: { pl: 'Retro beż', en: 'Retro beige' },
    set: {
      background: '',
      case: '#d9d4c7',
      plate: '#bdb7a8',
      wedge: '#cfc9ba',
      caps: { alpha: '#e9e1cf', mod: '#8a8f96', accent: '#c8372d' },
      legends: { show: true, mode: 'group', colors: { alpha: '#2b2b2b', mod: '#ffffff', accent: '#ffffff' } },
      glow: { on: false, mode: 'single', color: '#ffb347', strength: 0.6 },
    },
  },
  {
    id: 'dark',
    name: { pl: 'Ciemny', en: 'Dark' },
    set: {
      background: '#14181c',
      case: '#2b2f35',
      plate: '#3a3f46',
      wedge: '#3a3f46',
      caps: { alpha: '#3a3f46', mod: '#25292e', accent: '#e0a526' },
      legends: { show: true, mode: 'group', colors: { alpha: '#e8e8e8', mod: '#9fd3ff', accent: '#1b1b1b' } },
      glow: { on: true, mode: 'single', color: '#2b8cff', strength: 0.6 },
    },
  },
  {
    id: 'white',
    name: { pl: 'Cały biały', en: 'All white' },
    set: {
      background: '',
      case: '#f4f4f2',
      plate: '#e4e4e0',
      wedge: '#e4e4e0',
      caps: { alpha: '#fafaf8', mod: '#e6e6e2', accent: '#7fb8e6' },
      legends: { show: true, mode: 'group', colors: { alpha: '#333333', mod: '#333333', accent: '#ffffff' } },
      glow: { on: false, mode: 'single', color: '#ffffff', strength: 0.5 },
    },
  },
];

/** Domyślne: wyłączone (podgląd jak dotąd); po włączeniu startuje od motywu biało-czarnego. */
export const DEFAULT_COLORS: PreviewColors = {
  on: false,
  theme: 'bw-rgb',
  ...structuredClone(BW),
  keyGroup: {},
  keyColor: {},
  keyLegend: {},
};

/** nakłada motyw; klawisze z własnymi kolorami i grupami zostają */
export function applyTheme(c: PreviewColors, id: string): PreviewColors {
  const t = COLOR_THEMES.find((x) => x.id === id);
  if (!t) return c;
  return { ...c, ...structuredClone(t.set), theme: id, on: true };
}

const MODS = new Set(['Esc', 'Tab', 'Caps', 'Shift', 'Ctrl', 'Win', 'Alt', 'AltGr', 'Fn', 'Menu', 'Back', 'Enter', 'Space', 'Del', '']);
const ACCENTS = new Set(['Esc', 'Enter']);

/** klawisz do pokolorowania: `ref` = `strona:id`, `main` = główna legenda (do grupy), x/y = środek (mm, do tęczy) */
export interface ColorKey {
  ref: string;
  main: string;
  w: number;
  h: number;
  x: number;
  y: number;
}

/** grupa klawisza wg nazwy i rozmiaru (litery 1U, modyfikatory szersze lub z nazwą funkcyjną) */
export function autoGroup(label: string, w: number, h: number, named: boolean): CapGroup {
  if (named && ACCENTS.has(label)) return 'accent';
  if (w > 1 || h > 1) return 'mod';
  if (named && MODS.has(label)) return 'mod';
  return 'alpha';
}

export interface KeyLook {
  cap: string;
  legend: string;
}

/** czy kolor (#rrggbb) jest ciemny (jasność względna < 0,4) */
export function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const Y = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return Y < 0.18;
}

/** barwa tęczy `h` (0–1): na jasnej nakładce nasycona i przyciemniona, na ciemnej rozjaśniona */
export function rainbow(h: number, onDark: boolean): string {
  const l = onDark ? 0.68 : 0.45;
  const a = onDark ? 0.32 : 0.45;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/**
 * Kolor nakładki i legendy dla każdego klawisza. `named` = układ ma prawdziwe nazwy
 * (60%, split, Dactyl); przy numerach (macropad) grupy wynikają tylko z rozmiaru.
 */
export function resolveKeys(c: PreviewColors, keys: ColorKey[], named = true): Record<string, KeyLook> {
  const out: Record<string, KeyLook> = {};
  if (!keys.length) return out;
  const xs = keys.map((k) => k.x - k.y * 0.6);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  keys.forEach((k, i) => {
    const g = c.keyGroup[k.ref] ?? autoGroup(k.main, k.w, k.h, named);
    const cap = c.keyColor[k.ref] ?? c.caps[g];
    let legend = c.keyLegend[k.ref];
    if (!legend) legend = c.legends.mode === 'rainbow' ? rainbow(((xs[i] - x0) / Math.max(1, x1 - x0)) * 0.83, isDark(cap)) : c.legends.colors[g];
    out[k.ref] = { cap, legend };
  });
  return out;
}
