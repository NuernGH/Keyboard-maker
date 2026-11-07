<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Zapis i odczyt projektu: pobranie pliku .kbproj.json, wczytanie go z dysku i link z ustawieniami.
-->
<script lang="ts">
  import type { Lang } from './i18n';
  import { PROJECT_EXT, LINK_KEY, encodeLink, parseProject, type ProjectFile } from '../lib/project';

  let {
    lang,
    name,
    get,
    onLoad,
    hasCell = false,
  }: {
    lang: Lang;
    /** podpowiedź nazwy pliku (np. nazwa szablonu) */
    name: string;
    get: () => ProjectFile;
    onLoad: (p: ProjectFile) => void;
    /** wczytana własna komórka STEP: link jej nie zawiera */
    hasCell?: boolean;
  } = $props();

  const L = {
    pl: {
      save: 'Zapisz projekt',
      load: 'Wczytaj projekt…',
      link: 'Kopiuj link',
      tipSave: 'Pobiera plik .kbproj.json ze wszystkimi ustawieniami (z własną komórką STEP, jeśli ją wczytałeś).',
      tipLoad: 'Otwiera zapisany plik projektu i ustawia wszystko jak w chwili zapisu.',
      tipLink: 'Kopiuje adres z ustawieniami. Kto go otworzy, zobaczy ten sam projekt. Bez własnej komórki STEP.',
      copied: 'Link skopiowany do schowka.',
      copyFail: 'Nie udało się skopiować, zaznacz link poniżej:',
      noCell: 'Link nie zawiera własnej komórki STEP (jest za duża); użyj pliku projektu.',
      loaded: 'Wczytano projekt',
      errors: {
        'not-json': 'To nie jest plik projektu (zły format).',
        'not-project': 'To nie jest plik projektu generatora.',
        'newer-version': 'Plik zapisała nowsza wersja generatora. Odśwież stronę.',
        'bad-link': 'Link z projektem jest uszkodzony.',
      } as Record<string, string>,
    },
    en: {
      save: 'Save project',
      load: 'Load project…',
      link: 'Copy link',
      tipSave: 'Downloads a .kbproj.json file with all settings (including your own STEP cell, if loaded).',
      tipLoad: 'Opens a saved project file and restores every setting.',
      tipLink: 'Copies an address with the settings. Whoever opens it sees the same project. Without your own STEP cell.',
      copied: 'Link copied to clipboard.',
      copyFail: 'Could not copy, select the link below:',
      noCell: 'The link does not include your own STEP cell (too large); use the project file.',
      loaded: 'Project loaded',
      errors: {
        'not-json': 'Not a project file (wrong format).',
        'not-project': 'Not a project file of this generator.',
        'newer-version': 'The file was saved by a newer version of the generator. Reload the page.',
        'bad-link': 'The project link is damaged.',
      } as Record<string, string>,
    },
  } as const;
  const tx = $derived(L[lang]);

  let msg = $state('');
  let err = $state('');
  let linkText = $state('');

  const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'projekt';

  function save() {
    err = '';
    msg = '';
    const p = get();
    const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safe(name) + PROJECT_EXT;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    err = '';
    msg = '';
    linkText = '';
    try {
      const p = parseProject(await f.text());
      onLoad(p);
      msg = `${tx.loaded}: ${f.name}`;
    } catch (x) {
      err = tx.errors[(x as Error).message] ?? String(x);
    }
  }

  async function copyLink() {
    err = '';
    msg = '';
    linkText = '';
    const code = await encodeLink(get());
    const url = `${location.origin}${location.pathname}#${LINK_KEY}=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      msg = tx.copied;
    } catch {
      msg = tx.copyFail;
      linkText = url;
    }
    if (hasCell) msg += ' ' + tx.noCell;
  }
</script>

<div class="row">
  <button type="button" onclick={save} data-tip={tx.tipSave}>{tx.save}</button>
  <label class="file" data-tip={tx.tipLoad}>
    {tx.load}
    <input type="file" accept=".json,application/json" onchange={onFile} />
  </label>
  <button type="button" onclick={copyLink} data-tip={tx.tipLink}>{tx.link}</button>
</div>
{#if msg}<p class="muted">{msg}</p>{/if}
{#if linkText}<input class="link" readonly value={linkText} onfocus={(e) => e.currentTarget.select()} />{/if}
{#if err}<p class="warn">{err}</p>{/if}

<style>
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  button,
  .file {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    margin: 0;
  }
  button:hover,
  .file:hover {
    border-color: var(--accent);
  }
  .file input {
    display: none;
  }
  .link {
    width: 100%;
    font-size: 12px;
    padding: 4px 6px;
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
    margin: 4px 0;
  }
  .warn {
    color: var(--warn);
    font-size: 12px;
    margin: 4px 0;
  }
</style>
