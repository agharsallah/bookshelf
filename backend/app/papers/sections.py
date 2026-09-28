"""What a paper's section heading says it is: numbering, named headings and `meta.role`.

Shared by parse-time heading detection (`papers.headings`) and `papers.structure`, so a
heading reads the same in both places.

    "3.2 Attention"                → numbering ("3", "2"), title "Attention"
    "A.1 Illustration of …"        → appendix numbering ("A", "1")
    "Acknowledgements", "References", "Abstract" → named top-level headings
    role: keyword stems in the title, in priority order (`role_for`); an unmatched section
          between the introduction and the first experiments / results is the method
"""

import re
import unicodedata
from dataclasses import dataclass

from app.models.enums import SectionRole

NUMBERED_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(\S.*)$")
LETTERED_RE = re.compile(r"^([A-H](?:\.\d{1,2}){0,3})\.?\s+([A-Z0-9].*)$")
_APPENDIX_LABEL = re.compile(r"^appendi(?:x|ces)\b\s*([A-H](?:\.\d+)*)?[.:]?\s*", re.IGNORECASE)
_WORD = re.compile(r"[a-z]+")

ABSTRACT = "abstract"
REFERENCES = frozenset({"references", "bibliography", "referencesandnotes", "literaturecited"})
ACKNOWLEDGEMENTS = frozenset(
    {"acknowledgements", "acknowledgments", "acknowledgement", "acknowledgment"}
)
APPENDIX = frozenset({"appendix", "appendices", "supplementarymaterial", "supplementarymaterials"})
_OTHER_NAMED = frozenset(
    {"limitations", "ethicsstatement", "broaderimpact", "broaderimpacts", "impactstatement"}
)
NAMED = frozenset({ABSTRACT}) | REFERENCES | ACKNOWLEDGEMENTS | APPENDIX | _OTHER_NAMED

# Priority order: the first role with a stem among the title's words wins.
_STEMS: tuple[tuple[SectionRole, tuple[str, ...]], ...] = (
    (SectionRole.ABSTRACT, ("abstract",)),
    (SectionRole.REFERENCES, ("reference", "bibliograph")),
    (SectionRole.APPENDIX, ("appendi", "supplementar")),
    (SectionRole.LIMITATIONS, ("limitation", "threat")),
    (SectionRole.CONCLUSION, ("conclu", "summary", "outlook")),
    (SectionRole.DISCUSSION, ("discussion",)),
    (SectionRole.RELATED_WORK, ("related", "prior", "previous", "literature", "survey")),
    (SectionRole.RESULTS, ("result", "ablation", "analys", "findings", "comparison")),
    (SectionRole.EXPERIMENTS, ("experiment", "evaluat", "setup", "training", "implementation",
                               "dataset", "benchmark", "empirical")),
    (SectionRole.BACKGROUND, ("background", "preliminar", "notation", "problem", "definition")),
    (SectionRole.INTRODUCTION, ("introduc", "motivation", "overview")),
    (SectionRole.METHOD, ("method", "approach", "model", "architecture", "framework",
                          "algorithm", "proposed", "design", "system")),
)  # fmt: skip
_BODY_END = frozenset({SectionRole.EXPERIMENTS, SectionRole.RESULTS})


@dataclass(frozen=True, slots=True)
class Numbering:
    parts: tuple[str, ...]  # ("3", "2") for "3.2"; ("A", "1") for "A.1"
    title: str

    @property
    def depth(self) -> int:
        return len(self.parts)


def numbering(heading: str, *, lettered: bool = False) -> Numbering | None:
    """The heading's section number, or None. `lettered`: also `A`, `B.2` (appendices)."""
    text = heading.strip()
    m = NUMBERED_RE.match(text) or (LETTERED_RE.match(text) if lettered else None)
    if m is None:
        return None
    return Numbering(tuple(m.group(1).split(".")), m.group(2).strip())


def key(heading: str) -> str:
    """Letters only, casefolded, numbering and `Appendix A:` label dropped."""
    text = heading.strip()
    if (num := numbering(text, lettered=True)) is not None:
        text = num.title
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return "".join(_WORD.findall(ascii_text.casefold()))


def is_appendix_label(heading: str) -> bool:
    """`Appendix`, `Appendix A: Proofs`, `Appendices`, `Supplementary material`."""
    return bool(_APPENDIX_LABEL.match(heading.strip())) or key(heading) in APPENDIX


def is_named(heading: str) -> bool:
    return key(heading) in NAMED or is_appendix_label(heading)


def _words(heading: str) -> list[str]:
    text = heading.strip()
    if (num := numbering(text, lettered=True)) is not None:
        text = num.title
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return _WORD.findall(ascii_text.casefold())


def keyword_role(heading: str) -> SectionRole | None:
    """The role the heading's words name, or None."""
    words = _words(heading)
    for role, stems in _STEMS:
        if any(w.startswith(s) for w in words for s in stems):
            return role
    return None


def role_for(headings: list[str]) -> list[SectionRole]:
    """`meta.role` of each top-level section, in document order.

    Everything after the references is an appendix (lettered or not), acknowledgements
    are `other`, and an unmatched section after the introduction and before the first
    experiments / results section is the method (`3 BERT`, `4 Why Self-Attention`).
    """
    roles: list[SectionRole] = []
    seen_intro = seen_refs = body_over = False
    for heading in headings:
        k = key(heading)
        role = keyword_role(heading)
        if k in ACKNOWLEDGEMENTS:
            role = SectionRole.OTHER
        elif seen_refs and role is not SectionRole.REFERENCES:
            role = SectionRole.APPENDIX
        elif role is None:
            in_body = seen_intro and not body_over
            role = SectionRole.METHOD if in_body else SectionRole.OTHER
        seen_intro = seen_intro or role is SectionRole.INTRODUCTION
        seen_refs = seen_refs or role is SectionRole.REFERENCES
        body_over = body_over or role in _BODY_END or role is SectionRole.CONCLUSION
        roles.append(role)
    return roles


def skipped(role: SectionRole, heading: str) -> bool:
    """References and acknowledgements are kept but never distilled (`meta.skip`)."""
    return role is SectionRole.REFERENCES or key(heading) in ACKNOWLEDGEMENTS
