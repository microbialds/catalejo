"""Side tables written beside the synthetic results directory (contract §4.2, §4.6 to §4.8).

``metadata.csv`` is a seed of manual entries (some species, dates at mixed
precision, two unrecognized columns for ``metadata_extra``); ``groups.csv``
and ``genome_groups.csv`` define two overlapping access groups covering every
genome; ``sets.csv`` holds two curated sets, one with a single member so the
§9 warning fires; ``tombstones.csv`` holds one removed genome with a
replacement.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from dataclasses import dataclass

from ingest.side_tables import GENOME_GROUPS, GROUPS, METADATA, SETS, TOMBSTONES
from ingest.synth.plan import GENOME_NUMBER_WIDTH, RunPlan

EXTRA_COLUMNS = ("ward", "sequencing_batch")

GROUP_CORE = ("core", "Core collection", "Genomes shared with every collaborating group")
GROUP_NETWORK = (
    "amr-network",
    "AMR surveillance network",
    "Genomes contributed to the regional resistance surveillance network",
)
SET_KPC = (
    "kpc-plasmid-carriers",
    "KPC plasmid carriers",
    "Genomes carrying blaKPC-2 on the shared IncFIB(pQil)/IncFII(K) plasmid",
)
SET_INDEX = ("index-isolate", "Index isolate", "First isolate of the 2023 hospital outbreak")
TOMBSTONE_RELEASE = "2026-06"
TOMBSTONE_REASON = "contamination"


def csv_text(header: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


@dataclass(frozen=True)
class SideTables:
    metadata: str
    groups: str
    genome_groups: str
    sets: str
    tombstones: str
    group_members: dict[str, list[str]]
    set_members: dict[str, list[str]]
    tombstone: tuple[str, str]  # (removed genome_id, replaced_by)

    def files(self) -> list[tuple[str, str]]:
        return [
            (METADATA.file_name, self.metadata),
            (GROUPS.file_name, self.groups),
            (GENOME_GROUPS.file_name, self.genome_groups),
            (SETS.file_name, self.sets),
            (TOMBSTONES.file_name, self.tombstones),
        ]


def side_tables(run: RunPlan) -> SideTables:
    cols = METADATA.columns
    header = [*cols.names(), *EXTRA_COLUMNS]
    rows: list[list[str]] = []
    for g in run.genomes:
        m = g.metadata
        values = {
            cols.genome_id: g.genome_id,
            cols.mgap_sample: m.mgap_sample,
            cols.species: m.species,
            cols.source_type: m.source_type,
            cols.isolation_date: m.isolation_date,
            cols.country: m.country,
            cols.region: m.region,
            cols.city: m.city,
            cols.site: m.site,
            cols.host: m.host,
            cols.isolation_site: m.isolation_site,
            cols.collection_group: m.collection_group,
            cols.platform: m.platform,
            cols.biosample_accession: m.biosample_accession,
            cols.assembly_accession: m.assembly_accession,
            cols.sra_accession: m.sra_accession,
            cols.notes: m.notes,
        }
        rows.append([values[c] for c in cols.names()] + [m.extra.get(c, "") for c in EXTRA_COLUMNS])

    core: list[str] = []
    network: list[str] = []
    for position, g in enumerate(run.genomes):
        if position % 4 != 3:
            core.append(g.genome_id)
        if position % 2 == 1 or "pKPC" in g.plasmids:
            network.append(g.genome_id)
    members = sorted(
        [(gid, GROUP_CORE[0]) for gid in core] + [(gid, GROUP_NETWORK[0]) for gid in network]
    )

    first = run.genomes[0]
    kpc = [g.genome_id for g in run.genomes if "pKPC" in g.plasmids]
    index = [run.genomes[1].genome_id] if len(run.genomes) > 1 else [first.genome_id]
    set_rows = [[*SET_KPC, gid] for gid in kpc] + [[*SET_INDEX, gid] for gid in index]

    code = first.species.code
    removed = f"{code}{len(run.by_species(code)) + 1:0{GENOME_NUMBER_WIDTH}d}"
    replaced_by = index[0]

    return SideTables(
        metadata=csv_text(header, rows),
        groups=csv_text(GROUPS.columns, [list(GROUP_CORE), list(GROUP_NETWORK)]),
        genome_groups=csv_text(GENOME_GROUPS.columns, [list(m) for m in members]),
        sets=csv_text(SETS.columns, set_rows),
        tombstones=csv_text(
            TOMBSTONES.columns, [[removed, TOMBSTONE_RELEASE, TOMBSTONE_REASON, replaced_by]]
        ),
        group_members={GROUP_CORE[0]: core, GROUP_NETWORK[0]: network},
        set_members={SET_KPC[0]: kpc, SET_INDEX[0]: index},
        tombstone=(removed, replaced_by),
    )
