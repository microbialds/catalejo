"""The synthetic generator (contract §8.5): determinism, replacement guard, planted items."""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import time
from pathlib import Path
from typing import Any

import pytest
import yaml
from Bio.Seq import Seq

from ingest import mgap_layout as L
from ingest.side_tables import GENOME_GROUPS, GROUPS, METADATA, SETS, TOMBSTONES
from ingest.synth import MANIFEST, MARKER, RESULTS_DIR, SynthError, prepare_output, run_synth
from ingest.synth.sequences import random_cds, sha1_16, sub_rng, translate


def _digest(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _rows(path: Path) -> list[list[str]]:
    return [line.split("\t") for line in path.read_text(encoding="utf-8").splitlines()]


def _dicts(path: Path) -> list[dict[str, str]]:
    rows = _rows(path)
    return [dict(zip(rows[0], row, strict=True)) for row in rows[1:]]


def _csv(path: Path) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))


def _fasta(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    name = ""
    for line in text.splitlines():
        if line.startswith(">"):
            name = line[1:].split(" ")[0]
            out[name] = ""
        else:
            out[name] += line
    return out


# Sequences ---------------------------------------------------------------------------------


def test_translation_matches_biopython() -> None:
    rng = sub_rng(1, "test")
    for n in (3, 50, 301):
        cds = random_cds(rng, n, 0.55)
        assert len(cds) == 3 * n
        assert translate(cds) == str(Seq(cds).translate(table="Bacterial", cds=True))


def test_sub_rng_is_stable() -> None:
    assert sub_rng(42, "a", "b").random() == sub_rng(42, "a", "b").random()
    assert sub_rng(42, "a", "b").random() != sub_rng(42, "a", "c").random()


# Determinism and the replacement guard -------------------------------------------------------


def test_same_arguments_give_identical_bytes(
    tmp_path: Path, small_synth: Path, small_manifest: dict[str, Any]
) -> None:
    generator = small_manifest["generator"]
    seed, n_genomes = generator["seed"], generator["genomes"]
    again = tmp_path / "again"
    run_synth(out=again, n_species=3, n_genomes=n_genomes, seed=seed)
    assert _digest(again) == _digest(small_synth)
    other = tmp_path / "other"
    run_synth(out=other, n_species=3, n_genomes=n_genomes, seed=seed + 1)
    assert _digest(other) != _digest(small_synth)


def test_gzip_members_have_no_timestamp_or_name(small_results: Path) -> None:
    files = sorted(small_results.rglob("*.gz"))
    assert files
    for path in files:
        header = path.read_bytes()[:10]
        assert header[:2] == b"\x1f\x8b"
        assert header[3] & 0x08 == 0, f"{path} stores a file name"
        assert header[4:8] == b"\x00\x00\x00\x00", f"{path} stores a timestamp"


def test_replaces_marked_output(tmp_path: Path) -> None:
    out = tmp_path / "synth"
    run_synth(out=out, n_species=1, n_genomes=6, seed=1)
    (out / "stale.txt").write_text("from an earlier run")
    run_synth(out=out, n_species=1, n_genomes=6, seed=1)
    assert not (out / "stale.txt").exists()
    assert (out / MARKER).is_file()


def test_replaces_empty_directory(tmp_path: Path) -> None:
    out = tmp_path / "empty"
    out.mkdir()
    assert prepare_output(out) == out.resolve()
    assert (out / MARKER).is_file()


def test_refuses_unmarked_directory(tmp_path: Path) -> None:
    out = tmp_path / "precious"
    out.mkdir()
    (out / "notes.txt").write_text("keep me")
    with pytest.raises(SynthError, match="marker"):
        run_synth(out=out, n_species=1, n_genomes=6, seed=1)
    assert (out / "notes.txt").read_text() == "keep me"


def test_refuses_paths_outside_repository_and_temp() -> None:
    with pytest.raises(SynthError, match="inside the repository"):
        prepare_output(Path("/catalejo-synth-refused"))


def test_refuses_repository_root(repo_root: Path) -> None:
    with pytest.raises(SynthError):
        prepare_output(repo_root)


def test_rejects_impossible_requests(tmp_path: Path) -> None:
    with pytest.raises(SynthError):
        run_synth(out=tmp_path / "x", n_species=11, n_genomes=100, seed=1)
    with pytest.raises(SynthError):
        run_synth(out=tmp_path / "y", n_species=3, n_genomes=5, seed=1)
    assert not (tmp_path / "x").exists() and not (tmp_path / "y").exists()


@pytest.mark.slow
def test_default_run_is_fast_and_deterministic(tmp_path: Path) -> None:
    started = time.monotonic()
    summary = run_synth(out=tmp_path / "default", n_species=3, n_genomes=60, seed=42)
    elapsed = time.monotonic() - started
    assert summary.genomes == 60
    assert elapsed < 60, f"default synth run took {elapsed:.1f} s"
    assert summary.bytes < 80e6


# Output shape --------------------------------------------------------------------------------


def test_layout_is_complete(small_results: Path, small_manifest: dict[str, Any]) -> None:
    for gid, info in small_manifest["genomes"].items():
        complete = info["assembly_status"] == "complete"
        for name, path in L.all_paths().items():
            if not path.per_genome or path.optional:
                continue
            is_long_read = name.startswith("LongReadLayout.")
            is_spades = name.startswith("SpadesLayout.")
            if is_long_read and not complete:
                continue
            if is_long_read and path.template.endswith(".autocycler.fasta.gz"):
                continue
            if is_spades and complete:
                continue
            if name == "RgiLayout.json":
                continue
            assert path.resolve(small_results, gid).is_file(), (gid, name)
    assert L.PIPELINE_INFO.software_versions.resolve(small_results).is_file()
    assert L.GTDBTK.summary.resolve(small_results).is_file()


def test_tables_have_declared_headers(small_results: Path, small_manifest: dict[str, Any]) -> None:
    for gid in small_manifest["genomes"]:
        for name, table in L.all_tables().items():
            path = table.path.resolve(small_results, gid if table.path.per_genome else None)
            if not path.exists():
                continue
            lines = path.read_text(encoding="utf-8").splitlines()
            if table.header == L.HeaderStyle.FIRST_LINE:
                assert lines[0].split("\t") == list(table.columns), name
                assert all(len(x.split("\t")) == len(table.columns) for x in lines), name
            elif table.header == L.HeaderStyle.AFTER_COMMENTS:
                header = next(x for x in lines if not x.startswith(table.comment_prefix))
                assert header[len(table.header_prefix) :].split("\t") == list(table.columns)
            elif table.header == L.HeaderStyle.ROW_LABELS:
                assert [x.split("\t")[0] for x in lines] == list(table.columns)


def test_bakta_files_are_consistent(small_results: Path, small_manifest: dict[str, Any]) -> None:
    for gid in small_manifest["genomes"]:
        fna = _fasta(L.BAKTA.fna.resolve(small_results, gid).read_text())
        faa = _fasta(L.BAKTA.faa.resolve(small_results, gid).read_text())
        ffn = _fasta(L.BAKTA.ffn.resolve(small_results, gid).read_text())
        rows = _rows(L.BAKTA.tsv.resolve(small_results, gid))
        features = [r for r in rows if not r[0].startswith("#")]
        cds = [r for r in features if r[1] in (L.BAKTA.feature_types.cds, "sorf")]
        assert len(cds) == len(faa)
        for contig, _type, start, stop, strand, locus, *_ in cds:
            seq = fna[contig][int(start) - 1 : int(stop)]
            if strand == "-":
                seq = str(Seq(seq).reverse_complement())
            assert seq == ffn[locus]
            assert str(Seq(seq).translate(table="Bacterial", cds=True)) == faa[locus]
            assert 1 <= int(start) <= int(stop) <= len(fna[contig])
        summary = L.BAKTA.summary.resolve(small_results, gid).read_text()
        assert f"Length: {sum(len(s) for s in fna.values())}" in summary
        assert f"CDSs: {sum(1 for r in features if r[1] == 'cds')}" in summary
        gbff = L.BAKTA.gbff.resolve(small_results, gid).read_text()
        assert gbff.count("\nLOCUS ") + gbff.startswith("LOCUS ") == len(fna)
        assert gbff.count("/translation=") == len(faa)


def test_contig_names_match_between_tools(
    small_results: Path, small_manifest: dict[str, Any]
) -> None:
    for gid, info in small_manifest["genomes"].items():
        fna = _fasta(L.BAKTA.fna.resolve(small_results, gid).read_text())
        if info["assembly_status"] == "draft":
            with gzip.open(L.SPADES.scaffolds.resolve(small_results, gid), "rt") as fh:
                scaffolds = _fasta(fh.read())
            assert list(scaffolds.values()) == list(fna.values())
            assert all(L.SPADES.node_name_re.match(n) for n in scaffolds)
        if info["has_mobsuite"]:
            report = _dicts(L.MOBSUITE.contig_report.resolve(small_results, gid))
            column = L.MOBSUITE.contig_report_columns.contig_id
            assert sorted(r[column].split(" ")[0] for r in report) == sorted(fna)


# Planted items (requirements acceptance items) --------------------------------------------------


def test_complete_and_draft_per_species(small_manifest: dict[str, Any]) -> None:
    plants = small_manifest["plants"]
    for code in ("KPN", "SEN", "SAU"):
        assert len(plants["complete_genomes"][code]) == 1
        assert plants["draft_genomes"][code]
    assert len(plants["fragmented_assembly"]) == 1
    fragmented = plants["fragmented_assembly"][0]
    assert small_manifest["genomes"][fragmented]["contigs"] >= 200


def test_complete_genomes_are_circular(small_results: Path, small_manifest: dict[str, Any]) -> None:
    for gid in small_manifest["plants"]["complete_genomes"].values():
        fna = L.BAKTA.fna.resolve(small_results, gid[0]).read_text()
        headers = [x for x in fna.splitlines() if x.startswith(">")]
        assert all(f"[topology={L.BAKTA.topology_circular}]" in h for h in headers)
        info = _rows(L.LONG_READ.flye_info.resolve(small_results, gid[0]))
        assert all(r[3] == L.LONG_READ.flye_circular_yes for r in info[1:])


def test_carbapenemase_plasmid_is_identical(
    small_results: Path, small_manifest: dict[str, Any]
) -> None:
    kpc = small_manifest["plants"]["carbapenemase_plasmid"]
    carriers = kpc["carriers"]
    assert len(carriers) >= 3
    neighborhoods: list[list[str]] = []
    for gid, site in carriers.items():
        assert site["contig_classification"] == "plasmid"
        faa = _fasta(L.BAKTA.faa.resolve(small_results, gid).read_text())
        rows = [
            r
            for r in _rows(L.BAKTA.tsv.resolve(small_results, gid))
            if r[0] == site["contig"] and r[1] == L.BAKTA.feature_types.cds
        ]
        index = next(i for i, r in enumerate(rows) if r[5] == site["locus_tag"])
        assert index >= 8 and len(rows) - index - 1 >= 8
        window = rows[index - 8 : index + 9]
        neighborhoods.append([sha1_16(faa[r[5]]) for r in window])
        report = _dicts(L.AMRFINDERPLUS.report.resolve(small_results, gid))
        symbol = L.AMRFINDERPLUS.columns.element_symbol
        assert any(r[symbol] == "blaKPC-2" for r in report)
    assert all(n == neighborhoods[0] for n in neighborhoods)
    with_mob = [g for g, s in carriers.items() if s["has_mobsuite"]]
    assert small_manifest["plants"]["shared_mob_clusters"][kpc["mob_primary_cluster"]] == with_mob


def test_point_mutations_overlap_cds(small_results: Path, small_manifest: dict[str, Any]) -> None:
    point = small_manifest["plants"]["point_mutations"]
    assert {"gyrA_S83I", "parC_S80I", "blaSHV_C-112T"} <= set(point)
    c = L.AMRFINDERPLUS.columns
    for symbol, carriers in point.items():
        for gid, site in carriers.items():
            report = _dicts(L.AMRFINDERPLUS.report.resolve(small_results, gid))
            mutations = _dicts(L.AMRFINDERPLUS.mutations.resolve(small_results, gid))
            for rows in (report, mutations):
                row = next(r for r in rows if r[c.element_symbol] == symbol)
                assert row[c.subtype] == L.AMRFINDERPLUS.subtype_point
                assert (row[c.contig_id], int(row[c.start])) == (site["contig"], site["start"])
            bakta = [
                r
                for r in _rows(L.BAKTA.tsv.resolve(small_results, gid))
                if r[0] == site["contig"] and r[1] == L.BAKTA.feature_types.cds
            ]
            assert any(int(r[2]) <= site["end"] and int(r[3]) >= site["start"] for r in bakta), (
                symbol,
                gid,
            )
    kpn2 = small_manifest["plants"]["point_mutations"]["gyrA_S83I"]
    assert kpn2


def test_mutation_report_has_wildtype_rows(
    small_results: Path, small_manifest: dict[str, Any]
) -> None:
    c = L.AMRFINDERPLUS.columns
    names = [
        r[c.element_name]
        for gid in small_manifest["genomes"]
        for r in _dicts(L.AMRFINDERPLUS.mutations.resolve(small_results, gid))
    ]
    assert any(n.endswith(L.AMRFINDERPLUS.wildtype_suffix) for n in names)
    assert any(n.endswith(L.AMRFINDERPLUS.unknown_suffix) for n in names)


def test_fallback_genome_has_nothing(small_results: Path, small_manifest: dict[str, Any]) -> None:
    (gid,) = small_manifest["plants"]["no_determinants_no_plasmid"]
    for path in (L.AMRFINDERPLUS.report, L.AMRFINDERPLUS.mutations, L.RGI.report,
                 L.GENOMAD.plasmid_summary):  # fmt: skip
        assert len(_rows(path.resolve(small_results, gid))) == 1, path.template
    assert not small_manifest["genomes"][gid]["plasmids"]
    assert small_manifest["genomes"][gid]["resistance_phrases"] == []


def test_mobsuite_present_for_some_only(
    small_results: Path, small_manifest: dict[str, Any]
) -> None:
    mob = small_manifest["plants"]["mobsuite"]
    assert mob["with"] and mob["without"]
    for gid in mob["without"]:
        assert not L.MOBSUITE.directory.resolve(small_results, gid).exists()
    for gid in mob["with"]:
        assert L.MOBSUITE.contig_report.resolve(small_results, gid).is_file()
        has_plasmids = bool(small_manifest["genomes"][gid]["plasmids"])
        assert L.MOBSUITE.mobtyper_results.resolve(small_results, gid).exists() == has_plasmids


def test_regions_from_genomad(small_results: Path, small_manifest: dict[str, Any]) -> None:
    prophages = small_manifest["plants"]["prophages"]
    assert prophages
    for gid, regions in prophages.items():
        rows = _dicts(L.GENOMAD.virus_summary.resolve(small_results, gid))
        names = {r[L.GENOMAD.virus_columns.seq_name] for r in rows}
        for region in regions:
            name = L.GENOMAD.provirus_name.format(
                contig=region["contig"], start=region["start"], end=region["end"]
            )
            assert name in names
    for gid, contigs in small_manifest["plants"]["genomad_plasmids"].items():
        rows = _dicts(L.GENOMAD.plasmid_summary.resolve(small_results, gid))
        assert [r[L.GENOMAD.plasmid_columns.seq_name] for r in rows] == contigs


def test_mixed_annotation_versions(small_results: Path, small_manifest: dict[str, Any]) -> None:
    mixed = small_manifest["plants"]["mixed_annotation_versions"]
    assert mixed["species_code"] == "SEN"
    assert len(mixed["bakta_database"]) == 2
    assert len(mixed["amrfinderplus_database"]) == 2
    for version, genomes in mixed["bakta_database"].items():
        for gid in genomes:
            txt = L.BAKTA.summary.resolve(small_results, gid).read_text()
            assert f"Database: v{version}, full" in txt
    process = L.AMRFINDERPLUS.process
    for version, genomes in mixed["amrfinderplus_database"].items():
        for gid in genomes:
            data = yaml.safe_load(L.AMRFINDERPLUS.versions.resolve(small_results, gid).read_text())
            assert data[process][L.AMRFINDERPLUS.database_key] == version


def test_species_assignment_plants(small_results: Path, small_manifest: dict[str, Any]) -> None:
    plants = small_manifest["plants"]
    gtdb = _dicts(L.GTDBTK.summary.resolve(small_results))
    classified = {r[L.GTDBTK.columns.user_genome]: r for r in gtdb}
    mlst_only = plants["species_from_mlst_only"]
    assert mlst_only["species_code"] == "SAU" and mlst_only["genomes"]
    assert not set(mlst_only["genomes"]) & set(classified)
    (conflict, sources) = next(iter(plants["species_conflict"].items()))
    assert sources["metadata"] == "Klebsiella pneumoniae"
    assert classified[conflict][L.GTDBTK.columns.classification].endswith(sources["gtdbtk"])
    bracken = _dicts(L.BRACKEN.report.resolve(small_results, conflict))
    assert bracken[0][L.BRACKEN.columns.name] == sources["kraken2"]


def test_typing_plants(small_results: Path, small_manifest: dict[str, Any]) -> None:
    typing = small_manifest["plants"]["typing"]
    assert set(typing) == {L.KLEBORATE.tool, L.SISTR.tool, L.SCCMEC.tool}
    (absent,) = small_manifest["plants"]["typing_absent"]
    assert not L.KLEBORATE.report.resolve(small_results, absent).exists()
    for gid in typing[L.KLEBORATE.tool]:
        assert L.KLEBORATE.report.resolve(small_results, gid).is_file()
    (novel,) = small_manifest["plants"]["novel_st"]
    mlst = _rows(L.MLST.report.resolve(small_results, novel))[0]
    assert mlst[2] == L.MLST.missing


def test_resistance_phrases_are_covered(small_manifest: dict[str, Any]) -> None:
    phrases = small_manifest["plants"]["resistance_phrases"]
    for phrase in ("carbapenem-resistant", "colistin-resistant", "ESBL-producing",
                   "methicillin-resistant"):  # fmt: skip
        assert phrases.get(phrase), phrase
    assert small_manifest["plants"]["no_resistance_phrase"]


def test_virulence_and_stress(small_manifest: dict[str, Any]) -> None:
    assert small_manifest["plants"]["virulence"]
    assert small_manifest["plants"]["stress"]


def test_side_tables(small_synth: Path, small_manifest: dict[str, Any]) -> None:
    genomes = set(small_manifest["genomes"])
    metadata = _csv(small_synth / METADATA.file_name)
    assert {r["genome_id"] for r in metadata} == genomes
    assert list(metadata[0])[: len(METADATA.columns.names())] == list(METADATA.columns.names())
    assert len(metadata[0]) > len(METADATA.columns.names())
    dates = {r[METADATA.columns.isolation_date] for r in metadata}
    assert {len(d) for d in dates} >= {4, 7, 10} or len(genomes) < 10
    assert any(r[METADATA.columns.species] for r in metadata)
    assert {r[METADATA.columns.source_type] for r in metadata} <= set(METADATA.source_types)

    groups = _csv(small_synth / GROUPS.file_name)
    assert len(groups) == 2
    members = _csv(small_synth / GENOME_GROUPS.file_name)
    by_group: dict[str, set[str]] = {}
    for r in members:
        by_group.setdefault(r["group_id"], set()).add(r["genome_id"])
    assert set().union(*by_group.values()) == genomes
    first, second = by_group.values()
    assert first & second

    sets = _csv(small_synth / SETS.file_name)
    sizes: dict[str, int] = {}
    for r in sets:
        sizes[r["set_id"]] = sizes.get(r["set_id"], 0) + 1
    assert len(sizes) == 2 and min(sizes.values()) == 1

    (tombstone,) = _csv(small_synth / TOMBSTONES.file_name)
    assert tombstone["genome_id"] not in genomes
    assert tombstone["replaced_by"] in genomes
    assert tombstone["reason"] in TOMBSTONES.reasons


def test_year_spread_default_run(small_manifest: dict[str, Any], small_synth: Path) -> None:
    metadata = _csv(small_synth / METADATA.file_name)
    years = {int(r[METADATA.columns.isolation_date][:4]) for r in metadata}
    assert min(years) >= 2015 and max(years) <= 2025
    assert len(years) >= 8


def test_more_species(tmp_path: Path) -> None:
    out = tmp_path / "ten"
    summary = run_synth(out=out, n_species=10, n_genomes=40, seed=3)
    assert len(summary.species) == 10
    manifest = json.loads((out / MANIFEST).read_text())
    no_scheme = manifest["plants"]["no_mlst_scheme"]
    assert list(no_scheme) == ["SMA"]
    gid = no_scheme["SMA"][0]
    mlst = _rows(L.MLST.report.resolve(out / RESULTS_DIR, gid))[0]
    assert mlst[1:] == [L.MLST.missing, L.MLST.missing]
