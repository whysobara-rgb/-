/**
 * Bundled fonts (the game must run fully offline — no CDN).
 * - Jua: display face (titles, buttons, big numbers).
 * - Noto Sans KR: body text, 400 / 700 / 900.
 * Vite copies the woff2 subsets next to the build; unicode-range keeps loading lazy.
 */
import '@fontsource/jua';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-sans-kr/900.css';

/** Resolves once the faces used by the first screen are ready (safe to call repeatedly). */
export async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('400 1em Jua', '뿌리째 털어라 0123456789'),
      document.fonts.load('400 1em "Noto Sans KR"', '가나다 abc'),
      document.fonts.load('700 1em "Noto Sans KR"', '가나다 abc'),
    ]);
    await document.fonts.ready;
  } catch {
    /* fonts are cosmetic; never block the game on them */
  }
}
