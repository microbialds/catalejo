"""Species for the synthetic generator: registry identity plus generation parameters.

Codes, canonical names, GTDB names, aliases and MLST schemes come from
``config/species_registry.yaml`` (contract §4.9), so synthetic genomes and the
registry cannot disagree (contract §10). ``catalog.SPECIES_PARAMS`` holds only
how genomes of each species are generated, keyed by species code, in the
order the generator adds species.
"""

from __future__ import annotations

from dataclasses import fields

from pydantic import ValidationError

from ingest.config import ConfigError, SpeciesRegistry, load_species_registry
from ingest.synth.catalog import SPECIES_PARAMS, SpeciesSpec


class SynthError(Exception):
    """The requested synthetic run cannot be produced."""


def load_species(registry: SpeciesRegistry | None = None) -> tuple[SpeciesSpec, ...]:
    """Every synthetic species, in generation order, with its registry identity."""
    if registry is None:
        try:
            registry = load_species_registry()
        except (ConfigError, ValidationError) as exc:
            raise SynthError(f"species registry: {exc}") from exc
    out: list[SpeciesSpec] = []
    for params in SPECIES_PARAMS:
        try:
            entry = registry.get(params.code)
        except KeyError as exc:
            raise SynthError(
                f"species {params.code} is not in config/species_registry.yaml"
            ) from exc
        values = {f.name: getattr(params, f.name) for f in fields(params)}
        out.append(
            SpeciesSpec(
                **values,
                name=entry.canonical_name,
                gtdb_name=entry.gtdb_name or entry.canonical_name,
                mlst_scheme=entry.mlst_schemes[0] if entry.mlst_schemes else None,
                aliases=tuple(entry.aliases),
            )
        )
    return tuple(out)
