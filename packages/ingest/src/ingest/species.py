"""Species assignment and the species registry rows (data contract 0.7 §3.3, §4.9, §5.1).

Sources are consulted in the order of ``species_precedence`` in
``config/platform.yaml``, and the first that yields a species name wins.

- ``metadata``: the ``species`` column of ``metadata.csv``, when not empty.
- ``gtdbtk``: the ``s__`` name of the GTDB-Tk classification, when the
  genome was classified to species.
- ``mlst``: the MLST scheme, mapped to a species through the registry's
  ``mlst_schemes``. A scheme the registry does not map yields no name (a
  scheme is not a species name), and neither does a missing scheme.
- ``kraken2``: the top Kraken2 or Bracken species.

Names are resolved through the registry by canonical name, alias or GTDB name,
ignoring case. The winning source fixes ``species_source``; when its name is
absent from the registry the genome has no ``species_code`` and fails
validation (§3.3, §9) with the name in the message.

``species_conflict`` is true when any other source that yields a name
disagrees with the winner. §3.3 says "when two sources disagree"; the reading
here is that a source disagrees when its name does not resolve to the
winner's species code, either because it resolves to another code or because
the registry does not know it (a tool naming *Klebsiella variicola* for a
genome recorded as *Klebsiella pneumoniae* disagrees even when *K. variicola*
is not in the registry).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from ingest.config import PaletteConfig, SpeciesRegistry, SpeciesSource
from ingest.rows import SpeciesRegistryRow

METADATA: SpeciesSource = "metadata"
GTDBTK: SpeciesSource = "gtdbtk"
MLST: SpeciesSource = "mlst"
KRAKEN2: SpeciesSource = "kraken2"


@dataclass(frozen=True)
class SpeciesEvidence:
    """What each source says about one genome; None where the source is silent."""

    metadata: str | None = None
    gtdbtk: str | None = None
    mlst_scheme: str | None = None
    kraken2: str | None = None


@dataclass(frozen=True)
class SpeciesAssignment:
    species_code: str | None
    species_source: SpeciesSource | None
    species_conflict: bool
    name: str | None  # the winning source's name as it was written
    names: dict[str, str]  # every source that yielded a name, by source
    codes: dict[str, str | None]  # the species code each of those names resolves to


def _name(
    source: SpeciesSource, evidence: SpeciesEvidence, registry: SpeciesRegistry
) -> str | None:
    match source:
        case "metadata":
            value = evidence.metadata
        case "gtdbtk":
            value = evidence.gtdbtk
        case "kraken2":
            value = evidence.kraken2
        case "mlst":
            if not evidence.mlst_scheme:
                return None
            entry = registry.by_mlst_scheme(evidence.mlst_scheme)
            return entry.canonical_name if entry else None
    return value.strip() if value and value.strip() else None


def _code(
    source: SpeciesSource, name: str, evidence: SpeciesEvidence, registry: SpeciesRegistry
) -> str | None:
    if source == MLST and evidence.mlst_scheme:
        entry = registry.by_mlst_scheme(evidence.mlst_scheme)
    else:
        entry = registry.by_name(name)
    return entry.species_code if entry else None


def assign_species(
    evidence: SpeciesEvidence,
    registry: SpeciesRegistry,
    precedence: Sequence[SpeciesSource],
) -> SpeciesAssignment:
    """The species of one genome by the precedence of contract §3.3."""
    names: dict[str, str] = {}
    codes: dict[str, str | None] = {}
    for source in precedence:
        name = _name(source, evidence, registry)
        if name is not None:
            names[source] = name
            codes[source] = _code(source, name, evidence, registry)
    winner: SpeciesSource | None = next((s for s in precedence if s in names), None)
    if winner is None:
        return SpeciesAssignment(None, None, False, None, names, codes)
    code = codes[winner]
    conflict = any(codes[s] != code for s in names if s != winner)
    return SpeciesAssignment(code, winner, conflict, names[winner], names, codes)


def registry_rows(registry: SpeciesRegistry, palette: PaletteConfig) -> list[SpeciesRegistryRow]:
    """``species_registry`` rows (§5.1), color resolved from ``color_index`` (§4.9)."""
    return [
        SpeciesRegistryRow(
            species_code=s.species_code,
            canonical_name=s.canonical_name,
            gtdb_name=s.gtdb_name,
            ncbi_taxid=s.ncbi_taxid,
            aliases=tuple(s.aliases),
            mlst_schemes=tuple(s.mlst_schemes),
            pangenome_eligible=s.pangenome_eligible,
            color=registry.color(s.species_code, palette),
        )
        for s in sorted(registry.species, key=lambda s: s.species_code)
    ]
