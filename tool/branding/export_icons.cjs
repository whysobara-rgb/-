// Vector source is authoritative. Usage: node tool/branding/export_icons.cjs
// Requires sharp 0.35.4. Icons are checked in; this tool is not used at app startup.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(require.resolve('sharp', { paths: [__dirname, process.cwd(), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean) }));
const root = path.resolve(__dirname, '../..');
const svg = fs.readFileSync(path.join(root, 'design/app-icon.svg'));
(async () => {
  const ios = path.join(root, 'ios/Runner/Assets.xcassets/AppIcon.appiconset');
  const spec = JSON.parse(fs.readFileSync(path.join(ios, 'Contents.json')));
  for (const item of spec.images) {
    if (!item.filename) continue;
    const pixels = Math.round(parseFloat(item.size) * parseFloat(item.scale));
    await sharp(svg).resize(pixels, pixels).flatten({background:'#111019'}).png().toFile(path.join(ios, item.filename));
  }
  for (const [density, pixels] of Object.entries({mdpi:48, hdpi:72, xhdpi:96, xxhdpi:144, xxxhdpi:192})) {
    await sharp(svg).resize(pixels, pixels).flatten({background:'#111019'}).png().toFile(path.join(root, `android/app/src/main/res/mipmap-${density}/ic_launcher.png`));
  }
  console.log('Exported opaque iOS and Android application icons from design/app-icon.svg');
})().catch(error => { console.error(error); process.exitCode = 1; });
