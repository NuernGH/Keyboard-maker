<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Zakładka „Keymapa”: warstwy, edycja wiązania wybranego klawisza (wybór naciśnięciem albo z listy)
  i eksport pliku .keymap dla ZMK. Rysunek klawiatury jest w KeymapView (w miejscu podglądu 3D).
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Lang } from './i18n';
  import {
    NONE,
    SPECIAL_BINDINGS,
    TRANS,
    checkBinding,
    formatBinding,
    keymapFile,
    parseBinding,
    removeLayer,
    swapLayers,
    type Binding,
    type BindingKind,
    type KeymapData,
    type KeymapLayout,
  } from '../lib/keymap';
  import { HOLD_MODS, MOD_CODES, MOD_FN_NAME, captureKey, keyInfo, keyLabel, loneModifier, searchKeys, splitMods } from '../lib/keymap-keys';

  let {
    lang,
    keymap,
    edited,
    layout,
    layer = $bindable(0),
    selected = $bindable(null),
    names,
    target,
    fileName,
    title,
    layoutMap = null,
    onChange,
    onReset,
    save,
  }: {
    lang: Lang;
    /** keymapa w użyciu (własna albo domyślna) */
    keymap: KeymapData;
    /** czy keymapa była zmieniana (inaczej domyślna z układu) */
    edited: boolean;
    layout: KeymapLayout;
    layer?: number;
    selected?: string | null;
    /** opis klawisza do nagłówka edytora (domyślna legenda), po odnośniku */
    names: Record<string, string>;
    /** dla jakiego firmware jest eksport: shield s2mini_60 albo ogólny */
    target: 's2mini60' | 'generic';
    fileName: string;
    title: string;
    layoutMap?: Map<string, string> | null;
    onChange: (km: KeymapData) => void;
    onReset: () => void;
    save: (name: string, data: ArrayBuffer) => Promise<void>;
  } = $props();

  const pl = $derived(lang === 'pl');
  const T = (p: string, e: string) => (pl ? p : e);

  // ---------- warstwy ----------
  const cur = $derived(keymap.layers[layer] ?? keymap.layers[0]);
  $effect(() => {
    if (layer >= keymap.layers.length) layer = keymap.layers.length - 1;
  });
  function update(fn: (km: KeymapData) => void) {
    const km = structuredClone($state.snapshot(keymap)) as KeymapData;
    fn(km);
    onChange(km);
  }
  function addLayer() {
    update((km) => km.layers.push({ name: `${T('Warstwa', 'Layer')} ${km.layers.length}`, keys: {}, sensors: {} }));
    layer = keymap.layers.length;
  }
  function delLayer() {
    if (keymap.layers.length < 2) return;
    if (!confirm(T(`Usunąć warstwę „${cur.name}”? Klawisze, które do niej prowadzą, dostaną &none.`, `Delete layer "${cur.name}"? Keys leading to it become &none.`))) return;
    const i = layer;
    onChange(removeLayer(structuredClone($state.snapshot(keymap)) as KeymapData, i));
    layer = Math.max(0, i - 1);
  }
  function moveLayer(d: -1 | 1) {
    const j = layer + d;
    if (j < 0 || j >= keymap.layers.length) return;
    onChange(swapLayers(structuredClone($state.snapshot(keymap)) as KeymapData, layer, j));
    layer = j;
  }
  function rename(v: string) {
    update((km) => {
      km.layers[layer].name = v;
      delete km.layers[layer].node;
    });
  }

  // ---------- wybrany klawisz ----------
  const isEnc = $derived(!!selected?.endsWith(':enc'));
  const value = $derived.by(() => {
    if (!selected) return '';
    if (isEnc) return cur.sensors?.[selected] ?? (layer === 0 ? '&inc_dec_kp C_VOL_UP C_VOL_DN' : TRANS);
    return cur.keys[selected] ?? (layer === 0 ? NONE : TRANS);
  });
  const b = $derived(parseBinding(value));
  const problem = $derived(selected && !isEnc ? checkBinding(value, keymap.layers.length) : null);
  function setValue(v: string) {
    if (!selected) return;
    const ref = selected;
    update((km) => {
      const l = km.layers[layer];
      if (isEnc) (l.sensors ??= {})[ref] = v;
      else l.keys[ref] = v;
    });
  }
  const set = (nb: Binding) => setValue(formatBinding(nb));

  const KINDS: { id: BindingKind; pl: string; en: string }[] = [
    { id: 'kp', pl: 'Klawisz (&kp)', en: 'Key (&kp)' },
    { id: 'mo', pl: 'Warstwa, gdy trzymasz (&mo)', en: 'Layer while held (&mo)' },
    { id: 'lt', pl: 'Klawisz, a trzymany: warstwa (&lt)', en: 'Tap key / hold layer (&lt)' },
    { id: 'mt', pl: 'Klawisz, a trzymany: modyfikator (&mt)', en: 'Tap key / hold modifier (&mt)' },
    { id: 'tog', pl: 'Włącz/wyłącz warstwę (&tog)', en: 'Toggle layer (&tog)' },
    { id: 'to', pl: 'Przejdź na warstwę (&to)', en: 'Go to layer (&to)' },
    { id: 'trans', pl: 'Przezroczysty: jak warstwa niżej (&trans)', en: 'Transparent (&trans)' },
    { id: 'none', pl: 'Nic (&none)', en: 'Nothing (&none)' },
    { id: 'raw', pl: 'Inne zachowanie (tekst)', en: 'Other behavior (text)' },
  ];
  const keyOf = (x: Binding) => (x.kind === 'kp' || x.kind === 'lt' || x.kind === 'mt' ? x.key : 'A');
  const otherLayer = () => (keymap.layers.length > 1 ? (layer === 1 ? 0 : 1) : 0);
  function setKind(k: BindingKind) {
    const key = keyOf(b);
    const lay = 'layer' in b ? b.layer : otherLayer();
    if (k === 'kp') set({ kind: 'kp', key });
    else if (k === 'mo' || k === 'tog' || k === 'to') set({ kind: k, layer: lay });
    else if (k === 'lt') set({ kind: 'lt', layer: lay, key });
    else if (k === 'mt') set({ kind: 'mt', mod: 'LCTRL', key });
    else if (k === 'trans') set({ kind: 'trans' });
    else if (k === 'none') set({ kind: 'none' });
    else set({ kind: 'raw', text: value.startsWith('&') && b.kind === 'raw' ? value : '&studio_unlock' });
  }
  /** wpisuje kod klawisza w pole celu (klawisz w &kp/&lt/&mt albo obrót gałki) */
  function setKey(expr: string, which: Target = 'key') {
    if (isEnc) {
      const m = /^&inc_dec_kp\s+(\S+)\s+(\S+)$/.exec(value.trim());
      const cw = which === 'ccw' ? (m?.[1] ?? 'C_VOL_UP') : expr;
      const ccw = which === 'ccw' ? expr : (m?.[2] ?? 'C_VOL_DN');
      setValue(`&inc_dec_kp ${cw} ${ccw}`);
      return;
    }
    if (b.kind === 'lt') set({ ...b, key: expr });
    else if (b.kind === 'mt') set({ ...b, key: expr });
    else set({ kind: 'kp', key: expr });
  }
  const encParts = $derived.by(() => {
    const m = /^&inc_dec_kp\s+(\S+)\s+(\S+)$/.exec(value.trim());
    return m ? { cw: m[1], ccw: m[2] } : null;
  });

  // modyfikatory wokół klawisza w &kp (np. Ctrl+C)
  const kpMods = $derived(b.kind === 'kp' ? splitMods(b.key) : { mods: [] as string[], key: '' });
  function toggleMod(fn: string) {
    if (b.kind !== 'kp') return;
    const on = new Set(kpMods.mods);
    if (on.has(fn)) on.delete(fn);
    else on.add(fn);
    const order = ['LC', 'LS', 'LA', 'LG', 'RC', 'RS', 'RA', 'RG'];
    const mods = [...on].sort((a, c) => order.indexOf(a) - order.indexOf(c));
    set({ kind: 'kp', key: mods.reduceRight((acc, f) => `${f}(${acc})`, kpMods.key) });
  }

  // ---------- wybór naciśnięciem ----------
  type Target = 'key' | 'cw' | 'ccw';
  let listening = $state<Target | null>(null);
  let advance = $state(true);
  let heard = $state('');
  let held: string[] = [];
  let seq: string[] = [];
  let combo = false;

  function nextRef() {
    const refs = layout.slots.map((s) => s.ref);
    const i = selected ? refs.indexOf(selected) : -1;
    return i >= 0 && i < refs.length - 1 ? refs[i + 1] : null;
  }
  function applyCapture(expr: string) {
    if (!selected || !listening) return;
    heard = expr;
    setKey(expr, listening);
    if (advance && listening === 'key' && !isEnc && b.kind === 'kp') {
      const n = nextRef();
      if (n) selected = n;
    }
  }
  function onDown(e: KeyboardEvent) {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code in MOD_CODES) {
      if (!held.includes(e.code)) held.push(e.code);
      seq.push(e.code);
      return;
    }
    const expr = captureKey(e.code, held, e.getModifierState?.('AltGraph'));
    combo = true;
    if (expr) applyCapture(expr);
    else heard = T(`nieznany klawisz (${e.code || e.key}), wybierz z listy`, `unknown key (${e.code || e.key}), pick from the list`);
  }
  function onUp(e: KeyboardEvent) {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code in MOD_CODES) {
      held = held.filter((c) => c !== e.code);
      if (!held.length) {
        const lone = !combo ? loneModifier(seq) : null;
        seq = [];
        combo = false;
        if (lone) applyCapture(lone);
      }
    } else if (!held.length) {
      seq = [];
      combo = false;
    }
  }
  function onBlur() {
    held = [];
    seq = [];
    combo = false;
  }
  function listen(t: Target) {
    listening = listening === t ? null : t;
    heard = '';
    onBlur();
  }
  $effect(() => {
    if (!selected) listening = null;
  });
  $effect(() => {
    if (!listening) return;
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
    };
  });
  onDestroy(() => (listening = null));

  // ---------- lista z wyszukiwaniem ----------
  let query = $state('');
  let listFor = $state<Target>('key');
  const found = $derived(searchKeys(query, lang).slice(0, 80));

  // ---------- eksport ----------
  const exp = $derived(keymapFile(keymap, layout, { title }));
  let showText = $state(false);
  let msg = $state('');
  async function download() {
    msg = '';
    try {
      await save(fileName, new TextEncoder().encode(exp.text).buffer as ArrayBuffer);
    } catch (e) {
      msg = (e as Error).message;
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(exp.text);
      msg = T('Skopiowano do schowka.', 'Copied to clipboard.');
    } catch {
      msg = T('Nie udało się skopiować, zaznacz tekst ręcznie.', 'Copy failed, select the text manually.');
    }
  }
  const refName = (ref: string) => {
    const id = ref.split(':')[1] ?? ref;
    const side = ref.startsWith('right:') ? T('prawa', 'right') : '';
    const n = names[ref] || ({ 'mod-push': T('wciśnięcie gałki (PUSH)', 'knob press (PUSH)'), 'mod-con': 'CON', 'mod-bak': 'BAK', enc: T('obrót gałki', 'knob rotation') } as Record<string, string>)[id] || id;
    return side ? `${n} (${side})` : n;
  };
</script>

<section>
  <h2>{T('Warstwy', 'Layers')}</h2>
  <div class="layers" role="tablist">
    {#each keymap.layers as l, i (i)}
      <button role="tab" class:on={i === layer} aria-selected={i === layer} onclick={() => (layer = i)}>{i}: {l.name}</button>
    {/each}
    <button class="add" onclick={addLayer} title={T('Dodaj warstwę', 'Add layer')}>+</button>
  </div>
  <div class="row">
    <input class="name" value={cur.name} onchange={(e) => rename((e.target as HTMLInputElement).value)} aria-label={T('Nazwa warstwy', 'Layer name')} />
    <button onclick={() => moveLayer(-1)} disabled={layer === 0} title={T('Wyżej (mniejszy numer)', 'Up (lower number)')}>↑</button>
    <button onclick={() => moveLayer(1)} disabled={layer === keymap.layers.length - 1} title={T('Niżej', 'Down')}>↓</button>
    <button onclick={delLayer} disabled={keymap.layers.length < 2} title={T('Usuń warstwę', 'Delete layer')}>✕</button>
  </div>
  <p class="muted">
    {T('Warstwa 0 działa zawsze. Wyższe włącza klawisz &mo/&lt/&tog; ▽ (&trans) przepuszcza klawisz z warstwy niżej.', 'Layer 0 is always on. Higher layers are turned on by &mo/&lt/&tog keys; ▽ (&trans) falls through to the layer below.')}
  </p>
</section>

<section>
  <h2>{T('Klawisz', 'Key')}</h2>
  {#if !selected}
    <p class="muted">{T('Kliknij klawisz na rysunku.', 'Click a key in the drawing.')}</p>
  {:else}
    <p class="head"><b>{refName(selected)}</b> · <code>{value}</code></p>
    {#if isEnc}
      <p class="muted">{T('Gałka (EC11) wysyła klawisz przy obrocie w prawo i w lewo (&inc_dec_kp).', 'The knob (EC11) sends a key when turned right and left (&inc_dec_kp).')}</p>
      {#each [['cw', T('W prawo ↻', 'Right ↻')], ['ccw', T('W lewo ↺', 'Left ↺')]] as [w, lab] (w)}
        <div class="row">
          <span class="lab">{lab}</span>
          <code class="kv">{encParts ? keyLabel(w === 'cw' ? encParts.cw : encParts.ccw, layoutMap) : '—'}</code>
          <button class:on={listening === w} onclick={() => listen(w as Target)}>{listening === w ? T('Słucham… (kliknij, by skończyć)', 'Listening… (click to stop)') : T('Naciśnij klawisz', 'Press a key')}</button>
          <button class:on={listFor === w} onclick={() => (listFor = w as Target)} title={T('Wybór z listy poniżej trafi tutaj', 'List picks go here')}>☰</button>
        </div>
      {/each}
      <div class="row">
        <button onclick={() => setValue(TRANS)}>{T('Jak warstwa niżej (&trans)', 'Transparent (&trans)')}</button>
      </div>
    {:else}
      <label>
        {T('Rodzaj', 'Kind')}
        <select value={b.kind} onchange={(e) => setKind((e.target as HTMLSelectElement).value as BindingKind)}>
          {#each KINDS as k (k.id)}<option value={k.id}>{k[lang]}</option>{/each}
        </select>
      </label>

      {#if b.kind === 'mo' || b.kind === 'tog' || b.kind === 'to' || b.kind === 'lt'}
        <label>
          {T('Warstwa', 'Layer')}
          <select value={b.layer} onchange={(e) => set({ ...b, layer: Number((e.target as HTMLSelectElement).value) } as Binding)}>
            {#each keymap.layers as l, i (i)}<option value={i}>{i}: {l.name}</option>{/each}
            {#if b.layer >= keymap.layers.length}<option value={b.layer}>{b.layer}: ?</option>{/if}
          </select>
        </label>
      {/if}
      {#if b.kind === 'mt'}
        <label>
          {T('Trzymany', 'Hold')}
          <select value={b.mod} onchange={(e) => set({ ...b, mod: (e.target as HTMLSelectElement).value })}>
            {#each HOLD_MODS as m (m)}<option value={m}>{keyInfo(m)?.[lang] ?? m}</option>{/each}
          </select>
        </label>
      {/if}
      {#if b.kind === 'kp' || b.kind === 'lt' || b.kind === 'mt'}
        <div class="row">
          <span class="lab">{b.kind === 'kp' ? T('Kod', 'Code') : T('Naciśnięty', 'Tap')}</span>
          <input class="code" value={b.key} onchange={(e) => setKey((e.target as HTMLInputElement).value.trim().toUpperCase())} aria-label={T('Kod klawisza ZMK', 'ZMK key code')} />
          <span class="kv">{keyLabel(b.key, layoutMap)}</span>
        </div>
        <div class="row">
          <button class="listen" class:on={listening === 'key'} onclick={() => listen('key')}>
            {listening === 'key' ? T('Słucham… (kliknij, by skończyć)', 'Listening… (click to stop)') : T('Naciśnij klawisz', 'Press a key')}
          </button>
          <label class="check"><input type="checkbox" bind:checked={advance} />{T('potem następny', 'then next')}</label>
        </div>
        {#if listening}
          <p class="muted">
            {heard ? `${T('Złapane', 'Got')}: ${heard}. ` : ''}{T('Ctrl, Shift, Alt i AltGr trzymane razem z klawiszem dają kombinację (AltGr+A = RA(A), czyli „ą”). Sam modyfikator: naciśnij i puść. Skrótów systemu (Win, Alt+Tab, Ctrl+W) przeglądarka nie odda: wybierz je z listy.', 'Ctrl, Shift, Alt and AltGr held with a key make a combination (AltGr+A = RA(A)). A modifier alone: press and release. System shortcuts (Win, Alt+Tab, Ctrl+W) cannot be caught: pick them from the list.')}
          </p>
        {/if}
        {#if b.kind === 'kp'}
          <div class="mods">
            {#each ['LC', 'LS', 'LA', 'LG', 'RA'] as m (m)}
              <label class="check"><input type="checkbox" checked={kpMods.mods.includes(m)} onchange={() => toggleMod(m)} />{MOD_FN_NAME[m]}</label>
            {/each}
          </div>
        {/if}
      {/if}
      {#if b.kind === 'raw'}
        <label>
          {T('Zachowanie ZMK', 'ZMK behavior')}
          <input class="code" value={b.text} onchange={(e) => setValue((e.target as HTMLInputElement).value)} />
        </label>
        <div class="presets">
          {#each SPECIAL_BINDINGS as s (s.text)}
            <button onclick={() => setValue(s.text)} class:on={b.text === s.text}><code>{s.text}</code> {s[lang]}</button>
          {/each}
        </div>
      {/if}
      {#if problem}<p class="warn">{problem}</p>{/if}
    {/if}

    {#if isEnc || b.kind === 'kp' || b.kind === 'lt' || b.kind === 'mt'}
      <div class="search">
        <input type="search" bind:value={query} placeholder={T('Szukaj kodu: np. głośność, F13, średnik, PG_UP', 'Search: e.g. volume, F13, semicolon, PG_UP')} />
        <div class="list" role="listbox">
          {#each found as k (k.id)}
            <button
              role="option"
              aria-selected={false}
              onclick={() => setKey(isEnc ? k.id : kpMods.mods.length && b.kind === 'kp' ? kpMods.mods.reduceRight((acc, f) => `${f}(${acc})`, k.id) : k.id, isEnc ? listFor : 'key')}
            >
              <span class="sh">{k.short}</span>
              <code>{k.id}</code>
              <span class="desc">{k[lang]}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</section>

<section>
  <h2>{T('Eksport dla ZMK', 'Export for ZMK')}</h2>
  {#if target === 's2mini60'}
    <p class="muted">
      {T('Plik zastępuje', 'The file replaces')} <code>boards/shields/s2mini_60/s2mini_60.keymap</code>
      {T('w repo zmk-s2mini. Po wysłaniu zmian GitHub Actions zbuduje firmware do wgrania.', 'in the zmk-s2mini repo. After pushing, GitHub Actions builds the firmware.')}
    </p>
  {:else}
    <p class="warn">
      {T('Kolejność klawiszy jest taka jak w matrix_transform z instrukcji okablowania (zakładka Okablowanie). Sprawdzone tylko z shieldem 60% na S2 mini.', 'Key order follows the matrix_transform from the wiring guide (Wiring tab). Only checked against the 60% S2 mini shield.')}
    </p>
  {/if}
  <div class="row">
    <button onclick={download}>{T('Pobierz', 'Download')} {fileName}</button>
    <button onclick={() => (showText = !showText)}>{showText ? T('Ukryj tekst', 'Hide text') : T('Pokaż tekst', 'Show text')}</button>
    {#if showText}<button onclick={copy}>{T('Kopiuj', 'Copy')}</button>{/if}
  </div>
  {#if exp.problems.length}
    <p class="warn">
      {T('Do poprawienia', 'To fix')}:
      {#each exp.problems.slice(0, 6) as p, i (i)}
        <br /><button class="link" onclick={() => ((layer = p.layer), (selected = p.ref))}>{keymap.layers[p.layer]?.name}: {refName(p.ref)}</button> {p.msg}
      {/each}
    </p>
  {/if}
  {#if msg}<p class="muted">{msg}</p>{/if}
  {#if showText}<textarea readonly rows="16">{exp.text}</textarea>{/if}
  <div class="row">
    <button onclick={() => confirm(T('Przywrócić domyślną keymapę? Twoje zmiany przepadną.', 'Restore the default keymap? Your changes will be lost.')) && onReset()} disabled={!edited}>
      {T('Przywróć domyślną keymapę', 'Restore default keymap')}
    </button>
  </div>
  <p class="muted">{T('Keymapa zapisuje się w pliku projektu (.kbproj.json) i w linku.', 'The keymap is saved in the project file (.kbproj.json) and link.')}</p>
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
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 4px;
    margin: 0;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  button,
  input,
  select {
    font: inherit;
    font-size: 13px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
    color: inherit;
  }
  button {
    padding: 4px 10px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.5;
  }
  button.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, var(--field));
  }
  input,
  select {
    padding: 5px 7px;
    min-width: 0;
  }
  input[type='checkbox'] {
    padding: 0;
  }
  .layers {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .layers .add {
    padding: 4px 9px;
  }
  .name {
    flex: 1;
  }
  .head {
    font-size: 13px;
    margin: 0 0 8px;
  }
  .lab {
    font-size: 13px;
    min-width: 70px;
  }
  .code {
    flex: 1;
    font-family: ui-monospace, monospace;
  }
  .kv {
    font-size: 13px;
    color: var(--muted);
  }
  .listen {
    flex: 1;
  }
  .mods {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 13px;
    margin-bottom: 6px;
  }
  .presets {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
  }
  .presets button {
    text-align: left;
  }
  .search input {
    width: 100%;
    box-sizing: border-box;
    margin: 4px 0;
  }
  .list {
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .list button {
    display: grid;
    grid-template-columns: 52px 92px 1fr;
    gap: 6px;
    width: 100%;
    text-align: left;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    padding: 4px 8px;
    background: transparent;
  }
  .list button:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .sh {
    font-weight: 600;
  }
  .list code {
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .desc {
    font-size: 12px;
    color: var(--muted);
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font: 11.5px/1.35 ui-monospace, monospace;
    background: var(--field);
    color: inherit;
    border: 1px solid var(--line);
    border-radius: 6px;
    white-space: pre;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
  .warn {
    color: var(--warn);
    font-size: 12px;
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent);
    text-decoration: underline;
  }
</style>
