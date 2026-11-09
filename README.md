# Keyboard-maker

A keyboard plate generator that runs in the browser. Stage 1 (technical prototype): a flat 4×6 split with 4 thumb keys,
built from a reference Cherry MX cell (`key socket.STEP` by Marcin), with STL export (for printing) and STEP export (for SolidWorks). Everything is computed locally,
with no server. The same app will later ship as an exe through Tauri.

## Online version

https://nuerngh.github.io/Keyboard-maker/ is published automatically by GitHub Actions
(`.github/workflows/pages.yml`) after every merge to `main`.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # layout and geometry tests (OpenCascade in Node)
npm run build    # static site in dist/
python3 tools/build-artifact.py <dir>   # build for preview in Claude (gzipped WASM, export as ZIP)
```

## What the prototype can do

- 4×6 + 4 thumb split template: column stagger, thumb cluster position, rotation and fan, last key 1–2U, vertical or horizontal.
- Three cell variants:
  - **Hot-swap**: the full cell (8.58 mm), with a pocket for the Kailh MX socket and no diode cutouts.
  - **No hot-swap**: only the top 5.08 mm of the cell (1.27 mm plate with a 14×14 hole and walls with a 15.2 recess), soldered switches.
  - **Thin plate 1.5 mm**: just the 14×14 hole, no walls.
- Custom cell: load any 1U cell STEP file. The plate axis is detected automatically or set by hand.
- Left and right halves. The right half mirrors the key positions, but the cells are not mirrored, so the hot-swap sockets keep the same orientation.
- Electronics island (variant A): a 38 × 68 mm area by the inner column with a seat for a 1.3" OLED module with an EC11 encoder, a pocket underneath for a nice!nano v2, a USB-C opening and pin passthroughs. The preview shows simplified electronics bodies (they are not exported).
- **Dactyl (curved)** template: the default model from [Dactyl Configurator](https://github.com/rianadon/dactyl-configurator) (5×6, 1.5U pinky, 6 thumb keys, α 15°, β 5°, tenting 12°). The shell is built from convex hulls between posts at the cell corners, with walls down to the floor, our cell (hot-swap or not), a flat bottom with 5 M2.5 screws, and a nice!nano in a tray on the bottom with USB-C in the back wall. Curvature, tenting, rows, columns, thumb offset and column offsets (forward / height per finger) are adjustable; walls are smooth (default), rounded at the corners or angular like the original; the preview shows a Cherry MX switch model; keycap and cell collisions are flagged.
- 3D preview: a fast cell preview first, then the exact CAD solid (computed in a Web Worker).
- Interface in English (default) and Polish.

## How the solid is built

1. The cell from the STEP file is rotated so the plate is on top (z = 0), and its "negative" is computed: the bounding box minus the cell.
2. The plate outline is the union of the key rectangles, closed with an offset (+r, −r) to fill the gaps around rotated thumb keys.
3. Plate = the outline extruded to the cell height minus the negatives at the key positions. The negatives go in as separate tools of a single cut (`cutMany` in `src/lib/geometry.ts`), because as one compound OpenCascade broke the bottom faces in the hot-swap variant.

Dactyl: key placement (`apply-key-geometry`, 6 thumb positions), bridges and walls are ported from Dactyl Configurator (`src/lib/dactyl.ts`). Each hull is a solid made of triangles (quickhull), all fused in one `BRepAlgoAPI_Fuse`, then trimmed to the floor and the cell negatives are subtracted (`src/lib/dactyl-geometry.ts`). The left half mirrors the right. Smooth walls: wall pieces are joined into a loop, wall points follow a centripetal Catmull-Rom curve, and the bottom outline uses the same curve. OpenCascade (WASM) does not release all memory after a large fuse, so the Dactyl preview restarts the worker every two shells.

Tests check that a 2×2 grid has exactly the volume of four cells (1:1 dimensions), that the solid passes `BRepCheck_Analyzer`, and that a STEP file loaded back has the same volume.

## Custom controller

In "Electronics → Controller" you can pick "Custom (from model)…" and upload a STEP or STL model of the board. The generator lays the model flat, builds a top-down height map (0.2 mm grid) and reads: the outline, board thickness, height with components, USB sockets (width, centres, bottom, overhang), pin rows and a pair of mounting holes. The numbers go into a form for you to check; the "Flip top/bottom", "Rotate 90°" and "USB on the other side" buttons fix wrong guesses. STL has no units (mm by default, cm/inches/m to choose). The model stays in the browser; only the numbers are saved (in the browser or as a .json file).

"Vertical fit" (Standard / Tight / Clamp / Custom) sets the clearance above components (pocket ceiling) and the clearance of the case floor pad, and for a flipped controller the clearance of the step under the USB socket. Clamp = the pad overlaps by 0.2 mm and clamps the board when the bottom is screwed on.

## Structure

| Path | What it is |
| --- | --- |
| `src/lib/layout.ts` | layout model (keys in mm), 4×6 + 4 template, mirroring, overlap test |
| `src/lib/cell-spec.ts` | cell constants and types (no CAD dependency) |
| `src/lib/island.ts` | electronics island dimensions and cutouts (no CAD) |
| `src/lib/controller-measure.ts` | measuring a custom controller from a STEP/STL model (height map: board, USB sockets, pin rows, holes) |
| `src/ui/CustomController.svelte` | custom controller panel: model upload, orientation fixes, form, .json save |
| `src/lib/geometry.ts` | geometry in replicad / OpenCascade: cell, outline, plate |
| `src/lib/dactyl.ts` | Dactyl: placement, posts, bridges, walls, screws, collisions (no CAD) |
| `src/lib/dactyl-geometry.ts`, `src/lib/dactyl-parts.ts` | Dactyl in OpenCascade: shell, bottom, controller holder |
| `src/cad/` | Web Worker with the CAD kernel and its client |
| `src/ui/` | Three.js preview, PL/EN texts |
| `public/cells/mx-hotswap.step` | reference 1U MX hot-swap cell (`key socket.STEP` by Marcin, fixed Part1.STEP without diode cutouts) |
| `public/switches/cherry-mx.step` | Cherry MX switch for the 3D preview only (MIT, [C. Schillebeeckx](https://github.com/ConstantinoSchillebeeckx/cherry-mx-switch)), not exported |
| `public/fonts/NotoSans-Black.ttf` | keycap legend font (Noto Sans Black, SIL OFL 1.1, text in `public/fonts/OFL.txt`) |
| `src/lib/switch-model.ts` | places the switch like the cell (plate top z = 0, stem centred) |
| `tests/` | Vitest tests |

## License

AGPL-3.0-or-later, see [LICENSE](LICENSE). The Dactyl code is ported from [rianadon/dactyl-configurator](https://github.com/rianadon/dactyl-configurator) (AGPL-3.0; earlier dactyl-keyboard by Matthew Adereth and dactyl-manuform by Tom Short). Libraries: quickhull3d (MIT), opentype.js (MIT), replicad (AGPL-3.0), OpenCascade via replicad-opencascadejs (LGPL-2.1), Three.js (MIT), Svelte (MIT).
The switch model `public/switches/cherry-mx.step` is MIT licensed (text in `public/switches/README.md`). Legend font Noto Sans Black: SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
Models from GrabCAD are not included in this repository.
