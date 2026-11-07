<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Klawiatura typu Dactyl: panel parametrów, szybki podgląd z otoczek (liczony od razu w przeglądarce)
  i dokładna bryła z OpenCascade (po chwili), eksport skorupy i dna do STL/STEP.
  Rozmieszczenie i skorupa: port z Dactyl Configurator (rianadon, AGPL-3.0), patrz src/lib/dactyl.ts.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import qh from 'quickhull3d/dist/quickhull3d.js';
  import { t, type Lang } from './i18n';
  import WiringPanel from './WiringPanel.svelte';
  import KeycapPanel from './KeycapPanel.svelte';
  import LegendPanel from './LegendPanel.svelte';
  import { legendRef, type LegendSet, type PlacedLegend } from '../lib/legend';
  import { DEFAULT_KEYCAP, layoutKeyLegends, capType, type KeycapParams } from '../lib/keycap-spec';
  import { legendFont } from './font';
  import type { Font } from 'opentype.js';
  import ColorPanel from './ColorPanel.svelte';
  import { DEFAULT_COLORS, resolveKeys, type PreviewColors } from '../lib/colors';
  import { dactylLegends } from '../lib/legend-defaults';
  import { disposeGlow, glowGroup, legendFront, legendPlane, loadLegendFace, meshTop } from './previewDecor';
  import ProjectBar from './ProjectBar.svelte';
  import Tabs from './Tabs.svelte';
  import { PANEL_TABS, type PanelTab } from './tabs';
  import { makeProject, mergeDefaults, type DactylProject, type ProjectFile } from '../lib/project';
  import { dactylWiringInput } from '../lib/wiring-doc';
  import Tooltip from './Tooltip.svelte';
  import { TEMPLATES } from '../lib/layout';
  import {
    apply,
    buildDactyl,
    capCollisions,
    cellCollisions,
    CAP,
    DACTYL_DEFAULT,
    modelSize,
    type DactylModel,
    type DactylParams,
  } from '../lib/dactyl';
  import { DEFAULT_ORGANIC, ORGANIC_OUTLINE, withBlanket, type OrganicParams } from '../lib/dactyl-blanket';
  import { controllerHolder, DEFAULT_DACTYL_CONTROLLER, type ControllerParams, type DactylController } from '../lib/dactyl-parts';
  import { dactylExtras } from '../lib/dactyl-extras';
  import { BATTERY_PRESETS, DEFAULT_EXTRAS, hasExtras, type CaseExtras, type ExtraWarn, type WallSide } from '../lib/case-extras';
  import { loadControllerModel, placeOnBoard } from './controllerModel';
  import { CONTROLLERS, type ControllerId } from '../lib/island';
  import { NO_HOTSWAP_HEIGHT } from '../lib/cell-spec';
  import { dactylHeadDepth, screwSpec, type ScrewSize } from '../lib/case';
  import { CadClient } from '../cad/client';
  import type { PreviewMesh } from './Preview.svelte';
  import type { DactylInput } from '../cad/protocol';
  import { zipStore } from '../lib/zip';
  import { DEFAULT_PRINT } from '../lib/split';

  let {
    lang = $bindable(),
    onTemplate,
    switchMesh = null,
    init = null,
    onProject,
  }: {
    lang: Lang;
    onTemplate: (id: string) => void;
    switchMesh?: PreviewMesh | null;
    /** ustawienia z wczytanego projektu (null = domyślne) */
    init?: DactylProject | null;
    /** wczytanie pliku projektu (płaskiego albo Dactyla) obsługuje App */
    onProject: (p: ProjectFile) => void;
  } = $props();
  // model przełącznika Cherry MX (ten sam co w podglądzie płaskiej klawiatury), środek wierzchu płyty = 0
  const switchGeo = $derived.by(() => {
    if (!switchMesh) return null;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(switchMesh.vertices, 3));
    sg.setAttribute('normal', new THREE.BufferAttribute(switchMesh.normals, 3));
    sg.setIndex(new THREE.BufferAttribute(switchMesh.triangles, 1));
    return sg;
  });

  const L = {
    pl: {
      kind: 'Dactyl (zakrzywiona)',
      curve: 'Krzywizna',
      alpha: 'Kolumna α (°)',
      pinkyAlpha: 'Mały palec α (°)',
      beta: 'Rząd β (°)',
      tent: 'Tenting (°)',
      height: 'Podniesienie (mm)',
      widePinky: 'Mały palec 1,5U',
      thumbShift: 'Przesunięcie kciuka X / Y / Z (mm)',
      stagger: 'Przesunięcie kolumn: przód / wysokość (mm)',
      fIndex: 'Wskazujący',
      fMiddle: 'Środkowy',
      fRing: 'Serdeczny',
      fPinky: 'Mały',
      tipStagger: 'Każdy palec ma inną długość, więc kolumny są przesunięte do przodu (Y, + dalej od ciebie) i w pionie (Z, + wyżej). Wszystko na 0 = kolumny równo, bez schodków.',
      shellKind: 'Skorupa',
      shellOrganic: 'organiczna',
      shellBlanket: 'gładka (koc)',
      shellHulls: 'łączniki jak w Dactylu',
      pattern: 'Wzór na ściankach',
      tipPattern: 'Woronoj na pionowych ściankach: płaskorzeźba (rowki, ścianka pełna) albo ażur (otwory na wylot). Góra każdego oczka zwęża się pod 45°, więc drukuje się bez podpór. Wzór omija klawisze, tuleje śrub i kontroler.',
      patNone: 'brak',
      patRelief: 'płaskorzeźba (rowki)',
      patHoles: 'ażur (otwory)',
      patCell: 'Oczko (mm)',
      patRib: 'Żeberko (mm)',
      tipRib: 'Szerokość materiału między oczkami. Przy dyszy 0,4 co najmniej 1,2 mm (3 ścieżki).',
      patDepth: 'Głębokość rowków (mm)',
      tipShell: 'Organiczna: klawisze połączone jedną gładką bryłą, wklęsłe kąty wypełnione, wypukłe zaokrąglone, ściany z jednego obrysu; opcjonalnie wzór Woronoja. Koc: jedna gładka powierzchnia przez płyty wszystkich klawiszy, pionowe ściany z fazką. Liczony jako siatka, więc eksport tylko do STL. Łączniki: skorupa z otoczek jak w Dactyl Configurator (STL i STEP).',
      blanketStl: 'Skorupa organiczna i „koc” są siatką: tylko STL (dno także STEP).',
      smooth: 'Ściany',
      smoothOff: 'kanciaste (jak oryginał)',
      smoothCorners: 'zaokrąglone narożniki',
      smoothFull: 'gładkie',
      wall: 'Ściana (mm)',
      chamfer: 'Fazka krawędzi (mm)',
      slotCover: 'Zakryj boczne kanały gniazd',
      tipSlotCover: 'Fartuch 2 mm na bokach klawiszy, gdzie kanał gniazda hot-swap wychodzi na zewnątrz (np. pod wysokim kciukiem). Domyślnie wyłączone, jak dotąd.',
      tipChamfer: 'Ostre krawędzie wierzchu (uskoki przy kciuku, grzbiety) ścięte pod 45°. 0 = bez fazki.',
      floor: 'Dno (mm)',
      controller: 'Kontroler przy tylnej ścianie',
      ctrlCol: 'Nad kolumną',
      noCtrl: 'bez kontrolera',
      side: 'Połówki',
      both: 'obie',
      showCaps: 'Pokaż nakładki',
      explode: 'Odsunięcie dna (mm)',
      shell: 'Skorupa',
      bottom: 'Dno',
      size: 'Połówka: {x} × {y} mm, wysokość {z} mm',
      bed: 'Mieści się na stole {bed} mm.',
      bedNo: 'Nie mieści się na stole {bed} mm.',
      capHit: 'Nakładki zahaczają o siebie: {l}',
      cellHit: 'Komórki wchodzą w siebie: {l}',
      lift: 'Model podniesiony o {v} mm, żeby komórki nie schodziły pod dno.',
      credit: 'Rozmieszczenie i skorupa: port Dactyl Configurator (rianadon, AGPL-3.0).',
      slow: 'Dokładna bryła liczy się około minuty.',
      tipCurve: 'Kąt między sąsiednimi klawiszami w kolumnie (α) i w rzędzie (β). Większy = mocniej wklęsła miska.',
      tipTent: 'Pochylenie całej połówki na zewnątrz, jak dach namiotu. Dłoń leży bardziej na boku.',
      tipThumb: 'Przesuwa cały klaster kciuka (6 klawiszy jak w Dactyl Configurator).',
      tipCtrl: 'nice!nano leży płasko w korytku na dnie, gniazdem USB-C w otworze tylnej ściany.',
    },
    en: {
      kind: 'Dactyl (curved)',
      curve: 'Curvature',
      alpha: 'Column α (°)',
      pinkyAlpha: 'Pinky α (°)',
      beta: 'Row β (°)',
      tent: 'Tenting (°)',
      height: 'Height offset (mm)',
      widePinky: 'Pinky 1.5U',
      thumbShift: 'Thumb shift X / Y / Z (mm)',
      stagger: 'Column stagger: forward / height (mm)',
      fIndex: 'Index',
      fMiddle: 'Middle',
      fRing: 'Ring',
      fPinky: 'Pinky',
      tipStagger: 'Fingers differ in length, so columns are shifted forward (Y, + away from you) and vertically (Z, + higher). All 0 = even columns, no steps.',
      shellKind: 'Shell',
      shellOrganic: 'organic',
      shellBlanket: 'smooth (blanket)',
      shellHulls: 'Dactyl connectors',
      pattern: 'Wall pattern',
      tipPattern: 'Voronoi on the vertical walls: relief (grooves, solid wall) or openwork (through holes). The top of every opening narrows at 45°, so it prints without supports. The pattern avoids keys, screw posts and the controller.',
      patNone: 'none',
      patRelief: 'relief (grooves)',
      patHoles: 'openwork (holes)',
      patCell: 'Cell (mm)',
      patRib: 'Rib (mm)',
      tipRib: 'Material width between cells. With a 0.4 nozzle at least 1.2 mm (3 lines).',
      patDepth: 'Groove depth (mm)',
      tipShell: 'Organic: keys joined into one smooth body, inner corners filled, outer edges rounded, walls from one outline; optional Voronoi pattern. Blanket: one smooth surface through all key plates, vertical chamfered walls. Built as a mesh, so STL export only. Connectors: hull shell as in Dactyl Configurator (STL and STEP).',
      blanketStl: 'The organic and blanket shells are meshes: STL only (the bottom also STEP).',
      smooth: 'Walls',
      smoothOff: 'faceted (as original)',
      smoothCorners: 'rounded corners',
      smoothFull: 'smooth',
      wall: 'Wall (mm)',
      chamfer: 'Edge chamfer (mm)',
      slotCover: 'Cover socket side channels',
      tipSlotCover: 'A 2 mm apron on key sides where the hot-swap socket channel opens to the outside (e.g. under a high thumb key). Off by default, as before.',
      tipChamfer: 'Sharp top edges (steps at the thumb, ridges) cut at 45°. 0 = no chamfer.',
      floor: 'Bottom (mm)',
      controller: 'Controller at the back wall',
      ctrlCol: 'Above column',
      noCtrl: 'no controller',
      side: 'Halves',
      both: 'both',
      showCaps: 'Show keycaps',
      explode: 'Bottom offset (mm)',
      shell: 'Shell',
      bottom: 'Bottom',
      size: 'Half: {x} × {y} mm, height {z} mm',
      bed: 'Fits a {bed} mm bed.',
      bedNo: 'Does not fit a {bed} mm bed.',
      capHit: 'Keycaps collide: {l}',
      cellHit: 'Cells cut into each other: {l}',
      lift: 'Model raised by {v} mm so the cells stay above the bottom.',
      credit: 'Key placement and shell: port of Dactyl Configurator (rianadon, AGPL-3.0).',
      slow: 'The exact solid takes about a minute.',
      tipCurve: 'Angle between neighbouring keys in a column (α) and in a row (β). Larger = deeper bowl.',
      tipTent: 'Tilts the whole half outwards like a tent roof. The hand rests more on its side.',
      tipThumb: 'Moves the whole thumb cluster (6 keys as in Dactyl Configurator).',
      tipCtrl: 'The nice!nano lies flat in a tray on the bottom, USB-C in an opening in the back wall.',
    },
  } as const;
  const tx = (k: keyof (typeof L)['pl']) => L[lang][k];

  // wartości startowe: z wczytanego projektu (brakujące pola = domyślne) albo domyślne
  // svelte-ignore state_referenced_locally
  const i0 = init;
  const pick = <T,>(v: unknown, ok: (x: unknown) => boolean, def: T): T => (i0 && ok(v) ? (v as T) : def);
  const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  const isBool = (x: unknown) => typeof x === 'boolean';
  let p = $state<DactylParams>(i0 ? mergeDefaults(DACTYL_DEFAULT, i0.params) : structuredClone(DACTYL_DEFAULT));
  let variant = $state<'hotswap' | 'no-hotswap'>(pick(i0?.variant, (x) => x === 'hotswap' || x === 'no-hotswap', 'hotswap'));
  let show = $state<'left' | 'right' | 'both'>(pick(i0?.show, (x) => x === 'left' || x === 'right' || x === 'both', 'both'));
  let ctrlOn = $state(pick(i0?.ctrlOn, isBool, true));
  let ctrl = $state<ControllerParams>(i0 ? mergeDefaults(DEFAULT_DACTYL_CONTROLLER, i0.ctrl) : { ...DEFAULT_DACTYL_CONTROLLER });
  let floor = $state(pick(i0?.floor, isNum, 4));
  let chamfer = $state(pick(i0?.chamfer, isNum, 0));
  let slotCover = $state(pick(i0?.slotCover, isBool, false));
  // domyślnie łączniki jak na main (projekty Marcina w druku się nie zmieniają); organiczna i koc jako opcje
  let shellKind = $state<'organic' | 'blanket' | 'hulls'>(pick(i0?.shellKind, (x) => x === 'organic' || x === 'blanket' || x === 'hulls', 'hulls'));
  let organic = $state<OrganicParams>(i0 ? mergeDefaults(DEFAULT_ORGANIC, i0.organic) : { ...DEFAULT_ORGANIC });
  /** skorupa z siatki (Manifold): eksport tylko STL */
  const meshShell = $derived(shellKind !== 'hulls');
  let screwSize = $state<ScrewSize>(pick(i0?.screwSize, (x) => x === 'M3' || x === 'M2.5', 'M3'));
  let explode = $state(pick(i0?.explode, isNum, 20));
  /** dodatki: włącznik baterii, gniazdo kabla między połówkami, bateria (domyślnie wyłączone) */
  let extras = $state<Required<CaseExtras>>(i0 ? mergeDefaults(DEFAULT_EXTRAS, i0.extras) : structuredClone(DEFAULT_EXTRAS));
  let tab = $state<PanelTab>('keyboard');
  $effect(() => {
    if (tab === 'keycaps') showCaps = true;
  });
  let showCaps = $state(pick(i0?.showCaps, isBool, true));
  const dactylProject = (): ProjectFile =>
    makeProject('dactyl', {
      params: snap(),
      variant,
      show,
      ctrlOn,
      ctrl: $state.snapshot(ctrl),
      floor,
      screwSize,
      chamfer,
      slotCover,
      shellKind,
      organic: $state.snapshot(organic),
      extras: $state.snapshot(extras),
      explode,
      showCaps,
      keycap: $state.snapshot(keycap),
      colors: $state.snapshot(colors),
    });
  /** nakładki: profil i siatki typów (gdy są, podgląd pokazuje prawdziwe nakładki zamiast uproszczonych) */
  let keycap = $state<KeycapParams>(i0 ? mergeDefaults(DEFAULT_KEYCAP, i0.keycap) : structuredClone(DEFAULT_KEYCAP));
  let capLabels = $state<Record<string, PlacedLegend[]>>({});
  /** kolory podglądu (domyślnie wyłączone = podgląd jak dotąd) */
  let colors = $state<PreviewColors>(i0 ? mergeDefaults(DEFAULT_COLORS, i0.colors) : structuredClone(DEFAULT_COLORS));
  /** wybrany klawisz (`strona:id`): wiersz w tabeli legend, kolory klawisza, podświetlenie w podglądzie */
  let pickedKey = $state<string | null>(null);
  let capMeshes = $state<Record<string, PreviewMesh>>({});
  /** rozmiar nakładki klawisza Dactyla w U: szeroki mały palec 1,5U wzdłuż X, górne klawisze kciuka 1,5U wzdłuż Y */
  const capSize = (m: DactylModel, k: DactylModel['keys'][number]) => ({
    w: m.params.widePinky && k.col === m.params.cols - 1 && k.row !== m.params.rows - 1 ? 1.5 : 1,
    h: k.thumb === 'tl' || k.thumb === 'tr' ? 1.5 : 1,
  });
  let cellStep = $state<ArrayBuffer | null>(null);
  let status = $state('');
  let error = $state('');

  /** wysokość komórki z key socket.STEP (8,58 mm) albo bez hot-swap */
  const cellHeight = $derived(variant === 'hotswap' ? 8.58 : NO_HOTSWAP_HEIGHT);
  const snap = () => $state.snapshot(p) as DactylParams;
  /** o ile łeb wystaje spod dna i jakie dno go chowa (wybranie zostawia 1 mm dna) */
  const headOut = $derived(screwSpec(screwSize).headDepth - 0.2 - dactylHeadDepth(screwSpec(screwSize), floor));
  const headFloor = $derived(Math.ceil((screwSpec(screwSize).headDepth + 1) * 2) / 2);
  const model = $derived.by<DactylModel | null>(() => {
    try {
      return buildDactyl(snap(), { cellHeight, screwSize });
    } catch (e) {
      return null;
    }
  });
  // kontroler stoi przy ścianie skorupy, a koc i organiczna mają własny obrys (jak w workerze)
  const shellModel = $derived(
    model && shellKind === 'organic' ? withBlanket(model, ORGANIC_OUTLINE) : model && shellKind === 'blanket' ? withBlanket(model) : model,
  );
  const holder = $derived(shellModel && ctrlOn ? controllerHolder(shellModel, $state.snapshot(ctrl) as ControllerParams) : null);
  /** dodatki (jak w workerze: liczone dla prawej połówki, z omijaniem uchwytu kontrolera) */
  const extrasPart = $derived(shellModel ? dactylExtras(shellModel, $state.snapshot(extras) as CaseExtras, holder) : null);
  const WALLS: WallSide[] = ['back', 'front', 'inner', 'outer'];
  const wallName = (w: WallSide) => t(lang, ({ back: 'wallBack', front: 'wallFront', inner: 'wallInner', outer: 'wallOuter' } as const)[w]);
  function extraWarnText(w: ExtraWarn): string {
    const part = t(lang, w.part);
    const key = ({ noSpot: 'extraNoSpot', tooTall: 'extraTooTall', moved: 'extraMoved', otherSide: 'extraOtherSide' } as const)[w.kind];
    return t(lang, key).replace('{p}', part).replace('{s}', w.side ? wallName(w.side) : '');
  }
  // modele kontrolerów wczytane do podglądu (ścieżka -> geometria)
  let ctrlGeo = $state(new Map<string, THREE.BufferGeometry>());
  $effect(() => {
    for (const gh of holder?.ghosts ?? []) {
      const path = gh.model;
      if (path && !ctrlGeo.has(path))
        void loadControllerModel(path).then((g) => {
          if (g && !ctrlGeo.has(path)) ctrlGeo = new Map(ctrlGeo).set(path, g);
        });
    }
  });
  const size = $derived(model ? modelSize(model) : null);
  const caps = $derived(model ? capCollisions(model) : []);
  const cells = $derived(model ? cellCollisions(model) : []);

  function inputFor(part: 'shell' | 'bottom', side: 'left' | 'right'): DactylInput | null {
    if (!cellStep) return null;
    return {
      params: snap(),
      variant,
      cellId: 'default',
      cellStep,
      up: 'auto',
      part,
      side,
      controller: ctrlOn ? ($state.snapshot(ctrl) as ControllerParams) : null,
      floor,
      screwSize,
      chamfer,
      slotCover,
      shell: shellKind,
      ...(shellKind === 'organic' ? { organic: $state.snapshot(organic) as OrganicParams } : {}),
      // bez dodatków pole pomijamy, żeby nie zmieniać kluczy pamięci podręcznej brył
      ...(hasExtras(extras) ? { extras: $state.snapshot(extras) as CaseExtras } : {}),
    };
  }
  const keyOf = (i: DactylInput) => JSON.stringify({ ...i, cellStep: undefined, side: undefined });

  // ---------- CAD ----------
  const client = new CadClient();
  type Mesh = { vertices: Float32Array; normals: Float32Array; triangles: Uint32Array };
  // shell.approx: szybki podgląd z siatek (Manifold), dokładna bryła jeszcze się liczy
  let exact = $state<{ shell?: { key: string; mesh: Mesh; approx?: boolean }; bottom?: { key: string; mesh: Mesh } }>({});
  let busy = $state(false);
  let lastMs = $state<number | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let want = '';
  // ile dokładnych skorup policzył obecny worker (pamięć OpenCascade rośnie z każdą)
  let shellBuilds = 0;
  const SHELLS_PER_WORKER = 2;
  $effect(() => {
    const si = inputFor('shell', 'right');
    const bi = inputFor('bottom', 'right');
    if (!si || !bi) return;
    clearTimeout(timer);
    timer = setTimeout(() => void compute(si, bi), 900);
  });
  async function compute(si: DactylInput, bi: DactylInput) {
    const k = keyOf(si);
    want = k;
    // poprzednie liczenie jeszcze trwa (parametry zmieniły się w trakcie): przerywamy je od razu
    const stale = busy;
    busy = true;
    error = '';
    if (stale || shellBuilds >= SHELLS_PER_WORKER) {
      client.restart();
      shellBuilds = 0;
    }
    try {
      // dno jest szybkie, więc najpierw
      const b = await client.dactylMesh(bi);
      if (want !== k) return;
      exact.bottom = { key: k, mesh: b };
      // zwykła skorupa: najpierw w ułamku sekundy podgląd z siatek, potem dokładna bryła (eksport)
      // (chyba że dokładna jest już w pamięci przeglądarki z wcześniejszej wizyty)
      if ((si.shell ?? 'hulls') === 'hulls' && !(await client.dactylMeshCached(si))) {
        const f = await client.dactylMesh({ ...si, preview: true });
        if (want !== k) return;
        exact.shell = { key: k, mesh: f, approx: true };
      }
      const s = await client.dactylMesh(si);
      if (!s.cached) shellBuilds++;
      if (want !== k) return;
      exact.shell = { key: k, mesh: s };
      lastMs = s.cached ? null : Math.round(s.ms);
    } catch (e) {
      if (want === k && (e as Error).message !== 'restart') error = (e as Error).message;
    } finally {
      if (want === k) busy = false;
    }
  }

  async function exportPart(part: 'shell' | 'bottom', side: 'left' | 'right', format: 'stl' | 'step') {
    const inp = inputFor(part, side);
    if (!inp) return;
    status = t(lang, 'computing');
    error = '';
    try {
      const data = await client.dactylExport(inp, format);
      const name = `dactyl-${p.rows}x${p.cols}-${side}-${part}${part === 'shell' ? `-${variant}` : ''}.${format}`;
      await saveFile(name, data);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      status = '';
    }
  }

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

  // ---------- podgląd 3D ----------
  let host: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let group = new THREE.Group();
  let framed = false;
  const mats = {
    shell: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.6, side: THREE.DoubleSide }),
    quick: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.9, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    bottom: new THREE.MeshStandardMaterial({ color: 0x3f4b58, roughness: 0.75, side: THREE.DoubleSide }),
    cap: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5, transparent: true, opacity: 0.75 }),
    capHit: new THREE.MeshStandardMaterial({ color: 0xd9534f, roughness: 0.5 }),
    sw: new THREE.MeshStandardMaterial({ color: 0x30363c, roughness: 0.6 }),
    board: new THREE.MeshStandardMaterial({ color: 0x2a6f97, roughness: 0.6 }),
    usb: new THREE.MeshStandardMaterial({ color: 0xc0c6ca, roughness: 0.3, metalness: 0.7 }),
    part: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.5 }),
    knob: new THREE.MeshStandardMaterial({ color: 0xb5543c, roughness: 0.5 }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x3d7a4f, roughness: 0.7 }),
    battery: new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.35, metalness: 0.5 }),
    edge: new THREE.LineBasicMaterial({ color: 0x5b6875, transparent: true, opacity: 0.5 }),
  };

  function meshGeom(m: Mesh): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setIndex(new THREE.BufferAttribute(m.triangles, 1));
    return g;
  }

  /** Szybki podgląd: wszystkie otoczki jako jedna siatka (bez wycięć), przycięta wizualnie do podłogi. */
  function quickGeom(m: DactylModel): THREE.BufferGeometry {
    const pos: number[] = [];
    for (const h of m.hulls) {
      const pts = h.map((q) => [q[0], q[1], Math.max(0, q[2])] as [number, number, number]);
      let faces: number[][];
      try {
        faces = qh(pts);
      } catch {
        continue;
      }
      for (const f of faces) for (const i of f) pos.push(...pts[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  function toMatrix(m: { r: number[]; t: number[] }): THREE.Matrix4 {
    const r = m.r;
    return new THREE.Matrix4().set(r[0], r[1], r[2], m.t[0], r[3], r[4], r[5], m.t[1], r[6], r[7], r[8], m.t[2], 0, 0, 0, 1);
  }

  function boxAt(b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; m?: { r: number[]; t: number[] } }, mat: THREE.Material) {
    const g = new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    const o = new THREE.Mesh(g, mat);
    if (b.m) {
      o.matrixAutoUpdate = false;
      o.matrix.copy(toMatrix(b.m));
    }
    return o;
  }

  // ---------- kolory podglądu ----------
  const sidesShown = $derived(show === 'both' ? (['left', 'right'] as const) : [show]);
  const legends = $derived(
    model ? { left: dactylLegends(model.keys, model.params.rows, 'left'), right: dactylLegends(model.keys, model.params.rows, 'right') } : null,
  );
  const defaultSets = $derived(
    legends ? (Object.fromEntries((['left', 'right'] as const).flatMap((sd) => Object.entries(legends[sd]).map(([id, l]) => [legendRef(sd, id), l]))) as Record<string, LegendSet>) : {},
  );
  const mainOf = (ref: string) => keycap.legends?.[ref]?.main ?? defaultSets[ref]?.main ?? '';
  const looks = $derived.by(() => {
    if (!colors.on || !model) return null;
    const m = model;
    // tęcza: x klawisza w widoku (lewa połówka to lustro przesunięte w lewo, jak w rebuild)
    const minX = Math.min(...m.keys.map((k) => k.frame.t[0]));
    const keys = sidesShown.flatMap((s) =>
      m.keys.map((k) => {
        const sz = capSize(m, k);
        const x = k.frame.t[0];
        const ref = `${s}:${k.id}`;
        return { ref, main: mainOf(ref), w: sz.w, h: sz.h, x: s === 'left' ? 2 * minX - 30 - x : x, y: k.frame.t[1] };
      }),
    );
    return resolveKeys(colors, keys, true);
  });
  let font = $state.raw<Font | null>(null);
  void legendFont().then((f) => (font = f), () => {});
  /** legendy w podglądzie: z tabeli, a bez własnych (przy kolorach z nazwami klawiszy) domyślne opisy */
  const labels = $derived.by<Record<string, PlacedLegend[]> | null>(() => {
    if (!font || !model) return null;
    const m = model;
    const own = keycap.legends ?? {};
    const withDefaults = colors.on && colors.legends.show;
    const kp = $state.snapshot(keycap) as KeycapParams;
    const out: Record<string, PlacedLegend[]> = {};
    for (const s of ['left', 'right'] as const)
      for (const k of m.keys) {
        const ref = legendRef(s, k.id);
        const set = own[ref] ?? (withDefaults ? defaultSets[ref] : undefined);
        if (!set || !Object.keys(set).length) continue;
        const sz = capSize(m, k);
        out[ref] = layoutKeyLegends(font, $state.snapshot(set) as LegendSet, kp, sz.w, sz.h);
      }
    return out;
  });
  function keyInfo(ref: string) {
    const [, id] = ref.split(':') as ['left' | 'right', string];
    const k = model?.keys.find((q) => q.id === id);
    if (!k || !model) return null;
    const sz = capSize(model, k);
    return { main: mainOf(ref), w: sz.w, h: sz.h, named: true };
  }
  const capMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const tintMat = (c: string) => {
    let mt = capMatCache.get(c);
    if (!mt) capMatCache.set(c, (mt = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 })));
    return mt;
  };
  const legendTex = new Map<string, THREE.CanvasTexture>();
  let glow = new THREE.Group();

  function halfGroup(m: DactylModel, side: 'left' | 'right' = 'right'): THREE.Group {
    const g = new THREE.Group();
    const k = keyOf(inputFor('shell', 'right') ?? ({} as DactylInput));
    const sh = exact.shell?.key === k ? exact.shell.mesh : null;
    const bt = exact.bottom?.key === k ? exact.bottom.mesh : null;
    if (sh) {
      const sg = meshGeom(sh);
      g.add(new THREE.Mesh(sg, mats.shell));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(sg, 30), mats.edge));
    } else g.add(new THREE.Mesh(quickGeom(m), mats.quick));
    if (bt) {
      const bm = new THREE.Mesh(meshGeom(bt), mats.bottom);
      bm.position.z = -explode;
      g.add(bm);
    }
    if (holder) {
      const eg = new THREE.Group();
      eg.position.z = bt ? -explode : 0;
      // kontroler z modelem (np. nice!nano): model zamiast pudełek płytki i gniazda USB
      const board = holder.ghosts.find((gh) => gh.kind === 'board' && gh.model && ctrlGeo.get(gh.model));
      if (board) {
        const geo = ctrlGeo.get(board.model!)!;
        const usb = holder.ghosts.find((gh) => gh.kind === 'usb');
        const cm = new THREE.Mesh(geo, mats.board);
        cm.matrixAutoUpdate = false;
        const local = placeOnBoard(geo, board.box, usb?.box);
        cm.matrix.copy(board.box.m ? toMatrix(board.box.m).multiply(local) : local);
        eg.add(cm);
      }
      for (const gh of holder.ghosts) {
        if (board && (gh.kind === 'board' || gh.kind === 'usb')) continue;
        eg.add(boxAt(gh.box, gh.kind === 'board' ? mats.board : mats.usb));
      }
      g.add(eg);
    }
    if (extrasPart) {
      // włącznik, gniazdo i bateria leżą na dnie: rysowane razem z nim
      const eg = new THREE.Group();
      eg.position.z = bt ? -explode : 0;
      const matOf = (k: DactylController['ghosts'][number]['kind']) =>
        k === 'knob' ? mats.knob : k === 'pcb' ? mats.pcb : k === 'battery' ? mats.battery : k === 'usb' ? mats.usb : mats.part;
      for (const gh of extrasPart.ghosts) eg.add(boxAt(gh.box, matOf(gh.kind)));
      g.add(eg);
    }
    if (showCaps) {
      const hit = new Set(caps.flat());
      for (const key of m.keys) {
        const mx = toMatrix(key.frame);
        const sw = switchGeo
          ? new THREE.Mesh(switchGeo, mats.sw)
          : boxAt({ x0: -7.8, y0: -7.8, z0: 0, x1: 7.8, y1: 7.8, z1: CAP.z0 - 0.4 }, mats.sw);
        sw.matrixAutoUpdate = false;
        sw.matrix.copy(mx);
        g.add(sw);
        const real = capMeshes[capType(capSize(m, key), 'none').id];
        if (real) {
          const rg = new THREE.BufferGeometry();
          rg.setAttribute('position', new THREE.BufferAttribute(real.vertices, 3));
          rg.setAttribute('normal', new THREE.BufferAttribute(real.normals, 3));
          rg.setIndex(new THREE.BufferAttribute(real.triangles, 1));
          const look = looks?.[`${side}:${key.id}`];
          const rm = new THREE.Mesh(rg, hit.has(key.id) ? mats.capHit : look ? tintMat(look.cap) : mats.cap);
          rm.matrixAutoUpdate = false;
          rm.matrix.copy(mx);
          rm.userData.ref = `${side}:${key.id}`;
          g.add(rm);
          addLegend(g, side, key.id, mx, meshTop(rg), rg);
          if (pickedKey === `${side}:${key.id}` && (tab === 'keycaps' || tab === 'colors')) addHighlight(g, rg, mx);
          continue;
        }
        const wide = m.params.widePinky && key.col === m.params.cols - 1 && key.row !== m.params.rows - 1;
        const tall = key.thumb === 'tl' || key.thumb === 'tr';
        const w = CAP.size + (wide ? 9.525 : 0), h = CAP.size + (tall ? 9.525 : 0);
        const cg = new THREE.BoxGeometry(w, h, CAP.z1 - CAP.z0);
        // zwężenie ku górze
        const pa = cg.getAttribute('position');
        for (let i = 0; i < pa.count; i++)
          if (pa.getZ(i) > 0) {
            pa.setX(i, pa.getX(i) * ((w - (CAP.size - CAP.top)) / w));
            pa.setY(i, pa.getY(i) * ((h - (CAP.size - CAP.top)) / h));
          }
        cg.translate(0, 0, (CAP.z0 + CAP.z1) / 2);
        cg.computeVertexNormals();
        const look = looks?.[`${side}:${key.id}`];
        const cm = new THREE.Mesh(cg, hit.has(key.id) ? mats.capHit : look ? tintMat(look.cap) : mats.cap);
        cm.matrixAutoUpdate = false;
        cm.matrix.copy(mx);
        cm.userData.ref = `${side}:${key.id}`;
        g.add(cm);
        addLegend(g, side, key.id, mx, { w: w - (CAP.size - CAP.top), h: h - (CAP.size - CAP.top), z: CAP.z1 }, cg);
        if (pickedKey === `${side}:${key.id}` && (tab === 'keycaps' || tab === 'colors')) addHighlight(g, cg, mx);
      }
    }
    return g;
  }

  /** legenda na wierzchu nakładki; w lewej (lustrzanej) połówce napis odbity z powrotem */
  function addLegend(g: THREE.Group, side: 'left' | 'right', id: string, mx: THREE.Matrix4, top: { w: number; h: number; z: number }, cap?: THREE.BufferGeometry) {
    const ref = `${side}:${id}`;
    const items = labels?.[ref];
    if (!items?.length) return;
    const lc = (colors.on && looks?.[ref]?.legend) || '#3a3f46';
    const lm = legendPlane(legendTex, items, lc, top.w, top.h);
    lm.position.z = top.z + 0.04;
    if (side === 'left') lm.scale.x = -1;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(mx);
    holder.add(lm);
    // Fn na przedniej ściance
    const fm = cap ? legendFront(legendTex, items, lc, cap) : null;
    if (fm) {
      if (side === 'left') fm.scale.x = -1;
      holder.add(fm);
    }
    g.add(holder);
  }

  const selMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.35, depthWrite: false });
  const selEdgeMat = new THREE.LineBasicMaterial({ color: 0xff8a00 });
  /** wybrany klawisz: półprzezroczysta poświata na nakładce i obrys */
  function addHighlight(g: THREE.Group, geo: THREE.BufferGeometry, mx: THREE.Matrix4) {
    const hl = new THREE.Group();
    hl.matrixAutoUpdate = false;
    hl.matrix.copy(mx);
    const hm = new THREE.Mesh(geo, selMat);
    hm.scale.setScalar(1.03);
    hl.add(hm);
    hl.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 40), selEdgeMat));
    g.add(hl);
  }
  let faceReady = $state(false);
  void loadLegendFace().then(() => {
    legendTex.forEach((t) => t.dispose());
    legendTex.clear();
    faceReady = true;
  });

  function rebuild() {
    if (!scene) return;
    scene.remove(group);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { if (o.geometry !== switchGeo) o.geometry.dispose(); }
    });
    group = new THREE.Group();
    const m = model;
    if (m && size) {
      const sides = show === 'both' ? (['left', 'right'] as const) : [show];
      // model liczony jest dla prawej połówki; lewa to lustro w X
      const minX = Math.min(...m.hulls.flat().map((q) => q[0]));
      for (const s of sides) {
        const hg = halfGroup(m, s);
        if (s === 'left') {
          hg.scale.x = -1;
          if (sides.length === 2) hg.position.x = 2 * minX - 30;
        }
        group.add(hg);
      }
    }
    scene.add(group);
    disposeGlow(glow);
    scene.remove(glow);
    glow = colors.on && colors.glow.on ? glowGroup(group, colors.glow) : new THREE.Group();
    scene.add(glow);
    applyColors();
    if (!framed && m) {
      frame();
      framed = true;
    }
  }

  function frame(fromBelow = false) {
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const fov = (camera.fov * Math.PI) / 180;
    const dist = (Math.max(sz.y, sz.x / camera.aspect) / (2 * Math.tan(fov / 2))) * 1.3;
    controls.target.copy(c);
    if (fromBelow) camera.position.set(c.x, c.y - dist * 0.45, c.z - dist * 0.9);
    else camera.position.set(c.x, c.y - dist * 0.7, c.z + dist * 0.7);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.update();
  }

  $effect(() => {
    void model;
    void exact.shell;
    void exact.bottom;
    void show;
    void showCaps;
    void capMeshes;
    void switchGeo;
    void explode;
    void holder;
    void ctrlGeo;
    void caps;
    void looks;
    void labels;
    void pickedKey;
    void tab;
    void faceReady;
    void colors.on;
    void colors.glow.on;
    void colors.glow.mode;
    void colors.glow.color;
    void colors.glow.strength;
    rebuild();
  });

  function applyTheme() {
    if (!scene) return;
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    (scene.background as THREE.Color).set(tok('--scene', '#e9edf1'));
    mats.shell.color.set(tok('--plate', '#dfe3e8'));
    mats.quick.color.set(tok('--plate', '#dfe3e8'));
    mats.bottom.color.set(tok('--case', '#3f4b58'));
    mats.edge.color.set(tok('--plate-edge', '#5b6875'));
    applyColors();
  }

  /** kolory podglądu: skorupa = „obudowa”, dno = „płyta”, tło */
  function applyColors() {
    if (!scene || !colors.on) return;
    if (colors.background) (scene.background as THREE.Color).set(colors.background);
    mats.shell.color.set(colors.case);
    mats.quick.color.set(colors.case);
    mats.bottom.color.set(colors.plate);
  }
  let wasOn = false;
  $effect(() => {
    void colors.background;
    void colors.case;
    void colors.plate;
    if (wasOn && !colors.on) applyTheme();
    else if (colors.on) {
      if (!colors.background && scene) {
        const css = getComputedStyle(document.documentElement);
        (scene.background as THREE.Color).set(css.getPropertyValue('--scene').trim() || '#e9edf1');
      }
      applyColors();
    }
    wasOn = colors.on;
  });

  onMount(() => {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color();
    camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(-150, -200, 300);
    scene.add(dir);
    applyTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    // wybór klawisza kliknięciem (bez przeciągania widoku)
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!(tab === 'keycaps' || tab === 'colors') || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const caps: THREE.Object3D[] = [];
      group.traverse((o) => {
        if (o.userData.ref) caps.push(o);
      });
      const hit = ray.intersectObjects(caps, false)[0];
      if (hit) pickedKey = hit.object.userData.ref as string;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    rebuild();
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    status = t(lang, 'loadingCad');
    fetch(`${import.meta.env.BASE_URL}cells/mx-hotswap.step`)
      .then((r) => r.arrayBuffer())
      .then((b) => (cellStep = b));
    client
      .init()
      .then(() => (status = ''))
      .catch((e) => (error = String(e)));
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      for (const tx of legendTex.values()) tx.dispose();
      media.removeEventListener('change', applyTheme);
      mo.disconnect();
      renderer.dispose();
    };
  });

  const ctrlIds = Object.keys(CONTROLLERS) as ControllerId[];
  const list = (pairs: [string, string][]) => pairs.map((q) => q.join('/')).join(', ');
  const bed = DEFAULT_PRINT;
  const fits = $derived(size ? size.x <= bed.bedX && size.y <= bed.bedY : true);
  void apply;
</script>

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
      <ProjectBar {lang} name={`dactyl-${p.rows}x${p.cols}`} get={dactylProject} onLoad={onProject} />
    </section>

    <Tabs tabs={PANEL_TABS.map((id) => ({ id, label: t(lang, `tab_${id}` as const) }))} bind:value={tab} />

    {#if tab === 'keyboard'}
    <section>
      <h2>{t(lang, 'template')}</h2>
      <select value="dactyl" onchange={(e) => onTemplate(e.currentTarget.value)} aria-label={t(lang, 'template')}>
        {#each TEMPLATES as tpl (tpl.id)}
          <option value={tpl.id}>{tpl.name[lang]}</option>
        {/each}
        <option value="dactyl">{tx('kind')}</option>
      </select>
      <p class="muted">{model ? model.keys.length * (show === 'both' ? 2 : 1) : 0} {t(lang, 'keys')} · {tx('credit')}</p>
    </section>

    <section>
      <h2>{t(lang, 'cell')}</h2>
      <label data-tip={t(lang, 'tipVariant')}>
        {t(lang, 'variant')}
        <select bind:value={variant}>
          <option value="hotswap">{t(lang, 'hotswap')}</option>
          <option value="no-hotswap">{t(lang, 'noHotswap')}</option>
        </select>
      </label>
    </section>

    <section>
      <h2>{t(lang, 'layout')}</h2>
      <div class="grid2">
        <label data-tip={t(lang, 'tipRows')}>{t(lang, 'rows')} <input type="number" min="3" max="6" bind:value={p.rows} /></label>
        <label data-tip={t(lang, 'tipCols')}>{t(lang, 'cols')} <input type="number" min="5" max="7" bind:value={p.cols} /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={p.widePinky} /> {tx('widePinky')}</label>
    </section>

    <section>
      <h2>{tx('curve')}</h2>
      <div class="grid2">
        <label data-tip={tx('tipCurve')}>{tx('alpha')} <input type="number" min="0" max="30" step="1" bind:value={p.alpha} /></label>
        <label data-tip={tx('tipCurve')}>{tx('pinkyAlpha')} <input type="number" min="0" max="30" step="1" bind:value={p.pinkyAlpha} /></label>
        <label data-tip={tx('tipCurve')}>{tx('beta')} <input type="number" min="0" max="15" step="1" bind:value={p.beta} /></label>
        <label data-tip={tx('tipTent')}>{tx('tent')} <input type="number" min="0" max="45" step="1" bind:value={p.tent} /></label>
        <label>{tx('height')} <input type="number" min="0" max="40" step="1" bind:value={p.zOffset} /></label>
        <label>{tx('wall')} <input type="number" min="2" max="5" step="0.5" bind:value={p.wallThickness} /></label>
        <label data-tip={tx('tipChamfer')}>{tx('chamfer')} <input type="number" min="0" max="2" step="0.5" bind:value={chamfer} /></label>
      </div>
      <span class="label" data-tip={tx('tipThumb')}>{tx('thumbShift')}</span>
      <div class="grid3">
        <input type="number" step="1" bind:value={p.thumbOffset[0]} aria-label="X" />
        <input type="number" step="1" bind:value={p.thumbOffset[1]} aria-label="Y" />
        <input type="number" step="1" bind:value={p.thumbOffset[2]} aria-label="Z" />
      </div>
      <span class="label" data-tip={tx('tipStagger')}>{tx('stagger')}</span>
      <div class="grid3 stagger">
        {#each [['index', 'fIndex'], ['middle', 'fMiddle'], ['ring', 'fRing'], ['pinky', 'fPinky']] as const as [f, lbl] (f)}
          <span>{tx(lbl)}</span>
          <input type="number" min="-25" max="25" step="0.5" bind:value={p.stagger[f][0]} aria-label="{tx(lbl)} Y" />
          <input type="number" min="-25" max="25" step="0.5" bind:value={p.stagger[f][1]} aria-label="{tx(lbl)} Z" />
        {/each}
      </div>
      <label data-tip={tx('tipShell')}>{tx('shellKind')}
        <select bind:value={shellKind}>
          <option value="organic">{tx('shellOrganic')}</option>
          <option value="blanket">{tx('shellBlanket')}</option>
          <option value="hulls">{tx('shellHulls')}</option>
        </select>
      </label>
      {#if shellKind === 'organic'}
        <label data-tip={tx('tipPattern')}>{tx('pattern')}
          <select bind:value={organic.pattern}>
            <option value="none">{tx('patNone')}</option>
            <option value="relief">{tx('patRelief')}</option>
            <option value="holes">{tx('patHoles')}</option>
          </select>
        </label>
        {#if organic.pattern !== 'none'}
          <div class="grid2">
            <label>{tx('patCell')}<input type="number" min="6" max="30" step="1" bind:value={organic.patternCell} /></label>
            <label data-tip={tx('tipRib')}>{tx('patRib')}<input type="number" min="1.2" max="6" step="0.2" bind:value={organic.patternRib} /></label>
            {#if organic.pattern === 'relief'}
              <label>{tx('patDepth')}<input type="number" min="0.4" max="2" step="0.2" bind:value={organic.patternDepth} /></label>
            {/if}
          </div>
        {/if}
      {/if}
      {#if shellKind === 'hulls'}
        <label class="check" data-tip={tx('tipSlotCover')}><input type="checkbox" bind:checked={slotCover} /> {tx('slotCover')}</label>
        <label>{tx('smooth')}
          <select bind:value={p.wallSmooth}>
            <option value="off">{tx('smoothOff')}</option>
            <option value="corners">{tx('smoothCorners')}</option>
            <option value="smooth">{tx('smoothFull')}</option>
          </select>
        </label>
      {/if}
      {#if caps.length}<p class="warn">{tx('capHit').replace('{l}', list(caps))}</p>{/if}
      {#if cells.length}<p class="warn">{tx('cellHit').replace('{l}', list(cells))}</p>{/if}
      {#if !model}<p class="warn">{t(lang, 'error')}</p>{/if}
    </section>

    <section>
      <h2>{t(lang, 'electronics')}</h2>
      <label class="check" data-tip={tx('tipCtrl')}><input type="checkbox" bind:checked={ctrlOn} /> {tx('controller')}</label>
      {#if ctrlOn}
        <div class="grid2">
          <label>
            {t(lang, 'controller')}
            <select bind:value={ctrl.controller}>
              {#each ctrlIds as id (id)}
                <option value={id}>{CONTROLLERS[id].name}</option>
              {/each}
            </select>
          </label>
          <label>{tx('ctrlCol')} <input type="number" min="0" max={p.cols - 1} step="0.25" bind:value={ctrl.col} /></label>
        </div>
      {/if}
    </section>

    <section>
      <h2>{t(lang, 'extras')}</h2>
      <label class="check" data-tip={t(lang, 'tipPower')}><input type="checkbox" bind:checked={extras.power.on} /> {t(lang, 'power')}</label>
      {#if extras.power.on}
        <div class="grid2">
          <label data-tip={t(lang, 'tipWallSide')}>{t(lang, 'wallSide')}
            <select bind:value={extras.power.side}>{#each WALLS as w (w)}<option value={w}>{wallName(w)}</option>{/each}</select>
          </label>
          <label data-tip={t(lang, 'tipWallPos')}>{t(lang, 'wallPos')} <input type="range" min="0" max="100" step="5" bind:value={extras.power.pos} /></label>
        </div>
      {/if}
      <label class="check" data-tip={t(lang, 'tipLink')}><input type="checkbox" bind:checked={extras.link.on} /> {t(lang, 'link')}</label>
      {#if extras.link.on}
        <div class="grid2">
          <label data-tip={t(lang, 'tipLink')}>{t(lang, 'linkKind')}
            <select bind:value={extras.link.kind}>
              <option value="trrs">{t(lang, 'linkTrrs')}</option>
              <option value="usbc">{t(lang, 'linkUsbc')}</option>
            </select>
          </label>
          <label data-tip={t(lang, 'tipWallSide')}>{t(lang, 'wallSide')}
            <select bind:value={extras.link.side}>{#each WALLS as w (w)}<option value={w}>{wallName(w)}</option>{/each}</select>
          </label>
          <label data-tip={t(lang, 'tipWallPos')}>{t(lang, 'wallPos')} <input type="range" min="0" max="100" step="5" bind:value={extras.link.pos} /></label>
        </div>
      {/if}
      <label class="check" data-tip={t(lang, 'tipBatteryDactyl')}><input type="checkbox" bind:checked={extras.battery.on} /> {t(lang, 'battery')}</label>
      {#if extras.battery.on}
        <div class="grid2">
          <label data-tip={t(lang, 'tipBatteryDactyl')}>{t(lang, 'batteryPreset')}
            <select value={BATTERY_PRESETS.find((b) => b.l === extras.battery.l && b.w === extras.battery.w && b.t === extras.battery.t)?.id ?? ''}
              onchange={(e) => { const b = BATTERY_PRESETS.find((x) => x.id === e.currentTarget.value); if (b) Object.assign(extras.battery, { l: b.l, w: b.w, t: b.t }); }}>
              {#each BATTERY_PRESETS as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
              <option value="">{t(lang, 'batteryCustom')}</option>
            </select>
          </label>
          <label>{t(lang, 'batteryL')} <input type="number" min="10" max="120" step="0.5" bind:value={extras.battery.l} /></label>
          <label>{t(lang, 'batteryW')} <input type="number" min="5" max="80" step="0.5" bind:value={extras.battery.w} /></label>
          <label>{t(lang, 'batteryT')} <input type="number" min="1" max="12" step="0.1" bind:value={extras.battery.t} /></label>
        </div>
      {/if}
      {#each extrasPart?.warns ?? [] as w, i (i)}
        <p class={w.kind === 'noSpot' || w.kind === 'tooTall' ? 'warn' : 'muted'}>{extraWarnText(w)}</p>
      {/each}
    </section>

    <section>
      <h2>{t(lang, 'caseBottom')}</h2>
      <div class="grid2">
        <label>{tx('floor')} <input type="number" min="2" max="6" step="0.5" bind:value={floor} /></label>
        <label>{t(lang, 'screwSize')}
          <select bind:value={screwSize}>
            <option value="M3">M3</option>
            <option value="M2.5">{lang === 'pl' ? 'M2,5' : 'M2.5'}</option>
          </select>
        </label>
        <label>{tx('explode')} <input type="number" min="0" max="80" step="5" bind:value={explode} /></label>
      </div>
      <p class="muted">{lang === 'pl' ? screwSize.replace('.', ',') : screwSize} × 8–10, 5 ×</p>
      {#if headOut > 0.05}<p class="warn">{t(lang, 'dactylHeadOut').replace('{h}', headOut.toFixed(1).replace('.', lang === 'pl' ? ',' : '.')).replace('{f}', String(headFloor).replace('.', lang === 'pl' ? ',' : '.'))}</p>{/if}
    </section>

    <section>
      <h2>{t(lang, 'export')}</h2>
      <div class="grid2">
        <label>
          {tx('side')}
          <select bind:value={show}>
            <option value="both">{tx('both')}</option>
            <option value="left">{t(lang, 'left')}</option>
            <option value="right">{t(lang, 'right')}</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={showCaps} /> {tx('showCaps')}</label>
      </div>
      {#if size}
        <p class={fits ? 'muted' : 'warn'}>
          {tx('size').replace('{x}', String(Math.round(size.x))).replace('{y}', String(Math.round(size.y))).replace('{z}', String(Math.round(size.z)))}
          {(fits ? tx('bed') : tx('bedNo')).replace('{bed}', `${bed.bedX} × ${bed.bedY}`)}
        </p>
      {/if}
      {#if model && model.lift > 0.05}<p class="muted">{tx('lift').replace('{v}', model.lift.toFixed(1))}</p>{/if}
      {#each show === 'both' ? (['left', 'right'] as const) : [show] as s (s)}
        {#each ['shell', 'bottom'] as const as part (part)}
          <div class="row">
            <span class="side">{tx(part)}: {t(lang, s).toLowerCase()}</span>
            <button onclick={() => exportPart(part, s, 'stl')} disabled={!cellStep} data-tip={t(lang, 'tipStl')}>STL</button>
            <button onclick={() => exportPart(part, s, 'step')} disabled={!cellStep || (part === 'shell' && meshShell)} data-tip={part === 'shell' && meshShell ? tx('blanketStl') : t(lang, 'tipStep')}>STEP</button>
          </div>
        {/each}
      {/each}
      <p class="muted">{tx('slow')}</p>
    </section>
    {/if}

    {#if model}
      {@const m = model}
      {#if tab === 'keycaps'}
      <KeycapPanel
        {lang}
        keys={[...m.keys, ...m.keys].map((k) => capSize(m, k))}
        refs={[...m.keys.map((k) => legendRef('left', k.id)), ...m.keys.map((k) => legendRef('right', k.id))]}
        stabs="none"
        client={() => client}
        fileBase={`dactyl-${p.rows}x${p.cols}`}
        save={saveFile}
        bind:params={keycap}
        bind:show={showCaps}
        bind:meshes={capMeshes}
        bed={[bed.bedX, bed.bedY]}
      />
      <LegendPanel
        {lang}
        keys={[...m.keys, ...m.keys].map((k) => capSize(m, k))}
        refs={[...m.keys.map((k) => legendRef('left', k.id)), ...m.keys.map((k) => legendRef('right', k.id))]}
        bind:params={keycap}
        bind:labels={capLabels}
        bind:selected={pickedKey}
        defaults={defaultSets}
      />
      {:else if tab === 'colors'}
      <ColorPanel
        {lang}
        kind="dactyl"
        bind:colors
        bind:selected={pickedKey}
        {keyInfo}
        capsShown={showCaps}
        showCaps={() => (showCaps = true)}
      />
      {:else if tab === 'wiring'}
      <WiringPanel {lang} input={() => dactylWiringInput({ model: m, controller: ctrlOn ? ctrl.controller : null, hotswap: variant === 'hotswap', lang })} fileBase={`dactyl-${p.rows}x${p.cols}`} save={saveFile} />
      {/if}
    {/if}

    <footer class="muted">
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">{t(lang, 'license')}</a>
      · <a href="https://github.com/NuernGH/Keyboard-maker" target="_blank" rel="noreferrer">{t(lang, 'source')}</a>
      · <a href="https://github.com/rianadon/dactyl-configurator" target="_blank" rel="noreferrer">Dactyl Configurator</a>
    </footer>
  </aside>

  <main>
    <div class="preview" bind:this={host}></div>
    <div class="hud">
      <span class="badge" class:exact={!busy && !!exact.shell}>
        {#if busy && exact.shell?.approx}{t(lang, 'computingExact')}{:else if busy}{t(lang, 'computing')}{:else if exact.shell}{t(lang, 'exact')}{#if lastMs}&nbsp;· {Math.round(lastMs / 1000)} s{/if}{:else}{t(lang, 'quick')}{/if}
      </span>
      {#if status}<span class="badge">{status}</span>{/if}
      {#if error}<span class="badge err">{t(lang, 'error')}: {error}</span>{/if}
      <button onclick={() => frame()} data-tip={t(lang, 'tipResetView')}>{t(lang, 'resetView')}</button>
      <button onclick={() => frame(true)} data-tip={t(lang, 'tipBottomView')}>{t(lang, 'bottomView')}</button>
    </div>
  </main>
</div>

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
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  header select {
    width: auto;
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
  .grid3.stagger {
    grid-template-columns: auto 1fr 1fr;
    align-items: center;
    margin-bottom: 8px;
    font-size: 13px;
  }
  .grid3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
    margin: 2px 0 6px;
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
    box-sizing: border-box;
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .side {
    width: 120px;
    font-size: 13px;
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
  .preview {
    position: absolute;
    inset: 0;
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
</style>
