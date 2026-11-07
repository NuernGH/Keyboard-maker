<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Sekcja „Kolory podglądu”: motywy (punkt startu), kolory obudowy / płyty / klina, nakładki w trzech
  grupach i pojedyncze klawisze (wybór kliknięciem w podglądzie), legendy (wg grup albo tęcza)
  i podświetlenie RGB pod obudową. Zmienia wyłącznie podgląd; pliki do druku zostają bez zmian.
-->
<script lang="ts">
  import type { Lang } from './i18n';
  import { COLOR_THEMES, applyTheme, autoGroup, type CapGroup, type PreviewColors } from '../lib/colors';

  let {
    lang,
    kind = 'flat',
    colors = $bindable(),
    selected = $bindable(),
    keyInfo,
    capsShown,
    showCaps,
  }: {
    lang: Lang;
    /** Dactyl: obudowa = skorupa, płyta = dno, bez klina */
    kind?: 'flat' | 'dactyl';
    colors: PreviewColors;
    /** wybrany klawisz (`strona:id`) albo null */
    selected: string | null;
    /** nazwa i rozmiar wybranego klawisza (do grupy automatycznej i opisu) */
    keyInfo: (ref: string) => { main: string; w: number; h: number; named: boolean } | null;
    /** czy nakładki są widoczne w podglądzie */
    capsShown: boolean;
    /** włącza nakładki w podglądzie */
    showCaps: () => void;
  } = $props();

  const L = {
    pl: {
      title: 'Kolory podglądu',
      on: 'Własne kolory w podglądzie',
      note: 'Zmienia tylko podgląd. Pliki STL i STEP zostają takie same.',
      theme: 'Motyw (punkt startu)',
      applyTheme: 'Zastosuj motyw',
      bg: 'Tło',
      bgTheme: 'tło z motywu strony',
      case: 'Obudowa (spód)',
      plate: 'Płyta',
      wedge: 'Klin OLED',
      shell: 'Skorupa',
      bottom: 'Dno',
      caps: 'Nakładki',
      alpha: 'Litery',
      mod: 'Modyfikatory',
      accent: 'Akcent',
      capsHidden: 'Nakładek nie widać w podglądzie.',
      showCaps: 'Pokaż nakładki',
      legends: 'Legendy',
      showNames: 'Pokaż domyślne opisy klawiszy bez własnych legend',
      namesNote: 'Tylko podgląd. Do druku trafiają legendy z tabeli na karcie Nakładki (przycisk „Wstaw domyślne opisy”).',
      mode: 'Kolor legend',
      byGroup: 'wg grup',
      rainbow: 'tęcza',
      keys: 'Pojedyncze klawisze',
      pickHint: 'Kliknij nakładkę w podglądzie (albo wiersz w tabeli legend na karcie Nakładki).',
      key: 'Klawisz',
      group: 'Grupa',
      auto: 'automatycznie',
      capColor: 'Kolor nakładki',
      legendColor: 'Kolor legendy',
      own: 'własny',
      reset: 'Wyczyść klawisze',
      resetTip: 'Usuwa własne kolory i grupy wszystkich klawiszy',
      glow: 'Podświetlenie RGB pod obudową',
      glowOn: 'Włącz (tylko efekt w podglądzie)',
      single: 'jeden kolor',
      strength: 'Jasność',
      color: 'Kolor',
    },
    en: {
      title: 'Preview colours',
      on: 'Custom colours in preview',
      note: 'Changes the preview only. STL and STEP files stay the same.',
      theme: 'Theme (starting point)',
      applyTheme: 'Apply theme',
      bg: 'Background',
      bgTheme: 'background from page theme',
      case: 'Case (bottom)',
      plate: 'Plate',
      wedge: 'OLED wedge',
      shell: 'Shell',
      bottom: 'Bottom plate',
      caps: 'Keycaps',
      alpha: 'Alphas',
      mod: 'Modifiers',
      accent: 'Accent',
      capsHidden: 'Keycaps are hidden in the preview.',
      showCaps: 'Show keycaps',
      legends: 'Legends',
      showNames: 'Show default key names on keys without own legends',
      namesNote: 'Preview only. Printed legends come from the table on the Keycaps tab (“Insert default names” button).',
      mode: 'Legend colour',
      byGroup: 'by group',
      rainbow: 'rainbow',
      keys: 'Single keys',
      pickHint: 'Click a keycap in the preview (or a row in the legend table on the Keycaps tab).',
      key: 'Key',
      group: 'Group',
      auto: 'automatic',
      capColor: 'Keycap colour',
      legendColor: 'Legend colour',
      own: 'custom',
      reset: 'Clear keys',
      resetTip: 'Removes custom colours and groups from all keys',
      glow: 'RGB underglow',
      glowOn: 'On (preview effect only)',
      single: 'single colour',
      strength: 'Brightness',
      color: 'Colour',
    },
  } as const;
  const tx = (k: keyof (typeof L)['pl']) => L[lang][k];
  const groups: CapGroup[] = ['alpha', 'mod', 'accent'];

  let themeSel = $state(colors.theme);
  function turnOn(e: Event) {
    const on = (e.currentTarget as HTMLInputElement).checked;
    colors.on = on;
  }
  function doTheme() {
    colors = applyTheme($state.snapshot(colors) as PreviewColors, themeSel);
  }

  const info = $derived(selected ? keyInfo(selected) : null);
  const autoG = $derived(info ? autoGroup(info.main, info.w, info.h, info.named) : 'alpha');
  const selGroup = $derived(selected ? (colors.keyGroup[selected] ?? '') : '');
  const capOf = $derived(selected ? (colors.keyColor[selected] ?? colors.caps[colors.keyGroup[selected] ?? autoG]) : '#ffffff');
  const legOf = $derived(selected ? (colors.keyLegend[selected] ?? colors.legends.colors[colors.keyGroup[selected] ?? autoG]) : '#000000');

  function setGroup(e: Event) {
    if (!selected) return;
    const v = (e.currentTarget as HTMLSelectElement).value as CapGroup | '';
    const g = { ...colors.keyGroup };
    if (v) g[selected] = v;
    else delete g[selected];
    colors.keyGroup = g;
  }
  function setMap(field: 'keyColor' | 'keyLegend', value: string | null) {
    if (!selected) return;
    const m = { ...colors[field] };
    if (value) m[selected] = value;
    else delete m[selected];
    colors[field] = m;
  }
  function resetKeys() {
    colors.keyGroup = {};
    colors.keyColor = {};
    colors.keyLegend = {};
  }
  const keyCount = $derived(new Set([...Object.keys(colors.keyGroup), ...Object.keys(colors.keyColor), ...Object.keys(colors.keyLegend)]).size);
  const sideName = (ref: string) => {
    const s = ref.split(':')[0];
    return s === 'right' ? (lang === 'pl' ? 'prawa' : 'right') : s === 'left' ? (lang === 'pl' ? 'lewa' : 'left') : s;
  };
</script>

<section>
  <h2>{tx('title')}</h2>
  <label class="check"><input type="checkbox" checked={colors.on} onchange={turnOn} /> {tx('on')}</label>
  <p class="muted">{tx('note')}</p>
  {#if colors.on}
    <div class="row">
      <select bind:value={themeSel} aria-label={tx('theme')}>
        {#each COLOR_THEMES as th (th.id)}
          <option value={th.id}>{th.name[lang]}</option>
        {/each}
      </select>
      <button onclick={doTheme}>{tx('applyTheme')}</button>
    </div>

    <div class="grid">
      <span>{tx('bg')}</span>
      <span class="pair">
        <input type="color" value={colors.background || '#e9edf1'} oninput={(e) => (colors.background = e.currentTarget.value)} disabled={!colors.background} aria-label={tx('bg')} />
        <label class="check small"><input type="checkbox" checked={!colors.background} onchange={(e) => (colors.background = e.currentTarget.checked ? '' : '#101317')} /> {tx('bgTheme')}</label>
      </span>
      {#if kind === 'dactyl'}
        <span>{tx('shell')}</span><input type="color" bind:value={colors.case} aria-label={tx('shell')} />
        <span>{tx('bottom')}</span><input type="color" bind:value={colors.plate} aria-label={tx('bottom')} />
      {:else}
        <span>{tx('case')}</span><input type="color" bind:value={colors.case} aria-label={tx('case')} />
        <span>{tx('plate')}</span><input type="color" bind:value={colors.plate} aria-label={tx('plate')} />
        <span>{tx('wedge')}</span><input type="color" bind:value={colors.wedge} aria-label={tx('wedge')} />
      {/if}
    </div>

    <h3>{tx('caps')}</h3>
    {#if !capsShown}
      <p class="warn">{tx('capsHidden')} <button onclick={showCaps}>{tx('showCaps')}</button></p>
    {/if}
    <div class="grid">
      {#each groups as g (g)}
        <span>{tx(g)}</span><input type="color" bind:value={colors.caps[g]} aria-label={tx(g)} />
      {/each}
    </div>

    <h3>{tx('legends')}</h3>
    <label class="check"><input type="checkbox" bind:checked={colors.legends.show} /> {tx('showNames')}</label>
    {#if colors.legends.show}
      <p class="muted">{tx('namesNote')}</p>
      <label>{tx('mode')}
        <select bind:value={colors.legends.mode}>
          <option value="group">{tx('byGroup')}</option>
          <option value="rainbow">{tx('rainbow')}</option>
        </select>
      </label>
      {#if colors.legends.mode === 'group'}
        <div class="grid">
          {#each groups as g (g)}
            <span>{tx(g)}</span><input type="color" bind:value={colors.legends.colors[g]} aria-label={`${tx('legends')}: ${tx(g)}`} />
          {/each}
        </div>
      {/if}
    {/if}

    <h3>{tx('keys')}</h3>
    {#if !selected}<p class="muted">{tx('pickHint')}</p>{/if}
    {#if selected}
      <p class="sel">{tx('key')}: <b>{info?.main || selected.split(':')[1]}</b> <span class="muted">({sideName(selected)})</span></p>
      <label>{tx('group')}
        <select value={selGroup} onchange={setGroup}>
          <option value="">{tx('auto')} ({tx(autoG)})</option>
          {#each groups as g (g)}
            <option value={g}>{tx(g)}</option>
          {/each}
        </select>
      </label>
      <div class="grid">
        <span>{tx('capColor')}</span>
        <span class="pair">
          <input type="color" value={capOf} oninput={(e) => setMap('keyColor', e.currentTarget.value)} aria-label={tx('capColor')} />
          {#if colors.keyColor[selected]}<button class="x" onclick={() => setMap('keyColor', null)} title={tx('auto')}>×</button>{/if}
        </span>
        <span>{tx('legendColor')}</span>
        <span class="pair">
          <input type="color" value={legOf} oninput={(e) => setMap('keyLegend', e.currentTarget.value)} aria-label={tx('legendColor')} />
          {#if colors.keyLegend[selected]}<button class="x" onclick={() => setMap('keyLegend', null)} title={tx('auto')}>×</button>{/if}
        </span>
      </div>
    {/if}
    {#if keyCount}
      <div class="row"><button onclick={resetKeys} title={tx('resetTip')}>{tx('reset')} ({keyCount})</button></div>
    {/if}

    <h3>{tx('glow')}</h3>
    <label class="check"><input type="checkbox" bind:checked={colors.glow.on} /> {tx('glowOn')}</label>
    {#if colors.glow.on}
      <div class="grid">
        <span>{tx('color')}</span>
        <span class="pair">
          <select bind:value={colors.glow.mode} aria-label={tx('color')}>
            <option value="rainbow">{tx('rainbow')}</option>
            <option value="single">{tx('single')}</option>
          </select>
          {#if colors.glow.mode === 'single'}<input type="color" bind:value={colors.glow.color} aria-label={tx('color')} />{/if}
        </span>
        <span>{tx('strength')}</span>
        <input type="range" min="0" max="1" step="0.05" bind:value={colors.glow.strength} aria-label={tx('strength')} />
      </div>
    {/if}
  {/if}
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
    margin: 10px 0 4px;
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
  label.small {
    font-size: 12px;
    margin: 0;
  }
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
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 10px;
    align-items: center;
    font-size: 13px;
    margin-bottom: 6px;
  }
  .pair {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
  }
  .pair select {
    width: auto;
  }
  input[type='color'] {
    width: 44px;
    height: 26px;
    padding: 1px 2px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
    cursor: pointer;
  }
  input[type='color']:disabled {
    opacity: 0.4;
    cursor: default;
  }
  input[type='range'] {
    width: 120px;
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
    white-space: nowrap;
  }
  button:hover {
    border-color: var(--accent);
  }
  button.x {
    padding: 2px 8px;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
    margin: 0 0 6px;
  }
  .warn {
    font-size: 12px;
    color: var(--warn, #b26b00);
    margin: 0 0 6px;
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .sel {
    font-size: 13px;
    margin: 0 0 6px;
  }
</style>
