"""FASTA reading with Biopython for the parsers.

Biopython ships without complete type information, so this module is the one
place the parsers use it and is checked in basic mode.
"""
# pyright: basic

from __future__ import annotations

import gzip
from collections.abc import Iterator
from pathlib import Path

from Bio.SeqIO.FastaIO import SimpleFastaParser


def fasta_records(path: Path) -> Iterator[tuple[str, str, str]]:
    """``(id, description, sequence)`` of every FASTA record, gzip or plain.

    The id is the description up to the first space, as Biopython reads it.
    """
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as fh:
        for title, seq in SimpleFastaParser(fh):
            description = str(title)
            yield description.split(None, 1)[0] if description else "", description, str(seq)
