"""Identifier rules of data contract 0.7 §3.4, §5.4, §5.5, §5.6 and §5.8."""

from __future__ import annotations

import hashlib

import pytest

from ingest import identifiers as ids
from ingest.synth.sequences import sha1_16 as synth_sha1_16


def _expected(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def test_sha1_16_form() -> None:
    assert ids.sha1_16("abc") == "a9993e364706816a"
    assert len(ids.sha1_16("")) == 16


def test_feature_id_is_positional_hash() -> None:
    assert ids.feature_id("SCL0421", "contig_1", 56, 1057, "-") == _expected(
        "SCL0421|contig_1|56|1057|-"
    )


def test_feature_id_enters_strand_unchanged() -> None:
    values = {ids.feature_id("G1", "contig_1", 10, 20, s) for s in ("+", "-", "?", ".")}
    assert len(values) == 4
    assert ids.feature_id("G1", "contig_1", 10, 20, "?") == _expected("G1|contig_1|10|20|?")
    assert ids.feature_id("G1", "contig_1", 10, 20, ".") == _expected("G1|contig_1|10|20|.")


def test_feature_id_depends_on_every_field() -> None:
    base = ids.feature_id("G1", "contig_1", 10, 20, "+")
    assert base != ids.feature_id("G2", "contig_1", 10, 20, "+")
    assert base != ids.feature_id("G1", "contig_2", 10, 20, "+")
    assert base != ids.feature_id("G1", "contig_1", 11, 20, "+")
    assert base != ids.feature_id("G1", "contig_1", 10, 21, "+")


def test_hit_id() -> None:
    fid = ids.feature_id("G1", "contig_1", 10, 20, "+")
    assert ids.hit_id(fid, "amrfinderplus", "blaKPC-2") == _expected(
        f"{fid}|amrfinderplus|blaKPC-2"
    )
    assert ids.hit_id(fid, "rgi", "blaKPC-2") != ids.hit_id(fid, "amrfinderplus", "blaKPC-2")


def test_mutation_id() -> None:
    assert ids.mutation_id("G1", "amrfinderplus", "gyrA", "S83I") == _expected(
        "G1|amrfinderplus|gyrA|S83I"
    )
    assert ids.mutation_id("G1", "amrfinderplus", "blaSHV", "C-112T") == _expected(
        "G1|amrfinderplus|blaSHV|C-112T"
    )


def test_region_id() -> None:
    assert ids.region_id("G1", "contig_3", 841, 13613, "genomad", "prophage") == _expected(
        "G1|contig_3|841|13613|genomad|prophage"
    )
    assert ids.region_id("G1", "contig_3", 1, 900, "genomad", "prophage") != ids.region_id(
        "G1", "contig_3", 1, 900, "genomad", "plasmid_region"
    )


def test_protein_hash_is_over_the_sequence_as_read() -> None:
    assert ids.protein_hash("MKV") == _expected("MKV")
    assert ids.protein_hash("MKV*") != ids.protein_hash("MKV")


def test_separator_inside_a_field_is_refused() -> None:
    with pytest.raises(ValueError):
        ids.feature_id("G|1", "contig_1", 1, 2, "+")


def test_synthetic_generator_uses_the_same_hash() -> None:
    for text in ("", "abc", "G1|contig_1|10|20|+", "MKVLAAGG"):
        assert synth_sha1_16(text) == ids.sha1_16(text)


def test_sequence_digest_ignores_case() -> None:
    assert ids.sequence_digest("acgtN") == ids.sequence_digest("ACGTN")
