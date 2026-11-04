<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Preview, { type PreviewHalf, type PreviewMesh } from './ui/Preview.svelte';
  import { t, type Lang } from './ui/i18n';
  import { SPLIT_4x6_4, TEMPLATES, splitLeft, mirrorKeys, keysOverlap, PITCH, type SplitParams } from './lib/layout';
  import {
    DEFAULT_PLATE_OPTIONS,
    NO_HOTSWAP_HEIGHT,
    THIN_PLATE_THICKNESS,
    type UpAxis,
    type CellVariant,
    type PlateOptions,
  } from './lib/cell-spec';
  import { CadClient } from './cad/client';
  import type { BuildInput } from './cad/protocol';
  import { zipStore } from './lib/zip';
  import Tooltip from './ui/Tooltip.svelte';
  import { CONTROLLERS, DEFAULT_ISLAND, islandFor, type IslandParams } from './lib/island';

  type Side = 'left' | 'right';

  let lang = $state<Lang>('pl');
  let params = $state<SplitParams>(structuredClone(SPLIT_4x6_4));
  let templateId = $state(TEMPLATES[0].id);
  let island = $state<IslandParams>({ ...DEFAULT_ISLAND });
  let showElectronics = $state(true);
  function applyTemplate(id: string) {
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (tpl) params = structuredClone(tpl.params);
  }
  let variant = $state<CellVariant>('hotswap');
  let plate = $state<PlateOptions>({ ...DEFAULT_PLATE_OPTIONS });
  let show = $state<'left' | 'right' | 'both'>('both');
  let up = $state<UpAxis | 'auto'>('auto');

  let cellName = $state('key socket.STEP');
  let cellStep = $state<ArrayBuffer | null>(null);
  let cellId = $state('default');

  let status = $state<string>('');
  let error = $state<string>('');
  let meshes = $state<Record<Side, { key: string; mesh: PreviewMesh } | null>>({ left: null, right: null });
  let busy = $state<Record<Side, boolean>>({ left: false, right: false });
  let lastMs = $state<number | null>(null);
  let preview: Preview | undefined = $state();

  const fullHeight = 8.58;
  let cellHeight = $derived(
    variant === 'thin-plate' ? THIN_PLATE_THICKNESS : variant === 'no-hotswap' ? NO_HOTSWAP_HEIGHT : fullHeight,
  );

  // stagger musi mieć tyle pozycji, ile kolumn
  $effect(() => {
    if (params.stagger.length !== params.cols) {
      params.stagger = Array.from({ length: params.cols }, (_, i) => params.stagger[i] ?? 0);
    }
  });

  let leftKeys = $derived(splitLeft($state.snapshot(params) as SplitParams));
  let rightKeys = $derived(mirrorKeys(leftKeys));
  let overlap = $derived.by(() => {
    const k = leftKeys;
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) if (keysOverlap(k[i], k[j])) return true;
    return false;
  });

  const islandGeom = (s: Side) =>
    islandFor($state.snapshot(params) as SplitParams, $state.snapshot(island) as IslandParams, s, variant, cellHeight);
  const keysFor = (s: Side) => (s === 'left' ? leftKeys : rightKeys);
  const sides = $derived<Side[]>(show === 'both' ? ['left', 'right'] : [show]);

  function inputFor(s: Side): BuildInput | null {
    if (!cellStep) return null;
    return {
      keys: keysFor(s),
      variant,
      plate: $state.snapshot(plate) as PlateOptions,
      cellId,
      cellStep,
      up,
      island: islandGeom(s),
    };
  }
  const inputKey = (i: BuildInput) => JSON.stringify({ ...i, cellStep: undefined });

  let halves = $derived.by<PreviewHalf[]>(() => {
    // rozstaw połówek: prawa obok lewej z odstępem 2U
    const kb = Math.max(...leftKeys.map((k) => k.x + (Math.max(k.w, k.h) * PITCH) / 2));
    const il = islandGeom('left');
    const ir = islandGeom('right');
    // zasięg w stronę środka: lewa w +X, prawa (lustro) w −X
    const reachL = Math.max(kb, il ? il.rect.x1 : -Infinity);
    const reachR = Math.max(kb, ir ? -ir.rect.x0 : -Infinity);
    const gap = 2 * PITCH;
    return sides.map((s) => {
      const inp = inputFor(s);
      const m = meshes[s];
      const fresh = inp && m && m.key === inputKey(inp) ? m.mesh : null;
      const offsetX = s === 'right' && show === 'both' ? reachL + reachR + gap : 0;
      return { keys: keysFor(s), offsetX, mesh: fresh, island: islandGeom(s), showElectronics };
    });
  });

  const clients: Partial<Record<Side, CadClient>> = {};
  const client = (s: Side) => (clients[s] ??= new CadClient());

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // przelicz dokładną bryłę po krótkiej przerwie od ostatniej zmiany
    const jobs = sides.map((s) => [s, inputFor(s)] as const);
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const [s, inp] of jobs) if (inp) void computeMesh(s, inp);
    }, 500);
  });

  const running: Partial<Record<Side, string>> = {};
  async function computeMesh(s: Side, inp: BuildInput) {
    const key = inputKey(inp);
    if (meshes[s]?.key === key || running[s] === key) return;
    running[s] = key;
    busy[s] = true;
    error = '';
    try {
      const r = await client(s).mesh(inp);
      lastMs = Math.round(r.ms);
      // zapisz tylko, jeśli nikt w międzyczasie nie zmienił parametrów
      if (running[s] === key) meshes[s] = { key, mesh: r };
    } catch (e) {
      error = (e as Error).message;
    } finally {
      if (running[s] === key) {
        busy[s] = false;
        running[s] = undefined;
      }
    }
  }

  async function exportFile(s: Side, format: 'stl' | 'step') {
    const inp = inputFor(s);
    if (!inp) return;
    status = t(lang, 'computing');
    error = '';
    try {
      const data = await client(s).exportFile(inp, format);
      const name = `plate-${s}-${variant}.${format}`;
      await saveFile(name, data);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      status = '';
    }
  }

  /**
   * Zapis pliku. W podglądzie Claude strona nie może sama pobierać plików, więc używa
   * zdolności `downloads`, która przyjmuje tylko wybrane rozszerzenia: STL/STEP pakujemy w ZIP.
   */
  async function saveFile(name: string, data: ArrayBuffer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claude = (window as any).claude;
    const downloads = claude?.use ? await claude.use('downloads') : null;
    if (downloads) {
      const zip = zipStore([{ name, data: new Uint8Array(data) }]);
      try {
        await downloads.save({ filename: name.replace(/\.[^.]+$/, '') + '.zip', data: zip });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== 'declined') throw new Error((e as Error).message ?? String(code));
      }
      return;
    }
    const blob = new Blob([data], { type: name.endsWith('.stl') ? 'model/stl' : 'model/step' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function loadDefaultCell() {
    const res = await fetch(`${import.meta.env.BASE_URL}cells/mx-hotswap.step`);
    cellStep = await res.arrayBuffer();
    cellName = 'key socket.STEP';
    cellId = 'default';
  }

  async function onCellFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    cellStep = await f.arrayBuffer();
    cellName = f.name;
    cellId = `${f.name}:${f.size}:${f.lastModified}`;
  }

  onMount(() => {
    status = t(lang, 'loadingCad');
    void loadDefaultCell();
    Promise.all((['left', 'right'] as Side[]).map((s) => client(s).init()))
      .then(() => (status = ''))
      .catch((e) => (error = String(e)));
  });

  const anyBusy = $derived(sides.some((s) => busy[s]));
  const allExact = $derived(halves.every((h) => h.mesh));
</script>

<Tooltip />
<div class="app">
  <aside>
    <header>
      <h1>{t(lang, 'title')}</h1>
      <select bind:value={lang} aria-label="Język / Language">
        <option value="pl">PL</option>
        <option value="en">EN</option>
      </select>
    </header>

    <section>
      <h2>{t(lang, 'template')}</h2>
      <select
        data-tip={t(lang, 'tipTemplate')}
        bind:value={templateId}
        onchange={() => applyTemplate(templateId)}
        aria-label={t(lang, 'template')}
      >
        {#each TEMPLATES as tpl (tpl.id)}
          <option value={tpl.id}>{tpl.name[lang]}</option>
        {/each}
      </select>
      <p class="muted">{leftKeys.length * 2} {t(lang, 'keys')}</p>
    </section>

    <section>
      <h2>{t(lang, 'cell')}</h2>
      <label data-tip={t(lang, 'tipVariant')}>
        {t(lang, 'variant')}
        <select bind:value={variant}>
          <option value="hotswap">{t(lang, 'hotswap')}</option>
          <option value="no-hotswap">{t(lang, 'noHotswap')}</option>
          <option value="thin-plate">{t(lang, 'thinPlate')}</option>
        </select>
      </label>
      <div class="row">
        <span class="muted" data-tip={t(lang, 'tipCellFile')}>{t(lang, 'cellFile')}: {cellId === 'default' ? t(lang, 'cellDefault') : cellName}</span>
      </div>
      <div class="row">
        <label class="file" data-tip={t(lang, 'tipLoadOwn')}>
          {t(lang, 'loadOwn')}
          <input type="file" accept=".step,.stp,.STEP,.STP" onchange={onCellFile} />
        </label>
        {#if cellId !== 'default'}
          <button onclick={loadDefaultCell}>key socket.STEP</button>
        {/if}
      </div>
      <label data-tip={t(lang, 'tipUpAxis')}>
        {t(lang, 'upAxis')}
        <select bind:value={up}>
          <option value="auto">{t(lang, 'auto')}</option>
          {#each ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as a (a)}
            <option value={a}>{a}</option>
          {/each}
        </select>
      </label>
    </section>

    <section>
      <h2>{t(lang, 'layout')}</h2>
      <div class="grid2">
        <label data-tip={t(lang, 'tipRows')}>{t(lang, 'rows')} <input type="number" min="1" max="8" bind:value={params.rows} /></label>
        <label data-tip={t(lang, 'tipCols')}>{t(lang, 'cols')} <input type="number" min="1" max="10" bind:value={params.cols} /></label>
      </div>
      <span class="label" data-tip={t(lang, 'tipStagger')}>{t(lang, 'stagger')}</span>
      <div class="stagger">
        {#each params.stagger as _, i (i)}
          <input type="number" step="0.5" bind:value={params.stagger[i]} aria-label="stagger {i + 1}" />
        {/each}
      </div>
    </section>

    <section>
      <h2>{t(lang, 'thumb')}</h2>
      <div class="grid2">
        <label data-tip={t(lang, 'tipThumbKeys')}>{t(lang, 'thumbKeys')} <input type="number" min="0" max="6" bind:value={params.thumbKeys} /></label>
        <label data-tip={t(lang, 'tipThumbCol')}
          >{t(lang, 'thumbCol')}
          <input type="number" min="1" max={params.cols} step="0.25" bind:value={() => params.thumbAnchorCol + 1, (v) => (params.thumbAnchorCol = v - 1)} /></label
        >
        <label data-tip={t(lang, 'tipThumbX')}>{t(lang, 'thumbX')} <input type="number" step="0.5" bind:value={params.thumbOffsetX} /></label>
        <label data-tip={t(lang, 'tipThumbY')}>{t(lang, 'thumbY')} <input type="number" step="0.5" bind:value={params.thumbOffsetY} /></label>
        <label data-tip={t(lang, 'tipThumbAngle')}>{t(lang, 'thumbAngle')} <input type="number" step="1" bind:value={params.thumbAngle} /></label>
        <label data-tip={t(lang, 'tipThumbSplay')}>{t(lang, 'thumbSplay')} <input type="number" step="1" bind:value={params.thumbSplay} /></label>
        <label data-tip={t(lang, 'tipThumbLastW')}
          >{t(lang, 'thumbLastW')}
          <select bind:value={params.thumbLastWidth}>
            <option value={1}>1U</option>
            <option value={1.25}>1,25U</option>
            <option value={1.5}>1,5U</option>
            <option value={2}>2U</option>
          </select></label
        >
        <label class="check" data-tip={t(lang, 'tipThumbLastV')}><input type="checkbox" bind:checked={params.thumbLastVertical} /> {t(lang, 'thumbLastV')}</label>
      </div>
      {#if overlap}<p class="warn">{t(lang, 'overlap')}</p>{/if}
    </section>

    <section>
      <h2>{t(lang, 'plate')}</h2>
      <div class="grid2">
        <label data-tip={t(lang, 'tipFillGaps')}>{t(lang, 'fillGaps')} <input type="number" min="0" step="0.5" bind:value={plate.fillGaps} /></label>
        <label data-tip={t(lang, 'tipMargin')}>{t(lang, 'margin')} <input type="number" min="0" step="0.5" bind:value={plate.margin} /></label>
      </div>
      <label data-tip={t(lang, 'tipHalves')}>
        {t(lang, 'halves')}
        <select bind:value={show}>
          <option value="both">{t(lang, 'both')}</option>
          <option value="left">{t(lang, 'left')}</option>
          <option value="right">{t(lang, 'right')}</option>
        </select>
      </label>
    </section>

    <section>
      <h2>{t(lang, 'electronics')}</h2>
      <label class="check" data-tip={t(lang, 'tipIsland')}><input type="checkbox" bind:checked={island.enabled} /> {t(lang, 'island')}</label>
      {#if island.enabled}
        <div class="grid2">
          <label data-tip={t(lang, 'tipController')}>{t(lang, 'controller')}
            <select bind:value={island.controller}>
              {#each Object.entries(CONTROLLERS) as [id, c] (id)}<option value={id}>{c.name}</option>{/each}
            </select>
          </label>
          <label data-tip={t(lang, 'tipModuleSide')}>{t(lang, 'moduleSide')}
            <select bind:value={island.moduleSide}>
              <option value="left">{t(lang, 'left')}</option>
              <option value="right">{t(lang, 'right')}</option>
              <option value="both">{t(lang, 'both')}</option>
              <option value="none">{t(lang, 'none')}</option>
            </select>
          </label>
          <label data-tip={t(lang, 'tipIslandDepth')}>{t(lang, 'islandDepth')} <input type="number" min="5" step="0.5" bind:value={island.depth} /></label>
          <span></span>
          <label data-tip={t(lang, 'tipIslandX')}>{t(lang, 'thumbX')} <input type="number" step="0.5" bind:value={island.offsetX} /></label>
          <label data-tip={t(lang, 'tipIslandY')}>{t(lang, 'thumbY')} <input type="number" step="0.5" bind:value={island.offsetY} /></label>
        </div>
        <label class="check" data-tip={t(lang, 'tipShowElectronics')}><input type="checkbox" bind:checked={showElectronics} /> {t(lang, 'showElectronics')}</label>
      {/if}
    </section>

    <section>
      <h2>{t(lang, 'export')}</h2>
      {#each ['left', 'right'] as const as s (s)}
        <div class="row">
          <span class="side">{t(lang, s)}</span>
          <button onclick={() => exportFile(s, 'stl')} disabled={!cellStep} data-tip={t(lang, 'tipStl')}>STL</button>
          <button onclick={() => exportFile(s, 'step')} disabled={!cellStep} data-tip={t(lang, 'tipStep')}>STEP</button>
        </div>
      {/each}
    </section>

    <footer class="muted">
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">{t(lang, 'license')}</a>
      · <a href="https://github.com/NuernGH/Keyboard-maker" target="_blank" rel="noreferrer">{t(lang, 'source')}</a>
    </footer>
  </aside>

  <main>
    <Preview bind:this={preview} {halves} {cellHeight} />
    <div class="hud">
      <span class="badge" class:exact={allExact} data-tip={t(lang, 'tipBadge')}>
        {#if anyBusy}{t(lang, 'computing')}{:else if allExact}{t(lang, 'exact')}{#if lastMs}&nbsp;· {lastMs} ms{/if}{:else}{t(lang, 'quick')}{/if}
      </span>
      {#if status}<span class="badge">{status}</span>{/if}
      {#if error}<span class="badge err">{t(lang, 'error')}: {error}</span>{/if}
      <button onclick={() => preview?.resetView()} data-tip={t(lang, 'tipResetView')}>{t(lang, 'resetView')}</button>
    </div>
  </main>
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 320px 1fr;
    height: 100%;
  }
  aside {
    overflow-y: auto;
    padding: 12px 16px;
    border-right: 1px solid var(--line);
    background: var(--panel);
  }
  header select {
    width: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  h1 {
    font-size: 17px;
    margin: 4px 0;
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 0 0 6px;
  }
  section {
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
    margin-bottom: 6px;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .label {
    font-size: 13px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 10px;
  }
  .stagger {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }
  .stagger input {
    padding: 4px 2px;
    font-size: 12px;
  }
  input[type='number'],
  select {
    width: 100%;
    min-width: 0;
    padding: 4px 6px;
    font: inherit;
    font-size: 13px;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .side {
    width: 50px;
    font-size: 13px;
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
    background: var(--bg);
    margin: 0;
  }
  button {
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
  .warn {
    color: #b45309;
    font-size: 12px;
  }
  main {
    position: relative;
    overflow: hidden;
  }
  .hud {
    position: absolute;
    top: 10px;
    left: 10px;
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .badge {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
  }
  .badge.exact {
    border-color: #4c8a5b;
    color: #2f6b3e;
  }
  .badge.err {
    border-color: #b91c1c;
    color: #b91c1c;
  }
  footer {
    padding-top: 10px;
  }
  @media (max-width: 760px) {
    .app {
      grid-template-columns: 1fr;
      grid-template-rows: 55vh auto;
      height: auto;
    }
    aside {
      order: 2;
    }
    main {
      height: 55vh;
    }
  }
</style>
