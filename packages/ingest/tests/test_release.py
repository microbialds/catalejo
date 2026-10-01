"""release build (contract §6, §7.1) and the whole command sequence (§8)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

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
from ingest.side import ingest_groups
from ingest.synth.plan import AMRFINDER_DB, AMRFINDER_DB_OLD, BAKTA_DB, BAKTA_DB_OLD

runner = CliRunner()
EPOCH = "1790000000"
GROUP = "amr-network"
CORE = "core"
GROUPS = (GROUP, CORE)


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
        build_release(small_catalog, out, CORE)
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
                 "counts_by_source", "counts_by_platform", "amr_class_by_species",
                 "amr_class_by_genome", "qc", "search_index"):  # fmt: skip
        assert (release / "summaries" / f"{name}.parquet").is_file()
    for name in ("presence_amr", "presence_mob", "presence_replicon"):
        assert (release / f"{name}.parquet").is_file()
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
    assert paths == sorted(paths) and not any(p.split("/")[0] in GROUPS for p in paths)
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
    expected = {k: v for k, v in _digests(release).items() if k.split("/")[0] not in GROUPS}
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
    genome_dirs = {p.name for p in (group / "genomes").glob("*/*")}
    assert genome_dirs == members


def _column(path: Path, sql: str) -> list[Any]:
    return duckdb.connect().execute(sql.replace("FILE", f"'{path.as_posix()}'")).fetchall()


def test_group_releases_route_tombstones(release: Path, small_manifest: dict[str, Any]) -> None:
    """A group release holds the tombstones with a genome_group row for it (decision 7c)."""
    tomb = small_manifest["plants"]["tombstone"]
    assert tomb["access_groups"] == [CORE]
    query = "SELECT genome_id, replaced_by FROM FILE"
    expected = [(tomb["genome_id"], tomb["replaced_by"])]
    assert _column(release / "tables/tombstone.parquet", query) == expected
    assert _column(release / CORE / "tables/tombstone.parquet", query) == expected
    assert _column(release / GROUP / "tables/tombstone.parquet", query) == []
    # The tombstoned genome is in no other table of any release.
    for root in (release, release / CORE, release / GROUP):
        found = _column(root / "tables/genome.parquet", "SELECT genome_id FROM FILE")
        assert (tomb["genome_id"],) not in found
    assert _manifest(release / CORE)["genome_count"] == len(
        small_manifest["plants"]["access_groups"][CORE]
    )


def test_search_index_product_targets(release: Path) -> None:
    rows = _column(
        release / "summaries/search_index.parquet",
        "SELECT term, target FROM FILE WHERE kind = 'product'",
    )
    assert rows
    for term, target in rows:
        assert target == f"/genes?search={quote(term, safe='')}"
    assert any(" " in term and "%20" in target for term, target in rows)


def _sentences(root: Path) -> dict[str, tuple[Any, ...]]:
    rows = _column(
        root / "tables/genome.parquet",
        """SELECT genome_id, summary_sentence, amr_gene_count, amr_mutation_count,
        plasmid_contig_count, prophage_region_count FROM FILE""",
    )
    return {r[0]: tuple(r[1:]) for r in rows}


def test_group_release_counts_cluster_size_in_the_group(
    small_catalog: Path, small_synth: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """cluster_size counts the genomes of the group release (decision 6b)."""
    monkeypatch.setenv(EPOCH_ENV, EPOCH)
    catalog = copy_catalog(small_catalog, tmp_path / "c")
    con = connect(catalog, read_only=True)
    try:
        st11 = [
            r[0]
            for r in con.execute(
                "SELECT genome_id FROM genome WHERE species_code = 'KPN' AND st = '11' ORDER BY 1"
            ).fetchall()
        ]
        stored = dict(con.execute("SELECT genome_id, summary_sentence FROM genome").fetchall())
        everyone = [r[0] for r in con.execute("SELECT genome_id FROM genome ORDER BY 1").fetchall()]
    finally:
        con.close()
    assert len(st11) >= 2
    alone, other = st11[0], st11[1]
    assert f"group of {len(st11)} ST11 genomes" in stored[alone]
    # A group holding one genome of the ST11 group of KPN, and one other genome.
    groups = tmp_path / "groups.csv"
    groups.write_text("group_id,name,description\ncore,Core,\nsplit,Split,\n", encoding="utf-8")
    members = tmp_path / "genome_groups.csv"
    rows = [f"{g},core" for g in everyone] + [f"{alone},split", "SAU0001,split"]
    members.write_text("genome_id,group_id\n" + "\n".join(rows) + "\n", encoding="utf-8")
    ingest_groups(catalog, groups, members)

    out = tmp_path / "rel"
    build_release(catalog, out)
    build_release(catalog, out, "split")
    full, split = _sentences(out), _sentences(out / "split")
    assert {g: v[0] for g, v in full.items()} == stored
    assert set(split) == {alone, "SAU0001"}
    assert "group of" not in split[alone][0]
    assert split[alone][0] != full[alone][0]
    assert split[alone][1:] == full[alone][1:]
    assert f"group of {len(st11)} ST11 genomes" in full[other][0]
    # The catalog keeps the collection-wide sentences.
    con = connect(catalog, read_only=True)
    try:
        after = dict(con.execute("SELECT genome_id, summary_sentence FROM genome").fetchall())
    finally:
        con.close()
    assert after == stored
    # A group release is deterministic too.
    first = _digests(out / "split")
    build_release(catalog, out, "split")
    assert _digests(out / "split") == first


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
        ["tombstones", "ingest", "--file", str(synth / "tombstones.csv"),
         "--catalog", str(catalog)],
        ["groups", "ingest", "--groups", str(synth / "groups.csv"),
         "--members", str(synth / "genome_groups.csv"), "--catalog", str(catalog)],
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


# Contract 0.9 §6.2 and §6.4, milestone 1b.

GENOME_FILES = ("summaries/amr_class_by_genome.parquet", "presence_replicon.parquet")


def _amr_class_by_genome(root: Path) -> list[tuple[Any, ...]]:
    return _column(
        root / "summaries/amr_class_by_genome.parquet",
        "SELECT genome_id, species_code, drug_class, hit_count FROM FILE",
    )


def test_amr_class_by_genome(release: Path) -> None:
    """One row per genome and class with a hit, sorted, per-genome sums are amr_gene_count."""
    path = release / "summaries/amr_class_by_genome.parquet"
    con = duckdb.connect()
    types = con.execute(f"DESCRIBE SELECT * FROM '{path.as_posix()}'").fetchall()
    assert [(t[0], t[1]) for t in types] == [
        ("genome_id", "VARCHAR"), ("species_code", "VARCHAR"), ("drug_class", "VARCHAR"),
        ("hit_count", "INTEGER"),
    ]  # fmt: skip
    meta = con.execute(
        f"SELECT DISTINCT compression FROM parquet_metadata('{path.as_posix()}')"
    ).fetchall()
    assert meta == [("ZSTD",)]
    rows = _amr_class_by_genome(release)
    assert rows and rows == sorted(rows)
    keys = [r[:3] for r in rows]
    assert len(keys) == len(set(keys)) and all(r[3] >= 1 for r in rows)
    palette = load_palette()
    allowed = {d.key for d in palette.drug_classes} | {"other"}
    assert {r[2] for r in rows} <= allowed
    genomes = _column(
        release / "tables/genome.parquet",
        "SELECT genome_id, species_code, amr_gene_count FROM FILE",
    )
    sums: dict[str, int] = {}
    for gid, _, _, n in rows:
        sums[gid] = sums.get(gid, 0) + n
    for gid, _, amr in genomes:
        assert sums.get(gid, 0) == amr, gid
    species = {gid: code for gid, code, _ in genomes}
    assert all(species[gid] == code for gid, code, _, _ in rows)


def test_amr_class_by_genome_agrees_with_amr_class_by_species(release: Path) -> None:
    """Per species and class, distinct genomes give genome_count and sums give hit_count."""
    for root in (release, release / GROUP, release / CORE):
        expected: dict[tuple[str, str], tuple[set[str], int]] = {}
        for gid, code, key, n in _amr_class_by_genome(root):
            genomes, hits = expected.get((code, key), (set[str](), 0))
            expected[(code, key)] = (genomes | {gid}, hits + n)
        species = _column(
            root / "summaries/amr_class_by_species.parquet",
            "SELECT species_code, drug_class, genome_count, hit_count FROM FILE",
        )
        assert species
        assert {(c, k): (g, h) for c, k, g, h in species} == {
            k: (len(g), h) for k, (g, h) in expected.items()
        }


def test_presence_replicon(release: Path, small_manifest: dict[str, Any]) -> None:
    """Every genome has a row; one sorted BOOLEAN column per replicon type of its contigs."""
    path = release / "presence_replicon.parquet"
    con = duckdb.connect()
    described = con.execute(f"DESCRIBE SELECT * FROM '{path.as_posix()}'").fetchall()
    columns = [d[0] for d in described]
    assert columns[:2] == ["genome_id", "species_code"]
    replicons = columns[2:]
    assert replicons and replicons == sorted(replicons)
    assert all(d[1] == "BOOLEAN" for d in described[2:])
    genomes = _column(release / "tables/genome.parquet", "SELECT genome_id FROM FILE")
    rows = con.execute(f"SELECT * FROM '{path.as_posix()}'").fetchall()
    assert [(r[0],) for r in rows] == sorted(genomes)
    contigs = con.execute(
        f"""SELECT DISTINCT genome_id, unnest(replicon_types) FROM
        '{(release / "tables/contig").as_posix()}/*.parquet' WHERE replicon_types IS NOT NULL"""
    ).fetchall()
    expected = {(g, r) for g, r in contigs}
    assert {r for _, r in expected} == set(replicons)
    found = {(r[0], c) for r in rows for c, v in zip(replicons, r[2:], strict=True) if v}
    assert found == expected
    assert any(not any(r[2:]) for r in rows), "a genome without replicons keeps an all-false row"
    plant = small_manifest["plants"]["carbapenemase_plasmid"]
    carriers = [g for g, info in plant["carriers"].items() if info["has_mobsuite"]]
    assert carriers
    for gid in carriers:
        for replicon in plant["replicon_types"]:
            assert (gid, replicon) in found


def test_manifest_annotation_versions(release: Path, small_manifest: dict[str, Any]) -> None:
    """SEN mixes two Bakta and two AMRFinderPlus databases; the other species have one each."""
    mixed = small_manifest["plants"]["mixed_annotation_versions"]
    assert mixed["species_code"] == "SEN"
    versions = {s["species_code"]: s["annotation_versions"] for s in _manifest(release)["species"]}
    assert versions["SEN"] == {
        "amrfinderplus": sorted([AMRFINDER_DB, AMRFINDER_DB_OLD]),
        "bakta": sorted([BAKTA_DB, BAKTA_DB_OLD]),
    }
    assert sorted(mixed["bakta_database"]) == versions["SEN"]["bakta"]
    assert sorted(mixed["amrfinderplus_database"]) == versions["SEN"]["amrfinderplus"]
    for code in ("KPN", "SAU"):
        assert versions[code] == {"amrfinderplus": [AMRFINDER_DB], "bakta": [BAKTA_DB]}
    text = (release / "manifest.json").read_text(encoding="utf-8")
    assert text.index('"amrfinderplus"') < text.index('"bakta"')


def test_manifest_annotation_versions_empty_for_a_tool_that_did_not_run(
    small_catalog: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(EPOCH_ENV, EPOCH)
    catalog = copy_catalog(small_catalog, tmp_path / "c")
    con = connect(catalog)
    con.execute(
        """DELETE FROM tool_version WHERE tool = 'amrfinderplus'
        AND genome_id IN (SELECT genome_id FROM genome WHERE species_code = 'SAU')"""
    )
    con.execute(
        """UPDATE tool_version SET database_version = NULL WHERE tool = 'bakta'
        AND genome_id IN (SELECT genome_id FROM genome WHERE species_code = 'SAU')"""
    )
    con.close()
    out = tmp_path / "rel"
    build_release(catalog, out)
    versions = {s["species_code"]: s["annotation_versions"] for s in _manifest(out)["species"]}
    assert versions["SAU"] == {"amrfinderplus": [], "bakta": []}
    assert versions["KPN"] == {"amrfinderplus": [AMRFINDER_DB], "bakta": [BAKTA_DB]}


def test_group_release_genome_grain_files(
    release: Path, small_catalog: Path, small_manifest: dict[str, Any]
) -> None:
    """A group release computes the new files and versions over its own genomes."""
    con = connect(small_catalog, read_only=True)
    try:
        for group in GROUPS:
            root = release / group
            m = _manifest(root)
            members = {
                r[0] for r in _column(root / "tables/genome.parquet", "SELECT genome_id FROM FILE")
            }
            assert {r[0] for r in _amr_class_by_genome(root)} <= members
            full_rows = [r for r in _amr_class_by_genome(release) if r[0] in members]
            assert _amr_class_by_genome(root) == full_rows
            presence = _column(root / "presence_replicon.parquet", "SELECT genome_id FROM FILE")
            assert {r[0] for r in presence} == members and len(presence) == len(members)
            paths = {f["path"] for f in m["files"]}
            assert set(GENOME_FILES) <= paths
            expected: dict[str, dict[str, list[str]]] = {}
            for code, tool, database in con.execute(
                """SELECT g.species_code, t.tool, t.database_version FROM tool_version t
                JOIN genome g USING (genome_id)
                WHERE t.tool IN ('amrfinderplus', 'bakta') AND t.database_version IS NOT NULL
                AND g.genome_id IN (SELECT unnest(?::VARCHAR[]))""",
                [sorted(members)],
            ).fetchall():
                entry = expected.setdefault(code, {"amrfinderplus": [], "bakta": []})
                entry[tool] = sorted({*entry[tool], database})
            assert {s["species_code"]: s["annotation_versions"] for s in m["species"]} == expected
    finally:
        con.close()
    assert set(GENOME_FILES) <= {f["path"] for f in _manifest(release)["files"]}
    # The SEN genomes of amr-network all carry one database of each tool.
    mixed = small_manifest["plants"]["mixed_annotation_versions"]
    members = set(small_manifest["plants"]["access_groups"][GROUP])
    planted = {
        key: sorted(v for v, gids in mixed[f"{key}_database"].items() if members & set(gids))
        for key in ("amrfinderplus", "bakta")
    }
    assert planted == {"amrfinderplus": [AMRFINDER_DB], "bakta": [BAKTA_DB]}
    sen = next(s for s in _manifest(release / GROUP)["species"] if s["species_code"] == "SEN")
    assert sen["annotation_versions"] == planted
