from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CANVAS_WIDTH = 850
TEXT_TOP_PADDING = 36
TEXT_BOTTOM_PADDING = 28
BOTTOM_PADDING = 24
TEXT_SIZE = 200
TEXT_LINE_SPACING = 5
TEXT_COLOR = "#000000"
BACKGROUND = "#FFFFFF"
TRANSPARENT = (0, 0, 0, 0)
SYMBOL_WIDTH = 144
SYMBOL_STROKE = 28
SYMBOL_GROUP_SPACING = 72
SYMBOL_TOP_GAP = 5
OUTER_PADDING = 28
PANEL_GAP = 8
PANEL_BORDER_WIDTH = 8

BLUE = "#2166F3"
RED = "#E23D2E"
ORANGE = "#F28C28"
PINK = "#FF9CC8"


def main() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    payload = json.load(sys.stdin)
    title = payload.get("title", "")
    rows = payload.get("rows", [])
    output_dir = Path(payload["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    font = load_font(TEXT_SIZE)
    files: list[dict[str, str]] = []
    seen_names: dict[str, int] = {}

    normalized_rows = [
        {"text": text, "symbols": row.get("symbols", [])}
        for row in rows
        if (text := normalize_text(row.get("text", "")))
    ]

    for panel_count, image in render_images(normalized_rows, font):
        filename = uniquify_filename(
            build_composite_filename(build_filename_base(title), panel_count),
            seen_names,
        )
        image_path = output_dir / filename
        image.save(image_path, format="PNG")
        files.append({"name": filename, "outputPath": str(image_path)})

    json.dump({"files": files}, sys.stdout)


def normalize_text(value: str) -> str:
    lines = [line.rstrip() for line in value.replace("\r\n", "\n").split("\n")]
    trimmed = [line for line in lines if line.strip()]
    return "\n".join(trimmed)


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/YuGothB.ttc",
        "C:/Windows/Fonts/meiryob.ttc",
        "C:/Windows/Fonts/BIZ-UDGothicB.ttc",
        "C:/Windows/Fonts/YuGothM.ttc",
        "C:/Windows/Fonts/YuGothR.ttc",
        "C:/Windows/Fonts/meiryo.ttc",
        "C:/Windows/Fonts/msgothic.ttc",
        "C:/Windows/Fonts/BIZ-UDGothicR.ttc",
        "C:/Windows/Fonts/seguiemj.ttf",
        "arial.ttf",
        "Arial.ttf",
        "DejaVuSans.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]

    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue

    return ImageFont.load_default()


def build_filename_base(title: str) -> str:
    return sanitize_filename(title) or "generated-images"


def build_composite_filename(base_name: str, panel_count: int) -> str:
    return f"{base_name}_panels_1_to_{panel_count}.png"


def sanitize_filename(value: str) -> str:
    illegal = '<>:"/\\|?*'
    cleaned = "".join(ch for ch in value.strip() if ch not in illegal and ord(ch) >= 32)
    compact = "_".join(cleaned.split())
    return compact[:80].rstrip(".")


def render_images(
    rows: list[dict[str, object]],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
) -> list[tuple[int, Image.Image]]:
    panel_images = [
        render_panel_image(
            row["text"],
            row["symbols"],
            font,
        )
        for row in rows
    ]

    full_height = (
        sum(panel.height for panel in panel_images)
        + max(0, len(panel_images) - 1) * PANEL_GAP
        + OUTER_PADDING * 2
    )
    full_width = CANVAS_WIDTH + OUTER_PADDING * 2
    images: list[tuple[int, Image.Image]] = []

    for panel_count in range(1, len(panel_images) + 1):
        image = Image.new("RGBA", (full_width, full_height), TRANSPARENT)
        current_top = OUTER_PADDING

        for panel in panel_images[:panel_count]:
            image.alpha_composite(panel, (OUTER_PADDING, current_top))
            current_top += panel.height + PANEL_GAP

        images.append((panel_count, image))

    return images


def render_panel_image(
    text: object,
    symbols: object,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
) -> Image.Image:
    text_value = text if isinstance(text, str) else ""
    symbol_values = [symbol for symbol in symbols if symbol != "-"] if isinstance(symbols, list) else []
    text_bbox = measure_text_block(text_value, font)
    text_height = (text_bbox[3] - text_bbox[1]) + TEXT_TOP_PADDING + TEXT_BOTTOM_PADDING
    panel_height = text_height + SYMBOL_TOP_GAP + SYMBOL_WIDTH + BOTTOM_PADDING
    image = Image.new("RGBA", (CANVAS_WIDTH, panel_height), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw.rectangle(
        (0, 0, CANVAS_WIDTH - 1, panel_height - 1),
        outline=PINK,
        width=PANEL_BORDER_WIDTH,
    )
    draw_text_block(draw, text_value, font, text_bbox)
    draw_symbol_block(draw, symbol_values, text_height)
    return image


def draw_text_block(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    text_bbox: tuple[int, int, int, int],
) -> None:
    text_width = text_bbox[2] - text_bbox[0]
    x = OUTER_PADDING + (CANVAS_WIDTH - text_width) / 2 - text_bbox[0]
    y = OUTER_PADDING + TEXT_TOP_PADDING - text_bbox[1]
    draw.multiline_text(
        (x, y),
        text,
        fill=TEXT_COLOR,
        font=font,
        align="center",
        spacing=TEXT_LINE_SPACING,
    )


def draw_symbol_block(
    draw: ImageDraw.ImageDraw,
    symbols: list[str],
    text_height: int,
) -> None:
    if not symbols:
        return

    count = len(symbols)
    total_width = count * SYMBOL_WIDTH + (count - 1) * SYMBOL_GROUP_SPACING
    start_x = OUTER_PADDING + (CANVAS_WIDTH - total_width) / 2
    top_y = OUTER_PADDING + text_height + SYMBOL_TOP_GAP

    for index, symbol in enumerate(symbols):
        left = start_x + index * (SYMBOL_WIDTH + SYMBOL_GROUP_SPACING)
        if symbol == "circle":
            draw_circle(draw, left, top_y)
        elif symbol == "cross":
            draw_cross(draw, left, top_y)
        elif symbol == "triangle":
            draw_triangle(draw, left, top_y)


def draw_circle(draw: ImageDraw.ImageDraw, left: float, top: float) -> None:
    bounds = [left, top, left + SYMBOL_WIDTH, top + SYMBOL_WIDTH]
    draw.ellipse(bounds, outline=BLUE, width=SYMBOL_STROKE)


def draw_cross(draw: ImageDraw.ImageDraw, left: float, top: float) -> None:
    inset = 18
    right = left + SYMBOL_WIDTH
    bottom = top + SYMBOL_WIDTH
    draw.line(
        [(left + inset, top + inset), (right - inset, bottom - inset)],
        fill=RED,
        width=SYMBOL_STROKE + 12,
    )
    draw.line(
        [(right - inset, top + inset), (left + inset, bottom - inset)],
        fill=RED,
        width=SYMBOL_STROKE + 12,
    )


def draw_triangle(draw: ImageDraw.ImageDraw, left: float, top: float) -> None:
    right = left + SYMBOL_WIDTH
    bottom = top + SYMBOL_WIDTH
    points = [
        ((left + right) / 2, top + 8),
        (right - 10, bottom - 12),
        (left + 10, bottom - 12),
    ]
    draw.polygon(points, outline=ORANGE, width=SYMBOL_STROKE)


def uniquify_filename(filename: str, seen_names: dict[str, int]) -> str:
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    count = seen_names.get(filename, 0)

    if count == 0:
        seen_names[filename] = 1
        return filename

    while True:
        candidate = f"{stem}_{count + 1}{suffix}"
        if candidate not in seen_names:
            seen_names[filename] = count + 1
            seen_names[candidate] = 1
            return candidate
        count += 1


def measure_text_block(
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
) -> tuple[int, int, int, int]:
    image = Image.new("RGBA", (CANVAS_WIDTH, 2000), BACKGROUND)
    draw = ImageDraw.Draw(image)
    return draw.multiline_textbbox(
        (0, 0),
        text,
        font=font,
        spacing=TEXT_LINE_SPACING,
        align="center",
    )


if __name__ == "__main__":
    main()
