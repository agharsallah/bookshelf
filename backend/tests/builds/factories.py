"""Builders for the build tests: a paper the shelf knows well, a fake machine, a valid plan."""

import json
from collections.abc import Sequence
from typing import Any

from sqlmodel import Session

from app.core.config import get_settings
from app.models import Claim, Document
from app.models.enums import ArtifactType, ClaimKind, ClaimStrength, Review
from tests.api.factories import make_artifact
from tests.papers.conftest import make_paper

GOAL = "A minimal PyTorch implementation of the gated reader, for learning."


def span(text: str, *cites: str) -> dict[str, Any]:
    return {"text": text, "cites": list(cites)}


CARD: dict[str, Any] = {
    "tldr": [span("A gate scores each passage before the reader sees it [3].", "ch01/p001")],
    "question": [span("Can a reader ignore irrelevant passages?", "ch01/p002")],
    "contributions": [{"kind": "method", "spans": [span("A learned passage gate.", "ch03/p001")]}],
    "method": [
        {"type": "paragraph",
         "spans": [span("The gate weights passages (ch03/s01/p002).", "ch03/p001")]},
        {"type": "math", "latex": "g_i = \\sigma(w^T x)", "cites": ["ch03/m001"],
         "meaning": [span("A sigmoid score.", "ch03/m001")]},
    ],
    "setup": {"datasets": [{"name": "NQ", "spans": [span("Open-domain QA.", "ch04/p001")]}],
              "baselines": [], "metrics": []},
    "results": [],
    "limitations": {"stated": [[span("Trained per benchmark.", "ch05/p001")]], "unstated": []},
    "assumptions": [],
    "future_work": [[span("Share one gate across tasks.", "ch05/p002")]],
    "numbers": [{"value": "+2.1 EM", "label": [span("Gain on NQ", "ch04/p002")]}],
}  # fmt: skip

EXPLAINER: dict[str, Any] = {
    "prerequisites": [],
    "intuition": [{"type": "paragraph",
                   "spans": [span("Listen to the relevant ones.", "ch01/p002")]}],
    "walkthrough": [{"type": "steps",
                     "items": [[span("Retrieve.", "ch03/p001")], [span("Gate.", "ch03/p002")]]}],
    "analogy": [span("Like an editor marking clippings.", "ch03/p001")],
    "equations": [{"latex": "g_i = \\sigma(w^T x)", "cites": ["ch03/m001"],
                   "plain": [span("Squash a score to 0..1.", "ch03/m001")]}],
}  # fmt: skip

RESULT = {"method": "GRA", "dataset": "NQ", "metric": "EM", "value": 50.3, "unit": None,
          "higher_is_better": True, "is_proposed": True, "cites": ["ch04/t001"]}  # fmt: skip


def known_paper(
    session: Session,
    *,
    card: Review | None = Review.APPROVED,
    explainer_levels: Sequence[str] = ("practitioner",),
    claims: bool = True,
    results: bool = True,
    meta: dict[str, Any] | None = None,
) -> Document:
    """A paper with a card (`card` is its review, None: no card), explainers, claims, results."""
    paper = make_paper(session, "Gated Readers", meta=meta or {"arxiv_id": "2101.00001"})
    if card is not None:
        make_artifact(session, paper, type=ArtifactType.PAPER_CARD, body=CARD, review=card)
    for level in explainer_levels:
        body = {**EXPLAINER, "analogy": [span(f"The {level} analogy.", "ch03/p001")]}
        make_artifact(session, paper, type=ArtifactType.PAPER_EXPLAINER, body=body, variant=level)
    if results:
        make_artifact(session, paper, type=ArtifactType.RESULTS_TABLE, body={"rows": [RESULT]})
    if claims:
        claim_set = make_artifact(session, paper, type=ArtifactType.CLAIM_SET, body={"claims": []})
        for key, kind, strength in (("C1", ClaimKind.RESULT, ClaimStrength.ARGUED),
                                    ("C2", ClaimKind.RESULT, ClaimStrength.MEASURED),
                                    ("C3", ClaimKind.METHOD, ClaimStrength.ARGUED)):  # fmt: skip
            session.add(Claim(document_id=paper.id, artifact_id=claim_set.id, key=key,
                              text=f"Claim {key} holds [7].", kind=kind, strength=strength,
                              evidence=["ch04/p001"]))  # fmt: skip
        session.commit()
    return paper


def valid_plan() -> dict[str, Any]:
    """The plan-build example: valid against its schema by construction."""
    path = get_settings().skills_dir / "plan-build" / "example.json"
    plan: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return plan


class FakeProbe:
    """A machine with every tool, a git identity and a `repo`-scoped gh token, unless told
    otherwise. `calls` records each command run."""

    def __init__(
        self,
        *,
        missing: Sequence[str] = (),
        identity: tuple[str, str] = ("Ada", "ada@example.com"),
        gh_code: int = 0,
        scopes: str = "'gist', 'read:org', 'repo'",
    ) -> None:
        self.missing = set(missing)
        self.identity = identity
        self.gh_code = gh_code
        self.scopes = scopes
        self.calls: list[list[str]] = []

    def which(self, binary: str) -> str | None:
        return None if binary in self.missing else f"/usr/local/bin/{binary}"

    def run(self, argv: Sequence[str], timeout: float) -> tuple[int, str, str]:
        self.calls.append(list(argv))
        if argv[1:3] == ["config", "--global"]:
            value = self.identity[0] if argv[3] == "user.name" else self.identity[1]
            return (0, f"{value}\n", "") if value else (1, "", "")
        if argv[1:3] == ["auth", "status"]:
            status = (
                f"github.com\n  Logged in to github.com as ada\n  - Token scopes: {self.scopes}\n"
            )
            return (self.gh_code, status, "") if self.gh_code == 0 else (1, "", "not logged in")
        return 127, "", "unexpected command"
