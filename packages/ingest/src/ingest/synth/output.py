"""File output helpers for the synthetic generator (deterministic bytes)."""

from __future__ import annotations

import gzip
import io
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.synth.build import Genome
from ingest.synth.plan import GenomePlan
from ingest.synth.sequences import wrap


def rel(path: L.MgapPath, g: Genome) -> str:
    """The path of ``g`` in the results, with its mgap sample and file prefix."""
    return path.relative(g.plan.sample, g.plan.prefix)


def assembly_name(plan: GenomePlan) -> str:
    """The name the reports carry inside (CheckM2, QUAST); never keyed on by parsers."""
    if plan.complete:
        return L.LONG_READ.internal_name.format(genome_id=plan.genome_id)
    return L.SPADES.internal_name.format(sample=plan.sample)


def assembly_file(plan: GenomePlan) -> str:
    """The assembly file name MLST and SISTR report."""
    if plan.complete:
        return L.LONG_READ.internal_file.format(genome_id=plan.genome_id)
    return L.SPADES.internal_file.format(sample=plan.sample)


def kleborate_strain(plan: GenomePlan) -> str:
    """Kleborate's strain column: the sample for Illumina, the read-file stem for nanopore."""
    return assembly_name(plan) if plan.complete else plan.sample


@dataclass
class Output:
    """Writes files under a results directory and counts them."""

    root: Path
    files: int = 0
    bytes: int = 0

    def text(self, relative: str, content: str) -> None:
        self._bytes(relative, content.encode("utf-8"))

    def gzip(self, relative: str, content: str) -> None:
        buffer = io.BytesIO()
        with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as fh:
            fh.write(content.encode("utf-8"))
        self._bytes(relative, buffer.getvalue())

    def _bytes(self, relative: str, data: bytes) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.files += 1
        self.bytes += len(data)


def tsv(header: Sequence[str] | None, rows: Iterable[Sequence[str]]) -> str:
    lines = ["\t".join(header)] if header is not None else []
    lines += ["\t".join(row) for row in rows]
    return "\n".join(lines) + "\n"


def fasta(records: Iterable[tuple[str, str]], width: int | None = 60) -> str:
    out: list[str] = []
    for header, seq in records:
        out.append(f">{header}")
        out.append(wrap(seq, width) if width else seq)
    return "\n".join(out) + "\n"


def versions_yml(entries: Sequence[tuple[str, Sequence[tuple[str, str]]]]) -> str:
    """nf-core versions.yml: quoted process names mapping tools to versions."""
    lines: list[str] = []
    for process, tools in entries:
        lines.append(f'"{process}":')
        lines += [f"    {tool}: {version}" for tool, version in tools]
    return "\n".join(lines) + "\n"
