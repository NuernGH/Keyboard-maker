// SPDX-License-Identifier: AGPL-3.0-or-later
// Bryła nakładki (keycap) pod Cherry MX, profil własny: niska nakładka z misą kulistą albo płaską górą.
// Układ jak komórka: środek klawisza w (0, 0), wierzch płyty z = 0, nakładka w spoczynku.

import { drawRoundedRectangle, makeBox, makeCylinder, makeSphere, type Shape3D, type Sketch } from 'replicad';
import { cutMany } from './geometry';
import {
  CALIBRATION_CLEARANCES,
  CAP_LIMITS,
  MX,
  STEM,
  capBottom,
  capLevels,
  topInset,
  type CapType,
  type KeycapParams,
} from './keycap-spec';

const roundRect = (w: number, h: number, r: number, z: number) =>
  drawRoundedRectangle(w, h, Math.max(0.05, Math.min(r, w / 2 - 0.05, h / 2 - 0.05))).sketchOnPlane('XY', z) as Sketch;

/** Ścięty ostrosłup o zaokrąglonych narożach między dwoma poziomami. */
function frustum(w0: number, h0: number, r0: number, z0: number, w1: number, h1: number, r1: number, z1: number): Shape3D {
  return roundRect(w0, h0, r0, z0).loftWith(roundRect(w1, h1, r1, z1), { ruled: true }) as Shape3D;
}

/** Zewnętrzny obrys nakładki (bez misy i wnętrza): do szybkich testów kolizji. */
export function keycapHull(p: KeycapParams, w: number, h: number): Shape3D {
  const L = capLevels(p);
  const [bw, bh] = capBottom(p, w, h);
  const ins = topInset(p);
  return frustum(bw, bh, p.radius, L.z0, bw - 2 * ins, bh - 2 * ins, p.radius, L.topEdge);
}

/** Wycięcie krzyża trzpienia (z luzem), środek w (x, y). `turned` obraca krzyż o 90° (trzpień stabilizatora w pionowym klawiszu). */
function crossCut(p: KeycapParams, x: number, y: number, z0: number, z1: number, turned: boolean): Shape3D[] {
  const c = p.clearance;
  const len = MX.crossLen + c;
  const ax = (turned ? MX.crossY : MX.crossX) + c; // grubość ramienia biegnącego wzdłuż X
  const ay = (turned ? MX.crossX : MX.crossY) + c; // grubość ramienia biegnącego wzdłuż Y
  return [
    makeBox([x - len / 2, y - ax / 2, z0], [x + len / 2, y + ax / 2, z1]),
    makeBox([x - ay / 2, y - len / 2, z0], [x + ay / 2, y + len / 2, z1]),
  ];
}

/** Misa: kula (1U) albo „kapsuła” wzdłuż dłuższego boku (dłuższe nakładki), brzeg na środku krótszych krawędzi góry. */
function dishTool(p: KeycapParams, tw: number, th: number, topLow: number): Shape3D | null {
  if (p.top !== 'dish' || p.dish <= 0.01) return null;
  const a = Math.min(tw, th) / 2;
  const d = p.dish;
  const R = (a * a + d * d) / (2 * d);
  const zc = topLow + R;
  const along = tw >= th;
  const half = (Math.max(tw, th) - Math.min(tw, th)) / 2;
  const at = (s: number): [number, number, number] => (along ? [s, 0, zc] : [0, s, zc]);
  let tool = makeSphere(R).translate(...at(-half)) as Shape3D;
  if (half > 0.01) {
    tool = tool.fuse(makeSphere(R).translate(...at(half))) as Shape3D;
    tool = tool.fuse(makeCylinder(R, 2 * half, at(-half), along ? [1, 0, 0] : [0, 1, 0])) as Shape3D;
  }
  return tool;
}

/** Nakładka danego typu w spoczynku (układ klawisza). */
export function buildKeycap(p: KeycapParams, type: CapType): Shape3D {
  const L = capLevels(p);
  const { w, h } = type;
  const [bw, bh] = capBottom(p, w, h);
  const ins = topInset(p);
  const tw = bw - 2 * ins;
  const th = bh - 2 * ins;
  let body = frustum(bw, bh, p.radius, L.z0, tw, th, p.radius, L.topEdge);

  // wnętrze: od dolnej krawędzi zwęża się do sufitu, żeby po wciśnięciu ominąć obudowę przełącznika
  const iw = bw - 2 * p.wall;
  const ih = bh - 2 * p.wall;
  const ri = Math.max(0.3, p.radius - p.wall);
  const tp = CAP_LIMITS.cavityTaper;
  const cavity = frustum(iw, ih, ri, L.z0, iw - 2 * tp, ih - 2 * tp, ri, L.ceiling);
  const under = roundRect(iw, ih, ri, L.z0 - 1).extrude(1.01) as Shape3D;
  const tools: Shape3D[] = [cavity, under];
  const dish = dishTool(p, tw, th, L.topLow);
  if (dish) tools.push(dish);
  body = cutMany(body, tools);

  // gniazda: walec od sufitu w dół, w nim krzyż
  const along = w >= h;
  const crosses: Shape3D[] = [];
  for (const s of type.stems) {
    const x = along ? s.d : 0;
    const y = along ? 0 : s.d;
    const cyl = makeCylinder(STEM.od / 2, L.ceiling + 0.3 - L.stemBottom, [x, y, L.stemBottom], [0, 0, 1]);
    body = body.fuse(cyl) as Shape3D;
    crosses.push(...crossCut(p, x, y, L.stemBottom - 0.5, L.socketTop, s.stab && !along));
  }
  return cutMany(body, crosses);
}

/**
 * Ustawienie do druku: z misą normalnie (dolna krawędź na stole, gniazdo wymaga podpory),
 * płaska góra do góry nogami (góra na stole, bez podpór). Najniższy punkt na z = 0.
 */
export function printPose(p: KeycapParams, cap: Shape3D): Shape3D {
  const L = capLevels(p);
  if (p.top === 'flat') return cap.clone().rotate(180, [0, 0, 0], [1, 0, 0]).translate(0, 0, L.topEdge) as Shape3D;
  return cap.clone().translate(0, 0, -L.z0) as Shape3D;
}

/**
 * Plik kalibracji luzu: cztery krótkie gniazda (to samo co w nakładce: walec i krzyż) na kwadratowych
 * podstawkach, połączone listwą. Drukuje się podstawkami na stole, bez podpór. Liczba otworków
 * na podstawce = numer luzu z listy (1 = najciaśniejszy).
 */
export function buildCalibration(p: KeycapParams, clearances = CALIBRATION_CLEARANCES): Shape3D {
  const L = capLevels(p);
  const base = 1.6;
  const size = 10;
  const step = 13;
  const stemH = L.ceiling - L.stemBottom;
  const socket = L.socketTop - L.stemBottom;
  let body: Shape3D | null = null;
  const cuts: Shape3D[] = [];
  clearances.forEach((c, i) => {
    const x = i * step;
    let part = makeBox([x - size / 2, -size / 2, 0], [x + size / 2, size / 2, base]) as Shape3D;
    part = part.fuse(makeCylinder(STEM.od / 2, stemH, [x, 0, base - 0.01], [0, 0, 1])) as Shape3D;
    body = body ? (body.fuse(part) as Shape3D) : part;
    cuts.push(...crossCut({ ...p, clearance: c }, x, 0, base + stemH - socket, base + stemH + 1, false));
    for (let n = 0; n <= i; n++) cuts.push(makeCylinder(0.6, base + 2, [x - 3.6 + n * 2.4, -3.8, -1], [0, 0, 1]));
  });
  const bar = makeBox([0, -size / 2, 0], [(clearances.length - 1) * step, -size / 2 + 2.5, base]);
  return cutMany((body as unknown as Shape3D).fuse(bar) as Shape3D, cuts);
}
