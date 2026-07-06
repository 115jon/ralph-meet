from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ICON = ROOT / "desktop" / "src-tauri" / "icons" / "icon.png"
OUTPUT_ICO = ROOT / "public" / "favicon-dev.ico"
OUTPUT_PNG = ROOT / "public" / "favicon-dev.png"


def main() -> None:
    source = Image.open(SOURCE_ICON).convert("RGBA")
    alpha = source.getchannel("A")
    grayscale = ImageOps.grayscale(source)

    # Keep the original silhouette and shading, but remap the tone range to green.
    green_icon = ImageOps.colorize(
        grayscale,
        black="#052e16",
        white="#4ade80",
        mid="#16a34a",
    ).convert("RGBA")
    green_icon.putalpha(alpha)

    OUTPUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    green_icon.save(OUTPUT_PNG)
    green_icon.save(OUTPUT_ICO, sizes=[(16, 16), (32, 32), (48, 48)])


if __name__ == "__main__":
    main()
