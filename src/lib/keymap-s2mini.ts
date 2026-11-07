// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Keymapa 60% ANSI na S2 mini taka jak w firmware (repo NuernGH/zmk-s2mini, shield s2mini_60, commit 301cf99):
 * warstwy BASE / GAME / FN, przyciski przy ekranie (krótko ekran/gałka, długo multimedia) i gałka z trybami.
 *
 * Zachowania &knob, &knob_next i &scr_view są z modułu zmk-s2mini (compatible w module, SCR_PREV/SCR_NEXT
 * w dt-bindings/zmk/s2mini.h); hold-tapy &push_ht i &view_ht są zdefiniowane w bloku behaviors poniżej.
 * Eksport kopiuje include'y i ten blok, żeby plik budował się bez poprawek.
 */

export const S2MINI60_INCLUDES = [
  '#include <behaviors.dtsi>',
  '#include <dt-bindings/zmk/keys.h>',
  '#include <dt-bindings/zmk/pointing.h>',
  '#include <dt-bindings/zmk/s2mini.h>',
];

/** blok `behaviors { … };` z firmware (wcięcie 4 spacje, wewnątrz `/ { … }`) */
export const S2MINI60_BEHAVIORS = `    behaviors {
        knob_vol: knob_vol {
            compatible = "zmk,behavior-sensor-rotate";
            #sensor-binding-cells = <0>;
            bindings = <&kp C_VOL_UP>, <&kp C_VOL_DN>;
        };
        knob_scroll: knob_scroll {
            compatible = "zmk,behavior-sensor-rotate";
            #sensor-binding-cells = <0>;
            bindings = <&msc SCRL_DOWN>, <&msc SCRL_UP>;
            tap-ms = <30>;
        };
        knob_track: knob_track {
            compatible = "zmk,behavior-sensor-rotate";
            #sensor-binding-cells = <0>;
            bindings = <&kp C_NEXT>, <&kp C_PREV>;
        };
        knob_bright: knob_bright {
            compatible = "zmk,behavior-sensor-rotate";
            #sensor-binding-cells = <0>;
            bindings = <&kp C_BRI_UP>, <&kp C_BRI_DN>;
        };
        knob: knob {
            compatible = "zmk,behavior-knob-modes";
            #sensor-binding-cells = <0>;
            display-name = "Knob";
            modes = <&knob_vol &knob_scroll &knob_track &knob_bright>;
            mode-names = "VOLUME", "SCROLL", "TRACK", "BRIGHT";
        };
        knob_next: knob_next {
            compatible = "zmk,behavior-knob-next";
            #binding-cells = <0>;
            display-name = "Knob mode";
        };
        scr_view: scr_view {
            compatible = "zmk,behavior-screen-view";
            #binding-cells = <1>;
            display-name = "Screen view";
        };
        /* Przyciski przy ekranie: krótko = tap (ekran/gałka), długo = hold (multimedia) */
        push_ht: push_ht {
            compatible = "zmk,behavior-hold-tap";
            #binding-cells = <2>;
            display-name = "Knob button";
            flavor = "tap-preferred";
            tapping-term-ms = <300>;
            bindings = <&kp>, <&knob_next>;
        };
        view_ht: view_ht {
            compatible = "zmk,behavior-hold-tap";
            #binding-cells = <2>;
            display-name = "Screen button";
            flavor = "tap-preferred";
            tapping-term-ms = <300>;
            bindings = <&kp>, <&scr_view>;
        };
    };`;

/** rzędy macierzy 60% ANSI: `_` = &trans, `-` = &none, `@x` = &x, inaczej &kp */
const BASE = [
  'ESC N1 N2 N3 N4 N5 N6 N7 N8 N9 N0 MINUS EQUAL BSPC',
  'TAB Q W E R T Y U I O P LBKT RBKT BSLH',
  'CAPS A S D F G H J K L SEMI SQT RET',
  'LSHFT Z X C V B N M COMMA DOT FSLH RSHFT',
  'LCTRL LGUI LALT SPACE RALT RGUI @mo_2 RCTRL',
];
const GAME = [
  '_ _ _ _ _ _ _ _ _ _ _ _ _ _',
  '_ _ _ _ _ _ _ _ _ _ _ _ _ _',
  'F13 _ _ _ _ _ _ _ _ _ _ _ _',
  '_ _ _ _ _ _ _ _ _ _ _ _',
  '_ - _ _ _ - _ _',
];
const FN = [
  'GRAVE F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 DEL',
  '_ _ _ _ _ _ _ PG_UP UP PG_DN PSCRN _ _ @studio_unlock',
  '_ _ _ _ _ @tog_1 HOME LEFT DOWN RIGHT END _ _',
  '_ _ _ _ _ _ _ _ _ _ _ _',
  '_ _ _ _ _ _ _ _',
];
const tok = (t: string) => (t === '_' ? '&trans' : t === '-' ? '&none' : t.startsWith('@') ? `&${t.slice(1).replace(/_(\d)$/, ' $1')}` : `&kp ${t}`);

export interface S2Layer {
  name: string;
  node: string;
  /** wiązanie klawisza rzędu `r`, kolumny `c` (kolejny klawisz w rzędzie układu) */
  key: (r: number, c: number) => string | undefined;
  buttons: Record<'mod-push' | 'mod-con' | 'mod-bak', string>;
  /** gałka (sensor-bindings); brak = warstwa bez sensor-bindings */
  sensor?: string;
}

const grid = (rows: string[]) => {
  const g = rows.map((r) => r.split(' '));
  return (r: number, c: number) => (g[r]?.[c] ? tok(g[r][c]) : undefined);
};
const trans3 = { 'mod-push': '&trans', 'mod-con': '&trans', 'mod-bak': '&trans' };

export const S2MINI60_LAYERS: S2Layer[] = [
  {
    name: 'BASE',
    node: 'base',
    key: grid(BASE),
    buttons: { 'mod-push': '&push_ht C_MUTE 0', 'mod-con': '&view_ht C_PP SCR_PREV', 'mod-bak': '&view_ht C_NEXT SCR_NEXT' },
    sensor: '&knob',
  },
  { name: 'GAME', node: 'game', key: grid(GAME), buttons: trans3 },
  { name: 'FN', node: 'fn', key: grid(FN), buttons: trans3 },
];

/** zachowania modułu S2 mini do wyboru z listy (tylko 60% na S2 mini) */
export const S2MINI60_SPECIALS: { text: string; pl: string; en: string }[] = [
  { text: '&knob_next', pl: 'Następny tryb gałki', en: 'Next knob mode' },
  { text: '&scr_view SCR_PREV', pl: 'Poprzedni widok ekranu', en: 'Previous screen view' },
  { text: '&scr_view SCR_NEXT', pl: 'Następny widok ekranu', en: 'Next screen view' },
  { text: '&push_ht C_MUTE 0', pl: 'Krótko: tryb gałki, długo: wycisz', en: 'Tap: knob mode, hold: mute' },
  { text: '&view_ht C_PP SCR_PREV', pl: 'Krótko: poprzedni widok, długo: play/pauza', en: 'Tap: previous view, hold: play/pause' },
  { text: '&view_ht C_NEXT SCR_NEXT', pl: 'Krótko: następny widok, długo: następny utwór', en: 'Tap: next view, hold: next track' },
];
