declare module 'quickhull3d/dist/quickhull3d.js' {
  /** Wypukła otoczka: lista ścian (indeksy punktów, przeciwnie do ruchu wskazówek patrząc z zewnątrz). */
  export default function qh(points: Array<[number, number, number]>, options?: { skipTriangulation?: boolean }): number[][];
}
