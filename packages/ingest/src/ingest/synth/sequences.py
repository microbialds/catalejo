"""Seeded sequence generation for the synthetic generator.

Coding sequences start with ATG, end with a stop codon and contain no internal
stop, so they translate cleanly with the bacterial code (table 11) and the
protein hash of contract §5.4 can be computed from them.
"""

from __future__ import annotations

import hashlib
import random
from functools import cache

from ingest import identifiers

BASES = "ACGT"
STOP_CODONS = ("TAA", "TAG", "TGA")

_AA = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
CODON_TABLE: dict[str, str] = {
    a + b + c: _AA[16 * i + 4 * j + k]
    for i, a in enumerate("TCAG")
    for j, b in enumerate("TCAG")
    for k, c in enumerate("TCAG")
}
_COMPLEMENT = str.maketrans("ACGTNacgtn", "TGCANtgcan")


def sub_rng(seed: int, *keys: str) -> random.Random:
    """A generator seeded from the run seed and a key path.

    Seeding with a string is deterministic across processes (Python hashes it
    with SHA-512), unlike ``hash()``.
    """
    return random.Random("|".join((str(seed), *keys)))


def reverse_complement(seq: str) -> str:
    return seq.translate(_COMPLEMENT)[::-1]


def gc_fraction(seq: str) -> float:
    acgt = sum(seq.count(b) for b in BASES)
    if acgt == 0:
        return 0.0
    return (seq.count("G") + seq.count("C")) / acgt


def base_weights(gc: float) -> tuple[float, float, float, float]:
    at = (1.0 - gc) / 2.0
    return (at, gc / 2.0, gc / 2.0, at)


def random_dna(rng: random.Random, length: int, gc: float) -> str:
    return "".join(rng.choices(BASES, weights=base_weights(gc), k=length))


@cache
def _sense_codons(gc_percent: int) -> tuple[tuple[str, ...], tuple[float, ...]]:
    w = dict(zip(BASES, base_weights(gc_percent / 100.0), strict=True))
    codons = tuple(c for c, aa in sorted(CODON_TABLE.items()) if aa != "*")
    weights = tuple(w[c[0]] * w[c[1]] * w[c[2]] for c in codons)
    return codons, weights


def random_cds(rng: random.Random, n_codons: int, gc: float) -> str:
    """A coding sequence of ``n_codons`` codons including ATG and the stop."""
    if n_codons < 3:
        raise ValueError("a CDS needs at least three codons")
    codons, weights = _sense_codons(round(gc * 100))
    body = rng.choices(codons, weights=weights, k=n_codons - 2)
    return "ATG" + "".join(body) + rng.choice(STOP_CODONS)


def translate(cds: str) -> str:
    """Translate a complete CDS with table 11, without the stop, first residue M."""
    protein = [CODON_TABLE[cds[i : i + 3]] for i in range(0, len(cds) - 3, 3)]
    if not protein:
        return ""
    protein[0] = "M"
    return "".join(protein)


def codon_for(rng: random.Random, amino_acid: str) -> str:
    """A codon for ``amino_acid``, drawn from its synonymous codons."""
    options = sorted(c for c, aa in CODON_TABLE.items() if aa == amino_acid)
    return rng.choice(options)


def set_codon(cds: str, position: int, amino_acid: str, rng: random.Random) -> str:
    """Return ``cds`` with the residue at 1-based ``position`` set to ``amino_acid``."""
    i = (position - 1) * 3
    if not 3 <= i < len(cds) - 3:
        raise ValueError(f"position {position} outside the CDS body")
    return cds[:i] + codon_for(rng, amino_acid) + cds[i + 3 :]


def mutate_cds(cds: str, rng: random.Random, substitutions: int) -> str:
    """Replace ``substitutions`` internal codons by random sense codons."""
    codons, _ = _sense_codons(50)
    seq = list(cds)
    n = len(cds) // 3
    for _ in range(substitutions):
        k = rng.randrange(1, n - 1)
        seq[3 * k : 3 * k + 3] = rng.choice(codons)
    return "".join(seq)


def sha1_16(text: str) -> str:
    """First 16 hex characters of SHA-1 (contract §3.4 and §5.4 hash form).

    Delegates to ``ingest.identifiers`` so synthetic and ingested identifiers
    are computed by one function.
    """
    return identifiers.sha1_16(text)


def md5_hex(seq: str) -> str:
    return hashlib.md5(seq.encode("ascii")).hexdigest()


def wrap(seq: str, width: int = 60) -> str:
    return "\n".join(seq[i : i + width] for i in range(0, len(seq), width))
