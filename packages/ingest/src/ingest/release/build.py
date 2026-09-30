"""``catalejo release build --catalog ... --out DIR [--group G]`` (contract §6, §8.3).

1. ``release_id`` is the catalog stem (milestone 1a plan, decision 1).
2. The catalog rules of §9 run first; any failure refuses the build, and
   the warning count goes into the manifest's ``checks``.
3. The catalog is attached read-only to an in-memory database whose views
   hold only the genomes of the release: every genome, or with ``--group``
   the members of that access group that are in ``genome``. The
   ``tombstone`` view holds every tombstone for a full build and, for a
   group, the tombstones whose genome_id has a ``genome_group`` row for that
   group (decision 7c; the catalog keeps those rows only for this routing,
   see ``ingest.side``). Views of ``genome_set`` count only the members
   kept, and sets left without members are dropped.
4. A full build copies the counters and summary sentences of the catalog
   (decision 5). A group build copies ``genome`` into a table and runs
   ``refresh_summaries`` on it, so that ``cluster_size``, "number of genomes
   in the release with the same species_code and st"
   (``config/summary_templates.yaml``), counts the genomes of the group
   release (decision 6b). The counters it recomputes depend on one genome
   only and equal the catalog's.
5. The output is ``DIR`` for a full build and ``DIR/<group_id>`` for a group
   build; it is replaced only when it holds the release marker or is empty,
   and a full build keeps the subdirectories named after access groups.
6. Tables (``release.tables``), summaries (``release.summaries``), per-genome
   files (``release.genome_files``) and the manifest (``release.manifest``)
   are written. DuckDB runs on one thread with insertion order preserved, and
   every query is fully ordered, so two builds of the same catalog give the
   same bytes; only ``created`` and ``checks.validated_at`` depend on the
   clock, and ``SOURCE_DATE_EPOCH`` fixes them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import duckdb

from ingest.catalog import IngestError, files_dir, release_id_from_catalog
from ingest.config import PaletteConfig, load_palette, load_summary_templates, platform
from ingest.issues import Issue, failures, warnings
from ingest.release.genome_files import write_genome
from ingest.release.manifest import manifest, write_manifest
from ingest.release.output import ReleaseError, mark_root, prepare, timestamp
from ingest.release.summaries import write_summaries
from ingest.release.tables import sql_string, write_tables
from ingest.store import open_db
from ingest.summary import refresh_summaries
from ingest.validate import validate_catalog

CATALOG_ALIAS = "cat"
GENOME_TABLES = (
    "contig", "feature", "annotation_hit", "mutation", "region", "typing", "tool_version",
    "metadata_extra",
)  # fmt: skip


@dataclass
class BuildResult:
    out: Path
    release_id: str
    group_id: str | None
    genomes: int
    species: list[str]
    files: int
    bytes: int
    issues: list[Issue] = field(default_factory=list[Issue])

    def lines(self) -> list[str]:
        what = f"group {self.group_id} of release" if self.group_id else "release"
        return [
            f"catalejo release build: wrote {what} {self.release_id} to {self.out}: "
            f"{self.genomes} genomes of {len(self.species)} species, {self.files} files, "
            f"{self.bytes / 1e6:.1f} MB",
            f"  catalog checks passed with {len(warnings(self.issues))} warnings",
        ]


def _views(con: duckdb.DuckDBPyConnection, group: str | None, palette: PaletteConfig) -> None:
    c = CATALOG_ALIAS
    if group is None:
        con.execute(f"CREATE TABLE sel AS SELECT genome_id FROM {c}.genome")
        con.execute(f"CREATE VIEW genome AS SELECT * FROM {c}.genome")
    else:
        con.execute(
            f"""CREATE TABLE sel AS SELECT DISTINCT genome_id FROM {c}.genome_group
            WHERE group_id = {sql_string(group)}
            AND genome_id IN (SELECT genome_id FROM {c}.genome)"""
        )
        con.execute(
            f"""CREATE TABLE genome AS SELECT * FROM {c}.genome
            WHERE genome_id IN (SELECT genome_id FROM sel) ORDER BY genome_id"""
        )
    for name in GENOME_TABLES:
        con.execute(
            f'CREATE VIEW "{name}" AS SELECT * FROM {c}."{name}" '
            "WHERE genome_id IN (SELECT genome_id FROM sel)"
        )
    con.execute(f"CREATE VIEW species_registry AS SELECT * FROM {c}.species_registry")
    if group is None:
        con.execute(f"CREATE VIEW tombstone AS SELECT * FROM {c}.tombstone")
    else:
        con.execute(
            f"""CREATE VIEW tombstone AS SELECT * FROM {c}.tombstone
            WHERE genome_id IN (SELECT genome_id FROM {c}.genome_group
                                WHERE group_id = {sql_string(group)})"""
        )
    con.execute(
        f"""CREATE VIEW genome_set_member AS SELECT * FROM {c}.genome_set_member
        WHERE genome_id IN (SELECT genome_id FROM sel)"""
    )
    con.execute(
        f"""CREATE VIEW genome_set AS SELECT s.set_id, s.name, s.description, s.kind,
               (SELECT count(*) FROM genome_set_member m WHERE m.set_id = s.set_id)::INTEGER
                   AS genome_count,
               s.created_date
        FROM {c}.genome_set s
        WHERE s.set_id IN (SELECT set_id FROM genome_set_member)"""
    )
    if group is not None:
        refresh_summaries(con, load_summary_templates(), palette)


def build_release(catalog: Path, out: Path, group: str | None = None) -> BuildResult:
    try:
        release_id = release_id_from_catalog(catalog)
    except IngestError as exc:
        raise ReleaseError(str(exc)) from exc
    if not catalog.is_file():
        raise ReleaseError(f"no catalog at {catalog}")
    if not files_dir(catalog).is_dir():
        raise ReleaseError(
            f"no per-genome files at {files_dir(catalog)}; catalejo ingest writes them beside "
            "the catalog, and the release needs them (contract §6.3)"
        )
    palette = load_palette()
    config = platform()

    check = open_db(catalog, read_only=True)
    try:
        issues = validate_catalog(check)
        groups: list[str] = [
            str(r[0]) for r in check.execute("SELECT group_id FROM access_group").fetchall()
        ]
    finally:
        check.close()
    if failures(issues):
        raise ReleaseError("the catalog fails release check; the release is not built")
    if group is not None and group not in groups:
        raise ReleaseError(f"no access group {group!r} in the catalog")

    if group is None:
        root = prepare(out, keep=groups)
        skip = {str(g) for g in groups}
    else:
        mark_root(out)
        root = prepare(out / group)
        skip: set[str] = set()

    con = open_db(":memory:", threads=1)
    try:
        con.execute(f"ATTACH {sql_string(catalog.as_posix())} AS {CATALOG_ALIAS} (READ_ONLY)")
        _views(con, group, palette)
        genomes = con.execute(
            "SELECT species_code, genome_id FROM genome ORDER BY species_code, genome_id"
        ).fetchall()
        species = sorted({code for code, _ in genomes})
        write_tables(con, root, species)
        write_summaries(con, root, palette, config)
        files = files_dir(catalog)
        for code, gid in genomes:
            write_genome(con, root, code, gid, files, palette)
        created = timestamp()
        data = manifest(
            con,
            root,
            release_id,
            group,
            created,
            config.platform_name,
            len(warnings(issues)),
            skip,
        )
    finally:
        con.close()
    write_manifest(root, data)
    return BuildResult(
        out=root,
        release_id=release_id,
        group_id=group,
        genomes=len(genomes),
        species=species,
        files=len(data["files"]) + 1,
        bytes=sum(f["bytes"] for f in data["files"]),
        issues=issues,
    )
