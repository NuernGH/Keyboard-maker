// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { COLOR_THEMES, DEFAULT_COLORS, applyTheme, autoGroup, isDark, rainbow, resolveKeys, type ColorKey } from '../src/lib/colors';
import { defaultLegends, dactylLegends, isAnsi60 } from '../src/lib/legend-defaults';
import { ANSI_60, TEMPLATES, mirrorKeys, splitLeft } from '../src/lib/layout';
import { mergeDefaults, makeProject, parseProject } from '../src/lib/project';
import { DACTYL_DEFAULT, buildDactyl } from '../src/lib/dactyl';

const ansi = TEMPLATES.find((t) => t.id === 'ansi-60')!;
const split = TEMPLATES[0];

describe('kolory podglądu', () => {
  it('domyślnie wyłączone (podgląd bez zmian)', () => {
    expect(DEFAULT_COLORS.on).toBe(false);
  });

  it('motyw włącza kolory i zostawia ustawienia pojedynczych klawiszy', () => {
    const c = { ...structuredClone(DEFAULT_COLORS), keyColor: { 'left:k-1-1': '#00ff00' }, keyGroup: { 'left:k-1-2': 'accent' as const } };
    const r = applyTheme(c, 'retro');
    expect(r.on).toBe(true);
    expect(r.theme).toBe('retro');
    expect(r.caps.accent).toBe(COLOR_THEMES.find((t) => t.id === 'retro')!.set.caps.accent);
    expect(r.keyColor['left:k-1-1']).toBe('#00ff00');
    expect(r.keyGroup['left:k-1-2']).toBe('accent');
  });

  it('grupy: litery 1U, modyfikatory szersze lub funkcyjne, akcent Esc i Enter', () => {
    expect(autoGroup('Q', 1, 1, true)).toBe('alpha');
    expect(autoGroup('Shift', 2.25, 1, true)).toBe('mod');
    expect(autoGroup('Ctrl', 1, 1, true)).toBe('mod');
    expect(autoGroup('Esc', 1, 1, true)).toBe('accent');
    expect(autoGroup('Enter', 2.25, 1, true)).toBe('accent');
    // macropad z numerami: tylko rozmiar
    expect(autoGroup('', 1, 1, false)).toBe('alpha');
  });

  it('60%: kolory nakładek wg grup, własny kolor klawisza ma pierwszeństwo', () => {
    const keys = splitLeft(ansi.params);
    const lg = defaultLegends('ansi-60', ansi.params, keys, 'left');
    const ck: ColorKey[] = keys.map((k) => ({ ref: `left:${k.id}`, main: lg[k.id]?.main ?? '', w: k.w, h: k.h, x: k.x, y: k.y }));
    const c = applyTheme(structuredClone(DEFAULT_COLORS), 'retro');
    c.keyColor['left:k-1-1'] = '#123456';
    const looks = resolveKeys(c, ck);
    expect(looks['left:k-0-0'].cap).toBe(c.caps.accent); // Esc
    expect(looks['left:k-2-12'].cap).toBe(c.caps.accent); // Enter
    expect(looks['left:k-3-0'].cap).toBe(c.caps.mod); // Shift
    expect(looks['left:k-4-3'].cap).toBe(c.caps.mod); // spacja
    expect(looks['left:k-2-1'].cap).toBe(c.caps.alpha); // A
    expect(looks['left:k-1-1'].cap).toBe('#123456'); // Q, własny
    expect(looks['left:k-2-1'].legend).toBe(c.legends.colors.alpha);
  });

  it('tęcza: na ciemnej nakładce jaśniejsza niż na jasnej', () => {
    expect(isDark('#1e2023')).toBe(true);
    expect(isDark('#f2f2ef')).toBe(false);
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    for (const h of [0, 0.3, 0.6, 0.8]) expect(lum(rainbow(h, true))).toBeGreaterThan(lum(rainbow(h, false)));
  });

  it('starszy plik projektu bez kolorów otwiera się z kolorami wyłączonymi', () => {
    const pf = parseProject(JSON.stringify(makeProject('flat', { templateId: 'ansi-60' } as never)));
    expect(mergeDefaults(DEFAULT_COLORS, pf.flat!.colors)).toEqual(DEFAULT_COLORS);
    const saved = { ...applyTheme(structuredClone(DEFAULT_COLORS), 'dark'), keyColor: { 'right:k-0-1': '#ff0000' } };
    const back = mergeDefaults(DEFAULT_COLORS, JSON.parse(JSON.stringify(saved)));
    expect(back).toEqual(saved);
  });
});

describe('domyślne legendy', () => {
  it('60% ANSI: nazwy wszystkich 61 klawiszy (poza spacją), Shift nad cyframi', () => {
    expect(isAnsi60(ANSI_60)).toBe(true);
    const keys = splitLeft(ansi.params);
    const lg = defaultLegends('ansi-60', ansi.params, keys, 'left');
    const rowKeys = keys.filter((k) => k.id.startsWith('k-'));
    expect(rowKeys).toHaveLength(61);
    expect(rowKeys.filter((k) => !lg[k.id]?.main).map((k) => k.id)).toEqual(['k-4-3']);
    expect(lg['k-0-1']).toEqual({ main: '1', shift: '!' });
    expect(lg['k-2-12'].main).toBe('Enter');
  });

  it('split: lewa QWERT, prawa YUIOP, wewnętrzna kolumna T i Y', () => {
    const p = split.params;
    const L = defaultLegends(split.id, p, splitLeft(p), 'left');
    const R = defaultLegends(split.id, p, mirrorKeys(splitLeft(p)), 'right');
    const inner = p.cols - 1;
    const top = p.rows >= 4 ? 1 : 0;
    expect(L[`k-${top}-${inner}`].main).toBe('T');
    expect(R[`k-${top}-${inner}`].main).toBe('Y');
    expect(L[`k-${top}-${inner - 4}`].main).toBe('Q');
    expect(R[`k-${top}-${inner - 4}`].main).toBe('P');
  });

  it('Dactyl: wewnętrzna kolumna T/Y, kciuki nazwane', () => {
    const m = buildDactyl(DACTYL_DEFAULT, { cellHeight: 8.58 });
    const L = dactylLegends(m.keys, DACTYL_DEFAULT.rows, 'left');
    const R = dactylLegends(m.keys, DACTYL_DEFAULT.rows, 'right');
    const k = m.keys.find((q) => q.col === 0 && q.row === 1)!;
    expect(L[k.id].main).toBe('T');
    expect(R[k.id].main).toBe('Y');
    expect(m.keys.filter((q) => q.thumb).every((q) => !!L[q.id].main)).toBe(true);
  });
});
