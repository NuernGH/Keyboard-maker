// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BuildInput, Request, Response } from './protocol';

type MeshResponse = Extract<Response, { type: 'mesh' }>;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Klient workera CAD. Jeden worker na połówkę, by lewa i prawa liczyły się równolegle. */
export class CadClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Response>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.type === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
  }

  private call(req: DistributiveOmit<Request, 'id'>): Promise<Response> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id });
    });
  }

  init() {
    return this.call({ type: 'init' });
  }

  async mesh(input: BuildInput): Promise<MeshResponse> {
    return (await this.call({ type: 'mesh', input })) as MeshResponse;
  }

  async exportFile(input: BuildInput, format: 'stl' | 'step'): Promise<ArrayBuffer> {
    const r = await this.call({ type: 'export', format, input });
    if (r.type !== 'file') throw new Error('Nieoczekiwana odpowiedź workera');
    return r.data;
  }
}
