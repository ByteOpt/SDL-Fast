from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BLUE = (47, 123, 224, 255)
WHITE = (255, 255, 255, 255)


def draw_mark(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BLUE)
    d = ImageDraw.Draw(img)
    s = float(size)

    shaft_w = max(2, round(s * 0.13))
    shaft_top = s * 0.18
    shaft_bot = s * 0.48
    cx = s / 2
    d.rectangle((cx - shaft_w / 2, shaft_top, cx + shaft_w / 2, shaft_bot), fill=WHITE)

    head_top = s * 0.42
    head_bot = s * 0.68
    head_w = s * 0.42
    d.polygon(
        [
            (cx, head_bot),
            (cx - head_w / 2, head_top),
            (cx + head_w / 2, head_top),
        ],
        fill=WHITE,
    )

    tray_y = s * 0.74
    tray_h = max(2, round(s * 0.07))
    tray_x0 = s * 0.22
    tray_x1 = s * 0.78
    thick = max(2, round(s * 0.07))
    d.rectangle((tray_x0, tray_y, tray_x0 + thick, s * 0.88), fill=WHITE)
    d.rectangle((tray_x1 - thick, tray_y, tray_x1, s * 0.88), fill=WHITE)
    d.rectangle((tray_x0, s * 0.88 - tray_h, tray_x1, s * 0.88), fill=WHITE)
    return img


def main() -> None:
    desktop = ROOT / "desktop" / "assets"
    ext = ROOT / "extension" / "icons"
    desktop.mkdir(parents=True, exist_ok=True)
    ext.mkdir(parents=True, exist_ok=True)

    master = draw_mark(512)
    master.save(desktop / "icon.png")
    master.save(
        desktop / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    for n in (16, 32, 48, 128):
        master.resize((n, n), Image.Resampling.LANCZOS).save(ext / f"{n}.png")


if __name__ == "__main__":
    main()
