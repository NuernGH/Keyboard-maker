<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Sekcja „Okablowanie”: podgląd instrukcji w okienku i pobranie jej jako pliku HTML. -->
<script lang="ts">
  import { t, type Lang } from './i18n';
  import { wiringHtml, type WiringInput } from '../lib/wiring-doc';

  let {
    lang,
    input,
    fileBase,
    save,
  }: {
    lang: Lang;
    /** wejście liczone na żądanie z bieżących ustawień */
    input: () => WiringInput;
    fileBase: string;
    save: (name: string, data: ArrayBuffer) => Promise<void>;
  } = $props();

  let open = $state(false);
  let html = $state('');
  let error = $state('');

  function build(): string | null {
    error = '';
    try {
      return wiringHtml(input());
    } catch (e) {
      error = (e as Error).message;
      return null;
    }
  }
  function show() {
    const h = build();
    if (h) {
      html = h;
      open = true;
    }
  }
  async function download() {
    const h = build();
    if (!h) return;
    try {
      await save(`${fileBase}-${lang === 'pl' ? 'okablowanie' : 'wiring'}.html`, new TextEncoder().encode(h).buffer as ArrayBuffer);
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<section>
  <h2>{t(lang, 'wiring')}</h2>
  <p class="muted">{t(lang, 'wiringInfo')}</p>
  <div class="row">
    <button onclick={show} data-tip={t(lang, 'tipWiring')}>{t(lang, 'wiringShow')}</button>
    <button onclick={download} data-tip={t(lang, 'tipWiring')}>{t(lang, 'wiringDownload')}</button>
  </div>
  {#if error}<p class="warn">{error}</p>{/if}
</section>

{#if open}
  <div class="wiring-modal" role="dialog" aria-modal="true" aria-label={t(lang, 'wiring')}>
    <div class="box">
      <div class="bar">
        <b>{t(lang, 'wiring')}</b>
        <span class="grow"></span>
        <button onclick={download}>{t(lang, 'wiringDownload')}</button>
        <button onclick={() => (open = false)} aria-label={t(lang, 'close')}>{t(lang, 'close')}</button>
      </div>
      <iframe title={t(lang, 'wiring')} srcdoc={html}></iframe>
    </div>
  </div>
{/if}

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
  .wiring-modal {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(10, 15, 20, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .box {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    width: min(1060px, 100%);
    height: min(92vh, 100%);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
  }
  .grow {
    flex: 1;
  }
  iframe {
    flex: 1;
    border: 0;
    width: 100%;
    background: #fff;
  }
</style>
