"""Drug class of a resistance determinant, by the palette's match lists (requirements §5.4).

``config/palette.yaml`` states the rule: a determinant's subclass, then its
class, is split on ``/`` and the parts are tried in order; the first part
found in an entry's match list decides, and a determinant with no matching
part is ``other`` (the last entry). The index of the entry is the drug class
order used by the summary sentence (contract §7.4) and the charts.
"""

from __future__ import annotations

from ingest.config import DrugClass, PaletteConfig

SEPARATOR = "/"


def parts(drug_class: str | None, drug_subclass: str | None) -> list[str]:
    out: list[str] = []
    for value in (drug_subclass, drug_class):
        if value:
            out += [p.strip() for p in value.split(SEPARATOR) if p.strip()]
    return out


def classify(
    drug_class: str | None, drug_subclass: str | None, palette: PaletteConfig
) -> tuple[int, DrugClass]:
    """The palette drug class entry of a determinant and its index in the palette order."""
    for part in parts(drug_class, drug_subclass):
        for index, entry in enumerate(palette.drug_classes):
            if part in entry.match:
                return index, entry
    last = len(palette.drug_classes) - 1
    return last, palette.drug_classes[last]
