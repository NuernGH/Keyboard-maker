// SPDX-License-Identifier: AGPL-3.0-or-later
// Pomiar kontrolera z modelu użytkownika (STEP po zamianie na trójkąty albo STL).
//
// Model kładziemy płasko (najkrótsza oś obrysu = w górę, najdłuższa = wzdłuż płytki) i robimy
// z niego mapę wysokości widzianą z góry (siatka 0,2 mm): w każdym polu najwyższy i najniższy
// punkt. Z mapy odczytujemy płytkę (dwie największe poziome płaszczyzny = spód i wierzch),
// gniazda USB (wysokie elementy przy krótkim końcu), rzędy pinów (małe otwory w płytce)
// i otwory montażowe (większe otwory parami). Wynik to liczby `Controller`, które użytkownik
// potwierdza w formularzu, oraz siatka modelu ułożona jak modele w public/controllers.
import type { Controller } from './island';

export interface MeasureOptions {
  /** mnożnik jednostek (STL nie zapisuje jednostek; 25,4 = cale, 0,001 … itp.) */
  scale?: number;
  /** odwróć górę i dół (gdy zgadywanie strony z elementami się pomyliło) */
  flip?: boolean;
  /** zamień oś wzdłuż i w poprzek płytki */
  swap?: boolean;
  /** po której stronie (końcu osi wzdłuż) jest USB; auto = szukaj */
  usbEnd?: 'auto' | '+' | '-';
  /** rozdzielczość mapy wysokości (mm) */
  res?: number;
}

export interface MeasuredPort {
  /** szerokość gniazda (mm) */
  w: number;
  /** środek względem osi płytki (mm) */
  center: number;
  /** góra i spód gniazda nad spodem płytki (mm) */
  top: number;
  bottom: number;
  /** ile wystaje poza krawędź płytki */
  overhang: number;
}

export interface MeasureResult {
  controller: Controller;
  ports: MeasuredPort[];
  /** ostrzeżenia dla użytkownika (klucze tłumaczeń z wartościami) */
  warnings: { key: string; value?: number }[];
  /** obrys całego modelu po ułożeniu (mm): w poprzek, wzdłuż, w górę */
  bbox: [number, number, number];
  /** koniec osi wzdłuż (po ułożeniu), na którym jest USB */
  usbEnd: '+' | '-';
  /** czy wykryto płytkę (dwie poziome płaszczyzny) */
  boardFound: boolean;
  /** element najwyżej nad płytką leży poza gniazdem USB (np. przycisk) — docisk naciśnie na niego */
  tallestNotUsb: boolean;
  /** ile model sięga pod spód płytki (piny, łapki), mm */
  below: number;
  /** mapa wysokości do rysunku w panelu (nad spodem płytki; NaN = pusto), USB u góry obrazka */
  map: { nx: number; ny: number; res: number; top: Float32Array; board: [number, number, number, number] };
  /** siatka modelu: X w poprzek (0 = oś płytki), Y w górę (0 = spód płytki), Z wzdłuż (0 = dalszy koniec, USB w +Z) */
  positions: Float32Array;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Zamienia siatkę z indeksami na „zupę” trójkątów (9 liczb na trójkąt).
 */
export function unindex(vertices: ArrayLike<number>, triangles: ArrayLike<number>): Float32Array {
  const out = new Float32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    const v = triangles[i] * 3;
    out[3 * i] = vertices[v];
    out[3 * i + 1] = vertices[v + 1];
    out[3 * i + 2] = vertices[v + 2];
  }
  return out;
}

/** Odczyt STL (binarny lub tekstowy) jako zupa trójkątów. */
export function parseSTL(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + 50 * n === buf.byteLength) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[9 * i + k] = dv.getFloat32(84 + 50 * i + 12 + 4 * k, true);
      return out;
    }
  }
  const text = new TextDecoder().decode(buf);
  const vs: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) vs.push(+m[1], +m[2], +m[3]);
  if (!vs.length || vs.length % 9) throw new Error('STL bez trójkątów');
  return new Float32Array(vs);
}

/** Etykietowanie spójnych obszarów (4-sąsiedztwo) w masce nx × ny (indeks x * ny + y). */
function label(mask: Uint8Array, nx: number, ny: number): { lab: Int32Array; n: number } {
  const lab = new Int32Array(nx * ny);
  let n = 0;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || lab[s]) continue;
    lab[s] = ++n;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = Math.floor(i / ny);
      const y = i - x * ny;
      const nb = [x > 0 ? i - ny : -1, x < nx - 1 ? i + ny : -1, y > 0 ? i - 1 : -1, y < ny - 1 ? i + 1 : -1];
      for (const j of nb)
        if (j >= 0 && mask[j] && !lab[j]) {
          lab[j] = n;
          stack.push(j);
        }
    }
  }
  return { lab, n };
}

interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cells: number[];
}
function regions(mask: Uint8Array, nx: number, ny: number): Region[] {
  const { lab, n } = label(mask, nx, ny);
  const out: Region[] = Array.from({ length: n }, () => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, cells: [] }));
  for (let i = 0; i < lab.length; i++) {
    if (!lab[i]) continue;
    const r = out[lab[i] - 1];
    const x = Math.floor(i / ny);
    const y = i - x * ny;
    r.x0 = Math.min(r.x0, x);
    r.x1 = Math.max(r.x1, x);
    r.y0 = Math.min(r.y0, y);
    r.y1 = Math.max(r.y1, y);
    r.cells.push(i);
  }
  return out;
}

/**
 * Mierzy kontroler z trójkątów (9 liczb na trójkąt, mm po przemnożeniu przez `scale`).
 */
export function measureController(tris: Float32Array, name: string, opts: MeasureOptions = {}): MeasureResult {
  const scale = opts.scale ?? 1;
  const RES = opts.res ?? 0.2;
  const nT = Math.floor(tris.length / 9);
  if (!nT) throw new Error('Model jest pusty');
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nT * 3; i++)
    for (let k = 0; k < 3; k++) {
      const v = tris[3 * i + k] * scale;
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  const ext = [0, 1, 2].map((k) => hi[k] - lo[k]);
  const warnings: MeasureResult['warnings'] = [];
  const maxExt = Math.max(...ext);
  if (maxExt < 8 || maxExt > 200) warnings.push({ key: 'mUnits', value: r2(maxExt) });

  // osie: najkrótsza = w górę, najdłuższa = wzdłuż
  const order = [0, 1, 2].sort((a, b) => ext[a] - ext[b]);
  const up = order[0];
  let along = order[2];
  let across = order[1];
  if (opts.swap) [along, across] = [across, along];
  // układ prawoskrętny: (a, l, u); gdy trzeba, odbijamy a (model kontrolera jest symetryczny tylko z grubsza,
  // więc zamiast odbicia obracamy: a → −a razem z l → −l nie zmienia skrętności)
  const P = new Float32Array(nT * 9);
  const axes = [across, along, up];
  const det = (() => {
    const e = (i: number) => [0, 1, 2].map((k) => (k === axes[i] ? 1 : 0));
    const [a, b, c] = [e(0), e(1), e(2)];
    return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  })();
  const sa = det < 0 ? -1 : 1;
  for (let i = 0; i < nT * 3; i++) {
    P[3 * i] = sa * (tris[3 * i + across] * scale - (sa > 0 ? lo[across] : hi[across]));
    P[3 * i + 1] = tris[3 * i + along] * scale - lo[along];
    P[3 * i + 2] = tris[3 * i + up] * scale - lo[up];
  }
  const W = ext[across];
  const L = ext[along];
  const H = ext[up];
  const flipUD = () => {
    // obrót o 180° wokół osi wzdłuż: u → H − u, a → W − a
    for (let i = 0; i < nT * 3; i++) {
      P[3 * i] = W - P[3 * i];
      P[3 * i + 2] = H - P[3 * i + 2];
    }
  };

  // płytka: poziome ścianki ważone polem, histogram wysokości co 0,05 mm
  const BIN = 0.05;
  const nb = Math.ceil(H / BIN) + 2;
  const hist = new Float64Array(nb);
  for (let t = 0; t < nT; t++) {
    const o = 9 * t;
    const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2];
    const vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12 || Math.abs(nz) / len < 0.99) continue;
    const z = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
    hist[Math.min(nb - 1, Math.max(0, Math.floor(z / BIN)))] += len / 2;
  }
  const idx = [...hist.keys()].sort((a, b) => hist[b] - hist[a]);
  let zb = 0;
  let zt = Math.min(1.6, H);
  let boardFound = false;
  if (hist[idx[0]] > 0) {
    const p1 = idx[0];
    const p2 = idx.find((i) => hist[i] > 0.2 * hist[p1] && Math.abs(i - p1) * BIN > 0.3 && Math.abs(i - p1) * BIN < 3.5);
    if (p2 !== undefined) {
      // grubość płytki zaokrąglamy do 0,05 (środki przedziałów)
      zb = Math.min(p1, p2) * BIN;
      zt = zb + Math.round((Math.abs(p1 - p2) * BIN) / BIN) * BIN;
      boardFound = true;
    }
  }
  if (!boardFound) warnings.push({ key: 'mNoBoard' });
  // strona z elementami do góry: więcej materiału nad płytką niż pod nią
  let flipped = H - zt < zb;
  if (opts.flip) flipped = !flipped;
  if (flipped) {
    flipUD();
    [zb, zt] = [H - zt, H - zb];
  }

  // mapa wysokości
  const nx = Math.ceil(W / RES) + 2;
  const ny = Math.ceil(L / RES) + 2;
  const top = new Float32Array(nx * ny).fill(-Infinity);
  const bot = new Float32Array(nx * ny).fill(Infinity);
  for (let t = 0; t < nT; t++) {
    const o = 9 * t;
    const e = Math.max(
      Math.hypot(P[o + 3] - P[o], P[o + 4] - P[o + 1]),
      Math.hypot(P[o + 6] - P[o], P[o + 7] - P[o + 1]),
      Math.hypot(P[o + 6] - P[o + 3], P[o + 7] - P[o + 4]),
    );
    const k = Math.min(600, Math.max(1, Math.ceil((e / RES) * 1.5)));
    for (let i = 0; i <= k; i++)
      for (let j = 0; j <= k - i; j++) {
        const u = i / k;
        const v = j / k;
        const w = 1 - u - v;
        const x = w * P[o] + u * P[o + 3] + v * P[o + 6];
        const y = w * P[o + 1] + u * P[o + 4] + v * P[o + 7];
        const z = w * P[o + 2] + u * P[o + 5] + v * P[o + 8];
        const c = Math.floor(x / RES) * ny + Math.floor(y / RES);
        if (z > top[c]) top[c] = z;
        if (z < bot[c]) bot[c] = z;
      }
  }
  const occ = (i: number) => top[i] > -Infinity;

  // obrys płytki: wiersze, w których płytka ma prawie pełną szerokość
  const isBoard = new Uint8Array(nx * ny);
  for (let i = 0; i < isBoard.length; i++) isBoard[i] = occ(i) && bot[i] < zb + 0.15 && top[i] >= zt - 0.15 ? 1 : 0;
  const rowW = new Int32Array(ny);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) rowW[y] += isBoard[x * ny + y];
  const maxRow = Math.max(...rowW);
  const rows = [...rowW].map((v) => v >= 0.85 * maxRow && v > 0);
  const nRows = rows.filter(Boolean).length;
  const colW = new Int32Array(nx);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) if (rows[y]) colW[x] += isBoard[x * ny + y];
  const cols = [...colW].map((v) => v >= 0.6 * nRows && v > 0);
  let bx0 = cols.indexOf(true);
  let bx1 = cols.lastIndexOf(true);
  let by0 = rows.indexOf(true);
  let by1 = rows.lastIndexOf(true);
  if (bx0 < 0 || by0 < 0) {
    // bez płytki: cały obrys
    bx0 = 0;
    bx1 = Math.floor(W / RES);
    by0 = 0;
    by1 = Math.floor(L / RES);
  }
  // oś płytki: środek wykrytej płytki; gdy płytka zajmuje prawie cały obrys, środek obrysu (dokładniejszy niż siatka)
  const boardW = (bx1 - bx0 + 1) * RES;
  const bcx = Math.abs(boardW - W) < 0.5 ? W / 2 : ((bx0 + bx1 + 1) / 2) * RES;
  const yBot = by0 * RES;
  const yTop = (by1 + 1) * RES;

  // gniazda USB: wysokie elementy (> płytka + 1,5 mm; gniazdo we wcięciu płytki wystaje tylko ~2 mm) przy końcu płytki, 5–13 mm szerokości
  const findPorts = (end: '+' | '-'): { ports: (MeasuredPort & { cells: number[] })[]; score: number } => {
    const mask = new Uint8Array(nx * ny);
    const s0 = end === '+' ? by1 - Math.round(3 / RES) : 0;
    const s1 = end === '+' ? ny - 1 : by0 + Math.round(3 / RES);
    for (let x = 0; x < nx; x++)
      for (let y = Math.max(0, s0); y <= Math.min(ny - 1, s1); y++) {
        const i = x * ny + y;
        if (occ(i) && top[i] > zt + 1.5) mask[i] = 1;
      }
    const ports: (MeasuredPort & { cells: number[] })[] = [];
    for (const r of regions(mask, nx, ny)) {
      const w = (r.x1 - r.x0 + 1) * RES;
      if (w < 5 || w > 13) continue;
      let t = -Infinity;
      let b = Infinity;
      for (const i of r.cells) {
        t = Math.max(t, top[i]);
        // spód gniazda tylko z części wystającej poza płytkę (z zapasem jednego pola na krawędź płytki)
        const y = i % ny;
        if (y > by1 + 1 || y < by0 - 1) b = Math.min(b, bot[i]);
      }
      const ov = end === '+' ? (r.y1 - by1) * RES : (by0 - r.y0) * RES;
      const c = ((r.x0 + r.x1 + 1) / 2) * RES - bcx;
      ports.push({
        w: r2(w),
        // środek patrząc od strony elementów, z USB u góry (przy USB z końca „−” obracamy o 180°)
        center: r2(end === '+' ? c : -c),
        top: r2(t - zb),
        bottom: r2((b === Infinity ? zt : b) - zb),
        overhang: r2(Math.max(0, ov)),
        cells: r.cells,
      });
    }
    const score = ports.reduce((s, p) => s + p.w + (p.overhang > 0.3 ? 10 : 0), 0);
    return { ports: ports.sort((a, b) => a.center - b.center), score };
  };
  let usbEnd: '+' | '-';
  let found: ReturnType<typeof findPorts>;
  if (opts.usbEnd === '+' || opts.usbEnd === '-') {
    usbEnd = opts.usbEnd;
    found = findPorts(usbEnd);
  } else {
    const a = findPorts('+');
    const b = findPorts('-');
    [usbEnd, found] = b.score > a.score ? ['-', b] : ['+', a];
  }
  if (!found.ports.length) warnings.push({ key: 'mNoUsb' });

  // najwyższy punkt nad płytką i to, czy leży w gnieździe USB
  let tMax = -Infinity;
  let tMaxCell = -1;
  let bMin = Infinity;
  for (let i = 0; i < top.length; i++) {
    if (!occ(i)) continue;
    if (top[i] > tMax) {
      tMax = top[i];
      tMaxCell = i;
    }
    bMin = Math.min(bMin, bot[i]);
  }
  const usbCells = new Set(found.ports.flatMap((p) => p.cells));
  const usbTop = Math.max(-Infinity, ...found.ports.map((p) => p.top + zb));
  const tallestNotUsb = found.ports.length > 0 && !usbCells.has(tMaxCell) && tMax > usbTop + 0.05;
  const below = Math.max(0, zb - bMin);
  if (below > 0.6) warnings.push({ key: 'mBelow', value: r2(below) });

  // obrys w osi płytki: szerokość symetryczna wokół osi, długość od krawędzi z USB do dalszego końca modelu
  let aMax = 0;
  for (let i = 0; i < nT * 3; i++) aMax = Math.max(aMax, Math.abs(P[3 * i] - bcx));
  const lFar = usbEnd === '+' ? 0 : L;
  const usbEdge = usbEnd === '+' ? yTop : yBot;
  const h = Math.abs(usbEdge - lFar);
  const w = Math.max(2 * aMax, Math.min(boardW, W));

  // piny i otwory: puste pola w środku płytki
  const holeMask = new Uint8Array(nx * ny);
  for (let x = bx0 + 2; x <= bx1 - 2; x++) for (let y = by0 + 2; y <= by1 - 2; y++) if (!occ(x * ny + y)) holeMask[x * ny + y] = 1;
  const small: { u: number; v: number }[] = [];
  const big: { u: number; v: number; d: number }[] = [];
  for (const r of regions(holeMask, nx, ny)) {
    const d = (Math.max(r.x1 - r.x0, r.y1 - r.y0) + 1) * RES;
    const u = ((r.x0 + r.x1 + 1) / 2) * RES - bcx;
    const yc = ((r.y0 + r.y1 + 1) / 2) * RES;
    const v = usbEnd === '+' ? yTop - yc : yc - yBot;
    if (d >= 0.6 && d < 1.6) small.push({ u, v });
    else if (d >= 1.6 && d <= 3.6) big.push({ u, v, d });
  }
  let pins: Controller['pins'];
  {
    const counts = new Map<number, number>();
    for (const p of small) {
      const k = Math.round(Math.abs(p.u) * 4) / 4;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // rząd = co najmniej 4 otwory po każdej stronie; sąsiednie (±0,25) łączymy
    const cand = [...counts.entries()].filter(([, n]) => n >= 8).map(([k]) => k).sort((a, b) => a - b);
    const xs: number[] = [];
    for (const k of cand) {
      const near = small.filter((p) => Math.abs(Math.abs(p.u) - k) <= 0.3);
      const mean = near.reduce((s, p) => s + Math.abs(p.u), 0) / near.length;
      if (!xs.length || mean - xs[xs.length - 1] > 0.6) xs.push(mean);
    }
    if (xs.length) {
      const inRows = small.filter((p) => xs.some((x) => Math.abs(Math.abs(p.u) - x) <= 0.4));
      pins = {
        x: xs.map(r2),
        y0: r2(Math.min(...inRows.map((p) => p.v))),
        y1: r2(Math.max(...inRows.map((p) => p.v))),
      };
    } else warnings.push({ key: 'mNoPins' });
  }
  const holes: NonNullable<Controller['holes']> = [];
  for (const hl of big) {
    if (hl.u < 0) continue;
    const pair = big.find((o) => o !== hl && Math.abs(o.u + hl.u) < 0.4 && Math.abs(o.v - hl.v) < 0.4);
    if (pair && hl.u > 1) holes.push({ x: r2((hl.u - pair.u) / 2), y: r2((hl.v + pair.v) / 2), d: r2(Math.min(hl.d, pair.d)) });
  }

  // liczby kontrolera
  const ports = found.ports;
  const pcb = r2(zt - zb);
  const height = r2(Math.max(tMax - zb, pcb));
  const narrow = ports.length > 0 && Math.max(...ports.map((p) => p.w)) < 8.2;
  const usbBottom = ports.length ? Math.min(...ports.map((p) => p.bottom)) : pcb;
  const controller: Controller = {
    name,
    w: Math.ceil(w * 20) / 20,
    h: Math.ceil(h * 20) / 20,
    height: Math.ceil(height * 20) / 20,
    usbOverhang: ports.length ? r2(Math.max(...ports.map((p) => p.overhang))) : 0,
    usbW: narrow ? 9 : 10,
    usbH: narrow ? 4.6 : 5.4,
    pcb,
  };
  if (Math.abs(usbBottom - pcb) > 0.1) controller.usbZ0 = r2(usbBottom);
  if (ports.length > 1 || (ports.length === 1 && Math.abs(ports[0].center) > 0.3)) controller.ports = ports.map((p) => p.center);
  if (pins) controller.pins = pins;
  if (holes.length) controller.holes = holes;

  // siatka w układzie modeli podglądu: X od osi płytki (patrząc od elementów, USB „u góry”), Y od spodu płytki, Z od dalszego końca do USB
  const positions = new Float32Array(nT * 9);
  for (let i = 0; i < nT * 3; i++) {
    const a = P[3 * i] - bcx;
    const l = P[3 * i + 1];
    const u = P[3 * i + 2] - zb;
    // dla USB w „+” oś wzdłuż już wskazuje USB; X = −a, żeby (X, Y, Z) było prawoskrętne przy Y w górę i Z do USB
    positions[3 * i] = usbEnd === '+' ? -a : a;
    positions[3 * i + 1] = u;
    positions[3 * i + 2] = usbEnd === '+' ? l - lFar : lFar - l;
  }

  // mapa do rysunku: USB zawsze u góry obrazka
  const img = new Float32Array(nx * ny);
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      const src = x * ny + (usbEnd === '+' ? y : ny - 1 - y);
      const xx = usbEnd === '+' ? x : nx - 1 - x;
      img[xx * ny + y] = occ(src) ? top[src] - zb : NaN;
    }
  const mb: [number, number, number, number] =
    usbEnd === '+' ? [bx0, bx1, by0, by1] : [nx - 1 - bx1, nx - 1 - bx0, ny - 1 - by1, ny - 1 - by0];

  return {
    controller,
    ports: ports.map(({ cells: _c, ...p }) => p),
    warnings,
    bbox: [r2(W), r2(L), r2(H)],
    usbEnd,
    boardFound,
    tallestNotUsb,
    below: r2(below),
    map: { nx, ny, res: RES, top: img, board: mb },
    positions,
  };
}
