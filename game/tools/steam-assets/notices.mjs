#!/usr/bin/env node
/**
 * Writes LICENSES/THIRD_PARTY_NOTICES.txt from the license files of what the game actually ships
 * (verbatim from node_modules, so a dependency update regenerates the right text):
 *
 *   node tools/steam-assets/notices.mjs          # write
 *   node tools/steam-assets/notices.mjs --check  # exit 1 when the file is out of date
 *
 * Shipped runtime code (package-lock "production" packages that end up in the build):
 *   three (bundled into dist/), @fontsource/jua + @fontsource/noto-sans-kr (font files bundled
 *   into dist/assets), steamworks.js (node_modules in app.asar, native addon unpacked) and the
 *   Electron runtime itself (devDependency, but it IS the shipped executable).
 * @types/node and undici-types are production-listed (via steamworks.js typings) but are
 * type definitions only and are excluded from the package by package.json "build.files".
 * The file is shown in-game (Credits -> Licenses, imported with ?raw) and shipped next to the
 * executable as resources/THIRD_PARTY_NOTICES.txt (package.json build.extraResources).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'LICENSES/THIRD_PARTY_NOTICES.txt');
const nm = (...p) => path.join(ROOT, 'node_modules', ...p);
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
const version = (pkg) => JSON.parse(fs.readFileSync(nm(pkg, 'package.json'), 'utf8')).version;
const gameVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const RULE = '='.repeat(78);

/** Upstream copyright statement of Noto Sans KR (Google Fonts OFL.txt / Source Han Sans). */
const NOTO_COPYRIGHT = 'Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name \'Source\'.';

/**
 * Rust crates compiled into steamworks.js's native addon (identified from the crate paths the
 * shipped steamworks.js 0.4.0 binaries carry). Re-check when steamworks.js is updated.
 */
const RUST_CRATES = [
  { name: 'steamworks (steamworks-rs)', version: 'git fbb7963', license: 'MIT OR Apache-2.0', url: 'https://github.com/Noxime/steamworks-rs' },
  { name: 'steamworks-sys', version: 'git fbb7963', license: 'MIT OR Apache-2.0', url: 'https://github.com/Noxime/steamworks-rs' },
  { name: 'napi (napi-rs)', version: '2.16.8', license: 'MIT', url: 'https://github.com/napi-rs/napi-rs' },
  { name: 'napi-sys', version: '2.4.0', license: 'MIT', url: 'https://github.com/napi-rs/napi-rs' },
  { name: 'tokio', version: '1.39.2', license: 'MIT', url: 'https://github.com/tokio-rs/tokio' },
  { name: 'serde_json', version: '1.0.122', license: 'MIT OR Apache-2.0', url: 'https://github.com/serde-rs/json' },
  { name: 'once_cell', version: '1.19.0', license: 'MIT OR Apache-2.0', url: 'https://github.com/matklad/once_cell' },
  { name: 'lazy_static', version: '1.5.0', license: 'MIT OR Apache-2.0', url: 'https://github.com/rust-lang-nursery/lazy-static.rs' },
];

const MIT_TEXT = `MIT License

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
SOFTWARE.`;

/** Each entry: one section of the notices file (the in-game Licenses view splits on RULE). */
const entries = [
  {
    name: 'three.js',
    version: version('three'),
    license: 'MIT License',
    url: 'https://threejs.org/',
    usage: 'Real-time 3D rendering (including the bundled example add-ons: EffectComposer, RenderPass, ShaderPass, OutputPass, UnrealBloomPass, RoundedBoxGeometry, BufferGeometryUtils).',
    text: read(nm('three/LICENSE')),
  },
  {
    name: 'steamworks.js',
    version: version('steamworks.js'),
    license: 'MIT License',
    url: 'https://github.com/ceifa/steamworks.js',
    usage: 'Steam integration (achievements, overlay, Steam Cloud). The package also carries the Steamworks SDK redistributable libraries (steam_api64.dll / libsteam_api.so), (c) Valve Corporation, redistributed with Steam games under the Steamworks SDK Access Agreement; they are not covered by the MIT License below.',
    text: read(nm('steamworks.js/LICENSE')),
  },
  {
    name: 'steamworks.js native addon: Rust crates',
    version: `steamworks.js ${version('steamworks.js')}`,
    license: 'MIT License (crates offered under "MIT OR Apache-2.0" are used under MIT)',
    url: 'https://github.com/ceifa/steamworks.js',
    usage: 'The steamworks.js native addon (steamworksjs.*.node) statically links these Rust crates. List taken from the shipped binaries; each crate\'s copyright notice is in its repository.',
    text: [
      ...RUST_CRATES.map((c) => `${c.name} ${c.version} - ${c.license} - ${c.url}`),
      '',
      'Copyright (c) the respective authors of the crates listed above.',
      '',
      MIT_TEXT,
    ].join('\n'),
  },
  {
    name: 'Electron',
    version: version('electron'),
    license: 'MIT License',
    url: 'https://www.electronjs.org/',
    usage: 'Desktop runtime. Electron bundles Chromium, Node.js, FFmpeg and other open-source components; their license texts ship next to the game executable in LICENSES.chromium.html (and the Electron license as LICENSE.electron.txt).',
    text: read(nm('electron/dist/LICENSE')),
  },
  {
    name: 'Jua (font)',
    version: `@fontsource/jua ${version('@fontsource/jua')}`,
    license: 'SIL Open Font License, Version 1.1',
    url: 'https://fonts.google.com/specimen/Jua',
    usage: 'Display / title typeface (menus, logo, signs). Font files are bundled unmodified.',
    text: read(nm('@fontsource/jua/LICENSE')),
  },
  {
    name: 'Noto Sans KR (font)',
    version: `@fontsource/noto-sans-kr ${version('@fontsource/noto-sans-kr')}`,
    license: 'SIL Open Font License, Version 1.1',
    url: 'https://fonts.google.com/noto/specimen/Noto+Sans+KR',
    usage: 'Body text typeface (weights 400, 700, 900). Font files are bundled unmodified.',
    // The @fontsource LICENSE starts with a bare "Google Inc." line instead of the font's own
    // copyright statement; use the upstream one (Noto Sans KR OFL.txt) and keep the rest verbatim.
    text: read(nm('@fontsource/noto-sans-kr/LICENSE')).replace(/^Google Inc\.\s*\n/, `${NOTO_COPYRIGHT}\n`),
  },
];

function build() {
  const head = [
    '뿌리째 털어라 (Uproot Heist) - THIRD-PARTY SOFTWARE NOTICES',
    `Game version ${gameVersion}. This file lists the third-party software and fonts shipped with the`,
    'game and reproduces their license texts. All game art, music and sound effects are made by the',
    'game itself in code (procedural generation); no third-party art or audio assets are used.',
    '',
    '뿌리째 털어라에 포함된 외부 소프트웨어와 글꼴의 목록과 라이선스 전문입니다. 게임의 그래픽·음악·',
    '효과음은 모두 코드로 직접 만든 것이며 외부 그림·소리 자산은 쓰지 않았습니다.',
  ].join('\n');
  const sections = entries.map((e) =>
    [
      RULE,
      `${e.name} ${e.version.includes(' ') ? `(${e.version})` : e.version}`,
      `License: ${e.license}`,
      `Website: ${e.url}`,
      `Used for: ${e.usage}`,
      '-'.repeat(78),
      e.text,
    ].join('\n'),
  );
  return `${head}\n\n${sections.join('\n\n')}\n\n${RULE}\nEnd of notices.\n`;
}

const text = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) {
    console.error('LICENSES/THIRD_PARTY_NOTICES.txt is out of date: run node tools/steam-assets/notices.mjs');
    process.exit(1);
  }
  console.log('notices up to date');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${entries.length} components, ${text.length} chars)`);
}
