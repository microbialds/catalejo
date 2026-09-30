"""Assembly parser: SPAdes (Illumina) or Autocycler and Dnaapler (nanopore) (contract §4.1).

Feeds ``genome.assembler``, ``genome.assembler_version`` and the platform
detected from the assembly directory, and lists the assembler's sequences by
content so that tools reporting assembler names (RGI) can be mapped to the
Bakta contig names by sequence (contract §3.2).

The SPAdes version is read from the ``sp:Z:SPAdes-<version>`` tag of the
assembly graph header. Autocycler writes no version into its files, so for
nanopore genomes the version comes from ``pipeline_info`` when the assembled
genome is built (``assembler_version`` is None here).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.identifiers import sequence_digest
from ingest.parsers._io import fasta_records, first_line


@dataclass(frozen=True)
class AssemblySequence:
    """One sequence of the assembly FASTA: its name, length and content digest."""

    name: str
    length: int
    digest: str


@dataclass(frozen=True)
class AssemblyInfo:
    platform: str | None
    assembler: str | None
    assembler_version: str | None
    sequences: tuple[AssemblySequence, ...]


def _sequences(path: Path) -> tuple[AssemblySequence, ...]:
    if not path.is_file():
        return ()
    return tuple(
        AssemblySequence(name, len(seq), sequence_digest(seq))
        for name, _, seq in fasta_records(path)
    )


def spades_version(graph: Path) -> str | None:
    """The SPAdes version in the header of the assembly graph, or None."""
    if not graph.is_file():
        return None
    m = L.SPADES.gfa_version_re.search(first_line(graph))
    return m.group("version") if m else None


def parse_assembly(results_dir: Path, sample: str, prefix: str) -> AssemblyInfo:
    """The assembler of ``sample`` and the sequences RGI and the other tools read.

    For Illumina the sequences are the SPAdes scaffolds (RGI's input); for
    nanopore they are the Dnaapler FASTA (Bakta's input), else the
    Autocycler FASTA. A sample with neither has no assembler and no sequences.
    """
    platform = L.detect_platform(results_dir, sample)
    if platform == L.PLATFORM_ILLUMINA:
        sp = L.SPADES
        return AssemblyInfo(
            platform=platform,
            assembler=sp.tool,
            assembler_version=spades_version(sp.graph.resolve(results_dir, sample, prefix)),
            sequences=_sequences(sp.scaffolds.resolve(results_dir, sample, prefix)),
        )
    if platform == L.PLATFORM_ONT:
        lr = L.LONG_READ
        fasta = lr.dnaapler_fasta.resolve(results_dir, sample, prefix)
        if not fasta.is_file():
            fasta = lr.autocycler_fasta.resolve(results_dir, sample, prefix)
        return AssemblyInfo(
            platform=platform,
            assembler=lr.autocycler_tool,
            assembler_version=None,
            sequences=_sequences(fasta),
        )
    return AssemblyInfo(platform=None, assembler=None, assembler_version=None, sequences=())
