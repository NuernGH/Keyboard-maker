// SPDX-License-Identifier: AGPL-3.0-or-later
// Dodatki w obudowie (opcje, domyślnie wyłączone): włącznik baterii, gniazdo kabla między połówkami
// (TRRS albo USB-C) i bateria LiPo. Uproszczone modele części (pudełka z wymiarów kart katalogowych
// i typowych chińskich wersji), wybór miejsca przy ściance, wycięcia w ściance, kieszenie w płycie
// i w dnie. Tu same liczby; bryły buduje geometry.ts.
//
// Część przy ściance opisujemy w układzie lokalnym: u wzdłuż ścianki (0 = środek części),
// v od wewnętrznej powierzchni ścianki w głąb obudowy (ujemne = w ściance i na zewnątrz),
// w w górę od spodu części (spód leży na dnie obudowy albo w kieszeni w dnie).

import { PITCH, keyCorners, polysOverlap, type Key } from './layout';
import type { Box, GhostPart, IslandGeom } from './island';
import { USB_PLUG } from './island';
import { distToSeam, type PrintSplit } from './split';

/** Ścianka: tył, przód, wewnętrzna (do drugiej połówki; w 60% i macropadzie prawa), zewnętrzna. */
export type WallSide = 'back' | 'front' | 'inner' | 'outer';

export interface WallPartParams {
  on: boolean;
  side: WallSide;
  /** miejsce wzdłuż ścianki, 0–100 % (od lewej przy tyle i przodzie, od tyłu przy bokach; prawa połówka w lustrze) */
  pos: number;
}

export type LinkKind = 'trrs' | 'usbc';

export interface BatteryParams {
  on: boolean;
  /** wymiary ogniwa razem z płytką zabezpieczenia (mm): długość, szerokość, grubość */
  l: number;
  w: number;
  t: number;
}

export interface CaseExtras {
  /** włącznik baterii SS-12D00 */
  power?: WallPartParams;
  /** gniazdo kabla między połówkami (tylko split) */
  link?: WallPartParams & { kind: LinkKind };
  /** bateria LiPo w kieszeni w dnie */
  battery?: BatteryParams;
}

export const DEFAULT_EXTRAS: Required<CaseExtras> = {
  power: { on: false, side: 'back', pos: 60 },
  // przy wewnętrznej krawędzi tylnej ścianki (jak w większości splitów); wewnętrzną ściankę zajmuje zwykle wyspa i kciuk
  link: { on: false, side: 'back', pos: 90, kind: 'trrs' },
  battery: { on: false, l: 34, w: 12.5, t: 4.2 },
};

/** Popularne ogniwa (wymiary z płytką zabezpieczenia, zaokrąglone w górę). */
export const BATTERY_PRESETS: { id: string; name: string; l: number; w: number; t: number }[] = [
  { id: '301230', name: '301230 · 110 mAh (3 × 12 × 30)', l: 34, w: 12.5, t: 3.2 },
  { id: '401230', name: '401230 · 110 mAh (4 × 12 × 30, Akyga)', l: 34, w: 12.5, t: 4.2 },
  { id: '401730', name: '30 × 17 × 4 · 175 mAh (Akyga)', l: 31, w: 17.5, t: 4.2 },
  { id: '304030', name: '40 × 30 × 3 · 320 mAh (Akyga)', l: 41, w: 30.5, t: 3.2 },
  { id: '404530', name: '45 × 30 × 4 · 450 mAh (Akyga)', l: 46, w: 30.5, t: 4.2 },
];

/** Bryła części w układzie lokalnym (u, v, w). */
interface LBox {
  kind: GhostPart['kind'];
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  w0: number;
  w1: number;
}
/** Wycięcie w ściance: prostopadłościan albo walec wzdłuż v (oś w punkcie u = 0, w = wc). */
type LCut = { type: 'box'; u0: number; u1: number; v0: number; v1: number; w0: number; w1: number } | { type: 'cyl'; r: number; wc: number; v0: number; v1: number };

interface PartSpec {
  name: string;
  /** bryły części (podgląd i sprawdzanie kolizji) */
  body: LBox[];
  /** wycięcia w ściance (v liczone od wewnętrznej powierzchni ścianki; `wall` = grubość ścianki) */
  cuts: (wall: number) => LCut[];
}

/**
 * Włącznik suwakowy SS-12D00G4 (3 nóżki THT, korpus ok. 8,6 × 3,6 × 3,6, dźwignia 1,5 mm, długość 4 mm,
 * skok ok. 2 mm). Leży na boku: dźwignia przez szczelinę w ściance, nóżki do środka (przewody lutowane).
 * Korpus trzyma kieszeń w płycie od góry i dno od dołu.
 */
export const POWER_SWITCH = { body: [8.6, 3.6, 3.6], lever: 1.5, leverLen: 4, travel: 2, slot: [5, 2] } as const;
/** Gniazdo TRRS PJ-320A: korpus 6 × 12 × 5, tulejka Ø5 × 2 z przodu, otwór Ø6,2, wgłębienie Ø9 na wtyk. */
export const TRRS_JACK = { w: 6, l: 12, h: 5, barrel: 5, barrelLen: 2, hole: 6.2, counter: 9, counterDepth: 1 } as const;
/**
 * Gniazdo USB-C na płytce 16P (z D+ i D−): płytka ok. 10,5 × 13 × 1,6, gniazdo 8,94 × 7,35 × 3,26 na brzegu
 * płytki. Gniazdo wchodzi 1,2 mm w ściankę; otwór w ściance na wtyk z obudową (jak przy kontrolerze).
 */
export const USBC_BOARD = { w: 10.5, l: 13, pcb: 1.6, sockW: 8.94, sockL: 7.35, sockH: 3.26, inWall: 1.2, parts: 0.8 } as const;

const SPECS: Record<'power' | LinkKind, PartSpec> = {
  power: (() => {
    const [L, D, H] = POWER_SWITCH.body;
    const lv = POWER_SWITCH.lever / 2;
    const wc = H / 2;
    return {
      name: 'SS-12D00',
      body: [
        { kind: 'switch', u0: -L / 2, u1: L / 2, v0: 0, v1: D, w0: 0, w1: H },
        { kind: 'knob', u0: -lv, u1: lv, v0: -POWER_SWITCH.leverLen, v1: 0, w0: wc - lv, w1: wc + lv },
        // nóżki z przylutowanymi przewodami
        { kind: 'usb', u0: -2.8, u1: 2.8, v0: D, v1: D + 3.5, w0: wc - 0.8, w1: wc + 0.8 },
      ],
      cuts: (wall) => [
        { type: 'box', u0: -POWER_SWITCH.slot[0] / 2, u1: POWER_SWITCH.slot[0] / 2, v0: -wall - 1, v1: 0.3, w0: wc - POWER_SWITCH.slot[1] / 2, w1: wc + POWER_SWITCH.slot[1] / 2 },
      ],
    };
  })(),
  trrs: (() => {
    const j = TRRS_JACK;
    const wc = j.h / 2;
    return {
      name: 'PJ-320A',
      body: [
        { kind: 'jack', u0: -j.w / 2, u1: j.w / 2, v0: 0, v1: j.l, w0: 0, w1: j.h },
        // tulejka Ø5 jako pudełko wpisane w otwór Ø6,2 (do sprawdzania kolizji)
        { kind: 'usb', u0: -2.1, u1: 2.1, v0: -j.barrelLen, v1: 0, w0: wc - 2.1, w1: wc + 2.1 },
      ],
      cuts: (wall) => [
        { type: 'cyl', r: j.hole / 2, wc, v0: -wall - 1, v1: 0.3 },
        { type: 'cyl', r: j.counter / 2, wc, v0: -wall - 1, v1: -wall + j.counterDepth },
      ],
    };
  })(),
  usbc: (() => {
    const b = USBC_BOARD;
    const v0 = -b.inWall;
    const wc = b.pcb + b.sockH / 2;
    return {
      name: 'USB-C 16P',
      body: [
        { kind: 'pcb', u0: -b.w / 2, u1: b.w / 2, v0, v1: v0 + b.l, w0: 0, w1: b.pcb },
        { kind: 'usb', u0: -b.sockW / 2, u1: b.sockW / 2, v0, v1: v0 + b.sockL, w0: b.pcb, w1: b.pcb + b.sockH },
        // drobne elementy i luty na płytce za gniazdem
        { kind: 'pcb', u0: -b.w / 2 + 0.5, u1: b.w / 2 - 0.5, v0: v0 + b.sockL, v1: v0 + b.l, w0: b.pcb, w1: b.pcb + b.parts },
      ],
      cuts: (wall) => [
        { type: 'box', u0: -USB_PLUG.w / 2, u1: USB_PLUG.w / 2, v0: -wall - 2, v1: 0.3, w0: wc - USB_PLUG.h / 2, w1: wc + USB_PLUG.h / 2 },
      ],
    };
  })(),
};

/** Luz kieszeni wokół części (mm), najcieńsze dno pod kieszenią, najcieńsza płyta nad kieszenią, odstęp od komórek w pionie. */
export const EXTRA_FIT = { clearance: 0.3, minFloor: 0.8, minSkin: 1.2, belowCells: 0.2, batteryPocket: 1, batteryGap: 0.5 };

/** Wycięcie w ściance w układzie świata: prostopadłościan albo walec (oś pozioma, kierunek `dir`). */
export type ExtraCut =
  | { type: 'box'; box: Box }
  | { type: 'cyl'; r: number; from: [number, number, number]; dir: [number, number, number]; len: number };

/** noSpot: brak miejsca, tooTall: za mało miejsca w pionie, moved: przesunięte wzdłuż ścianki, otherSide: na innej ściance (`side`). */
export type ExtraWarn = { part: 'power' | 'link' | 'battery'; kind: 'noSpot' | 'tooTall' | 'moved' | 'otherSide'; side?: WallSide };

export interface ExtrasLayout {
  /** bryły części do podglądu (w układzie obudowy) */
  ghosts: GhostPart[];
  /** wycięcia w ściance */
  wallCuts: ExtraCut[];
  /** kieszenie w dnie (od dna w dół) */
  floorPockets: Box[];
  /** kieszenie od spodu płyty (tylko w pasie bez komórek) */
  platePockets: Box[];
  /** obszary XY, których mają unikać śruby, podpory i gzyms */
  keepouts: Box[];
  warns: ExtraWarn[];
}

export const emptyExtras = (): ExtrasLayout => ({ ghosts: [], wallCuts: [], floorPockets: [], platePockets: [], keepouts: [], warns: [] });

export function hasExtras(e: CaseExtras | undefined): boolean {
  return !!(e && (e.power?.on || e.link?.on || e.battery?.on));
}

interface Ctx {
  keys: Key[];
  island: IslandGeom | null;
  /** odsunięcie wewnętrznej powierzchni ścianki od klawiszy: margines płyty + luz */
  reach: number;
  wall: number;
  cellHeight: number;
  floorTop: number;
  floor: number;
  split: PrintSplit | null;
  /** obszary zajęte (wyspa, wycięcia USB kontrolera, już ustawione części) */
  busy: Box[];
}

const rectPoly = (b: { x0: number; y0: number; x1: number; y1: number }): [number, number][] => [
  [b.x0, b.y0],
  [b.x1, b.y0],
  [b.x1, b.y1],
  [b.x0, b.y1],
];
const grow = (b: Box, d: number): Box => ({ ...b, x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
const xyOverlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Czy prostokąt XY zachodzi na któryś klawisz (komórkę pod płytą). */
function overCells(keys: Key[], b: Box, tol = 0.3): boolean {
  const p = rectPoly(grow(b, tol));
  return keys.some((k) => polysOverlap(keyCorners(k), p));
}

/** Kierunki ścianki: n na zewnątrz, t wzdłuż (dla prawej połówki w lustrze, żeby pozycje się odbijały). */
function frame(side: WallSide, half: 'left' | 'right'): { n: [number, number]; t: [number, number] } {
  const m = half === 'right' ? -1 : 1;
  switch (side) {
    case 'back':
      return { n: [0, 1], t: [m, 0] };
    case 'front':
      return { n: [0, -1], t: [m, 0] };
    case 'inner':
      return { n: [m, 0], t: [0, -1] };
    case 'outer':
      return { n: [-m, 0], t: [0, -1] };
  }
}

const STEP = 0.25;

/**
 * Obwiednia obrysu od strony ścianki: dla każdego a (współrzędna wzdłuż t) największe s = p·n
 * obrysu klawiszy i wyspy powiększonego o promień r (zaokrąglone narożniki jak offset w CAD).
 */
function envelope(ctx: Ctx, n: [number, number], t: [number, number], r: number): { a0: number; env: Float64Array } {
  const polys = ctx.keys.map(keyCorners);
  if (ctx.island) polys.push(rectPoly(ctx.island.rect));
  const pts: [number, number][] = [];
  for (const poly of polys)
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const k = Math.max(1, Math.ceil(len / STEP));
      for (let j = 0; j < k; j++) {
        const f = j / k;
        const x = x1 + (x2 - x1) * f;
        const y = y1 + (y2 - y1) * f;
        pts.push([x * t[0] + y * t[1], x * n[0] + y * n[1]]);
      }
    }
  const amin = Math.min(...pts.map((p) => p[0])) - r;
  const amax = Math.max(...pts.map((p) => p[0])) + r;
  const N = Math.ceil((amax - amin) / STEP) + 1;
  const env = new Float64Array(N).fill(-Infinity);
  for (const [pa, ps] of pts) {
    const i0 = Math.max(0, Math.ceil((pa - r - amin) / STEP));
    const i1 = Math.min(N - 1, Math.floor((pa + r - amin) / STEP));
    for (let i = i0; i <= i1; i++) {
      const da = amin + i * STEP - pa;
      const s = ps + Math.sqrt(Math.max(r * r - da * da, 0));
      if (s > env[i]) env[i] = s;
    }
  }
  return { a0: amin, env };
}

interface Placed {
  ghosts: GhostPart[];
  cuts: ExtraCut[];
  floor: Box[];
  plate: Box[];
  foot: Box;
  sink: number;
  dist: number;
}

/** Bryła lokalna → pudełko w świecie (n i t równoległe do osi). */
function toWorld(n: [number, number], t: [number, number], a: number, W: number, z0: number, b: { u0: number; u1: number; v0: number; v1: number; w0: number; w1: number }): Box {
  // punkt = t·(a + u) + n·(W − v)
  const xs = [b.u0, b.u1].flatMap((u) => [b.v0, b.v1].map((v) => t[0] * (a + u) + n[0] * (W - v)));
  const ys = [b.u0, b.u1].flatMap((u) => [b.v0, b.v1].map((v) => t[1] * (a + u) + n[1] * (W - v)));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: z0 + b.w0, z1: z0 + b.w1 };
}

function footOf(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
    z0: Math.min(...boxes.map((b) => b.z0)),
    z1: Math.max(...boxes.map((b) => b.z1)),
  };
}

/**
 * Ustawia część przy ściance: szuka najbliżej żądanego miejsca odcinka prostej ścianki, gdzie część nie
 * zachodzi na wyspę, wycięcia USB kontrolera, inne części ani szwy podziału. Gdzie część wchodzi pod
 * komórki, musi zmieścić się pod nimi: wtedy kieszeń w dnie (najwyżej do EXTRA_FIT.minFloor dna).
 * Część w pasie bez komórek może sięgać w kieszeń od spodu płyty.
 */
function placeWallPart(ctx: Ctx, spec: PartSpec, pp: WallPartParams, half: 'left' | 'right'): { placed: Placed | null; tooTall: boolean } {
  const { n, t } = frame(pp.side, half);
  const { a0, env } = envelope(ctx, n, t, ctx.reach);
  const uMin = Math.min(...spec.body.map((b) => b.u0));
  const uMax = Math.max(...spec.body.map((b) => b.u1));
  const cutU = spec.cuts(ctx.wall).map((c) => (c.type === 'box' ? Math.max(-c.u0, c.u1) : c.r));
  const hw = Math.max(-uMin, uMax, ...cutU) + 1;
  const iw = Math.ceil(hw / STEP);
  const valid: number[] = [];
  for (let i = iw; i < env.length - iw; i++) {
    if (!Number.isFinite(env[i - iw]) || !Number.isFinite(env[i + iw])) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - iw; j <= i + iw; j++) {
      lo = Math.min(lo, env[j]);
      hi = Math.max(hi, env[j]);
    }
    if (hi - lo <= 0.15) valid.push(i);
  }
  if (!valid.length) return { placed: null, tooTall: false };
  // żądane miejsce: procent zakresu obwiedni (bez zaokrąglonych końców)
  const finite = [...env.keys()].filter((i) => Number.isFinite(env[i]));
  const lo = finite[0] + iw;
  const hi = finite[finite.length - 1] - iw;
  const want = lo + ((hi - lo) * Math.min(Math.max(pp.pos, 0), 100)) / 100;
  const order = [...valid].sort((p, q) => Math.abs(p - want) - Math.abs(q - want));
  const maxSink = Math.max(ctx.floor - EXTRA_FIT.minFloor, 0);
  let tooTall = false;
  for (const i of order) {
    const a = a0 + i * STEP;
    let W = -Infinity;
    for (let j = i - iw; j <= i + iw; j++) W = Math.max(W, env[j]);
    const local = spec.body.map((b) => toWorld(n, t, a, W, 0, b));
    const foot = footOf(local);
    if (ctx.busy.some((b) => xyOverlap(grow(foot, 1), b))) continue;
    if (ctx.split && ([foot.x0, foot.x1].some((x) => Math.abs(x - ctx.split!.caseX) < 2) || (foot.x0 < ctx.split.caseX && foot.x1 > ctx.split.caseX))) continue;
    if (ctx.split && rectPoly(foot).some(([x, y]) => distToSeam(ctx.split!, x, y) < 2)) continue;
    // zanurzenie: bryły nad komórkami muszą zejść pod spód komórek
    let base = ctx.floorTop;
    for (const [k, b] of spec.body.entries())
      if (overCells(ctx.keys, local[k])) base = Math.min(base, -ctx.cellHeight - EXTRA_FIT.belowCells - b.w1);
    const sink = ctx.floorTop - base;
    if (sink > maxSink + 1e-6) {
      tooTall = true;
      continue;
    }
    const world = spec.body.map((b) => toWorld(n, t, a, W, base, b));
    // kieszeń od spodu płyty dla brył sięgających nad spód płyty (tylko poza komórkami)
    const plate: Box[] = [];
    let skinOk = true;
    for (const b of world) {
      if (b.z1 + EXTRA_FIT.clearance <= -ctx.cellHeight) continue;
      if (b.z1 + EXTRA_FIT.clearance > -EXTRA_FIT.minSkin) skinOk = false;
      // kieszeń sięga do krawędzi płyty (część wystaje za nią w stronę ścianki)
      plate.push({ ...grow(b, EXTRA_FIT.clearance), z0: -ctx.cellHeight - 1, z1: b.z1 + EXTRA_FIT.clearance });
    }
    if (!skinOk) {
      tooTall = true;
      continue;
    }
    const cuts: ExtraCut[] = spec.cuts(ctx.wall).map((c) => {
      if (c.type === 'box') return { type: 'box', box: toWorld(n, t, a, W, base, c) };
      // walec: od v1 w stronę ścianki (kierunek n)
      const from: [number, number, number] = [t[0] * a + n[0] * (W - c.v1), t[1] * a + n[1] * (W - c.v1), base + c.wc];
      return { type: 'cyl', r: c.r, from, dir: [n[0], n[1], 0], len: c.v1 - c.v0 };
    });
    // kieszeń w dnie tylko po wewnętrznej stronie ścianki (w ściance robi miejsce jej wycięcie)
    const floor =
      sink > 1e-6
        ? spec.body
            .filter((b) => b.v1 > 0)
            .map((b) => ({ ...grow(toWorld(n, t, a, W, base, { ...b, v0: Math.max(b.v0, 0) }), EXTRA_FIT.clearance), z0: base, z1: ctx.floorTop + 0.01 }))
        : [];
    const ghosts = world.map((box, k) => ({ kind: spec.body[k].kind, box }));
    return { placed: { ghosts, cuts, floor, plate, foot: { ...foot, z0: base, z1: base + foot.z1 }, sink, dist: Math.abs(i - want) * STEP }, tooTall };
  }
  return { placed: null, tooTall };
}

/**
 * Bateria: kieszeń w dnie pod komórkami (cały obrys pod klawiszami), jak najbliżej kontrolera (krótkie
 * przewody), z dala od wyspy, części przy ściankach i szwów. Kieszeń ma co najmniej EXTRA_FIT.batteryPocket mm,
 * żeby ogniwo się nie przesuwało; głębiej, gdy ogniwo nie mieści się pod komórkami.
 */
function placeBattery(ctx: Ctx, bp: BatteryParams): { placed: Placed | null; tooTall: boolean } {
  const g = EXTRA_FIT.batteryGap;
  const free = -ctx.cellHeight - EXTRA_FIT.belowCells - ctx.floorTop;
  const sink = Math.max(EXTRA_FIT.batteryPocket, bp.t - free);
  const maxSink = Math.max(ctx.floor - EXTRA_FIT.minFloor, 0);
  if (sink > maxSink + 1e-6) return { placed: null, tooTall: true };
  const inside = (x: number, y: number) =>
    ctx.keys.some((k) => {
      const a = (-k.rot * Math.PI) / 180;
      const dx = x - k.x;
      const dy = y - k.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      return Math.abs(lx) <= (k.w * PITCH) / 2 + 1e-6 && Math.abs(ly) <= (k.h * PITCH) / 2 + 1e-6;
    });
  const xs = ctx.keys.flatMap((k) => keyCorners(k).map((c) => c[0]));
  const ys = ctx.keys.flatMap((k) => keyCorners(k).map((c) => c[1]));
  const target: [number, number] = ctx.island
    ? [(ctx.island.rect.x0 + ctx.island.rect.x1) / 2, (ctx.island.rect.y0 + ctx.island.rect.y1) / 2]
    : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  // kandydaci od najbliższego kontrolerowi; pierwszy pasujący wygrywa
  const cand: [number, number, number, number, number][] = [];
  for (const [L, Wd] of [
    [bp.l, bp.w],
    [bp.w, bp.l],
  ])
    for (let cx = Math.min(...xs); cx <= Math.max(...xs); cx += 1)
      for (let cy = Math.min(...ys); cy <= Math.max(...ys); cy += 1)
        cand.push([Math.hypot(cx - target[0], cy - target[1]) + (L < Wd ? 0.01 : 0), cx, cy, L, Wd]);
  cand.sort((p, q) => p[0] - q[0]);
  let best: Placed | null = null;
  for (const [d, cx, cy, L, Wd] of cand) {
    const b: Box = { x0: cx - L / 2 - g, x1: cx + L / 2 + g, y0: cy - Wd / 2 - g, y1: cy + Wd / 2 + g, z0: 0, z1: 0 };
    if (ctx.busy.some((o) => xyOverlap(grow(b, 1), o))) continue;
    if (ctx.split && b.x0 < ctx.split.caseX + 3 && b.x1 > ctx.split.caseX - 3) continue;
    // cały obrys kieszeni pod klawiszami (tam jest jednakowe miejsce nad dnem)
    const nx = Math.ceil((b.x1 - b.x0) / 2);
    const ny = Math.ceil((b.y1 - b.y0) / 2);
    let ok = true;
    for (let i = 0; i <= nx && ok; i++)
      for (let j = 0; j <= ny && ok; j++) if (!inside(b.x0 + ((b.x1 - b.x0) * i) / nx, b.y0 + ((b.y1 - b.y0) * j) / ny)) ok = false;
    if (!ok) continue;
    const base = ctx.floorTop - sink;
    const cell: Box = { x0: cx - L / 2, x1: cx + L / 2, y0: cy - Wd / 2, y1: cy + Wd / 2, z0: base, z1: base + bp.t };
    best = {
      ghosts: [{ kind: 'battery', box: cell }],
      cuts: [],
      floor: [{ ...b, z0: base, z1: ctx.floorTop + 0.01 }],
      plate: [],
      foot: { ...b, z0: base, z1: base + bp.t },
      sink,
      dist: d,
    };
    break;
  }
  return { placed: best, tooTall: false };
}

/**
 * Rozmieszcza dodatki dla jednej połówki. `busy` to obszary XY zajęte już przez wyspę i wycięcia USB.
 * Kolejność: włącznik, gniazdo, bateria (każda następna omija poprzednie).
 */
export function layoutExtras(
  extras: CaseExtras | undefined,
  o: {
    keys: Key[];
    island: IslandGeom | null;
    reach: number;
    wall: number;
    cellHeight: number;
    floorTop: number;
    floor: number;
    split: PrintSplit | null;
    usbCuts: Box[];
    half: 'left' | 'right';
    single: boolean;
  },
): ExtrasLayout {
  const out = emptyExtras();
  if (!extras || !hasExtras(extras)) return out;
  const busy: Box[] = [];
  if (o.island) busy.push({ ...o.island.rect, z0: 0, z1: 0 });
  busy.push(...o.usbCuts);
  const ctx: Ctx = { keys: o.keys, island: o.island, reach: o.reach, wall: o.wall, cellHeight: o.cellHeight, floorTop: o.floorTop, floor: o.floor, split: o.split, busy };
  const add = (part: ExtraWarn['part'], r: { placed: Placed | null; tooTall: boolean }) => {
    if (!r.placed) {
      out.warns.push({ part, kind: r.tooTall ? 'tooTall' : 'noSpot' });
      return;
    }
    const p = r.placed;
    if (part !== 'battery' && p.dist > 10) out.warns.push({ part, kind: 'moved' });
    out.ghosts.push(...p.ghosts);
    out.wallCuts.push(...p.cuts);
    out.floorPockets.push(...p.floor);
    out.platePockets.push(...p.plate);
    out.keepouts.push(p.foot, ...p.cuts.filter((c): c is Extract<ExtraCut, { type: 'box' }> => c.type === 'box').map((c) => c.box));
    busy.push(grow(p.foot, 1));
  };
  // gdy na wybranej ściance nie ma miejsca, próbujemy kolejnych (z ostrzeżeniem)
  const wallPart = (part: 'power' | 'link', spec: PartSpec, pp: WallPartParams) => {
    const sides = [...new Set<WallSide>([pp.side, 'back', 'outer', 'front', 'inner'])];
    let tooTall = false;
    for (const side of sides) {
      const r = placeWallPart(ctx, spec, { ...pp, side }, o.half);
      tooTall ||= r.tooTall;
      if (!r.placed) continue;
      if (side !== pp.side) out.warns.push({ part, kind: 'otherSide', side });
      add(part, r);
      return;
    }
    add(part, { placed: null, tooTall });
  };
  if (extras.power?.on) wallPart('power', SPECS.power, extras.power);
  if (extras.link?.on && !o.single) wallPart('link', SPECS[extras.link.kind] ?? SPECS.trrs, extras.link);
  if (extras.battery?.on) add('battery', placeBattery(ctx, extras.battery));
  return out;
}

/** Nazwa części do opisu (panel, ostrzeżenia). */
export const partName = (k: 'power' | LinkKind) => SPECS[k].name;