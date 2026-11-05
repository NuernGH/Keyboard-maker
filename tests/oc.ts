import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';

let ready: Promise<void> | null = null;
export function initOC(): Promise<void> {
  if (!ready) {
    const wasm = fileURLToPath(new URL('../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
    ready = (opencascade as any)({ locateFile: () => wasm }).then((oc: any) => setOC(oc));
  }
  return ready;
}
export const cellStep = () =>
  new Blob([readFileSync(fileURLToPath(new URL('../public/cells/mx-hotswap.step', import.meta.url)))]);
