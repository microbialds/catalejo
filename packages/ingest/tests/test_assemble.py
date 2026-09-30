"""Assembling one genome's parser output into catalog rows (contract §5, §10)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from conftest import real_example
from ingest import identifiers as ids
from ingest import mgap_layout as L
from ingest.assemble import (
    CHROMOSOME,
    COMPLETE,
    DRAFT,
    PIPELINE_TOOL,
    PLASMID,
    RULE_UNMAPPED_HIT,
    UNCLASSIFIED,
    AssembledGenome,
    assemble_genome,
    assembly_status,
    classify_contigs,
    n50,
    parse_sample,
)
from ingest.config import load_typing_display
from ingest.issues import failures
from ingest.parsers.bakta import BaktaContig
from ingest.parsers.genomad import PLASMID_REGION, PROPHAGE, GenomadRegion
from ingest.parsers.pipeline_info import parse_pipeline_info
from ingest.synth.writers import PIPELINE_VERSION

Manifest = dict[str, Any]
Assembled = dict[str, AssembledGenome]


def test_every_synthetic_hit_maps_to_a_feature(small_assembled: Assembled) -> None:
    for gid, a in small_assembled.items():
        assert a.unmapped_hits == (), gid
        assert failures(a.issues) == [], gid


def test_features(small_assembled: Assembled, small_manifest: Manifest) -> None:
    for gid, a in small_assembled.items():
        fids = [f.feature_id for f in a.features]
        assert len(set(fids)) == len(fids)
        for f in a.features[:20]:
            assert f.feature_id == ids.feature_id(gid, f.contig_id, f.start, f.end, f.strand)
        by_contig: dict[str, list[int]] = {}
        for f in a.features:
            by_contig.setdefault(f.contig_id, []).append(f.position_index)
        for contig, ranks in by_contig.items():
            assert sorted(ranks) == list(range(1, len(ranks) + 1)), (gid, contig)
        counts = {c.contig_id: c.feature_count for c in a.contigs}
        assert sum(counts.values()) == len(a.features)
        coding = [f for f in a.features if f.type in ("cds", "sorf")]
        assert all(f.protein_hash for f in coding)
        assert all(f.protein_hash is None for f in a.features if f.type not in ("cds", "sorf"))


def test_shared_plasmid_proteins_hash_alike(
    small_assembled: Assembled, small_manifest: Manifest
) -> None:
    kpc = small_manifest["plants"]["carbapenemase_plasmid"]["carriers"]
    hashes = {
        next(f.protein_hash for f in small_assembled[gid].features if f.locus_tag == s["locus_tag"])
        for gid, s in kpc.items()
    }
    assert len(hashes) == 1


def test_contig_classification(small_assembled: Assembled, small_manifest: Manifest) -> None:
    for gid, a in small_assembled.items():
        info = small_manifest["genomes"][gid]
        plasmids = {c.contig_id for c in a.contigs if c.classification == PLASMID}
        assert plasmids == set(info["plasmid_contigs"]), gid
        source = L.MOBSUITE.tool if info["has_mobsuite"] else L.GENOMAD.tool
        assert {c.classification_source for c in a.contigs} == {source}
        if not info["has_mobsuite"]:
            assert all(c.mob_cluster_id is None and c.replicon_types is None for c in a.contigs)
            others = {c.classification for c in a.contigs if c.contig_id not in plasmids}
            assert others == (
                {CHROMOSOME} if info["assembly_status"] == COMPLETE else {UNCLASSIFIED}
            )


def test_assembly_status(small_assembled: Assembled, small_manifest: Manifest) -> None:
    for gid, a in small_assembled.items():
        assert a.facts.assembly_status == small_manifest["genomes"][gid]["assembly_status"]


def test_mob_columns(small_assembled: Assembled, small_manifest: Manifest) -> None:
    kpc = small_manifest["plants"]["carbapenemase_plasmid"]
    for gid, site in kpc["carriers"].items():
        (contig,) = [c for c in small_assembled[gid].contigs if c.contig_id == site["contig"]]
        assert contig.classification == PLASMID
        if site["has_mobsuite"]:
            assert contig.mob_cluster_id == kpc["mob_primary_cluster"]
            assert list(contig.replicon_types or ()) == kpc["replicon_types"]
            assert contig.mobility in L.MOBSUITE.mobility_values
        else:
            assert contig.mob_cluster_id is None and contig.classification_source == "genomad"


def test_hits(small_assembled: Assembled, small_manifest: Manifest) -> None:
    kpc = small_manifest["plants"]["carbapenemase_plasmid"]
    for gid, site in kpc["carriers"].items():
        a = small_assembled[gid]
        features = {f.feature_id: f for f in a.features}
        hits = [h for h in a.hits if h.element_name == kpc["element"]]
        amr = [h for h in hits if h.source_tool == L.AMRFINDERPLUS.tool]
        assert len(amr) == 1
        assert features[amr[0].feature_id].locus_tag == site["locus_tag"]
        assert amr[0].location_class == PLASMID
        assert amr[0].element_type == "amr"
        info = small_manifest["genomes"][gid]
        assert amr[0].source_db_version == info["amrfinderplus_database"]
        assert amr[0].hit_id == ids.hit_id(amr[0].feature_id, "amrfinderplus", "blaKPC-2")
    for gid, a in small_assembled.items():
        rgi = [h for h in a.hits if h.source_tool == L.RGI.tool]
        if rgi:  # a genome without resistance genes has an RGI report without rows
            assert gid in small_manifest["plants"][L.RGI.tool]["with"]
        amr_features = {h.feature_id for h in a.hits if h.source_tool == L.AMRFINDERPLUS.tool}
        # RGI names SPAdes or Dnaapler contigs; mapped by sequence they land on AMRFinderPlus hits.
        assert {h.feature_id for h in rgi} <= amr_features
        classes = {c.contig_id: c.classification for c in a.contigs}
        assert all(h.location_class == classes[h.contig_id] for h in a.hits)
        assert len({h.hit_id for h in a.hits}) == len(a.hits)


def test_mutations(small_assembled: Assembled, small_manifest: Manifest) -> None:
    point = small_manifest["plants"]["point_mutations"]
    for symbol, genomes in point.items():
        gene, variant = symbol.rsplit("_", 1)
        for gid, site in genomes.items():
            a = small_assembled[gid]
            (m,) = [m for m in a.mutations if (m.gene, m.variant) == (gene, variant)]
            assert m.mutation_id == ids.mutation_id(gid, "amrfinderplus", gene, variant)
            features = {f.feature_id: f for f in a.features}
            assert m.feature_id is not None
            expected = site.get("feature_locus_tag") or site["locus_tag"]
            assert features[m.feature_id].locus_tag == expected
            assert (m.start, m.end, m.strand) == (site["start"], site["end"], site["strand"])


def test_regions(small_assembled: Assembled, small_manifest: Manifest) -> None:
    prophages = small_manifest["plants"]["prophages"]
    for gid, a in small_assembled.items():
        found = sorted((r.contig_id, r.start, r.end) for r in a.regions if r.type == PROPHAGE)
        assert found == sorted((p["contig"], p["start"], p["end"]) for p in prophages.get(gid, []))
        for r in a.regions:
            assert r.region_id == ids.region_id(gid, r.contig_id, r.start, r.end, "genomad", r.type)
            assert r.attributes.startswith("{")


def test_genome_facts(small_assembled: Assembled, small_manifest: Manifest) -> None:
    for gid, a in small_assembled.items():
        info = small_manifest["genomes"][gid]
        f = a.facts
        assert f.genome_size == info["total_length"]
        assert f.contig_count == info["contigs"]
        assert f.platform == info["detected_platform"]
        assert f.assembler == info["assembler"]
        assert f.assembler_version is not None
        assert f.checkm2_completeness == info["checkm2_completeness"]
        assert f.st == (None if info["st"] == "-" else info["st"])
        assert f.mlst_scheme == info["mlst_scheme"]
        assert 20 < f.gc_content < 80
        assert (f.gtdb_classification is not None) == info["in_gtdbtk"]


def test_tool_versions(small_assembled: Assembled, small_manifest: Manifest) -> None:
    for gid, a in small_assembled.items():
        info = small_manifest["genomes"][gid]
        versions = {t.tool: t for t in a.tool_versions}
        assert versions[PIPELINE_TOOL].version == PIPELINE_VERSION
        assert versions[L.BAKTA.tool].database_version == info["bakta_database"]
        amr = versions[L.AMRFINDERPLUS.tool]
        assert amr.database_version == info["amrfinderplus_database"]
        assert (L.RGI.tool in versions) == info["has_rgi"]
        assert (L.MOBSUITE.tool in versions) == info["has_mobsuite"]
        assert [t.tool for t in a.tool_versions] == sorted(versions)


def test_typing(small_assembled: Assembled, small_manifest: Manifest) -> None:
    display = load_typing_display()
    for gid, a in small_assembled.items():
        rows = a.typing
        tools = {r.source_tool for r in rows}
        info = small_manifest["genomes"][gid]
        assert (L.MLST.tool in tools) is True
        st = [r.value for r in rows if r.source_tool == L.MLST.tool and r.key == "ST"]
        assert st == ([] if info["st"] == "-" else [info["st"]])
        for r in rows:
            tool = display.tools[r.source_tool]  # type: ignore[index]
            assert r.key not in tool.exclude
            assert r.display_group == tool.display_group(r.key)
            assert r.tool_version is not None
    for gid in small_manifest["plants"]["typing"][L.KLEBORATE.tool]:
        keys = {r.key for r in small_assembled[gid].typing if r.source_tool == L.KLEBORATE.tool}
        assert "K_locus" in keys and "strain" not in keys and "N50" not in keys


def _contig(cid: str, index: int, length: int, circular: bool) -> BaktaContig:
    return BaktaContig(cid, index, length, 50.0, 50, 100, "circular" if circular else "linear",
                       circular, None, None, cid)  # fmt: skip


def test_genomad_classification_rule() -> None:
    contigs = [
        _contig("c1", 1, 5000, True),
        _contig("c2", 2, 800, True),
        _contig("c3", 3, 600, True),
    ]
    regions = [
        GenomadRegion("c2", 1, 800, PLASMID_REGION, 1.0, {}),
        GenomadRegion("c3", 1, 250, PLASMID_REGION, 1.0, {}),
        GenomadRegion("c1", 1, 4000, PROPHAGE, 1.0, {}),
    ]
    classes = classify_contigs(contigs, None, regions)
    assert {k: v[0] for k, v in classes.items()} == {
        "c1": CHROMOSOME, "c2": PLASMID, "c3": UNCLASSIFIED,
    }  # fmt: skip
    assert assembly_status(contigs, classes) == COMPLETE
    drafts = [_contig("c1", 1, 5000, False), _contig("c2", 2, 800, False)]
    classes = classify_contigs(drafts, None, regions[:1])
    assert {k: v[0] for k, v in classes.items()} == {"c1": UNCLASSIFIED, "c2": PLASMID}
    assert assembly_status(drafts, classes) == DRAFT
    unclassified = classify_contigs(drafts, None, [])
    assert assembly_status(drafts, unclassified) == DRAFT


def test_n50() -> None:
    assert n50([10, 20, 30, 40]) == 30
    assert n50([100]) == 100
    assert n50([]) == 0


# Real mgap runs ---------------------------------------------------------------------------------


def _assemble(root: Path, sample: str, gid: str) -> AssembledGenome:
    parsed = parse_sample(root, sample, gid)
    return assemble_genome(gid, parsed, load_typing_display(), parse_pipeline_info(root))


@pytest.mark.parametrize(
    ("name", "sample", "gid", "status", "unmapped"),
    [
        ("mgap-example", "SCL29833", "SCL29833", DRAFT, [("catB3", "contig_75", 78, 518)]),
        ("mgap-example", "SP10", "SP10", DRAFT, []),
        ("ont_example", "ont_SCL30014", "SCL30014", COMPLETE, [("blaTEM", "contig_4", 5962, 6531)]),
    ],
)
def test_real_examples(
    repo_root: Path,
    name: str,
    sample: str,
    gid: str,
    status: str,
    unmapped: list[tuple[str, str, int, int]],
) -> None:
    a = _assemble(real_example(repo_root, name), sample, gid)
    assert a.facts.assembly_status == status
    found = [(u.element_name, u.contig_id, u.start, u.end) for u in a.unmapped_hits]
    assert found == unmapped
    assert [i.rule for i in failures(a.issues)] == [RULE_UNMAPPED_HIT] * len(unmapped)
    assert all(m.feature_id is not None for m in a.mutations)


def test_real_nanopore_classification(repo_root: Path) -> None:
    a = _assemble(real_example(repo_root, "ont_example"), "ont_SCL30014", "SCL30014")
    assert [c.classification for c in a.contigs] == [CHROMOSOME] + [PLASMID] * 4
    assert {c.classification_source for c in a.contigs} == {L.GENOMAD.tool}
    disrupt = [h for h in a.hits if h.element_subtype == "POINT_DISRUPT"]
    assert [h.element_name for h in disrupt] == ["ompK35_E24insTer26"]
    versions = {t.tool: t.version for t in a.tool_versions}
    assert versions[PIPELINE_TOOL] is None and versions[L.BAKTA.tool] == "1.11.4"


def test_real_rgi_maps_by_sequence(repo_root: Path) -> None:
    a = _assemble(real_example(repo_root, "mgap-example"), "SCL29833", "SCL29833")
    rgi = [h for h in a.hits if h.source_tool == L.RGI.tool]
    assert len(rgi) == 45
    assert all(h.contig_id.startswith("contig_") for h in rgi)
    shv = [h for h in rgi if h.element_name == "SHV-11"]
    assert shv and shv[0].contig_id == "contig_2"
