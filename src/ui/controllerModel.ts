// Modele kontrolerów w podglądzie 3D (np. nice!nano v2 z public/controllers, CC0).
// Plik modelu: X w poprzek płytki (od 0), Y w górę (spód płytki = 0), Z wzdłuż płytki
// (płytka od 0, gniazdo USB po stronie +Z).
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

type Box = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };

const cache = new Map<string, Promise<THREE.BufferGeometry | null>>();

/**
 * Model kontrolera wgrany przez użytkownika (już ułożony jak pliki w public/controllers, oś płytki w X = 0).
 * Zostaje tylko w tej karcie przeglądarki, nigdzie nie jest wysyłany.
 */
export function registerControllerModel(path: string, positions: Float32Array) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.computeBoundingBox();
  g.computeVertexNormals();
  g.userData.boardCenterX = 0;
  cache.set(path, Promise.resolve(g));
}

/** Wczytuje model (raz na ścieżkę); null, gdy się nie udało (zostają pudełka). */
export function loadControllerModel(path: string): Promise<THREE.BufferGeometry | null> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(import.meta.env.BASE_URL + path)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((buf) => {
        const g = new STLLoader().parse(buf);
        g.computeBoundingBox();
        g.computeVertexNormals();
        return g;
      })
      .catch(() => null);
    cache.set(path, p);
  }
  return p;
}

/**
 * Macierz, która kładzie model na płytce `board` (pudełko płytki w XY, spód na z0).
 * Y = 0 w modelu to spód płytki (gniazdo USB może wystawać niżej, np. nice!nano o 0,2 mm).
 * Gniazdo USB jest po stronie dłuższej osi pudełka, w kierunku `usb` (środek gniazda);
 * bez niego po stronie +Y. Obrót jest właściwy (bez odbicia), płytka jest symetryczna.
 * `flip`: płytka odwrócona elementami w dół (obrót o 180° wokół osi wzdłuż płytki),
 * spód płytki z modelu leży wtedy na wierzchu pudełka.
 */
export function placeOnBoard(geo: THREE.BufferGeometry, board: Box, usb?: Box, flip = false): THREE.Matrix4 {
  const bb = geo.boundingBox!;
  const w = bb.max.x - bb.min.x;
  // oś płytki w modelu: zwykle środek obrysu, w modelu użytkownika podana wprost
  const mid = typeof geo.userData.boardCenterX === 'number' ? geo.userData.boardCenterX : bb.min.x + w / 2;
  const alongY = board.y1 - board.y0 >= board.x1 - board.x0;
  const cx = (board.x0 + board.x1) / 2;
  const cy = (board.y0 + board.y1) / 2;
  let sign = 1;
  if (usb) {
    const u = alongY ? (usb.y0 + usb.y1) / 2 - cy : (usb.x0 + usb.x1) / 2 - cx;
    sign = u >= 0 ? 1 : -1;
  }
  // kierunek wzdłuż płytki (do USB), w górę, w poprzek = góra × wzdłuż
  const d = alongY ? new THREE.Vector3(0, sign, 0) : new THREE.Vector3(sign, 0, 0);
  const up = new THREE.Vector3(0, 0, flip ? -1 : 1);
  const a = new THREE.Vector3().crossVectors(up, d);
  // dalszy od USB koniec płytki, na środku szerokości
  const zb = flip ? board.z1 : board.z0;
  const far = alongY
    ? new THREE.Vector3(cx, sign > 0 ? board.y0 : board.y1, zb)
    : new THREE.Vector3(sign > 0 ? board.x0 : board.x1, cy, zb);
  const o = far.clone().addScaledVector(a, -mid).addScaledVector(up, 0).addScaledVector(d, -bb.min.z);
  return new THREE.Matrix4().set(a.x, up.x, d.x, o.x, a.y, up.y, d.y, o.y, a.z, up.z, d.z, o.z, 0, 0, 0, 1);
}
