# Keyboard-maker

Generator płyt klawiatur w przeglądarce. Etap 1 (prototyp techniczny): płaski split 4×6 + 4 klawisze kciukowe
z wzorcowej komórki Cherry MX (`key socket.STEP` od Marcina), eksport STL (do druku) i STEP (do SolidWorks). Całość liczy się lokalnie,
bez serwera. Docelowo ta sama aplikacja trafi do exe przez Tauri.

## Uruchomienie

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # testy układu i geometrii (OpenCascade w Node)
npm run build    # statyczna strona w dist/
python3 tools/build-artifact.py <katalog>   # wersja do podglądu w Claude (WASM spakowany gzipem, eksport jako ZIP)
```

## Co umie prototyp

- Szablon split 4×6 + 4 kciukowe: stagger kolumn, pozycja, obrót i wachlarz klastra kciuka, ostatni klawisz 1–2U, pionowo lub poziomo.
- Trzy warianty komórki:
  - **Hot-swap**: cała komórka (8,58 mm), z kieszenią na gniazdo Kailh MX, bez wycięć na diodę.
  - **Bez hot-swap**: tylko górne 5,08 mm komórki (płyta 1,27 mm z otworem 14×14 i ścianki z wybraniem 15,2), przełączniki lutowane.
  - **Cienka płyta 1,5 mm**: sam otwór 14×14, bez ścianek.
- Własna komórka: wczytaj dowolny plik STEP komórki 1U. Oś płyty wykrywa się automatycznie albo ustawiasz ją ręcznie.
- Lewa i prawa połówka. Prawa to lustro pozycji klawiszy, ale komórki nie są lustrzane, więc gniazda hot-swap mają tę samą orientację.
- Wyspa na elektronikę (wariant A): pole 38 × 68 mm przy wewnętrznej kolumnie z gniazdem na moduł OLED 1,3" z enkoderem EC11, kieszenią od spodu na nice!nano v2, wyjściem USB-C i przepustami na piny. W podglądzie widać uproszczone bryły elektroniki (nie trafiają do eksportu).
- Podgląd 3D: najpierw szybki podgląd komórek, potem dokładna bryła z CAD (liczona w Web Workerze).
- Interfejs po polsku i angielsku.

## Jak powstaje bryła

1. Komórkę z pliku STEP obracamy tak, by płyta była na górze (z = 0), i liczymy jej „negatyw”: prostopadłościan obrysu minus komórka.
2. Obrys płyty to suma prostokątów klawiszy, domknięta offsetem (+r, −r), żeby wypełnić szczeliny przy obróconych klawiszach kciuka.
3. Płyta = obrys wyciągnięty na wysokość komórki minus negatywy w pozycjach klawiszy. Negatywy idą jako osobne narzędzia jednej operacji odejmowania (`cutMany` w `src/lib/geometry.ts`), bo jako jeden compound OpenCascade psuł ściany dna w wariancie hot-swap.

Testy sprawdzają, że siatka 2×2 ma dokładnie objętość czterech komórek (wymiary 1:1), że bryła przechodzi `BRepCheck_Analyzer` i że STEP po ponownym wczytaniu ma tę samą objętość.

## Struktura

| Ścieżka | Co to |
| --- | --- |
| `src/lib/layout.ts` | model układu (klawisze w mm), szablon 4×6 + 4, lustro, test nakładania |
| `src/lib/cell-spec.ts` | stałe i typy komórki (bez zależności od CAD) |
| `src/lib/island.ts` | wymiary i wycięcia wyspy na elektronikę (bez CAD) |
| `src/lib/geometry.ts` | geometria w replicad / OpenCascade: komórka, obrys, płyta |
| `src/cad/` | Web Worker z jądrem CAD i klient do niego |
| `src/ui/` | podgląd Three.js, teksty PL/EN |
| `public/cells/mx-hotswap.step` | wzorcowa komórka 1U MX z hot-swap (`key socket.STEP` od Marcina, poprawiony Part1.STEP bez wycięć na diodę) |
| `tests/` | testy Vitest |

## Licencja

AGPL-3.0-or-later, patrz [LICENSE](LICENSE). Biblioteki: replicad (AGPL-3.0), OpenCascade przez replicad-opencascadejs (LGPL-2.1), Three.js (MIT), Svelte (MIT).
Modele z GrabCAD nie trafiają do tego repozytorium.
