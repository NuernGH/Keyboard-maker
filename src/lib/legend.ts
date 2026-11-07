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
  /** wysokość legendy głównej, gdy nad nią jest legenda Shift (mm; cyfry z symbolem) */
  shiftMainSize?: number;
  /** wysokość wielkiej litery legend pomocniczych: Shift, AltGr, Fn na przedniej ściance (mm) */
  subSize: number;
  /** głębokość rowka (mm) */
  depth: number;
  /** wysokość wypukłej legendy w kolorze (mm) */
  raise: number;
  /** odstęp legendy od krawędzi góry nakładki (mm) */
  margin: number;
}

/**
 * Układ pod dyszę 0,4 (plan nakładek, „Układ legend pod dyszę 0,4 mm”): Noto Sans Black, główna 5 mm
 * (z Shift 4,4), Shift i AltGr 3,6 na górze, Fn 3,6 na przedniej ściance.
 */
export const DEFAULT_LEGEND: LegendParams = { mainSize: 5, shiftMainSize: 4.4, subSize: 3.6, depth: 0.6, raise: 0.6, margin: 0.9 };

/** Minimalne szerokości kreski dla dyszy 0,4 (mm): rowek, którego slicer nie zaleje, i jedna linia legendy wypukłej. */
export const LEGEND_MIN_STROKE: Record<LegendMethod, number> = { groove: 0.5, color: 0.45 };

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

/**
 * Legenda ułożona na nakładce: środek obrysu tekstu (x, y) w mm i wysokość wielkiej litery.
 * `face: 'top'` (domyślnie): względem środka góry, +y od użytkownika;
 * `face: 'front'`: na przedniej ściance, względem jej środka, x w prawo, +y w górę wzdłuż ścianki.
 */
export interface PlacedLegend {
  layer: LegendLayer;
  text: string;
  x: number;
  y: number;
  /** wysokość wielkiej litery (mm), po ewentualnym zmniejszeniu, by tekst zmieścił się na swoim polu */
  size: number;
  face?: 'top' | 'front';
}

/**
 * Układ legend (plan, dysza 0,4): na górze `tw` × `th` główna w lewym górnym rogu (dłuższy napis:
 * przy lewej krawędzi na środku wysokości), Shift nad główną w lewym górnym (główna schodzi wtedy
 * do lewego dolnego i ma `shiftMainSize`), AltGr w prawym dolnym. Fn na przedniej ściance `front`
 * (szerokość × wysokość pola, mm), wyśrodkowana; bez `front` w prawym górnym rogu góry.
 * Za długi tekst jest zmniejszany, by zmieścił się na swoim polu.
 */
export function legendLayout(font: Font, set: LegendSet, tw: number, th: number, lp: LegendParams = DEFAULT_LEGEND, front?: [number, number]): PlacedLegend[] {
  const out: PlacedLegend[] = [];
  const m = lp.margin;
  const fit = (text: string, size: number, maxW: number, maxH: number) => {
    const { width, height } = textContours(font, text, size, 0.2);
    const k = Math.min(1, width > 0 ? maxW / width : 1, height > 0 ? maxH / height : 1);
    const s = size * k;
    const t = textContours(font, text, s, 0.2);
    return { size: s, width: t.width, height: t.height };
  };
  const W = tw - 2 * m;
  const H = th - 2 * m;
  const left = (w: number) => -tw / 2 + m + w / 2;
  const right = (w: number) => tw / 2 - m - w / 2;
  const top = (h: number) => th / 2 - m - h / 2;
  const bottom = (h: number) => -th / 2 + m + h / 2;
  const sub = lp.subSize;
  const shift = set.shift && set.shift !== set.main ? set.shift : '';
  const altgr = set.altgr ?? '';
  if (shift) {
    const f = fit(shift, sub, W, H / 2 - 0.3);
    out.push({ layer: 'shift', text: shift, size: f.size, x: left(f.width), y: top(f.height) });
  }
  if (set.main) {
    const size = shift ? (lp.shiftMainSize ?? lp.mainSize) : lp.mainSize;
    // obok AltGr (prawy dolny) zostaje miejsce tylko na pół wysokości
    const f = fit(set.main, size, W, shift || altgr ? H - Math.min(sub, H / 2) - 0.3 : H);
    const long = [...set.main].length > 1 && !shift && !altgr;
    out.push({ layer: 'main', text: set.main, size: f.size, x: left(f.width), y: shift ? bottom(f.height) : long ? 0 : top(f.height) });
  }
  if (altgr) {
    const f = fit(altgr, sub, W / 2, H / 2 - 0.3);
    out.push({ layer: 'altgr', text: altgr, size: f.size, x: right(f.width), y: bottom(f.height) });
  }
  if (set.fn) {
    if (front) {
      const [fw, fh] = front;
      const f = fit(set.fn, sub, Math.max(fw, 1), Math.max(fh, 1));
      out.push({ layer: 'fn', text: set.fn, size: f.size, x: 0, y: 0, face: 'front' });
    } else {
      const f = fit(set.fn, sub, W / 2, H / 2 - 0.3);
      out.push({ layer: 'fn', text: set.fn, size: f.size, x: right(f.width), y: top(f.height) });
    }
  }
  return out;
}

/** Kontury legend klawisza, osobno na górze (mm od środka góry) i na przedniej ściance (mm od środka ścianki). */
export function placedContours(font: Font, placed: PlacedLegend[]): { top: Contour[]; front: Contour[] } {
  const out = { top: [] as Contour[], front: [] as Contour[] };
  for (const l of placed)
    out[l.face === 'front' ? 'front' : 'top'].push(
      ...textContours(font, l.text, l.size).contours.map((c) => c.map(([x, y]) => [x + l.x, y + l.y] as [number, number])),
    );
  return out;
}

/** Kontury wszystkich legend klawisza ułożone na górze nakładki `tw` × `th` (bez przedniej ścianki). */
export function keyLegendContours(font: Font, set: LegendSet, tw: number, th: number, lp: LegendParams = DEFAULT_LEGEND): Contour[] {
  return placedContours(font, legendLayout(font, set, tw, th, lp)).top;
}

/** Czy klawisz ma jakąkolwiek legendę. */
export const hasLegend = (set: LegendSet | undefined) => !!set && LEGEND_LAYERS.some((l) => !!set[l]?.trim());

/**
 * Kontrola drukowalności (plan, „Sprawdzenie drukowalności legend”): otwarcie morfologiczne kołem o średnicy
 * minimalnej kreski. Fragmenty liter, które po otwarciu znikają (poza samymi narożnikami), są za cienkie dla dyszy.
 * Zwraca udział za cienkiej powierzchni i obrys tych fragmentów jako ścieżkę SVG (y w górę → w dół).
 */
export function thinCheck(contours: Contour[], minStroke: number, res = 0.04): { fraction: number; path: string } {
  if (!contours.length) return { fraction: 0, path: '' };
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of contours) for (const [x, y] of c) [x1, y1, x2, y2] = [Math.min(x1, x), Math.min(y1, y), Math.max(x2, x), Math.max(y2, y)];
  const pad = minStroke;
  x1 -= pad;
  y1 -= pad;
  const nx = Math.ceil((x2 + pad - x1) / res);
  const ny = Math.ceil((y2 + pad - y1) / res);
  const inside = new Uint8Array(nx * ny);
  // wypełnienie wierszami (reguła parzystości)
  for (let j = 0; j < ny; j++) {
    const y = y1 + (j + 0.5) * res;
    const xs: number[] = [];
    for (const c of contours)
      for (let i = 0, k = c.length - 1; i < c.length; k = i++) {
        const [ax, ay] = c[i];
        const [bx, by] = c[k];
        if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - x1) / res - 0.5));
      const i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - x1) / res - 0.5));
      for (let i = i0; i <= i1; i++) inside[j * nx + i] = 1;
    }
  }
  const r = Math.max(1, Math.round(minStroke / 2 / res));
  const disk: [number, number][] = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r) disk.push([di, dj]);
  const at = (a: Uint8Array, i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && a[j * nx + i] === 1;
  const eroded = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) if (inside[j * nx + i] && disk.every(([di, dj]) => at(inside, i + di, j + dj))) eroded[j * nx + i] = 1;
  const opened = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) if (eroded[j * nx + i]) for (const [di, dj] of disk) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny) opened[b * nx + a] = 1; }
  // Ostre narożniki też znikają przy otwarciu, choć kreska jest gruba (dysza je tylko zaokrągli). Narożnik
  // prosty odstaje od otwartego kształtu najwyżej o r(√2 − 1) ≈ 0,41 r, więc liczymy tylko to, co jest dalej
  // niż 0,5 r od otwartego kształtu: zostają kreski węższe od dyszy i bardzo ostre szpice.
  const rr = Math.max(1, Math.round(0.5 * r));
  const near = new Uint8Array(nx * ny);
  const ring: [number, number][] = [];
  for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) if (di * di + dj * dj <= rr * rr) ring.push([di, dj]);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) if (opened[j * nx + i]) for (const [di, dj] of ring) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny) near[b * nx + a] = 1; }
  let total = 0;
  let thin = 0;
  let path = '';
  for (let j = 0; j < ny; j++) {
    let run = -1;
    for (let i = 0; i <= nx; i++) {
      const t = i < nx && inside[j * nx + i] === 1 && near[j * nx + i] === 0;
      if (i < nx && inside[j * nx + i]) total++;
      if (t) thin++;
      if (t && run < 0) run = i;
      if (!t && run >= 0) {
        const x = x1 + run * res;
        const yTop = -(y1 + (j + 1) * res);
        path += `M${x.toFixed(3)},${yTop.toFixed(3)}h${((i - run) * res).toFixed(3)}v${res.toFixed(3)}h${(-(i - run) * res).toFixed(3)}z`;
        run = -1;
      }
    }
  }
  return { fraction: total ? thin / total : 0, path };
}

/**
 * Udział za cienkiej powierzchni legendy, od którego panel i eksport ostrzegają. Bez narożników dobre układy
 * mają 0–0,5 %; „a” 2,5 mm Noto Sans Black ma ok. 2,6 %, „e” 2,5 mm ok. 11 %.
 */
export const THIN_WARN = 0.02;
