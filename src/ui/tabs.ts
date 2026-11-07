/** Zakładki panelu bocznego (wspólne dla płaskiej klawiatury i Dactyla). Nowa zakładka = nowy wpis + tekst `tab_<id>` w i18n. */
export const PANEL_TABS = ['keyboard', 'keycaps', 'colors', 'wiring'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
