// SPDX-License-Identifier: AGPL-3.0-or-later
// Pamięć policzonych siatek podglądu w przeglądarce (IndexedDB). Ponowne wejście z tymi samymi
// ustawieniami pokazuje bryłę od razu zamiast liczyć ją od nowa w jądrze CAD. Klucz zawiera wersję
// aplikacji, więc po każdej zmianie kodu bryły liczą się na nowo. Eksport zawsze liczy na świeżo.
// Bez IndexedDB (tryb prywatny, zablokowane dane strony) wszystko działa jak dawniej, tylko bez pamięci.

const DB = 'keyboard-maker';
const STORE = 'meshes';
/** ile siatek trzymamy (najdawniej używane wypadają); jedna to zwykle 1–5 MB */
const LIMIT = 40;

interface Entry<T> {
  key: string;
  t: number;
  value: T;
}

let db: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (!db)
    db = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('t', 't');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  return db;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error);
  });

/** Klucz: skrót SHA-256 wersji aplikacji, rodzaju zlecenia i jego danych (bez pliku komórki). */
export async function meshKey(kind: string, input: object): Promise<string | null> {
  try {
    const text = `${__BUILD_ID__}|${kind}|${JSON.stringify(input, (k, v) => (k === 'cellStep' ? undefined : v))}`;
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export async function getMesh<T>(key: string): Promise<T | null> {
  try {
    const d = await open();
    if (!d) return null;
    const tx = d.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    const e = await new Promise<Entry<T> | undefined>((res, rej) => {
      const r = st.get(key);
      r.onsuccess = () => res(r.result as Entry<T> | undefined);
      r.onerror = () => rej(r.error);
    });
    // odśwież czas użycia, żeby często oglądane bryły nie wypadały
    if (e) st.put({ ...e, t: Date.now() });
    await done(tx);
    return e?.value ?? null;
  } catch {
    return null;
  }
}

export async function putMesh<T>(key: string, value: T): Promise<void> {
  try {
    const d = await open();
    if (!d) return;
    const tx = d.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.put({ key, t: Date.now(), value } satisfies Entry<T>);
    const count = await new Promise<number>((res, rej) => {
      const r = st.count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    // nadmiar: usuń najdawniej używane
    let extra = count - LIMIT;
    if (extra > 0) {
      const cur = st.index('t').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || extra <= 0) return;
        c.delete();
        extra--;
        c.continue();
      };
    }
    await done(tx);
  } catch {
    // brak miejsca albo zablokowane dane strony: bez pamięci
  }
}
