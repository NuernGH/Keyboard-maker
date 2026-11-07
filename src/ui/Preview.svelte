<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { PITCH, switchOffsets, switchSpots, type Key } from '../lib/layout';
  import type { IslandGeom, GhostPart } from '../lib/island';
  import { loadControllerModel, placeOnBoard } from './controllerModel';
  import { capType } from '../lib/keycap-spec';
  import type { PreviewColors, KeyLook } from '../lib/colors';
  import type { PlacedLegend } from '../lib/legend';
  import { disposeGlow, glowGroup, legendPlane, loadLegendFace, meshTop } from './previewDecor';

  export interface PreviewMesh {
    vertices: Float32Array;
    normals: Float32Array;
    triangles: Uint32Array;
  }
  export interface PreviewHalf {
    /** strona (klucze kolorów i legend to `strona:id`); domyślnie lewa */
    side?: 'left' | 'right';
    keys: Key[];
    offsetX: number;
    /** dokładna bryła z CAD; gdy brak lub nieaktualna, pokazujemy szybki podgląd komórek */
    mesh: PreviewMesh | null;
    island?: IslandGeom | null;
    showElectronics?: boolean;
    /** klin pod moduł OLED (osobna część), rysowany wyżej o połowę `explode` */
    wedgeMesh?: PreviewMesh | null;
    /** spód obudowy (dokładna bryła), rysowany niżej o `explode` mm */
    caseMesh?: PreviewMesh | null;
    caseOn?: boolean;
    explode?: number;
  }

  let {
    halves,
    cellHeight,
    holeSize = 14,
    stabs = 'cherry',
    switchMesh = null,
    capMeshes = null,
    colors = null,
    looks = null,
    labels = null,
    pickKey = null,
    selected = null,
  }: {
    halves: PreviewHalf[];
    cellHeight: number;
    holeSize?: number;
    stabs?: 'cherry' | 'mx' | 'none';
    /** przełącznik ustawiony jak komórka (wierzch płyty z = 0); null = bez przełączników */
    switchMesh?: PreviewMesh | null;
    /** nakładki w spoczynku (układ klawisza) wg typu (capType().id); null = bez nakładek */
    capMeshes?: Record<string, PreviewMesh> | null;
    /** kolory podglądu; null albo `on: false` = jak dotąd (kolory z motywu strony) */
    colors?: PreviewColors | null;
    /** kolor nakładki i legendy każdego klawisza (`strona:id`) */
    looks?: Record<string, KeyLook> | null;
    /** legendy na wierzchu nakładek (`strona:id`), jak z legendLayout (mm od środka wierzchu) */
    labels?: Record<string, PlacedLegend[]> | null;
    /** kliknięcie nakładki w podglądzie (wybór klawisza); null = wyłączone */
    pickKey?: ((ref: string) => void) | null;
    /** wybrany klawisz (`strona:id`): podświetlony w podglądzie */
    selected?: string | null;
  } = $props();
  const colorsOn = $derived(!!colors?.on);

  let host: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let group = new THREE.Group();
  let framed = false;
  let grid: THREE.GridHelper | undefined;
  let fromBelowView = false;

  // Kolory sceny pochodzą z tokenów CSS (app.css), więc nadążają za jasnym/ciemnym motywem.
  const wedgeMat = new THREE.MeshStandardMaterial({ color: 0x8fa9bf, metalness: 0.05, roughness: 0.6 });
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x3f4b58, metalness: 0.05, roughness: 0.75 });
  const exactMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.05, roughness: 0.55 });
  const plateEdgeMat = new THREE.LineBasicMaterial({ color: 0x5b6875, transparent: true, opacity: 0.55 });
  const caseEdgeMat = new THREE.LineBasicMaterial({ color: 0x1b232b, transparent: true, opacity: 0.6 });
  const quickMat = new THREE.MeshStandardMaterial({
    color: 0xdfe3e8,
    metalness: 0,
    roughness: 0.9,
    transparent: true,
    opacity: 0.85,
  });

  const switchMat = new THREE.MeshStandardMaterial({ color: 0x3b4148, metalness: 0.05, roughness: 0.5 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, metalness: 0, roughness: 0.6 });
  /** nakładki z kolorem na instancję (kolory podglądu) */
  const capTintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.55 });
  /** podświetlenie pod obudową (osobna grupa, przebudowywana razem z podglądem) */
  let glow = new THREE.Group();
  const legendTex = new Map<string, THREE.CanvasTexture>();
  const selMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.35, depthWrite: false });
  const selEdgeMat = new THREE.LineBasicMaterial({ color: 0xff8a00 });
  // po wczytaniu czcionki legend rysujemy je od nowa (wcześniej tekstury miały czcionkę zastępczą)
  let faceReady = $state(false);
  void loadLegendFace().then(() => {
    legendTex.forEach((t) => t.dispose());
    legendTex.clear();
    faceReady = true;
  });

  const ghostMats: Record<GhostPart['kind'], THREE.Material> = {
    nano: new THREE.MeshStandardMaterial({ color: 0x2a6f97, roughness: 0.6 }),
    usb: new THREE.MeshStandardMaterial({ color: 0xc0c6ca, roughness: 0.3, metalness: 0.7 }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x3d7a4f, roughness: 0.7 }),
    display: new THREE.MeshStandardMaterial({ color: 0x10161a, roughness: 0.2, metalness: 0.2 }),
    encoder: new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.5, metalness: 0.4 }),
    knob: new THREE.MeshStandardMaterial({ color: 0xb5543c, roughness: 0.5 }),
  };

  function boxMesh(
    b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; tilt?: { deg: number; y: number; z: number } },
    mat: THREE.Material,
    round = false,
  ): THREE.Object3D {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const d = b.z1 - b.z0;
    let g: THREE.BufferGeometry;
    if (round) {
      g = new THREE.CylinderGeometry(w / 2, w / 2, d, 32);
      g.rotateX(Math.PI / 2);
    } else g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    if (!b.tilt) return m;
    // klin: obrót wokół osi X przez (y, z)
    const pivot = new THREE.Group();
    pivot.position.set(0, b.tilt.y, b.tilt.z);
    pivot.rotation.x = (b.tilt.deg * Math.PI) / 180;
    m.position.y -= b.tilt.y;
    m.position.z -= b.tilt.z;
    pivot.add(m);
    return pivot;
  }

  function cellGeometry(w: number, h: number, height: number, offsets: number[] = [0]): THREE.BufferGeometry {
    const W = w * PITCH;
    const H = h * PITCH;
    const s = new THREE.Shape();
    s.moveTo(-W / 2, -H / 2);
    s.lineTo(W / 2, -H / 2);
    s.lineTo(W / 2, H / 2);
    s.lineTo(-W / 2, H / 2);
    s.closePath();
    const q = holeSize / 2;
    for (const d of offsets) {
      const [ox, oy] = h > w ? [0, d] : [d, 0];
      const hole = new THREE.Path();
      hole.moveTo(ox - q, oy - q);
      hole.lineTo(ox - q, oy + q);
      hole.lineTo(ox + q, oy + q);
      hole.lineTo(ox + q, oy - q);
      hole.closePath();
      s.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false });
    g.translate(0, 0, -height);
    return g;
  }

  function rebuild() {
    if (!scene) return;
    scene.remove(group);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    group = new THREE.Group();
    const geoCache = new Map<string, THREE.BufferGeometry>();
    for (const half of halves) {
      const hg = new THREE.Group();
      hg.position.x = half.offsetX;
      // klin i elektronika na nim podniesione o połowę rozsunięcia obudowy, żeby było widać, że to osobna część
      const lift = half.wedgeMesh ? (half.explode ?? 0) / 2 : 0;
      if (half.island && half.showElectronics !== false) {
        // podnosimy tylko moduł na klinie (pochylone elementy); kontroler i USB zostają w wyspie
        // kontroler z modelem (np. nice!nano): model zamiast pudełek płytki i gniazda USB
        const board = half.island.ghosts.find((g) => g.kind === 'nano' && g.model && ctrlGeo.get(g.model));
        if (board) {
          const geo = ctrlGeo.get(board.model!)!;
          const usb = half.island.ghosts.find((g) => g.kind === 'usb');
          const cm = new THREE.Mesh(geo, ghostMats.nano);
          cm.matrixAutoUpdate = false;
          cm.matrix.copy(placeOnBoard(geo, board.box, usb?.box, board.flip));
          hg.add(cm);
        }
        for (const gp of half.island.ghosts) {
          if (board && (gp.kind === 'nano' || gp.kind === 'usb')) continue;
          const o = boxMesh(gp.box, ghostMats[gp.kind], gp.kind === 'knob');
          if (gp.box.tilt) o.position.z += lift;
          hg.add(o);
        }
      }
      if (half.wedgeMesh) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.BufferAttribute(half.wedgeMesh.vertices, 3));
        wg.setAttribute('normal', new THREE.BufferAttribute(half.wedgeMesh.normals, 3));
        wg.setIndex(new THREE.BufferAttribute(half.wedgeMesh.triangles, 1));
        const wm = new THREE.Mesh(wg, wedgeMat);
        wm.position.z = lift;
        hg.add(wm);
        const we = new THREE.LineSegments(new THREE.EdgesGeometry(wg, 30), caseEdgeMat);
        we.position.z = lift;
        hg.add(we);
      }
      if (!half.mesh && half.island) {
        const r = half.island.rect;
        hg.add(boxMesh({ x0: r.x0, y0: r.y0, z0: -half.island.depth, x1: r.x1, y1: r.y1, z1: -0.01 }, quickMat));
      }
      if (half.caseOn && half.caseMesh) {
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.BufferAttribute(half.caseMesh.vertices, 3));
        cg.setAttribute('normal', new THREE.BufferAttribute(half.caseMesh.normals, 3));
        cg.setIndex(new THREE.BufferAttribute(half.caseMesh.triangles, 1));
        const cm = new THREE.Mesh(cg, caseMat);
        cm.position.z = -(half.explode ?? 0);
        hg.add(cm);
        const ce = new THREE.LineSegments(new THREE.EdgesGeometry(cg, 30), caseEdgeMat);
        ce.position.z = cm.position.z;
        hg.add(ce);
      }
      if (switchMesh) {
        const spots = half.keys.flatMap((k) => switchSpots(k, stabs).map(([x, y]) => [x, y, k.rot] as const));
        if (spots.length) {
          const sg = new THREE.BufferGeometry();
          sg.setAttribute('position', new THREE.BufferAttribute(switchMesh.vertices, 3));
          sg.setAttribute('normal', new THREE.BufferAttribute(switchMesh.normals, 3));
          sg.setIndex(new THREE.BufferAttribute(switchMesh.triangles, 1));
          const im = new THREE.InstancedMesh(sg, switchMat, spots.length);
          const m4 = new THREE.Matrix4();
          spots.forEach(([x, y, rot], i) => im.setMatrixAt(i, m4.makeRotationZ((rot * Math.PI) / 180).setPosition(x, y, 0)));
          hg.add(im);
        }
      }
      if (capMeshes) {
        // jedna siatka na typ nakładki, instancje w pozycjach klawiszy
        const byType = new Map<string, Key[]>();
        for (const k of half.keys) {
          const id = capType(k, stabs).id;
          if (!capMeshes[id]) continue;
          byType.set(id, [...(byType.get(id) ?? []), k]);
        }
        for (const [id, ks] of byType) {
          const cm = capMeshes[id];
          let g = geoCache.get('cap:' + id);
          if (!g) {
            g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(cm.vertices, 3));
            g.setAttribute('normal', new THREE.BufferAttribute(cm.normals, 3));
            g.setIndex(new THREE.BufferAttribute(cm.triangles, 1));
            geoCache.set('cap:' + id, g);
          }
          const tint = colorsOn && looks;
          const im = new THREE.InstancedMesh(g, tint ? capTintMat : capMat, ks.length);
          const m4 = new THREE.Matrix4();
          const side = half.side ?? 'left';
          const col = new THREE.Color();
          ks.forEach((k, i) => {
            im.setMatrixAt(i, m4.makeRotationZ((k.rot * Math.PI) / 180).setPosition(k.x, k.y, 0));
            if (tint) im.setColorAt(i, col.set(looks[`${side}:${k.id}`]?.cap ?? '#e9e4d8'));
          });
          im.userData.refs = ks.map((k) => `${side}:${k.id}`);
          hg.add(im);
          const sk = selected ? ks.find((k) => `${side}:${k.id}` === selected) : undefined;
          if (sk) {
            // wybrany klawisz: półprzezroczysta poświata na nakładce i obrys
            const hl = new THREE.Group();
            hl.position.set(sk.x, sk.y, 0);
            hl.rotation.z = (sk.rot * Math.PI) / 180;
            const hm = new THREE.Mesh(g, selMat);
            hm.scale.setScalar(1.03);
            hl.add(hm);
            hl.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 40), selEdgeMat));
            hl.userData.highlight = true;
            hg.add(hl);
          }
          if (labels) {
            const top = meshTop(g);
            for (const k of ks) {
              const ref = `${side}:${k.id}`;
              const items = labels[ref];
              if (!items?.length) continue;
              const lm = legendPlane(legendTex, items, (colorsOn && looks?.[ref]?.legend) || '#3a3f46', top.w, top.h);
              lm.position.set(0, 0, top.z + 0.04);
              const holder = new THREE.Group();
              holder.position.set(k.x, k.y, 0);
              holder.rotation.z = (k.rot * Math.PI) / 180;
              holder.add(lm);
              hg.add(holder);
            }
          }
        }
      }
      if (half.mesh) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(half.mesh.vertices, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(half.mesh.normals, 3));
        g.setIndex(new THREE.BufferAttribute(half.mesh.triangles, 1));
        hg.add(new THREE.Mesh(g, exactMat));
        hg.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), plateEdgeMat));
      } else {
        for (const k of half.keys) {
          const offs = switchOffsets(k, stabs);
          const id = `${k.w}x${k.h}:${offs.join(',')}`;
          let g = geoCache.get(id);
          if (!g) {
            g = cellGeometry(k.w, k.h, cellHeight, offs);
            geoCache.set(id, g);
          }
          const m = new THREE.Mesh(g, quickMat);
          m.position.set(k.x, k.y, 0);
          m.rotation.z = (k.rot * Math.PI) / 180;
          hg.add(m);
        }
      }
      group.add(hg);
    }
    scene.add(group);
    buildGlow();
    // poświata zastępuje siatkę pod klawiaturą (siatka prześwitywałaby przez nią)
    if (grid) grid.visible = !(colorsOn && colors?.glow.on) && !fromBelowView;
    if (!framed && halves.some((h) => h.keys.length)) {
      frame();
      framed = true;
    }
  }

  /** podświetlenie RGB pod obudową (wspólne z Dactylem: previewDecor.ts) */
  function buildGlow() {
    disposeGlow(glow);
    scene.remove(glow);
    glow = colorsOn && colors?.glow.on ? glowGroup(group, colors.glow) : new THREE.Group();
    scene.add(glow);
  }

  function frame(fromBelow = false) {
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const fov = (camera.fov * Math.PI) / 180;
    const fit = Math.max(sz.y, sz.x / camera.aspect) / (2 * Math.tan(fov / 2));
    const dist = fit * 1.25;
    controls.target.copy(c);
    // widok z góry, lekko z przodu
    fromBelowView = fromBelow;
    if (grid) grid.visible = !fromBelow && !(colorsOn && colors?.glow.on);
    if (fromBelow) camera.position.set(c.x, c.y - dist * 0.45, c.z - dist * 0.9);
    else camera.position.set(c.x, c.y - dist * 0.45, c.z + dist * 0.9);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.update();
  }

  // modele kontrolerów wczytane do podglądu (ścieżka -> geometria)
  let ctrlGeo = $state(new Map<string, THREE.BufferGeometry>());
  $effect(() => {
    const paths = new Set(halves.flatMap((h) => h.island?.ghosts.map((g) => g.model).filter((m): m is string => !!m) ?? []));
    for (const path of paths)
      if (!ctrlGeo.has(path))
        void loadControllerModel(path).then((g) => {
          if (g && !ctrlGeo.has(path)) ctrlGeo = new Map(ctrlGeo).set(path, g);
        });
  });

  $effect(() => {
    // zależności: halves, cellHeight
    void ctrlGeo;
    void halves;
    void cellHeight;
    void stabs;
    void switchMesh;
    void capMeshes;
    void colors;
    void looks;
    void labels;
    void selected;
    void faceReady;
    applyColors();
    rebuild();
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
      if (!pickKey || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const caps: THREE.Object3D[] = [];
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh && o.userData.refs) caps.push(o);
      });
      const hit = ray.intersectObjects(caps, false)[0];
      const ref = hit && hit.instanceId !== undefined ? (hit.object.userData.refs as string[])[hit.instanceId] : null;
      if (ref) pickKey(ref);
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
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      for (const t of legendTex.values()) t.dispose();
      media.removeEventListener('change', applyTheme);
      mo.disconnect();
      renderer.dispose();
    };
  });

  function token(css: CSSStyleDeclaration, name: string, fallback: string) {
    return css.getPropertyValue(name).trim() || fallback;
  }

  function applyTheme() {
    if (!scene) return;
    const css = getComputedStyle(document.documentElement);
    (scene.background as THREE.Color).set(token(css, '--scene', '#e9edf1'));
    exactMat.color.set(token(css, '--plate', '#dfe3e8'));
    quickMat.color.set(token(css, '--plate', '#dfe3e8'));
    plateEdgeMat.color.set(token(css, '--plate-edge', '#5b6875'));
    caseMat.color.set(token(css, '--case', '#3f4b58'));
    caseEdgeMat.color.set(token(css, '--case-edge', '#1b232b'));
    wedgeMat.color.set(0x8fa9bf);
    applyColors();
    const visible = grid ? grid.visible : true;
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    grid = new THREE.GridHelper(600, 600 / PITCH, token(css, '--grid-major', '#cfd6dd'), token(css, '--grid-minor', '#dfe4e9'));
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -60;
    grid.visible = visible;
    scene.add(grid);
  }

  /** kolory podglądu nałożone na materiały (gdy wyłączone, zostają kolory motywu) */
  function applyColors() {
    if (!scene || !colorsOn || !colors) return;
    if (colors.background) (scene.background as THREE.Color).set(colors.background);
    exactMat.color.set(colors.plate);
    quickMat.color.set(colors.plate);
    caseMat.color.set(colors.case);
    wedgeMat.color.set(colors.wedge);
  }
  // wyłączenie kolorów: powrót do kolorów motywu
  let wasOn = false;
  $effect(() => {
    if (wasOn && !colorsOn) applyTheme();
    else if (colorsOn && colors && !colors.background && scene) {
      const css = getComputedStyle(document.documentElement);
      (scene.background as THREE.Color).set(token(css, '--scene', '#e9edf1'));
    }
    wasOn = colorsOn;
  });

  export function resetView() {
    frame();
  }
  /** Widok od spodu: widać dno obudowy, łby śrub i kieszeń kontrolera. */
  export function bottomView() {
    frame(true);
  }
</script>

<div class="preview" bind:this={host}></div>

<style>
  .preview {
    position: absolute;
    inset: 0;
  }
</style>
