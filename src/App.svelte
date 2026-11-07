<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Preview, { type PreviewHalf, type PreviewMesh } from './ui/Preview.svelte';
  import { t, type Lang } from './ui/i18n';
  import { SPLIT_4x6_4, TEMPLATES, parseRowLayout, rowLayoutToText, splitLeft, mirrorKeys, keysOverlap, keyCorners, polysOverlap, PITCH, type SplitParams } from './lib/layout';
  import {
    DEFAULT_PLATE_OPTIONS,
    NO_HOTSWAP_HEIGHT,
    THIN_PLATE_THICKNESS,
    type UpAxis,
    type CellVariant,
    type PlateOptions,
  } from './lib/cell-spec';
  import { CadClient } from './cad/client';
  import type { BuildInput } from './cad/protocol';
  import { zipStore } from './lib/zip';
  import Tooltip from './ui/Tooltip.svelte';
  import DactylApp from './ui/DactylApp.svelte';
  import { CONTROLLERS, DEFAULT_ISLAND, islandFor, controllerOf, type IslandParams, type CtrlFit } from './lib/island';
  import CustomController from './ui/CustomController.svelte';
  import WiringPanel from './ui/WiringPanel.svelte';
  import KeycapPanel from './ui/KeycapPanel.svelte';
  import LegendPanel from './ui/LegendPanel.svelte';
  import { DEFAULT_LEGEND, legendLayout, legendRef, type LegendSet, type PlacedLegend } from './lib/legend';
  import { DEFAULT_KEYCAP, capTop, type KeycapParams } from './lib/keycap-spec';
  import { legendFont } from './ui/font';
  import type { Font } from 'opentype.js';
  import ColorPanel from './ui/ColorPanel.svelte';
  import { DEFAULT_COLORS, resolveKeys, type ColorKey, type PreviewColors } from './lib/colors';
  import { defaultLegends, isAnsi60 } from './lib/legend-defaults';
  import ProjectBar from './ui/ProjectBar.svelte';
  import Tabs from './ui/Tabs.svelte';
  import { PANEL_TABS, type PanelTab } from './ui/tabs';
  import {
    base64ToBytes,
    bytesToBase64,
    decodeLink,
    linkFromHash,
    makeProject,
    mergeDefaults,
    type DactylProject,
    type ProjectFile,
  } from './lib/project';
  import { splitWiringInput } from './lib/wiring-doc';
  import { DEFAULT_CASE, FLOOR_MIN, SCREW_MARGIN, SLIM_CASE, STANDARD_LENGTHS, caseLayout, type CaseParams } from './lib/case';
  import { DEFAULT_PRINT, planSplit, pieceOf, type PrintParams, type PrintSplit } from './lib/split';
  import { BATTERY_PRESETS, DEFAULT_EXTRAS, type CaseExtras, type ExtraWarn } from './lib/case-extras';
  import type { GhostPart } from './lib/island';

  type Side = 'left' | 'right';

  let lang = $state<Lang>('pl');
  let params = $state<SplitParams>(structuredClone(SPLIT_4x6_4));
  let templateId = $state(TEMPLATES[0].id);
  let island = $state<IslandParams>({ ...DEFAULT_ISLAND });
  let showElectronics = $state(true);
  /** przełączniki Cherry MX w podglądzie (tylko widok, nie trafiają do eksportu) */
  let showSwitches = $state(true);
  let switchMesh = $state<PreviewMesh | null>(null);
  /** nakładki: parametry profilu, widoczność w podglądzie i siatki typów */
  let keycap = $state<KeycapParams>(structuredClone(DEFAULT_KEYCAP));
  /** ułożone legendy klawiszy (do podglądu 3D), klucz `${strona}:${id}` */
  let capLabels = $state<Record<string, PlacedLegend[]>>({});
  let showCaps = $state(false);
  let capMeshes = $state<Record<string, PreviewMesh>>({});
  /** kolory podglądu (domyślnie wyłączone = podgląd jak dotąd) */
  let colors = $state<PreviewColors>(structuredClone(DEFAULT_COLORS));
  /** wybrany klawisz (`strona:id`): wiersz w tabeli legend, kolory klawisza, podświetlenie w podglądzie */
  let pickedKey = $state<string | null>(null);
  /** obudowa z dodatkami (włącznik, gniazdo, bateria); dodatki domyślnie wyłączone */
  const CASE_WITH_EXTRAS: CaseParams = { ...DEFAULT_CASE, extras: DEFAULT_EXTRAS };
  let caseP = $state<CaseParams>(structuredClone(CASE_WITH_EXTRAS));
  const ex = $derived(caseP.extras as Required<CaseExtras>);
  /** obudowa ma sens tylko dla pełnych komórek (cienka płyta nie utrzyma śrub) */
  /** wartości sprzed włączenia cienkiej obudowy, przywracane po jej wyłączeniu */
  let beforeSlim: Pick<CaseParams, 'space' | 'floor' | 'screwSize'> | null = null;
  function toggleSlim(on: boolean) {
    if (on) {
      beforeSlim = { space: caseP.space, floor: caseP.floor, screwSize: caseP.screwSize };
      Object.assign(caseP, SLIM_CASE, { slim: true });
    } else {
      const back = beforeSlim ?? { space: DEFAULT_CASE.space, floor: DEFAULT_CASE.floor, screwSize: DEFAULT_CASE.screwSize };
      Object.assign(caseP, back, { slim: false, floor: Math.max(back.floor, FLOOR_MIN.normal) });
      beforeSlim = null;
    }
  }
  const caseOn = $derived(caseP.enabled && variant !== 'thin-plate');
  let print = $state<PrintParams>({ ...DEFAULT_PRINT });
  /** układ rzędami jako tekst (60% itp.) */
  let rowText = $state('');
  function applyTemplate(id: string) {
    dactylInit = null;
    templateId = id;
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (!tpl) return;
    params = structuredClone(tpl.params);
    // macropad: wyspa domyślnie nad klawiszami; 60%: nad klawiszami w prawym rogu
    island.position = tpl.params.single ? 'top' : 'inner';
    island.align = tpl.params.rowLayout ? 'end' : 'center';
    island.tilt = tpl.params.rowLayout ? 25 : 0;
    if (tpl.params.rowLayout) rowText = rowLayoutToText(tpl.params.rowLayout);
  }
  function onRowText() {
    const rows = parseRowLayout(rowText);
    if (rows.length) params.rowLayout = rows;
  }
  const rowMode = $derived(!!params.rowLayout?.length);
  let variant = $state<CellVariant>('hotswap');
  let plate = $state<PlateOptions>({ ...DEFAULT_PLATE_OPTIONS });
  let show = $state<'left' | 'right' | 'both'>('both');
  let up = $state<UpAxis | 'auto'>('auto');

  let cellName = $state('key socket.STEP');
  let cellStep = $state<ArrayBuffer | null>(null);
  let cellId = $state('default');

  let status = $state<string>('');
  let error = $state<string>('');
  type Job = string;
  let meshes = $state<Partial<Record<Job, { key: string; mesh: PreviewMesh } | null>>>({});
  let busy = $state<Partial<Record<Job, boolean>>>({});
  let lastMs = $state<number | null>(null);
  let preview: Preview | undefined = $state();

  const fullHeight = 8.58;
  let cellHeight = $derived(
    variant === 'thin-plate' ? THIN_PLATE_THICKNESS : variant === 'no-hotswap' ? NO_HOTSWAP_HEIGHT : fullHeight,
  );

  // stagger musi mieć tyle pozycji, ile kolumn
  $effect(() => {
    if (params.stagger.length !== params.cols) {
      params.stagger = Array.from({ length: params.cols }, (_, i) => params.stagger[i] ?? 0);
    }
  });

  let leftKeys = $derived(splitLeft($state.snapshot(params) as SplitParams));
  let rightKeys = $derived(mirrorKeys(leftKeys));
  let overlap = $derived.by(() => {
    const k = leftKeys;
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) if (keysOverlap(k[i], k[j])) return true;
    return false;
  });
  // czy któryś klawisz wchodzi na wyspę (np. dodatkowy klawisz w macropadzie)
  let islandOverlap = $derived.by(() => {
    const g = islandGeom('left');
    if (!g) return false;
    const r = g.rect;
    const rp: [number, number][] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
    return leftKeys.some((k) => polysOverlap(keyCorners(k), rp));
  });
  function addExtra() {
    const n = params.extra?.length ?? 0;
    params.extra = [...(params.extra ?? []), { col: params.cols, row: n % Math.max(params.rows, 1), w: 1, rot: 0 }];
  }
  function removeExtra(i: number) {
    params.extra = (params.extra ?? []).filter((_, j) => j !== i);
  }

  const islandGeom = (s: Side) => {
    const ip = $state.snapshot(island) as IslandParams;
    // macropad ma jedną płytę: moduł jest na niej albo nigdzie
    if (params.single) ip.moduleSide = ip.moduleSide === 'none' ? 'none' : 'left';
    else ip.position = 'inner';
    return islandFor($state.snapshot(params) as SplitParams, ip, s, variant, cellHeight, plateMargin);
  };
  const keysFor = (s: Side) => (s === 'left' ? leftKeys : rightKeys);
  const single = $derived(!!params.single);
  const plateMargin = $derived(caseOn ? Math.max(plate.margin, SCREW_MARGIN) : plate.margin);
  /** podział do druku (na razie dla jednej płyty: macropad, 60%) */
  let split = $derived<PrintSplit | null>(
    single ? planSplit(leftKeys, islandGeom('left'), plateMargin, caseOn ? caseP.gap + caseP.wall : null, $state.snapshot(print) as PrintParams) : null,
  );
  /** czy cała płyta i spód mieszczą się na stole bez cięcia */
  const pieces = $derived<(0 | 1 | undefined)[]>(split ? [0, 1] : [undefined]);
  const sides = $derived<Side[]>(single ? ['left'] : show === 'both' ? ['left', 'right'] : [show]);

  type Part = 'plate' | 'case' | 'wedge';
  function inputFor(s: Side, part: Part = 'plate', piece?: 0 | 1): BuildInput | null {
    if (!cellStep) return null;
    if (part === 'case' && !caseOn) return null;
    if (part === 'wedge') {
      // klin to osobna część, niezależna od podziału i obudowy
      const isl = islandGeom(s);
      if (!isl?.wedge) return null;
      return { keys: [], variant, plate: $state.snapshot(plate) as PlateOptions, cellId, cellStep, up, island: isl, part };
    }
    const po = $state.snapshot(plate) as PlateOptions;
    // przy obudowie płyta dostaje pas na śruby
    const plateOpts = caseOn ? { ...po, margin: Math.max(po.margin, SCREW_MARGIN) } : po;
    const isl = islandGeom(s);
    const cp = $state.snapshot(caseP) as CaseParams;
    return {
      keys: keysFor(s),
      variant,
      plate: plateOpts,
      cellId,
      cellStep,
      up,
      island: isl,
      part,
      case: caseOn ? { params: cp, layout: layoutFor(s) } : null,
      split: s === 'left' && split ? { plan: $state.snapshot(split) as PrintSplit, clearance: print.clearance } : null,
      piece: s === 'left' && split ? piece : undefined,
    };
  }
  const job = (s: Side, part: Part, piece?: 0 | 1): Job =>
    `${part === 'plate' ? s : `${s}-${part}`}${piece === undefined ? '' : `-p${piece}`}`;
  const wedgeMeshFor = (s: Side) => {
    const inp = inputFor(s, 'wedge');
    const m = meshes[job(s, 'wedge')];
    return inp && m && m.key === inputKey(inp) ? m.mesh : null;
  };
  /** układ spodu obudowy dla połówki (śruby, podpory, dodatki) */
  const layoutFor = (s: Side) =>
    caseLayout(keysFor(s), islandGeom(s), cellHeight, $state.snapshot(caseP) as CaseParams, s === 'left' ? split : null, plate.stabs ?? 'cherry', {
      half: s,
      single,
      margin: plateMargin,
    });
  let screwInfo = $derived(caseOn ? layoutFor('left') : null);
  /** dodatki w obudowie: bryły do podglądu i ostrzeżenia, dla każdej połówki */
  let extrasBySide = $derived.by(() => {
    const out: Partial<Record<Side, { ghosts: GhostPart[]; warns: ExtraWarn[] }>> = {};
    if (!caseOn) return out;
    for (const s of (single ? ['left'] : ['left', 'right']) as Side[]) {
      const e = s === 'left' && screwInfo ? screwInfo.extras : layoutFor(s).extras;
      out[s] = { ghosts: e.ghosts, warns: e.warns };
    }
    return out;
  });
  // wybrana śruba nie pasuje: eksport zablokowany, dopóki nie zmienisz dna albo długości
  let exportBlocked = $derived(!!screwInfo?.screwWarn);
  const mmTxt = (v: number) => (lang === 'pl' ? String(v).replace('.', ',') : String(v));
  const WALL_SIDES = ['back', 'front', 'inner', 'outer'] as const;
  /** nazwa ścianki; w 60% i macropadzie wewnętrzna = prawa, zewnętrzna = lewa */
  const wallName = (w: (typeof WALL_SIDES)[number]) =>
    t(lang, single ? ({ back: 'wallBack', front: 'wallFront', inner: 'wallRight', outer: 'wallLeft' } as const)[w] : ({ back: 'wallBack', front: 'wallFront', inner: 'wallInner', outer: 'wallOuter' } as const)[w]);
  function extraWarnText(w: ExtraWarn): string {
    const part = t(lang, w.part === 'power' ? 'power' : w.part === 'link' ? 'link' : 'battery');
    const key = ({ noSpot: 'extraNoSpot', tooTall: 'extraTooTall', moved: 'extraMoved', otherSide: 'extraOtherSide' } as const)[w.kind];
    return t(lang, key).replace('{p}', part).replace('{s}', w.side ? wallName(w.side) : '');
  }
  const inputKey = (i: BuildInput) => JSON.stringify({ ...i, cellStep: undefined });

  let halves = $derived.by<PreviewHalf[]>(() => {
    // rozstaw połówek: prawa obok lewej z odstępem 2U
    const kb = Math.max(...leftKeys.map((k) => k.x + (Math.max(k.w, k.h) * PITCH) / 2));
    const il = islandGeom('left');
    const ir = islandGeom('right');
    // zasięg w stronę środka: lewa w +X, prawa (lustro) w −X
    const reachL = Math.max(kb, il ? il.rect.x1 : -Infinity);
    const reachR = Math.max(kb, ir ? -ir.rect.x0 : -Infinity);
    const gap = 2 * PITCH;
    const pad = caseOn ? SCREW_MARGIN + caseP.gap + caseP.wall : 0;
    if (split) {
      // podział do druku: dwie części rozsunięte o kilka mm, żeby było widać szwy płyty i spodu
      const sp = split;
      const isl = islandGeom('left');
      const islPiece = isl ? pieceOf(sp, (isl.rect.x0 + isl.rect.x1) / 2, (isl.rect.y0 + isl.rect.y1) / 2) : null;
      return ([0, 1] as const).map((pc) => {
        const mesh = (part: 'plate' | 'case') => {
          const inp = inputFor('left', part, pc);
          const m = meshes[job('left', part, pc)];
          return inp && m && m.key === inputKey(inp) ? m.mesh : null;
        };
        return {
          side: 'left' as const,
          keys: leftKeys.filter((k) => pieceOf(sp, k.x, k.y) === pc),
          offsetX: pc * splitGap,
          mesh: mesh('plate'),
          island: islPiece === pc ? isl : null,
          wedgeMesh: islPiece === pc ? wedgeMeshFor('left') : null,
          showElectronics,
          caseMesh: mesh('case'),
          caseOn,
          explode: caseP.explode,
          caseParts: (extrasBySide.left?.ghosts ?? []).filter((g) => pieceOf(sp, (g.box.x0 + g.box.x1) / 2, (g.box.y0 + g.box.y1) / 2) === pc),
        };
      });
    }
    return sides.map((s) => {
      const inp = inputFor(s);
      const m = meshes[s];
      const fresh = inp && m && m.key === inputKey(inp) ? m.mesh : null;
      const cin = inputFor(s, 'case');
      const cm = meshes[job(s, 'case')];
      const caseMesh = cin && cm && cm.key === inputKey(cin) ? cm.mesh : null;
      const offsetX = s === 'right' && sides.length === 2 ? reachL + reachR + gap + 2 * pad : 0;
      return { side: s, keys: keysFor(s), offsetX, mesh: fresh, island: islandGeom(s), wedgeMesh: wedgeMeshFor(s), showElectronics, caseMesh, caseOn, explode: caseP.explode, caseParts: extrasBySide[s]?.ghosts ?? [] };
    });
  });

  // ---------- kolory podglądu ----------
  const sideKeys = $derived(single ? (['left'] as const) : (['left', 'right'] as const));
  const legendsBySide = $derived(
    Object.fromEntries(sideKeys.map((s) => [s, defaultLegends(templateId, $state.snapshot(params) as SplitParams, keysFor(s), s)])) as Record<Side, ReturnType<typeof defaultLegends>>,
  );
  /** domyślne opisy klawiszy (`strona:id`), do przycisku w tabeli legend i podglądu */
  const defaultSets = $derived(
    Object.fromEntries(sideKeys.flatMap((s) => Object.entries(legendsBySide[s]).map(([id, l]) => [legendRef(s, id), l]))) as Record<string, LegendSet>,
  );
  // prawdziwe nazwy (60% ANSI, split); macropad i własne rzędy mają numery, więc grupy tylko wg rozmiaru
  const namedLayout = $derived(!templateId.startsWith('macropad') && (!params.rowLayout?.length || isAnsi60(params.rowLayout)));
  /** główna legenda klawisza: własna z tabeli, inaczej domyślna */
  const mainOf = (ref: string) => keycap.legends?.[ref]?.main ?? defaultSets[ref]?.main ?? '';
  const colorKeys = $derived.by<ColorKey[]>(() =>
    halves.flatMap((h) =>
      h.keys.map((k) => {
        const ref = `${h.side ?? 'left'}:${k.id}`;
        return { ref, main: mainOf(ref), w: k.w, h: k.h, x: h.offsetX + k.x, y: k.y };
      }),
    ),
  );
  const looks = $derived(colors.on ? resolveKeys(colors, colorKeys, namedLayout) : null);
  let font = $state.raw<Font | null>(null);
  void legendFont().then((f) => (font = f), () => {});
  /**
   * legendy w podglądzie 3D: wpisane w tabeli (to samo, co trafi do druku), a gdy klawisz nie ma własnych
   * i włączone są kolory z nazwami klawiszy, domyślne opisy (tylko podgląd)
   */
  const labels = $derived.by<Record<string, PlacedLegend[]> | null>(() => {
    if (!font) return null;
    const own = keycap.legends ?? {};
    const withDefaults = colors.on && colors.legends.show;
    const lp = keycap.legend ?? DEFAULT_LEGEND;
    const kp = $state.snapshot(keycap) as KeycapParams;
    const out: Record<string, PlacedLegend[]> = {};
    for (const s of sideKeys)
      for (const k of keysFor(s)) {
        const ref = legendRef(s, k.id);
        const set = own[ref] ?? (withDefaults ? defaultSets[ref] : undefined);
        if (!set || !Object.keys(set).length) continue;
        const [tw, th] = capTop(kp, k.w, k.h);
        out[ref] = legendLayout(font, $state.snapshot(set) as LegendSet, tw, th, lp);
      }
    return out;
  });
  function keyInfo(ref: string) {
    const [s, id] = ref.split(':') as [Side, string];
    const k = keysFor(s).find((q) => q.id === id);
    if (!k) return null;
    return { main: mainOf(ref), w: k.w, h: k.h, named: namedLayout };
  }

  const clients: Partial<Record<Side, CadClient>> = {};
  const client = (s: Side) => (clients[s] ??= new CadClient());

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** odstęp między częściami w podglądzie (mm) */
  const splitGap = 14;
  $effect(() => {
    // przelicz dokładną bryłę po krótkiej przerwie od ostatniej zmiany
    const jobs = sides.flatMap((s) => [
      ...pieces.flatMap((pc) => [[s, 'plate', inputFor(s, 'plate', pc), pc] as const, [s, 'case', inputFor(s, 'case', pc), pc] as const]),
      [s, 'wedge', inputFor(s, 'wedge'), undefined] as const,
    ]);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      // płyta przed obudową na tym samym wątku: najpierw widać płytę
      for (const [s, part, inp, pc] of jobs) if (inp && part === 'plate') void computeMesh(s, part, inp, pc);
      for (const [s, part, inp, pc] of jobs) if (inp && part !== 'plate') void computeMesh(s, part, inp, pc);
    }, 500);
  });

  const running: Partial<Record<Job, string>> = {};
  async function computeMesh(s: Side, part: Part, inp: BuildInput, piece?: 0 | 1) {
    const j = job(s, part, piece);
    const key = inputKey(inp);
    if (meshes[j]?.key === key || running[j] === key) return;
    running[j] = key;
    busy[j] = true;
    error = '';
    try {
      const r = await client(s).mesh(inp);
      lastMs = Math.round(r.ms);
      // zapisz tylko, jeśli nikt w międzyczasie nie zmienił parametrów
      if (running[j] === key) meshes[j] = { key, mesh: r };
    } catch (e) {
      error = (e as Error).message;
    } finally {
      if (running[j] === key) {
        busy[j] = false;
        running[j] = undefined;
      }
    }
  }

  async function exportFile(s: Side, format: 'stl' | 'step', part: Part = 'plate', piece?: 0 | 1) {
    if (exportBlocked) return;
    const inp = inputFor(s, part, piece);
    if (!inp) return;
    status = t(lang, 'computing');
    error = '';
    try {
      const data = await client(s).exportFile(inp, format);
      const base = params.rowLayout?.length
        ? `keyboard-${leftKeys.length}`
        : params.single
          ? `macropad-${params.rows}x${params.cols}`
          : `${s}`;
      const pc = piece === undefined ? '' : `-${piece + 1}of2`;
      const name = part === 'wedge' ? `${base}-oled-wedge-${island.tilt}deg.${format}` : `${base}-${part}${pc}-${variant}.${format}`;
      await saveFile(name, data);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      status = '';
    }
  }

  /**
   * Zapis pliku. W podglądzie Claude strona nie może sama pobierać plików, więc używa
   * zdolności `downloads`, która przyjmuje tylko wybrane rozszerzenia: STL/STEP pakujemy w ZIP.
   */
  async function saveFile(name: string, data: ArrayBuffer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claude = (window as any).claude;
    const downloads = claude?.use ? await claude.use('downloads') : null;
    if (downloads) {
      // ZIP (np. komplet nakładek) zapisujemy bez ponownego pakowania
      const zip = name.endsWith('.zip') ? new Blob([data], { type: 'application/zip' }) : zipStore([{ name, data: new Uint8Array(data) }]);
      try {
        await downloads.save({ filename: name.replace(/\.[^.]+$/, '') + '.zip', data: zip });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== 'declined') throw new Error((e as Error).message ?? String(code));
      }
      return;
    }
    const blob = new Blob([data], { type: name.endsWith('.html') ? 'text/html' : name.endsWith('.zip') ? 'application/zip' : name.endsWith('.stl') ? 'model/stl' : 'model/step' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ---------- zapis i odczyt projektu ----------
  /** ustawienia Dactyla z wczytanego projektu (Dactyl startuje od nich zamiast od domyślnych) */
  let dactylInit = $state.raw<DactylProject | null>(null);
  /** zmiana tej liczby tworzy panel Dactyla od nowa (żeby przejął wczytane ustawienia) */
  let dactylSeq = $state(0);

  function flatProject(): ProjectFile {
    const isl = $state.snapshot(island) as IslandParams;
    // model własnego kontrolera żyje tylko w tej sesji przeglądarki; w projekcie zostają liczby
    if (isl.custom?.model?.startsWith('custom-model:')) {
      const { model: _m, ...c } = isl.custom;
      isl.custom = c;
    }
    return makeProject('flat', {
      templateId,
      params: $state.snapshot(params),
      rowText,
      island: isl,
      caseP: $state.snapshot(caseP),
      print: $state.snapshot(print),
      variant,
      plate: $state.snapshot(plate),
      up,
      show,
      showElectronics,
      showSwitches,
      keycap: $state.snapshot(keycap),
      showCaps,
      colors: $state.snapshot(colors),
      cell: cellId !== 'default' && cellStep ? { name: cellName, data: bytesToBase64(cellStep) } : undefined,
    });
  }

  const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);

  function applyProject(pf: ProjectFile) {
    error = '';
    if (pf.kind === 'dactyl' && pf.dactyl) {
      dactylInit = pf.dactyl;
      dactylSeq++;
      templateId = 'dactyl';
      return;
    }
    const f = pf.flat;
    if (!f) return;
    const tpl = TEMPLATES.find((x) => x.id === f.templateId) ?? TEMPLATES[0];
    dactylInit = null;
    templateId = tpl.id;
    params = mergeDefaults(tpl.params, f.params);
    rowText = typeof f.rowText === 'string' ? f.rowText : params.rowLayout ? rowLayoutToText(params.rowLayout) : '';
    island = mergeDefaults(DEFAULT_ISLAND, f.island);
    caseP = mergeDefaults(CASE_WITH_EXTRAS, f.caseP);
    beforeSlim = null;
    print = mergeDefaults(DEFAULT_PRINT, f.print);
    variant = oneOf<CellVariant>(f.variant, ['hotswap', 'no-hotswap', 'thin-plate'], 'hotswap');
    plate = mergeDefaults(DEFAULT_PLATE_OPTIONS, f.plate);
    up = oneOf<UpAxis | 'auto'>(f.up, ['auto', '+X', '-X', '+Y', '-Y', '+Z', '-Z'] as (UpAxis | 'auto')[], 'auto');
    show = oneOf(f.show, ['left', 'right', 'both'] as const, 'both');
    showElectronics = typeof f.showElectronics === 'boolean' ? f.showElectronics : true;
    showSwitches = typeof f.showSwitches === 'boolean' ? f.showSwitches : true;
    keycap = mergeDefaults(DEFAULT_KEYCAP, f.keycap);
    if (typeof f.showCaps === 'boolean') showCaps = f.showCaps;
    colors = mergeDefaults(DEFAULT_COLORS, f.colors);
    pickedKey = null;
    if (f.cell?.data) {
      const bytes = base64ToBytes(f.cell.data);
      cellStep = bytes.buffer as ArrayBuffer;
      cellName = f.cell.name || 'cell.step';
      cellId = `project:${cellName}:${bytes.length}`;
    } else if (cellId !== 'default') {
      void loadDefaultCell();
    }
  }

  async function loadDefaultCell() {
    const res = await fetch(`${import.meta.env.BASE_URL}cells/mx-hotswap.step`);
    cellStep = await res.arrayBuffer();
    cellName = 'key socket.STEP';
    cellId = 'default';
  }

  async function loadSwitchModel() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}switches/cherry-mx.step`);
      if (!res.ok) return;
      switchMesh = await client('right').switchMesh(await res.arrayBuffer(), '+Y');
    } catch (e) {
      console.warn('Model przełącznika niedostępny', e);
    }
  }

  async function onCellFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    cellStep = await f.arrayBuffer();
    cellName = f.name;
    cellId = `${f.name}:${f.size}:${f.lastModified}`;
  }

  onMount(() => {
    // link z projektem (…/#projekt=…)
    const code = linkFromHash(location.hash);
    if (code)
      decodeLink(code)
        .then(applyProject)
        .catch(() => (error = lang === 'pl' ? 'link z projektem jest uszkodzony albo z nowszej wersji' : 'the project link is damaged or from a newer version'));
    status = t(lang, 'loadingCad');
    void loadDefaultCell();
    Promise.all((['left', 'right'] as Side[]).map((s) => client(s).init()))
      .then(() => (status = ''))
      .then(loadSwitchModel)
      .catch((e) => (error = String(e)));
  });

  const anyBusy = $derived(sides.some((s) => pieces.some((pc) => busy[job(s, 'plate', pc)] || busy[job(s, 'case', pc)]) || busy[job(s, 'wedge')]));
  const mm = (v: number) => Math.round(v);
  /** wejście instrukcji okablowania z bieżących ustawień */
  const wiringInput = () =>
    splitWiringInput({
      params: $state.snapshot(params) as SplitParams,
      island: $state.snapshot(island) as IslandParams,
      variant,
      cellHeight,
      margin: plateMargin,
      stabs: plate.stabs ?? 'cherry',
      lang,
      layout: TEMPLATES.find((x) => x.id === templateId)?.name[lang] ?? templateId,
    });
  let tab = $state<PanelTab>('keyboard');
  const capRefs = $derived(leftKeys.map((k) => legendRef('left', k.id)).concat(single ? [] : rightKeys.map((k) => legendRef('right', k.id))));
  // na zakładce Nakładki podgląd pokazuje nakładki
  $effect(() => {
    if (tab === 'keycaps') showCaps = true;
  });
  const allExact = $derived(halves.every((h) => h.mesh && (!h.caseOn || h.caseMesh)));
</script>

{#if templateId === 'dactyl'}
{#key dactylSeq}
<DactylApp bind:lang onTemplate={applyTemplate} {switchMesh} init={dactylInit} onProject={applyProject} />
{/key}
{:else}
<Tooltip />
<div class="app">
  <aside>
    <header>
      <h1>{t(lang, 'title')}</h1>
      <select bind:value={lang} aria-label="Język / Language">
        <option value="pl">PL</option>
        <option value="en">EN</option>
      </select>
    </header>

    <section>
      <h2>{lang === 'pl' ? 'Projekt' : 'Project'}</h2>
      <ProjectBar
        {lang}
        name={TEMPLATES.find((x) => x.id === templateId)?.name[lang] ?? templateId}
        get={flatProject}
        onLoad={applyProject}
        hasCell={cellId !== 'default'}
      />
    </section>

    <Tabs tabs={PANEL_TABS.map((id) => ({ id, label: t(lang, `tab_${id}` as const) }))} bind:value={tab} />

    {#if tab === 'keyboard'}
    <section>
      <h2>{t(lang, 'template')}</h2>
      <select
        data-tip={t(lang, 'tipTemplate')}
        bind:value={templateId}
        onchange={() => applyTemplate(templateId)}
        aria-label={t(lang, 'template')}
      >
        {#each TEMPLATES as tpl (tpl.id)}
          <option value={tpl.id}>{tpl.name[lang]}</option>
        {/each}
        <option value="dactyl">{lang === 'pl' ? 'Dactyl (zakrzywiona)' : 'Dactyl (curved)'}</option>
      </select>
      <p class="muted">{leftKeys.length * (single ? 1 : 2)} {t(lang, 'keys')}</p>
    </section>

    <section>
      <h2>{t(lang, 'cell')}</h2>
      <label data-tip={t(lang, 'tipVariant')}>
        {t(lang, 'variant')}
        <select bind:value={variant}>
          <option value="hotswap">{t(lang, 'hotswap')}</option>
          <option value="no-hotswap">{t(lang, 'noHotswap')}</option>
          <option value="thin-plate">{t(lang, 'thinPlate')}</option>
        </select>
      </label>
      <label class="check" data-tip={t(lang, 'tipShowSwitches')}><input type="checkbox" bind:checked={showSwitches} /> {t(lang, 'showSwitches')}</label>
      <div class="row">
        <span class="muted" data-tip={t(lang, 'tipCellFile')}>{t(lang, 'cellFile')}: {cellId === 'default' ? t(lang, 'cellDefault') : cellName}</span>
      </div>
      <div class="row">
        <label class="file" data-tip={t(lang, 'tipLoadOwn')}>
          {t(lang, 'loadOwn')}
          <input type="file" accept=".step,.stp,.STEP,.STP" onchange={onCellFile} />
        </label>
        {#if cellId !== 'default'}
          <button onclick={loadDefaultCell}>key socket.STEP</button>
        {/if}
      </div>
      <label data-tip={t(lang, 'tipUpAxis')}>
        {t(lang, 'upAxis')}
        <select bind:value={up}>
          <option value="auto">{t(lang, 'auto')}</option>
          {#each ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as a (a)}
            <option value={a}>{a}</option>
          {/each}
        </select>
      </label>
    </section>

    <section>
      <h2>{t(lang, 'layout')}</h2>
      {#if rowMode}
      <label data-tip={t(lang, 'tipRowLayout')}>
        {t(lang, 'rowLayout')}
        <textarea rows="6" spellcheck="false" bind:value={rowText} oninput={onRowText}></textarea>
      </label>
      {#if overlap}<p class="warn">{t(lang, 'overlap')}</p>{/if}
      {:else}
      <div class="grid2">
        <label data-tip={t(lang, 'tipRows')}>{t(lang, 'rows')} <input type="number" min="1" max="8" bind:value={params.rows} /></label>
        <label data-tip={t(lang, 'tipCols')}>{t(lang, 'cols')} <input type="number" min="1" max="10" bind:value={params.cols} /></label>
      </div>
      <span class="label" data-tip={t(lang, 'tipStagger')}>{t(lang, 'stagger')}</span>
      <div class="stagger">
        {#each params.stagger as _, i (i)}
          <input type="number" step="0.5" bind:value={params.stagger[i]} aria-label="stagger {i + 1}" />
        {/each}
      </div>
      {/if}
    </section>

    {#if !single}
    <section>
      <h2>{t(lang, 'thumb')}</h2>
      <div class="grid2">
        <label data-tip={t(lang, 'tipThumbKeys')}>{t(lang, 'thumbKeys')} <input type="number" min="0" max="6" bind:value={params.thumbKeys} /></label>
        <label data-tip={t(lang, 'tipThumbCol')}
          >{t(lang, 'thumbCol')}
          <input type="number" min="1" max={params.cols} step="0.25" bind:value={() => params.thumbAnchorCol + 1, (v) => (params.thumbAnchorCol = v - 1)} /></label
        >
        <label data-tip={t(lang, 'tipThumbX')}>{t(lang, 'thumbX')} <input type="number" step="0.5" bind:value={params.thumbOffsetX} /></label>
        <label data-tip={t(lang, 'tipThumbY')}>{t(lang, 'thumbY')} <input type="number" step="0.5" bind:value={params.thumbOffsetY} /></label>
        <label data-tip={t(lang, 'tipThumbAngle')}>{t(lang, 'thumbAngle')} <input type="number" step="1" bind:value={params.thumbAngle} /></label>
        <label data-tip={t(lang, 'tipThumbSplay')}>{t(lang, 'thumbSplay')} <input type="number" step="1" bind:value={params.thumbSplay} /></label>
        <label data-tip={t(lang, 'tipThumbLastW')}
          >{t(lang, 'thumbLastW')}
          <select bind:value={params.thumbLastWidth}>
            <option value={1}>1U</option>
            <option value={1.25}>1,25U</option>
            <option value={1.5}>1,5U</option>
            <option value={2}>2U</option>
          </select></label
        >
        <label class="check" data-tip={t(lang, 'tipThumbLastV')}><input type="checkbox" bind:checked={params.thumbLastVertical} /> {t(lang, 'thumbLastV')}</label>
      </div>
      {#if overlap}<p class="warn">{t(lang, 'overlap')}</p>{/if}
    </section>
    {/if}

    {#if single && !rowMode}
    <section>
      <h2>{t(lang, 'extraKeys')}</h2>
      {#each params.extra ?? [] as e, i (i)}
        <div class="extra">
          <label data-tip={t(lang, 'tipExtraCol')}>{t(lang, 'extraCol')} <input type="number" step="0.25" bind:value={e.col} /></label>
          <label data-tip={t(lang, 'tipExtraRow')}>{t(lang, 'extraRow')} <input type="number" step="0.25" bind:value={e.row} /></label>
          <label data-tip={t(lang, 'tipExtraW')}>U <select bind:value={e.w}><option value={1}>1</option><option value={1.25}>1,25</option><option value={1.5}>1,5</option><option value={2}>2</option></select></label>
          <label data-tip={t(lang, 'tipExtraRot')}>° <input type="number" step="5" bind:value={e.rot} /></label>
          <button class="del" onclick={() => removeExtra(i)} aria-label={t(lang, 'remove')} data-tip={t(lang, 'remove')}>×</button>
        </div>
      {/each}
      <button onclick={addExtra} data-tip={t(lang, 'tipAddExtra')}>+ {t(lang, 'addExtra')}</button>
      {#if overlap}<p class="warn">{t(lang, 'overlap')}</p>{/if}
      {#if islandOverlap}<p class="warn">{t(lang, 'islandOverlap')}</p>{/if}
    </section>
    {/if}

    <section>
      <h2>{t(lang, 'plate')}</h2>
      <div class="grid2">
        <label data-tip={t(lang, 'tipFillGaps')}>{t(lang, 'fillGaps')} <input type="number" min="0" step="0.5" bind:value={plate.fillGaps} /></label>
        <label data-tip={t(lang, 'tipMargin')}>{t(lang, 'margin')} <input type="number" min="0" step="0.5" bind:value={plate.margin} /></label>
      </div>
      <label data-tip={t(lang, 'tipStabs')}>{t(lang, 'stabs')}
        <select bind:value={plate.stabs}>
          <option value="cherry">{t(lang, 'stabCherry')}</option>
          <option value="mx">{t(lang, 'stabMx')}</option>
          <option value="none">{t(lang, 'stabNone')}</option>
        </select>
      </label>
      {#if plate.stabs === 'mx'}<p class="muted">{t(lang, 'mxSpacing')}</p>{/if}
      {#if !single}
      <label data-tip={t(lang, 'tipHalves')}>
        {t(lang, 'halves')}
        <select bind:value={show}>
          <option value="both">{t(lang, 'both')}</option>
          <option value="left">{t(lang, 'left')}</option>
          <option value="right">{t(lang, 'right')}</option>
        </select>
      </label>
      {/if}
    </section>

    <section>
      <h2>{t(lang, 'electronics')}</h2>
      <label class="check" data-tip={t(lang, 'tipIsland')}><input type="checkbox" bind:checked={island.enabled} /> {t(lang, 'island')}</label>
      {#if island.enabled}
        <div class="grid2">
          <label data-tip={t(lang, 'tipController')}>{t(lang, 'controller')}
            <select
              value={island.controller}
              onchange={(e) => {
                const v = e.currentTarget.value as IslandParams['controller'];
                // pierwszy własny: zaczynamy od liczb dotychczasowego kontrolera
                if (v === 'custom' && !island.custom) {
                  const { model: _m, ...c } = controllerOf($state.snapshot(island) as IslandParams);
                  island.custom = { ...c, name: lang === 'pl' ? 'Własny kontroler' : 'Custom controller' };
                }
                island.controller = v;
              }}
            >
              {#each Object.entries(CONTROLLERS) as [id, c] (id)}<option value={id}>{c.name}</option>{/each}
              <option value="custom" data-tip={t(lang, 'tipCtrlCustom')}>{island.controller === 'custom' && island.custom ? island.custom.name : t(lang, 'ctrlCustom')}</option>
            </select>
          </label>
          {#if single}
          <label data-tip={t(lang, 'tipIslandPos')}>{t(lang, 'islandPos')}
            <select bind:value={island.position}>
              <option value="top">{t(lang, 'posTop')}</option>
              <option value="inner">{t(lang, 'right')}</option>
              <option value="outer">{t(lang, 'left')}</option>
              <option value="bottom">{t(lang, 'posBottom')}</option>
            </select>
          </label>
          <label data-tip={t(lang, 'tipAlign')}>{t(lang, 'align')}
            <select bind:value={island.align}>
              <option value="start">{island.position === 'top' || island.position === 'bottom' ? t(lang, 'alignLeft') : t(lang, 'alignTop')}</option>
              <option value="center">{t(lang, 'alignCenter')}</option>
              <option value="end">{island.position === 'top' || island.position === 'bottom' ? t(lang, 'alignRight') : t(lang, 'alignBottom')}</option>
            </select>
          </label>
          {#if (island.position === 'top' || island.position === 'bottom') && island.moduleSide !== 'none'}
          <label data-tip={t(lang, 'tipTilt')}>{t(lang, 'tilt')} <input type="number" min="0" max="60" step="5" bind:value={island.tilt} /></label>
          {/if}
          {#if (island.position === 'top' || island.position === 'bottom') && island.moduleSide !== 'none' && (island.tilt ?? 0) > 0}
          <label data-tip={t(lang, 'tipUsbDir')}>{t(lang, 'usbDir')}
            <select bind:value={island.usbDir}>
              <option value="auto">{t(lang, 'usbDirAuto')}</option>
              <option value="left">{t(lang, 'usbDirLeft')}</option>
              <option value="right">{t(lang, 'usbDirRight')}</option>
              <option value="back">{t(lang, 'usbDirBack')}</option>
            </select>
          </label>
          {:else if island.position === 'top' || island.position === 'bottom'}
          <label data-tip={t(lang, 'tipUsbOut')}>{t(lang, 'usbOut')}
            <select bind:value={island.usbOut}>
              <option value="edge">{t(lang, 'usbEdge')}</option>
              <option value="end">{t(lang, 'usbEnd')}</option>
            </select>
          </label>
          {/if}
          <label class="check" data-tip={t(lang, 'tipModuleSingle')}><input type="checkbox" checked={island.moduleSide !== 'none'} onchange={(e) => (island.moduleSide = e.currentTarget.checked ? 'left' : 'none')} /> {t(lang, 'moduleSingle')}</label>
          {:else}
          <label data-tip={t(lang, 'tipModuleSide')}>{t(lang, 'moduleSide')}
            <select bind:value={island.moduleSide}>
              <option value="left">{t(lang, 'left')}</option>
              <option value="right">{t(lang, 'right')}</option>
              <option value="both">{t(lang, 'both')}</option>
              <option value="none">{t(lang, 'none')}</option>
            </select>
          </label>
          {/if}
          <label class="check" data-tip={t(lang, 'tipCtrlFlip')}><input type="checkbox" checked={island.flip ?? true} onchange={(e) => (island.flip = e.currentTarget.checked)} /> {t(lang, 'ctrlFlip')}</label>
          {#if island.flip ?? true}
          <label class="check" data-tip={t(lang, 'tipCtrlPins')}><input type="checkbox" bind:checked={island.pins} /> {t(lang, 'ctrlPins')}</label>
          {:else}
          <span></span>
          {/if}
          <label data-tip={t(lang, 'tipFit')}>{t(lang, 'fit')}
            <select value={island.fit ?? 'standard'} onchange={(e) => (island.fit = e.currentTarget.value as CtrlFit)}>
              <option value="standard">{t(lang, 'fitStandard')}</option>
              <option value="snug">{t(lang, 'fitSnug')}</option>
              <option value="press">{t(lang, 'fitPress')}</option>
              <option value="custom">{t(lang, 'fitCustom')}</option>
            </select>
          </label>
          {#if island.fit === 'custom'}
          <span></span>
          {#if !(island.flip ?? true)}
          <label data-tip={t(lang, 'tipFitTop')}>{t(lang, 'fitTop')} <input type="number" min="0" max="3" step="0.05" value={island.fitTop ?? 0.6} onchange={(e) => (island.fitTop = +e.currentTarget.value)} /></label>
          {/if}
          <label data-tip={t(lang, 'tipFitBottom')}>{t(lang, 'fitBottom')} <input type="number" min="-0.6" max="3" step="0.05" value={island.fitBottom ?? 0.2} onchange={(e) => (island.fitBottom = +e.currentTarget.value)} /></label>
          {#if island.flip ?? true}<span></span>{/if}
          {/if}
          <label data-tip={t(lang, 'tipIslandDepth')}>{t(lang, 'islandDepth')} <input type="number" min="0" step="0.5" bind:value={island.depth} /></label>
          <span></span>
          <label data-tip={t(lang, 'tipIslandX')}>{t(lang, 'thumbX')} <input type="number" step="0.5" bind:value={island.offsetX} /></label>
          <label data-tip={t(lang, 'tipIslandY')}>{t(lang, 'thumbY')} <input type="number" step="0.5" bind:value={island.offsetY} /></label>
        </div>
        {#if island.controller === 'custom'}
          <CustomController {lang} bind:value={island.custom} stepMesh={(b) => client('right').stepMesh(b)} />
        {/if}
        <label class="check" data-tip={t(lang, 'tipShowElectronics')}><input type="checkbox" bind:checked={showElectronics} /> {t(lang, 'showElectronics')}</label>
      {/if}
    </section>

    <section>
      <h2>{t(lang, 'case')}</h2>
      <label class="check" data-tip={t(lang, 'tipCase')}><input type="checkbox" bind:checked={caseP.enabled} /> {t(lang, 'caseBottomOn')}</label>
      {#if caseP.enabled && variant === 'thin-plate'}<p class="warn">{t(lang, 'caseThin')}</p>{/if}
      {#if caseOn}
        <label class="check" data-tip={t(lang, 'tipSlimCase')}><input type="checkbox" checked={!!caseP.slim} onchange={(e) => toggleSlim(e.currentTarget.checked)} /> {t(lang, 'slimCase')}</label>
        <div class="grid2">
          <label data-tip={t(lang, 'tipCaseWall')}>{t(lang, 'caseWall')} <input type="number" min="1.2" step="0.2" bind:value={caseP.wall} /></label>
          <label data-tip={t(lang, 'tipCaseFloor')}>{t(lang, 'caseFloor')} <input type="number" min={caseP.slim ? FLOOR_MIN.slim : FLOOR_MIN.normal} step="0.2" bind:value={caseP.floor} /></label>
          <label data-tip={t(lang, 'tipCaseSpace')}>{t(lang, 'caseSpace')} <input type="number" min="0" step="0.5" bind:value={caseP.space} /></label>
          <label data-tip={t(lang, 'tipCaseScrews')}>{t(lang, 'caseScrews')} <input type="number" min="3" max="12" step="1" bind:value={caseP.screws} /></label>
          <label data-tip={t(lang, 'tipScrewSize')}>{t(lang, 'screwSize')}
            <select bind:value={caseP.screwSize}>
              <option value="M3">M3</option>
              <option value="M2.5">M2,5</option>
            </select>
          </label>
          <label data-tip={t(lang, 'tipScrewLength')}>{t(lang, 'screwLength')}
            <select bind:value={caseP.screwLength}>
              <option value={0}>{t(lang, 'screwLengthAuto')}</option>
              {#each STANDARD_LENGTHS as l (l)}<option value={l}>{l} mm</option>{/each}
            </select>
          </label>
          <label data-tip={t(lang, 'tipCaseGap')}>{t(lang, 'caseGap')} <input type="number" min="0" step="0.1" bind:value={caseP.gap} /></label>
          <label data-tip={t(lang, 'tipLedge')}>{t(lang, 'ledge')} <input type="number" min="0" max="5.5" step="0.5" bind:value={caseP.ledge} /></label>
          <label data-tip={t(lang, 'tipChamfer')}>{t(lang, 'chamfer')} <input type="number" min="0" max="2" step="0.5" bind:value={caseP.chamfer} /></label>
          <label data-tip={t(lang, 'tipBossFillet')}>{t(lang, 'bossFillet')} <input type="number" min="0" max="3" step="0.5" bind:value={caseP.bossFillet} /></label>
          <label data-tip={t(lang, 'tipBossFillet')}>{t(lang, 'bossFilletKind')}
            <select bind:value={caseP.bossFilletKind}>
              <option value="fillet">{t(lang, 'bossFilletRound')}</option>
              <option value="chamfer">{t(lang, 'bossFilletChamfer')}</option>
            </select>
          </label>
          <label class="check" data-tip={t(lang, 'tipSupports')}><input type="checkbox" bind:checked={caseP.supports} /> {t(lang, 'supports')}</label>
          <label data-tip={t(lang, 'tipExplode')}>{t(lang, 'explode')} <input type="number" min="0" step="5" bind:value={caseP.explode} /></label>
        </div>
        {#if screwInfo}<p class="muted">{t(lang, 'screwInfo').replace('{n}', String(screwInfo.screws.length)).replace('{s}', lang === 'pl' ? screwInfo.screw.size.replace('.', ',') : screwInfo.screw.size).replace('{l}', String(screwInfo.screwLength))}{#if screwInfo.supports.length}{' '}{t(lang, 'supportInfo').replace('{n}', String(screwInfo.supports.length))}{/if}{' '}{t(lang, 'screwFits').replace('{l}', screwInfo.screwFits.length ? screwInfo.screwFits.join(', ') + ' mm' : '—')}</p>
          {#if screwInfo.screwWarn?.kind === 'long'}
            {@const w = screwInfo.screwWarn}
            <p class="warn">{t(lang, 'screwTooLong').replace('{l}', String(screwInfo.screwLength)).replace('{f}', mmTxt(w.floor))}
              <button onclick={() => (caseP.floor = w.floor)}>{t(lang, 'screwSetFloor').replace('{f}', mmTxt(w.floor))}</button></p>
          {:else if screwInfo.screwWarn?.kind === 'short'}
            <p class="warn">{t(lang, 'screwTooShort').replace('{l}', String(screwInfo.screwLength))}</p>
          {/if}
        {/if}
        <h3>{t(lang, 'extras')}</h3>
        <label class="check" data-tip={t(lang, 'tipPower')}><input type="checkbox" bind:checked={ex.power.on} /> {t(lang, 'power')}</label>
        {#if ex.power.on}
          <div class="grid2">
            <label data-tip={t(lang, 'tipWallSide')}>{t(lang, 'wallSide')}
              <select bind:value={ex.power.side}>
                {#each WALL_SIDES as w (w)}<option value={w}>{wallName(w)}</option>{/each}
              </select>
            </label>
            <label data-tip={t(lang, 'tipWallPos')}>{t(lang, 'wallPos')} <input type="range" min="0" max="100" step="5" bind:value={ex.power.pos} /></label>
          </div>
        {/if}
        {#if !single}
          <label class="check" data-tip={t(lang, 'tipLink')}><input type="checkbox" bind:checked={ex.link.on} /> {t(lang, 'link')}</label>
          {#if ex.link.on}
            <div class="grid2">
              <label data-tip={t(lang, 'tipLink')}>{t(lang, 'linkKind')}
                <select bind:value={ex.link.kind}>
                  <option value="trrs">{t(lang, 'linkTrrs')}</option>
                  <option value="usbc">{t(lang, 'linkUsbc')}</option>
                </select>
              </label>
              <label data-tip={t(lang, 'tipWallSide')}>{t(lang, 'wallSide')}
                <select bind:value={ex.link.side}>
                  {#each WALL_SIDES as w (w)}<option value={w}>{wallName(w)}</option>{/each}
                </select>
              </label>
              <label data-tip={t(lang, 'tipWallPos')}>{t(lang, 'wallPos')} <input type="range" min="0" max="100" step="5" bind:value={ex.link.pos} /></label>
            </div>
          {/if}
        {/if}
        <label class="check" data-tip={t(lang, 'tipBattery')}><input type="checkbox" bind:checked={ex.battery.on} /> {t(lang, 'battery')}</label>
        {#if ex.battery.on}
          <div class="grid2">
            <label data-tip={t(lang, 'tipBattery')}>{t(lang, 'batteryPreset')}
              <select value={BATTERY_PRESETS.find((b) => b.l === ex.battery.l && b.w === ex.battery.w && b.t === ex.battery.t)?.id ?? ''}
                onchange={(e) => { const b = BATTERY_PRESETS.find((x) => x.id === e.currentTarget.value); if (b) Object.assign(ex.battery, { l: b.l, w: b.w, t: b.t }); }}>
                {#each BATTERY_PRESETS as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
                <option value="">{t(lang, 'batteryCustom')}</option>
              </select>
            </label>
            <label>{t(lang, 'batteryL')} <input type="number" min="10" max="120" step="0.5" bind:value={ex.battery.l} /></label>
            <label>{t(lang, 'batteryW')} <input type="number" min="5" max="80" step="0.5" bind:value={ex.battery.w} /></label>
            <label>{t(lang, 'batteryT')} <input type="number" min="1" max="12" step="0.1" bind:value={ex.battery.t} /></label>
          </div>
        {/if}
        {#each Object.entries(extrasBySide) as [s, e] (s)}
          {#each e?.warns ?? [] as w, i (i)}
            <p class={w.kind === 'noSpot' || w.kind === 'tooTall' ? 'warn' : 'muted'}>{single ? '' : `${t(lang, s === 'left' ? 'left' : 'right')}: `}{extraWarnText(w)}</p>
          {/each}
        {/each}
      {/if}
    </section>

    {#if single}
    <section>
      <h2>{t(lang, 'print')}</h2>
      <div class="grid2">
        <label data-tip={t(lang, 'tipBed')}>{t(lang, 'bedX')} <input type="number" min="100" step="5" bind:value={print.bedX} /></label>
        <label data-tip={t(lang, 'tipBed')}>{t(lang, 'bedY')} <input type="number" min="100" step="5" bind:value={print.bedY} /></label>
        <label data-tip={t(lang, 'tipSplitMode')}>{t(lang, 'splitMode')}
          <select bind:value={print.mode}>
            <option value="auto">{t(lang, 'splitAuto')}</option>
            <option value="off">{t(lang, 'splitOff')}</option>
          </select>
        </label>
        <label data-tip={t(lang, 'tipSeamGap')}>{t(lang, 'seamGap')} <input type="number" min="0" max="0.6" step="0.05" bind:value={print.clearance} /></label>
      </div>
      {#if split}
        <p class={split.fits ? 'muted' : 'warn'}>
          {t(lang, split.fits ? 'splitInfo' : 'splitNoFit')
            .replace('{p1}', `${mm(split.plateParts[0][0])} × ${mm(split.plateParts[0][1])}`)
            .replace('{p2}', `${mm(split.plateParts[1][0])} × ${mm(split.plateParts[1][1])}`)
            .replace('{c1}', `${mm(split.caseParts[0][0])} × ${mm(split.caseParts[0][1])}`)
            .replace('{c2}', `${mm(split.caseParts[1][0])} × ${mm(split.caseParts[1][1])}`)}
        </p>
      {:else}
        <p class="muted">{t(lang, print.mode === 'off' ? 'splitDisabled' : 'fitsBed')}</p>
      {/if}
    </section>
    {/if}

    <section>
      <h2>{t(lang, 'export')}</h2>
      {#if exportBlocked}<p class="warn">{t(lang, 'exportBlockedScrew')}</p>{/if}
      {#each sides.length === 1 && single ? (['left'] as const) : (['left', 'right'] as const) as s (s)}
        {#each pieces as pc (pc ?? -1)}
        {@const pcName = pc === undefined ? '' : ` ${pc + 1}/2`}
        <div class="row">
          <span class="side">{single ? t(lang, 'plate') : t(lang, s)}{pcName}</span>
          <button onclick={() => exportFile(s, 'stl', 'plate', pc)} disabled={!cellStep || exportBlocked} data-tip={t(lang, 'tipStl')}>STL</button>
          <button onclick={() => exportFile(s, 'step', 'plate', pc)} disabled={!cellStep || exportBlocked} data-tip={t(lang, 'tipStep')}>STEP</button>
        </div>
        {/each}
        {#if caseOn}
          {#each pieces as pc (pc ?? -1)}
          {@const pcName = pc === undefined ? '' : ` ${pc + 1}/2`}
          <div class="row">
            <span class="side">{single ? t(lang, 'caseBottom') : `${t(lang, 'caseBottom')}: ${t(lang, s).toLowerCase()}`}{pcName}</span>
            <button onclick={() => exportFile(s, 'stl', 'case', pc)} disabled={!cellStep || exportBlocked} data-tip={t(lang, 'tipStl')}>STL</button>
            <button onclick={() => exportFile(s, 'step', 'case', pc)} disabled={!cellStep || exportBlocked} data-tip={t(lang, 'tipStep')}>STEP</button>
          </div>
          {/each}
        {/if}
        {#if islandGeom(s)?.wedge}
          <div class="row">
            <span class="side">{single ? t(lang, 'wedgePart') : `${t(lang, 'wedgePart')}: ${t(lang, s).toLowerCase()}`}</span>
            <button onclick={() => exportFile(s, 'stl', 'wedge')} disabled={!cellStep || exportBlocked} data-tip={t(lang, 'tipStl')}>STL</button>
            <button onclick={() => exportFile(s, 'step', 'wedge')} disabled={!cellStep || exportBlocked} data-tip={t(lang, 'tipStep')}>STEP</button>
          </div>
        {/if}
      {/each}
    </section>

    {/if}

    {#if tab === 'keycaps'}
    <KeycapPanel
      {lang}
      keys={leftKeys.concat(single ? [] : rightKeys)}
      refs={capRefs}
      stabs={plate.stabs ?? 'cherry'}
      client={() => client('right')}
      fileBase={templateId}
      save={saveFile}
      bind:params={keycap}
      bind:show={showCaps}
      bind:meshes={capMeshes}
    />
    <LegendPanel {lang} keys={leftKeys.concat(single ? [] : rightKeys)} refs={capRefs} bind:params={keycap} bind:labels={capLabels} bind:selected={pickedKey} defaults={defaultSets} />
    {/if}
    {#if tab === 'colors'}
    <ColorPanel
      {lang}
      bind:colors
      bind:selected={pickedKey}
      {keyInfo}
      capsShown={showCaps}
      showCaps={() => (showCaps = true)}
    />
    {/if}
    {#if tab === 'wiring'}
    <WiringPanel {lang} input={wiringInput} fileBase={templateId} save={saveFile} />
    {/if}

    <footer class="muted">
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">{t(lang, 'license')}</a>
      · <a href="https://github.com/NuernGH/Keyboard-maker" target="_blank" rel="noreferrer">{t(lang, 'source')}</a>
    </footer>
  </aside>

  <main>
    <Preview bind:this={preview} {halves} {cellHeight} stabs={plate.stabs ?? 'cherry'} switchMesh={showSwitches ? switchMesh : null} capMeshes={showCaps ? capMeshes : null}
      {colors}
      {looks}
      {labels}
      pickKey={tab === 'keycaps' || tab === 'colors' ? (ref) => (pickedKey = ref) : null}
      selected={tab === 'keycaps' || tab === 'colors' ? pickedKey : null}
    />
    <div class="hud">
      <span class="badge" class:exact={allExact} data-tip={t(lang, 'tipBadge')}>
        {#if anyBusy}{t(lang, 'computing')}{:else if allExact}{t(lang, 'exact')}{#if lastMs}&nbsp;· {lastMs} ms{/if}{:else}{t(lang, 'quick')}{/if}
      </span>
      {#if status}<span class="badge">{status}</span>{/if}
      {#if error}<span class="badge err">{t(lang, 'error')}: {error}</span>{/if}
      <button onclick={() => preview?.resetView()} data-tip={t(lang, 'tipResetView')}>{t(lang, 'resetView')}</button>
      <button onclick={() => preview?.bottomView()} data-tip={t(lang, 'tipBottomView')}>{t(lang, 'bottomView')}</button>
    </div>
  </main>
</div>

{/if}

<style>
  .app {
    display: grid;
    grid-template-columns: 320px 1fr;
    height: 100%;
  }
  aside {
    overflow-y: auto;
    padding: 12px 16px;
    border-right: 1px solid var(--line);
    background: var(--panel);
  }
  header select {
    width: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  h1 {
    font-size: 17px;
    margin: 4px 0;
  }
  h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 0 0 6px;
  }
  section {
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
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
  .label {
    font-size: 13px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 10px;
  }
  .stagger {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }
  .stagger input {
    padding: 4px 2px;
    font-size: 12px;
  }
  textarea {
    width: 100%;
    font: 12px/1.4 ui-monospace, monospace;
    padding: 4px 6px;
    resize: vertical;
    box-sizing: border-box;
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
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .side {
    width: 50px;
    font-size: 13px;
  }
  .file input {
    display: none;
  }
  .file {
    display: inline-block;
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    cursor: pointer;
    background: var(--field);
    margin: 0;
  }
  button {
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--field);
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
  }
  .warn {
    color: var(--warn);
    font-size: 12px;
  }
  main {
    position: relative;
    overflow: hidden;
  }
  .hud {
    position: absolute;
    top: 10px;
    left: 10px;
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .badge {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
  }
  .badge.exact {
    border-color: var(--ok);
    color: var(--ok);
  }
  .badge.err {
    border-color: var(--err);
    color: var(--err);
  }
  footer {
    padding-top: 10px;
  }
  @media (max-width: 760px) {
    .app {
      grid-template-columns: 1fr;
      grid-template-rows: 55vh auto;
      height: auto;
    }
    aside {
      order: 2;
    }
    main {
      height: 55vh;
    }
  }
  .extra {
    display: grid;
    grid-template-columns: 1fr 1fr 0.8fr 0.8fr auto;
    gap: 6px;
    align-items: end;
    margin-bottom: 6px;
  }
  .extra input,
  .extra select {
    width: 100%;
    min-width: 0;
  }
  .del {
    padding: 4px 9px;
  }
</style>
