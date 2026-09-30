"""release build (contract §6, §7.1) and the whole command sequence (§8)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import duckdb
import pytest
from typer.testing import CliRunner

from conftest import copy_catalog
from ingest.catalog import connect
from ingest.cli import VALIDATION_EXIT, app
from ingest.config import load_palette
from ingest.release.build import build_release
from ingest.release.cgview import CGVIEW_VERSION, FORMAT, FORMAT_VERSION
from ingest.release.genome_files import cgview_bytes
from ingest.release.output import EPOCH_ENV, MARKER, ReleaseError
from ingest.release.tables import TABLES

runner = CliRunner()
EPOCH = "1790000000"
GROUP = "amr-network"


def _digests(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


@pytest.fixture(scope="module")
def release(small_catalog: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("release") / "synth"
    mp = pytest.MonkeyPatch()
    mp.setenv(EPOCH_ENV, EPOCH)
    try:
        build_release(small_catalog, out)
        build_release(small_catalog, out, GROUP)
    finally:
        mp.undo()
    return out


def _manifest(root: Path) -> dict[str, Any]:
    return json.loads((root / "manifest.json").read_text(encoding="utf-8"))


def test_layout(release: Path, small_manifest: dict[str, Any]) -> None:
    species = sorted({g["species_code"] for g in small_manifest["genomes"].values()})
    for t in TABLES:
        paths = [t.path(code) for code in species] if t.by_species else [t.path()]
        for path in paths:
            assert (release / path).is_file(), path
    for name in ("counts_by_species", "counts_by_species_year", "counts_by_species_st",
                 "counts_by_source", "counts_by_platform", "amr_class_by_species", "qc",
                 "search_index"):  # fmt: skip
        assert (release / "summaries" / f"{name}.parquet").is_file()
    assert (release / "presence_amr.parquet").is_file()
    for gid, info in small_manifest["genomes"].items():
        folder = release / "genomes" / info["species_code"] / gid
        names = sorted(p.name for p in folder.iterdir())
        assert names == [
            "cgview.json", "features.parquet", "genome.fna.gz", "genome.gbff.gz",
            "genome.gff3.gz", "proteins.faa.gz",
        ]  # fmt: skip
    assert (release / MARKER).is_file() and (release / GROUP / MARKER).is_file()


def test_parquet_properties(release: Path) -> None:
    con = duckdb.connect()
    meta = con.execute(
        f"""SELECT DISTINCT compression, stats_min IS NOT NULL
        FROM parquet_metadata('{(release / "tables/feature/KPN.parquet").as_posix()}')"""
    ).fetchall()
    assert {m[0] for m in meta} == {"ZSTD"} and (True,) in {(m[1],) for m in meta}
    order = con.execute(
        f"""SELECT genome_id, contig_id, start FROM
        '{(release / "tables/feature/KPN.parquet").as_posix()}'"""
    ).fetchall()
    assert order == sorted(order)
    genome = con.execute(
        f"SELECT species_code, genome_id FROM '{(release / 'tables/genome.parquet').as_posix()}'"
    ).fetchall()
    assert genome == sorted(genome)


def test_manifest(release: Path, small_manifest: dict[str, Any]) -> None:
    m = _manifest(release)
    assert m["schema_version"] == "0.1.0" and m["release_id"] == "synth"
    assert m["group_id"] is None and m["genome_count"] == len(small_manifest["genomes"])
    assert m["created"] == m["checks"]["validated_at"] == "2026-09-21T14:13:20Z"
    assert m["pipeline"] == {"name": "gene2dis/mgap", "versions": ["2.0.0"]}
    assert m["checks"]["validated"] is True and m["checks"]["warnings"] > 0
    paths = [f["path"] for f in m["files"]]
    assert paths == sorted(paths) and not any(p.startswith(f"{GROUP}/") for p in paths)
    bakta = next(t for t in m["tool_versions"] if t["tool"] == "bakta")
    assert bakta["database_versions"] == ["5.1", "6.0"]
    assert {s["species_code"] for s in m["species"]} == {"KPN", "SAU", "SEN"}
    for f in m["files"]:
        data = (release / f["path"]).read_bytes()
        assert len(data) == f["bytes"] and hashlib.sha256(data).hexdigest() == f["sha256"]


def test_build_is_deterministic(
    small_catalog: Path, release: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(EPOCH_ENV, EPOCH)
    again = tmp_path / "again"
    build_release(small_catalog, again)
    expected = {k: v for k, v in _digests(release).items() if not k.startswith(f"{GROUP}/")}
    assert _digests(again) == expected
    monkeypatch.delenv(EPOCH_ENV)
    clock = tmp_path / "clock"
    build_release(small_catalog, clock)
    a, b = _digests(again), _digests(clock)
    assert {k for k in a if a[k] != b.get(k)} == {"manifest.json"}
    ma, mb = _manifest(again), _manifest(clock)
    for m in (ma, mb):
        m.pop("created")
        m["checks"].pop("validated_at")
    assert ma == mb


def test_group_release(release: Path, small_manifest: dict[str, Any]) -> None:
    members = set(small_manifest["plants"]["access_groups"][GROUP])
    group = release / GROUP
    m = _manifest(group)
    assert m["group_id"] == GROUP and m["genome_count"] == len(members)
    con = duckdb.connect()
    genomes = {
        r[0]
        for r in con.execute(
            f"SELECT genome_id FROM '{(group / 'tables/genome.parquet').as_posix()}'"
        ).fetchall()
    }
    assert genomes == members
    for sub in ("contig", "feature", "annotation_hit"):
        found = con.execute(
            f"SELECT DISTINCT genome_id FROM '{(group / 'tables' / sub).as_posix()}/*.parquet'"
        ).fetchall()
        assert {r[0] for r in found} <= members
    sets = {s["set_id"]: s["genome_count"] for s in m["curated_sets"]}
    kpc = set(small_manifest["plants"]["curated_sets"]["kpc-plasmid-carriers"])
    assert sets.get("kpc-plasmid-carriers") == len(kpc & members)
    tomb = small_manifest["plants"]["tombstone"]
    rows = con.execute(
        f"SELECT genome_id FROM '{(group / 'tables/tombstone.parquet').as_posix()}'"
    ).fetchall()
    assert rows == ([(tomb["genome_id"],)] if tomb["replaced_by"] in members else [])
    genome_dirs = {p.name for p in (group / "genomes").glob("*/*")}
    assert genome_dirs == members


def test_full_build_keeps_group_directories(small_catalog: Path, tmp_path: Path) -> None:
    out = tmp_path / "rel"
    build_release(small_catalog, out, GROUP)
    build_release(small_catalog, out)
    assert (out / GROUP / "manifest.json").is_file()
    (out / "stray.txt").write_text("x")
    build_release(small_catalog, out)
    assert not (out / "stray.txt").exists()


def test_refuses_unmarked_output(small_catalog: Path, tmp_path: Path) -> None:
    out = tmp_path / "precious"
    out.mkdir()
    (out / "keep.txt").write_text("keep")
    with pytest.raises(ReleaseError, match="marker"):
        build_release(small_catalog, out)
    assert (out / "keep.txt").is_file()


def test_refuses_catalog_without_genome_files(small_catalog: Path, tmp_path: Path) -> None:
    catalog = tmp_path / "c" / small_catalog.name
    catalog.parent.mkdir()
    catalog.write_bytes(small_catalog.read_bytes())
    with pytest.raises(ReleaseError, match="per-genome files"):
        build_release(catalog, tmp_path / "out")


def test_refuses_failing_catalog(small_catalog: Path, tmp_path: Path) -> None:
    catalog = copy_catalog(small_catalog, tmp_path / "c")
    con = connect(catalog)
    con.execute("DELETE FROM genome_group WHERE genome_id = 'KPN0001'")
    con.close()
    with pytest.raises(ReleaseError, match="release check"):
        build_release(catalog, tmp_path / "out")
    with pytest.raises(ReleaseError, match="no access group"):
        build_release(small_catalog, tmp_path / "out2", "nope")


def test_features_parquet(release: Path, small_manifest: dict[str, Any]) -> None:
    kpc = small_manifest["plants"]["carbapenemase_plasmid"]["carriers"]
    gid = next(iter(kpc))
    path = release / "genomes" / "KPN" / gid / "features.parquet"
    con = duckdb.connect()
    records = dict(
        con.execute(f"SELECT record, count(*) FROM '{path.as_posix()}' GROUP BY 1").fetchall()
    )
    assert set(records) >= {"feature", "annotation_hit", "region"}
    columns = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM '{path.as_posix()}'").fetchall()]
    assert columns[0] == "record"
    assert {"feature_id", "hit_id", "mutation_id", "region_id", "element_name"} <= set(columns)
    rows = con.execute(f"SELECT record, contig_id, start FROM '{path.as_posix()}'").fetchall()
    keys = [(r, c, s if s is not None else 1 << 62) for r, c, s in rows]
    assert keys == sorted(keys)


def _check_document(doc: dict[str, Any]) -> None:
    cg = doc["cgview"]
    assert cg["version"] == CGVIEW_VERSION and cg["settings"]["showShading"] is False
    contigs = {c["name"]: c["length"] for c in cg["sequence"]["contigs"]}
    legend = [i["name"] for i in cg["legend"]["items"]]
    assert len(legend) == len(set(legend))
    feature_sources = {t["dataKeys"] for t in cg["tracks"] if t["dataType"] == "feature"}
    plot_sources = {t["dataKeys"] for t in cg["tracks"] if t["dataType"] == "plot"}
    assert all(t["position"] in ("inside", "outside") for t in cg["tracks"])
    for f in cg["features"]:
        assert f["contig"] in contigs and 1 <= f["start"] <= f["stop"] <= contigs[f["contig"]]
        assert f["strand"] in (1, -1) and f["legend"] in legend
        assert f["source"] in feature_sources and "feature_id" in f["meta"]
    total = sum(contigs.values())
    for p in cg["plots"]:
        assert p["source"] in plot_sources
        assert p["positions"] == sorted(p["positions"]) and p["positions"][0] == 1
        assert len(p["positions"]) == len(p["scores"]) and p["positions"][-1] <= total
        assert p["legendPositive"] in legend and p["legendNegative"] in legend


def test_cgview_documents(release: Path, small_manifest: dict[str, Any]) -> None:
    for gid, info in small_manifest["genomes"].items():
        data = json.loads(
            (release / "genomes" / info["species_code"] / gid / "cgview.json").read_text()
        )
        assert (data["format"], data["format_version"]) == (FORMAT, FORMAT_VERSION)
        _check_document(data["genome"])
        # JSON keys are sorted; the contig order is that of the genome map's sequence.
        assert set(data["contigs"]) == {
            c["name"] for c in data["genome"]["cgview"]["sequence"]["contigs"]
        }
        for doc in data["contigs"].values():
            _check_document(doc)
        tracks = [t["name"] for t in data["genome"]["cgview"]["tracks"]]
        assert tracks == [
            "CDS forward", "CDS reverse", "Other features", "Resistance determinants",
            "Virulence factors", "Regions", "GC content", "GC skew",
        ]  # fmt: skip


def _palette_colors() -> set[str]:
    palette = load_palette()
    colors = {palette.species.other, *palette.species.sequence}
    colors |= {d.color for d in palette.drug_classes}
    for section in ("contig_types", "tracks", "neighborhood_categories", "chrome"):
        colors |= set(palette.section(section).values())
    return {c.lower() for c in colors}


def _color_values(node: Any) -> list[str]:
    """Every string under a key that names a color, anywhere in a CGView document."""
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, str) and "color" in key.lower():
                found.append(value)
            else:
                found += _color_values(value)
    elif isinstance(node, list):
        for item in node:
            found += _color_values(item)
    return found


def test_cgview_colors_come_from_the_palette(release: Path, small_manifest: dict[str, Any]) -> None:
    """CLAUDE.md, Design: every color comes from config/palette.yaml, map furniture included."""
    allowed = _palette_colors()
    for gid, info in small_manifest["genomes"].items():
        data = json.loads(
            (release / "genomes" / info["species_code"] / gid / "cgview.json").read_text()
        )
        for doc in [data["genome"], *data["contigs"].values()]:
            cg = doc["cgview"]
            for key in ("backbone", "dividers", "ruler", "annotation"):
                assert key in cg, key
            assert "backgroundColor" in cg["settings"]
            values = _color_values(cg)
            assert values
            assert {v.lower() for v in values} <= allowed, set(values) - allowed


def test_cgview_version_matches_the_web_package(repo_root: Path) -> None:
    package = repo_root / "packages" / "web" / "package.json"
    if not package.is_file():
        pytest.skip("packages/web is absent")
    pinned = json.loads(package.read_text())["dependencies"]["cgview"]
    assert pinned.lstrip("^~=") == CGVIEW_VERSION


def test_write_cgview_fixture(small_catalog: Path, repo_root: Path) -> None:
    """Regenerate tests/fixtures/cgview.json, which the web package loads (CI checks git diff).

    The genome is the one with the fewest contigs, then features, among those with
    at least two contigs, a resistance determinant and a region, so the fixture
    stays small.
    """
    from ingest.catalog import files_dir

    con = connect(small_catalog, read_only=True)
    try:
        (gid,) = con.execute(
            """SELECT g.genome_id FROM genome g
            WHERE (SELECT count(*) FROM contig c WHERE c.genome_id = g.genome_id) >= 2
              AND g.amr_gene_count >= 1
              AND EXISTS (SELECT 1 FROM region r WHERE r.genome_id = g.genome_id)
            ORDER BY (SELECT count(*) FROM contig c WHERE c.genome_id = g.genome_id),
                     (SELECT count(*) FROM feature f WHERE f.genome_id = g.genome_id), 1
            LIMIT 1"""
        ).fetchone() or ("",)
        data = cgview_bytes(con, gid, files_dir(small_catalog) / gid, load_palette())
    finally:
        con.close()
    doc = json.loads(data)
    _check_document(doc["genome"])
    assert any(f["source"] == "resistance" for f in doc["genome"]["cgview"]["features"])
    assert any(f["source"] == "regions" for f in doc["genome"]["cgview"]["features"])
    fixture = repo_root / "tests" / "fixtures" / "cgview.json"
    fixture.parent.mkdir(parents=True, exist_ok=True)
    fixture.write_bytes(data)


def test_command_sequence(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """synth, metadata init, ingest, side tables, release check, build, check --release."""
    monkeypatch.setenv(EPOCH_ENV, EPOCH)
    synth = tmp_path / "synth"
    results = synth / "results"
    metadata = synth / "metadata.csv"
    catalog = tmp_path / "catalog" / "synth.duckdb"
    out = tmp_path / "releases" / "synth"
    steps = [
        ["synth", "--species", "3", "--genomes", "12", "--seed", "7", "--out", str(synth)],
        ["metadata", "init", "--mgap", str(results), "--existing", str(metadata),
         "--out", str(metadata)],
        ["metadata", "validate", str(metadata), "--mgap", str(results)],
        ["ingest", "--mgap", str(results), "--metadata", str(metadata), "--catalog", str(catalog)],
        ["groups", "ingest", "--groups", str(synth / "groups.csv"),
         "--members", str(synth / "genome_groups.csv"), "--catalog", str(catalog)],
        ["tombstones", "ingest", "--file", str(synth / "tombstones.csv"),
         "--catalog", str(catalog)],
        ["sets", "ingest", "--file", str(synth / "sets.csv"), "--catalog", str(catalog)],
        ["release", "check", "--catalog", str(catalog), "--metadata", str(metadata),
         "--mgap", str(results)],
        ["release", "build", "--catalog", str(catalog), "--out", str(out)],
        ["release", "build", "--catalog", str(catalog), "--out", str(out), "--group", GROUP],
        ["release", "check", "--catalog", str(catalog), "--release", str(out)],
    ]  # fmt: skip
    for args in steps:
        result = runner.invoke(app, args)
        assert result.exit_code == 0, (args, result.stdout, result.stderr)
    assert "0 without a feature" in runner.invoke(app, steps[3]).stdout
    assert "0 failures" in result.stdout
    # A tampered release fails the checksum rule.
    (out / "tables" / "typing.parquet").write_bytes(b"tampered")
    result = runner.invoke(app, steps[-1])
    assert result.exit_code == VALIDATION_EXIT
    assert "manifest.checksum" in result.stderr
    # A catalog that is not named after a release_id is refused.
    bad = runner.invoke(
        app, ["ingest", "--mgap", str(results), "--metadata", str(metadata),
              "--catalog", str(tmp_path / "latest.duckdb")],
    )  # fmt: skip
    assert bad.exit_code == VALIDATION_EXIT
