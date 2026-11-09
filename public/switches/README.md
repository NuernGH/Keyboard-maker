# Switch models (preview only)

`cherry-mx.step` is a simplified Cherry MX switch (PCB mount, 5 pins).
Source: https://github.com/ConstantinoSchillebeeckx/cherry-mx-switch (switch.step, 2017).
License: MIT, Copyright (c) 2017 Constantino Schillebeeckx; full text below.

Used only in the 3D preview (not included in STL/STEP export).
Dimensions from the plate top: flange 15.64 × 16.33, part in the hole 13.98 × 13.98 (1.5 mm),
housing bottom −4.85, pin ends −7.64, stem tip +10.05.

`cherry-mx.mesh` is the same solid already placed in the cell and converted to triangles (KMSH format,
src/lib/mesh-file.ts), so the preview does not have to parse the STEP file each time. Same license (MIT).
To refresh after changing the model: `WRITE_SWITCH_MESH=1 npx vitest run tests/switch.test.ts`.

---

MIT License

Copyright (c) 2017 Constantino Schillebeeckx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
