"""Catalog identifiers, computed exactly as data contract 0.7 §3 and §5 state.

Every identifier is the same hash form, the first 16 hexadecimal characters of
SHA-1 over a UTF-8 string (contract §3.4). The string is the ``|``-joined list
of the fields the contract names, each written as text without padding:

- ``feature_id`` (§3.4, §5.4): ``genome_id|contig_id|start|end|strand``, with
  1-based inclusive coordinates and the strand as Bakta writes it (``+``,
  ``-``, ``?``, ``.``), entered unchanged.
- ``hit_id`` (§5.5): ``feature_id|source_tool|element_name``.
- ``mutation_id`` (§5.6): ``genome_id|source_tool|gene|variant``.
- ``region_id`` (§5.8): ``genome_id|contig_id|start|end|source_tool|type``.
- ``protein_hash`` (§5.4): the amino acid sequence itself. The sequence is
  hashed as read from the Bakta ``.faa``, which writes no terminal ``*``; no
  character is stripped or changed, so a caller holding a sequence with a
  trailing stop must remove it first to match.

The contract says "hash of" for ``hit_id``, ``mutation_id`` and
``region_id`` without naming the form; the §3.4 form is used for all of them
(milestone 1a plan, decision 8). The synthetic generator hashes through
``sha1_16`` here, so synthetic and ingested identifiers cannot differ.
"""

from __future__ import annotations

import hashlib

SEPARATOR = "|"
HASH_LENGTH = 16


def sha1_16(text: str) -> str:
    """First 16 hexadecimal characters of SHA-1 over ``text`` in UTF-8 (contract §3.4)."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:HASH_LENGTH]


def _join(*parts: str | int) -> str:
    for part in parts:
        if isinstance(part, str) and SEPARATOR in part:
            raise ValueError(f"identifier field {part!r} contains {SEPARATOR!r}")
    return SEPARATOR.join(str(p) for p in parts)


def feature_id(genome_id: str, contig_id: str, start: int, end: int, strand: str) -> str:
    """Positional hash of a feature (contract §3.4)."""
    return sha1_16(_join(genome_id, contig_id, start, end, strand))


def hit_id(feature: str, source_tool: str, element_name: str) -> str:
    """Hash of ``feature_id|source_tool|element_name`` (contract §5.5)."""
    return sha1_16(_join(feature, source_tool, element_name))


def mutation_id(genome_id: str, source_tool: str, gene: str, variant: str) -> str:
    """Hash of ``genome_id|source_tool|gene|variant`` (contract §5.6)."""
    return sha1_16(_join(genome_id, source_tool, gene, variant))


def region_id(
    genome_id: str, contig_id: str, start: int, end: int, source_tool: str, region_type: str
) -> str:
    """Hash of ``genome_id|contig_id|start|end|source_tool|type`` (contract §5.8)."""
    return sha1_16(_join(genome_id, contig_id, start, end, source_tool, region_type))


def protein_hash(sequence: str) -> str:
    """Hash of an amino acid sequence as read from the Bakta ``.faa`` (contract §5.4)."""
    return sha1_16(sequence)


def sequence_digest(sequence: str) -> str:
    """Full SHA-1 of a nucleotide sequence in upper case, for matching contigs by sequence.

    Used to map assembler contig names to Bakta names (contract §3.2); not a
    catalog identifier.
    """
    return hashlib.sha1(sequence.upper().encode("ascii")).hexdigest()
