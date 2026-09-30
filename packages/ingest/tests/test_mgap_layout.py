"""The mgap layout module against the real examples, and the single-definition rule.

Two real mgap 2.0.0 runs are checked: ``data/mgap-example`` (Illumina SPAdes
drafts SCL29833 and SP10, with pipeline_info) and ``data/ont_example`` (the
nanopore sample ont_SCL30014, genome SCL30014). Both are git-ignored and exist
only on the maintainer's machine; in CI the tests that read them are skipped.
"""

from __future__ import annotations

import ast
import gzip
import re
from dataclasses import dataclass
from pathlib import Path

import pytest
import yaml

from ingest import mgap_layout as L
from ingest.config import load_platform


@dataclass(frozen=True)
class Example:
    name: str
    root: Path
    samples: tuple[str, ...]
    platform: str


EXAMPLES: dict[str, tuple[tuple[str, ...], str]] = {
    "mgap-example": (("SCL29833", "SP10"), L.PLATFORM_ILLUMINA),
    "ont_example": (("ont_SCL30014",), L.PLATFORM_ONT),
}


def _example(repo_root: Path, name: str) -> Example:
    root = repo_root / "data" / name
    if not root.is_dir():
        pytest.skip(
            f"data/{name} is absent (it is git-ignored and exists only on the maintainer's "
            "machine); layout checks against this real mgap run are skipped"
        )
    samples, platform = EXAMPLES[name]
    return Example(name, root, samples, platform)


@pytest.fixture(params=sorted(EXAMPLES))
def example(request: pytest.FixtureRequest, repo_root: Path) -> Example:
    return _example(repo_root, request.param)


def _module_is_provisional(module: object) -> bool:
    paths = [v for v in vars(module).values() if isinstance(v, L.MgapPath)]
    return bool(paths) and all(p.provisional for p in paths)


def _module_is_nanopore_only(module: object) -> bool:
    paths = [v for v in vars(module).values() if isinstance(v, L.MgapPath)]
    return bool(paths) and all(p.platform == L.PLATFORM_ONT for p in paths)


def _required(path: L.MgapPath, platform: str | None) -> bool:
    return (
        not path.provisional
        and not path.optional
        and (path.platform is None or path.platform == platform)
    )


def _header_line(table: L.Table, lines: list[str]) -> str:
    marker = table.header_prefix + table.columns[0]
    return next(line for line in lines if line.startswith(marker))


def _header_ok(table: L.Table, lines: list[str]) -> None:
    columns = list(table.columns)
    match table.header:
        case L.HeaderStyle.FIRST_LINE:
            assert lines[0].split(table.separator) == columns
        case L.HeaderStyle.AFTER_COMMENTS:
            header = _header_line(table, lines)
            assert header[len(table.header_prefix) :].split(table.separator) == columns
            before = lines[: lines.index(header)]
            assert all(line.startswith(table.comment_prefix) for line in before)
        case L.HeaderStyle.NONE:
            for line in lines:
                if line:
                    assert len(line.split(table.separator)) >= len(columns)
        case L.HeaderStyle.ROW_LABELS:
            labels = [x.split(table.separator)[0] for x in lines if x]
            assert labels == columns


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
    for module in (L.GTDBTK, L.SISTR, L.SCCMEC):
        assert _module_is_provisional(module), type(module).__name__
    assert L.AMRFINDERPLUS.versions.provisional
    assert not _module_is_provisional(L.LONG_READ)


def test_optional_modules_have_no_platform_tie() -> None:
    for path in (L.RGI.report, L.MOBSUITE.contig_report, L.BRACKEN.report):
        assert path.optional and path.platform is None
    assert L.FASTP.json.optional and L.FASTPLONG.json.optional


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
    header = L.LONG_READ.fasta_header.format(index=1, length=500, circular="true")
    m = L.LONG_READ.fasta_header_re.match(header)
    assert m and m.group("circular") == "true"


def test_sample_and_prefix_placeholders() -> None:
    path = L.BAKTA.tsv
    assert path.relative("SCL29833") == "SCL29833/annotation/bakta/SCL29833.tsv"
    assert (
        path.relative("ont_SCL30014", "ont_SCL30014_")
        == "ont_SCL30014/annotation/bakta/ont_SCL30014_.tsv"
    )
    assert (
        L.CHECKM2.report.relative("ont_SCL30014", "ont_SCL30014_")
        == "ont_SCL30014/annotation/checkm2/ont_SCL30014_checkm2_report.tsv"
    )
    with pytest.raises(ValueError):
        path.relative()


def test_detect_platform_without_assembly(tmp_path: Path) -> None:
    assert L.detect_platform(tmp_path, "SCL0001") is None
    assert L.resolve_prefix(tmp_path, "SCL0001") == "SCL0001"


def test_parse_fna_header() -> None:
    contig, tags = L.parse_fna_header(">contig_7 [gcode=11] [topology=linear]")
    assert contig == "contig_7" and tags == {"gcode": "11", "topology": "linear"}


# Against the real examples ------------------------------------------------------------------


def test_prefix_platform_and_sample_names(example: Example) -> None:
    rules = load_platform()
    for sample in example.samples:
        prefix = L.resolve_prefix(example.root, sample)
        assert L.detect_platform(example.root, sample) == example.platform
        if example.platform == L.PLATFORM_ONT:
            assert prefix == f"{sample}_"
        else:
            assert prefix == sample
        genome_id = rules.genome_id_from_sample(sample)
        assert rules.genome_id_regex.match(genome_id) or genome_id == "SP10"
    if example.name == "ont_example":
        assert rules.genome_id_from_sample("ont_SCL30014") == "SCL30014"


def test_declared_paths_exist(example: Example) -> None:
    checked = 0
    for name, path in L.all_paths().items():
        if not path.per_genome:
            if _required(path, None) and (example.root / "pipeline_info").is_dir():
                assert path.resolve(example.root).exists(), name
            continue
        for sample in example.samples:
            prefix = L.resolve_prefix(example.root, sample)
            platform = L.detect_platform(example.root, sample)
            if _required(path, platform):
                assert path.resolve(example.root, sample, prefix).exists(), (
                    f"{name}: {path.relative(sample, prefix)}"
                )
                checked += 1
    assert checked >= 20


def test_optional_paths_seen_in_some_example(repo_root: Path) -> None:
    examples = [_example(repo_root, name) for name in sorted(EXAMPLES)]
    for name, path in L.all_paths().items():
        if path.provisional or not path.optional or not path.per_genome:
            continue
        seen = [
            (e.name, s)
            for e in examples
            for s in e.samples
            if path.resolve(e.root, s, L.resolve_prefix(e.root, s)).exists()
        ]
        assert seen, f"{name}: {path.template} in no example"


def test_declared_columns_match_headers(example: Example) -> None:
    checked = 0
    for name, table in L.all_tables().items():
        if table.path.provisional or not table.path.per_genome:
            continue
        for sample in example.samples:
            path = table.path.resolve(example.root, sample, L.resolve_prefix(example.root, sample))
            if not path.exists():
                continue
            lines = path.read_text(encoding="utf-8").splitlines()
            try:
                _header_ok(table, lines)
            except (AssertionError, StopIteration) as exc:
                raise AssertionError(f"{name} in {sample}") from exc
            checked += 1
    assert checked >= 12


def test_bakta_header_tags(example: Example) -> None:
    b = L.BAKTA
    for sample in example.samples:
        fna = b.fna.resolve(example.root, sample, L.resolve_prefix(example.root, sample))
        headers = [x for x in fna.read_text().splitlines() if x.startswith(">")]
        assert headers
        parsed = [L.parse_fna_header(h) for h in headers]
        for contig, tags in parsed:
            assert re.fullmatch(r"contig_\d+", contig)
            assert tags[b.tag_gcode] == str(b.gcode)
        if example.platform == L.PLATFORM_ONT:
            assert len(parsed) == 5
            for _, tags in parsed:
                assert tags[b.tag_topology] == b.topology_circular
                assert tags[b.tag_completeness] == b.completeness_complete
            locations = [t.get(b.tag_location) for _, t in parsed]
            assert locations.count(b.location_chromosome) == 1
            assert sum(b.tag_plasmid_name in t for _, t in parsed) == 4
            descriptions = [h.split(" ", 1)[1] for h in headers]
            assert descriptions[0] == b.fna_description_chromosome.format(gcode=b.gcode)
            assert descriptions[1] == b.fna_description_plasmid.format(
                gcode=b.gcode, name=b.plasmid_name.format(index=1)
            )
        else:
            for _, tags in parsed:
                assert tags[b.tag_topology] == b.topology_linear
                assert b.tag_completeness not in tags
            assert headers[0].split(" ", 1)[1] == b.fna_description_draft.format(
                gcode=b.gcode, topology=b.topology_linear
            )


def test_illumina_value_formats(repo_root: Path) -> None:
    e = _example(repo_root, "mgap-example")
    g = "SCL29833"
    with gzip.open(L.SPADES.scaffolds.resolve(e.root, g), "rt") as fh:
        first = fh.readline()[1:].strip()
    assert L.SPADES.node_name_re.match(first)
    fna = L.BAKTA.fna.resolve(e.root, g).read_text().splitlines()[0]
    summary = L.BAKTA.summary.resolve(e.root, g).read_text()
    database = next(
        line.split(": ", 1)[1]
        for line in summary.splitlines()
        if line.startswith(L.BAKTA.summary_keys.database + ":")
    )
    assert L.BAKTA.database_re.fullmatch(database)
    report = L.MOBSUITE.contig_report.resolve(e.root, g).read_text().splitlines()
    assert report[1].split("\t")[4] == fna[1:]
    mlst = L.MLST.report.resolve(e.root, g).read_text().split("\t")
    assert mlst[0] == L.SPADES.internal_file.format(sample=g)
    assert all(L.MLST.allele_re.match(x.strip()) for x in mlst[3:])
    checkm2 = L.CHECKM2.report.resolve(e.root, g).read_text().splitlines()[1]
    assert checkm2.split("\t")[0] == L.SPADES.internal_name.format(sample=g)
    virus = L.GENOMAD.virus_summary.resolve(e.root, g).read_text().splitlines()[1]
    assert L.GENOMAD.provirus_name_re.match(virus.split("\t")[0])
    for row in L.AMRFINDERPLUS.report.resolve(e.root, g).read_text().splitlines()[1:]:
        fields = row.split("\t")
        if fields[9] == L.AMRFINDERPLUS.subtype_point:
            assert L.AMRFINDERPLUS.point_symbol_re.match(fields[5])
    with gzip.open(L.SPADES.graph.resolve(e.root, g), "rt") as fh:
        assert L.SPADES.gfa_version_re.search(fh.readline())


def test_nanopore_value_formats(repo_root: Path) -> None:
    e = _example(repo_root, "ont_example")
    s = e.samples[0]
    p = L.resolve_prefix(e.root, s)
    lr = L.LONG_READ
    for path in (lr.autocycler_fasta, lr.dnaapler_fasta):
        headers = [x[1:] for x in path.resolve(e.root, s, p).read_text().splitlines()
                   if x.startswith(">")]  # fmt: skip
        assert len(headers) == 5
        for h in headers:
            m = lr.fasta_header_re.match(h)
            assert m and m.group("circular") == lr.circular_true
    for path in (lr.autocycler_gfa, lr.dnaapler_gfa):
        lines = path.resolve(e.root, s, p).read_text().splitlines()
        assert lines[0] == lr.gfa_header
        segments = [x.split("\t")[1] for x in lines if x.startswith("S\t")]
        links = {x for x in lines if x.startswith("L\t")}
        for index in segments:
            assert {link.format(index=index) for link in lr.gfa_self_links} <= links
    size = lr.genome_size.resolve(e.root, s, p).read_text()
    assert size.strip().isdigit()
    # Names inside the reports are the read-file stem, unrelated to sample or prefix.
    checkm2 = L.CHECKM2.report.resolve(e.root, s, p).read_text().splitlines()[1]
    name = checkm2.split("\t")[0]
    assert name == lr.internal_name_example and s not in name
    mlst = L.MLST.report.resolve(e.root, s, p).read_text().split("\t")
    assert mlst[0] == lr.internal_file.format(genome_id="SCL30014")
    assert not L.BRACKEN.report.resolve(e.root, s, p).exists()
    assert not L.RGI.report.resolve(e.root, s, p).exists()
    assert not L.MOBSUITE.directory.resolve(e.root, s, p).exists()


def test_software_versions_keys(repo_root: Path) -> None:
    e = _example(repo_root, "mgap-example")
    data = yaml.safe_load(L.PIPELINE_INFO.software_versions.resolve(e.root).read_text())
    assert L.PIPELINE_INFO.pipeline_key in data[L.PIPELINE_INFO.workflow_key]
    for module in L.MODULES:
        process = getattr(module, "process", None)
        tool = getattr(module, "tool", None)
        if process is None or _module_is_provisional(module) or _module_is_nanopore_only(module):
            continue
        assert process in data, process
        assert tool in data[process], (process, tool)
    assert L.AMRFINDERPLUS.database_key in data[L.AMRFINDERPLUS.process]
    bakta = yaml.safe_load(L.BAKTA.versions.resolve(e.root, "SP10").read_text())
    assert L.BAKTA.tool in bakta[L.BAKTA.process]


# No mgap path or column literal outside mgap_layout ----------------------------------------


def _forbidden_fragments() -> tuple[set[str], set[str]]:
    """Directory names and file-name fragments taken from the declared templates."""
    directories: set[str] = set()
    fragments: set[str] = set()
    for path in L.all_paths().values():
        segments = path.template.split("/")
        for i, segment in enumerate(segments):
            pieces = [
                p for part in segment.split(L.SAMPLE) for p in part.split(L.PREFIX) if len(p) >= 3
            ]
            if i < len(segments) - 1 and segment != L.SAMPLE and len(segment) >= 2:
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
