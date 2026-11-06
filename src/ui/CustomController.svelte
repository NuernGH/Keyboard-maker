<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Własny kontroler: wgranie modelu STEP/STL, pomiar (mapa wysokości), poprawki orientacji,
  formularz z liczbami i zapis/odczyt .json. Model zostaje w przeglądarce.
-->
<script lang="ts">
  import { t, type Lang, type MsgKey } from './i18n';
  import { measureController, parseSTL, unindex, type MeasureOptions, type MeasureResult } from '../lib/controller-measure';
  import { sanitizeController, pinsOf, type Controller } from '../lib/island';
  import { registerControllerModel } from './controllerModel';

  interface Props {
    lang: Lang;
    value: Controller | undefined;
    /** STEP → trójkąty (w workerze CAD) */
    stepMesh: (step: ArrayBuffer) => Promise<{ vertices: Float32Array; triangles: Uint32Array }>;
  }
  let { lang, value = $bindable(), stepMesh }: Props = $props();

  const STORE = 'keyboard-maker.custom-controllers';
  let busy = $state(false);
  let error = $state('');
  let fileName = $state('');
  let result = $state.raw<MeasureResult | null>(null);
  let opts = $state<Required<Pick<MeasureOptions, 'scale' | 'flip' | 'swap' | 'usbEnd'>>>({ scale: 1, flip: false, swap: false, usbEnd: 'auto' });
  /** trójkąty ostatniego modelu (duże, bez reaktywności) */
  let tris: Float32Array | null = null;
  let modelSeq = 0;
  let canvas: HTMLCanvasElement | undefined = $state();

  const ctrl = $derived(value ?? sanitizeController({}));
  const fmt = (v: number) => (lang === 'pl' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(Math.round(v * 100) / 100));
  const parseNum = (s: string) => {
    const v = parseFloat(s.trim().replace(',', '.').replace('−', '-'));
    return Number.isFinite(v) ? v : NaN;
  };
  const parseList = (s: string) =>
    s
      .split(/[;\s]+/)
      .map(parseNum)
      .filter((v) => Number.isFinite(v));
  const msg = (k: string, v?: number) => t(lang, k as MsgKey).replace('{v}', v === undefined ? '' : fmt(v));

  function set(patch: Partial<Controller>) {
    value = sanitizeController({ ...ctrl, ...patch });
  }
  function setNum(k: keyof Controller, s: string) {
    const v = parseNum(s);
    if (Number.isFinite(v)) set({ [k]: v } as Partial<Controller>);
  }

  function measure() {
    if (!tris) return;
    try {
      const name = ctrl.name && value ? ctrl.name : fileName.replace(/\.[^.]+$/, '') || 'Własny kontroler';
      const r = measureController(tris, name, { ...opts });
      const path = `custom-model:${++modelSeq}`;
      registerControllerModel(path, r.positions);
      result = r;
      value = sanitizeController({ ...r.controller, name, model: path });
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    busy = true;
    error = '';
    try {
      const buf = await f.arrayBuffer();
      if (/\.stl$/i.test(f.name)) tris = parseSTL(buf);
      else {
        const m = await stepMesh(buf);
        tris = unindex(m.vertices, m.triangles);
      }
      fileName = f.name;
      opts = { scale: 1, flip: false, swap: false, usbEnd: 'auto' };
      value = undefined;
      measure();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  function toggle(k: 'flip' | 'swap') {
    opts[k] = !opts[k];
    opts.usbEnd = 'auto';
    measure();
  }
  function otherUsb() {
    opts.usbEnd = result?.usbEnd === '-' ? '+' : '-';
    measure();
  }

  // zapisane kontrolery (tylko liczby)
  const load = (): Controller[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) ?? '[]');
      return Array.isArray(raw) ? raw.map((c) => sanitizeController(c)) : [];
    } catch {
      return [];
    }
  };
  let saved = $state<Controller[]>(load());
  const strip = (c: Controller): Controller => {
    const { model: _m, ...rest } = c;
    return rest;
  };
  function save() {
    const c = strip(ctrl);
    saved = [...saved.filter((s) => s.name !== c.name), c];
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      /* brak pamięci przeglądarki: zostaje plik .json */
    }
  }
  function remove(name: string) {
    saved = saved.filter((s) => s.name !== name);
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      /* jw. */
    }
  }
  function pick(name: string) {
    const c = saved.find((s) => s.name === name);
    if (!c) return;
    result = null;
    tris = null;
    value = sanitizeController(c);
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify({ format: 'keyboard-maker-controller', version: 1, controller: strip(ctrl) }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ctrl.name.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'controller'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async function importJson(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const raw = JSON.parse(await f.text());
      result = null;
      tris = null;
      value = sanitizeController(raw?.controller ?? raw);
    } catch (err) {
      error = (err as Error).message;
    }
  }

  // rysunek z góry: mapa wysokości + płytka, gniazda, piny, otwory (z bieżących liczb)
  const STOPS = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const color = (f: number) => {
    const x = Math.min(0.999, Math.max(0, f)) * (STOPS.length - 1);
    const i = Math.floor(x);
    const k = x - i;
    return STOPS[i].map((c, j) => Math.round(c + (STOPS[i + 1][j] - c) * k));
  };
  $effect(() => {
    if (!canvas || !result) return;
    const { nx, ny, res, top, board } = result.map;
    const c = ctrl;
    const s = Math.min(6, 260 / Math.max(nx, ny * 0.75)); // piksele na pole mapy
    const px = s / res; // piksele na mm
    canvas.width = Math.ceil(nx * s);
    canvas.height = Math.ceil(ny * s);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    const hMax = Math.max(1, c.height);
    const img = g.createImageData(nx, ny);
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++) {
        const v = top[x * ny + y];
        const o = 4 * ((ny - 1 - y) * nx + x);
        if (Number.isNaN(v)) continue;
        const [r, gg, b] = color(v / hMax);
        img.data.set([r, gg, b, 255], o);
      }
    const tmp = document.createElement('canvas');
    tmp.width = nx;
    tmp.height = ny;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    // układ w mm: X od lewej, Y od dołu mapy
    const X = (mm: number) => mm * px;
    const Y = (mm: number) => canvas!.height - mm * px;
    const [bx0, bx1, by0, by1] = board;
    const cx = ((bx0 + bx1 + 1) / 2) * res;
    const yTop = (by1 + 1) * res;
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.strokeStyle = '#fff';
    g.strokeRect(X(bx0 * res), Y(yTop), X((bx1 - bx0 + 1) * res), (by1 - by0 + 1) * res * px);
    g.setLineDash([]);
    g.strokeStyle = '#ff3b30';
    for (const dx of c.ports ?? [0]) g.strokeRect(X(cx + dx - 4.5), Y(yTop + c.usbOverhang), X(9), (6.5 + c.usbOverhang) * px);
    const p = pinsOf(c);
    g.strokeStyle = '#4fc3f7';
    for (const r of p.x)
      for (const sg of [-1, 1]) {
        g.beginPath();
        g.moveTo(X(cx + sg * r), Y(yTop - p.y0));
        g.lineTo(X(cx + sg * r), Y(yTop - p.y1));
        g.stroke();
      }
    g.strokeStyle = '#7CFC00';
    for (const h of c.holes ?? [])
      for (const sg of [-1, 1]) {
        g.beginPath();
        g.arc(X(cx + sg * h.x), Y(yTop - h.y), (h.d / 2) * px + 1, 0, 2 * Math.PI);
        g.stroke();
      }
  });
</script>

<div class="cc">
  <div class="row">
    <label class="file" data-tip={t(lang, 'tipCtrlCustom')}>
      {busy ? t(lang, 'ccMeasuring') : t(lang, 'ccLoad')}
      <input type="file" accept=".step,.stp,.stl,.STEP,.STP,.STL" onchange={onFile} disabled={busy} />
    </label>
    {#if fileName && result}<span class="muted">{fileName}</span>{/if}
  </div>
  {#if error}<p class="warn">{error}</p>{/if}

  {#if result}
    <div class="row">
      <button onclick={() => toggle('flip')} data-tip={t(lang, 'tipCcFlip')}>⇅ {t(lang, 'ccFlip')}</button>
      <button onclick={() => toggle('swap')} data-tip={t(lang, 'tipCcSwap')}>↻ {t(lang, 'ccSwap')}</button>
      <button onclick={otherUsb} data-tip={t(lang, 'tipCcUsbOther')}>⇄ {t(lang, 'ccUsbOther')}</button>
    </div>
    <label data-tip={t(lang, 'tipCcUnits')}>{t(lang, 'ccUnits')}
      <select
        value={opts.scale}
        onchange={(e) => {
          opts.scale = +e.currentTarget.value;
          measure();
        }}
      >
        <option value={1}>mm</option>
        <option value={10}>cm</option>
        <option value={25.4}>{lang === 'pl' ? 'cale' : 'inch'}</option>
        <option value={1000}>m</option>
      </select>
    </label>
    <canvas bind:this={canvas} aria-label={t(lang, 'ccDrawing')}></canvas>
    <p class="muted">{t(lang, 'ccDrawing')}</p>
    {#each result.warnings as w (w.key)}<p class="warn">{msg(w.key, w.value)}</p>{/each}
    {#if result.tallestNotUsb}<p class="warn">{msg('mTallest')}</p>{/if}
  {:else}
    <p class="muted">{t(lang, 'ccNoModel')}</p>
  {/if}

  <label>{t(lang, 'ccName')} <input type="text" value={ctrl.name} onchange={(e) => set({ name: e.currentTarget.value })} /></label>
  <div class="grid2">
    <label>{t(lang, 'ccW')} <input type="number" step="0.05" value={ctrl.w} onchange={(e) => setNum('w', e.currentTarget.value)} /></label>
    <label data-tip={t(lang, 'tipCcH')}>{t(lang, 'ccH')} <input type="number" step="0.05" value={ctrl.h} onchange={(e) => setNum('h', e.currentTarget.value)} /></label>
    <label>{t(lang, 'ccPcb')} <input type="number" step="0.05" value={ctrl.pcb} onchange={(e) => setNum('pcb', e.currentTarget.value)} /></label>
    <label data-tip={t(lang, 'tipCcHeight')}>{t(lang, 'ccHeight')} <input type="number" step="0.05" value={ctrl.height} onchange={(e) => setNum('height', e.currentTarget.value)} /></label>
    <label>{t(lang, 'ccUsbOver')} <input type="number" step="0.05" value={ctrl.usbOverhang} onchange={(e) => setNum('usbOverhang', e.currentTarget.value)} /></label>
    <label data-tip={t(lang, 'tipCcUsbZ0')}>{t(lang, 'ccUsbZ0')} <input type="number" step="0.05" value={ctrl.usbZ0 ?? ctrl.pcb} onchange={(e) => setNum('usbZ0', e.currentTarget.value)} /></label>
    <label>{t(lang, 'ccUsbW')} <input type="number" step="0.1" value={ctrl.usbW} onchange={(e) => setNum('usbW', e.currentTarget.value)} /></label>
    <label>{t(lang, 'ccUsbH')} <input type="number" step="0.1" value={ctrl.usbH} onchange={(e) => setNum('usbH', e.currentTarget.value)} /></label>
  </div>
  <label data-tip={t(lang, 'tipCcPorts')}>{t(lang, 'ccPorts')}
    <input type="text" value={(ctrl.ports ?? []).map(fmt).join('; ')} onchange={(e) => {
      const v = parseList(e.currentTarget.value);
      set({ ports: v.length ? v : undefined });
    }} />
  </label>
  <div class="grid2">
    <label data-tip={t(lang, 'tipCcPins')}>{t(lang, 'ccPins')}
      <input type="text" value={pinsOf(ctrl).x.map(fmt).join('; ')} onchange={(e) => {
        const v = parseList(e.currentTarget.value);
        set({ pins: v.length ? { ...pinsOf(ctrl), x: v } : undefined });
      }} />
    </label>
    <label>{t(lang, 'ccPinsY')}
      <input type="text" value={`${fmt(pinsOf(ctrl).y0)}; ${fmt(pinsOf(ctrl).y1)}`} onchange={(e) => {
        const v = parseList(e.currentTarget.value);
        if (v.length === 2) set({ pins: { ...pinsOf(ctrl), y0: v[0], y1: v[1] } });
      }} />
    </label>
  </div>
  <label data-tip={t(lang, 'tipCcHoles')}>{t(lang, 'ccHoles')}
    <input type="text" value={(ctrl.holes ?? []).map((h) => `${fmt(h.x)}; ${fmt(h.y)}; ${fmt(h.d)}`).join(' | ')} onchange={(e) => {
      const holes = e.currentTarget.value
        .split('|')
        .map(parseList)
        .filter((v) => v.length === 3)
        .map(([x, y, d]) => ({ x, y, d }));
      set({ holes: holes.length ? holes : undefined });
    }} />
  </label>

  <div class="row" data-tip={t(lang, 'tipCcSave')}>
    <button onclick={save}>{t(lang, 'ccSave')}</button>
    <button onclick={exportJson}>{t(lang, 'ccExport')}</button>
    <label class="file">{t(lang, 'ccImport')}<input type="file" accept=".json,application/json" onchange={importJson} /></label>
  </div>
  {#if saved.length}
    <div class="row">
      <span class="muted">{t(lang, 'ccSaved')}:</span>
      {#each saved as s (s.name)}
        <span class="chip"><button onclick={() => pick(s.name)}>{s.name}</button><button class="del" aria-label={t(lang, 'ccDelete')} onclick={() => remove(s.name)}>×</button></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cc {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px;
    margin: 4px 0 8px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
    margin-bottom: 6px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 10px;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  input[type='number'],
  input[type='text'],
  select {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 5px 7px;
    font: inherit;
    font-size: 13px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
    color: inherit;
  }
  .file input {
    display: none;
  }
  .file {
    display: inline-block;
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    cursor: pointer;
    background: var(--field);
    margin: 0;
  }
  button {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    color: inherit;
  }
  button:hover {
    border-color: var(--accent);
  }
  .chip {
    display: inline-flex;
  }
  .chip button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .chip .del {
    border-radius: 0 6px 6px 0;
    border-left: none;
  }
  canvas {
    display: block;
    max-width: 100%;
    margin: 4px auto;
    background: var(--field);
    border-radius: 4px;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
    margin: 2px 0 6px;
  }
  .warn {
    color: var(--warn);
    font-size: 12px;
    margin: 2px 0 6px;
  }
</style>
