import { describe, expect, test } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { build3mf, packOnBed, weld } from '../src/lib/threemf';
import { DEFAULT_KEYCAP, capLevels, fineLayerRange, skirtToSocketHeight } from '../src/lib/keycap-spec';

/** pliki z ZIP-a (store albo deflate) */
function unzip(buf: Uint8Array): Record<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Record<string, string> = {};
  let o = 0;
  while (dv.getUint32(o, true) === 0x04034b50) {
    const method = dv.getUint16(o + 8, true);
    const size = dv.getUint32(o + 18, true);
    const nl = dv.getUint16(o + 26, true);
    const name = new TextDecoder().decode(buf.subarray(o + 30, o + 30 + nl));
    const body = buf.subarray(o + 30 + nl, o + 30 + nl + size);
    out[name] = new TextDecoder().decode(method === 8 ? inflateRawSync(body) : body);
    o += 30 + nl + size;
  }
  return out;
}

/** sześcian z osobnymi wierzchołkami dla każdej ściany (jak siatka z OpenCascade) */
function cube(s: number, z0 = 0) {
  const c = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]].map(([x, y, z]) => [x, y, z + z0]);
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const v: number[] = [];
  const t: number[] = [];
  for (const f of faces) {
    const b = v.length / 3;
    for (const i of f) v.push(...c[i]);
    t.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { vertices: new Float32Array(v), triangles: new Uint32Array(t) };
}

describe('3MF dla AMS', () => {
  test('scalanie wierzchołków: sześcian z 24 wierzchołków ma 8', () => {
    const c = cube(10);
    const w = weld(c.vertices, c.triangles);
    expect(w.v.length / 3).toBe(8);
    expect(w.t.length / 3).toBe(12);
  });

  test('układ na stole: obok siebie w rzędach, bez nakładania, sygnał gdy za dużo', () => {
    const sizes = Array.from({ length: 30 }, () => ({ w: 17, h: 17 }));
    const { centers, fits } = packOnBed(sizes, 245, 245);
    expect(fits).toBe(true);
    for (let i = 0; i < centers.length; i++)
      for (let j = i + 1; j < centers.length; j++)
        expect(Math.abs(centers[i][0] - centers[j][0]) >= 17 || Math.abs(centers[i][1] - centers[j][1]) >= 17).toBe(true);
    for (const [x, y] of centers) {
      expect(x - 8.5).toBeGreaterThanOrEqual(0);
      expect(x + 8.5).toBeLessThanOrEqual(245);
      expect(y + 8.5).toBeLessThanOrEqual(245);
    }
    expect(packOnBed(Array.from({ length: 400 }, () => ({ w: 17, h: 17 })), 245, 245).fits).toBe(false);
  });

  test('plik: obiekt z dwiema częściami, litery filamentem 2, położenie z build', async () => {
    const blob = await build3mf([
      { name: 'Q', x: 20, y: 30, parts: [{ name: 'Q – nakładka', extruder: 1, ...cube(10) }, { name: 'Q – litery', extruder: 2, ...cube(2, 10) }] },
      { name: '1u 1', x: 50, y: 30, parts: [{ name: '1u', extruder: 1, ...cube(10) }] },
    ]);
    const files = unzip(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', 'Metadata/model_settings.config', '[Content_Types].xml', '_rels/.rels']);
    const model = files['3D/3dmodel.model'];
    // części 1 i 2, obiekt 3 z komponentami; część 4, obiekt 5
    expect(model).toContain('<object id="3" name="Q" type="model"><components><component objectid="1"/><component objectid="2"/></components></object>');
    expect(model).toContain('<item objectid="3" transform="1 0 0 0 1 0 0 0 1 20 30 0"/>');
    expect(model).toContain('<item objectid="5" transform="1 0 0 0 1 0 0 0 1 50 30 0"/>');
    expect((model.match(/<vertex /g) ?? []).length).toBe(24);
    const cfg = files['Metadata/model_settings.config'];
    expect(cfg).toMatch(/<object id="3">[\s\S]*<part id="1" subtype="normal_part">[\s\S]*key="extruder" value="1"[\s\S]*<part id="2" subtype="normal_part">[\s\S]*key="name" value="Q – litery"\/>\s*<metadata key="extruder" value="2"\/>/);
    expect(cfg).toMatch(/<object id="5">[\s\S]*<part id="4"/);
  });

  test('drobne warstwy: ten sam zakres dla każdego obiektu w layer_config_ranges.xml', async () => {
    const r = { minZ: 6, maxZ: 7.4, layerHeight: 0.08 };
    const blob = await build3mf(
      [
        { name: 'A', x: 20, y: 30, parts: [{ name: 'A', extruder: 1, ...cube(10) }, { name: 'A – litery', extruder: 2, ...cube(2) }] },
        { name: 'B', x: 50, y: 30, parts: [{ name: 'B', extruder: 1, ...cube(10) }] },
      ],
      undefined,
      [r],
    );
    const files = unzip(new Uint8Array(await blob.arrayBuffer()));
    const xml = files['Metadata/layer_config_ranges.xml'];
    expect(xml).toBeDefined();
    // numery obiektów w kolejności (od 1), nie identyfikatory zasobów
    expect((xml.match(/<object id="\d+">/g) ?? [])).toEqual(['<object id="1">', '<object id="2">']);
    expect((xml.match(/<range min_z="6" max_z="7.4">\s*<option opt_key="layer_height">0.08<\/option>/g) ?? []).length).toBe(2);
  });

  test('zakres drobnych warstw: od rowka pod dnem misy do wierzchu, tylko misa do góry', () => {
    const L = capLevels(DEFAULT_KEYCAP);
    const r = fineLayerRange(DEFAULT_KEYCAP)!;
    expect(r.layerHeight).toBe(0.08);
    expect(r.maxZ).toBeCloseTo(L.topEdge - L.z0, 3);
    expect(r.minZ).toBeLessThanOrEqual(L.topLow - 0.6 - L.z0 + 1e-6);
    expect(r.minZ).toBeGreaterThan(L.topLow - 0.6 - L.z0 - 0.2);
    expect(Math.abs(r.minZ / 0.2 - Math.round(r.minZ / 0.2))).toBeLessThan(1e-6);
    expect(fineLayerRange({ ...DEFAULT_KEYCAP, top: 'flat' })).toBeNull();
    expect(fineLayerRange({ ...DEFAULT_KEYCAP, orient: 'side' })).toBeNull();
    expect(fineLayerRange({ ...DEFAULT_KEYCAP, fineLayer: 0 })).toBeNull();
    // starsze projekty bez pola: domyślne 0,08
    expect(fineLayerRange({ ...DEFAULT_KEYCAP, fineLayer: undefined })?.layerHeight).toBe(0.08);
  });

  test('kołnierz do gniazda: krawędź na równi ze spodem walca gniazda, bez przycięcia wysokości', () => {
    const h = skirtToSocketHeight(DEFAULT_KEYCAP);
    expect(h).toBeCloseTo(6.55, 2);
    const L = capLevels({ ...DEFAULT_KEYCAP, height: h });
    expect(L.height).toBeCloseTo(h, 6);
    expect(L.z0).toBeCloseTo(L.stemBottom, 2);
  });
});
