"""Builds the installer's embedded fonts (desktop/installer/Assets/Fonts/*.ttf).

WPF on .NET Framework cannot read WOFF2 or pick a variable-font instance, so
this cuts static TrueType instances of the app's own fonts (the Fontsource
packages in node_modules, SIL OFL 1.1) at the weights the installer uses,
renames each to its own family and subsets it to Latin.

    pip install fonttools brotli
    python desktop/scripts/build-installer-fonts.py [path/to/node_modules]
"""

import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[2]
MODULES = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "node_modules"
OUT = ROOT / "desktop" / "installer" / "Assets" / "Fonts"
SRC = MODULES / "@fontsource-variable"

ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
EXTRA = "\u00a0\u00b7\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u2022"
LATIN1 = "".join(chr(c) for c in range(0xA0, 0x100))

# (file, family, source, axes, weight class, text to keep or None for all, tracking in em)
# WPF has no letter-spacing, so each face's CSS letter-spacing is baked into its advances.
INSTANCES = [
    ("Display-ExtraBold.ttf", "RM Bricolage Title", "bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2",
     {"wght": 800, "opsz": 28, "wdth": 100}, 800, ASCII + EXTRA + LATIN1, -0.03),
    ("Display-SemiBold.ttf", "RM Bricolage Key", "bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2",
     {"wght": 600, "opsz": 15, "wdth": 100}, 600, ASCII + EXTRA + LATIN1, 0),
    ("Geist-Regular.ttf", "RM Geist", "geist/files/geist-latin-wght-normal.woff2", {"wght": 400}, 400, None, 0),
    ("Geist-Medium.ttf", "RM Geist Medium", "geist/files/geist-latin-wght-normal.woff2", {"wght": 500}, 500, None, 0),
    ("Silk-Condensed.ttf", "RM Martian Silk", "martian-mono/files/martian-mono-latin-standard-normal.woff2",
     {"wght": 500, "wdth": 90}, 500, ASCII + EXTRA, 0.08),
    ("Silk-Wide.ttf", "RM Martian Silk Wide", "martian-mono/files/martian-mono-latin-standard-normal.woff2",
     {"wght": 600, "wdth": 100}, 600, ASCII + EXTRA, 0.10),
    ("Num-Medium.ttf", "RM Martian Num", "martian-mono/files/martian-mono-latin-standard-normal.woff2",
     {"wght": 500, "wdth": 100}, 500, ASCII + EXTRA, 0),
]


def rename(font, family):
    name = font["name"]
    keep = {0, 7, 8, 9, 11, 12, 13, 14}  # copyright, trademark, maker, license text and URL
    name.names = [n for n in name.names if n.nameID in keep]
    for name_id, value in ((1, family), (2, "Regular"), (3, family + ";Regular"), (4, family), (6, family.replace(" ", "") + "-Regular")):
        name.setName(value, name_id, 3, 1, 0x409)
    name.setName("This Font Software is licensed under the SIL Open Font License, Version 1.1.", 13, 3, 1, 0x409)
    name.setName("https://openfontlicense.org", 14, 3, 1, 0x409)


def track(font, em):
    if not em:
        return
    delta = round(font["head"].unitsPerEm * em)
    metrics = font["hmtx"].metrics
    for glyph, (advance, lsb) in metrics.items():
        if advance > 0:
            metrics[glyph] = (max(0, advance + delta), lsb)
    font["hhea"].advanceWidthMax = max(a for a, _ in metrics.values())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for file_name, family, source, axes, weight, text, tracking in INSTANCES:
        font = TTFont(SRC / source)
        font.flavor = None
        font = instantiateVariableFont(font, axes)
        rename(font, family)
        font["OS/2"].usWeightClass = weight
        font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~0b1100001) | 0b1000000  # REGULAR only
        font["head"].macStyle = 0
        options = Options()
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.layout_features = ["*"]
        options.notdef_outline = True
        options.hinting = False
        subsetter = Subsetter(options)
        if text is None:
            subsetter.populate(unicodes=font.getBestCmap().keys())
        else:
            subsetter.populate(text=text)
        subsetter.subset(font)
        track(font, tracking)
        font.save(OUT / file_name)
        print(f"{file_name}: {(OUT / file_name).stat().st_size} bytes")


if __name__ == "__main__":
    main()
