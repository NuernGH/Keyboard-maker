// SPDX-License-Identifier: AGPL-3.0-or-later
// Bryła nakładki (keycap) pod Cherry MX, profil własny: niska nakładka z misą kulistą albo płaską górą.
// Układ jak komórka: środek klawisza w (0, 0), wierzch płyty z = 0, nakładka w spoczynku.

import { draw, drawRoundedRectangle, makeBox, makeCylinder, makeSphere, type Shape3D, type Sketch } from 'replicad';
import { cutMany } from './geometry';
import {
  CALIBRATION_CLEARANCES,
  CAP_LIMITS,
  MX,
  SIDE,
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

/** Gniazda nakładki: środki w układzie klawisza i czy krzyż obrócony o 90°. */
function stemSpots(type: CapType): { x: number; y: number; turned: boolean }[] {
  const along = type.w >= type.h;
  return type.stems.map((s) => ({ x: along ? s.d : 0, y: along ? 0 : s.d, turned: s.stab && !along }));
}

/** Zbieżność boków: tangens kąta między ścianką a osią nakładki. */
const taperK = (p: KeycapParams) => topInset(p) / capLevels(p).height;

/** Długość bolca wkładki (wariant B): tak, by nad otworem zostało min. 0,4 mm góry. */
export const insertPinLen = (p: KeycapParams) => Math.max(0.6, Math.min(SIDE.pin.len, p.topThickness - 0.5));

/**
 * Otwór lub bolec w kształcie litery D (płaska ścianka od strony −Y, od z0 do z1). Przy druku na boku
 * zwykła nakładka leży ścianką −Y na stole, więc płaska ścianka otworu jest jego podłogą, a nie sufitem.
 */
function dShape(x: number, y: number, d: number, flat: number, z0: number, z1: number, rot = 0): Shape3D {
  const r = d / 2;
  const q = r / Math.SQRT2;
  // koło z dachem 45° (kropla): po położeniu nakładki na bok wierzch otworu nie wisi
  const roof = draw([-q, q]).lineTo([q, q]).lineTo([0, r * Math.SQRT2]).close().sketchOnPlane('XY', z0).extrude(z1 - z0) as Shape3D;
  let s = makeCylinder(r, z1 - z0, [0, 0, z0], [0, 0, 1]).fuse(roof) as Shape3D;
  s = cutMany(s, [makeBox([-d, -d, z0 - 1], [d, -flat, z1 + 1])]);
  if (rot) s = s.rotate(rot, [0, 0, 0], [0, 0, 1]) as Shape3D;
  return s.translate(x, y, 0) as Shape3D;
}

export interface KeycapOptions {
  /** gniazda: `stems` = walce z krzyżem (zwykła nakładka), `holes` = otwory na wkładki (wariant B), `none` = bez */
  sockets?: 'stems' | 'holes' | 'none';
  /** żebra pod gniazdami do druku na boku (wariant A) */
  ribs?: boolean;
}

/**
 * Nakładka danego typu w spoczynku (układ klawisza). Domyślnie kompletna (z gniazdami), tak jak siedzi
 * na przełączniku: do podglądu i testów kolizji niezależnie od sposobu druku.
 */
export function buildKeycap(p: KeycapParams, type: CapType, opts: KeycapOptions = {}): Shape3D {
  const sockets = opts.sockets ?? 'stems';
  const L = capLevels(p);
  const { w, h } = type;
  const [bw, bh] = capBottom(p, w, h);
  const ins = topInset(p);
  const tw = bw - 2 * ins;
  const th = bh - 2 * ins;
  let body = frustum(bw, bh, p.radius, L.z0, tw, th, p.radius, L.topEdge);

  // wnętrze: przy druku normalnym zwęża się od dolnej krawędzi do sufitu, przy druku na boku ma stałą
  // ściankę (sufit wnętrza od strony „dachu” ma wtedy nawis 45°); w obu przypadkach omija obudowę MX
  const iw = bw - 2 * p.wall;
  const ih = bh - 2 * p.wall;
  const ri = Math.max(0.3, p.radius - p.wall);
  const tp = p.orient === 'side' ? taperK(p) * (L.ceiling - L.z0) : CAP_LIMITS.cavityTaper;
  // loft zaczyna się 0,5 mm pod dolną krawędzią (ta sama zbieżność), żeby nie zostawiać listewki przy krawędzi
  const e = (0.5 * tp) / (L.ceiling - L.z0);
  const cavity = frustum(iw + 2 * e, ih + 2 * e, ri + e, L.z0 - 0.5, iw - 2 * tp, ih - 2 * tp, ri, L.ceiling);
  const tools: Shape3D[] = [cavity];
  const dish = dishTool(p, tw, th, L.topLow);
  if (dish) tools.push(dish);
  body = cutMany(body, tools);

  const spots = stemSpots(type);
  const cuts: Shape3D[] = [];
  if (sockets === 'stems') {
    for (const s of spots) {
      body = body.fuse(makeCylinder(STEM.od / 2, L.ceiling + 0.3 - L.stemBottom, [s.x, s.y, L.stemBottom], [0, 0, 1])) as Shape3D;
      cuts.push(...crossCut(p, s.x, s.y, L.stemBottom - 0.5, L.socketTop, s.turned));
    }
  } else if (sockets === 'holes') {
    const pin = SIDE.pin;
    // pionowa nakładka leży na ściance −X: płaskie D w stronę stołu (obrót −90°)
    const rot = type.w >= type.h ? 0 : -90;
    for (const s of spots) cuts.push(dShape(s.x, s.y, pin.d + pin.fit, pin.flat + pin.fit / 2, L.ceiling - 0.5, L.ceiling + insertPinLen(p) + 0.1, rot));
  }
  if (opts.ribs && sockets === 'stems') for (const s of spots) body = body.fuse(rib(p, type, s.x, s.y)) as Shape3D;
  return cuts.length ? cutMany(body, cuts) : body;
}

/**
 * Żebro pod gniazdem (wariant A) do druku na boku: cienka ścianka od najniższej linii walca gniazda
 * w dół (w kierunku stołu) do ścianki leżącej na stole. Po druku do odłamania: po wciśnięciu
 * nakładki uderzyłoby w obudowę MX.
 */
function rib(p: KeycapParams, type: CapType, x: number, y: number): Shape3D {
  const L = capLevels(p);
  const along = type.w >= type.h;
  const [bw, bh] = capBottom(p, type.w, type.h);
  // u: współrzędna w stronę ścianki na stole (−Y przy zwykłych, −X przy pionowych nakładkach), v: wzdłuż
  const hb = (along ? bh : bw) / 2;
  const uc = along ? y : x;
  const k = taperK(p);
  const th = Math.atan(k);
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const u0 = uc - STEM.od / 2 + 0.15;
  const pts: [number, number][] = [];
  for (const zz of [L.stemBottom, L.ceiling]) {
    // przecięcie z wewnętrzną powierzchnią ścianki (zagłębione 0,2 mm)
    const s = (u0 + (hb - p.wall) - k * (zz - L.z0) + 0.2) / (c + k * sn);
    pts.push([u0, zz], [u0 - s * c, zz + s * sn]);
  }
  const poly: [number, number][] = [pts[0], pts[2], pts[3], pts[1]];
  const t = SIDE.rib;
  const v = along ? x : y;
  // szkic w płaszczyźnie (u, z), wyciągnięty o grubość żebra wzdłuż v
  const solid = makeRibPrism(poly, v - t / 2, t);
  // pionowa nakładka: zamiana osi X i Y (odbicie względem płaszczyzny x = y)
  return along ? solid : (solid.mirror([1, -1, 0], [0, 0, 0]) as Shape3D);
}

/** Graniastosłup z wielokąta w płaszczyźnie (y, z), od x0 do x0 + t. */
function makeRibPrism(poly: [number, number][], x0: number, t: number): Shape3D {
  let pen = draw(poly[0]);
  for (const q of poly.slice(1)) pen = pen.lineTo(q);
  return pen.close().sketchOnPlane('YZ', x0).extrude(t) as Shape3D;
}

/** Wkładka z krzyżem (wariant B) w układzie klawisza, w miejscu gniazda w (0, 0): walec + bolec D. */
export function buildInsert(p: KeycapParams, turned = false): Shape3D {
  const L = capLevels(p);
  const pin = SIDE.pin;
  let body = makeCylinder(STEM.od / 2, L.ceiling - L.stemBottom, [0, 0, L.stemBottom], [0, 0, 1]) as Shape3D;
  body = body.fuse(dShape(0, 0, pin.d, pin.flat, L.ceiling - 0.01, L.ceiling + insertPinLen(p))) as Shape3D;
  const m = SIDE.mouth;
  const cuts = [
    ...crossCut(p, 0, 0, L.stemBottom - 0.5, L.socketTop, turned),
    // sfazowanie wejścia (przy druku leży na stole, łagodzi „stopę słonia”)
    ...crossCut({ ...p, clearance: p.clearance + 2 * m }, 0, 0, L.stemBottom - 0.5, L.stemBottom + m, turned),
  ];
  return cutMany(body, cuts);
}

/** Wkładka do druku: wejściem krzyża na stole, bolcem do góry (tak jak siedzi w nakładce, tylko niżej). */
export function insertPrintPose(p: KeycapParams, insert: Shape3D): Shape3D {
  return insert.clone().translate(0, 0, -capLevels(p).stemBottom) as Shape3D;
}

/**
 * Ustawienie do druku. Normalnie: z misą dolna krawędź na stole (gniazdo wymaga podpory),
 * płaska góra do góry nogami. Na boku: dłuższą przednią ścianką na stole (pionowe nakładki: lewą).
 * Najniższy punkt na z = 0.
 */
export function printPose(p: KeycapParams, cap: Shape3D, type?: CapType): Shape3D {
  const L = capLevels(p);
  if (p.orient === 'side') {
    const deg = (Math.atan(taperK(p)) * 180) / Math.PI;
    const along = !type || type.w >= type.h;
    const r = along ? cap.clone().rotate(deg + 90, [0, 0, 0], [1, 0, 0]) : cap.clone().rotate(-(deg + 90), [0, 0, 0], [0, 1, 0]);
    const bb = (r as Shape3D).boundingBox.bounds;
    return (r as Shape3D).translate(-(bb[0][0] + bb[1][0]) / 2, -(bb[0][1] + bb[1][1]) / 2, -bb[0][2]) as Shape3D;
  }
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
