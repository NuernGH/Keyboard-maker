// SPDX-License-Identifier: AGPL-3.0-or-later
// Web Worker z jądrem CAD. UI nie zawiesza się podczas operacji logicznych.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC, type Shape3D } from 'replicad';
import { buildPlate, loadCell, type Cell } from '../lib/geometry';
import type { Request, Response, BuildInput } from './protocol';

let ready: Promise<void> | null = null;
function init(): Promise<void> {
  if (!ready) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ready = (opencascade as any)({ locateFile: () => wasmUrl }).then((oc: unknown) => {
      setOC(oc as never);
    });
  }
  return ready!;
}

const cellCache = new Map<string, Promise<Cell>>();
let lastPlate: { key: string; shape: Shape3D } | null = null;

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

async function plateFor(input: BuildInput): Promise<Shape3D> {
  const key = JSON.stringify({ ...input, cellStep: undefined });
  if (lastPlate?.key === key) return lastPlate.shape;
  await init();
  const cell = await getCell(input);
  const shape = buildPlate(input.keys, cell, input.plate);
  lastPlate = { key, shape };
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
    const shape = await plateFor(req.input);
    if (req.type === 'mesh') {
      const m = shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
      const vertices = new Float32Array(m.vertices);
      const normals = new Float32Array(m.normals);
      const triangles = new Uint32Array(m.triangles);
      const bb = shape.boundingBox.bounds;
      post(
        { id: req.id, type: 'mesh', vertices, normals, triangles, bounds: bb, ms: performance.now() - t0 },
        [vertices.buffer, normals.buffer, triangles.buffer],
      );
    } else if (req.type === 'export') {
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
