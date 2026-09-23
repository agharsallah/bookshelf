"""Region classifier: the non-prose parts of a page (§8 D17).

Runs before prose so text inside a table, a figure or a box never becomes a paragraph:

- **table**: `page.find_tables()` (only on pages with ruling lines) → one `table` block;
- **aside**: a stroked or filled rectangle enclosing text → one `aside` block;
- **figure**: embedded images and clusters of vector drawings → one `figure` block with a
  crop request, paired with the nearest `Figure N.M` caption.
"""

import re
from dataclasses import dataclass, field

import pymupdf

from app.models.enums import NodeKind
from app.pipeline.parse.model import Bbox, Crop, ParsedNode
from app.pipeline.parse.pdf import geometry as geo
from app.pipeline.parse.pdf import mupdf
from app.pipeline.parse.pdf.layout import Block
from app.pipeline.parse.text import FIGURE_CAPTION, TABLE_CAPTION, aside_label, table_text

_CAPTION_GAP = 72.0  # max vertical distance between a graphic and its caption (pt)
_CLUSTER_PAD = 8.0  # drawings closer than this belong to the same figure


@dataclass
class Region:
    bbox: Bbox
    node: ParsedNode


@dataclass
class PageRegions:
    regions: list[Region] = field(default_factory=list)
    blocks: list[Block] = field(default_factory=list)  # what is left for the prose path
    warnings: list[str] = field(default_factory=list)

    def absorb(self, area: Bbox) -> list[Block]:
        """Remove and return the blocks centred inside `area`."""
        inside = [b for b in self.blocks if geo.center_in(b.bbox, area)]
        self.blocks = [b for b in self.blocks if b not in inside]
        return inside

    def take_caption(self, area: Bbox, pattern: re.Pattern[str]) -> tuple[Block, str] | None:
        """Pop the nearest caption below (preferred) or above `area` that overlaps it."""
        best: tuple[float, Block] | None = None
        for block in self.blocks:
            x0, y0, x1, y1 = block.bbox
            if not pattern.match(block.text) or x1 < area[0] or x0 > area[2]:
                continue
            below, above = y0 - area[3], area[1] - y1
            if below >= -2:
                gap = below
            elif above >= -2:
                gap = above + 0.5  # on a tie, the caption below wins
            else:
                continue
            if gap <= _CAPTION_GAP and (best is None or gap < best[0]):
                best = (gap, block)
        if best is None:
            return None
        self.blocks.remove(best[1])
        number = pattern.match(best[1].text)
        return best[1], number.group(1) if number else ""


def _cell(value: str | None) -> str:
    return " ".join((value or "").split())


def _tables(page: pymupdf.Page, page_no: int, out: PageRegions) -> list[Bbox]:
    areas: list[Bbox] = []
    for table in mupdf.tables(page):
        rows = [[_cell(c) for c in row] for row in table.rows]
        if table.header is not None:
            header, body = [_cell(n) for n in table.header], rows
        else:
            header, body = (rows[0], rows[1:]) if rows else ([], [])
        if len(header) < 2 or not body:
            continue  # a single framed cell is a box, not a table
        areas.append(table.bbox)
        out.absorb(table.bbox)
        meta: dict[str, object] = {"table": {"header": header, "rows": body}, "caption": None}
        region = table.bbox
        if caption := out.take_caption(table.bbox, TABLE_CAPTION):
            meta["caption"], meta["table_no"] = caption[0].text, caption[1]
            region = geo.union([region, caption[0].bbox])
        meta |= {"page": page_no, "bbox": list(table.bbox)}
        node = ParsedNode(
            NodeKind.TABLE, text=table_text(header, body), page_from=page_no, page_to=page_no,
            meta=meta,
        )  # fmt: skip
        out.regions.append(Region(region, node))
    return areas


def _asides(paths: list[mupdf.Drawing], page_no: int, out: PageRegions) -> list[Bbox]:
    boxes: list[Bbox] = []
    for path in paths:
        box = path.bbox
        if not path.box or box[2] - box[0] < 80 or box[3] - box[1] < 24:
            continue
        framed = sum(1 for p in paths if p is not path and geo.contains(box, p.bbox))
        inner = [b for b in out.blocks if geo.center_in(b.bbox, box)]
        if not inner or framed >= 3:
            continue  # an empty frame, or a framed diagram
        boxes.append(box)
        out.absorb(box)
        first, rest = inner[0].text, [b.text for b in inner[1:]]
        label: str | None = None
        if parsed := aside_label(first):
            label, first = parsed
        elif inner[0].bold and len(first.split()) <= 6 and rest:
            label, first = first, ""
        node = ParsedNode(
            NodeKind.ASIDE, text="\n".join(t for t in [first, *rest] if t), page_from=page_no,
            page_to=page_no, meta={"label": label, "page": page_no, "bbox": list(box)},
        )  # fmt: skip
        out.regions.append(Region(box, node))
    return boxes


def cluster(boxes: list[Bbox]) -> list[tuple[Bbox, int]]:
    """Union boxes that touch once padded; one `(bounding box, member count)` per cluster."""
    clusters: list[tuple[Bbox, int]] = []
    for box in boxes:
        merged, count = box, 1
        keep: list[tuple[Bbox, int]] = []
        for other, n in clusters:
            if geo.intersects(geo.pad(merged, _CLUSTER_PAD), other):
                merged, count = geo.union([merged, other]), count + n
            else:
                keep.append((other, n))
        clusters = [*keep, (merged, count)]
    return sorted(clusters, key=lambda c: (c[0][1], c[0][0]))


def _figures(
    page: pymupdf.Page,
    page_no: int,
    paths: list[mupdf.Drawing],
    excluded: list[Bbox],
    out: PageRegions,
    *,
    scanned: bool,
) -> None:
    page_box = mupdf.page_box(page)
    page_area = geo.area(page_box)
    boxes: list[Bbox] = []
    images: list[Bbox] = []
    for raw in mupdf.image_boxes(page):
        box = geo.clip(raw, page_box)
        big_enough = box[2] - box[0] >= 24 and box[3] - box[1] >= 24
        if big_enough and not (scanned and geo.area(box) > page_area * 0.5):
            boxes.append(box)
            images.append(box)
    for path in paths:
        box = path.bbox
        rule = (box[2] - box[0] < 3 or box[3] - box[1] < 3) and path.items <= 1
        if rule or geo.area(box) > page_area * 0.9:
            continue  # separators and page backgrounds
        if not any(geo.intersects(box, area) for area in excluded):
            boxes.append(box)
    for area, members in cluster(boxes):
        has_image = any(geo.contains(area, image) for image in images)
        small = area[3] - area[1] < 30 or (members < 3 and geo.area(area) < 4000)
        if small and not has_image:
            continue
        area = geo.clip(area, page_box)
        out.absorb(area)  # axis labels and callouts inside the graphic
        meta: dict[str, object] = {"caption": None, "figure_no": None}
        region = area
        if caption := out.take_caption(area, FIGURE_CAPTION):
            meta = {"caption": caption[0].text, "figure_no": caption[1]}
            region = geo.union([area, caption[0].bbox])
        meta |= {"page": page_no, "bbox": list(area)}
        node = ParsedNode(
            NodeKind.FIGURE, text=str(meta["caption"] or ""), page_from=page_no,
            page_to=page_no, meta=meta, crop=Crop(page_no, area),
        )  # fmt: skip
        out.regions.append(Region(region, node))
    for block in out.blocks:
        if FIGURE_CAPTION.match(block.text):
            out.warnings.append(f"page {page_no}: figure caption without a detected graphic")


def classify_regions(
    page: pymupdf.Page, page_no: int, blocks: list[Block], *, scanned: bool = False
) -> PageRegions:
    """Split one page into region blocks (table / aside / figure) and leftover prose."""
    out = PageRegions(blocks=list(blocks))
    paths = [] if scanned else mupdf.drawings(page)
    ruling = sum(p.items for p in paths)
    tables = _tables(page, page_no, out) if ruling >= 4 else []
    paths = [p for p in paths if not any(geo.contains(geo.pad(t, 2), p.bbox) for t in tables)]
    boxes = _asides(paths, page_no, out)
    loose = [p for p in paths if p.bbox not in boxes]
    _figures(page, page_no, loose, [*tables, *boxes], out, scanned=scanned)
    return out
