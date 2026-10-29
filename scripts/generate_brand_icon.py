import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib.sfnt import WOFFFlavorData


ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "resources" / "studio-activity.svg"
OUTPUT = ROOT / "resources" / "studio-icon.woff"
SVG_NAMESPACE = "{http://www.w3.org/2000/svg}"


def main():
    svg_bytes = SVG.read_bytes().replace(b"\r\n", b"\n")
    svg = ET.fromstring(svg_bytes)
    if svg.tag != f"{SVG_NAMESPACE}svg" or svg.get("viewBox") != "0 0 64 64":
        raise ValueError("The studio icon must use the 64 by 64 SVG viewBox")
    if (
        svg.get("fill") != "currentColor"
        or set(svg.attrib) != {"width", "height", "viewBox", "fill"}
        or not len(svg)
    ):
        raise ValueError("The studio icon must contain monochrome filled paths")

    glyph_pen = TTGlyphPen(None)
    quadratic_pen = Cu2QuPen(glyph_pen, max_err=1, reverse_direction=False)
    pen = TransformPen(quadratic_pen, (14, 0, 0, -14, 52, 798))
    for element in svg:
        if (
            element.tag != f"{SVG_NAMESPACE}path"
            or set(element.attrib) != {"d"}
            or not element.attrib["d"]
            or len(element)
        ):
            raise ValueError("The studio icon must contain only untransformed paths")
        parse_path(element.attrib["d"], pen)

    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder([".notdef", "studio"])
    builder.setupCharacterMap({0xE001: "studio"})
    builder.setupGlyf({
        ".notdef": TTGlyphPen(None).glyph(),
        "studio": glyph_pen.glyph(),
    })
    builder.setupHorizontalMetrics({".notdef": (1000, 0), "studio": (1000, 0)})
    builder.setupHorizontalHeader(ascent=850, descent=-150)
    builder.setupNameTable({
        "familyName": "Docker and Podman Studio Icons",
        "styleName": "Regular",
        "uniqueFontIdentifier": "DockerPodmanStudioIcons-Regular",
        "fullName": "Docker and Podman Studio Icons",
        "psName": "DockerPodmanStudioIcons-Regular",
        "version": "Version 1.0",
    })
    builder.setupOS2(
        sTypoAscender=850, sTypoDescender=-150, usWinAscent=850, usWinDescent=150
    )
    builder.setupPost()
    builder.setupMaxp()
    builder.font["head"].created = 3786912000
    builder.font["head"].modified = 3786912000
    builder.font.recalcTimestamp = False
    builder.font.flavor = "woff"
    # The private block lets tests detect a font generated from an older SVG.
    builder.font.flavorData = WOFFFlavorData()
    builder.font.flavorData.privData = hashlib.sha256(svg_bytes).hexdigest().encode("ascii")
    builder.font.save(OUTPUT)
    print(f"Generated {OUTPUT}")


if __name__ == "__main__":
    main()
