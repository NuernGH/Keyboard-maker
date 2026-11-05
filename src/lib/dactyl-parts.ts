// SPDX-License-Identifier: AGPL-3.0-or-later
// Uchwyt kontrolera w Dactylu: płytka leży płasko na dnie, w korytku przy tylnej ścianie,
// gniazdem USB do ściany; w ścianie otwór na wtyk i od zewnątrz wybranie na jego obudowę.

import { apply, floorLoop, mul, Rz, T, type DactylModel, type Mat } from './dactyl';
import { CONTROLLERS, type ControllerId } from './island';

export type PartBox = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; m?: Mat };

/** Uchwyt kontrolera: co dodać i wyciąć w skorupie i w dnie. */
export interface DactylController {
  shellAdd: PartBox[];
  shellCut: PartBox[];
  bottomAdd: PartBox[];
  bottomCut: PartBox[];
  /** sama płytka z gniazdem (do podglądu i sprawdzania kolizji) */
  ghosts: { kind: 'board' | 'usb' | 'plug'; box: PartBox }[];
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
/** `lift`: podkładka pod płytką, żeby obudowa wtyku nie zahaczała o dno. */
export const HOLDER = { gap: 0.3, wall: 1.6, height: 4.5, lift: 1, plugW: 12.5, plugH: 7, plugFrom: 1.5 };

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
  const usbZ = zb + 1.6 + (c.height - 1.6) / 2;
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): PartBox => ({ x0, y0, z0, x1, y1, z1, m });
  const bottomAdd = [
    box(-hw - g - w, yBack - g - w, -1, -hw - g, -0.4, HOLDER.height),
    box(hw + g, yBack - g - w, -1, hw + g + w, -0.4, HOLDER.height),
    box(-hw - g - w, yBack - g - w, -1, hw + g + w, yBack - g, HOLDER.height),
    // podkładka pod płytką (tylko pod brzegami, środek wolny na pady baterii od spodu)
    box(-hw - g, yBack - g, -1, -hw + 2, -0.4, zb),
    box(hw - 2, yBack - g, -1, hw + g, -0.4, zb),
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
    { kind: 'board' as const, box: box(-hw, yBack, zb, hw, yEdge, zb + 1.6) },
    ...ports.map((px) => ({ kind: 'usb' as const, box: box(px - 4.5, yEdge - 7.3 + c.usbOverhang, zb + 1.6, px + 4.5, yEdge + c.usbOverhang, zb + c.height) })),
  ];
  const u = apply(m, [0, 0, 0]);
  return { shellAdd: [], shellCut, bottomAdd, bottomCut: [], ghosts, usb: [u[0], u[1]] };
}
