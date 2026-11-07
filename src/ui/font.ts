// Czcionka legend (Noto Sans Bold, OFL 1.1, public/fonts), wczytywana raz.
import { parse, type Font } from 'opentype.js';

let pending: Promise<Font> | null = null;

export function legendFont(): Promise<Font> {
  pending ??= fetch(`${import.meta.env.BASE_URL}fonts/NotoSans-Bold.ttf`)
    .then((r) => {
      if (!r.ok) throw new Error(`fonts/NotoSans-Bold.ttf: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((b) => parse(b));
  return pending;
}
