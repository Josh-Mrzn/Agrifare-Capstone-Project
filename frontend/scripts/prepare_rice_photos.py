"""Prepare rice photos for the landing page's "Rice varieties" section.

Takes one photo per variety, shot on white paper, and writes a 1050x1400
WebP for each to public/rice/<id>.webp:

  * white-balanced to the paper (the 70th-percentile colour of the border),
  * scaled so the rice spans 78% of the frame width,
  * placed with the bottom of the rice at 80% of the frame height,
  * on pure white, saved at quality 90.

No sharpening and no saturation changes: the photo is only balanced and
framed. The page does the rest (see ricePhotoShowcase.js).

Usage (needs Pillow and numpy):

    python scripts/prepare_rice_photos.py path/to/raw-photos

where the folder holds files named after the variety ids, e.g. jasmine.jpg,
dinorado.png, red-cargo.jpg. Then add `photo: '/rice/<id>.webp'` and an
`imageAlt` to every variety in riceVarieties.data.js to turn photo mode on.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT_W, OUT_H = 1050, 1400
RICE_WIDTH = 0.78
RICE_BOTTOM = 0.80
RICE_LUMINANCE = 0.90
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "rice"


def white_balance(rgb):
    """Scale each channel so the paper (the border's 70th percentile) is white."""
    h, w, _ = rgb.shape
    ring = max(2, round(min(w, h) * 0.02))
    border = np.concatenate([
        rgb[:ring].reshape(-1, 3),
        rgb[-ring:].reshape(-1, 3),
        rgb[:, :ring].reshape(-1, 3),
        rgb[:, -ring:].reshape(-1, 3),
    ])
    paper = np.maximum(np.percentile(border, 70, axis=0), 1.0)
    return np.clip(rgb * (255.0 / paper), 0, 255)


def rice_box(rgb):
    """Bounding box of the rice: pixels darker than the paper, outliers trimmed."""
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]) / 255.0
    ys, xs = np.nonzero(lum < RICE_LUMINANCE)
    if xs.size == 0:
        raise ValueError("no rice found: is the photo on white paper?")
    left, right = np.percentile(xs, [0.5, 99.5])
    top, bottom = np.percentile(ys, [0.5, 99.5])
    return left, top, right, bottom


def prepare(src, dst):
    rgb = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32)
    rgb = white_balance(rgb)
    left, top, right, bottom = rice_box(rgb)

    scale = (OUT_W * RICE_WIDTH) / max(1.0, right - left)
    img = Image.fromarray(rgb.round().astype(np.uint8))
    scaled = img.resize(
        (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
        Image.LANCZOS,
    )

    # Centre the rice across, and put its bottom at 80% of the height.
    cx = (left + right) / 2 * scale
    offset_x = round(OUT_W / 2 - cx)
    offset_y = round(OUT_H * RICE_BOTTOM - bottom * scale)

    canvas = Image.new("RGB", (OUT_W, OUT_H), (255, 255, 255))
    canvas.paste(scaled, (offset_x, offset_y))
    canvas.save(dst, "WEBP", quality=90, method=6)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    src_dir = Path(sys.argv[1])
    photos = sorted(p for p in src_dir.iterdir() if p.suffix.lower() in EXTENSIONS)
    if not photos:
        print(f"No photos found in {src_dir}")
        sys.exit(1)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for photo in photos:
        dst = OUT_DIR / f"{photo.stem}.webp"
        prepare(photo, dst)
        print(f"{photo.name} -> {dst.relative_to(OUT_DIR.parent.parent)}")


if __name__ == "__main__":
    main()
