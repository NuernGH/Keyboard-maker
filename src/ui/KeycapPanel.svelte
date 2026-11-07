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
  import { hasLegend, placedContours, thinCheck, DEFAULT_LEGEND, LEGEND_MIN_STROKE, THIN_WARN } from '../lib/legend';
  import type { KeycapLegend } from '../lib/keycap';
  import { legendFont } from './font';
  import {
    CALIBRATION_CLEARANCES,
    capLevels,
    capSet,
    capType,
    layoutKeyLegends,
    capWarnings,
    legendMethod,
    orientPreset,
    shapeParams,
    topPreset,
    type CapType,
    type KeycapParams,
  } from '../lib/keycap-spec';

  let {
    lang,
    keys,
    refs = [],
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
    /** identyfikatory klawiszy do legend, w kolejności `keys` */
    refs?: string[];
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
      calibrationNote: 'Cztery gniazda z luzem 0,2 / 0,25 / 0,3 / 0,35 mm (1–4 otworki na podstawce) i piąte, sprawdzone (kreska na podstawce: krzyż 4,2 × 1,4, walec Ø5,72). Wydrukuj, nałóż na przełącznik i wybierz to, które trzyma pewnie, ale bez siłowania.',
      socket: 'Wymiary gniazda',
      socketCalc: 'krzyż MX + luz z listy',
      socketProven: 'sprawdzone: krzyż 4,2 × 1,4, walec Ø5,72',
      tipSocket: 'Sprawdzone wymiary pochodzą z nakładki, która pewnie wpina się na MX. Przy nich luz z listy jest pomijany.',
      orientNoteDish: 'Do druku: misa do góry, dolną krawędzią na stole; gniazdo wisi w środku, więc włącz podpory w slicerze (podpory w generatorze w etapie 4).',
      orientNoteFlat: 'Do druku: płaską górą na stole (do góry nogami), bez podpór.',
      stemsNote: 'Gniazda jak w płycie: stabilizator Cherry daje 3 gniazda, „dwa MX” tam, gdzie stoją przełączniki.',
      orient: 'Druk',
      upright: 'normalnie (misa do góry, płaska do góry nogami)',
      side: 'na bocznej ściance, bez podpór',
      sideStem: 'Gniazdo przy druku na boku',
      rib: 'A: żebro do odłamania',
      insert: 'B: wkładka wklejana',
      orientNoteSide: 'Do druku: przednią ścianką na stole. Boki mają zbieżność 22,5°, więc wnętrze ma nawis 45° i nie potrzebuje podpór.',
      ribNote: 'Pod każdym gniazdem cienkie żebro (0,6 mm) do ścianki na stole. Po druku odłam je kombinerkami i wygładź walec: po wciśnięciu żebro uderzyłoby w przełącznik.',
      insertNote: 'Gniazda drukują się osobno jako wkładki (wejściem krzyża na stole). Wciśnij bolec z płaską ścianką w otwór w suficie nakładki i przyklej klejem CA; płaska ścianka ustawia krzyż.',
      inserts: 'wkładki',
      thinExport: 'Za cienkie fragmenty legend dla dyszy 0,4 (pokazane na czerwono w podglądzie klawisza): {k}. Pliki zapisane; zwiększ litery albo zmień tekst.',
      capSideOverhang: 'Boki mają mniejszą zbieżność niż 22,5°: wnętrze będzie miało nawis większy niż 45°. Zmniejsz bok góry albo wysokość.',
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
      calibrationNote: 'Four stems with 0.2 / 0.25 / 0.3 / 0.35 mm clearance (1–4 dots on the base) and a fifth, proven one (a line on the base: cross 4.2 × 1.4, stem Ø5.72). Print, try on a switch and pick the one that holds firmly without forcing.',
      socket: 'Socket size',
      socketCalc: 'MX cross + clearance from the list',
      socketProven: 'proven: cross 4.2 × 1.4, stem Ø5.72',
      tipSocket: 'The proven size comes from a keycap that snaps firmly onto MX. With it the clearance from the list is ignored.',
      orientNoteDish: 'For printing: dish up, bottom edge on the bed; the stem hangs inside, so enable supports in the slicer (generator supports come in stage 4).',
      orientNoteFlat: 'For printing: flat top on the bed (upside down), no supports.',
      stemsNote: 'Stems follow the plate: Cherry stabilizer gives 3 stems, "two MX" puts them where the switches are.',
      orient: 'Printing',
      upright: 'upright (dish up, flat upside down)',
      side: 'on its side, no supports',
      sideStem: 'Stem when printed on its side',
      rib: 'A: break-off rib',
      insert: 'B: glued-in insert',
      orientNoteSide: 'For printing: front face on the bed. Sides taper at 22.5°, so the cavity roof is a 45° overhang and needs no supports.',
      ribNote: 'A thin rib (0.6 mm) under every stem down to the wall on the bed. Break it off with pliers after printing and smooth the stem: it would hit the switch when pressed.',
      insertNote: 'Stems print separately as inserts (cross opening on the bed). Push the D-shaped pin into the hole in the cap ceiling and glue with CA; the flat orients the cross.',
      inserts: 'inserts',
      thinExport: 'Legend parts too thin for a 0.4 nozzle (shown red in the key preview): {k}. Files saved; make the letters bigger or change the text.',
      capSideOverhang: 'Sides taper less than 22.5°: the cavity roof overhang will exceed 45°. Reduce the top size or height.',
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

  /** parametry kształtu (bez tekstów legend): siatki typów nie zależą od legend */
  const snap = () => shapeParams($state.snapshot(params) as KeycapParams);
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
    if (params.orient === 'side') Object.assign(params, orientPreset(snap(), 'side'));
  }
  function onOrient(e: Event) {
    Object.assign(params, orientPreset(snap(), (e.currentTarget as HTMLSelectElement).value as KeycapParams['orient']));
  }
  /**
   * wkładki (wariant B): zwykłe i z krzyżem obróconym o 90° względem bolca D. Pionowa nakładka ma otwory D
   * obrócone o 90° (płaskie D w stronę stołu), więc zwykły trzpień potrzebuje wkładki obróconej,
   * a trzpień stabilizatora (krzyż już obrócony) zwykłej.
   */
  const inserts = $derived.by(() => {
    let plain = 0;
    let turned = 0;
    for (const { type, count } of set)
      for (const s of type.stems) {
        if (type.h > type.w && !s.stab) turned += count;
        else plain += count;
      }
    return { plain, turned };
  });
  const sideInsert = $derived(params.orient === 'side' && params.sideStem === 'insert');

  /** nazwa pliku z tekstu legendy (bez znaków niedozwolonych w nazwach plików) */
  const safe = (v: string) => v.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'x';

  let thinWarn = $state('');
  async function exportAll(format: 'stl' | 'step') {
    busy = true;
    error = '';
    thinWarn = '';
    try {
      const files: { name: string; data: Uint8Array<ArrayBuffer> }[] = [];
      const map = params.legends ?? {};
      const withText = refs.map((r, i) => (hasLegend(map[r]) ? i : -1)).filter((i) => i >= 0);
      if (withText.length) {
        // każdy klawisz z legendą osobno, pozostałe zgrupowane wg typu
        const font = await legendFont();
        const p = snap();
        const lp = params.legend ?? { ...DEFAULT_LEGEND, method: 'color' as const };
        const m = legendMethod(p);
        const rest = keys.filter((_, i) => !withText.includes(i));
        const thinKeys: string[] = [];
        for (const i of withText) {
          const type = capType(keys[i], stabs);
          const set = $state.snapshot(map[refs[i]]);
          const placed = placedContours(font, layoutKeyLegends(font, set, { ...p, legend: lp }, type.w, type.h));
          const legend: KeycapLegend = { contours: placed.top, front: placed.front, method: m, depth: lp.depth, raise: lp.raise };
          const thinShare = Math.max(thinCheck(placed.top, LEGEND_MIN_STROKE[m]).fraction, thinCheck(placed.front, LEGEND_MIN_STROKE.groove).fraction);
          if (thinShare > THIN_WARN) thinKeys.push(`${set.main ?? refs[i]} ${Math.round(thinShare * 100)} %`);
          const data = await client().keycapExport({ ...input(type, 'print'), legend }, format);
          const label = set.main ?? set.shift ?? set.fn ?? set.altgr ?? refs[i];
          files.push({ name: `${fileBase}-keycap-${String(i + 1).padStart(2, '0')}-${safe(label)}-${type.id}.${format}`, data: new Uint8Array(data) });
        }
        for (const { type, count } of capSet(rest, stabs)) {
          const data = await client().keycapExport(input(type, 'print'), format);
          files.push({ name: `${fileBase}-keycap-${type.id}-x${count}.${format}`, data: new Uint8Array(data) });
        }
        if (thinKeys.length) thinWarn = tx('thinExport').replace('{k}', thinKeys.join(', '));
        if (m === 'color') {
          const h = capLevels(p).topEdge - capLevels(p).z0;
          const note = (lang === 'pl' ? `Zmiana filamentu (M600) na wysokości ${h.toFixed(2)} mm: od niej drukuje się legenda.\n` : `Filament change (M600) at ${h.toFixed(2)} mm: the legend prints from there.\n`);
          files.push({ name: lang === 'pl' ? 'CZYTAJ.txt' : 'README.txt', data: new TextEncoder().encode(note) as Uint8Array<ArrayBuffer> });
        }
      } else
        for (const { type, count } of set) {
          const data = await client().keycapExport(input(type, 'print'), format);
          files.push({ name: `${fileBase}-keycap-${type.id}-x${count}.${format}`, data: new Uint8Array(data) });
        }
      if (sideInsert)
        for (const [pose, n, name] of [['insert', inserts.plain, 'stem-insert'], ['insert-turned', inserts.turned, 'stem-insert-turned']] as const)
          if (n > 0) {
            const data = await client().keycapExport({ params: snap(), cap: null, pose }, format);
            files.push({ name: `${fileBase}-${name}-x${n}.${format}`, data: new Uint8Array(data) });
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
  <label>{tx('orient')}
    <select value={params.orient} onchange={onOrient}>
      <option value="upright">{tx('upright')}</option>
      <option value="side">{tx('side')}</option>
    </select>
  </label>
  {#if params.orient === 'side'}
    <label>{tx('sideStem')}
      <select bind:value={params.sideStem}>
        <option value="rib">{tx('rib')}</option>
        <option value="insert">{tx('insert')}</option>
      </select>
    </label>
  {/if}
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
  <label data-tip={tx('tipSocket')}>{tx('socket')}
    <select value={params.socket ?? 'calc'} onchange={(e) => (params.socket = (e.currentTarget as HTMLSelectElement).value as 'calc' | 'proven')}>
      <option value="calc">{tx('socketCalc')}</option>
      <option value="proven">{tx('socketProven')}</option>
    </select>
  </label>
  <label data-tip={tx('tipClearance')}>{tx('clearance')}
    <select bind:value={params.clearance} disabled={params.socket === 'proven'}>
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
  {#if sideInsert}<p class="muted">{tx('inserts')}: {inserts.plain + inserts.turned} {tx('pcs')}</p>{/if}
  {#if params.orient === 'side'}
    <p class="muted">{tx('orientNoteSide')} {tx(params.sideStem === 'rib' ? 'ribNote' : 'insertNote')}</p>
  {:else}
    <p class="muted">{tx(params.top === 'flat' ? 'orientNoteFlat' : 'orientNoteDish')}</p>
  {/if}
  <div class="row">
    <button disabled={busy} onclick={() => exportCalibration('stl')}>STL · {tx('calibration')}</button>
    <button disabled={busy} onclick={() => exportCalibration('step')}>STEP</button>
  </div>
  <p class="muted">{tx('calibrationNote')}</p>
  {#if busy}<p class="muted">{tx('computing')}</p>{/if}
  {#if error}<p class="warn">{error}</p>{/if}
  {#if thinWarn}<p class="warn">{thinWarn}</p>{/if}
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
