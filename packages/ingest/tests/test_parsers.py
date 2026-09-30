"""The mgap parsers (contract §4.1) against the planted truth of synth_manifest.json,
and against the real mgap runs under data/ when they are present."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from conftest import real_example
from ingest import mgap_layout as L
from ingest.parsers import (
    amrfinder,
    assembly,
    bakta,
    checkm2,
    genomad,
    gtdbtk,
    kleborate,
    kraken2,
    mlst,
    mobsuite,
    pipeline_info,
    quast,
    rgi,
    sccmec,
    sistr,
)
from ingest.parsers._io import ParseError, read_table
from ingest.synth.plan import BAKTA_VERSION
from ingest.synth.writers import PIPELINE_VERSION, TOOL_VERSIONS

Manifest = dict[str, Any]


def _args(results: Path, manifest: Manifest, gid: str) -> tuple[Path, str, str]:
    info = manifest["genomes"][gid]
    return results, info["mgap_sample"], info["file_prefix"]


def _ids(manifest: Manifest) -> list[str]:
    return list(manifest["genomes"])


# Synthetic run ----------------------------------------------------------------------------------


def test_prefix_resolution(small_results: Path, small_manifest: Manifest) -> None:
    for gid, info in small_manifest["genomes"].items():
        assert L.resolve_prefix(small_results, info["mgap_sample"]) == info["file_prefix"], gid


def test_assembly(small_results: Path, small_manifest: Manifest) -> None:
    for gid in _ids(small_manifest):
        info = small_manifest["genomes"][gid]
        result = assembly.parse_assembly(*_args(small_results, small_manifest, gid))
        assert result.platform == info["detected_platform"]
        assert result.assembler == info["assembler"]
        assert len(result.sequences) == info["contigs"]
        if result.assembler == L.SPADES.tool:
            assert result.assembler_version == TOOL_VERSIONS[L.SPADES.tool]
        else:
            assert result.assembler_version is None


def test_bakta(small_results: Path, small_manifest: Manifest) -> None:
    for gid in _ids(small_manifest):
        info = small_manifest["genomes"][gid]
        b = bakta.parse_bakta(*_args(small_results, small_manifest, gid))
        assert len(b.contigs) == info["contigs"]
        assert sum(c.length for c in b.contigs) == info["total_length"]
        assert [c.index for c in b.contigs] == list(range(1, len(b.contigs) + 1))
        complete = info["assembly_status"] == "complete"
        assert all(c.circular == complete and c.complete == complete for c in b.contigs)
        if complete:
            plasmids = {c.contig_id for c in b.contigs if c.plasmid_name}
            assert plasmids == set(info["plasmid_contigs"])
            assert b.contigs[0].location == L.BAKTA.location_chromosome
        assert b.summary.database_version == info["bakta_database"]
        assert b.summary.database_type == L.BAKTA.database_type
        coding = [f for f in b.features if f.type in (L.BAKTA.feature_types.cds, "sorf")]
        assert b.summary.cds_count == sum(1 for f in coding if f.type == "cds")
        assert set(b.protein_hashes) == {f.locus_tag for f in coding}
        assert all(f.strand in L.BAKTA.strands for f in b.features)
        assert all(f.locus_tag and f.locus_tag.startswith(info["locus_tag_prefix"])
                   for f in coding)  # fmt: skip
    (gap,) = small_manifest["plants"]["assembly_gap"]
    features = bakta.parse_bakta(*_args(small_results, small_manifest, gap)).features
    gaps = [f for f in features if f.type == L.BAKTA.feature_types.gap]
    assert gaps and all(f.strand == "." and f.locus_tag is None for f in gaps)


def test_bakta_versions_mixed(small_results: Path, small_manifest: Manifest) -> None:
    mixed = small_manifest["plants"]["mixed_annotation_versions"]
    for version, genomes in mixed["bakta_database"].items():
        for gid in genomes:
            summary = bakta.parse_bakta(*_args(small_results, small_manifest, gid)).summary
            assert summary.database_version == version
    assert len(mixed["bakta_database"]) == 2


def test_checkm2_and_quast(small_results: Path, small_manifest: Manifest) -> None:
    for gid in _ids(small_manifest):
        info = small_manifest["genomes"][gid]
        c = checkm2.parse_checkm2(*_args(small_results, small_manifest, gid))
        assert c is not None
        assert c.completeness == info["checkm2_completeness"]
        assert c.contamination == info["checkm2_contamination"]
        q = quast.parse_quast(*_args(small_results, small_manifest, gid))
        assert q is not None
        assert q.contigs_all == info["contigs"]
        assert q.total_length_all == info["total_length"]


def test_kraken2(small_results: Path, small_manifest: Manifest) -> None:
    conflicts = small_manifest["plants"]["species_conflict"]
    for gid in _ids(small_manifest):
        info = small_manifest["genomes"][gid]
        k = kraken2.parse_kraken2(*_args(small_results, small_manifest, gid))
        assert k is not None
        expected = conflicts[gid][L.KRAKEN2.tool] if gid in conflicts else info["species"]
        assert k.top_taxon == expected
        assert k.top_fraction is not None and 0 < k.top_fraction <= 1
        complete = info["assembly_status"] == "complete"
        assert k.source == (L.KRAKEN2.tool if complete else L.BRACKEN.tool)


def test_mlst(small_results: Path, small_manifest: Manifest) -> None:
    for gid in _ids(small_manifest):
        info = small_manifest["genomes"][gid]
        m = mlst.parse_mlst(*_args(small_results, small_manifest, gid))
        assert m is not None
        assert m.scheme == info["mlst_scheme"]
        assert m.st == (None if info["st"] == L.MLST.missing else info["st"])
        if m.scheme is not None:
            assert len(m.alleles) == 7
    (novel,) = small_manifest["plants"]["novel_st"]
    m = mlst.parse_mlst(*_args(small_results, small_manifest, novel))
    assert m is not None and m.st is None and m.alleles[0][1].startswith("~")


def test_gtdbtk(small_results: Path, small_manifest: Manifest) -> None:
    summary = gtdbtk.parse_gtdbtk_summary(small_results)
    conflicts = small_manifest["plants"]["species_conflict"]
    for gid in _ids(small_manifest):
        info = small_manifest["genomes"][gid]
        row = gtdbtk.parse_gtdbtk(*_args(small_results, small_manifest, gid), genome_id=gid)
        assert (row is not None) == info["in_gtdbtk"]
        assert (gid in summary) == info["in_gtdbtk"]
        if row is not None:
            expected = conflicts[gid][L.GTDBTK.tool] if gid in conflicts else info["species"]
            assert row.species == expected
            assert row.classification and row.classification.startswith("d__Bacteria")


def test_species_from_lineage() -> None:
    assert gtdbtk.species_from_lineage("d__B;g__Klebsiella;s__Klebsiella pneumoniae") == (
        "Klebsiella pneumoniae"
    )
    assert gtdbtk.species_from_lineage("d__B;g__Klebsiella;s__") is None
    assert gtdbtk.species_from_lineage(None) is None


def test_amrfinder_hits(small_results: Path, small_manifest: Manifest) -> None:
    kpc = small_manifest["plants"]["carbapenemase_plasmid"]
    for gid, site in kpc["carriers"].items():
        result = amrfinder.parse_amrfinder(*_args(small_results, small_manifest, gid))
        assert result is not None
        (hit,) = [h for h in result.hits if h.element_symbol == kpc["element"]]
        assert (hit.contig_id, hit.start, hit.end, hit.strand) == (
            site["contig"], site["start"], site["end"], site["strand"],
        )  # fmt: skip
        assert hit.protein_id == site["locus_tag"]
        assert hit.drug_class == "BETA-LACTAM"
    for kind in ("resistance_determinants", "virulence", "stress"):
        for symbol, genomes in small_manifest["plants"][kind].items():
            for gid in genomes:
                result = amrfinder.parse_amrfinder(*_args(small_results, small_manifest, gid))
                assert result is not None
                assert symbol in {h.element_symbol for h in result.hits}, (gid, symbol)


def test_amrfinder_point_mutations(small_results: Path, small_manifest: Manifest) -> None:
    point = small_manifest["plants"]["point_mutations"]
    carried: dict[str, set[str]] = {}
    for symbol, genomes in point.items():
        for gid, site in genomes.items():
            carried.setdefault(gid, set()).add(symbol)
            result = amrfinder.parse_amrfinder(*_args(small_results, small_manifest, gid))
            assert result is not None
            (m,) = [x for x in result.mutations if x.element_symbol == symbol]
            gene, variant = symbol.rsplit("_", 1)
            assert (m.gene, m.variant) == (gene, variant)
            assert (m.contig_id, m.start, m.end, m.strand) == (
                site["contig"], site["start"], site["end"], site["strand"],
            )  # fmt: skip
            assert m.protein_id == site["locus_tag"]
            promoter = symbol in small_manifest["plants"]["promoter_variants"]
            assert m.variant_type == ("promoter" if promoter else "substitution")
            assert symbol not in {h.element_symbol for h in result.hits}
    for gid in _ids(small_manifest):
        result = amrfinder.parse_amrfinder(*_args(small_results, small_manifest, gid))
        assert result is not None
        # Wild type and unknown positions of the mutations report are not ingested.
        assert {m.element_symbol for m in result.mutations} == carried.get(gid, set())
        info = small_manifest["genomes"][gid]
        assert result.database_version == info["amrfinderplus_database"]


def test_mutations_report_holds_screened_positions(
    small_results: Path, small_manifest: Manifest
) -> None:
    a = L.AMRFINDERPLUS
    names: list[str] = []
    for gid in _ids(small_manifest):
        path = a.mutations.resolve(*_args(small_results, small_manifest, gid))
        names += [r[a.columns.element_name] for r in read_table(path, a.mutations_table)]
    assert any(n.endswith(a.wildtype_suffix) for n in names)
    assert any(n.endswith(a.unknown_suffix) for n in names)


@pytest.mark.parametrize(
    ("variant", "kind"),
    [
        ("S83I", "substitution"),
        ("C-112T", "promoter"),
        ("D135DGD", "insertion"),
        ("E24insTer26", "insertion"),
        ("A72del", "deletion"),
        ("LSPT184I", "deletion"),
        ("VM678EA", "substitution"),
        ("STOP", "other"),
    ],
)
def test_variant_type(variant: str, kind: str) -> None:
    assert amrfinder.variant_type(variant) == kind


def test_split_symbol_at_last_underscore() -> None:
    assert amrfinder.split_symbol("gyrA_S83I") == ("gyrA", "S83I")
    assert amrfinder.split_symbol("blaSHV_C-112T") == ("blaSHV", "C-112T")
    assert amrfinder.split_symbol("aac_6_x_E24insTer26") == ("aac_6_x", "E24insTer26")


def test_rgi(small_results: Path, small_manifest: Manifest) -> None:
    rgi_plant = small_manifest["plants"][L.RGI.tool]
    for gid in _ids(small_manifest):
        hits = rgi.parse_rgi(*_args(small_results, small_manifest, gid))
        assert (hits is not None) == (gid in rgi_plant["with"])
        if hits:
            names = {s.name for s in assembly.parse_assembly(
                *_args(small_results, small_manifest, gid)).sequences}  # fmt: skip
            assert {h.assembler_contig for h in hits} <= names
            assert all(h.aro and h.aro.startswith(L.RGI.aro_prefix) for h in hits)
    assert rgi.assembler_contig("NODE_1_length_366231_cov_26.897945_141") == (
        "NODE_1_length_366231_cov_26.897945"
    )


def test_genomad(small_results: Path, small_manifest: Manifest) -> None:
    prophages = small_manifest["plants"]["prophages"]
    plasmids = small_manifest["plants"]["genomad_plasmids"]
    for gid in _ids(small_manifest):
        regions = genomad.parse_genomad(*_args(small_results, small_manifest, gid))
        assert regions is not None
        found = sorted((r.contig_id, r.start, r.end) for r in regions if r.type == genomad.PROPHAGE)
        expected = sorted((p["contig"], p["start"], p["end"]) for p in prophages.get(gid, []))
        assert found == expected
        plasmid_regions = [r for r in regions if r.type == genomad.PLASMID_REGION]
        assert sorted(r.contig_id for r in plasmid_regions) == sorted(plasmids.get(gid, []))
        assert all(r.start == 1 for r in plasmid_regions)
        assert all(r.score is not None for r in regions)


def test_mobsuite(small_results: Path, small_manifest: Manifest) -> None:
    plant = small_manifest["plants"][L.MOBSUITE.tool]
    kpc = small_manifest["plants"]["carbapenemase_plasmid"]
    for gid in _ids(small_manifest):
        info = small_manifest["genomes"][gid]
        result = mobsuite.parse_mobsuite(*_args(small_results, small_manifest, gid))
        assert (result is not None) == (gid in plant["with"]) == info["has_mobsuite"]
        if result is None:
            continue
        assert len(result.contigs) == info["contigs"]
        assert all(" " not in c.contig_id for c in result.contigs)
        found = {c.contig_id for c in result.contigs if c.molecule_type == "plasmid"}
        assert found == set(info["plasmid_contigs"])
        if gid in kpc["carriers"]:
            contig = kpc["carriers"][gid]["contig"]
            (entry,) = [c for c in result.contigs if c.contig_id == contig]
            assert entry.primary_cluster_id == kpc["mob_primary_cluster"]
            plasmid = result.plasmid(entry.primary_cluster_id)
            assert plasmid is not None
            assert list(plasmid.replicon_types) == kpc["replicon_types"]


def test_typing(small_results: Path, small_manifest: Manifest) -> None:
    typing = small_manifest["plants"]["typing"]
    parsers = {
        L.KLEBORATE.tool: kleborate.parse_kleborate,
        L.SISTR.tool: sistr.parse_sistr,
        L.SCCMEC.tool: sccmec.parse_sccmec,
    }
    for gid in _ids(small_manifest):
        for tool, parse in parsers.items():
            result = parse(*_args(small_results, small_manifest, gid))
            assert (result is not None) == (gid in typing.get(tool, [])), (gid, tool)
            if result is not None:
                assert result.tool == tool
                assert all(v and v != "-" for _, v in result.values)
    for gid in typing[L.KLEBORATE.tool]:
        result = kleborate.parse_kleborate(*_args(small_results, small_manifest, gid))
        assert result is not None and result.get(L.KLEBORATE.columns.k_locus)


def test_pipeline_info(small_results: Path) -> None:
    info = pipeline_info.parse_pipeline_info(small_results)
    assert info is not None
    assert info.pipeline_version == PIPELINE_VERSION
    assert info.version(L.BAKTA.tool) == BAKTA_VERSION
    assert info.version(L.KRAKEN2.tool) == TOOL_VERSIONS[L.KRAKEN2.tool]
    assert info.version(L.LONG_READ.autocycler_tool) == TOOL_VERSIONS[L.LONG_READ.autocycler_tool]
    assert "pigz" not in info.tools
    assert info.databases[L.AMRFINDERPLUS.tool]


def test_absent_optional_files_give_none(tmp_path: Path) -> None:
    for parse in (
        checkm2.parse_checkm2, quast.parse_quast, kraken2.parse_kraken2, mlst.parse_mlst,
        amrfinder.parse_amrfinder, rgi.parse_rgi, genomad.parse_genomad, mobsuite.parse_mobsuite,
        kleborate.parse_kleborate, sistr.parse_sistr, sccmec.parse_sccmec,
    ):  # fmt: skip
        assert parse(tmp_path, "S1", "S1") is None
    assert gtdbtk.parse_gtdbtk_summary(tmp_path) == {}
    assert pipeline_info.parse_pipeline_info(tmp_path) is None
    assert assembly.parse_assembly(tmp_path, "S1", "S1").assembler is None


def test_missing_columns_are_reported(tmp_path: Path) -> None:
    path = tmp_path / "report.tsv"
    path.write_text("Name\tCompleteness\nx\t99\n", encoding="utf-8")
    with pytest.raises(ParseError, match="missing columns"):
        read_table(path, L.CHECKM2.table)


# Real mgap runs ---------------------------------------------------------------------------------


def test_real_illumina_example(repo_root: Path) -> None:
    root = real_example(repo_root, "mgap-example")
    b = bakta.parse_bakta(root, "SCL29833", "SCL29833")
    assert len(b.contigs) == 137 and all(c.topology == "linear" for c in b.contigs)
    assert b.summary.database_version == "6.0" and b.summary.software_version == "1.11.4"
    a = assembly.parse_assembly(root, "SCL29833", "SCL29833")
    assert (a.platform, a.assembler, a.assembler_version) == ("illumina", "spades", "4.1.0")
    assert len(a.sequences) == 255
    # Bakta keeps the scaffolds of at least 200 bp unchanged, so every contig maps by sequence.
    assert {c.digest for c in b.contigs} <= {s.digest for s in a.sequences}
    amr = amrfinder.parse_amrfinder(root, "SCL29833", "SCL29833")
    assert amr is not None
    assert {(m.gene, m.variant) for m in amr.mutations} == {
        ("ompK36", "D135DGD"), ("gyrA", "D87G"), ("gyrA", "S83Y"), ("parC", "S80I"),
    }  # fmt: skip
    k = kraken2.parse_kraken2(root, "SCL29833", "SCL29833")
    assert k is not None and k.source == L.BRACKEN.tool and k.top_taxon == "Klebsiella pneumoniae"
    m = mobsuite.parse_mobsuite(root, "SCL29833", "SCL29833")
    assert m is not None and {p.primary_cluster_id for p in m.plasmids} == {
        "AA276", "AB189", "AC288", "AA525",
    }  # fmt: skip
    sp10 = bakta.parse_bakta(root, "SP10", "SP10")
    types = {f.type for f in sp10.features}
    assert {L.BAKTA.feature_types.crispr_repeat, L.BAKTA.feature_types.crispr_spacer} <= types
    info = pipeline_info.parse_pipeline_info(root)
    assert info is not None and info.pipeline_version == "2.0.0"
    assert info.version(L.RGI.tool) is None and info.has(L.RGI.tool)


def test_real_nanopore_example(repo_root: Path) -> None:
    root = real_example(repo_root, "ont_example")
    sample = "ont_SCL30014"
    prefix = L.resolve_prefix(root, sample)
    assert prefix == "ont_SCL30014_"
    b = bakta.parse_bakta(root, sample, prefix)
    assert len(b.contigs) == 5 and all(c.circular and c.complete for c in b.contigs)
    a = assembly.parse_assembly(root, sample, prefix)
    assert (a.platform, a.assembler) == ("ont", "autocycler")
    assert [c.digest for c in b.contigs] == [s.digest for s in a.sequences]
    amr = amrfinder.parse_amrfinder(root, sample, prefix)
    assert amr is not None
    assert not [h for h in amr.hits if h.subtype == L.AMRFINDERPLUS.subtype_point_disrupt]
    assert "ompK35_E24insTer26" in {m.element_symbol for m in amr.mutations}
    k = kraken2.parse_kraken2(root, sample, prefix)
    assert k is not None and k.source == L.KRAKEN2.tool
    assert mobsuite.parse_mobsuite(root, sample, prefix) is None
    assert rgi.parse_rgi(root, sample, prefix) is None
    assert pipeline_info.parse_pipeline_info(root) is None
    kl = kleborate.parse_kleborate(root, sample, prefix)
    assert kl is not None and kl.get("K_locus") == "KL2"
