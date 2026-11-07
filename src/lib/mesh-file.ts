// SPDX-License-Identifier: AGPL-3.0-or-later
// Gotowa siatka trójkątów w pliku binarnym (np. model przełącznika do podglądu), żeby przeglądarka
// nie musiała przy każdym wejściu wczytywać STEP-a w jądrze CAD.
//
// Układ (little-endian): „KMSH”, wersja u32, liczba wierzchołków u32, liczba indeksów u32,
// potem wierzchołki f32 ×3, normalne f32 ×3, indeksy trójkątów u32.

export interface MeshData {
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
}

const MAGIC = 0x48534d4b; // „KMSH”
const HEADER = 16;

export function encodeMesh(m: MeshData): ArrayBuffer {
  const nv = m.vertices.length / 3, ni = m.triangles.length;
  const buf = new ArrayBuffer(HEADER + nv * 24 + ni * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 1, true);
  dv.setUint32(8, nv, true);
  dv.setUint32(12, ni, true);
  new Float32Array(buf, HEADER, nv * 3).set(m.vertices);
  new Float32Array(buf, HEADER + nv * 12, nv * 3).set(m.normals);
  new Uint32Array(buf, HEADER + nv * 24, ni).set(m.triangles);
  return buf;
}

export function decodeMesh(buf: ArrayBuffer): MeshData {
  const dv = new DataView(buf);
  if (buf.byteLength < HEADER || dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== 1) throw new Error('To nie jest plik siatki KMSH');
  const nv = dv.getUint32(8, true), ni = dv.getUint32(12, true);
  if (buf.byteLength !== HEADER + nv * 24 + ni * 4) throw new Error('Plik siatki ma złą długość');
  return {
    vertices: new Float32Array(buf.slice(HEADER, HEADER + nv * 12)),
    normals: new Float32Array(buf.slice(HEADER + nv * 12, HEADER + nv * 24)),
    triangles: new Uint32Array(buf.slice(HEADER + nv * 24)),
  };
}
