// SPDX-License-Identifier: AGPL-3.0-or-later
// Model układu: lista klawiszy z pozycją środka (mm), obrotem (stopnie) i rozmiarem (U).
// Oś Y w górę (widok z góry), Z w górę z płyty. Wszystkie wymiary w mm.

export const PITCH = 19.05;

export interface Key {
  id: string;
  /** środek klawisza, mm */
  x: number;
  y: number;
  /** obrót wokół środka, stopnie, przeciwnie do ruchu wskazówek zegara */
  rot: number;
  /** szerokość i wysokość w jednostkach U (1U = 19,05 mm) */
  w: number;
  h: number;
}

export interface SplitParams {
  rows: number;
  cols: number;
  /** przesunięcie kolumn w górę (mm), od zewnętrznej (0) do wewnętrznej */
  stagger: number[];
  /** liczba klawiszy kciukowych */
  thumbKeys: number;
  /**
   * Kolumna (od 0), pod którą zaczyna się klaster kciuka. Może być ułamkowa (krok 0,25):
   * 2,5 to połowa drogi między kolumną 2 a 3, a stagger jest wtedy interpolowany.
   */
  thumbAnchorCol: number;
  thumbOffsetX: number;
  thumbOffsetY: number;
  /** obrót całego klastra (stopnie, ujemny = w prawo, w stronę środka) */
  thumbAngle: number;
  /** dodatkowy obrót każdego kolejnego klawisza (wachlarz) */
  thumbSplay: number;
  /** szerokość ostatniego (najbardziej wewnętrznego) klawisza kciukowego w U */
  thumbLastWidth: number;
  /** obróć ostatni klawisz o 90° (pionowy 1,5U jak w Lily58) */
  thumbLastVertical: boolean;
  /** jedna płyta zamiast dwóch połówek (macropad): bez lustra i bez klastra kciuka */
  single?: boolean;
  /** dodatkowe klawisze poza siatką (np. obok wyspy) */
  extra?: ExtraKey[];
}

/**
 * Dodatkowy klawisz w jednostkach siatki: `col` to kolumna lewej krawędzi (0 = pierwsza),
 * `row` rząd (0 = górny, w dół rośnie, ułamki i wartości ujemne dozwolone).
 */
export interface ExtraKey {
  col: number;
  row: number;
  /** szerokość w U */
  w: number;
  /** obrót w stopniach */
  rot: number;
}

/** Szablon 4×6 + 4 kciukowe, płaski split z lekkim staggerem kolumn. */
export const SPLIT_4x6_4: SplitParams = {
  rows: 4,
  cols: 6,
  stagger: [0, 0, 4.76, 7.14, 4.76, 2.38],
  thumbKeys: 4,
  thumbAnchorCol: 2,
  thumbOffsetX: 0,
  thumbOffsetY: -PITCH - 2,
  thumbAngle: 0,
  thumbSplay: -8,
  thumbLastWidth: 1.5,
  thumbLastVertical: true,
};

export interface Template {
  id: string;
  name: { pl: string; en: string };
  params: SplitParams;
}

/** Macropad: prosta siatka bez staggera i bez kciuka, jedna płyta. */
const macropad = (rows: number, cols: number): SplitParams => ({
  ...SPLIT_4x6_4,
  rows,
  cols,
  stagger: Array(cols).fill(0),
  thumbKeys: 0,
  single: true,
});

/** Gotowe szablony splitu (proporcje wzorowane na popularnych klasach układów). */
export const TEMPLATES: Template[] = [
  {
    id: 'split-4x6-4',
    name: { pl: 'Split 4×6 + 4 kciukowe (58)', en: 'Split 4×6 + 4 thumb keys (58)' },
    params: SPLIT_4x6_4,
  },
  {
    id: 'split-4x6-5',
    name: { pl: 'Split 4×6 + 5 kciukowych (58 z enkoderem)', en: 'Split 4×6 + 5 thumb keys' },
    params: { ...SPLIT_4x6_4, thumbKeys: 5, thumbAnchorCol: 2, thumbSplay: -6, thumbLastWidth: 1, thumbLastVertical: false },
  },
  {
    id: 'split-3x6-3',
    name: { pl: 'Split 3×6 + 3 kciukowe (42)', en: 'Split 3×6 + 3 thumb keys (42)' },
    params: {
      ...SPLIT_4x6_4,
      rows: 3,
      thumbKeys: 3,
      thumbAnchorCol: 3.5,
      thumbOffsetY: -PITCH - 3,
      thumbSplay: -10,
      thumbLastWidth: 1.5,
      thumbLastVertical: true,
    },
  },
  {
    id: 'split-3x5-3',
    name: { pl: 'Split 3×5 + 3 kciukowe (36)', en: 'Split 3×5 + 3 thumb keys (36)' },
    params: {
      ...SPLIT_4x6_4,
      rows: 3,
      cols: 5,
      stagger: [0, 4.76, 7.14, 4.76, 2.38],
      thumbKeys: 3,
      thumbAnchorCol: 2.5,
      thumbOffsetY: -PITCH - 3,
      thumbSplay: -10,
      thumbLastWidth: 1,
      thumbLastVertical: false,
    },
  },
  {
    id: 'split-3x5-2',
    name: { pl: 'Split 3×5 + 2 kciukowe (34)', en: 'Split 3×5 + 2 thumb keys (34)' },
    params: {
      ...SPLIT_4x6_4,
      rows: 3,
      cols: 5,
      stagger: [0, 4.76, 7.14, 4.76, 2.38],
      thumbKeys: 2,
      thumbAnchorCol: 3,
      thumbOffsetY: -PITCH - 3,
      thumbSplay: -12,
      thumbLastWidth: 1,
      thumbLastVertical: false,
    },
  },
  { id: 'macropad-3x3', name: { pl: 'Macropad 3×3 (9)', en: 'Macropad 3×3 (9)' }, params: macropad(3, 3) },
  { id: 'macropad-3x4', name: { pl: 'Macropad 3×4 (12)', en: 'Macropad 3×4 (12)' }, params: macropad(3, 4) },
  { id: 'macropad-4x4', name: { pl: 'Macropad 4×4 (16)', en: 'Macropad 4×4 (16)' }, params: macropad(4, 4) },
  { id: 'macropad-5x4', name: { pl: 'Macropad 5×4, jak klawiatura numeryczna (20)', en: 'Macropad 5×4, numpad size (20)' }, params: macropad(5, 4) },
];

const rotPt = (x: number, y: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};

/**
 * Lewa połówka splitu. Kolumna 0 jest zewnętrzna (lewa krawędź), ostatnia wewnętrzna.
 * Rząd 0 to górny rząd (cyfry). Klaster kciuka idzie od kolumny `thumbAnchorCol` w prawo.
 */
export function splitLeft(p: SplitParams): Key[] {
  const keys: Key[] = [];
  for (let c = 0; c < p.cols; c++) {
    const st = p.stagger[c] ?? 0;
    for (let r = 0; r < p.rows; r++) {
      keys.push({
        id: `k-${r}-${c}`,
        x: c * PITCH,
        y: -r * PITCH + st,
        rot: 0,
        w: 1,
        h: 1,
      });
    }
  }

  // Klaster kciuka: łańcuch klawiszy, każdy kolejny obrócony o `thumbSplay` wokół
  // wspólnego narożnika (jak wachlarz w Ergogen). Przy wachlarzu w dół (splay < 0)
  // obracamy wokół dolnego narożnika, w górę wokół górnego, by klawisze się nie nakładały.
  const ac = Math.min(Math.max(p.thumbAnchorCol, 0), p.cols - 1);
  const c0 = Math.floor(ac);
  const c1 = Math.min(c0 + 1, p.cols - 1);
  const f = ac - c0;
  const st = (p.stagger[c0] ?? 0) * (1 - f) + (p.stagger[c1] ?? 0) * f;
  const anchorX = ac * PITCH + p.thumbOffsetX;
  const anchorY = -(p.rows - 1) * PITCH + st + p.thumbOffsetY;
  const pivotTop = p.thumbSplay >= 0;
  let angle = p.thumbAngle;
  // narożnik obrotu bieżącego klawisza (lewy górny albo lewy dolny), liczony dla 1U
  let [cx, cy] = rotPt(-PITCH / 2, pivotTop ? PITCH / 2 : -PITCH / 2, angle);
  cx += anchorX;
  cy += anchorY;
  for (let i = 0; i < p.thumbKeys; i++) {
    const last = i === p.thumbKeys - 1;
    let w = last ? p.thumbLastWidth : 1;
    let h = 1;
    if (last && p.thumbLastVertical) [w, h] = [1, p.thumbLastWidth];
    const rot = angle;
    // pionowy klawisz wyrównujemy górą do łańcucha (wystaje w dół)
    const toCenterY = pivotTop ? (-h * PITCH) / 2 : PITCH - (h * PITCH) / 2;
    const [dx, dy] = rotPt((w * PITCH) / 2, toCenterY, rot);
    keys.push({ id: `t-${i}`, x: cx + dx, y: cy + dy, rot, w, h });
    const [nx, ny] = rotPt(w * PITCH, 0, rot);
    cx += nx;
    cy += ny;
    angle += p.thumbSplay;
  }
  (p.extra ?? []).forEach((e, i) => {
    const w = Math.max(1, e.w || 1);
    keys.push({ id: `e-${i}`, x: e.col * PITCH + ((w - 1) * PITCH) / 2, y: -e.row * PITCH, rot: e.rot || 0, w, h: 1 });
  });
  return keys;
}

/** Prawa połówka: lustro pozycji lewej. Komórki NIE są lustrzane (gniazda hot-swap zostają w tej samej orientacji). */
export function mirrorKeys(keys: Key[]): Key[] {
  return keys.map((k) => ({ ...k, x: -k.x, rot: -k.rot }));
}

/** Prostokąt zajmowany przez klawisz (4 narożniki), mm. */
export function keyCorners(k: Key): [number, number][] {
  const hw = (k.w * PITCH) / 2;
  const hh = (k.h * PITCH) / 2;
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as [number, number][]
  ).map(([x, y]) => {
    const [rx, ry] = rotPt(x, y, k.rot);
    return [rx + k.x, ry + k.y];
  });
}

/** Sprawdza, czy dwa klawisze nachodzą na siebie (test osi rozdzielającej), z tolerancją. */
export function keysOverlap(a: Key, b: Key, tol = 0.01): boolean {
  return polysOverlap(keyCorners(a), keyCorners(b), tol);
}

/** Czy dwa wypukłe wielokąty zachodzą na siebie (test osi rozdzielającej); styk krawędzią się nie liczy. */
export function polysOverlap(pa: [number, number][], pb: [number, number][], tol = 0.01): boolean {
  for (const poly of [pa, pb]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1;
      const ny = x1 - x2;
      const len = Math.hypot(nx, ny);
      const proj = (p: [number, number][]) => p.map(([x, y]) => (x * nx + y * ny) / len);
      const A = proj(pa);
      const B = proj(pb);
      if (Math.max(...A) <= Math.min(...B) + tol || Math.max(...B) <= Math.min(...A) + tol) return false;
    }
  }
  return true;
}
