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
from ingest.config import load_platform, load_species_registry
from ingest.side_tables import GENOME_GROUPS, GROUPS, METADATA, SETS, TOMBSTONES
from ingest.synth import MANIFEST, MARKER, RESULTS_DIR, SynthError, prepare_output, run_synth
from ingest.synth.sequences import random_cds, sha1_16, sub_rng, translate
from ingest.synth.species import load_species


def _at(path: L.MgapPath, results: Path, manifest: dict[str, Any], genome_id: str) -> Path:
    """Resolve ``path`` for a genome through its mgap sample and file prefix."""
    info = manifest["genomes"][genome_id]
    return path.resolve(results, info["mgap_sample"], info["file_prefix"])


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
        sample, prefix = info["mgap_sample"], info["file_prefix"]
        assert L.resolve_prefix(small_results, sample) == prefix
        platform = L.detect_platform(small_results, sample)
        assert platform == info["detected_platform"]
        for name, path in L.all_paths().items():
            if not path.per_genome or path.optional or path.provisional:
                continue
            if path.platform is not None and path.platform != platform:
                assert not path.resolve(small_results, sample, prefix).exists(), (gid, name)
                continue
            assert path.resolve(small_results, sample, prefix).exists(), (gid, name)
        read_report = L.FASTPLONG.json if platform == L.PLATFORM_ONT else L.FASTP.json
        assert read_report.resolve(small_results, sample, prefix).is_file()
        bracken = L.BRACKEN.report.resolve(small_results, sample, prefix)
        assert bracken.exists() == (platform == L.PLATFORM_ILLUMINA)
        rgi = L.RGI.report.resolve(small_results, sample, prefix)
        assert rgi.exists() == info["has_rgi"]
    assert L.PIPELINE_INFO.software_versions.resolve(small_results).is_file()
    assert L.GTDBTK.summary.resolve(small_results).is_file()


def test_tables_have_declared_headers(small_results: Path, small_manifest: dict[str, Any]) -> None:
    for gid in small_manifest["genomes"]:
        for name, table in L.all_tables().items():
            if table.path.per_genome:
                path = _at(table.path, small_results, small_manifest, gid)
            else:
                path = table.path.resolve(small_results)
            if not path.exists():
                continue
            lines = path.read_text(encoding="utf-8").splitlines()
            if table.header == L.HeaderStyle.FIRST_LINE:
                assert lines[0].split("\t") == list(table.columns), name
                assert all(len(x.split("\t")) == len(table.columns) for x in lines), name
            elif table.header == L.HeaderStyle.AFTER_COMMENTS:
                marker = table.header_prefix + table.columns[0]
                header = next(x for x in lines if x.startswith(marker))
                assert header[len(table.header_prefix) :].split("\t") == list(table.columns)
            elif table.header == L.HeaderStyle.ROW_LABELS:
                assert [x.split("\t")[0] for x in lines] == list(table.columns)


def test_bakta_files_are_consistent(small_results: Path, small_manifest: dict[str, Any]) -> None:
    for gid in small_manifest["genomes"]:
        fna = _fasta(_at(L.BAKTA.fna, small_results, small_manifest, gid).read_text())
        faa = _fasta(_at(L.BAKTA.faa, small_results, small_manifest, gid).read_text())
        ffn = _fasta(_at(L.BAKTA.ffn, small_results, small_manifest, gid).read_text())
        rows = _rows(_at(L.BAKTA.tsv, small_results, small_manifest, gid))
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
        summary = _at(L.BAKTA.summary, small_results, small_manifest, gid).read_text()
        assert f"Length: {sum(len(s) for s in fna.values())}" in summary
        assert f"CDSs: {sum(1 for r in features if r[1] == 'cds')}" in summary
        gbff = _at(L.BAKTA.gbff, small_results, small_manifest, gid).read_text()
        assert gbff.count("\nLOCUS ") + gbff.startswith("LOCUS ") == len(fna)
        assert gbff.count("/translation=") == len(faa)


def test_contig_names_match_between_tools(
    small_results: Path, small_manifest: dict[str, Any]
) -> None:
    for gid, info in small_manifest["genomes"].items():
        fna = _fasta(_at(L.BAKTA.fna, small_results, small_manifest, gid).read_text())
        if info["assembly_status"] == "draft":
            with gzip.open(_at(L.SPADES.scaffolds, small_results, small_manifest, gid), "rt") as fh:
                scaffolds = _fasta(fh.read())
            assert list(scaffolds.values()) == list(fna.values())
            assert all(L.SPADES.node_name_re.match(n) for n in scaffolds)
        if info["has_mobsuite"]:
            report = _dicts(_at(L.MOBSUITE.contig_report, small_results, small_manifest, gid))
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
    b, lr = L.BAKTA, L.LONG_READ
    for (gid,) in small_manifest["plants"]["complete_genomes"].values():
        fna = _at(b.fna, small_results, small_manifest, gid).read_text()
        headers = [x for x in fna.splitlines() if x.startswith(">")]
        tags = [L.parse_fna_header(h)[1] for h in headers]
        assert all(t[b.tag_topology] == b.topology_circular for t in tags)
        assert all(t[b.tag_completeness] == b.completeness_complete for t in tags)
        assert tags[0][b.tag_location] == b.location_chromosome
        assert all(b.tag_plasmid_name in t for t in tags[1:])
        rotated = _at(lr.dnaapler_fasta, small_results, small_manifest, gid).read_text()
        consensus = _at(lr.autocycler_fasta, small_results, small_manifest, gid).read_text()
        for text in (rotated, consensus):
            names = [x[1:] for x in text.splitlines() if x.startswith(">")]
            assert len(names) == len(headers)
            for name in names:
                m = lr.fasta_header_re.match(name)
                assert m and m.group("circular") == lr.circular_true
        assert list(_fasta(rotated).values()) == list(_fasta(fna).values())
        for a, c in zip(_fasta(consensus).values(), _fasta(fna).values(), strict=True):
            assert a != c and len(a) == len(c) and c in a + a
        gfa = _at(lr.dnaapler_gfa, small_results, small_manifest, gid).read_text().splitlines()
        assert gfa[0] == lr.gfa_header
        assert "\tRT:z:dnaA" in next(x for x in gfa if x.startswith("S\t1\t"))
        assert lr.gfa_self_links[0].format(index=1) in gfa
        size = _at(lr.genome_size, small_results, small_manifest, gid).read_text()
        assert size.strip().isdigit()


def test_draft_headers_are_linear(small_results: Path, small_manifest: dict[str, Any]) -> None:
    b = L.BAKTA
    for gid, info in small_manifest["genomes"].items():
        if info["assembly_status"] != "draft":
            continue
        fna = _at(b.fna, small_results, small_manifest, gid).read_text()
        for header in (x for x in fna.splitlines() if x.startswith(">")):
            _, tags = L.parse_fna_header(header)
            assert tags == {b.tag_gcode: str(b.gcode), b.tag_topology: b.topology_linear}


def test_prefixed_sample_resolves(small_synth: Path, small_manifest: dict[str, Any]) -> None:
    prefixed = small_manifest["plants"]["prefixed_sample_name"]
    assert len(prefixed) == 1
    ((gid, names),) = prefixed.items()
    results = small_synth / RESULTS_DIR
    sample, prefix = names["mgap_sample"], names["file_prefix"]
    assert sample != gid and prefix == f"{sample}_"
    assert small_manifest["genomes"][gid]["assembly_status"] == "complete"
    assert not (results / gid).exists() and (results / sample).is_dir()
    assert load_platform().genome_id_from_sample(sample) == gid
    assert L.resolve_prefix(results, sample) == prefix
    assert L.detect_platform(results, sample) == L.PLATFORM_ONT
    for path in (
        L.BAKTA.tsv,
        L.AMRFINDERPLUS.report,
        L.CHECKM2.report,
        L.MLST.report,
        L.GENOMAD.virus_summary,
        L.LONG_READ.dnaapler_gfa,
        L.LONG_READ.genome_size,
    ):
        assert path.resolve(results, sample, prefix).is_file(), path.template
    metadata = _csv(small_synth / METADATA.file_name)
    rows = {r["genome_id"]: r for r in metadata}
    assert rows[gid][METADATA.columns.mgap_sample] == sample
    assert sum(1 for r in metadata if r[METADATA.columns.mgap_sample]) == 1


def test_carbapenemase_plasmid_is_identical(
    small_results: Path, small_manifest: dict[str, Any]
) -> None:
    kpc = small_manifest["plants"]["carbapenemase_plasmid"]
    carriers = kpc["carriers"]
    assert len(carriers) >= 3
    neighborhoods: list[list[str]] = []
    for gid, site in carriers.items():
        assert site["contig_classification"] == "plasmid"
        faa = _fasta(_at(L.BAKTA.faa, small_results, small_manifest, gid).read_text())
        rows = [
            r
            for r in _rows(_at(L.BAKTA.tsv, small_results, small_manifest, gid))
            if r[0] == site["contig"] and r[1] == L.BAKTA.feature_types.cds
        ]
        index = next(i for i, r in enumerate(rows) if r[5] == site["locus_tag"])
        assert index >= 8 and len(rows) - index - 1 >= 8
        window = rows[index - 8 : index + 9]
        neighborhoods.append([sha1_16(faa[r[5]]) for r in window])
        report = _dicts(_at(L.AMRFINDERPLUS.report, small_results, small_manifest, gid))
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
            report = _dicts(_at(L.AMRFINDERPLUS.report, small_results, small_manifest, gid))
            mutations = _dicts(_at(L.AMRFINDERPLUS.mutations, small_results, small_manifest, gid))
            for rows in (report, mutations):
                row = next(r for r in rows if r[c.element_symbol] == symbol)
                assert row[c.subtype] == L.AMRFINDERPLUS.subtype_point
                assert (row[c.contig_id], int(row[c.start])) == (site["contig"], site["start"])
            bakta = [
                r
                for r in _rows(_at(L.BAKTA.tsv, small_results, small_manifest, gid))
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
        for r in _dicts(_at(L.AMRFINDERPLUS.mutations, small_results, small_manifest, gid))
    ]
    assert any(n.endswith(L.AMRFINDERPLUS.wildtype_suffix) for n in names)
    assert any(n.endswith(L.AMRFINDERPLUS.unknown_suffix) for n in names)


def test_fallback_genome_has_nothing(small_results: Path, small_manifest: dict[str, Any]) -> None:
    (gid,) = small_manifest["plants"]["no_determinants_no_plasmid"]
    for path in (L.AMRFINDERPLUS.report, L.AMRFINDERPLUS.mutations, L.RGI.report,
                 L.GENOMAD.plasmid_summary):  # fmt: skip
        resolved = _at(path, small_results, small_manifest, gid)
        if path.optional and not resolved.exists():
            continue
        assert len(_rows(resolved)) == 1, path.template
    assert not small_manifest["genomes"][gid]["plasmids"]
    assert small_manifest["genomes"][gid]["resistance_phrases"] == []


def test_mobsuite_present_for_some_only(
    small_results: Path, small_manifest: dict[str, Any]
) -> None:
    mob = small_manifest["plants"]["mobsuite"]
    assert mob["with"] and mob["without"]
    for gid in mob["without"]:
        assert not _at(L.MOBSUITE.directory, small_results, small_manifest, gid).exists()
    for gid in mob["with"]:
        assert _at(L.MOBSUITE.contig_report, small_results, small_manifest, gid).is_file()
        has_plasmids = bool(small_manifest["genomes"][gid]["plasmids"])
        assert (
            _at(L.MOBSUITE.mobtyper_results, small_results, small_manifest, gid).exists()
            == has_plasmids
        )


def test_regions_from_genomad(small_results: Path, small_manifest: dict[str, Any]) -> None:
    prophages = small_manifest["plants"]["prophages"]
    assert prophages
    for gid, regions in prophages.items():
        rows = _dicts(_at(L.GENOMAD.virus_summary, small_results, small_manifest, gid))
        names = {r[L.GENOMAD.virus_columns.seq_name] for r in rows}
        for region in regions:
            name = L.GENOMAD.provirus_name.format(
                contig=region["contig"], start=region["start"], end=region["end"]
            )
            assert name in names
    for gid, contigs in small_manifest["plants"]["genomad_plasmids"].items():
        rows = _dicts(_at(L.GENOMAD.plasmid_summary, small_results, small_manifest, gid))
        assert [r[L.GENOMAD.plasmid_columns.seq_name] for r in rows] == contigs


def test_mixed_annotation_versions(small_results: Path, small_manifest: dict[str, Any]) -> None:
    mixed = small_manifest["plants"]["mixed_annotation_versions"]
    assert mixed["species_code"] == "SEN"
    assert len(mixed["bakta_database"]) == 2
    assert len(mixed["amrfinderplus_database"]) == 2
    for version, genomes in mixed["bakta_database"].items():
        for gid in genomes:
            txt = _at(L.BAKTA.summary, small_results, small_manifest, gid).read_text()
            assert f"Database: v{version}, full" in txt
    process = L.AMRFINDERPLUS.process
    for version, genomes in mixed["amrfinderplus_database"].items():
        for gid in genomes:
            data = yaml.safe_load(
                _at(L.AMRFINDERPLUS.versions, small_results, small_manifest, gid).read_text()
            )
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
    bracken = _dicts(_at(L.BRACKEN.report, small_results, small_manifest, conflict))
    assert bracken[0][L.BRACKEN.columns.name] == sources["kraken2"]


def test_typing_plants(small_results: Path, small_manifest: dict[str, Any]) -> None:
    typing = small_manifest["plants"]["typing"]
    assert set(typing) == {L.KLEBORATE.tool, L.SISTR.tool, L.SCCMEC.tool}
    (absent,) = small_manifest["plants"]["typing_absent"]
    assert not _at(L.KLEBORATE.report, small_results, small_manifest, absent).exists()
    for gid in typing[L.KLEBORATE.tool]:
        assert _at(L.KLEBORATE.report, small_results, small_manifest, gid).is_file()
    (novel,) = small_manifest["plants"]["novel_st"]
    mlst = _rows(_at(L.MLST.report, small_results, small_manifest, novel))[0]
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
    assert METADATA.columns.mgap_sample in metadata[0]
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


# Species identities come from the registry (contract 0.7 §4.9 and §10) ------------------


def test_every_synth_species_is_in_the_registry() -> None:
    registry = load_species_registry()
    species = load_species(registry)
    assert len(species) == 10
    for spec in species:
        entry = registry.get(spec.code)
        assert spec.name == entry.canonical_name
        assert spec.gtdb_name == (entry.gtdb_name or entry.canonical_name)
        assert spec.mlst_scheme == (entry.mlst_schemes[0] if entry.mlst_schemes else None)
        assert spec.aliases == tuple(entry.aliases)


def test_synth_output_uses_registry_identities(
    small_synth: Path, small_results: Path, small_manifest: dict[str, Any]
) -> None:
    registry = load_species_registry()
    for row in small_manifest["species"]:
        entry = registry.get(row["species_code"])
        assert row["canonical_name"] == entry.canonical_name
        assert row["mlst_scheme"] == (entry.mlst_schemes[0] if entry.mlst_schemes else None)
    conflicts = set(small_manifest["plants"]["species_conflict"])
    gtdb = {
        r[L.GTDBTK.columns.user_genome]: r[L.GTDBTK.columns.classification]
        for r in _dicts(L.GTDBTK.summary.resolve(small_results))
    }
    for gid, info in small_manifest["genomes"].items():
        entry = registry.get(info["species_code"])
        assert info["species"] == entry.canonical_name
        mlst = _rows(_at(L.MLST.report, small_results, small_manifest, gid))[0]
        assert mlst[1] == (entry.mlst_schemes[0] if entry.mlst_schemes else L.MLST.missing)
        if gid in conflicts:
            continue
        if gid in gtdb:
            assert gtdb[gid].endswith(f"s__{entry.gtdb_name or entry.canonical_name}")
        report = _rows(_at(L.KRAKEN2.report, small_results, small_manifest, gid))
        species_rows = [r for r in report if r[3] == L.KRAKEN2.rank_species]
        top = max(species_rows, key=lambda r: int(r[1]))
        assert top[5].strip() == entry.canonical_name
    for row in _csv(small_synth / METADATA.file_name):
        name = row[METADATA.columns.species]
        if name:
            assert registry.by_name(name) is not None, name
