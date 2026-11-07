// SPDX-License-Identifier: AGPL-3.0-or-later
// Uchwyt kontrolera w Dactylu: płytka leży płasko na dnie, w korytku przy tylnej ścianie,
// gniazdem USB do ściany; w ścianie otwór na wtyk i od zewnątrz wybranie na jego obudowę.

import { apply, floorLoop, mul, Rz, T, type DactylModel, type Mat } from './dactyl';
import { CONTROLLERS, USB_PLUG, pcbOf, usbBottomOf, usbCenterOf, type ControllerId } from './island';

/** `round`: walec wpisany w pudełko, oś wzdłuż Y (otwór na gniazdo jack w ścianie). */
/**
 * `late`: wycięcie w skorupie odejmowane osobno, po komórkach (dodatki: włącznik, gniazdo). Wspólne
 * odejmowanie z komórkami w OpenCascade potrafi je po cichu pominąć.
 */
export type PartBox = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; m?: Mat; round?: boolean; late?: boolean };

/** Uchwyt kontrolera: co dodać i wyciąć w skorupie i w dnie. */
export interface DactylController {
  shellAdd: PartBox[];
  shellCut: PartBox[];
  bottomAdd: PartBox[];
  bottomCut: PartBox[];
  /** sama płytka z gniazdem (do podglądu i sprawdzania kolizji) */
  ghosts: { kind: 'board' | 'usb' | 'plug' | 'switch' | 'knob' | 'jack' | 'pcb' | 'battery' | 'nano' | 'display' | 'encoder'; box: PartBox; model?: string }[];
  /** środek gniazda USB na wewnętrznej stronie ściany (XY) */
  usb: [number, number];
}

export interface ControllerParams {
  controller: ControllerId;
  /** położenie wzdłuż tylnej ściany: kolumna (ułamkowa), nad którą stoi kontroler */
  col: number;
  /** przesunięcie wzdłuż ściany (mm) */
  shift: number;
}

export const DEFAULT_DACTYL_CONTROLLER: ControllerParams = { controller: 'nicenano', col: 0.5, shift: 0 };

/** Wymiary korytka i otworu (mm). */
/**
 * `lift`: podest pod płytką, żeby obudowa wtyku nie zahaczała o dno. nice!nano ma gniazdo USB
 * osadzone we wcięciu płytki (nisko), więc podest jest wyższy: 2,5 mm. `height`: ścianki korytka.
 * `lip`, `lipGap`, `lipT`: zaczep nad końcem płytki (zachodzi na płytkę, luz nad nią, grubość).
 */
/** połowa szerokości podestu: wolny pas 2,5 mm przy każdym brzegu na luty pinów */
const PAD_HALF = 4.5;

export const HOLDER = { gap: 0.3, wall: 1.6, height: 5.5, lift: 2.5, lip: 1.2, lipGap: 0.2, lipT: 1.2, plugW: USB_PLUG.w, plugH: USB_PLUG.h, plugFrom: 1.5 };

/**
 * Ustawia kontroler przy tylnej ścianie: znajduje wewnętrzną krawędź ściany nad kolumną `col`
 * (pętla podłogi) i obraca uchwyt prostopadle do niej.
 */
export function controllerHolder(model: DactylModel, cp: ControllerParams): DactylController {
  const c = CONTROLLERS[cp.controller];
  const loop = floorLoop(model);
  // kolumna: środek górnej krawędzi klawisza w rzędzie 0 (interpolacja między kolumnami)
  const top = (col: number) => {
    const k = model.keys.find((q) => q.col === col && q.row === 0)!;
    return apply(k.frame, [0, k.hh, 0]);
  };
  const c0 = Math.floor(cp.col), f = cp.col - c0;
  const a = top(c0), b = top(Math.min(c0 + 1, model.params.cols - 1));
  const x = a[0] + (b[0] - a[0]) * f;
  // najwyższe przecięcie pionowej linii x z pętlą = tylna ściana od środka
  let best: { y: number; ang: number } | null = null;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    if ((p[0] - x) * (q[0] - x) > 0 || p[0] === q[0]) continue;
    const t = (x - p[0]) / (q[0] - p[0]);
    const y = p[1] + t * (q[1] - p[1]);
    const ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
    if (!best || y > best.y) best = { y, ang };
  }
  if (!best) throw new Error('Nie znaleziono tylnej ściany dla kontrolera');
  // oś X wzdłuż ściany (pętla może iść w obie strony), oś Y na zewnątrz (do ściany)
  let ang = best.ang;
  if (Math.cos((ang * Math.PI) / 180) < 0) ang += 180;
  const m = mul(T(x, best.y, 0), mul(Rz(ang), T(cp.shift, 0, 0)));

  const g = HOLDER.gap, w = HOLDER.wall;
  const hw = c.w / 2;
  const yEdge = -c.usbOverhang - 0.5; // krawędź płytki: gniazdo 0,5 mm od ściany
  const yBack = yEdge - c.h;
  const zb = HOLDER.lift; // spód płytki
  const usbZ = zb + usbCenterOf(c);
  const zTop = zb + pcbOf(c); // wierzch płytki
  const usbBack = yEdge - 7.3 + c.usbOverhang; // tył gniazda USB (jak w duchu gniazda)
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): PartBox => ({ x0, y0, z0, x1, y1, z1, m });
  const bottomAdd = [
    box(-hw - g - w, yBack - g - w, -1, -hw - g, -0.4, HOLDER.height),
    box(hw + g, yBack - g - w, -1, hw + g + w, -0.4, HOLDER.height),
    box(-hw - g - w, yBack - g - w, -1, hw + g + w, yBack - g, HOLDER.height),
    // podest pod płytką na całą długość, między rzędami pinów (luty pinów są 1,27 mm od brzegów):
    // płytka nie ugina się przy wtykaniu kabla
    // gniazdo wystające pod spód płytki (nice!nano: 0,2 mm) dostaje pod sobą obniżenie podestu z luzem 0,2
    ...(usbBottomOf(c) < 0
      ? [
          box(-PAD_HALF, yBack - g, -1, PAD_HALF, usbBack - 0.3, zb),
          box(-PAD_HALF, usbBack - 0.3, -1, PAD_HALF, yEdge - 0.01, zb + usbBottomOf(c) - 0.2),
        ]
      : [box(-PAD_HALF, yBack - g, -1, PAD_HALF, yEdge - 0.01, zb)]),
    // zaczep L na tylnej ściance korytka: występ nad końcem płytki (na środku, między pinami)
    // trzyma płytkę od góry. Wkładanie: koniec płytki pod zaczep, potem opuścić stronę z USB.
    box(-PAD_HALF, yBack - g - w, zTop + HOLDER.lipGap, PAD_HALF, yBack + HOLDER.lip, zTop + HOLDER.lipGap + HOLDER.lipT),
  ];
  const ports = c.ports ?? [0];
  const shellCut: PartBox[] = [];
  for (const px of ports) {
    shellCut.push(box(px - c.usbW / 2, -3, usbZ - c.usbH / 2, px + c.usbW / 2, 25, usbZ + c.usbH / 2));
    shellCut.push(box(px - HOLDER.plugW / 2, HOLDER.plugFrom, Math.max(0, usbZ - HOLDER.plugH / 2) - 0.01, px + HOLDER.plugW / 2, 25, usbZ + HOLDER.plugH / 2));
  }
  // korytko musi zmieścić się pod skorupą: wycinamy w niej miejsce na płytkę z luzem
  shellCut.push(box(-hw - g - w - 0.3, yBack - g - w - 0.3, -1, hw + g + w + 0.3, 0.01, Math.max(HOLDER.height, zb + c.height) + 0.5));
  const ghosts = [
    { kind: 'board' as const, box: box(-hw, yBack, zb, hw, yEdge, zb + pcbOf(c)), model: c.model },
    ...ports.map((px) => ({ kind: 'usb' as const, box: box(px - 4.5, usbBack, zb + usbBottomOf(c), px + 4.5, yEdge + c.usbOverhang, zb + c.height) })),
  ];
  const u = apply(m, [0, 0, 0]);
  return { shellAdd: [], shellCut, bottomAdd, bottomCut: [], ghosts, usb: [u[0], u[1]] };
}
