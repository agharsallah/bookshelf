"""Figure descriptions: the figure's crop with its one-sentence takeaway.

`describe-figure` writes a `figure_description` per figure node (artifact anchor = the
figure). The image is the node's crop (`meta.image_path`, under `media_dir`), served by
the media route; a figure without a crop, or described with low confidence, is skipped.
"""

from app.models.enums import PillKind
from app.pills.contract import FigureBody
from app.pills.harvest.base import HarvestInput, PillDraft, build, draft, spans_cites

MEDIA_ROUTE = "media"


def media_url(image_path: str) -> str:
    """A crop's URL relative to the API base, as the reader builds it."""
    return f"{MEDIA_ROUTE}/{image_path.lstrip('/')}"


def harvest_figure(inp: HarvestInput) -> list[PillDraft]:
    body_in = inp.artifact.body
    anchor = inp.artifact.anchor
    image = inp.context.figures.get(anchor) if anchor else None
    takeaway = body_in.get("takeaway")
    if not image or not isinstance(takeaway, dict) or body_in.get("confidence") == "low":
        return []
    caption = body_in.get("caption")
    body = build(
        FigureBody,
        image_url=media_url(image),
        caption=caption if isinstance(caption, str) else None,
        takeaway=[takeaway],
    )
    if body is None:
        return []
    cites = [anchor, *spans_cites(body.model_dump()["takeaway"])] if anchor else []
    pill = draft(inp, PillKind.FIGURE, body, content=str(takeaway.get("text")), cites=cites)
    return [pill] if pill is not None else []
