<script lang="ts" generics="T extends string">
  // Zakładki panelu bocznego: przyklejony do góry przełącznik segmentowy.
  let { tabs, value = $bindable() }: { tabs: { id: T; label: string }[]; value: T } = $props();
</script>

<div class="tabs" role="tablist">
  {#each tabs as tb (tb.id)}
    <button role="tab" aria-selected={value === tb.id} class:on={value === tb.id} onclick={() => (value = tb.id)}>{tb.label}</button>
  {/each}
</div>

<style>
  .tabs {
    position: sticky;
    top: -12px;
    z-index: 5;
    display: flex;
    gap: 4px;
    margin: 4px -4px 12px;
    padding: 4px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--line) 55%, transparent);
    backdrop-filter: blur(8px);
  }
  button {
    flex: 1 1 0;
    min-width: 0;
    padding: 7px 4px;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-weight: 600;
    opacity: 0.7;
    cursor: pointer;
    transition:
      background 0.15s,
      opacity 0.15s,
      box-shadow 0.15s;
  }
  button:hover {
    opacity: 1;
  }
  button.on {
    opacity: 1;
    background: var(--panel);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.12),
      0 2px 8px rgb(0 0 0 / 0.06);
  }
</style>
