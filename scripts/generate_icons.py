from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def draw_mark(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = max(1, size // 16)
    d.rounded_rectangle((pad, pad, size - pad - 1, size - pad - 1), radius=size // 5, fill=(47, 123, 224, 255))
    cx = size / 2
    w = size * 0.12
    shaft_top = size * 0.22
    shaft_bot = size * 0.52
    d.rectangle((cx - w / 2, shaft_top, cx + w / 2, shaft_bot), fill=(255, 255, 255, 255))
    head = [
        (cx, size * 0.74),
        (size * 0.28, size * 0.50),
        (size * 0.72, size * 0.50),
    ]
    d.polygon(head, fill=(255, 255, 255, 255))
    bar_y = size * 0.80
    d.rectangle((size * 0.28, bar_y, size * 0.72, bar_y + size * 0.08), fill=(255, 255, 255, 255))
    return img


def main() -> None:
    desktop = ROOT / "desktop" / "assets"
    ext = ROOT / "extension" / "icons"
    desktop.mkdir(parents=True, exist_ok=True)
    ext.mkdir(parents=True, exist_ok=True)

    master = draw_mark(256)
    master.save(desktop / "icon.png")
    master.save(
        desktop / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    for n in (16, 48, 128):
        draw_mark(n).save(ext / f"{n}.png")


if __name__ == "__main__":
    main()
