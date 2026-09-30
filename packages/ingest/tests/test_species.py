"""Species assignment (contract §3.3) and the species registry rows (§4.9, §5.1)."""

from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any

import pytest

from ingest.assemble import AssembledGenome
from ingest.config import (
    SpeciesRegistry,
    SpeciesSource,
    load_palette,
    load_platform,
    load_species_registry,
)
from ingest.species import (
    GTDBTK,
    KRAKEN2,
    METADATA,
    MLST,
    SpeciesEvidence,
    assign_species,
    registry_rows,
)

PRECEDENCE: list[SpeciesSource] = [METADATA, GTDBTK, MLST, KRAKEN2]


@pytest.fixture(scope="module")
def registry() -> SpeciesRegistry:
    return load_species_registry()


def test_first_available_source_wins(registry: SpeciesRegistry) -> None:
    a = assign_species(
        SpeciesEvidence(gtdbtk="Klebsiella pneumoniae", kraken2="Klebsiella pneumoniae"),
        registry,
        PRECEDENCE,
    )
    assert (a.species_code, a.species_source, a.species_conflict) == ("KPN", GTDBTK, False)


def test_metadata_alias_resolves(registry: SpeciesRegistry) -> None:
    a = assign_species(
        SpeciesEvidence(
            metadata="klebsiella pneumoniae subsp. pneumoniae", mlst_scheme="klebsiella"
        ),
        registry,
        PRECEDENCE,
    )
    assert (a.species_code, a.species_source, a.species_conflict) == ("KPN", METADATA, False)


def test_mlst_scheme_through_registry(registry: SpeciesRegistry) -> None:
    a = assign_species(
        SpeciesEvidence(mlst_scheme="saureus", kraken2="Staphylococcus aureus"),
        registry,
        PRECEDENCE,
    )
    assert (a.species_code, a.species_source) == ("SAU", MLST)
    assert a.name == "Staphylococcus aureus"


def test_unmapped_scheme_yields_no_name(registry: SpeciesRegistry) -> None:
    a = assign_species(
        SpeciesEvidence(mlst_scheme="hinfluenzae", kraken2="Haemophilus influenzae"),
        registry,
        PRECEDENCE,
    )
    assert a.species_source == KRAKEN2
    assert a.species_code is None  # not in the registry: validation fails with the name
    assert a.name == "Haemophilus influenzae"
    assert MLST not in a.names


def test_conflict_with_a_name_outside_the_registry(registry: SpeciesRegistry) -> None:
    a = assign_species(
        SpeciesEvidence(
            metadata="Klebsiella pneumoniae",
            gtdbtk="Klebsiella variicola",
            mlst_scheme="klebsiella",
            kraken2="Klebsiella variicola",
        ),
        registry,
        PRECEDENCE,
    )
    assert (a.species_code, a.species_source, a.species_conflict) == ("KPN", METADATA, True)
    assert a.codes[GTDBTK] is None


def test_conflict_between_registry_species(registry: SpeciesRegistry) -> None:
    a = assign_species(
        SpeciesEvidence(gtdbtk="Escherichia coli", kraken2="Klebsiella pneumoniae"),
        registry,
        PRECEDENCE,
    )
    assert (a.species_code, a.species_conflict) == ("ECO", True)


def test_precedence_comes_from_the_argument(registry: SpeciesRegistry) -> None:
    evidence = SpeciesEvidence(gtdbtk="Escherichia coli", kraken2="Klebsiella pneumoniae")
    a = assign_species(evidence, registry, [KRAKEN2, GTDBTK, MLST, METADATA])
    assert (a.species_code, a.species_source) == ("KPN", KRAKEN2)


def test_streptococcus_pyogenes_is_registered(registry: SpeciesRegistry) -> None:
    a = assign_species(
        SpeciesEvidence(mlst_scheme="spyogenes", kraken2="Streptococcus pyogenes"),
        registry,
        PRECEDENCE,
    )
    assert (a.species_code, a.species_source, a.species_conflict) == ("SPY", MLST, False)


def test_no_source(registry: SpeciesRegistry) -> None:
    a = assign_species(SpeciesEvidence(metadata="  "), registry, PRECEDENCE)
    assert (a.species_code, a.species_source, a.species_conflict) == (None, None, False)


def test_registry_rows_resolve_colors(registry: SpeciesRegistry) -> None:
    palette = load_palette()
    rows = registry_rows(registry, palette)
    assert [r.species_code for r in rows] == sorted(s.species_code for s in registry.species)
    by_code = {r.species_code: r for r in rows}
    for s in registry.species:
        expected = (
            palette.species.other
            if s.color_index is None
            else palette.species.sequence[s.color_index]
        )
        assert by_code[s.species_code].color == expected
        assert by_code[s.species_code].mlst_schemes == tuple(s.mlst_schemes)


def test_synthetic_species_plants(
    small_synth: Path, small_manifest: dict[str, Any], small_assembled: dict[str, AssembledGenome]
) -> None:
    registry = load_species_registry()
    precedence = load_platform().species_precedence
    text = (small_synth / "metadata.csv").read_text(encoding="utf-8")
    metadata = {r["genome_id"]: r for r in csv.DictReader(io.StringIO(text))}
    plants = small_manifest["plants"]
    for gid, a in small_assembled.items():
        f = a.facts
        evidence = SpeciesEvidence(
            metadata=metadata[gid]["species"] or None,
            gtdbtk=f.gtdb_species,
            mlst_scheme=f.mlst_scheme,
            kraken2=f.kraken2_top_taxon,
        )
        result = assign_species(evidence, registry, precedence)
        assert result.species_code == small_manifest["genomes"][gid]["species_code"], gid
        assert result.species_conflict == (gid in plants["species_conflict"]), gid
        if gid in plants["species_from_mlst_only"]["genomes"]:
            assert result.species_source == MLST
        elif gid in plants["metadata_species"]:
            assert result.species_source == METADATA
        else:
            assert result.species_source == GTDBTK
