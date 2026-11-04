#!/usr/bin/env python3
# Buduje wersję do podglądu w Claude (jedna strona + pliki obok).
# Użycie: python3 tools/build-artifact.py <katalog_wyjściowy>
import glob, gzip, os, shutil, subprocess, sys

out = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist = os.path.join(root, 'dist-artifact')
env = dict(os.environ, VITE_WASM_GZ='1')
subprocess.run(['npx', 'vite', 'build', '--outDir', dist, '--emptyOutDir'], cwd=root, env=env, check=True)
os.makedirs(os.path.join(out, 'cells'), exist_ok=True)
a = os.path.join(dist, 'assets')
for f in glob.glob(os.path.join(a, 'worker-*.js')) + glob.glob(os.path.join(a, '__vite-browser-external-*.js')):
    shutil.copy(f, out)
with open(glob.glob(os.path.join(a, 'replicad_single-*.wasm'))[0], 'rb') as src, gzip.open(os.path.join(out, 'occt.wasm.gz'), 'wb', 9) as dst:
    shutil.copyfileobj(src, dst)
shutil.copy(os.path.join(dist, 'cells', 'mx-hotswap-part1.step'), os.path.join(out, 'cells'))
css = open(glob.glob(os.path.join(a, 'index-*.css'))[0]).read()
js = open(glob.glob(os.path.join(a, 'index-*.js'))[0]).read()
assert '</script' not in js
page = f'<title>Generator płyt klawiatury</title>\n<style>\n{css}\n</style>\n<div id="app"></div>\n<script type="module">\n{js}\n</script>\n'
open(os.path.join(out, 'index.html'), 'w').write(page)
print('\n'.join(sorted(os.listdir(out))))
