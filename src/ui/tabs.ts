/** Zakładki panelu bocznego (wspólne dla płaskiej klawiatury i Dactyla). Nowa zakładka = nowy wpis + tekst `tab_<id>` w i18n. */
export const PANEL_TABS = ['keyboard', 'keycaps', 'colors', 'wiring'] as const;
/** płaska klawiatura ma też keymapę (Dactyl jeszcze nie) */
export const FLAT_TABS = [...PANEL_TABS, 'keymap'] as const;
export type PanelTab = (typeof FLAT_TABS)[number];
