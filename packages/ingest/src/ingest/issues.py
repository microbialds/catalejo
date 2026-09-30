"""Validation findings shared by every check (contract §9).

A check returns a list of ``Issue``: a rule identifier, a severity
(``failure`` stops ``metadata validate``, ``ingest`` and ``release check``;
``warning`` is reported and counted), a message for the maintainer, and the
genome it concerns when there is one. ``metadata validate`` produces them
now, and ``release check`` reuses the same type.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

Severity = Literal["failure", "warning"]
FAILURE: Severity = "failure"
WARNING: Severity = "warning"


@dataclass(frozen=True)
class Issue:
    rule: str
    severity: Severity
    message: str
    genome_id: str | None = None

    def line(self) -> str:
        where = f" [{self.genome_id}]" if self.genome_id else ""
        return f"{self.severity}: {self.rule}{where}: {self.message}"


def failures(issues: Iterable[Issue]) -> list[Issue]:
    return [i for i in issues if i.severity == FAILURE]


def warnings(issues: Iterable[Issue]) -> list[Issue]:
    return [i for i in issues if i.severity == WARNING]
