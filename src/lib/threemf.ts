// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Zapis 3MF z wieloma obiektami na stole i częściami z przypisanym filamentem (druk z AMS).
 * Układ jak w plikach QIDI Studio / OrcaSlicer / Bambu Studio: każdy obiekt na stole to <object> z
 * <components>, każda część to osobny <object> z siatką, a numer filamentu części i nazwy są w
 * Metadata/model_settings.config (<object id> = obiekt na stole, <part id> = obiekt części).
 * Inne programy (PrusaSlicer, Cura) wczytają te same bryły bez przypisania filamentów.
 */
import { zipDeflate } from './zip';

export interface MeshPart {
  name: string;
  /** numer filamentu (1 = pierwszy) */
  extruder: number;
  /** wierzchołki x, y, z (mm) */
  vertices: ArrayLike<number>;
  /** trójkąty: indeksy wierzchołków */
  triangles: ArrayLike<number>;
}

export interface BedObject {
  name: string;
  parts: MeshPart[];
  /** położenie na stole: przesunięcie siatek (mm) */
  x: number;
  y: number;
}

/**
 * Siatka bez powtórzonych wierzchołków. Siatki z OpenCascade mają osobne wierzchołki dla każdej ściany,
 * a slicer czyta 3MF bez scalania: bez tego bryła miałaby „otwarte krawędzie” do naprawy.
 */
export function weld(vertices: ArrayLike<number>, triangles: ArrayLike<number>, eps = 1e-4): { v: number[]; t: number[] } {
  const map = new Map<string, number>();
  const remap = new Uint32Array(vertices.length / 3);
  const v: number[] = [];
  for (let i = 0; i < vertices.length / 3; i++) {
    const x = vertices[3 * i], y = vertices[3 * i + 1], z = vertices[3 * i + 2];
    const k = `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
    let j = map.get(k);
    if (j === undefined) {
      j = v.length / 3;
      map.set(k, j);
      v.push(x, y, z);
    }
    remap[i] = j;
  }
  const t: number[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const a = remap[triangles[i]], b = remap[triangles[i + 1]], c = remap[triangles[i + 2]];
    if (a !== b && b !== c && a !== c) t.push(a, b, c);
  }
  return { v, t };
}

/**
 * Układ prostokątów `w` × `h` (mm) na stole `bedX` × `bedY` półkami, od lewego dolnego rogu, z odstępem `gap`.
 * Zwraca środki prostokątów; `fits` = false, gdy coś wyszło poza stół (slicer i tak pozwoli je rozłożyć).
 */
export function packOnBed(sizes: { w: number; h: number }[], bedX: number, bedY: number, gap = 4): { centers: [number, number][]; fits: boolean } {
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w);
  const centers: [number, number][] = new Array(sizes.length);
  let x = gap;
  let y = gap;
  let row = 0;
  let fits = true;
  for (const i of order) {
    const { w, h } = sizes[i];
    if (x + w > bedX - gap && x > gap) {
      x = gap;
      y += row + gap;
      row = 0;
    }
    centers[i] = [x + w / 2, y + h / 2];
    if (x + w > bedX || y + h > bedY) fits = false;
    x += w + gap;
    row = Math.max(row, h);
  }
  return { centers, fits };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 1e5) / 1e5).toString();

/** Plik 3MF (ZIP) z obiektami na stole. */
export async function build3mf(objects: BedObject[], app = 'Keyboard-maker'): Promise<Blob> {
  const model: string[] = [];
  const config: string[] = [];
  const build: string[] = [];
  let id = 1;
  model.push(
    '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    ` <metadata name="Application">${esc(app)}</metadata>`,
    ' <resources>',
  );
  config.push('<?xml version="1.0" encoding="UTF-8"?>\n<config>');
  for (const o of objects) {
    const partIds: number[] = [];
    for (const p of o.parts) {
      const { v, t } = weld(p.vertices, p.triangles);
      if (!t.length) continue;
      const pid = id++;
      partIds.push(pid);
      const vs: string[] = [];
      for (let i = 0; i < v.length; i += 3) vs.push(`<vertex x="${n(v[i])}" y="${n(v[i + 1])}" z="${n(v[i + 2])}"/>`);
      const ts: string[] = [];
      for (let i = 0; i < t.length; i += 3) ts.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
      model.push(`  <object id="${pid}" type="model"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`);
    }
    if (!partIds.length) continue;
    const oid = id++;
    model.push(`  <object id="${oid}" name="${esc(o.name)}" type="model"><components>${partIds.map((p) => `<component objectid="${p}"/>`).join('')}</components></object>`);
    build.push(`  <item objectid="${oid}" transform="1 0 0 0 1 0 0 0 1 ${n(o.x)} ${n(o.y)} 0"/>`);
    config.push(`  <object id="${oid}">`, `    <metadata key="name" value="${esc(o.name)}"/>`, `    <metadata key="extruder" value="${o.parts[0].extruder}"/>`);
    o.parts.forEach((p, i) => {
      if (partIds[i] === undefined) return;
      config.push(
        `    <part id="${partIds[i]}" subtype="normal_part">`,
        `      <metadata key="name" value="${esc(p.name)}"/>`,
        `      <metadata key="extruder" value="${p.extruder}"/>`,
        '    </part>',
      );
    });
    config.push('  </object>');
  }
  model.push(' </resources>', ' <build>', ...build, ' </build>', '</model>');
  config.push('</config>');
  const enc = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
  return zipDeflate(
    [
      {
        name: '[Content_Types].xml',
        data: enc(
          '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
            '<Default Extension="config" ContentType="text/xml"/></Types>',
        ),
      },
      {
        name: '_rels/.rels',
        data: enc(
          '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
        ),
      },
      { name: '3D/3dmodel.model', data: enc(model.join('\n')) },
      { name: 'Metadata/model_settings.config', data: enc(config.join('\n')) },
    ],
    'model/3mf',
  );
}
