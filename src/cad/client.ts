// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BuildInput, DactylInput, KeycapInput, Request, Response } from './protocol';
import type { UpAxis } from '../lib/cell-spec';
import { getMesh, meshKey, putMesh } from './mesh-store';

type MeshResponse = Extract<Response, { type: 'mesh' }>;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Klient workera CAD. Jeden worker na połówkę, by lewa i prawa liczyły się równolegle. */
export class CadClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Response>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.type === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    return worker;
  }

  /**
   * Nowy worker w miejsce starego. OpenCascade (WASM) nie oddaje całej pamięci po dużych
   * operacjach logicznych, więc po kilku dużych bryłach (Dactyl) zaczynamy od czystej pamięci.
   * Zlecenia w toku kończą się błędem.
   */
  restart() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('restart'));
    this.pending.clear();
    this.worker = this.spawn();
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

  /**
   * Siatka podglądu: najpierw z pamięci przeglądarki (te same ustawienia i wersja aplikacji),
   * inaczej z workera i zapisana na później. `ms` z pamięci to czas pierwotnego liczenia.
   */
  private async cachedMesh(kind: 'mesh' | 'dactyl-mesh' | 'keycap-mesh', input: object, compute: () => Promise<Response>): Promise<MeshResponse> {
    const key = await meshKey(kind, input);
    const hit = key ? await getMesh<MeshResponse>(key) : null;
    if (hit) return { ...hit, cached: true };
    const r = (await compute()) as MeshResponse;
    if (key) void putMesh(key, r);
    return r;
  }

  mesh(input: BuildInput): Promise<MeshResponse> {
    return this.cachedMesh('mesh', input, () => this.call({ type: 'mesh', input }));
  }

  /** dokładna siatka Dactyla tylko z pamięci przeglądarki (bez liczenia); brak = null */
  async dactylMeshCached(input: DactylInput): Promise<MeshResponse | null> {
    const key = await meshKey('dactyl-mesh', input);
    const hit = key ? await getMesh<MeshResponse>(key) : null;
    return hit ? { ...hit, cached: true } : null;
  }

  dactylMesh(input: DactylInput): Promise<MeshResponse> {
    // szybki podgląd liczy się w ułamku sekundy: nie zajmuje pamięci
    if (input.preview) return this.call({ type: 'dactyl-mesh', input }) as Promise<MeshResponse>;
    return this.cachedMesh('dactyl-mesh', input, () => this.call({ type: 'dactyl-mesh', input }));
  }

  async dactylExport(input: DactylInput, format: 'stl' | 'step'): Promise<ArrayBuffer> {
    const r = await this.call({ type: 'dactyl-export', format, input });
    if (r.type !== 'file') throw new Error('Nieoczekiwana odpowiedź workera');
    return r.data;
  }

  keycapMesh(input: KeycapInput): Promise<MeshResponse> {
    return this.cachedMesh('keycap-mesh', input, () => this.call({ type: 'keycap-mesh', input }));
  }

  async keycapExport(input: KeycapInput, format: 'stl' | 'step'): Promise<ArrayBuffer> {
    const r = await this.call({ type: 'keycap-export', format, input });
    if (r.type !== 'file') throw new Error('Nieoczekiwana odpowiedź workera');
    return r.data;
  }

  /** siatka przełącznika ustawionego jak komórka (wierzch płyty z = 0, trzpień w (0, 0)) */
  async switchMesh(step: ArrayBuffer, up: UpAxis): Promise<MeshResponse> {
    return (await this.call({ type: 'switch', step, up })) as MeshResponse;
  }

  /** siatka modelu STEP bez zmian położenia (np. własny kontroler do pomiaru) */
  async stepMesh(step: ArrayBuffer): Promise<MeshResponse> {
    return (await this.call({ type: 'step-mesh', step })) as MeshResponse;
  }

  async exportFile(input: BuildInput, format: 'stl' | 'step'): Promise<ArrayBuffer> {
    const r = await this.call({ type: 'export', format, input });
    if (r.type !== 'file') throw new Error('Nieoczekiwana odpowiedź workera');
    return r.data;
  }
}
