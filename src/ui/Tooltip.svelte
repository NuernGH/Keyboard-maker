<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Jeden pływający dymek dla wszystkich elementów z atrybutem data-tip.
     Pokazuje się po najechaniu myszką albo po wejściu klawiszem Tab. -->
<script lang="ts">
  import { onMount } from 'svelte';

  let text = $state('');
  let x = $state(0);
  let y = $state(0);
  let below = $state(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: HTMLElement | null = null;

  function show(el: HTMLElement) {
    clearTimeout(timer);
    current = el;
    timer = setTimeout(() => {
      if (current !== el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(280, window.innerWidth - 24);
      x = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
      below = r.bottom + 120 < window.innerHeight;
      y = below ? r.bottom + 6 : r.top - 6;
      text = el.dataset.tip ?? '';
    }, 250);
  }
  function hide() {
    clearTimeout(timer);
    current = null;
    text = '';
  }

  onMount(() => {
    const find = (e: Event) => (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
    const over = (e: Event) => {
      const el = find(e);
      if (el && el !== current) show(el);
      else if (!el && current) hide();
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', over);
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('pointerdown', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('pointerdown', hide);
    };
  });
</script>

{#if text}
  <div class="tip" role="tooltip" style:left="{x}px" style:top="{y}px" class:above={!below}>{text}</div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 100;
    max-width: min(280px, calc(100vw - 24px));
    padding: 7px 10px;
    border-radius: 6px;
    background: var(--tip-bg);
    color: var(--tip-fg);
    font-size: 12px;
    line-height: 1.4;
    pointer-events: none;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
  }
  .tip.above {
    transform: translateY(-100%);
  }
</style>
