#!/usr/bin/env python3
"""
Steam store art from the in-engine captures (tools/steam-assets/capture.mjs) — reproducible.

    python3 tools/steam-assets/compose.py            # everything
    python3 tools/steam-assets/compose.py capsules   # one step: plates|screens|logos|capsules|icons

Inputs  tools/out/steam-assets/raw/<lang>/*.png   2x supersampled frames from the real game
        tools/out/steam-assets/raw/keyart/*.png   capsule key art (title diorama, night)
        tools/out/steam-assets/raw/ko/logo_*.png  the title wordmark from the real title screen
        tools/out/steam-assets/raw/icon/*.png     real-model renders (transparent)
Outputs steam/store/plates/<lang>/           clean plates, downsampled to their CSS size
        steam/store/screenshots/<lang>/      1920x1080 store screenshots (with HUD)
        steam/store/logo/                    trimmed transparent wordmarks (ko / en)
        steam/store/*.png                    capsules, library art, page background
        build/icons/*, build/icon.png/.ico   app icons (electron-builder) + steam/store icons

Rules kept here (Steam capsule guidelines + docs/ART_DIRECTION.md):
  - capsules carry the game logo and nothing else: no slogans, review quotes, awards, prices;
  - the library hero and the page background carry no logo and no text;
  - screenshots and plates are real in-engine frames; capsule key art is the real title diorama
    re-lit for night (capture.mjs KEYART, pages/models.ts keyArt); composition only crops,
    scales, grades lightly and lays the logo on top (no painted-over or generated imagery).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'tools/out/steam-assets/raw'
STORE = ROOT / 'steam/store'
BUILD = ROOT / 'build'
LANGS = ('ko', 'en')

INK = (42, 33, 49)          # --pop-ink
CREAM = (255, 246, 230)     # --pop-cream
NIGHT = (43, 31, 92)        # --pop-night
NIGHT_D = (21, 15, 43)      # boot background #150F2B
SUN = (255, 210, 63)        # --pop-sun

LANCZOS = Image.Resampling.LANCZOS


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------

def load(p: Path) -> Image.Image:
    if not p.exists():
        raise SystemExit(f'missing capture: {p.relative_to(ROOT)} (run tools/steam-assets/capture.mjs)')
    return Image.open(p)


def save(img: Image.Image, p: Path, **kw) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.suffix.lower() in ('.jpg', '.jpeg'):
        img.convert('RGB').save(p, quality=kw.get('quality', 92), optimize=True, progressive=True)
    else:
        img.save(p, optimize=True)
    print(f'  {p.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}')
    return p


def downsample(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """High-quality downscale (2x supersampled source -> target)."""
    return img.resize(size, LANCZOS, reducing_gap=3.0)


def cover(img: Image.Image, size: tuple[int, int], focus=(0.5, 0.5), zoom=1.0) -> Image.Image:
    """Crop `img` to the aspect of `size` around `focus` (fractions), optionally zoomed in."""
    W, H = img.size
    tw, th = size
    ar = tw / th
    cw, ch = (W, W / ar) if W / H < ar else (H * ar, H)
    cw, ch = cw / zoom, ch / zoom
    cx, cy = focus[0] * W, focus[1] * H
    x0 = min(max(0, cx - cw / 2), W - cw)
    y0 = min(max(0, cy - ch / 2), H - ch)
    return downsample(img.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch))), size)


def window(img: Image.Image, size: tuple[int, int], x0: float, y0: float, h: float) -> Image.Image:
    """Crop a window of height `h` (fraction of img height) at (x0, y0) fractions, to `size`."""
    W, H = img.size
    ch = h * H
    cw = ch * size[0] / size[1]
    x = min(max(0, x0 * W), W - cw)
    y = min(max(0, y0 * H), H - ch)
    return downsample(img.crop((round(x), round(y), round(x + cw), round(y + ch))), size)


def trim(img: Image.Image, pad: int = 0) -> Image.Image:
    a = np.array(img.split()[-1])
    ys, xs = np.nonzero(a > 3)
    if not len(xs):
        return img
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(img.width, xs.max() + 1 + pad), min(img.height, ys.max() + 1 + pad))
    return img.crop(box)


def fit(img: Image.Image, w: int, h: int) -> Image.Image:
    s = min(w / img.width, h / img.height)
    return downsample(img, (max(1, round(img.width * s)), max(1, round(img.height * s))))


def vignette(img: Image.Image, strength=0.28, color=NIGHT_D, power=2.2) -> Image.Image:
    """Soft edge darkening toward the brand night colour (keeps the eye on logo + action)."""
    w, h = img.size
    y, x = np.ogrid[-1:1:complex(0, h), -1:1:complex(0, w)]
    d = np.clip(np.sqrt((x * 0.9) ** 2 + (y * 1.0) ** 2) / 1.35, 0, 1) ** power
    a = (d * strength * 255).astype(np.uint8)
    layer = Image.new('RGB', (w, h), color)
    return Image.composite(layer, img.convert('RGB'), Image.fromarray(a, 'L'))


def side_shade(img: Image.Image, side='left', width=0.55, strength=0.38, color=NIGHT_D) -> Image.Image:
    """Gentle gradient behind the logo side so the wordmark always separates from the sky."""
    w, h = img.size
    ramp = np.linspace(1, 0, int(w * width)) ** 1.6
    a = np.zeros((h, w), np.float32)
    if side == 'left':
        a[:, : ramp.size] = ramp
    elif side == 'top':
        r = np.linspace(1, 0, int(h * width)) ** 1.6
        a[: r.size, :] = r[:, None]
    a = (a * strength * 255).astype(np.uint8)
    return Image.composite(Image.new('RGB', (w, h), color), img.convert('RGB'), Image.fromarray(a, 'L'))


def drop_shadow(logo: Image.Image, offset=(0.0, 0.02), blur=0.018, opacity=0.45) -> Image.Image:
    """Soft contact shadow under the wordmark (same idea as the UI's sticker drop)."""
    w, h = logo.size
    pad = int(max(w, h) * 0.06)
    out = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    a = logo.split()[-1].point(lambda v: int(v * opacity))
    sh = Image.new('RGBA', logo.size, INK + (0,))
    sh.putalpha(a)
    out.alpha_composite(sh, (pad + int(w * offset[0]), pad + int(h * offset[1])))
    out = out.filter(ImageFilter.GaussianBlur(max(1, int(h * blur))))
    out.alpha_composite(logo, (pad, pad))
    return out


def place(base: Image.Image, logo: Image.Image, box: tuple[int, int, int, int], align='center', shadow=True) -> Image.Image:
    """Fit `logo` inside box (x, y, w, h) and composite it."""
    x, y, w, h = box
    lg = fit(logo, w, h)
    if shadow:
        pad_before = lg.size
        lg = drop_shadow(lg)
        pad = (lg.width - pad_before[0]) // 2
    else:
        pad = 0
    lx = x + (w - (lg.width - 2 * pad)) // 2 - pad if align == 'center' else (x - pad if align == 'left' else x + w - lg.width + pad)
    ly = y + (h - (lg.height - 2 * pad)) // 2 - pad
    out = base.convert('RGBA')
    out.alpha_composite(lg, (lx, ly))
    return out.convert('RGB')


def contrast_report(img: Image.Image) -> float:
    """RMS contrast of the luminance (0..1): flags washed-out frames (a hazy capture)."""
    g = np.asarray(img.convert('L'), np.float32) / 255.0
    return float(g.std())


# ---------------------------------------------------------------------------------------------
# steps
# ---------------------------------------------------------------------------------------------

def manifest() -> dict:
    p = RAW / 'manifest.json'
    return json.loads(p.read_text()) if p.exists() else {'frames': {}}


def step_plates() -> None:
    """Every raw plate_* frame, downsampled 2x (captures are made at deviceScaleFactor 2)."""
    print('plates')
    dpr = int(manifest().get('dpr', 2)) or 2
    for lang in LANGS:
        for src in sorted((RAW / lang).glob('plate_*.png')):
            img = load(src).convert('RGB')
            out = downsample(img, (img.width // dpr, img.height // dpr))
            c = contrast_report(out)
            if c < 0.12 and 'title' not in src.stem:
                print(f'  ! low contrast {c:.3f}: {lang}/{src.name} (hazy capture? check it)')
            save(out, STORE / 'plates' / lang / f'{src.stem[6:]}.png')


# Store order -> the raw frame picked for it. The capture saves a few frames per moment
# (_a/_b/_c: the same moment a fraction of a second apart); the pick is the one where the
# HUD callouts sit clear of the action (reviewed by eye, see steam/store/README.md).
SCREENSHOTS = [
    ('01_match_start', 'shot_01_start_a'),
    ('02_bank_uproot', 'shot_02_uproot_a'),
    ('03_interior_steal', 'shot_03_steal_c'),
    ('04_police_tackle', 'shot_04_police_b'),
    ('05_fence_bust', 'shot_05_fence_a'),
    ('06_final_countdown', 'shot_06_final_b'),
    ('07_results_biggest_event', 'shot_07_results_a'),
    ('08_rival_tournament', 'shot_08_rival_a'),
    ('09_layout_preview', 'shot_09_preview'),
]
EXTRA_SHOTS = [
    ('title', 'shot_00_title'),
    ('final_siren_banner', 'shot_06_final_banner'),
    ('tournament_ladder', 'shot_08b_ladder'),
    ('bank_recovery', 'shot_10_recover'),
]


def step_screens() -> None:
    print('screenshots')
    for lang in LANGS:
        extra = STORE / 'screenshots' / lang / 'extra'
        if extra.exists():
            for old in extra.glob('*.png'):
                old.unlink()
        for out_name, raw in SCREENSHOTS:
            src = RAW / lang / f'{raw}.png'
            if not src.exists():
                print(f'  ! missing {src.relative_to(ROOT)}')
                continue
            save(downsample(load(src).convert('RGB'), (1920, 1080)), STORE / 'screenshots' / lang / f'{out_name}.png')
        for out_name, raw in EXTRA_SHOTS:
            src = RAW / lang / f'{raw}.png'
            if src.exists():
                save(downsample(load(src).convert('RGB'), (1920, 1080)), STORE / 'screenshots' / lang / 'extra' / f'{out_name}.png')


def logo_src(lang: str) -> Image.Image:
    return trim(load(RAW / 'ko' / f'logo_{lang}.png').convert('RGBA'), pad=4)


_STICKER: dict[str, Image.Image] = {}


def logo_sticker(lang: str) -> Image.Image:
    """The wordmark with a cream sticker band + thin ink rim around the whole lockup.

    The title screen shows the logo on a bright sky, where its ink outlines carry the letter
    shapes; on the night-indigo capsules those ink edges sink into the sky, so the lockup gets
    the same die-cut sticker edge the UI's stickers and the app icon use.
    """
    if lang not in _STICKER:
        lg = logo_src(lang)
        h = lg.height
        _STICKER[lang] = trim(toy_outline(lg, max(4, int(h * 0.016)), max(3, int(h * 0.011))), pad=2)
    return _STICKER[lang]


def step_logos() -> None:
    print('logos')
    for lang in LANGS:
        lg = logo_src(lang)
        save(lg, STORE / 'logo' / f'logo_{lang}.png')
        # Library logo: 1280x720 transparent canvas, logo fit with a little air (Steam overlays it).
        canvas = Image.new('RGBA', (1280, 720), (0, 0, 0, 0))
        f = drop_shadow(fit(lg, 1180, 640), opacity=0.35)
        canvas.alpha_composite(f, ((1280 - f.width) // 2, (720 - f.height) // 2))
        save(trim_to(canvas, 1280, 720), STORE / f'library_logo_{lang}.png')


def trim_to(img: Image.Image, w: int, h: int) -> Image.Image:
    return img if img.size == (w, h) else img.resize((w, h), LANCZOS)


def keyart(name: str, size: tuple[int, int]) -> Image.Image:
    """A capsule key-art render (capture.mjs KEYART: the title diorama re-lit for night)."""
    img = load(RAW / 'keyart' / f'{name}.png').convert('RGB')
    return img if img.size == size else downsample(img, size)


# Logo boxes (x, y, w, h) per capsule: always over open night sky, clear of the crew and bank.
CAPSULES = {
    'header': ((920, 430), (20, 14, 420, 262), 'left'),
    'small': ((462, 174), (6, 6, 262, 162), 'left'),
    'main': ((1232, 706), (36, 28, 590, 330), 'left'),
    'vertical': ((748, 896), (54, 34, 640, 316), 'center'),
    'library': ((600, 900), (40, 40, 520, 292), 'center'),
}


def step_capsules() -> None:
    print('capsules')
    for lang in LANGS:
        lg = logo_sticker(lang)
        for name, (size, box, align) in CAPSULES.items():
            bg = keyart(name, size)
            side = 'left' if align == 'left' else 'top'
            bg = vignette(side_shade(bg, side, 0.55, 0.22), 0.18)
            out = place(bg, lg, box, align=align, shadow=name != 'small')
            save(out, STORE / f'{name}_capsule_{lang}.png')

    # Library hero 3840x1240: no logo, no text (Steam lays the library logo over it).
    save(vignette(keyart('hero', (3840, 1240)), 0.14), STORE / 'library_hero.png')

    # Page background 1438x810: the key art pushed far back into the page colour (Steam shows it
    # behind the store page; it must stay quiet), fading into the page colour at the bottom.
    p = keyart('page', (1438, 810)).filter(ImageFilter.GaussianBlur(3))
    p = Image.blend(Image.new('RGB', p.size, NIGHT_D), p, 0.42)
    p = vignette(p, 0.55, NIGHT_D, 1.6)
    h = p.height
    ramp = (np.clip((np.arange(h) / h - 0.4) / 0.6, 0, 1) ** 1.3 * 255).astype(np.uint8)
    mask = Image.fromarray(np.repeat(ramp[:, None], p.width, axis=1), 'L')
    p = Image.composite(Image.new('RGB', p.size, NIGHT_D), p, mask)
    save(p, STORE / 'page_background.png')


# ---------------------------------------------------------------------------------------------
# icons
# ---------------------------------------------------------------------------------------------

def dilate(alpha: Image.Image, r: int) -> Image.Image:
    """Round dilation of an alpha mask (max filter on a blurred disc approximation)."""
    if r <= 0:
        return alpha
    a = alpha
    step = 0
    while step < r:
        k = min(9, (r - step) * 2 + 1)
        k = k if k % 2 else k - 1
        a = a.filter(ImageFilter.MaxFilter(max(3, k)))
        step += max(1, (k - 1) // 2)
    return a.filter(ImageFilter.GaussianBlur(max(0.6, r * 0.08))).point(lambda v: 255 if v > 110 else int(v * 255 / 110))


def toy_outline(fig: Image.Image, cream: int, ink: int) -> Image.Image:
    """Sticker / toy outline: cream band then ink band around the figure silhouette."""
    pad = cream + ink + 4
    big = Image.new('RGBA', (fig.width + pad * 2, fig.height + pad * 2), (0, 0, 0, 0))
    big.alpha_composite(fig, (pad, pad))
    a = big.split()[-1].point(lambda v: 255 if v > 40 else 0)
    a_cream = dilate(a, cream)
    a_ink = dilate(a, cream + ink)
    out = Image.new('RGBA', big.size, (0, 0, 0, 0))
    ink_l = Image.new('RGBA', big.size, INK + (255,))
    ink_l.putalpha(a_ink)
    cream_l = Image.new('RGBA', big.size, CREAM + (255,))
    cream_l.putalpha(a_cream)
    out.alpha_composite(ink_l)
    out.alpha_composite(cream_l)
    out.alpha_composite(big)
    return out


def badge(size: int) -> Image.Image:
    """Rounded-square night badge with a soft gold sunburst (the title sky's rays, at night)."""
    S = size
    r = int(S * 0.22)
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    cx, cy = S * 0.5, S * 0.62
    d = np.hypot(x - cx, y - cy) / (S * 0.75)
    ang = np.arctan2(y - cy, x - cx)
    rays = (np.cos(ang * 13) > 0.25).astype(np.float32) * np.clip(1 - d, 0, 1) * 0.16
    base = np.clip(1 - d, 0, 1)[..., None]
    c0 = np.array((30, 21, 64), np.float32)
    c1 = np.array((104, 74, 206), np.float32)
    col = c0 + (c1 - c0) * base ** 1.1
    col = col + (np.array(SUN, np.float32) - col) * rays[..., None] * 1.25
    rgb = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), 'RGB')
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=r, fill=255)
    bg.paste(rgb, (0, 0), mask)
    # Ink rim + inner cream highlight line, like the UI's sticker panels.
    rim = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(rim)
    w = max(2, int(S * 0.022))
    dr.rounded_rectangle((w // 2, w // 2, S - 1 - w // 2, S - 1 - w // 2), radius=r - w // 2, outline=INK + (255,), width=w)
    w2 = max(1, int(S * 0.010))
    dr.rounded_rectangle((w, w, S - 1 - w, S - 1 - w), radius=max(1, r - w), outline=(205, 189, 255, 90), width=w2)
    bg.alpha_composite(rim)
    return bg


def icon_master(fig_file: str, size=1024, fig_h=0.86, y_bottom=0.95, fig_w=0.88, cream=0.012, ink=0.016, keep_top=1.0) -> Image.Image:
    fig = trim(load(RAW / 'icon' / fig_file).convert('RGBA'))
    if keep_top < 1.0:
        fig = fig.crop((0, 0, fig.width, int(fig.height * keep_top)))
    S = size
    out = badge(S)
    f = fit(fig, int(S * fig_w), int(S * fig_h))
    f = toy_outline(f, max(2, int(S * cream)), max(2, int(S * ink)))
    out.alpha_composite(f, ((S - f.width) // 2, int(S * y_bottom) - f.height))
    return out


def step_icons() -> None:
    print('icons')
    full = icon_master('icon_full.png', 1024, fig_h=0.88, y_bottom=0.955, fig_w=0.9)
    # Small sizes: just the masked face (head + collar) with a much bolder toy outline, the whole
    # sticker inside the badge (nothing runs off its edge).
    head = icon_master('icon_head.png', 1024, fig_h=0.74, y_bottom=0.89, fig_w=0.8, cream=0.035, ink=0.035, keep_top=0.6)
    # Keep the figure inside the badge: clip to the rounded square.
    mask = Image.new('L', (1024, 1024), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1023, 1023), radius=int(1024 * 0.22), fill=255)
    for im in (full, head):
        im.putalpha(ImageChops.multiply(im.split()[-1], mask))
    sizes = [1024, 512, 256, 128, 64, 48, 32, 16]
    icons = {}
    for s in sizes:
        # At 48 px and below the full figure turns to mush: the bold head-only variant reads better.
        src = head if s <= 48 else full
        icons[s] = src if s == 1024 else downsample(src, (s, s))
        save(icons[s], BUILD / 'icons' / f'{s}x{s}.png')
    save(icons[512], BUILD / 'icon.png')
    ico_sizes = [256, 128, 64, 48, 32, 16]
    ico = icons[256]
    p = BUILD / 'icon.ico'
    ico.save(p, format='ICO', sizes=[(s, s) for s in ico_sizes], append_images=[icons[s] for s in ico_sizes if s != 256])
    print(f'  {p.relative_to(ROOT)}  sizes {ico_sizes}')
    # Steam: client icon (.ico) and the 184x184 community icon (JPG, flattened on night).
    p2 = STORE / 'client_icon.ico'
    p2.parent.mkdir(parents=True, exist_ok=True)
    ico.save(p2, format='ICO', sizes=[(s, s) for s in ico_sizes], append_images=[icons[s] for s in ico_sizes if s != 256])
    print(f'  {p2.relative_to(ROOT)}')
    flat = Image.new('RGB', (1024, 1024), NIGHT_D)
    flat.paste(full, (0, 0), full)
    save(downsample(flat, (184, 184)), STORE / 'community_icon_184.jpg')
    save(full, STORE / 'icon_1024.png')


STEPS = {'plates': step_plates, 'screens': step_screens, 'logos': step_logos, 'capsules': step_capsules, 'icons': step_icons}


def main(argv: list[str]) -> None:
    want = argv[1:] or list(STEPS)
    for s in want:
        if s not in STEPS:
            raise SystemExit(f'unknown step {s}; one of {", ".join(STEPS)}')
        STEPS[s]()


if __name__ == '__main__':
    main(sys.argv)
