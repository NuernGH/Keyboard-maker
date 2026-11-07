<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Sekcja „Legendy”: sposób (rowek / wypukła w kolorze), rozmiary, tabela legend klawiszy
  (Główna / Shift / AltGr / Fn) i podgląd góry wybranego klawisza. Oddaje ułożone legendy przez `labels`
  (współrzędne na górze nakładki, mm, środek góry = 0, 0, +y od użytkownika) dla podglądu 3D.
-->
<script lang="ts">
  import type { Font } from 'opentype.js';
  import type { Lang } from './i18n';
  import { capFrontFace, capLevels, capTop, layoutKeyLegends, legendMethod, DEFAULT_KEYCAP, type KeycapParams } from '../lib/keycap-spec';
  import {
    DEFAULT_LEGEND,
    LEGEND_LAYERS,
    LEGEND_MIN_STROKE,
    placedContours,
    thinCheck,
    THIN_WARN,
    type LegendLayer,
    type LegendMethod,
    type LegendSet,
    type PlacedLegend,
  } from '../lib/legend';
  import { legendFont } from './font';

  let {
    lang,
    keys,
    refs,
    params = $bindable(),
    labels = $bindable(),
    selected = $bindable(null),
    defaults = {},
    fromKeymap = null,
  }: {
    lang: Lang;
    keys: { w: number; h: number }[];
    /** identyfikator klawisza do legend (`${strona}:${id}`), w tej samej kolejności co `keys` */
    refs: string[];
    params: KeycapParams;
    labels?: Record<string, PlacedLegend[]>;
    /** wybrany klawisz (`strona:id`), wspólny z podglądem 3D (kliknięcie nakładki wybiera wiersz) */
    selected?: string | null;
    /** domyślne opisy klawiszy (`strona:id`): podpowiedź w pustych polach i przycisk „Wstaw domyślne opisy” */
    defaults?: Record<string, LegendSet>;
    /** opisy z keymapy (zakładka Keymapa): główna, Shift, Fn po odnośnikach; null = przycisk ukryty */
    fromKeymap?: (() => Record<string, LegendSet>) | null;
  } = $props();

  const L = {
    pl: {
      title: 'Legendy',
      method: 'Sposób',
      color: 'wypukła w drugim kolorze (zmiana filamentu)',
      groove: 'rowek na farbę',
      inlay: 'wtopiona w kolorze (AMS, 2 części)',
      inlayNote: 'Litery wtopione równo z górą nakładki, drukowane drugim filamentem z AMS. Eksport daje dla każdego klawisza dwa pliki: nakładkę i litery („-legend”) w tym samym położeniu; wczytaj je w slicerze jako jeden obiekt z dwiema częściami. Opisy Fn na przedniej ściance zostają rowkiem na farbę.',
      inlayDepth: 'Grubość wtopionej legendy (mm)',
      grooveSide: 'Przy druku na boku legenda jest rowkiem na farbę.',
      grooveDish: 'Na misie wypukła legenda w kolorze wymagałaby wielu zmian filamentu: bez AMS legenda jest rowkiem na farbę.',
      colorNote: 'Nakładka drukuje się górą do góry (gniazdo wymaga podpór w slicerze albo druku na boku). Dodaj w slicerze zmianę filamentu (M600) na wysokości {h} mm: od niej drukuje się legenda.',
      grooveNote: 'Po druku wetrzyj farbę (akryl, lakier do paznokci) w rowki i zetrzyj nadmiar z góry.',
      mainSize: 'Wysokość legendy głównej (mm)',
      subSize: 'Wysokość Shift / AltGr / Fn (mm)',
      depth: 'Głębokość rowka (mm)',
      raise: 'Wysokość legendy (mm)',
      topFace: 'góra',
      frontFace: 'przednia ścianka (Fn)',
      thinShare: 'za cienkie dla dyszy 0,4 (na czerwono):',
      key: 'Klawisz',
      main: 'Główna',
      shift: 'Shift',
      altgr: 'AltGr',
      fn: 'Fn',
      clear: 'Wyczyść wszystkie',
      fill: 'Wstaw domyślne opisy',
      fromKm: 'Wstaw opisy z keymapy',
      fromKmTip: 'Główna z warstwy podstawowej, Fn z warstwy Fn keymapy (zakładka Keymapa). AltGr zostaje bez zmian.',
      fromKmAsk: 'Opisy Główna, Shift i Fn zostaną zastąpione opisami z keymapy (AltGr zostaje). Kontynuować?',
      preview: 'Podgląd góry klawisza',
      pick: 'Kliknij wiersz albo nakładkę w podglądzie, żeby zobaczyć górę klawisza.',
      fontNote: 'Czcionka: Noto Sans Black (SIL OFL 1.1).',
      loading: 'Wczytuję czcionkę…',
    },
    en: {
      title: 'Legends',
      method: 'Method',
      color: 'raised in a second colour (filament change)',
      groove: 'paint groove',
      inlay: 'inlaid in colour (AMS, 2 parts)',
      inlayNote: 'Letters sit flush with the cap top and print in a second filament from an AMS. Export gives two files per key: the cap and the letters ("-legend") in the same position; load them in the slicer as one object with two parts. Fn legends on the front wall stay paint grooves.',
      inlayDepth: 'Inlaid legend thickness (mm)',
      grooveSide: 'When printed on its side the legend is a paint groove.',
      grooveDish: 'On a dish a raised colour legend would need many filament changes: without an AMS the legend is a paint groove.',
      colorNote: 'The cap prints top up (the stem needs slicer supports, or print on its side). Add a filament change (M600) in the slicer at {h} mm: the legend prints from there.',
      grooveNote: 'After printing, rub paint (acrylic, nail polish) into the grooves and wipe the top clean.',
      mainSize: 'Main legend height (mm)',
      subSize: 'Shift / AltGr / Fn legend height (mm)',
      depth: 'Groove depth (mm)',
      raise: 'Legend height (mm)',
      topFace: 'top',
      frontFace: 'front wall (Fn)',
      thinShare: 'too thin for a 0.4 nozzle (red):',
      key: 'Key',
      main: 'Main',
      shift: 'Shift',
      altgr: 'AltGr',
      fn: 'Fn',
      clear: 'Clear all',
      fill: 'Insert default names',
      fromKm: 'Insert names from keymap',
      fromKmTip: 'Main from the base layer, Fn from the keymap Fn layer (Keymap tab). AltGr stays as it is.',
      fromKmAsk: 'Main, Shift and Fn legends will be replaced with names from the keymap (AltGr stays). Continue?',
      preview: 'Key top preview',
      pick: 'Click a row or a keycap in the preview to see the key top.',
      fontNote: 'Font: Noto Sans Black (SIL OFL 1.1).',
      loading: 'Loading font…',
    },
  } as const;
  type K = keyof (typeof L)['pl'];
  const tx = (k: K) => L[lang][k];
  const num = (v: number, d = 2) => {
    const s = String(Math.round(v * 10 ** d) / 10 ** d);
    return lang === 'pl' ? s.replace('.', ',') : s;
  };

  let font = $state.raw<Font | null>(null);
  let fontError = $state('');
  legendFont().then(
    (f) => (font = f),
    (e) => (fontError = (e as Error).message),
  );

  // brakujące pola w starych projektach
  $effect.pre(() => {
    if (!params.legend) params.legend = { ...DEFAULT_LEGEND, method: 'color' };
    if (!params.legends) params.legends = {};
  });
  const lp = $derived(params.legend ?? DEFAULT_KEYCAP.legend!);
  const method = $derived(legendMethod(params));
  const lv = $derived(capLevels(params));

  /** wiersze tabeli: jeden na klawisz, nazwa z identyfikatora (L/P = lewa/prawa połówka) */
  const rows = $derived.by(() => {
    const sides = new Set(refs.map((r) => r.split(':')[0]));
    // kolejność: połówka, potem identyfikator naturalnie (k-rząd-kolumna: rzędami od góry)
    return refs
      .map((ref, i) => {
        const [side, id] = ref.split(':');
        const tag = sides.size > 1 ? (side === 'left' ? 'L ' : lang === 'pl' ? 'P ' : 'R ') : '';
        return { ref, key: keys[i], name: tag + id, side, id };
      })
      .sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  });

  /** wstawia domyślne opisy tylko do klawiszy bez własnych legend (wpisane zostają) */
  function fillDefaults() {
    const map = { ...(params.legends ?? {}) };
    for (const r of rows) {
      const d = defaults[r.ref];
      if (!d || map[r.ref]) continue;
      const set: LegendSet = {};
      for (const l of LEGEND_LAYERS) if (d[l]?.trim()) set[l] = d[l];
      if (Object.keys(set).length) map[r.ref] = set;
    }
    params.legends = map;
  }
  /** zastępuje Główna/Shift/Fn opisami z keymapy (AltGr i klawisze spoza keymapy bez zmian) */
  function fillFromKeymap() {
    if (!fromKeymap) return;
    const src = fromKeymap();
    const map = { ...(params.legends ?? {}) };
    if (rows.some((r) => map[r.ref] && src[r.ref]) && !confirm(tx('fromKmAsk'))) return;
    for (const r of rows) {
      const k = src[r.ref];
      if (!k) continue;
      const set: LegendSet = {};
      if (map[r.ref]?.altgr) set.altgr = map[r.ref].altgr;
      for (const l of ['main', 'shift', 'fn'] as const) if (k[l]?.trim()) set[l] = k[l];
      if (Object.keys(set).length) map[r.ref] = set;
      else delete map[r.ref];
    }
    params.legends = map;
  }
  const missing = $derived(rows.filter((r) => defaults[r.ref] && !params.legends?.[r.ref]).length);
  // wiersz wybrany kliknięciem w podglądzie: przewiń tabelę do niego
  let tbody = $state<HTMLElement>();
  $effect(() => {
    const ref = selected;
    if (!ref || !tbody) return;
    const tr = tbody.querySelector(`tr[data-ref="${CSS.escape(ref)}"]`) as HTMLElement | null;
    if (tr && !tr.contains(document.activeElement)) tr.scrollIntoView({ block: 'nearest' });
  });

  function setText(ref: string, layer: LegendLayer, v: string) {
    const map = params.legends ?? (params.legends = {});
    const cur: LegendSet = { ...(map[ref] ?? {}) };
    if (v.trim()) cur[layer] = v;
    else delete cur[layer];
    if (Object.keys(cur).length) map[ref] = cur;
    else delete map[ref];
  }

  // ułożone legendy wszystkich klawiszy (podgląd 3D i góra wybranego klawisza)
  $effect(() => {
    if (!font) return;
    const out: Record<string, PlacedLegend[]> = {};
    const map = params.legends ?? {};
    const p = $state.snapshot(params) as KeycapParams;
    const l = $state.snapshot(lp);
    for (const r of rows) {
      const set = map[r.ref];
      if (!set) continue;
      out[r.ref] = layoutKeyLegends(font, $state.snapshot(set), { ...p, legend: { ...l, method: p.legend?.method ?? 'color' } }, r.key.w, r.key.h);
    }
    labels = out;
  });

  /** podgląd wybranego klawisza: góra i przednia ścianka z konturami liter (SVG, mm) i za cienkie fragmenty */
  const view = $derived.by(() => {
    if (!font || !selected) return null;
    const r = rows.find((x) => x.ref === selected);
    if (!r) return null;
    const [tw, th] = capTop(params, r.key.w, r.key.h);
    const f = capFrontFace(params, r.key.w, r.key.h);
    const { top, front } = placedContours(font, labels?.[r.ref] ?? []);
    const svgPath = (cs: typeof top) => cs.map((c) => 'M' + c.map(([x, y]) => `${x.toFixed(3)},${(-y).toFixed(3)}`).join('L') + 'Z').join('');
    const tTop = thinCheck(top, LEGEND_MIN_STROKE[method]);
    const tFront = thinCheck(front, LEGEND_MIN_STROKE.groove);
    return { tw, th, fw: f.width, fh: f.slant, top: svgPath(top), front: svgPath(front), thinTop: tTop, thinFront: tFront, name: r.name };
  });
  const pct = (v: number) => num(v * 100, 1) + ' %';
</script>

<section>
  <h2>{tx('title')}</h2>
  {#if params.orient === 'side'}
    <p class="muted">{tx('grooveSide')}</p>
  {:else if params.legend}
    {#if params.top !== 'flat'}<p class="muted">{tx('grooveDish')}</p>{/if}
    <label>{tx('method')}
      <select value={method} onchange={(e) => (params.legend!.method = (e.currentTarget as HTMLSelectElement).value as LegendMethod)}>
        {#if params.top === 'flat'}<option value="color">{tx('color')}</option>{/if}
        <option value="groove">{tx('groove')}</option>
        <option value="inlay">{tx('inlay')}</option>
      </select>
    </label>
  {/if}
  {#if params.legend}
    <div class="grid2">
      <label>{tx('mainSize')}
        <input type="number" min="1.5" max="8" step="0.1" bind:value={params.legend.mainSize} />
      </label>
      <label>{tx('subSize')}
        <input type="number" min="1.5" max="6" step="0.1" bind:value={params.legend.subSize} />
      </label>
      {#if method !== 'color'}
        <label>{tx(method === 'inlay' ? 'inlayDepth' : 'depth')}
          <input type="number" min="0.2" max="1.2" step="0.1" bind:value={params.legend.depth} />
        </label>
      {:else}
        <label>{tx('raise')}
          <input type="number" min="0.2" max="1.2" step="0.1" bind:value={params.legend.raise} />
        </label>
      {/if}
    </div>
  {/if}
  <p class="muted">{method === 'color' ? tx('colorNote').replace('{h}', num(lv.topEdge - lv.z0, 2)) : method === 'inlay' ? tx('inlayNote') : tx('grooveNote')}</p>
  {#if !font && !fontError}<p class="muted">{tx('loading')}</p>{/if}
  {#if fontError}<p class="warn">{fontError}</p>{/if}

  {#if view}
    <div class="faces">
      <figure class="top">
        <svg viewBox={`${-view.tw / 2 - 0.6} ${-view.th / 2 - 0.6} ${view.tw + 1.2} ${view.th + 1.2}`} aria-label={tx('preview')}>
          <rect x={-view.tw / 2} y={-view.th / 2} width={view.tw} height={view.th} rx={params.radius} class="cap" />
          <path d={view.top} fill-rule="evenodd" class="glyphs" />
          <path d={view.thinTop.path} class="thin" />
        </svg>
        <figcaption>{tx('topFace')}</figcaption>
      </figure>
      <figure class="front">
        <svg viewBox={`${-view.fw / 2 - 0.6} ${-view.fh / 2 - 0.6} ${view.fw + 1.2} ${view.fh + 1.2}`} aria-label={tx('frontFace')}>
          <rect x={-view.fw / 2} y={-view.fh / 2} width={view.fw} height={view.fh} rx={params.radius} class="cap" />
          <path d={view.front} fill-rule="evenodd" class="glyphs" />
          <path d={view.thinFront.path} class="thin" />
        </svg>
        <figcaption>{tx('frontFace')}</figcaption>
      </figure>
    </div>
    <p class="muted" class:warn={view.thinTop.fraction > THIN_WARN || view.thinFront.fraction > THIN_WARN}>
      {view.name}: {tx('thinShare')} {pct(Math.max(view.thinTop.fraction, view.thinFront.fraction))}
    </p>
  {:else}
    <p class="muted">{tx('pick')}</p>
  {/if}

  <div class="table">
    <table>
      <thead>
        <tr>
          <th>{tx('key')}</th>
          {#each LEGEND_LAYERS as l (l)}<th>{tx(l)}</th>{/each}
        </tr>
      </thead>
      <tbody bind:this={tbody}>
        {#each rows as r (r.ref)}
          <tr data-ref={r.ref} class:sel={selected === r.ref} onfocusin={() => (selected = r.ref)} onclick={() => (selected = r.ref)}>
            <td class="name">{r.name}</td>
            {#each LEGEND_LAYERS as l (l)}
              <td>
                <input
                  type="text"
                  value={params.legends?.[r.ref]?.[l] ?? ''}
                  placeholder={params.legends?.[r.ref] ? '' : (defaults[r.ref]?.[l] ?? '')}
                  oninput={(e) => setText(r.ref, l, (e.currentTarget as HTMLInputElement).value)}
                  aria-label={`${r.name} ${tx(l)}`}
                />
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="row">
    <button onclick={fillDefaults} disabled={!missing}>{tx('fill')}{missing ? ` (${missing})` : ''}</button>
    {#if fromKeymap}<button onclick={fillFromKeymap} data-tip={tx('fromKmTip')}>{tx('fromKm')}</button>{/if}
    <button onclick={() => (params.legends = {})}>{tx('clear')}</button>
  </div>
  <p class="muted">{tx('fontNote')}</p>
</section>

<style>
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
    gap: 0 8px;
  }
  input,
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
  .table {
    max-height: 340px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    margin-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--panel);
    text-align: left;
    font-weight: 600;
    padding: 5px 4px;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 2px 3px;
  }
  td input {
    padding: 3px 5px;
    font-size: 12px;
    border-radius: 5px;
  }
  td.name {
    white-space: nowrap;
    color: var(--muted);
    padding-left: 6px;
  }
  tr.sel td {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .top,
  .front {
    margin: 0 0 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .top svg,
  .front svg {
    width: 100%;
    max-height: 150px;
  }
  .cap {
    fill: #d9a95b;
    stroke: #a37a3a;
    stroke-width: 0.15;
  }
  .faces {
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: 8px;
    align-items: end;
  }
  .thin {
    fill: #e5322d;
  }
  .glyphs {
    fill: #2a2a2a;
  }
  figcaption {
    font-size: 12px;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
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
  button:hover {
    border-color: var(--accent);
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
</style>
