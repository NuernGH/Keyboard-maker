// Legendy na nakładkach: układ warstw (Główna/Shift/AltGr/Fn) na górze nakładki i kontury liter z czcionki.
// Bez zależności od OpenCascade: kontury to wielokąty w mm, bryły robi keycap.ts.

import type { Font } from 'opentype.js';

export const LEGEND_LAYERS = ['main', 'shift', 'altgr', 'fn'] as const;
export type LegendLayer = (typeof LEGEND_LAYERS)[number];
/** Legendy jednego klawisza: tekst na warstwę (pusty / brak = bez legendy). */
export type LegendSet = Partial<Record<LegendLayer, string>>;
/** Legendy wszystkich klawiszy, klucz `${strona}:${id}` (np. `left:k-1-2`), patrz {@link legendRef}. */
export type LegendMap = Record<string, LegendSet>;

export const legendRef = (side: 'left' | 'right', id: string) => `${side}:${id}`;

/**
 * Sposób wykonania legendy:
 * `groove` = rowek na farbę (każdy druk, jedyny przy druku na boku),
 * `color` = wypukła legenda w drugim kolorze, jedna zmiana filamentu (M600) na wysokości góry nakładki;
 * tylko płaska góra drukowana górą do góry (na misie warstwy mieszałyby oba kolory).
 */
export type LegendMethod = 'groove' | 'color';

export interface LegendParams {
  /** wysokość wielkiej litery legendy głównej (mm) */
  mainSize: number;
  /** wysokość wielkiej litery legend pomocniczych: Shift, AltGr, Fn (mm) */
  subSize: number;
  /** głębokość rowka (mm) */
  depth: number;
  /** wysokość wypukłej legendy w kolorze (mm) */
  raise: number;
  /** odstęp legendy od krawędzi góry nakładki (mm) */
  margin: number;
}

export const DEFAULT_LEGEND: LegendParams = { mainSize: 4, subSize: 2.6, depth: 0.6, raise: 0.6, margin: 1.2 };

/** Minimalne szerokości kreski dla dyszy 0,4 (mm): rowek, którego slicer nie zaleje, i dwie ścieżki legendy wypukłej. */
export const LEGEND_MIN_STROKE: Record<LegendMethod, number> = { groove: 0.5, color: 0.8 };

/** Wysokość wielkiej litery w jednostkach em (Noto Sans: 714/1000). */
export function capHeightEm(font: Font): number {
  const os2 = (font.tables as { os2?: { sCapHeight?: number } }).os2;
  return os2?.sCapHeight ? os2.sCapHeight / font.unitsPerEm : 0.714;
}

/** Przybliżona grubość kreski (mm) pogrubionej czcionki dla danej wysokości wielkiej litery: pionowa kreska „I”. */
export function strokeWidth(font: Font, capH: number): number {
  const em = capH / capHeightEm(font);
  const g = font.charToGlyph('I');
  const bb = g.getBoundingBox();
  return ((bb.x2 - bb.x1) / font.unitsPerEm) * em;
}

/** Kontur litery: wielokąt w mm (x w prawo, y od użytkownika), bez powtórzonego pierwszego punktu. */
export type Contour = [number, number][];

/**
 * Kontury tekstu o wysokości wielkiej litery `capH` (mm), wyśrodkowane w (0, 0) wg obrysu.
 * Krzywe dzielone na odcinki nie dłuższe niż ok. `tol` mm.
 */
export function textContours(font: Font, text: string, capH: number, tol = 0.08): { contours: Contour[]; width: number; height: number } {
  const size = capH / capHeightEm(font);
  const path = font.getPath(text, 0, 0, size);
  const contours: Contour[] = [];
  let cur: Contour = [];
  let px = 0;
  let py = 0;
  const push = (x: number, y: number) => {
    cur.push([x, -y]);
    px = x;
    py = y;
  };
  const steps = (len: number) => Math.max(2, Math.min(24, Math.ceil(len / tol / 4)));
  for (const c of path.commands) {
    if (c.type === 'M') {
      if (cur.length > 2) contours.push(cur);
      cur = [];
      push(c.x, c.y);
    } else if (c.type === 'L') push(c.x, c.y);
    else if (c.type === 'Q') {
      const n = steps(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x - c.x1, c.y - c.y1));
      const [x0, y0] = [px, py];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const d = t * t;
        push(a * x0 + b * c.x1 + d * c.x, a * y0 + b * c.y1 + d * c.y);
      }
    } else if (c.type === 'C') {
      const n = steps(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2));
      const [x0, y0] = [px, py];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        push(
          u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        );
      }
    } else if (c.type === 'Z') {
      if (cur.length > 2) contours.push(cur);
      cur = [];
    }
  }
  if (cur.length > 2) contours.push(cur);
  // usuń powtórzone punkty (zamknięcie konturu, odcinki zerowej długości)
  const clean = contours
    .map((ct) => ct.filter((q, i) => { const r = ct[(i + 1) % ct.length]; return Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-4; }))
    .filter((ct) => ct.length > 2 && Math.abs(area(ct)) > 1e-4);
  if (!clean.length) return { contours: [], width: 0, height: 0 };
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ct of clean) for (const [x, y] of ct) [x1, y1, x2, y2] = [Math.min(x1, x), Math.min(y1, y), Math.max(x2, x), Math.max(y2, y)];
  const [cx, cy] = [(x1 + x2) / 2, (y1 + y2) / 2];
  return { contours: clean.map((ct) => ct.map(([x, y]) => [x - cx, y - cy] as [number, number])), width: x2 - x1, height: y2 - y1 };
}

/** Pole ze znakiem (dodatnie = przeciwnie do ruchu wskazówek zegara). */
export function area(ct: Contour): number {
  let s = 0;
  for (let i = 0; i < ct.length; i++) {
    const [ax, ay] = ct[i];
    const [bx, by] = ct[(i + 1) % ct.length];
    s += ax * by - bx * ay;
  }
  return s / 2;
}

function inside(pt: [number, number], ct: Contour): boolean {
  let r = false;
  for (let i = 0, j = ct.length - 1; i < ct.length; j = i++) {
    const [xi, yi] = ct[i];
    const [xj, yj] = ct[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

/**
 * Głębokość zagnieżdżenia konturów (0 = zewnętrzny, 1 = otwór, 2 = wyspa w otworze …), wg reguły parzystości.
 * Zwraca kontury posortowane od najpłytszych.
 */
export function nestContours(contours: Contour[]): { contour: Contour; depth: number }[] {
  const out = contours.map((c) => {
    // punkt próbny: środek pierwszego odcinka przesunięty minimalnie w głąb (nie na krawędzi innych konturów)
    const probe: [number, number] = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
    const depth = contours.filter((o) => o !== c && Math.abs(area(o)) > Math.abs(area(c)) && inside(probe, o)).length;
    return { contour: c, depth };
  });
  return out.sort((a, b) => a.depth - b.depth);
}

/** Legenda ułożona na górze nakładki: środek obrysu tekstu (x, y) w mm względem środka góry, wysokość wielkiej litery. */
export interface PlacedLegend {
  layer: LegendLayer;
  text: string;
  x: number;
  y: number;
  /** wysokość wielkiej litery (mm), po ewentualnym zmniejszeniu, by tekst zmieścił się na górze */
  size: number;
}

/**
 * Układ legend na górze nakładki o wymiarach `tw` × `th` (mm):
 * Główna na środku (z legendą Shift: w lewym dolnym rogu), Shift w lewym górnym, Fn w prawym górnym,
 * AltGr w prawym dolnym. Za długi tekst jest zmniejszany, by zmieścił się w swojej części góry.
 */
export function legendLayout(font: Font, set: LegendSet, tw: number, th: number, lp: LegendParams = DEFAULT_LEGEND): PlacedLegend[] {
  const out: PlacedLegend[] = [];
  const m = lp.margin;
  const hasCorner = !!(set.shift || set.altgr || set.fn);
  const fit = (text: string, size: number, maxW: number, maxH: number) => {
    const { width, height } = textContours(font, text, size, 0.2);
    const k = Math.min(1, width > 0 ? maxW / width : 1, height > 0 ? maxH / height : 1);
    const s = size * k;
    const t = textContours(font, text, s, 0.2);
    return { size: s, width: t.width, height: t.height };
  };
  const halfW = tw / 2 - m;
  const halfH = th / 2 - m;
  const corner = (layer: LegendLayer, sx: number, sy: number) => {
    const text = set[layer];
    if (!text) return;
    // róg: połowa szerokości (dłuższe nakładki: do połowy), wysokość do ok. połowy góry
    const f = fit(text, lp.subSize, Math.max(halfW, 2), Math.max(halfH - 0.3, 1.5));
    out.push({ layer, text, size: f.size, x: sx * (halfW - f.width / 2), y: sy * (halfH - f.height / 2) });
  };
  if (set.main) {
    if (set.shift) {
      const f = fit(set.main, lp.mainSize, Math.max(halfW, 2), Math.max(halfH - 0.3, 1.5));
      out.push({ layer: 'main', text: set.main, size: f.size, x: -(halfW - f.width / 2), y: -(halfH - f.height / 2) });
    } else {
      // na środku; przy innych legendach zostaw miejsce na rogi
      const maxW = hasCorner ? tw - 2 * m - 2 * 0.4 * halfW : tw - 2 * m;
      const f = fit(set.main, lp.mainSize, Math.max(maxW, 2), hasCorner ? Math.max(th - 2 * m - 2 * lp.subSize, 1.5) : th - 2 * m);
      out.push({ layer: 'main', text: set.main, size: f.size, x: 0, y: 0 });
    }
  }
  corner('shift', -1, 1);
  corner('fn', 1, 1);
  corner('altgr', 1, -1);
  return out;
}

/** Kontury wszystkich legend klawisza ułożone na górze nakładki `tw` × `th`. */
export function keyLegendContours(font: Font, set: LegendSet, tw: number, th: number, lp: LegendParams = DEFAULT_LEGEND): Contour[] {
  return legendLayout(font, set, tw, th, lp).flatMap((l) =>
    textContours(font, l.text, l.size).contours.map((c) => c.map(([x, y]) => [x + l.x, y + l.y] as [number, number])),
  );
}

/** Czy klawisz ma jakąkolwiek legendę. */
export const hasLegend = (set: LegendSet | undefined) => !!set && LEGEND_LAYERS.some((l) => !!set[l]?.trim());
