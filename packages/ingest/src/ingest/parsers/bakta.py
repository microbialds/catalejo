"""Bakta parser (contract §4.1, feeding §5.3 ``contig``, §5.4 ``feature`` and §5.15).

- ``.fna``: contig names (``contig_id``, §3.2), order, length, GC and the
  header tags read through ``mgap_layout.parse_fna_header``: ``topology``
  (``circular``, ``linear``, else ``unknown``) and completeness, with the
  ``location`` or ``plasmid-name`` tag of complete replicons.
- ``.tsv``: one row per feature, with coordinates, strand, type, locus tag,
  gene, product and cross-references exactly as Bakta writes them (§5.4).
- ``.txt``: feature counts and the software and database versions
  (``Database: v6.0, full`` gives version ``6.0`` and type ``full``).
- ``.faa``: protein sequences keyed by locus tag, reduced to their
  ``protein_hash`` (§5.4), hashed as read.

GC content is in percent (0 to 100), computed over A, C, G and T, the unit of
the Bakta and QUAST summaries.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.identifiers import protein_hash, sequence_digest
from ingest.parsers._io import ParseError, fasta_records, optional, read_table

TOPOLOGY_UNKNOWN = "unknown"
DBXREF_SEPARATOR = ", "
SUMMARY_SEPARATOR = ": "


@dataclass(frozen=True)
class BaktaContig:
    contig_id: str
    index: int  # 1-based order in the .fna
    length: int
    gc_content: float  # percent
    gc_bases: int  # G and C
    acgt_bases: int  # A, C, G and T
    topology: str
    complete: bool  # [completeness=complete]
    location: str | None  # [location=...], chromosome for a complete chromosome
    plasmid_name: str | None  # [plasmid-name=...] of a complete plasmid
    digest: str  # sequence_digest of the sequence

    @property
    def circular(self) -> bool:
        return self.topology == L.BAKTA.topology_circular


@dataclass(frozen=True)
class BaktaFeature:
    contig_id: str
    start: int
    end: int
    strand: str
    type: str
    locus_tag: str | None
    gene: str | None
    product: str | None
    db_xrefs: tuple[str, ...]


@dataclass(frozen=True)
class BaktaSummary:
    software_version: str | None
    database_version: str | None
    database_type: str | None
    cds_count: int | None
    rrna_count: int | None
    trna_count: int | None
    counts: dict[str, str]  # every "key: value" line as written


@dataclass(frozen=True)
class BaktaAnnotation:
    contigs: tuple[BaktaContig, ...]
    features: tuple[BaktaFeature, ...]
    summary: BaktaSummary
    protein_hashes: dict[str, str]  # locus tag -> protein_hash


def gc_counts(seq: str) -> tuple[int, int]:
    """G plus C, and A plus C plus G plus T, of ``seq`` in any case."""
    upper = seq.upper()
    gc = upper.count("G") + upper.count("C")
    return gc, gc + upper.count("A") + upper.count("T")


def gc_percent(gc: int, acgt: int) -> float:
    return 100.0 * gc / acgt if acgt else 0.0


def parse_fna(path: Path) -> tuple[BaktaContig, ...]:
    b = L.BAKTA
    out: list[BaktaContig] = []
    for index, (_, description, seq) in enumerate(fasta_records(path), start=1):
        contig, tags = L.parse_fna_header(description)
        topology = tags.get(b.tag_topology) or TOPOLOGY_UNKNOWN
        gc, acgt = gc_counts(seq)
        out.append(
            BaktaContig(
                contig_id=contig,
                index=index,
                length=len(seq),
                gc_content=gc_percent(gc, acgt),
                gc_bases=gc,
                acgt_bases=acgt,
                topology=topology,
                complete=tags.get(b.tag_completeness) == b.completeness_complete,
                location=tags.get(b.tag_location),
                plasmid_name=tags.get(b.tag_plasmid_name),
                digest=sequence_digest(seq),
            )
        )
    return tuple(out)


def parse_features(path: Path) -> tuple[BaktaFeature, ...]:
    c = L.BAKTA.tsv_columns
    out: list[BaktaFeature] = []
    for row in read_table(path, L.BAKTA.tsv_table):
        strand = row[c.strand]
        if strand not in L.BAKTA.strands:
            raise ParseError(f"{path}: unknown strand {strand!r}")
        out.append(
            BaktaFeature(
                contig_id=row[c.sequence_id],
                start=int(row[c.start]),
                end=int(row[c.stop]),
                strand=strand,
                type=row[c.type],
                locus_tag=optional(row[c.locus_tag]),
                gene=optional(row[c.gene]),
                product=optional(row[c.product]),
                db_xrefs=tuple(x for x in row[c.dbxrefs].split(DBXREF_SEPARATOR) if x.strip()),
            )
        )
    return tuple(out)


def _int(counts: dict[str, str], key: str) -> int | None:
    value = counts.get(key)
    return int(value) if value is not None and value.strip().isdigit() else None


def parse_summary(path: Path) -> BaktaSummary:
    b = L.BAKTA
    k = b.summary_keys
    counts: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition(SUMMARY_SEPARATOR)
        if sep:
            counts[key.strip()] = value.strip()
    software = b.software_re.search(counts.get(k.software, ""))
    database = b.database_re.search(counts.get(k.database, ""))
    return BaktaSummary(
        software_version=software.group("version") if software else None,
        database_version=database.group("version") if database else None,
        database_type=database.group("type") if database else None,
        cds_count=_int(counts, k.cdss),
        rrna_count=_int(counts, k.rrnas),
        trna_count=_int(counts, k.trnas),
        counts=counts,
    )


def parse_proteins(path: Path) -> dict[str, str]:
    """Locus tag to ``protein_hash`` for every record of the ``.faa``."""
    if not path.is_file():
        return {}
    return {name: protein_hash(seq) for name, _, seq in fasta_records(path)}


def parse_bakta(results_dir: Path, sample: str, prefix: str) -> BaktaAnnotation:
    """The Bakta annotation of ``sample``; the ``.fna``, ``.tsv`` and ``.txt`` are required."""
    b = L.BAKTA
    return BaktaAnnotation(
        contigs=parse_fna(b.fna.resolve(results_dir, sample, prefix)),
        features=parse_features(b.tsv.resolve(results_dir, sample, prefix)),
        summary=parse_summary(b.summary.resolve(results_dir, sample, prefix)),
        protein_hashes=parse_proteins(b.faa.resolve(results_dir, sample, prefix)),
    )
