"""Paper artifacts: claims (with how the shelf's other papers bear on them) and formulas.

A claim pill counts the accepted claim ↔ claim edges on the claim (`relate-claims`), keyed
by the id `sync_claims` gives it (`papers.claims.claim_id`), so the count follows the
claim through new versions. A formula of `explain-math` is a math pill: the formula, its
name, the plain-words reading, and its "try it" question when there is one (an active pill).
"""

from app.models.enums import PillKind
from app.papers.claims import claim_id
from app.pills.contract import ClaimBody, ClaimSupport, MathBody, TryIt
from app.pills.harvest.base import (
    HarvestInput,
    PillDraft,
    build,
    clean_cites,
    draft,
    items,
    spans_cites,
    spans_text,
    within_bounds,
)

SUPPORT_RELATIONS = ("supports", "contradicts", "extends")


def harvest_claims(inp: HarvestInput) -> list[PillDraft]:
    out: list[PillDraft] = []
    for claim in items(inp.artifact.body.get("claims")):
        text = str(claim.get("text") or "").strip()
        cites = clean_cites(claim.get("cites", []))
        if not cites or not within_bounds(text):
            continue
        counts = inp.context.claim_support.get(claim_id(inp.context.document_id, text), {})
        body = build(
            ClaimBody,
            text=text,
            claim_kind=claim.get("kind"),
            strength=claim.get("strength"),
            support=ClaimSupport(**{r: int(counts.get(r, 0)) for r in SUPPORT_RELATIONS}),
        )
        if body is not None and (
            pill := draft(inp, PillKind.CLAIM, body, content=text, cites=cites)
        ):
            out.append(pill)
    return out


def harvest_math(inp: HarvestInput) -> list[PillDraft]:
    out: list[PillDraft] = []
    for formula in items(inp.artifact.body.get("formulas")):
        plain = items(formula.get("in_plain_words"))
        raw_try = formula.get("try_it")
        try_it = None
        if isinstance(raw_try, dict):
            question = spans_text(items(raw_try.get("question")))
            try_it = build(TryIt, question=question, answer=items(raw_try.get("answer")))
        body = build(
            MathBody,
            latex=formula.get("latex"),
            name=formula.get("name"),
            plain=plain,
            try_it=try_it,
        )
        anchor = formula.get("anchor") if isinstance(formula.get("anchor"), str) else None
        if body is None:
            continue
        cites = clean_cites([anchor, *spans_cites(plain)])
        pill = draft(inp, PillKind.MATH, body, content=body.latex, cites=cites, anchor=anchor)
        if pill is not None:
            out.append(pill)
    return out
