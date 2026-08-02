#!/usr/bin/env python3
"""Build openx402 SVG logo and social artwork with outlined brand type."""

from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[1]
ARCHIVO = ROOT / "fonts/Archivo-Variable.ttf"
PLEX_REGULAR = ROOT / "fonts/IBMPlexMono-Regular.ttf"
PLEX_MEDIUM = ROOT / "fonts/IBMPlexMono-Medium.ttf"

MARK_LEFT = "M7 6h33v21H26v14l13 9-13 10v14h14v20H7Z"
MARK_RIGHT = "M93 6H61v21h14v14l-13 9 13 10v14H61v20h32Z"


@lru_cache(maxsize=None)
def load_font(path: str, width: int | None = None, weight: int | None = None):
    font = TTFont(path)
    if width is not None or weight is not None:
        location = {}
        if width is not None:
            location["wdth"] = width
        if weight is not None:
            location["wght"] = weight
        font = instantiateVariableFont(font, location, inplace=False)
    return font


def outlined_text(
    text: str,
    *,
    font_path: Path,
    size: float,
    x: float,
    baseline: float,
    fill: str,
    letter_spacing: float = 0,
    width: int | None = None,
    weight: int | None = None,
) -> str:
    font = load_font(str(font_path), width, weight)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    units_per_em = font["head"].unitsPerEm
    scale = size / units_per_em
    tracking_units = letter_spacing / scale if scale else 0
    cursor = 0.0
    paths: list[str] = []

    for index, char in enumerate(text):
        glyph_name = cmap.get(ord(char))
        if glyph_name is None:
            raise ValueError(f"Missing glyph {char!r} in {font_path.name}")
        pen = SVGPathPen(glyph_set)
        glyph_set[glyph_name].draw(pen)
        commands = pen.getCommands()
        if commands:
            paths.append(
                f'<path d="{commands}" transform="translate({cursor:.3f} 0)"/>'
            )
        cursor += hmtx[glyph_name][0]
        if index != len(text) - 1:
            cursor += tracking_units

    return (
        f'<g fill="{fill}" transform="translate({x:g} {baseline:g}) '
        f'scale({scale:.6f} {-scale:.6f})">'
        + "".join(paths)
        + "</g>"
    )


def mark_group(fill: str, transform: str = "") -> str:
    attr = f' transform="{transform}"' if transform else ""
    return (
        f'<g fill="{fill}"{attr}>'
        f'<path d="{MARK_LEFT}"/><path d="{MARK_RIGHT}"/>'
        "</g>"
    )


def wordmark(fill: str, *, size: float, x: float, baseline: float) -> str:
    return outlined_text(
        "openx402",
        font_path=ARCHIVO,
        width=100,
        weight=600,
        size=size,
        x=x,
        baseline=baseline,
        fill=fill,
        letter_spacing=-0.35 * (size / 68),
    )


def display(text: str, *, size: float, x: float, baseline: float, fill: str) -> str:
    return outlined_text(
        text,
        font_path=ARCHIVO,
        width=85,
        weight=700,
        size=size,
        x=x,
        baseline=baseline,
        fill=fill,
        letter_spacing=-0.8 * (size / 76),
    )


def mono(
    text: str,
    *,
    size: float,
    x: float,
    baseline: float,
    fill: str,
    letter_spacing: float = 0,
    medium: bool = False,
) -> str:
    return outlined_text(
        text,
        font_path=PLEX_MEDIUM if medium else PLEX_REGULAR,
        size=size,
        x=x,
        baseline=baseline,
        fill=fill,
        letter_spacing=letter_spacing,
    )


def svg_document(view_box: str, label: str, body: str, defs: str = "") -> str:
    defs_block = f"<defs>{defs}</defs>" if defs else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" '
        f'role="img" aria-label="{escape(label)}">{defs_block}{body}</svg>\n'
    )


def build_lockups() -> None:
    svg_dir = ROOT / "logo/svg"
    colors = {
        "lockup-primary-dark.svg": ("#FFD21C", "#F4F0E6", "primary logo for dark backgrounds"),
        "lockup-primary-light.svg": ("#FFD21C", "#111111", "primary logo for light backgrounds"),
        "lockup-yellow.svg": ("#FFD21C", "#FFD21C", "logo, yellow"),
        "lockup-black.svg": ("#111111", "#111111", "logo, black"),
        "lockup-white.svg": ("#FFFFFF", "#FFFFFF", "logo, white"),
    }
    for filename, (mark_fill, type_fill, label) in colors.items():
        body = (
            '<g transform="translate(32 -0.5)">'
            + mark_group(mark_fill)
            + wordmark(type_fill, size=68, x=120, baseline=69)
            + "</g>"
        )
        (svg_dir / filename).write_text(
            svg_document("0 0 500 100", f"openx402 {label}", body),
            encoding="utf-8",
        )

    wordmark_colors = {
        "wordmark-black.svg": "#111111",
        "wordmark-white.svg": "#FFFFFF",
        "wordmark-yellow.svg": "#FFD21C",
    }
    for filename, fill in wordmark_colors.items():
        body = wordmark(fill, size=136, x=16, baseline=138)
        (svg_dir / filename).write_text(
            svg_document("0 0 660 170", f"openx402 wordmark, {filename[9:-4]}", body),
            encoding="utf-8",
        )


def build_github() -> str:
    defs = (
        '<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">'
        '<path d="M40 0H0V40" fill="none" stroke="#F4F0E6" stroke-opacity=".08"/>'
        "</pattern>"
    )
    body = "".join(
        [
            '<rect width="1280" height="640" fill="#111111"/>',
            '<rect width="1280" height="640" fill="url(#grid)"/>',
            '<path d="M894 0h386v640H740l72-78-48-68 79-83-37-69 70-86-46-78 71-74-40-58Z" fill="#FFD21C"/>',
            mark_group("#FFD21C", "translate(86 82) scale(2.1)"),
            wordmark("#F4F0E6", size=78, x=315, baseline=183),
            display("AGENTS PAY.", size=62, x=90, baseline=355, fill="#F4F0E6"),
            display("THE WEB OPENS.", size=62, x=90, baseline=415, fill="#F4F0E6"),
            '<rect x="90" y="470" width="154" height="44" fill="none" stroke="#FFD21C"/>',
            mono("SELF-HOSTED", size=17, x=108, baseline=499, fill="#FFD21C", letter_spacing=0.7, medium=True),
            '<rect x="262" y="470" width="110" height="44" fill="none" stroke="#5D5B56"/>',
            mono("STELLAR", size=17, x=279, baseline=499, fill="#F4F0E6", letter_spacing=0.7, medium=True),
            '<rect x="390" y="470" width="92" height="44" fill="none" stroke="#5D5B56"/>',
            mono("X402", size=17, x=408, baseline=499, fill="#F4F0E6", letter_spacing=0.7, medium=True),
            '<path d="M90 565h583" stroke="#F4F0E6" stroke-opacity=".38"/>',
            '<circle cx="90" cy="565" r="7" fill="#FFD21C"/>',
            '<circle cx="381" cy="565" r="7" fill="#FFD21C"/>',
            '<circle cx="673" cy="565" r="7" fill="#FFD21C"/>',
        ]
    )
    return svg_document("0 0 1280 640", "openx402 GitHub social preview", body, defs)


def build_feed_square() -> str:
    defs = (
        '<pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse">'
        '<path d="M54 0H0V54" fill="none" stroke="#F4F0E6" stroke-opacity=".08"/>'
        "</pattern>"
    )
    body = "".join(
        [
            '<rect width="1080" height="1080" fill="#111111"/>',
            '<rect width="1080" height="1080" fill="url(#grid)"/>',
            '<path d="M0 770c166-58 290 45 452 3 163-43 293-9 628 104v203H0Z" fill="#FFD21C"/>',
            mark_group("#FFD21C", "translate(90 88) scale(3.2)"),
            wordmark("#F4F0E6", size=104, x=90, baseline=536),
            display("AGENTS PAY.", size=76, x=90, baseline=654, fill="#F4F0E6"),
            display("THE WEB OPENS.", size=76, x=90, baseline=730, fill="#F4F0E6"),
            mono("DISCOVER  →  PAY  →  CONTINUE", size=22, x=90, baseline=997, fill="#111111", letter_spacing=3, medium=True),
        ]
    )
    return svg_document("0 0 1080 1080", "openx402 square social post", body, defs)


def build_feed_portrait() -> str:
    body = "".join(
        [
            '<rect width="1080" height="1350" fill="#FFD21C"/>',
            '<path d="M0 0h1080v430L990 395l44-57-76-51 53-64-81-67 50-62-72-94Z" fill="#111111"/>',
            mark_group("#111111", "translate(90 78) scale(2.7)"),
            display("AGENTS PAY.", size=126, x=90, baseline=640, fill="#111111"),
            display("THE WEB", size=126, x=90, baseline=760, fill="#111111"),
            display("OPENS.", size=126, x=90, baseline=880, fill="#111111"),
            '<path d="M90 1010h900" stroke="#111111" stroke-width="3"/>',
            '<circle cx="90" cy="1010" r="11" fill="#111111"/>',
            '<circle cx="540" cy="1010" r="11" fill="#111111"/>',
            '<circle cx="990" cy="1010" r="11" fill="#111111"/>',
            mono("DISCOVER", size=21, x=90, baseline=1070, fill="#111111", letter_spacing=3, medium=True),
            mono("PAY", size=21, x=495, baseline=1070, fill="#111111", letter_spacing=3, medium=True),
            mono("CONTINUE", size=21, x=845, baseline=1070, fill="#111111", letter_spacing=3, medium=True),
            wordmark("#111111", size=62, x=90, baseline=1260),
        ]
    )
    return svg_document("0 0 1080 1350", "openx402 portrait social post", body)


def build_avatar() -> str:
    body = "".join(
        [
            '<rect width="400" height="400" rx="52" fill="#111111"/>',
            mark_group("#FFD21C", "scale(4)"),
        ]
    )
    return svg_document("0 0 400 400", "openx402 profile image", body)


def main() -> None:
    build_lockups()

    github = build_github()
    (ROOT / "social/github-social-preview.svg").write_text(github, encoding="utf-8")
    (ROOT / "github-social-preview.svg").write_text(github, encoding="utf-8")
    (ROOT / "social/feed-square.svg").write_text(build_feed_square(), encoding="utf-8")
    (ROOT / "social/feed-portrait.svg").write_text(build_feed_portrait(), encoding="utf-8")
    avatar = build_avatar()
    (ROOT / "social/avatar.svg").write_text(avatar, encoding="utf-8")
    (ROOT / "social-avatar.svg").write_text(avatar, encoding="utf-8")


if __name__ == "__main__":
    main()
