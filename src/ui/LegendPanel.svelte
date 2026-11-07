<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Sekcja „Legendy”: sposób (rowek / wypukła w kolorze), rozmiary, tabela legend klawiszy
  (Główna / Shift / AltGr / Fn) i podgląd góry wybranego klawisza. Oddaje ułożone legendy przez `labels`
  (współrzędne na górze nakładki, mm, środek góry = 0, 0, +y od użytkownika) dla podglądu 3D.
-->
<script lang="ts">
  import type { Font } from 'opentype.js';
  import type { Lang } from './i18n';
  import { capLevels, capTop, legendMethod, DEFAULT_KEYCAP, type KeycapParams } from '../lib/keycap-spec';
  import {
    DEFAULT_LEGEND,
    LEGEND_LAYERS,
    LEGEND_MIN_STROKE,
    legendLayout,
    strokeWidth,
    textContours,
    type LegendLayer,
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
  }: {
    lang: Lang;
    keys: { w: number; h: number }[];
    /** identyfikator klawisza do legend (`${strona}:${id}`), w tej samej kolejności co `keys` */
    refs: string[];
    params: KeycapParams;
    labels?: Record<string, PlacedLegend[]>;
  } = $props();

  const L = {
    pl: {
      title: 'Legendy',
      method: 'Sposób',
      color: 'wypukła w drugim kolorze (zmiana filamentu)',
      groove: 'rowek na farbę',
      grooveSide: 'Przy druku na boku legenda jest rowkiem na farbę.',
      grooveDish: 'Na misie legenda jest rowkiem na farbę: wypukła w kolorze wymagałaby wielu zmian filamentu (możliwa z AMS w kolejnym etapie).',
      colorNote: 'Nakładka drukuje się górą do góry (gniazdo wymaga podpór w slicerze albo druku na boku). Dodaj w slicerze zmianę filamentu (M600) na wysokości {h} mm: od niej drukuje się legenda.',
      grooveNote: 'Po druku wetrzyj farbę (akryl, lakier do paznokci) w rowki i zetrzyj nadmiar z góry.',
      mainSize: 'Wysokość legendy głównej (mm)',
      subSize: 'Wysokość legend Shift / AltGr / Fn (mm)',
      depth: 'Głębokość rowka (mm)',
      raise: 'Wysokość legendy (mm)',
      thin: 'Kreska legend {l} ma ok. {w} mm, a przy dyszy 0,4 potrzeba co najmniej {m} mm: zwiększ wysokość liter.',
      key: 'Klawisz',
      main: 'Główna',
      shift: 'Shift',
      altgr: 'AltGr',
      fn: 'Fn',
      clear: 'Wyczyść wszystkie',
      preview: 'Podgląd góry klawisza',
      pick: 'Kliknij wiersz, żeby zobaczyć górę klawisza.',
      fontNote: 'Czcionka: Noto Sans Bold (SIL OFL 1.1).',
      loading: 'Wczytuję czcionkę…',
      sub: 'pomocniczych',
      mainL: 'głównej',
    },
    en: {
      title: 'Legends',
      method: 'Method',
      color: 'raised in a second colour (filament change)',
      groove: 'paint groove',
      grooveSide: 'When printed on its side the legend is a paint groove.',
      grooveDish: 'On a dish the legend is a paint groove: a raised colour legend would need many filament changes (possible with an AMS in a later stage).',
      colorNote: 'The cap prints top up (the stem needs slicer supports, or print on its side). Add a filament change (M600) in the slicer at {h} mm: the legend prints from there.',
      grooveNote: 'After printing, rub paint (acrylic, nail polish) into the grooves and wipe the top clean.',
      mainSize: 'Main legend height (mm)',
      subSize: 'Shift / AltGr / Fn legend height (mm)',
      depth: 'Groove depth (mm)',
      raise: 'Legend height (mm)',
      thin: 'The {l} legend stroke is about {w} mm; a 0.4 nozzle needs at least {m} mm: make the letters taller.',
      key: 'Key',
      main: 'Main',
      shift: 'Shift',
      altgr: 'AltGr',
      fn: 'Fn',
      clear: 'Clear all',
      preview: 'Key top preview',
      pick: 'Click a row to see the key top.',
      fontNote: 'Font: Noto Sans Bold (SIL OFL 1.1).',
      loading: 'Loading font…',
      sub: 'secondary',
      mainL: 'main',
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

  let selected = $state<string | null>(null);

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
      const [tw, th] = capTop(p, r.key.w, r.key.h);
      out[r.ref] = legendLayout(font, $state.snapshot(set), tw, th, l);
    }
    labels = out;
  });

  const thin = $derived.by(() => {
    if (!font) return [];
    const m = LEGEND_MIN_STROKE[method];
    const out: string[] = [];
    for (const [size, name] of [
      [lp.mainSize, tx('mainL')],
      [lp.subSize, tx('sub')],
    ] as const) {
      const w = strokeWidth(font, size);
      if (w < m - 1e-6) out.push(tx('thin').replace('{l}', name).replace('{w}', num(w)).replace('{m}', num(m)));
    }
    return out;
  });

  /** podgląd góry wybranego klawisza: obrys góry i kontury liter (SVG, mm) */
  const topView = $derived.by(() => {
    if (!font || !selected) return null;
    const r = rows.find((x) => x.ref === selected);
    if (!r) return null;
    const [tw, th] = capTop(params, r.key.w, r.key.h);
    const placed = labels?.[r.ref] ?? [];
    const d = placed
      .flatMap((pl) =>
        textContours(font!, pl.text, pl.size).contours.map(
          (c) => 'M' + c.map(([x, y]) => `${(x + pl.x).toFixed(3)},${(-(y + pl.y)).toFixed(3)}`).join('L') + 'Z',
        ),
      )
      .join('');
    return { tw, th, d, name: r.name };
  });
</script>

<section>
  <h2>{tx('title')}</h2>
  {#if params.orient === 'side'}
    <p class="muted">{tx('grooveSide')}</p>
  {:else if params.top !== 'flat'}
    <p class="muted">{tx('grooveDish')}</p>
  {:else if params.legend}
    <label>{tx('method')}
      <select bind:value={params.legend.method}>
        <option value="color">{tx('color')}</option>
        <option value="groove">{tx('groove')}</option>
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
      {#if method === 'groove'}
        <label>{tx('depth')}
          <input type="number" min="0.2" max="1.2" step="0.1" bind:value={params.legend.depth} />
        </label>
      {:else}
        <label>{tx('raise')}
          <input type="number" min="0.2" max="1.2" step="0.1" bind:value={params.legend.raise} />
        </label>
      {/if}
    </div>
  {/if}
  <p class="muted">{method === 'color' ? tx('colorNote').replace('{h}', num(lv.topEdge - lv.z0, 2)) : tx('grooveNote')}</p>
  {#each thin as w (w)}<p class="warn">{w}</p>{/each}
  {#if !font && !fontError}<p class="muted">{tx('loading')}</p>{/if}
  {#if fontError}<p class="warn">{fontError}</p>{/if}

  {#if topView}
    <figure class="top">
      <svg viewBox={`${-topView.tw / 2 - 1} ${-topView.th / 2 - 1} ${topView.tw + 2} ${topView.th + 2}`} aria-label={tx('preview')}>
        <rect x={-topView.tw / 2} y={-topView.th / 2} width={topView.tw} height={topView.th} rx={params.radius} class="cap" />
        <path d={topView.d} fill-rule="evenodd" class="glyphs" />
      </svg>
      <figcaption>{topView.name}</figcaption>
    </figure>
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
      <tbody>
        {#each rows as r (r.ref)}
          <tr class:sel={selected === r.ref} onfocusin={() => (selected = r.ref)} onclick={() => (selected = r.ref)}>
            <td class="name">{r.name}</td>
            {#each LEGEND_LAYERS as l (l)}
              <td>
                <input
                  type="text"
                  value={params.legends?.[r.ref]?.[l] ?? ''}
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
  .top {
    margin: 0 0 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .top svg {
    width: 100%;
    max-height: 150px;
  }
  .cap {
    fill: #d9a95b;
    stroke: #a37a3a;
    stroke-width: 0.15;
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
