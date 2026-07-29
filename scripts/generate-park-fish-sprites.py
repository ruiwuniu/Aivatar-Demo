#!/usr/bin/env python3
"""Generate deterministic 64x40 park fish sprites from approved source silhouettes."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FISH_DIR = ROOT / "public" / "park" / "fish"
BLACK_BASS_SOURCE = FISH_DIR / "raw-black-bass-v1.png"
CRUCIAN_CARP_SOURCE = FISH_DIR / "raw-crucian-carp-v1.png"

RGBA = tuple[int, int, int, int]
RGB = tuple[int, int, int]
Marker = Callable[[int, int, float, RGB], RGB]


def mix(left: RGB, right: RGB, amount: float) -> RGB:
    return tuple(
        round(left[channel] + (right[channel] - left[channel]) * amount)
        for channel in range(3)
    )


def palette_color(shadow: RGB, body: RGB, highlight: RGB, value: float) -> RGB:
    if value < 0.52:
        return mix(shadow, body, value / 0.52)
    return mix(body, highlight, (value - 0.52) / 0.48)


def recolor_sprite(
    source: Image.Image,
    shadow: RGB,
    body: RGB,
    highlight: RGB,
    marker: Marker,
) -> Image.Image:
    source = source.convert("RGBA")
    output = Image.new("RGBA", source.size, (0, 0, 0, 0))
    source_pixels = source.load()
    output_pixels = output.load()
    bbox = source.getchannel("A").getbbox()
    if not bbox:
        return output
    left, top, right, bottom = bbox
    width = max(1, right - left - 1)
    height = max(1, bottom - top - 1)
    opaque_luma = [
        (red * 0.2126 + green * 0.7152 + blue * 0.0722)
        for red, green, blue, alpha in source.get_flattened_data()
        if alpha >= 24
    ]
    low = min(opaque_luma)
    high = max(opaque_luma)
    span = max(1.0, high - low)

    for y in range(source.height):
        for x in range(source.width):
            red, green, blue, alpha = source_pixels[x, y]
            if alpha < 8:
                continue
            luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
            normalized = max(0.0, min(1.0, (luma - low) / span))
            normalized = round(normalized * 7) / 7
            color = palette_color(shadow, body, highlight, normalized)
            nx = (x - left) / width
            ny = (y - top) / height
            marked = marker(x, y, nx, ny, color)
            output_pixels[x, y] = (*marked, alpha)
    return output


def bluegill_marker(_: int, __: int, nx: float, ny: float, color: RGB) -> RGB:
    if 0.19 <= nx <= 0.34 and 0.28 <= ny <= 0.72:
        return mix(color, (35, 99, 119), 0.72)
    if 0.2 <= nx <= 0.47 and ny >= 0.66:
        return mix(color, (181, 112, 48), 0.48)
    if nx >= 0.72 and ny <= 0.42:
        return mix(color, (60, 82, 67), 0.5)
    return color


def yellow_perch_marker(_: int, __: int, nx: float, ny: float, color: RGB) -> RGB:
    bars = (0.35, 0.46, 0.57, 0.68, 0.78)
    if 0.18 <= ny <= 0.82 and any(abs(nx - center) <= 0.024 for center in bars):
        return mix(color, (43, 48, 28), 0.82)
    if ny >= 0.68:
        return mix(color, (198, 117, 36), 0.42)
    return color


def rainbow_trout_marker(x: int, y: int, nx: float, ny: float, color: RGB) -> RGB:
    stripe_center = 0.52 + (nx - 0.5) * 0.05
    if 0.12 <= nx <= 0.83 and abs(ny - stripe_center) <= 0.085:
        return mix(color, (190, 92, 112), 0.62)
    if 0.22 <= nx <= 0.78 and 0.15 <= ny <= 0.68 and (x * 17 + y * 29) % 37 < 3:
        return (48, 54, 48)
    return color


def weather_loach_marker(x: int, y: int, nx: float, ny: float, color: RGB) -> RGB:
    if (x * 19 + y * 31) % 29 < 5 and 0.12 <= nx <= 0.84:
        return mix(color, (68, 55, 32), 0.68)
    if ny >= 0.62:
        return mix(color, (176, 142, 82), 0.34)
    return color


def loach_source(source: Image.Image) -> Image.Image:
    source = source.convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if not bbox:
        return Image.new("RGBA", (64, 40), (0, 0, 0, 0))
    crop = source.crop(bbox)
    slender = crop.resize((55, 13), Image.Resampling.NEAREST)
    output = Image.new("RGBA", (64, 40), (0, 0, 0, 0))
    output.alpha_composite(slender, (4, 14))
    pixels = output.load()
    for x, y, alpha in [
        (3, 19, 255),
        (2, 18, 220),
        (1, 17, 160),
        (3, 21, 255),
        (2, 22, 220),
        (1, 23, 160),
    ]:
        pixels[x, y] = (71, 58, 35, alpha)
    return output


def main() -> None:
    black_bass = Image.open(BLACK_BASS_SOURCE)
    crucian_carp = Image.open(CRUCIAN_CARP_SOURCE)
    outputs = {
        "raw-bluegill-v1.png": recolor_sprite(
            crucian_carp,
            (30, 48, 44),
            (83, 118, 91),
            (155, 179, 118),
            bluegill_marker,
        ),
        "raw-yellow-perch-v1.png": recolor_sprite(
            black_bass,
            (55, 48, 20),
            (183, 146, 52),
            (237, 205, 104),
            yellow_perch_marker,
        ),
        "raw-weather-loach-v1.png": recolor_sprite(
            loach_source(black_bass),
            (48, 39, 25),
            (117, 91, 49),
            (188, 153, 88),
            weather_loach_marker,
        ),
        "raw-rainbow-trout-v1.png": recolor_sprite(
            black_bass,
            (43, 55, 55),
            (119, 139, 132),
            (211, 220, 199),
            rainbow_trout_marker,
        ),
    }
    for filename, image in outputs.items():
        image.save(FISH_DIR / filename, format="PNG", optimize=False)
        print(f"generated {filename} {image.size[0]}x{image.size[1]} RGBA")


if __name__ == "__main__":
    main()
