// SPDX-License-Identifier: AGPL-3.0-or-later
// Web Worker z jądrem CAD. UI nie zawiesza się podczas operacji logicznych.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC, importSTEP, type Shape3D } from 'replicad';
import { buildPlate, buildCase, buildWedge, screwPilots, loadCell, platePiece, casePiece, type Cell } from '../lib/geometry';
import type { Request, Response, BuildInput, DactylInput, KeycapInput } from './protocol';
import { buildKeycap, buildCalibration, buildInsert, insertPrintPose, printPose } from '../lib/keycap';
import { buildDactyl } from '../lib/dactyl';
import { buildDactylShell, buildDactylBottom } from '../lib/dactyl-geometry';
import { controllerHolder } from '../lib/dactyl-parts';
import { loadSwitch } from '../lib/switch-model';

let ready: Promise<void> | null = null;

/**
 * Wersja do podglądu w Claude (VITE_WASM_GZ=1): host plików przyjmuje pliki do 15 MB,
 * a WASM OpenCascade ma ok. 23 MB, więc publikujemy go spakowanego gzipem i
 * rozpakowujemy tutaj. Gdy serwer sam zdejmie gzip (Content-Encoding), bajty są już surowe.
 */
async function wasmOptions(): Promise<Record<string, unknown>> {
  if (import.meta.env.VITE_WASM_GZ !== '1') return { locateFile: () => wasmUrl };
  const res = await fetch(new URL('occt.wasm.gz', self.location.href));
  if (!res.ok) throw new Error(`Nie udało się pobrać jądra CAD (${res.status})`);
  let buf: Uint8Array<ArrayBuffer> = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return { wasmBinary: buf };
}

function init(): Promise<void> {
  if (!ready) {
    ready = wasmOptions()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((opts) => (opencascade as any)(opts))
      .then((oc: unknown) => {
        setOC(oc as never);
      });
    ready.catch(() => (ready = null));
  }
  return ready!;
}

const cellCache = new Map<string, Promise<Cell>>();
/** ostatnie bryły (całość płyty i spodu oraz części), żeby części nie liczyły całości od nowa */
const shapeCache = new Map<string, Shape3D>();
function remember(key: string, shape: Shape3D) {
  shapeCache.delete(key);
  shapeCache.set(key, shape);
  while (shapeCache.size > 8) shapeCache.delete(shapeCache.keys().next().value!);
}

function getCell(input: BuildInput): Promise<Cell> {
  const key = `${input.cellId}|${input.variant}|${input.up}`;
  let c = cellCache.get(key);
  if (!c) {
    c = loadCell({ step: new Blob([input.cellStep]), up: input.up }, input.variant);
    cellCache.set(key, c);
    c.catch(() => cellCache.delete(key));
  }
  return c;
}

/** Dactyl: bryła prawej połówki z cache, lewa to jej lustro (płaszczyzna YZ). */
async function dactylFor(input: DactylInput): Promise<Shape3D> {
  const key = 'dactyl:' + JSON.stringify({ ...input, cellStep: undefined });
  const hit = shapeCache.get(key);
  if (hit) return hit;
  if (input.side === 'left') {
    const right = await dactylFor({ ...input, side: 'right' });
    const shape = right.clone().mirror('YZ', [0, 0, 0]) as Shape3D;
    remember(key, shape);
    return shape;
  }
  await init();
  const cell = await getCell({ cellId: input.cellId, cellStep: input.cellStep, variant: input.variant, up: input.up } as BuildInput);
  const model = buildDactyl(input.params, { cellHeight: cell.height, screwSize: input.screwSize });
  const controller = input.controller ? controllerHolder(model, input.controller) : null;
  const b = { floor: input.floor, bossHeight: 7, controller };
  const shape = input.part === 'shell' ? buildDactylShell(model, cell, b) : buildDactylBottom(model, b);
  remember(key, shape);
  return shape;
}

async function plateFor(input: BuildInput): Promise<Shape3D> {
  const key = JSON.stringify({ ...input, cellStep: undefined });
  const hit = shapeCache.get(key);
  if (hit) return hit;
  if (input.part === 'wedge') {
    if (!input.island) throw new Error('Brak wyspy');
    await init();
    const shape = buildWedge(input.island);
    remember(key, shape);
    return shape;
  }
  if (input.piece !== undefined && input.split) {
    const whole = await plateFor({ ...input, piece: undefined });
    const { plan, clearance } = input.split;
    const shape =
      input.part === 'case' ? casePiece(whole, plan.caseX, input.piece) : platePiece(whole, plan, clearance, input.piece);
    remember(key, shape);
    return shape;
  }
  await init();
  const cell = await getCell(input);
  const c = input.case;
  const shape =
    input.part === 'case' && c
      ? buildCase(input.keys, input.plate, input.island, cell.height, c.params, c.layout)
      : buildPlate(input.keys, cell, input.plate, input.island, c ? screwPilots(c.layout.screws, cell.height, c.layout.pilotDepth, c.layout.screw) : []);
  remember(key, shape);
  return shape;
}

async function keycapFor(input: KeycapInput): Promise<Shape3D> {
  const key = 'keycap:' + JSON.stringify(input);
  const hit = shapeCache.get(key);
  if (hit) return hit;
  await init();
  let shape: Shape3D;
  const p = input.params;
  if (input.pose === 'insert' || input.pose === 'insert-turned') shape = insertPrintPose(p, buildInsert(p, input.pose === 'insert-turned'));
  else if (!input.cap) shape = buildCalibration(p);
  else if (input.pose === 'print' && p.orient === 'side')
    shape = printPose(p, buildKeycap(p, input.cap, p.sideStem === 'rib' ? { ribs: true } : { sockets: 'holes' }), input.cap);
  else if (input.pose === 'print') shape = printPose(p, await keycapFor({ ...input, pose: 'rest' }));
  else shape = buildKeycap(p, input.cap);
  remember(key, shape);
  return shape;
}

const post = (msg: Response, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  const t0 = performance.now();
  try {
    if (req.type === 'init') {
      await init();
      post({ id: req.id, type: 'ready' });
      return;
    }
    const shape =
      req.type === 'switch'
        ? (await init(), await loadSwitch({ step: new Blob([req.step]), up: req.up }))
        : req.type === 'step-mesh'
          ? (await init(), (await importSTEP(new Blob([req.step]))) as Shape3D)
        : req.type === 'dactyl-mesh' || req.type === 'dactyl-export'
          ? await dactylFor(req.input)
        : req.type === 'keycap-mesh' || req.type === 'keycap-export'
          ? await keycapFor(req.input)
          : await plateFor(req.input);
    if (req.type === 'mesh' || req.type === 'switch' || req.type === 'step-mesh' || req.type === 'dactyl-mesh' || req.type === 'keycap-mesh') {
      const m = shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
      const vertices = new Float32Array(m.vertices);
      const normals = new Float32Array(m.normals);
      const triangles = new Uint32Array(m.triangles);
      const bb = shape.boundingBox.bounds;
      post(
        { id: req.id, type: 'mesh', vertices, normals, triangles, bounds: bb, ms: performance.now() - t0 },
        [vertices.buffer, normals.buffer, triangles.buffer],
      );
    } else if (req.type === 'export' || req.type === 'dactyl-export' || req.type === 'keycap-export') {
      const blob =
        req.format === 'stl'
          ? shape.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 0.2 })
          : shape.blobSTEP();
      const data = await blob.arrayBuffer();
      post({ id: req.id, type: 'file', data, ms: performance.now() - t0 }, [data]);
    }
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
