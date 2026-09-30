"""MOB-suite parser (contract §4.1, optional; feeds the plasmid columns of §5.3 ``contig``).

- ``contig_report.txt``: one row per contig. ``contig_id`` carries the Bakta
  ``.fna`` description, so the name is the part before the first space.
  ``molecule_type`` is ``chromosome`` or ``plasmid``; clusters, replicon and
  relaxase types (split on ``,``, in file order) and mobility are ``-`` when
  missing. For contigs of a reconstructed plasmid MOB-recon usually leaves the
  replicon, relaxase and mobility columns empty, since they are properties of
  the plasmid.
- ``mobtyper_results.txt``: one row per reconstructed plasmid, joined on its
  ``primary_cluster_id`` column; present only when a plasmid was found.

The report's own ``sample_id`` is never keyed on.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import optional, read_table, split_list


@dataclass(frozen=True)
class MobContig:
    contig_id: str
    molecule_type: str
    primary_cluster_id: str | None
    secondary_cluster_id: str | None
    replicon_types: tuple[str, ...]
    relaxase_types: tuple[str, ...]
    mobility: str | None


@dataclass(frozen=True)
class MobPlasmid:
    primary_cluster_id: str
    secondary_cluster_id: str | None
    replicon_types: tuple[str, ...]
    relaxase_types: tuple[str, ...]
    mobility: str | None
    size: int | None
    num_contigs: int | None


@dataclass(frozen=True)
class MobSuiteResult:
    contigs: tuple[MobContig, ...]
    plasmids: tuple[MobPlasmid, ...]

    def plasmid(self, primary_cluster_id: str | None) -> MobPlasmid | None:
        for p in self.plasmids:
            if primary_cluster_id is not None and p.primary_cluster_id == primary_cluster_id:
                return p
        return None


def parse_mobsuite(results_dir: Path, sample: str, prefix: str) -> MobSuiteResult | None:
    """MOB-suite results of ``sample``, or None when MOB-suite did not run for it."""
    m = L.MOBSUITE
    report = m.contig_report.resolve(results_dir, sample, prefix)
    if not report.is_file():
        return None
    c = m.contig_report_columns
    contigs = tuple(
        MobContig(
            contig_id=row[c.contig_id].split(" ", 1)[0],
            molecule_type=row[c.molecule_type],
            primary_cluster_id=optional(row[c.primary_cluster_id], m.missing),
            secondary_cluster_id=optional(row[c.secondary_cluster_id], m.missing),
            replicon_types=split_list(row[c.rep_types], m.list_separator, m.missing),
            relaxase_types=split_list(row[c.relaxase_types], m.list_separator, m.missing),
            mobility=optional(row[c.predicted_mobility], m.missing),
        )
        for row in read_table(report, m.contig_report_table)
    )
    plasmids: list[MobPlasmid] = []
    typer = m.mobtyper_results.resolve(results_dir, sample, prefix)
    if typer.is_file():
        t = m.mobtyper_columns
        for row in read_table(typer, m.mobtyper_table):
            cluster = optional(row[t.primary_cluster_id], m.missing)
            if cluster is None:
                continue
            size = optional(row[t.size], m.missing)
            count = optional(row[t.num_contigs], m.missing)
            plasmids.append(
                MobPlasmid(
                    primary_cluster_id=cluster,
                    secondary_cluster_id=optional(row[t.secondary_cluster_id], m.missing),
                    replicon_types=split_list(row[t.rep_types], m.list_separator, m.missing),
                    relaxase_types=split_list(row[t.relaxase_types], m.list_separator, m.missing),
                    mobility=optional(row[t.predicted_mobility], m.missing),
                    size=None if size is None else int(size),
                    num_contigs=None if count is None else int(count),
                )
            )
    return MobSuiteResult(contigs=contigs, plasmids=tuple(plasmids))
