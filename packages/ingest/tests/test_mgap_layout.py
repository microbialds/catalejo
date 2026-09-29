"""The mgap layout module against data/mgap-example, and the single-definition rule.

The example directory is a real mgap 2.0.0 run copied by the maintainer; it is
ignored by git and absent in CI, where the tests that read it are skipped.
"""

from __future__ import annotations

import ast
import gzip
import re
from pathlib import Path

import pytest
import yaml

from ingest import mgap_layout as L

EXAMPLE_GENOMES = ("SCL29833", "SP10")


@pytest.fixture(scope="module")
def example(repo_root: Path) -> Path:
    path = repo_root / "data" / "mgap-example"
    if not path.is_dir():
        pytest.skip(
            "data/mgap-example is absent (it is git-ignored and exists only on the "
            "maintainer's machine); layout checks against real mgap output are skipped"
        )
    return path


def _module_is_provisional(module: object) -> bool:
    paths = [v for v in vars(module).values() if isinstance(v, L.MgapPath)]
    return bool(paths) and all(p.provisional for p in paths)


# Internal consistency (always run) ---------------------------------------------------------


def test_every_path_is_relative_and_unique() -> None:
    templates = [p.template for p in L.all_paths().values()]
    assert len(templates) == len(set(templates))
    for t in templates:
        assert not t.startswith("/") and ".." not in t


def test_tables_have_unique_columns() -> None:
    for name, table in L.all_tables().items():
        assert len(table.columns) == len(set(table.columns)), name


def test_contract_rows_are_modeled() -> None:
    rows = set(L.CONTRACT_MODULE_ROWS)
    for row in ("Assembly", "CheckM2", "MLST", "GTDB-Tk", "Bakta", "AMRFinderPlus", "RGI"):
        assert row in rows
    assert {"geNomad", "MOB-suite", "Kleborate, sccmec, SISTR", "Pipeline info"} <= rows


def test_provisional_entries_are_marked() -> None:
    for module in (L.LONG_READ, L.GTDBTK, L.SISTR, L.SCCMEC):
        assert _module_is_provisional(module), type(module).__name__
    assert L.AMRFINDERPLUS.versions.provisional


def test_patterns_parse_their_own_formats() -> None:
    node = L.SPADES.node_name.format(index=3, length=1200, coverage="25.531719")
    assert L.SPADES.node_name_re.match(node)
    provirus = L.GENOMAD.provirus_name.format(contig="contig_1", start=10, end=500)
    m = L.GENOMAD.provirus_name_re.match(provirus)
    assert m and m.group("contig") == "contig_1" and m.group("end") == "500"
    m = L.AMRFINDERPLUS.point_symbol_re.match("blaSHV_C-112T")
    assert m and m.group("gene") == "blaSHV" and m.group("variant") == "C-112T"
    m = L.MLST.allele_re.match(L.MLST.allele.format(gene="gapA", allele="~2"))
    assert m and m.group("allele") == "~2"


# Against data/mgap-example -----------------------------------------------------------------


def test_declared_paths_exist(example: Path) -> None:
    for name, path in L.all_paths().items():
        if path.provisional:
            continue
        if not path.per_genome:
            assert path.resolve(example).exists(), name
            continue
        present = [g for g in EXAMPLE_GENOMES if path.resolve(example, g).exists()]
        if path.optional:
            assert present, f"{name}: {path.template} in no example genome"
        else:
            assert present == list(EXAMPLE_GENOMES), f"{name}: {path.template} only in {present}"


def _header_ok(table: L.Table, lines: list[str]) -> None:
    columns = list(table.columns)
    match table.header:
        case L.HeaderStyle.FIRST_LINE:
            assert lines[0].split(table.separator) == columns
        case L.HeaderStyle.AFTER_COMMENTS:
            body = [x for x in lines if not x.startswith(table.comment_prefix)]
            header = body[0]
            assert header.startswith(table.header_prefix)
            assert header[len(table.header_prefix) :].split(table.separator) == columns
        case L.HeaderStyle.NONE:
            for line in lines:
                if line:
                    assert len(line.split(table.separator)) >= len(columns)
        case L.HeaderStyle.ROW_LABELS:
            labels = [x.split(table.separator)[0] for x in lines if x]
            assert labels == columns


def test_declared_columns_match_headers(example: Path) -> None:
    checked = 0
    for name, table in L.all_tables().items():
        if table.path.provisional:
            continue
        for genome in EXAMPLE_GENOMES:
            path = table.path.resolve(example, genome)
            if not path.exists():
                continue
            lines = path.read_text(encoding="utf-8").splitlines()
            try:
                _header_ok(table, lines)
            except AssertionError as exc:
                raise AssertionError(f"{name} in {genome}") from exc
            checked += 1
    assert checked >= 25


def test_example_value_formats(example: Path) -> None:
    g = "SCL29833"
    with gzip.open(L.SPADES.scaffolds.resolve(example, g), "rt") as fh:
        first = fh.readline()[1:].strip()
    assert L.SPADES.node_name_re.match(first)
    fna = L.BAKTA.fna.resolve(example, g).read_text().splitlines()[0]
    contig, description = fna[1:].split(" ", 1)
    assert contig == L.BAKTA.contig_name.format(index=1)
    assert L.BAKTA.fna_description_re.fullmatch(description)
    summary = L.BAKTA.summary.resolve(example, g).read_text()
    database = next(
        line.split(": ", 1)[1]
        for line in summary.splitlines()
        if line.startswith(L.BAKTA.summary_keys.database + ":")
    )
    assert L.BAKTA.database_re.fullmatch(database)
    report = L.MOBSUITE.contig_report.resolve(example, g).read_text().splitlines()
    assert report[1].split("\t")[4] == fna[1:]
    mlst = L.MLST.report.resolve(example, g).read_text().split("\t")
    assert mlst[0] == L.SPADES.assembly_file.replace(L.GENOME_ID, g)
    assert all(L.MLST.allele_re.match(x.strip()) for x in mlst[3:])
    checkm2 = L.CHECKM2.report.resolve(example, g).read_text().splitlines()[1]
    assert checkm2.split("\t")[0] == L.SPADES.assembly_name.replace(L.GENOME_ID, g)
    virus = L.GENOMAD.virus_summary.resolve(example, g).read_text().splitlines()[1]
    assert L.GENOMAD.provirus_name_re.match(virus.split("\t")[0])
    points = [
        row.split("\t")
        for row in L.AMRFINDERPLUS.report.resolve(example, g).read_text().splitlines()[1:]
    ]
    for row in points:
        if row[9] == L.AMRFINDERPLUS.subtype_point:
            assert L.AMRFINDERPLUS.point_symbol_re.match(row[5])
    with gzip.open(L.SPADES.graph.resolve(example, g), "rt") as fh:
        assert L.SPADES.gfa_version_re.search(fh.readline())


def test_software_versions_keys(example: Path) -> None:
    data = yaml.safe_load(L.PIPELINE_INFO.software_versions.resolve(example).read_text())
    assert L.PIPELINE_INFO.pipeline_key in data[L.PIPELINE_INFO.workflow_key]
    for module in L.MODULES:
        process = getattr(module, "process", None)
        tool = getattr(module, "tool", None)
        if process is None or _module_is_provisional(module):
            continue
        assert process in data, process
        assert tool in data[process], (process, tool)
    amr = data[L.AMRFINDERPLUS.process]
    assert L.AMRFINDERPLUS.database_key in amr
    bakta = yaml.safe_load(L.BAKTA.versions.resolve(example, "SP10").read_text())
    assert L.BAKTA.tool in bakta[L.BAKTA.process]


# No mgap path or column literal outside mgap_layout ----------------------------------------


def _forbidden_fragments() -> tuple[set[str], set[str]]:
    """Directory names and file-name fragments taken from the declared templates."""
    directories: set[str] = set()
    fragments: set[str] = set()
    for path in L.all_paths().values():
        segments = path.template.split("/")
        for i, segment in enumerate(segments):
            pieces = [p for p in segment.split(L.GENOME_ID) if len(p) >= 3]
            if i < len(segments) - 1 and segment != L.GENOME_ID and len(segment) >= 2:
                directories.add(segment)
            fragments.update(pieces)
    return directories, fragments


def _specific(fragment: str) -> bool:
    """A file-name fragment specific to mgap, not a bare extension such as .tsv."""
    if re.fullmatch(r"\.\w+", fragment):
        return False
    return "." in fragment or fragment.startswith(("_", "-"))


def _forbidden_columns() -> set[str]:
    names: set[str] = set()
    for table in L.all_tables().values():
        names.update(table.columns)
    names.update(L.KLEBORATE.columns.all)
    distinctive = (" ", "%", "(", "#", ".", "_")
    return {n for n in names if any(ch in n for ch in distinctive)}


def _string_literals(source: str) -> list[tuple[int, str]]:
    tree = ast.parse(source)
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                docstrings.add(id(body[0].value))
    return [
        (node.lineno, node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) not in docstrings
    ]


# Literals that coincide with an mgap name but mean something else.
ALLOWED_LITERALS = {
    ("genbank.py", "molecule_type"),  # a Biopython SeqRecord annotation key
}


def test_no_mgap_literals_outside_layout(repo_root: Path) -> None:
    directories, fragments = _forbidden_fragments()
    columns = _forbidden_columns()
    src = repo_root / "packages" / "ingest" / "src" / "ingest"
    files = sorted((src / "synth").glob("*.py")) + sorted((src / "parsers").glob("*.py"))
    assert files
    problems: list[str] = []
    for path in files:
        for line, value in _string_literals(path.read_text(encoding="utf-8")):
            if (path.name, value) in ALLOWED_LITERALS:
                continue
            where = f"{path.relative_to(src)}:{line}: {value!r}"
            if value in directories or value in columns:
                problems.append(where)
            elif any(fragment in value for fragment in fragments if _specific(fragment)):
                problems.append(where)
            elif "/" in value and any(d in value.split("/") for d in directories):
                problems.append(where)
    assert not problems, "mgap paths or columns spelled outside mgap_layout:\n" + "\n".join(
        problems
    )
