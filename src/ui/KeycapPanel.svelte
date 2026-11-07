<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Sekcja „Nakładki”: profil (misa / płaska góra), luz krzyża, lista typów nakładek z liczbą sztuk,
  eksport STL/STEP (ZIP: jeden plik na typ, ustawione do druku) i plik kalibracji luzu.
  Siatki typów do podglądu 3D liczy w tle i oddaje przez `meshes`.
-->
<script lang="ts">
  import type { Lang } from './i18n';
  import type { CadClient } from '../cad/client';
  import type { PreviewMesh } from './Preview.svelte';
  import { zipStore } from '../lib/zip';
  import {
    CALIBRATION_CLEARANCES,
    capLevels,
    capSet,
    capWarnings,
    topPreset,
    type CapType,
    type KeycapParams,
  } from '../lib/keycap-spec';

  let {
    lang,
    keys,
    stabs,
    client,
    fileBase,
    save,
    params = $bindable(),
    show = $bindable(),
    meshes = $bindable(),
  }: {
    lang: Lang;
    keys: { w: number; h: number }[];
    stabs: 'cherry' | 'mx' | 'none';
    client: () => CadClient;
    fileBase: string;
    save: (name: string, data: ArrayBuffer) => Promise<void>;
    params: KeycapParams;
    show: boolean;
    meshes: Record<string, PreviewMesh>;
  } = $props();

  const L = {
    pl: {
      title: 'Nakładki (keycaps)',
      show: 'Pokaż nakładki w podglądzie',
      top: 'Góra',
      dish: 'misa (wklęsła)',
      flat: 'płaska',
      height: 'Wysokość (mm)',
      topSize: 'Bok góry 1U (mm)',
      dishDepth: 'Głębokość misy (mm)',
      wall: 'Ścianka (mm)',
      topThickness: 'Grubość góry (mm)',
      radius: 'Zaokrąglenie naroży (mm)',
      clearance: 'Luz krzyża (mm)',
      types: 'Typy nakładek',
      pcs: 'szt.',
      stems: 'gniazda',
      exportAll: 'Wszystkie typy (ZIP)',
      calibration: 'Plik kalibracji luzu',
      calibrationNote: 'Cztery gniazda z luzem 0,2 / 0,25 / 0,3 / 0,35 mm (1–4 otworki na podstawce). Wydrukuj, nałóż na przełącznik i wpisz luz, który trzyma pewnie, ale bez siłowania.',
      orientNoteDish: 'Do druku: misa do góry, dolną krawędzią na stole; gniazdo wisi w środku, więc włącz podpory w slicerze (podpory w generatorze w etapie 4).',
      orientNoteFlat: 'Do druku: płaską górą na stole (do góry nogami), bez podpór.',
      stemsNote: 'Gniazda jak w płycie: stabilizator Cherry daje 3 gniazda, „dwa MX” tam, gdzie stoją przełączniki.',
      legendLater: 'Legendy dojdą w kolejnych etapach.',
      levels: 'Dolna krawędź {z0} mm nad płytą (po wciśnięciu {zp} mm), góra {top} mm.',
      computing: 'Liczę…',
      capTooTall: 'Za wysoka: dolna krawędź po wciśnięciu uderzyłaby w kołnierz przełącznika. Przycięto do {h} mm.',
      capThinWall: 'Ścianka przy suficie wnętrza cieńsza niż 0,8 mm: zwiększ bok góry albo zmniejsz wysokość.',
      capCavityTight: 'Wnętrze za ciasne na obudowę przełącznika po wciśnięciu: zmniejsz ściankę.',
      tipClearance: 'O ile gniazdo jest szersze od krzyża przełącznika (łącznie na ramię). Za mały luz: nakładka nie wejdzie albo pęknie; za duży: będzie spadać. Sprawdź plikiem kalibracji.',
      tipHeight: 'Od dolnej do górnej krawędzi. Niżej = mniejszy odstęp od kołnierza przełącznika po wciśnięciu; generator nie pozwoli zejść poniżej 0,3 mm.',
    },
    en: {
      title: 'Keycaps',
      show: 'Show keycaps in preview',
      top: 'Top',
      dish: 'dish (concave)',
      flat: 'flat',
      height: 'Height (mm)',
      topSize: 'Top size 1U (mm)',
      dishDepth: 'Dish depth (mm)',
      wall: 'Wall (mm)',
      topThickness: 'Top thickness (mm)',
      radius: 'Corner radius (mm)',
      clearance: 'Stem clearance (mm)',
      types: 'Keycap types',
      pcs: 'pcs',
      stems: 'stems',
      exportAll: 'All types (ZIP)',
      calibration: 'Clearance test file',
      calibrationNote: 'Four stems with 0.2 / 0.25 / 0.3 / 0.35 mm clearance (1–4 dots on the base). Print, try on a switch and enter the clearance that holds firmly without forcing.',
      orientNoteDish: 'For printing: dish up, bottom edge on the bed; the stem hangs inside, so enable supports in the slicer (generator supports come in stage 4).',
      orientNoteFlat: 'For printing: flat top on the bed (upside down), no supports.',
      stemsNote: 'Stems follow the plate: Cherry stabilizer gives 3 stems, "two MX" puts them where the switches are.',
      legendLater: 'Legends come in the next stages.',
      levels: 'Bottom edge {z0} mm above plate ({zp} mm when pressed), top {top} mm.',
      computing: 'Computing…',
      capTooTall: 'Too tall: the bottom edge would hit the switch flange when pressed. Clamped to {h} mm.',
      capThinWall: 'Wall at the cavity ceiling thinner than 0.8 mm: increase top size or reduce height.',
      capCavityTight: 'Cavity too tight for the switch housing when pressed: reduce the wall.',
      tipClearance: 'How much wider the socket is than the switch cross (total per arm). Too small: the cap will not fit or will crack; too large: it falls off. Check with the test file.',
      tipHeight: 'From the bottom edge to the top edge. Lower = less room above the switch flange when pressed; the generator keeps at least 0.3 mm.',
    },
  } as const;
  type K = keyof (typeof L)['pl'];
  const tx = (k: K) => L[lang][k];
  const num = (v: number, d = 2) => {
    const s = String(Math.round(v * 10 ** d) / 10 ** d);
    return lang === 'pl' ? s.replace('.', ',') : s;
  };

  const set = $derived(capSet(keys, stabs));
  const lv = $derived(capLevels(params));
  const warns = $derived(capWarnings(params));
  let busy = $state(false);
  let error = $state('');

  const snap = () => $state.snapshot(params) as KeycapParams;
  const input = (cap: CapType | null, pose: 'rest' | 'print') => ({ params: snap(), cap: cap ? ($state.snapshot(cap) as CapType) : null, pose });

  // siatki typów do podglądu: po krótkiej przerwie od ostatniej zmiany
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gen = 0;
  $effect(() => {
    if (!show) return;
    const types = set.map((s) => s.type);
    const key = JSON.stringify(snap());
    clearTimeout(timer);
    const my = ++gen;
    timer = setTimeout(async () => {
      const out: Record<string, PreviewMesh> = {};
      for (const t of types) {
        try {
          out[t.id] = await client().keycapMesh(input(t, 'rest'));
        } catch (e) {
          error = (e as Error).message;
          return;
        }
        if (my !== gen) return;
      }
      if (my === gen && key === JSON.stringify(snap())) meshes = out;
    }, 400);
  });

  function onTop(e: Event) {
    const top = (e.currentTarget as HTMLSelectElement).value as KeycapParams['top'];
    Object.assign(params, topPreset(top));
  }

  async function exportAll(format: 'stl' | 'step') {
    busy = true;
    error = '';
    try {
      const files: { name: string; data: Uint8Array<ArrayBuffer> }[] = [];
      for (const { type, count } of set) {
        const data = await client().keycapExport(input(type, 'print'), format);
        files.push({ name: `${fileBase}-keycap-${type.id}-x${count}.${format}`, data: new Uint8Array(data) });
      }
      await save(`${fileBase}-keycaps-${format}.zip`, await zipStore(files).arrayBuffer());
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function exportCalibration(format: 'stl' | 'step') {
    busy = true;
    error = '';
    try {
      await save(`keycap-clearance-test.${format}`, await client().keycapExport(input(null, 'print'), format));
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <h2>{tx('title')}</h2>
  <label class="check"><input type="checkbox" bind:checked={show} /> {tx('show')}</label>
  <label>{tx('top')}
    <select value={params.top} onchange={onTop}>
      <option value="dish">{tx('dish')}</option>
      <option value="flat">{tx('flat')}</option>
    </select>
  </label>
  <label data-tip={tx('tipHeight')}>{tx('height')}
    <input type="number" min="4" max="10" step="0.1" bind:value={params.height} />
  </label>
  <label>{tx('topSize')}
    <input type="number" min="10" max="16" step="0.1" bind:value={params.topSize} />
  </label>
  {#if params.top === 'dish'}
    <label>{tx('dishDepth')}
      <input type="number" min="0" max="2" step="0.1" bind:value={params.dish} />
    </label>
  {/if}
  <label>{tx('wall')}
    <input type="number" min="0.8" max="2.5" step="0.1" bind:value={params.wall} />
  </label>
  <label>{tx('topThickness')}
    <input type="number" min="1" max="4" step="0.1" bind:value={params.topThickness} />
  </label>
  <label>{tx('radius')}
    <input type="number" min="0.2" max="4" step="0.1" bind:value={params.radius} />
  </label>
  <label data-tip={tx('tipClearance')}>{tx('clearance')}
    <select bind:value={params.clearance}>
      {#each CALIBRATION_CLEARANCES as c (c)}<option value={c}>{num(c)}</option>{/each}
      {#if !CALIBRATION_CLEARANCES.includes(params.clearance)}<option value={params.clearance}>{num(params.clearance)}</option>{/if}
    </select>
  </label>
  <p class="muted">{tx('levels').replace('{z0}', num(lv.z0, 1)).replace('{zp}', num(lv.z0 - 4, 1)).replace('{top}', num(lv.topEdge, 1))}</p>
  {#each warns as w (w)}<p class="warn">{tx(w as K).replace('{h}', num(lv.maxHeight, 1))}</p>{/each}

  <h3>{tx('types')}</h3>
  <ul class="caps">
    {#each set as s (s.type.id)}
      <li>{s.type.id} × {s.count} {tx('pcs')}{#if s.type.stems.length > 1} · {s.type.stems.length} {tx('stems')}{/if}</li>
    {/each}
  </ul>
  <p class="muted">{tx('stemsNote')}</p>
  <div class="row">
    <button disabled={busy} onclick={() => exportAll('stl')}>STL · {tx('exportAll')}</button>
    <button disabled={busy} onclick={() => exportAll('step')}>STEP</button>
  </div>
  <p class="muted">{tx(params.top === 'flat' ? 'orientNoteFlat' : 'orientNoteDish')}</p>
  <div class="row">
    <button disabled={busy} onclick={() => exportCalibration('stl')}>STL · {tx('calibration')}</button>
    <button disabled={busy} onclick={() => exportCalibration('step')}>STEP</button>
  </div>
  <p class="muted">{tx('calibrationNote')}</p>
  <p class="muted">{tx('legendLater')}</p>
  {#if busy}<p class="muted">{tx('computing')}</p>{/if}
  {#if error}<p class="warn">{error}</p>{/if}
</section>

<style>
  /* te same style co sekcje panelu w App.svelte (style Svelte są lokalne dla komponentu) */
  section {
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 0 0 6px;
  }
  h3 {
    font-size: 12px;
    margin: 8px 0 2px;
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
  input[type='number'],
  select {
    width: 100%;
    min-width: 0;
    padding: 5px 7px;
    font: inherit;
    font-size: 13px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
    color: var(--text);
    box-sizing: border-box;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  button {
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.5;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
    margin: 0 0 8px;
  }
  .warn {
    color: var(--warn);
    font-size: 12px;
  }
  .caps {
    margin: 2px 0 6px;
    padding-left: 18px;
    font-size: 12px;
  }
</style>
