// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Zapis i odczyt projektu: wszystkie ustawienia generatora w jednym pliku JSON (.kbproj.json)
 * albo w linku (ustawienia skompresowane w części adresu po #, bez własnej komórki STEP).
 *
 * Plik zapisuje tylko wartości, a przy odczycie brakujące pola biorą bieżące wartości domyślne
 * (mergeDefaults), więc starsze pliki otwierają się też po dodaniu nowych opcji.
 */

export const PROJECT_APP = 'keyboard-maker';
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = '.kbproj.json';
/** klucz w części adresu po #, np. …/Keyboard-maker/#projekt=… */
export const LINK_KEY = 'projekt';

/** płaska klawiatura (split, macropad, 60%) */
export interface FlatProject {
  templateId: string;
  params: unknown;
  rowText?: string;
  island: unknown;
  caseP: unknown;
  print: unknown;
  variant: string;
  plate: unknown;
  up: string;
  show: string;
  showElectronics: boolean;
  showSwitches: boolean;
  /** nakładki klawiszy (KeycapParams) i czy pokazywać je w podglądzie */
  keycap?: unknown;
  showCaps?: boolean;
  /** kolory podglądu (PreviewColors) */
  colors?: unknown;
  /** keymapa ZMK (KeymapData), tylko gdy zmieniana; brak = domyślna z układu */
  keymap?: unknown;
  /** własna komórka STEP (tylko w pliku; w linku pomijana) */
  cell?: { name: string; data: string };
}

/** Dactyl */
export interface DactylProject {
  params: unknown;
  variant: string;
  show: string;
  ctrlOn: boolean;
  ctrl: unknown;
  floor: number;
  screwSize: string;
  explode: number;
  showCaps: boolean;
  /** nakładki klawiszy (KeycapParams) */
  keycap?: unknown;
  /** kolory podglądu (PreviewColors) */
  colors?: unknown;
  /** fazka krawędzi wierzchu skorupy (mm) */
  chamfer?: number;
  /** łączniki: fartuchy na boczne kanały gniazd */
  slotCover?: boolean;
  /** skorupa: łączniki (domyślnie), koc albo organiczna */
  shellKind?: string;
  /** skorupa organiczna: wzór Woronoja (OrganicParams) */
  organic?: unknown;
}

export interface ProjectFile {
  app: typeof PROJECT_APP;
  version: number;
  saved?: string;
  kind: 'flat' | 'dactyl';
  flat?: FlatProject;
  dactyl?: DactylProject;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Wartości z pliku nałożone na domyślne: obiekty łączone rekurencyjnie, tablice i liczby brane z pliku,
 * pole z pliku o innym typie niż domyślne pomijane. Pola spoza domyślnych (np. opcjonalne `custom`) zostają.
 */
export function mergeDefaults<T>(defaults: T, saved: unknown): T {
  if (saved === undefined || saved === null) return structuredClone(defaults);
  if (isObj(defaults)) {
    if (!isObj(saved)) return structuredClone(defaults);
    const out: Record<string, unknown> = structuredClone(defaults) as Record<string, unknown>;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) continue;
      out[k] = k in out ? mergeDefaults(out[k], v) : structuredClone(v);
    }
    return out as T;
  }
  if (defaults === undefined) return structuredClone(saved) as T;
  if (Array.isArray(defaults)) return (Array.isArray(saved) ? structuredClone(saved) : structuredClone(defaults)) as T;
  if (typeof saved !== typeof defaults) return defaults;
  if (typeof saved === 'number' && !Number.isFinite(saved)) return defaults;
  return saved as T;
}

export function makeProject(kind: 'flat', body: FlatProject): ProjectFile;
export function makeProject(kind: 'dactyl', body: DactylProject): ProjectFile;
export function makeProject(kind: 'flat' | 'dactyl', body: FlatProject | DactylProject): ProjectFile {
  return {
    app: PROJECT_APP,
    version: PROJECT_VERSION,
    saved: new Date().toISOString(),
    kind,
    ...(kind === 'flat' ? { flat: body as FlatProject } : { dactyl: body as DactylProject }),
  };
}

/** sprawdza, czy to plik projektu; zwraca opis błędu (do pokazania) albo projekt */
export function parseProject(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('not-json');
  }
  if (!isObj(raw) || raw.app !== PROJECT_APP) throw new Error('not-project');
  if (typeof raw.version !== 'number' || raw.version > PROJECT_VERSION) throw new Error('newer-version');
  if (raw.kind === 'flat' && isObj(raw.flat)) return raw as unknown as ProjectFile;
  if (raw.kind === 'dactyl' && isObj(raw.dactyl)) return raw as unknown as ProjectFile;
  throw new Error('not-project');
}

// ---------- komórka STEP w pliku (base64) ----------

export function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- link ----------

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const toUrl64 = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl64 = (s: string) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return b + '='.repeat((4 - (b.length % 4)) % 4);
};

/** projekt bez komórki STEP, skompresowany do tekstu bezpiecznego w adresie */
export async function encodeLink(p: ProjectFile): Promise<string> {
  const copy: ProjectFile = structuredClone(p);
  delete copy.saved;
  if (copy.flat) delete copy.flat.cell;
  const json = new TextEncoder().encode(JSON.stringify(copy));
  return toUrl64(bytesToBase64(await pipe(json, new CompressionStream('deflate-raw'))));
}

export async function decodeLink(s: string): Promise<ProjectFile> {
  let text: string;
  try {
    const bytes = await pipe(base64ToBytes(fromUrl64(s)), new DecompressionStream('deflate-raw'));
    text = new TextDecoder().decode(bytes);
  } catch {
    throw new Error('bad-link');
  }
  return parseProject(text);
}

/** wartość projektu z części adresu po # (albo null) */
export function linkFromHash(hash: string): string | null {
  const m = new RegExp(`(?:^#|&)${LINK_KEY}=([A-Za-z0-9_-]+)`).exec(hash);
  return m ? m[1] : null;
}
