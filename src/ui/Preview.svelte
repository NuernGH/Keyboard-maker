<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { PITCH, type Key } from '../lib/layout';
  import type { IslandGeom, GhostPart } from '../lib/island';

  export interface PreviewMesh {
    vertices: Float32Array;
    normals: Float32Array;
    triangles: Uint32Array;
  }
  export interface PreviewHalf {
    keys: Key[];
    offsetX: number;
    /** dokładna bryła z CAD; gdy brak lub nieaktualna, pokazujemy szybki podgląd komórek */
    mesh: PreviewMesh | null;
    island?: IslandGeom | null;
    showElectronics?: boolean;
    /** spód obudowy (dokładna bryła), rysowany niżej o `explode` mm */
    caseMesh?: PreviewMesh | null;
    caseOn?: boolean;
    explode?: number;
  }

  let { halves, cellHeight, holeSize = 14 }: { halves: PreviewHalf[]; cellHeight: number; holeSize?: number } =
    $props();

  let host: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let group = new THREE.Group();
  let framed = false;
  let grid: THREE.GridHelper | undefined;

  // Kolory sceny pochodzą z tokenów CSS (app.css), więc nadążają za jasnym/ciemnym motywem.
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

  const ghostMats: Record<GhostPart['kind'], THREE.Material> = {
    nano: new THREE.MeshStandardMaterial({ color: 0x2a6f97, roughness: 0.6 }),
    usb: new THREE.MeshStandardMaterial({ color: 0xc0c6ca, roughness: 0.3, metalness: 0.7 }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x3d7a4f, roughness: 0.7 }),
    display: new THREE.MeshStandardMaterial({ color: 0x10161a, roughness: 0.2, metalness: 0.2 }),
    encoder: new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.5, metalness: 0.4 }),
    knob: new THREE.MeshStandardMaterial({ color: 0xb5543c, roughness: 0.5 }),
  };

  function boxMesh(b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, mat: THREE.Material, round = false) {
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
    return m;
  }

  function cellGeometry(w: number, h: number, height: number): THREE.BufferGeometry {
    const W = w * PITCH;
    const H = h * PITCH;
    const s = new THREE.Shape();
    s.moveTo(-W / 2, -H / 2);
    s.lineTo(W / 2, -H / 2);
    s.lineTo(W / 2, H / 2);
    s.lineTo(-W / 2, H / 2);
    s.closePath();
    const hole = new THREE.Path();
    const q = holeSize / 2;
    hole.moveTo(-q, -q);
    hole.lineTo(-q, q);
    hole.lineTo(q, q);
    hole.lineTo(q, -q);
    hole.closePath();
    s.holes.push(hole);
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
      if (half.island && half.showElectronics !== false) {
        for (const gp of half.island.ghosts) hg.add(boxMesh(gp.box, ghostMats[gp.kind], gp.kind === 'knob'));
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
      if (half.mesh) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(half.mesh.vertices, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(half.mesh.normals, 3));
        g.setIndex(new THREE.BufferAttribute(half.mesh.triangles, 1));
        hg.add(new THREE.Mesh(g, exactMat));
        hg.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), plateEdgeMat));
      } else {
        for (const k of half.keys) {
          const id = `${k.w}x${k.h}`;
          let g = geoCache.get(id);
          if (!g) {
            g = cellGeometry(k.w, k.h, cellHeight);
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
    if (!framed && halves.some((h) => h.keys.length)) {
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
    const fit = Math.max(sz.y, sz.x / camera.aspect) / (2 * Math.tan(fov / 2));
    const dist = fit * 1.25;
    controls.target.copy(c);
    // widok z góry, lekko z przodu
    if (grid) grid.visible = !fromBelow;
    if (fromBelow) camera.position.set(c.x, c.y - dist * 0.45, c.z - dist * 0.9);
    else camera.position.set(c.x, c.y - dist * 0.45, c.z + dist * 0.9);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.update();
  }

  $effect(() => {
    // zależności: halves, cellHeight
    void halves;
    void cellHeight;
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
