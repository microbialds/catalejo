"""RGI parser (contract §4.1, optional; feeds §5.5 ``annotation_hit``).

RGI runs on the assembler's sequences (the SPAdes scaffolds on Illumina) with
its own ORF calls, so its ``Contig`` column holds ``<assembler contig>_<orf>``
and its coordinates are on the assembler's sequence. The parser strips the
ORF number and reports the assembler contig name; the assembled genome maps it
to the Bakta ``contig_id`` by sequence (contract §3.2) and the hit to a
feature by coordinate overlap.

``aro`` is written as a CARD ontology term (``ARO:3001070``). ``cut_off``
(Perfect, Strict, Loose) is RGI's method string.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import optional, read_table, to_float


@dataclass(frozen=True)
class RgiHit:
    assembler_contig: str
    start: int
    end: int
    strand: str
    cut_off: str
    best_hit_aro: str
    identity: float | None
    coverage: float | None  # percentage length of the reference sequence
    aro: str | None
    model_type: str | None
    drug_class: str | None
    resistance_mechanism: str | None
    gene_family: str | None


def assembler_contig(orf: str) -> str:
    """The assembler contig of an RGI ORF name (``NODE_1_..._141`` gives ``NODE_1_...``)."""
    return L.RGI.orf_suffix_re.sub("", orf)


def parse_rgi(results_dir: Path, sample: str, prefix: str) -> tuple[RgiHit, ...] | None:
    """RGI hits of ``sample``, or None when RGI did not run for it."""
    r = L.RGI
    path = r.report.resolve(results_dir, sample, prefix)
    if not path.is_file():
        return None
    c = r.columns
    out: list[RgiHit] = []
    for row in read_table(path, r.table):
        aro = optional(row[c.aro], r.missing)
        out.append(
            RgiHit(
                assembler_contig=assembler_contig(row[c.contig]),
                start=int(row[c.start]),
                end=int(row[c.stop]),
                strand=row[c.orientation],
                cut_off=row[c.cut_off],
                best_hit_aro=row[c.best_hit_aro],
                identity=to_float(row[c.best_identities], r.missing),
                coverage=to_float(row[c.percentage_length], r.missing),
                aro=None if aro is None else f"{r.aro_prefix}{aro}",
                model_type=optional(row[c.model_type], r.missing),
                drug_class=optional(row[c.drug_class], r.missing),
                resistance_mechanism=optional(row[c.resistance_mechanism], r.missing),
                gene_family=optional(row[c.amr_gene_family], r.missing),
            )
        )
    return tuple(out)
