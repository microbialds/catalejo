"""Genome counters and the summary sentence (contract §5.2, §7.4)."""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from ingest.catalog import connect
from ingest.config import (
    PaletteConfig,
    SummaryTemplatesConfig,
    load_palette,
    load_summary_templates,
)
from ingest.summary import (
    ContigFact,
    GenomeSummaryInput,
    HitFact,
    apply_article,
    condition_holds,
    counters,
    facts,
    load_inputs,
    mutation_list,
    render,
    render_st,
    summarize,
    top_determinant,
)


@pytest.fixture(scope="module")
def templates() -> SummaryTemplatesConfig:
    return load_summary_templates()


@pytest.fixture(scope="module")
def palette() -> PaletteConfig:
    return load_palette()


def hit(
    name: str,
    contig: str = "c2",
    drug: str | None = "BETA-LACTAM",
    subclass: str | None = "CARBAPENEM",
    location: str = "plasmid",
    element_type: str = "amr",
    subtype: str | None = "AMR",
    tool: str = "amrfinderplus",
) -> HitFact:
    return HitFact(tool, name, element_type, subtype, drug, subclass, location, contig)


CONTIGS = {
    "c1": ContigFact(5_300_000, "chromosome", ()),
    "c2": ContigFact(43_210, "plasmid", ("IncFIB(pQil)", "IncFII(K)")),
    "c3": ContigFact(8_000, "plasmid", ()),
    "c4": ContigFact(2_000, "unclassified", ()),
}

FULL = GenomeSummaryInput(
    genome_id="G1",
    species_name="Klebsiella pneumoniae",
    st="258",
    isolation_site="blood",
    isolation_date=date(2024, 3, 1),
    completeness=99.54,
    contamination=0.31,
    assembly_status="complete",
    hits=(
        hit("blaKPC-2"),
        hit("aac(6')-Ib", "c1", "AMINOGLYCOSIDE", "AMIKACIN", "chromosome"),
        hit("sul1", "c1", "SULFONAMIDE", "SULFONAMIDE", "chromosome"),
        hit("fieF", "c1", None, None, "chromosome", "stress", "METAL"),
        hit("KPC-2", tool="rgi", subtype=None),
    ),
    mutations=(("gyrA", "S83I"),),
    contigs=CONTIGS,
    prophage_region_count=2,
    cluster_size=14,
)


def sentence(
    g: GenomeSummaryInput, templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> tuple[str, str]:  # noqa: E501
    _, template_id, text = summarize(g, templates, palette)
    return template_id, text


def test_counters() -> None:
    c = counters(FULL)
    assert (c.amr_gene_count, c.amr_mutation_count, c.plasmid_contig_count) == (3, 1, 2)
    assert c.prophage_region_count == 2


def test_full(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    template_id, text = sentence(FULL, templates, palette)
    assert template_id == "full"
    assert text == (
        "A carbapenem-resistant ST258 isolate from blood, collected in 2024, with 99.5% "
        "completeness and 0.3% contamination. It carries blaKPC-2 on a 43 kb IncFIB(pQil) "
        "plasmid together with 2 other resistance determinants and the point mutation gyrA S83I, "
        "and belongs to a group of 14 ST258 genomes in this release."
    )


def test_plasmid(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    g = replace(FULL, hits=FULL.hits[:2], mutations=(("gyrA", "S83I"), ("parC", "S80I")))
    template_id, text = sentence(g, templates, palette)
    assert template_id == "plasmid"
    assert text == (
        "A carbapenem-resistant ST258 isolate from blood, collected in 2024, with 99.5% "
        "completeness and 0.3% contamination. It carries blaKPC-2 on a 43 kb IncFIB(pQil) plasmid "
        "together with 1 other resistance determinant and the point mutations gyrA S83I and "
        "parC S80I, and belongs to a group of 14 ST258 genomes in this release."
    )


def test_plasmid_without_replicon(
    templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> None:
    g = replace(FULL, hits=(hit("blaKPC-2", "c3"),), mutations=(), isolation_site=None)
    template_id, text = sentence(g, templates, palette)
    assert template_id == "plasmid_without_replicon"
    assert text == (
        "A carbapenem-resistant ST258 isolate, collected in 2024, with 99.5% completeness and "
        "0.3% contamination. It carries blaKPC-2 on an 8 kb plasmid, and belongs to a group of 14 "
        "ST258 genomes in this release."
    )


def test_singleton_st_falls_through_full_to_plasmid(
    templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> None:
    template_id, text = sentence(replace(FULL, cluster_size=1), templates, palette)
    assert template_id == "plasmid"
    assert text.endswith(
        "together with 2 other resistance determinants and the point mutation gyrA S83I, "
        "and is the only ST258 genome in this release."
    )
    assert "group" not in text
    assert sentence(replace(FULL, cluster_size=2), templates, palette)[0] == "full"


def test_no_plasmid(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    g = replace(
        FULL,
        hits=(hit("mecA", "c1", "BETA-LACTAM", "METHICILLIN", "chromosome"),),
        mutations=(),
        st=None,
    )
    template_id, text = sentence(g, templates, palette)
    assert template_id == "no_plasmid"
    assert text == (
        "A methicillin-resistant isolate from blood, collected in 2024, with 99.5% completeness "
        "and 0.3% contamination. It carries mecA on the chromosome."
    )


def test_draft_plasmid(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    g = replace(
        FULL,
        assembly_status="draft",
        hits=(hit("blaCTX-M-15", drug="BETA-LACTAM", subclass="CEPHALOSPORIN"),),
        mutations=(),
        isolation_date=None,
        completeness=None,
    )
    template_id, text = sentence(g, templates, palette)
    assert template_id == "draft_plasmid"
    assert text == (
        "An ESBL-producing ST258 isolate from blood. It carries blaCTX-M-15 on a "
        "plasmid-associated contig (predicted), and belongs to a group of 14 ST258 genomes in this "
        "release."
    )


def test_draft_chromosome(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    g = replace(
        FULL,
        assembly_status="draft",
        hits=(hit("fosA", "c1", "FOSFOMYCIN", "FOSFOMYCIN", "chromosome"),),
        mutations=(),
    )
    template_id, text = sentence(g, templates, palette)
    assert template_id == "draft_chromosome"
    assert text.startswith("An ST258 isolate from blood")
    assert "It carries fosA on the chromosome (predicted), and belongs to a group of 14" in text


def test_unclassified_location(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    g = replace(
        FULL, hits=(hit("sul2", "c4", "SULFONAMIDE", "SULFONAMIDE", "unclassified"),), mutations=()
    )
    template_id, text = sentence(g, templates, palette)
    assert template_id == "unclassified_location"
    assert "It carries sul2, and belongs to a group of 14 ST258 genomes" in text


def test_mutations_only(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    g = replace(
        FULL,
        hits=(),
        mutations=(("parC", "S80I"), ("gyrA", "S83I"), ("gyrA", "D87N"), ("acrR", "R45C")),
    )
    template_id, text = sentence(g, templates, palette)
    assert template_id == "mutations_only"
    assert "Its resistance determinants are the point mutations acrR R45C, gyrA D87N and " in text
    assert text.endswith("gyrA S83I. It belongs to a group of 14 ST258 genomes in this release.")
    _, alone = sentence(replace(g, cluster_size=1), templates, palette)
    assert alone.endswith("gyrA S83I. It is the only ST258 genome in this release.")
    _, no_st = sentence(replace(g, st=None), templates, palette)
    assert no_st.endswith("acrR R45C, gyrA D87N and gyrA S83I.")


def test_no_resistance_no_plasmid(
    templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> None:
    contigs = {"c1": CONTIGS["c1"]}
    g = replace(FULL, hits=(), mutations=(), contigs=contigs, st="ST258-1LV", cluster_size=2)
    template_id, text = sentence(g, templates, palette)
    assert template_id == "no_resistance_no_plasmid"
    assert text.startswith("An ST258-1LV isolate from blood")
    assert text.endswith(
        "No resistance determinants or plasmid contigs were detected. It belongs to a group of 2 "
        "ST258-1LV genomes in this release."
    )
    _, alone = sentence(replace(g, cluster_size=1), templates, palette)
    assert alone.endswith("were detected. It is the only ST258-1LV genome in this release.")
    _, no_st = sentence(replace(g, st="-"), templates, palette)
    assert no_st.endswith("No resistance determinants or plasmid contigs were detected.")


def test_no_resistance(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    g = replace(FULL, hits=(), mutations=())
    template_id, text = sentence(g, templates, palette)
    assert template_id == "no_resistance"
    assert text.endswith(
        "No resistance determinants were detected, and plasmid contigs are present. It belongs to "
        "a group of 14 ST258 genomes in this release."
    )
    _, alone = sentence(replace(g, cluster_size=1), templates, palette)
    assert alone.endswith("are present. It is the only ST258 genome in this release.")
    _, no_st = sentence(replace(g, st=None), templates, palette)
    assert no_st.endswith(
        "No resistance determinants were detected, and plasmid contigs are present."
    )


def test_minimal(templates: SummaryTemplatesConfig) -> None:
    values: dict[str, Any] = {"species": "Serratia marcescens"}
    template_id, text = render(values, templates)
    assert (template_id, text) == ("minimal", "A genome of Serratia marcescens.")


def test_top_determinant_order(templates: SummaryTemplatesConfig, palette: PaletteConfig) -> None:
    hits = (
        hit("blaCTX-M-15", drug="BETA-LACTAM", subclass="CEPHALOSPORIN"),
        hit("aac(3)-IIa", "c1", "AMINOGLYCOSIDE", "GENTAMICIN", "chromosome"),
        hit("blaNDM-1"),
        hit("blaKPC-2"),
    )
    top = top_determinant(hits, templates, palette)
    assert top is not None and top.element_name == "blaKPC-2"  # rule 1, then element_name
    top = top_determinant(hits[:2], templates, palette)
    assert top is not None and top.element_name == "blaCTX-M-15"  # ESBL rule beats no rule
    no_rule = (
        hit("tet(A)", "c1", "TETRACYCLINE", "TETRACYCLINE", "chromosome"),
        hit("aac(3)-IIa", "c1", "AMINOGLYCOSIDE", "GENTAMICIN", "chromosome"),
    )
    top = top_determinant(no_rule, templates, palette)
    assert top is not None and top.element_name == "aac(3)-IIa"  # palette drug class order


def test_st_rendering_and_list() -> None:
    assert render_st("258") == "ST258"
    assert render_st("ST258-1LV") == "ST258-1LV"
    assert render_st("-") is None and render_st(None) is None
    assert mutation_list([("gyrA", "S83I")]) == "gyrA S83I"
    assert mutation_list([]) is None


def test_conditions() -> None:
    assert condition_holds("n_other >= 2", {"n_other": 2})
    assert not condition_holds("n_other >= 2", {"n_other": 10 - 9})
    assert condition_holds("n_other > 9", {"n_other": 10})  # numeric, not text, comparison
    assert condition_holds("assembly_status == complete", {"assembly_status": "complete"})
    assert not condition_holds("n_genes == 0", {"n_genes": None})


def test_article(templates: SummaryTemplatesConfig) -> None:
    assert apply_article("A ESBL-producing isolate.", templates) == "An ESBL-producing isolate."
    assert apply_article("A ST11 isolate.", templates) == "An ST11 isolate."
    assert apply_article("A carbapenem-resistant isolate.", templates).startswith("A carb")
    assert apply_article("An isolate.", templates) == "An isolate."
    for kept in (
        "It belongs to a group of 3 ST11 genomes.",
        "It carries sul1 on a plasmid-associated contig (predicted).",
        "It carries sul1 on a plasmid.",
    ):
        assert apply_article(kept, templates) == kept


@pytest.mark.parametrize(
    ("size", "article"),
    [
        ("8", "an"),
        ("11", "an"),
        ("18", "an"),
        ("80", "an"),
        ("110", "a"),
        ("180", "a"),
        ("32", "a"),
        ("1", "a"),
        ("800", "an"),
        ("8.5", "an"),
    ],
)
def test_article_inside_a_sentence_before_a_number(
    size: str, article: str, templates: SummaryTemplatesConfig
) -> None:
    text = f"A ST11 isolate. It carries blaKPC-2 on a {size} kb IncFIB(pQil) plasmid."
    assert apply_article(text, templates) == (
        f"An ST11 isolate. It carries blaKPC-2 on {article} {size} kb IncFIB(pQil) plasmid."
    )


def test_article_keeps_case_and_ignores_letters_inside_words(
    templates: SummaryTemplatesConfig,
) -> None:
    assert apply_article("A 8 kb plasmid, a 8 kb plasmid.", templates) == (
        "An 8 kb plasmid, an 8 kb plasmid."
    )
    assert apply_article("a ESBL-producing isolate", templates) == "an ESBL-producing isolate"
    # "A" inside gyrA or after a hyphen is not an article.
    assert apply_article("gyrA E83I and plasmid-A 8 kb", templates) == (
        "gyrA E83I and plasmid-A 8 kb"
    )


def test_article_rendered_in_the_plasmid_templates(
    templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> None:
    contigs = {"c1": CONTIGS["c1"]} | {
        f"p{kb}": ContigFact(kb * 1000, "plasmid", ("IncX3",))
        for kb in (8, 11, 18, 80, 110, 180, 32)
    }
    for kb, article in ((8, "an"), (11, "an"), (18, "an"), (80, "an"), (110, "a"), (180, "a"),
                        (32, "a")):  # fmt: skip
        g = replace(FULL, hits=(hit("blaNDM-1", f"p{kb}"),), mutations=(), contigs=contigs)
        _, text = sentence(g, templates, palette)
        assert f"It carries blaNDM-1 on {article} {kb} kb IncX3 plasmid" in text, text


def test_facts_follow_the_written_rules(
    templates: SummaryTemplatesConfig, palette: PaletteConfig
) -> None:
    values = facts(FULL, counters(FULL), templates, palette)
    assert values["completeness"] == "99.5" and values["year"] == 2024
    assert values["plasmid_size"] == "43 kb" and values["replicon"] == "IncFIB(pQil)"
    assert values["n_other"] == 2 and values["top_location"] == "plasmid"


def test_every_synthetic_genome_gets_a_sentence(
    small_catalog: Path,
    small_manifest: dict[str, Any],
    templates: SummaryTemplatesConfig,
    palette: PaletteConfig,
) -> None:
    con = connect(small_catalog, read_only=True)
    try:
        stored = dict(con.execute("SELECT genome_id, summary_sentence FROM genome").fetchall())
        inputs = load_inputs(con)
    finally:
        con.close()
    assert set(stored) == set(small_manifest["genomes"])
    for g in inputs:
        text = stored[g.genome_id]
        assert text and not re.search(r"[{}]", text), text
        assert text.endswith(".") and "  " not in text
        values = facts(g, counters(g), templates, palette)
        phrases = small_manifest["genomes"][g.genome_id]["resistance_phrases"]
        assert values["resistance_phrase"] == (phrases[0] if phrases else None), g.genome_id
