<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Rysunek keymapy (widok z góry): klawisze układu z opisem wiązania na wybranej warstwie, przyciski modułu
  OLED i enkoder na wyspie. Kliknięcie wybiera klawisz (`selected`, odnośnik `strona:id`).
-->
<script lang="ts" module>
  import type { Key } from '../lib/layout';
  export interface ViewHalf {
    side: 'left' | 'right';
    keys: Key[];
    offsetX: number;
    island: { x0: number; x1: number; y0: number; y1: number } | null;
    /** przyciski modułu i enkoder na tej połówce (odnośniki w keymapie) */
    buttons: string[];
    encoder: string | null;
  }
</script>

<script lang="ts">
  import { keyCorners, PITCH } from '../lib/layout';
  import { bindingLabel, NONE, TRANS, type KeymapLayer } from '../lib/keymap';
  import { keyLabel } from '../lib/keymap-keys';

  let {
    halves,
    layers,
    layer,
    selected = $bindable(null),
    layoutMap = null,
    lang,
  }: {
    halves: ViewHalf[];
    layers: KeymapLayer[];
    layer: number;
    selected?: string | null;
    layoutMap?: Map<string, string> | null;
    lang: 'pl' | 'en';
  } = $props();

  const cur = $derived(layers[layer] ?? layers[0]);
  const valueOf = (ref: string) => cur?.keys[ref] ?? (layer === 0 ? NONE : TRANS);

  /** klawisze z położeniem na rysunku (oś Y w dół) */
  const drawn = $derived(
    halves.flatMap((h) =>
      h.keys.map((k) => ({
        ref: `${h.side}:${k.id}`,
        cx: h.offsetX + k.x,
        cy: -k.y,
        w: k.w * PITCH,
        h: k.h * PITCH,
        rot: -k.rot,
        corners: keyCorners(k).map(([x, y]) => [h.offsetX + x, -y] as [number, number]),
      })),
    ),
  );

  /** moduł: na wyspie (gdy jest) albo pod klawiaturą */
  const modules = $derived.by(() => {
    const ys = drawn.flatMap((d) => d.corners.map((c) => c[1]));
    const bottom = ys.length ? Math.max(...ys) : 0;
    return halves
      .filter((h) => h.buttons.length || h.encoder)
      .map((h) => {
        const xs = drawn.filter((d) => d.ref.startsWith(`${h.side}:`)).flatMap((d) => d.corners.map((c) => c[0]));
        const r = h.island
          ? { x0: h.offsetX + h.island.x0, x1: h.offsetX + h.island.x1, y0: -h.island.y1, y1: -h.island.y0 }
          : { x0: Math.max(...xs) - 40, x1: Math.max(...xs), y0: bottom + 6, y1: bottom + 34 };
        // w poziomie (wyspa nad klawiszami 60%) albo w pionie (wyspa przy kolumnie splitu)
        const wide = r.x1 - r.x0 >= r.y1 - r.y0;
        const n = h.buttons.length + (h.encoder ? 1 : 0);
        const items = [...(h.encoder ? [h.encoder] : []), ...h.buttons];
        const size = Math.min(16, ((wide ? r.x1 - r.x0 : r.y1 - r.y0) - 4) / Math.max(n, 1) - 2, (wide ? r.y1 - r.y0 : r.x1 - r.x0) - 4);
        const step = size + 2;
        const start = (wide ? (r.x0 + r.x1) / 2 : (r.y0 + r.y1) / 2) - (step * n - 2) / 2;
        return {
          side: h.side,
          rect: r,
          items: items.map((ref, i) => {
            const a = start + i * step + size / 2;
            return { ref, cx: wide ? a : (r.x0 + r.x1) / 2, cy: wide ? (r.y0 + r.y1) / 2 : a, size };
          }),
        };
      });
  });

  const box = $derived.by(() => {
    const pts = [...drawn.flatMap((d) => d.corners), ...modules.flatMap((m) => [[m.rect.x0, m.rect.y0], [m.rect.x1, m.rect.y1]] as [number, number][])];
    if (!pts.length) return '0 0 100 50';
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const pad = 4;
    // małe układy (macropad) nie rosną ponad skalę 60%: najmniej 300 × 130 mm widoku
    const w = Math.max(Math.max(...xs) - Math.min(...xs) + 2 * pad, 300);
    const h = Math.max(Math.max(...ys) - Math.min(...ys) + 2 * pad, 130);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  });

  const BTN_NAME: Record<string, string> = { 'mod-push': 'PUSH', 'mod-con': 'CON', 'mod-bak': 'BAK' };
  const fit = (s: string, w: number) => Math.max(2, Math.min(4.4, (w * 1.55) / Math.max(s.length, 1)));

  /** opis enkodera: `&inc_dec_kp CW CCW` */
  function encLabel(v: string): { cw: string; ccw: string } {
    const m = /^&inc_dec_kp\s+(\S+)\s+(\S+)$/.exec(v.trim());
    if (!m) return { cw: v === TRANS ? '▽' : v.replace(/^&/, ''), ccw: '' };
    return { cw: keyLabel(m[1], layoutMap), ccw: keyLabel(m[2], layoutMap) };
  }
  const encValue = (ref: string) => cur?.sensors?.[ref] ?? (layer === 0 ? '&inc_dec_kp C_VOL_UP C_VOL_DN' : TRANS);
</script>

<svg viewBox={box} class="km" role="group" aria-label={lang === 'pl' ? 'Keymapa' : 'Keymap'}>
  {#each modules as m (m.side)}
    <rect class="island" x={m.rect.x0} y={m.rect.y0} width={m.rect.x1 - m.rect.x0} height={m.rect.y1 - m.rect.y0} rx="2" />
  {/each}
  {#each drawn as d (d.ref)}
    {@const lab = bindingLabel(valueOf(d.ref), layers, layoutMap)}
    <g
      class="key"
      class:sel={selected === d.ref}
      class:dim={lab.dim}
      transform="translate({d.cx} {d.cy}) rotate({d.rot})"
      role="button"
      tabindex="-1"
      onclick={() => (selected = d.ref)}
      onkeydown={() => {}}
    >
      <title>{valueOf(d.ref)}</title>
      <rect x={-d.w / 2 + 0.6} y={-d.h / 2 + 0.6} width={d.w - 1.2} height={d.h - 1.2} rx="1.6" />
      <text class="tap" y={lab.hold ? -0.6 : 1.4} font-size={fit(lab.tap, d.w)}>{lab.tap}</text>
      {#if lab.hold}<text class="hold" y={d.h / 2 - 2.6} font-size={Math.min(2.6, fit(lab.hold, d.w))}>{lab.hold}</text>{/if}
    </g>
  {/each}
  {#each modules as m (m.side)}
    {#each m.items as it (it.ref)}
      {@const isEnc = it.ref.endsWith(':enc')}
      <g
        class="key btn"
        class:sel={selected === it.ref}
        transform="translate({it.cx} {it.cy})"
        role="button"
        tabindex="-1"
        onclick={() => (selected = it.ref)}
        onkeydown={() => {}}
      >
        {#if isEnc}
          {@const e = encLabel(encValue(it.ref))}
          <title>{encValue(it.ref)}</title>
          <circle r={it.size / 2} />
          <text class="hold" y={-it.size / 2 + 3.2} font-size="2.2">{lang === 'pl' ? 'GAŁKA' : 'KNOB'}</text>
          <text class="tap" y="0.2" font-size={Math.min(2.8, fit(e.cw, it.size))}>↻ {e.cw}</text>
          <text class="tap" y="3.6" font-size={Math.min(2.8, fit(e.ccw, it.size))}>↺ {e.ccw}</text>
        {:else}
          {@const lab = bindingLabel(valueOf(it.ref), layers, layoutMap)}
          <title>{valueOf(it.ref)}</title>
          <rect x={-it.size / 2} y={-it.size / 2} width={it.size} height={it.size} rx="3" />
          <text class="hold" y={-it.size / 2 + 3.2} font-size="2.2">{BTN_NAME[it.ref.split(':')[1]] ?? ''}</text>
          <text class="tap" y="1.6" font-size={Math.min(3.4, fit(lab.tap, it.size))}>{lab.tap}</text>
          {#if lab.hold}<text class="hold" y={it.size / 2 - 1.6} font-size="2">{lab.hold}</text>{/if}
        {/if}
      </g>
    {/each}
  {/each}
</svg>

<style>
  .km {
    width: 100%;
    height: 100%;
    display: block;
    user-select: none;
  }
  .island {
    fill: none;
    stroke: var(--muted);
    stroke-width: 0.4;
    stroke-dasharray: 2 1.5;
  }
  .key {
    cursor: pointer;
    outline: none;
  }
  .key rect,
  .key circle {
    fill: var(--panel);
    stroke: var(--line);
    stroke-width: 0.5;
  }
  .key:hover rect,
  .key:hover circle {
    stroke: var(--accent);
  }
  .key.sel rect,
  .key.sel circle {
    stroke: var(--accent);
    stroke-width: 1;
    fill: color-mix(in srgb, var(--accent) 14%, var(--panel));
  }
  text {
    text-anchor: middle;
    dominant-baseline: middle;
    fill: var(--text);
    font-family: system-ui, sans-serif;
    pointer-events: none;
  }
  .tap {
    font-weight: 600;
  }
  .hold {
    fill: var(--muted);
  }
  .dim .tap {
    fill: var(--muted);
    font-weight: 400;
  }
</style>
