#!/usr/bin/env python3
"""Generate the seamless, precomposited pond overlay used by the park.

The runtime deliberately draws this PNG atlas straight onto the scene canvas.
Keeping the cellular texture, blend modes, and irregular shoreline work here
avoids repeated canvas-to-canvas ImageBuffer flushes in macOS WKWebView.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path
import math

import numpy as np
from PIL import Image

# Reproduction environment used for the committed atlas:
# Python 3.12, numpy 2.4.3, Pillow 12.1.1.


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/park/hilltop-park-midday-ground.png"
OUTPUT = ROOT / "public/park/hilltop-pond-motion-v1.png"

SCENE_WIDTH = 1180
SCENE_HEIGHT = 900
SOURCE_WIDTH = 1435
SOURCE_HEIGHT = 1095

POND_MIN_X = 750
POND_MIN_Y = 425
POND_MAX_X = SCENE_WIDTH - 1
POND_MAX_Y = SCENE_HEIGHT - 1
POND_SEEDS = ((790, 620), (800, 650))

POND_DRAW_X = 730
POND_DRAW_Y = 405
POND_DRAW_WIDTH = 450
POND_DRAW_HEIGHT = 495

FRAME_WIDTH = 396
FRAME_HEIGHT = 443
FRAME_COUNT = 80
ATLAS_COLUMNS = 8
ATLAS_ROWS = 10
ATLAS_FPS = 10
ATLAS_GUTTER = 1
ATLAS_CELL_WIDTH = FRAME_WIDTH + ATLAS_GUTTER * 2
ATLAS_CELL_HEIGHT = FRAME_HEIGHT + ATLAS_GUTTER * 2
LOOP_DURATION_MS = FRAME_COUNT / ATLAS_FPS * 1000.0

MORPH_FRAME_COUNT = 8
POND_STRIP_HEIGHT = 2
POND_TRAVELLING_HIGHLIGHT_FREQUENCY = 0.049
POND_TRAVELLING_HIGHLIGHT_STRENGTH = 0.42
POND_TRAVELLING_HIGHLIGHT_SHARPNESS = 9

POND_RIPPLES = (
    # x, y, authored phase, loop-safe phase-warp amount and phase.
    (1102, 548, 0.10, 0.050, 0.20),
    (1018, 674, 0.46, 0.065, 1.85),
    (1128, 786, 0.73, 0.045, 3.40),
    (950, 824, 0.31, 0.075, 5.10),
)
POND_WAVE_PARTICLE_COUNT = 26
POND_GLIMMER_COUNT = 13


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def smoothstep(value: float) -> float:
    value = clamp01(value)
    return value * value * (3.0 - 2.0 * value)


def smootherstep(value: float) -> float:
    value = clamp01(value)
    return value * value * value * (value * (value * 6.0 - 15.0) + 10.0)


def imul_u32(left: int, right: int) -> int:
    return (left * right) & 0xFFFFFFFF


def pond_hash(x: int, y: int, salt: int) -> int:
    value = imul_u32(x ^ salt, 0x045D9F3B) ^ imul_u32(y + salt, 0x119DE1F3)
    value = imul_u32(value ^ (value >> 16), 0x045D9F3B)
    return (value ^ (value >> 16)) & 0xFFFFFFFF


def blend(
    backdrop: np.ndarray,
    source: np.ndarray,
    mode: str = "normal",
    opacity: float = 1.0,
) -> np.ndarray:
    """Canvas-compatible source-over compositing with multiply/screen modes."""
    source_alpha = source[..., 3:4] * opacity
    backdrop_alpha = backdrop[..., 3:4]
    source_rgb = source[..., :3]
    backdrop_rgb = backdrop[..., :3]

    if mode == "multiply":
        mixed_rgb = source_rgb * backdrop_rgb
    elif mode == "screen":
        mixed_rgb = source_rgb + backdrop_rgb - source_rgb * backdrop_rgb
    else:
        mixed_rgb = source_rgb

    output_alpha = source_alpha + backdrop_alpha * (1.0 - source_alpha)
    output_premultiplied = (
        source_alpha * (1.0 - backdrop_alpha) * source_rgb
        + source_alpha * backdrop_alpha * mixed_rgb
        + (1.0 - source_alpha) * backdrop_alpha * backdrop_rgb
    )
    output_rgb = np.divide(
        output_premultiplied,
        output_alpha,
        out=np.zeros_like(output_premultiplied),
        where=output_alpha > 1e-8,
    )
    return np.concatenate((output_rgb, output_alpha), axis=-1)


def solid_layer(
    width: int,
    height: int,
    color: tuple[int, int, int],
    alpha: float,
) -> np.ndarray:
    layer = np.empty((height, width, 4), dtype=np.float32)
    layer[..., :3] = np.asarray(color, dtype=np.float32) / 255.0
    layer[..., 3] = alpha
    return layer


def make_pond_masks() -> tuple[int, int, np.ndarray, np.ndarray, np.ndarray]:
    source = Image.open(SOURCE).convert("RGB")
    source = source.crop((0, 0, SOURCE_WIDTH, SOURCE_HEIGHT)).resize(
        (SCENE_WIDTH, SCENE_HEIGHT),
        Image.Resampling.NEAREST,
    )
    pixels = np.asarray(source, dtype=np.int16)
    red = pixels[..., 0]
    green = pixels[..., 1]
    blue = pixels[..., 2]
    candidates = (
        (
            (blue >= red + 20)
            & (green >= red + 11)
            & (blue >= green + 5)
            & (blue >= 48)
            & (red <= 118)
        )
        | (
            (blue >= red + 15)
            & (green >= red + 18)
            & (blue >= green - 8)
            & (blue >= 42)
            & (red <= 92)
        )
    )
    candidates[:POND_MIN_Y, :] = False
    candidates[:, :POND_MIN_X] = False

    connected = np.zeros((SCENE_HEIGHT, SCENE_WIDTH), dtype=np.uint8)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(x: int, y: int) -> None:
        if not candidates[y, x] or connected[y, x] != 0:
            return
        connected[y, x] = 255
        queue.append((x, y))

    for y in range(POND_MIN_Y, POND_MAX_Y + 1):
        enqueue(POND_MAX_X, y)
    for x in range(POND_MIN_X, POND_MAX_X + 1):
        enqueue(x, POND_MAX_Y)
    for x, y in POND_SEEDS:
        enqueue(x, y)

    while queue:
        x, y = queue.popleft()
        if x > POND_MIN_X:
            enqueue(x - 1, y)
        if x < POND_MAX_X:
            enqueue(x + 1, y)
        if y > POND_MIN_Y:
            enqueue(x, y - 1)
        if y < POND_MAX_Y:
            enqueue(x, y + 1)

    for _ in range(2):
        additions: list[tuple[int, int]] = []
        for y in range(POND_MIN_Y + 1, POND_MAX_Y):
            for x in range(POND_MIN_X + 1, POND_MAX_X):
                if connected[y, x] != 0:
                    continue
                neighbours = np.count_nonzero(connected[y - 1 : y + 2, x - 1 : x + 2])
                if neighbours >= 6:
                    additions.append((x, y))
        for x, y in additions:
            connected[y, x] = 255

    pond_y, pond_x = np.nonzero(connected)
    min_x = int(pond_x.min())
    min_y = int(pond_y.min())
    max_x = int(pond_x.max())
    max_y = int(pond_y.max())
    width = max_x - min_x + 1
    height = max_y - min_y + 1
    if (min_x, min_y, width, height) != (784, 457, FRAME_WIDTH, FRAME_HEIGHT):
        raise RuntimeError(
            "Pond bounds changed to "
            f"({min_x}, {min_y}, {width}, {height}); update the runtime atlas contract first."
        )

    interior = np.zeros_like(connected)
    edge = np.zeros_like(connected)
    rim = np.zeros_like(connected)
    for y in range(POND_MIN_Y, POND_MAX_Y + 1):
        for x in range(POND_MIN_X, POND_MAX_X + 1):
            if connected[y, x] == 0:
                continue
            nearest_outside = 6
            for radius in range(1, 6):
                touches_outside = False
                for delta_y in range(-radius, radius + 1):
                    remaining = radius - abs(delta_y)
                    delta_x_values = (0,) if remaining == 0 else (-remaining, remaining)
                    for delta_x in delta_x_values:
                        sample_x = x + delta_x
                        sample_y = y + delta_y
                        if (
                            sample_x < POND_MIN_X
                            or sample_x > POND_MAX_X
                            or sample_y < POND_MIN_Y
                            or sample_y > POND_MAX_Y
                            or connected[sample_y, sample_x] == 0
                        ):
                            touches_outside = True
                            break
                    if touches_outside:
                        break
                if touches_outside:
                    nearest_outside = radius
                    break
            if nearest_outside == 1:
                rim[y, x] = 255
            if nearest_outside <= 5:
                edge[y, x] = round(255 * (6 - nearest_outside) / 5)
            if nearest_outside >= 4:
                interior[y, x] = 255

    crop = np.s_[min_y : max_y + 1, min_x : max_x + 1]
    return min_x, min_y, interior[crop], edge[crop], rim[crop]


def make_cellular_texture(
    tile_size: int,
    cell_size: int,
    salt: int,
    vertical_scale: float,
    color: tuple[int, int, int, int],
    morph_phase: float,
) -> np.ndarray:
    width = tile_size
    height = round(tile_size * vertical_scale)
    cell_height = max(4, round(cell_size * vertical_scale))
    cell_count_x = round(width / cell_size)
    cell_count_y = round(height / cell_height)
    image = np.zeros((height, width, 4), dtype=np.float32)

    for y in range(height):
        for x in range(width):
            base_cell_x = math.floor(x / cell_size)
            base_cell_y = math.floor(y / cell_height)
            nearest = math.inf
            second_nearest = math.inf
            for offset_y in range(-1, 2):
                for offset_x in range(-1, 2):
                    cell_x = base_cell_x + offset_x
                    cell_y = base_cell_y + offset_y
                    wrapped_x = cell_x % cell_count_x
                    wrapped_y = cell_y % cell_count_y
                    hash_x = pond_hash(wrapped_x, wrapped_y, salt)
                    hash_y = pond_hash(wrapped_x, wrapped_y, salt ^ 0x9E3779B9)
                    morph_x = math.sin(
                        morph_phase + wrapped_x * 1.91 + wrapped_y * 0.73 + salt * 0.00011
                    ) * cell_size * 0.055
                    morph_y = math.cos(
                        morph_phase + wrapped_x * 0.64 - wrapped_y * 1.37 + salt * 0.00017
                    ) * cell_height * 0.085
                    center_x = (
                        cell_x + 0.22 + (hash_x % 560) / 1000.0
                    ) * cell_size + morph_x
                    center_y = (
                        cell_y + 0.22 + (hash_y % 560) / 1000.0
                    ) * cell_height + morph_y
                    delta_x = x - center_x
                    delta_y = (y - center_y) / vertical_scale
                    distance = delta_x * delta_x + delta_y * delta_y
                    if distance < nearest:
                        second_nearest = nearest
                        nearest = distance
                    elif distance < second_nearest:
                        second_nearest = distance
            boundary_distance = second_nearest - nearest
            line_width = cell_size * 1.7
            if boundary_distance > line_width:
                continue
            if pond_hash(x >> 1, y >> 1, salt ^ 0x85EBCA6B) % 17 == 0:
                continue
            strength = 1.0 - boundary_distance / line_width
            image[y, x, :3] = np.asarray(color[:3], dtype=np.float32) / 255.0
            image[y, x, 3] = color[3] / 255.0 * (1.0 if strength > 0.58 else 0.55)
    return image


def make_texture_sequence(
    tile_size: int,
    cell_size: int,
    salt: int,
    vertical_scale: float,
    color: tuple[int, int, int, int],
) -> list[np.ndarray]:
    return [
        make_cellular_texture(
            tile_size,
            cell_size,
            salt,
            vertical_scale,
            color,
            frame_index / MORPH_FRAME_COUNT * math.tau,
        )
        for frame_index in range(MORPH_FRAME_COUNT)
    ]


def tiled_texture_layer(
    textures: list[np.ndarray],
    pond_x: int,
    pond_y: int,
    offset_x: float,
    offset_y: float,
    morph_progress: float,
    wave_phase: float,
    wave_amplitude: float,
    wave_frequency: float,
    base_alpha: float,
    travelling_highlight_phase: float | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Reproduce the old two-pixel Canvas ribbon deformation offline.

    The former runtime drew each ribbon at the neighbouring integer offsets
    with complementary alpha.  Baking those two draws into separate RGBA
    layers preserves the crisp nearest-neighbour pixels and the original
    source-over multiply/screen order without allocating runtime canvases.
    """
    texture = textures[0]
    texture_height, texture_width = texture.shape[:2]
    start_x = -texture_width + (offset_x % texture_width)
    start_y = POND_DRAW_Y - texture_height + (offset_y % texture_height)

    wrapped_progress = morph_progress % 1.0
    morph_position = wrapped_progress * len(textures)
    morph_frame = math.floor(morph_position) % len(textures)
    next_frame = (morph_frame + 1) % len(textures)
    raw_mix = morph_position - math.floor(morph_position)
    morph_mix = smoothstep(raw_mix)
    first_draw = np.zeros((FRAME_HEIGHT, FRAME_WIDTH, 4), dtype=np.float32)
    second_draw = np.zeros_like(first_draw)
    target_world_x = np.arange(pond_x, pond_x + FRAME_WIDTH)

    for local_y in range(0, FRAME_HEIGHT, POND_STRIP_HEIGHT):
        world_y = pond_y + local_y
        primary_wave = math.sin(world_y * wave_frequency + wave_phase) * wave_amplitude
        secondary_wave = (
            math.sin(world_y * wave_frequency * 0.47 - wave_phase * 0.73)
            * wave_amplitude
            * 0.36
        )
        wave_offset = primary_wave + secondary_wave
        lower_offset = math.floor(wave_offset)
        offset_mix = wave_offset - lower_offset
        travelling_crest = 0.0
        if travelling_highlight_phase is not None:
            crest_wave = 0.5 + math.sin(
                world_y * POND_TRAVELLING_HIGHLIGHT_FREQUENCY
                - travelling_highlight_phase
            ) * 0.5
            travelling_crest = (
                crest_wave**POND_TRAVELLING_HIGHLIGHT_SHARPNESS
                * POND_TRAVELLING_HIGHLIGHT_STRENGTH
            )
        strip_alpha = min(1.0, base_alpha + travelling_crest)
        height = min(POND_STRIP_HEIGHT, FRAME_HEIGHT - local_y)
        def sampled_strip(destination_offset: int, source_world_y: int) -> np.ndarray:
            source_world_x = target_world_x - destination_offset
            source_x = np.floor(source_world_x - start_x).astype(np.int32) % texture_width
            source_y = math.floor(source_world_y - start_y) % texture_height
            first = textures[morph_frame][source_y, source_x]
            second = textures[next_frame][source_y, source_x]
            result = np.zeros((FRAME_WIDTH, 4), dtype=np.float32)
            result = blend(result, first, opacity=1.0 - morph_mix)
            result = blend(result, second, opacity=morph_mix)
            inside_source = (
                (source_world_x >= POND_DRAW_X)
                & (source_world_x < POND_DRAW_X + POND_DRAW_WIDTH)
                & (source_world_y >= POND_DRAW_Y)
                & (source_world_y < POND_DRAW_Y + POND_DRAW_HEIGHT)
            )
            result[~inside_source, 3] = 0.0
            return result

        for row in range(local_y, local_y + height):
            source_world_y = pond_y + row
            lower_strip = sampled_strip(lower_offset, source_world_y)
            upper_strip = sampled_strip(lower_offset + 1, source_world_y)
            first_draw[row] = lower_strip
            first_draw[row, :, 3] *= strip_alpha * (1.0 - offset_mix)
            second_draw[row] = upper_strip
            second_draw[row, :, 3] *= strip_alpha * offset_mix

    return first_draw, second_draw


def fill_rect(
    layer: np.ndarray,
    x: int,
    y: int,
    width: int,
    height: int,
    color: tuple[int, int, int],
    alpha: float,
    mode: str,
) -> np.ndarray:
    left = max(0, x)
    top = max(0, y)
    right = min(FRAME_WIDTH, x + width)
    bottom = min(FRAME_HEIGHT, y + height)
    if left >= right or top >= bottom or alpha <= 0:
        return layer
    patch = solid_layer(right - left, bottom - top, color, alpha)
    layer[top:bottom, left:right] = blend(
        layer[top:bottom, left:right], patch, mode=mode
    )
    return layer


def draw_pixel_ring(
    layer: np.ndarray,
    center_x: int,
    center_y: int,
    radius_x: int,
    radius_y: int,
    color: tuple[int, int, int],
    alpha: float,
) -> np.ndarray:
    for x in range(-radius_x, radius_x + 1, 2):
        normalized_x = x / max(1, radius_x)
        y = round(radius_y * math.sqrt(max(0.0, 1.0 - normalized_x * normalized_x)))
        layer = fill_rect(layer, center_x + x, center_y - y, 3, 1, color, alpha, "screen")
        if y > 1:
            layer = fill_rect(layer, center_x + x, center_y + y, 3, 1, color, alpha, "screen")
    return layer


def render_frame(
    progress: float,
    pond_x: int,
    pond_y: int,
    interior_mask: np.ndarray,
    edge_mask: np.ndarray,
    rim_mask: np.ndarray,
    large_highlights: list[np.ndarray],
    large_lowlights: list[np.ndarray],
    fine_highlights: list[np.ndarray],
    fine_lowlights: list[np.ndarray],
) -> np.ndarray:
    surface = solid_layer(FRAME_WIDTH, FRAME_HEIGHT, (32, 127, 150), 0.13)
    phase = progress * math.tau
    # Preserve the former opposing large/fine drift while making the finite
    # atlas loop seamless.  The amplitudes equal roughly four seconds of the
    # old linear drift, with the original small wobble retained on top.
    large_wobble_x = math.sin(phase) * 7.2 + math.sin(phase * 2.0 + 0.35) * 2.0
    large_wobble_y = math.cos(phase + 0.8) * 2.2 + math.sin(phase * 2.0) * 1.5
    fine_wobble_x = -math.sin(phase) * 10.0 + math.sin(phase * 2.0 + 1.4) * 1.5
    fine_wobble_y = math.cos(phase + 2.1) * 4.4 + math.sin(phase * 3.0) * 1.0

    layers = (
        (
            large_lowlights,
            large_wobble_x,
            large_wobble_y,
            0.28,
            progress,
            "multiply",
            phase + 0.00,
            4.2,
            0.038,
            None,
        ),
        (
            fine_lowlights,
            fine_wobble_x,
            fine_wobble_y,
            0.18,
            (progress * 2.0) % 1.0,
            "multiply",
            phase + 1.30,
            2.6,
            0.061,
            None,
        ),
        (
            large_highlights,
            large_wobble_x + 2.0,
            large_wobble_y - 1.0,
            0.32,
            progress,
            "screen",
            phase + 0.70,
            3.7,
            0.036,
            phase * 2.0,
        ),
        (
            fine_highlights,
            fine_wobble_x - 1.0,
            fine_wobble_y + 1.0,
            0.20,
            (progress * 2.0) % 1.0,
            "screen",
            phase + 2.10,
            2.3,
            0.066,
            None,
        ),
    )
    for (
        textures,
        offset_x,
        offset_y,
        alpha,
        morph_progress,
        mode,
        wave_phase,
        wave_amplitude,
        wave_frequency,
        travelling_highlight_phase,
    ) in layers:
        texture_draws = tiled_texture_layer(
            textures,
            pond_x,
            pond_y,
            offset_x,
            offset_y,
            morph_progress,
            wave_phase,
            wave_amplitude,
            wave_frequency,
            alpha,
            travelling_highlight_phase,
        )
        for texture_draw in texture_draws:
            surface = blend(surface, texture_draw, mode=mode)

    for ripple_x, ripple_y, ripple_phase, warp_amount, warp_phase in POND_RIPPLES:
        # A per-ripple periodic phase warp keeps the four rings asynchronous
        # without introducing a discontinuity at the eight-second seam.
        ripple_progress = (
            progress
            + ripple_phase
            + math.sin(phase + warp_phase) * warp_amount
        ) % 1.0
        life = smootherstep(min(1.0, ripple_progress / 0.18)) * (
            1.0 - smootherstep(max(0.0, (ripple_progress - 0.55) / 0.45))
        )
        surface = draw_pixel_ring(
            surface,
            ripple_x - pond_x,
            ripple_y - pond_y,
            5 + round(ripple_progress * 34),
            2 + round(ripple_progress * 10),
            (166, 222, 211),
            life * 0.30,
        )

    for index in range(POND_WAVE_PARTICLE_COUNT):
        particle_cycles = 2 if index % 7 <= 1 else 1
        particle_progress = (
            progress * particle_cycles
            + (pond_hash(index, 19, 0x4CA7) % 1000) / 1000.0
        ) % 1.0
        x = 846 + ((index * 83 + index * index * 17) % 346) + math.sin(
            particle_progress * math.tau
        ) * 4.0
        y = 452 + ((index * 137 + 31) % 444) - particle_progress * 6.0
        pulse = math.sin(particle_progress * math.pi)
        color = (213, 238, 224) if index % 4 == 0 else (131, 200, 200)
        surface = fill_rect(
            surface,
            round(x - pond_x),
            round(y - pond_y),
            2 + index % 5,
            1,
            color,
            pulse * 0.24,
            "screen",
        )

    for index in range(POND_GLIMMER_COUNT):
        glimmer_cycles = 1 + (1 if index % 5 == 0 else 0)
        glimmer_phase = progress * math.tau * glimmer_cycles + index * 1.79
        pulse = (0.5 + math.sin(glimmer_phase) * 0.5) ** 6
        if pulse < 0.14:
            continue
        x = 868 + ((index * 149 + 23) % 320) - pond_x
        y = 472 + ((index * 193 + 71) % 418) - pond_y
        surface = fill_rect(surface, x - 3, y, 7, 1, (230, 244, 215), pulse * 0.58, "screen")
        surface = fill_rect(surface, x, y - 2, 1, 5, (230, 244, 215), pulse * 0.58, "screen")

    surface[..., 3] *= interior_mask.astype(np.float32) / 255.0
    output = surface

    edge_layer = solid_layer(
        FRAME_WIDTH,
        FRAME_HEIGHT,
        (8, 62, 89),
        1.0,
    )
    edge_layer[..., 3] = edge_mask.astype(np.float32) / 255.0
    output = blend(output, edge_layer, mode="multiply", opacity=0.32)

    rim_layer = solid_layer(
        FRAME_WIDTH,
        FRAME_HEIGHT,
        (184, 221, 200),
        1.0,
    )
    rim_layer[..., 3] = rim_mask.astype(np.float32) / 255.0
    return blend(output, rim_layer, mode="screen", opacity=0.16)


def main() -> None:
    pond_x, pond_y, interior_mask, edge_mask, rim_mask = make_pond_masks()
    large_highlights = make_texture_sequence(224, 28, 0x1374, 0.5, (167, 226, 216, 190))
    large_lowlights = make_texture_sequence(224, 28, 0x1374, 0.5, (8, 47, 72, 158))
    fine_highlights = make_texture_sequence(168, 14, 0x5B21, 0.5, (220, 246, 235, 136))
    fine_lowlights = make_texture_sequence(168, 14, 0x5B21, 0.5, (64, 111, 124, 104))

    atlas = np.zeros(
        (ATLAS_CELL_HEIGHT * ATLAS_ROWS, ATLAS_CELL_WIDTH * ATLAS_COLUMNS, 4),
        dtype=np.uint8,
    )
    for frame_index in range(FRAME_COUNT):
        frame = render_frame(
            frame_index / FRAME_COUNT,
            pond_x,
            pond_y,
            interior_mask,
            edge_mask,
            rim_mask,
            large_highlights,
            large_lowlights,
            fine_highlights,
            fine_lowlights,
        )
        frame = np.clip(np.round(frame * 255.0), 0, 255).astype(np.uint8)
        column = frame_index % ATLAS_COLUMNS
        row = frame_index // ATLAS_COLUMNS
        atlas[
            row * ATLAS_CELL_HEIGHT + ATLAS_GUTTER :
                row * ATLAS_CELL_HEIGHT + ATLAS_GUTTER + FRAME_HEIGHT,
            column * ATLAS_CELL_WIDTH + ATLAS_GUTTER :
                column * ATLAS_CELL_WIDTH + ATLAS_GUTTER + FRAME_WIDTH,
        ] = frame

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, mode="RGBA").save(OUTPUT, optimize=True, compress_level=9)
    print(
        f"Wrote {OUTPUT.relative_to(ROOT)}: "
        f"{atlas.shape[1]}x{atlas.shape[0]}, {FRAME_COUNT} frames at {ATLAS_FPS} fps, "
        f"{LOOP_DURATION_MS / 1000:.1f}s loop, "
        f"pond bounds {pond_x},{pond_y},{FRAME_WIDTH},{FRAME_HEIGHT}."
    )


if __name__ == "__main__":
    main()
