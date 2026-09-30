"""Side tables into an existing catalog: access groups, tombstones, curated sets
(contract §4.6 to §4.8, §5.14, §5.16, §5.17, §8.2).

Each command replaces its tables in one transaction on the catalog written by
``catalejo ingest``.

- ``groups ingest`` writes ``access_group`` and ``genome_group``. A member
  row naming an unknown group fails. A member row naming a genome in
  ``genome`` or in ``tombstone`` is kept; the rows of a tombstoned genome
  route its tombstone to the group releases (milestone 1a decision 7c). A
  member row naming any other genome is left out with a warning. §9 then
  requires every genome in ``genome`` to belong to a group.
- ``tombstones ingest`` writes ``tombstone`` with the reason vocabulary of
  §4.7, then removes every tombstoned genome from every other table except
  ``genome_group`` (§4.7, decision 7c) and recomputes the summaries, whose
  ``cluster_size`` depends on the genomes present.

Run ``tombstones ingest`` before ``groups ingest``. The two commands then
give the same catalog in either order for a genome that was ingested and
later tombstoned, whose ``genome_group`` rows both keep. A tombstoned genome
that was never ingested is known to ``groups ingest`` only through
``tombstone``, so its group rows are kept only when the tombstones are
already in the catalog (or when ``groups ingest`` runs again after them).
- ``sets ingest`` writes ``genome_set`` (kind ``curated``) and
  ``genome_set_member``. A set's name and description must be the same on
  all its rows. Members absent from the catalog are left out with a warning,
  and ``genome_count`` counts the members kept. ``created_date`` is null:
  ``sets.csv`` carries no date, and a build date would make the catalog
  depend on when the command ran.
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import duckdb
import polars as pl

from ingest import schema
from ingest.catalog import IngestError, connect
from ingest.config import load_palette, load_summary_templates
from ingest.issues import FAILURE, WARNING, Issue, failures
from ingest.rows import (
    AccessGroupRow,
    GenomeGroupRow,
    GenomeSetMemberRow,
    GenomeSetRow,
    TombstoneRow,
)
from ingest.side_tables import GENOME_GROUPS, GROUPS, SETS, TOMBSTONES
from ingest.store import insert
from ingest.summary import refresh_summaries

CURATED = "curated"

RULE_UNKNOWN_GROUP = "genome_group.unknown_group"
RULE_UNKNOWN_GENOME = "side.unknown_genome"
RULE_DUPLICATE = "side.duplicate_key"
RULE_REASON = "tombstone.reason"
RULE_SET_NAME = "genome_set.inconsistent"

# Tables that hold a genome_id and lose the rows of a tombstoned genome (§4.7).
# genome_group keeps them to route the tombstone to group releases (decision 7c).
GENOME_TABLES = (
    "genome", "contig", "feature", "annotation_hit", "mutation", "region", "typing",
    "tool_version", "metadata_extra", "genome_set_member",
)  # fmt: skip


@dataclass
class SideResult:
    rows: dict[str, int]
    issues: list[Issue] = field(default_factory=list[Issue])

    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == WARNING]


def read_csv(path: Path, columns: Sequence[str], required: Sequence[str]) -> list[dict[str, str]]:
    """Rows of a side-table CSV as stripped text; the ``required`` columns must exist."""
    if not path.is_file():
        raise IngestError(f"no file at {path}")
    text = path.read_text(encoding="utf-8-sig")
    if not text.strip():
        return []
    frame = pl.read_csv(
        io.BytesIO(text.encode("utf-8")), infer_schema=False, empty_string_is_null=False
    )
    missing = [c for c in required if c not in frame.columns]
    if missing:
        raise IngestError(f"{path}: missing columns {missing}")
    out: list[dict[str, str]] = []
    for row in frame.iter_rows(named=True):
        out.append({c: ("" if row.get(c) is None else str(row[c]).strip()) for c in columns})
    return out


def _genomes(con: duckdb.DuckDBPyConnection) -> set[str]:
    return {r[0] for r in con.execute("SELECT genome_id FROM genome").fetchall()}


def _tombstoned(con: duckdb.DuckDBPyConnection) -> set[str]:
    return {r[0] for r in con.execute("SELECT genome_id FROM tombstone").fetchall()}


def _replace(con: duckdb.DuckDBPyConnection, name: str, rows: Sequence[Any]) -> int:
    con.execute(f'DELETE FROM "{name}"')
    return insert(con, schema.table(name), rows)


def apply_tombstones(con: duckdb.DuckDBPyConnection) -> None:
    """Remove every tombstoned genome from the other tables and fix set sizes (§4.7).

    ``genome_group`` keeps the rows of a tombstoned genome, which route its
    tombstone to the group releases (decision 7c).
    """
    for name in GENOME_TABLES:
        con.execute(f'DELETE FROM "{name}" WHERE genome_id IN (SELECT genome_id FROM tombstone)')
    con.execute(
        """UPDATE genome_set SET genome_count = (SELECT count(*) FROM genome_set_member m
        WHERE m.set_id = genome_set.set_id)"""
    )


def ingest_groups(catalog: Path, groups_path: Path, members_path: Path) -> SideResult:
    group_rows = read_csv(groups_path, GROUPS.columns, GROUPS.columns[:1])
    member_rows = read_csv(members_path, GENOME_GROUPS.columns, GENOME_GROUPS.columns)
    issues: list[Issue] = []
    groups: dict[str, AccessGroupRow] = {}
    for r in group_rows:
        gid = r["group_id"]
        if gid in groups:
            issues.append(Issue(RULE_DUPLICATE, FAILURE, f"group {gid!r} listed twice"))
            continue
        groups[gid] = AccessGroupRow(gid, r["name"] or gid, r["description"] or None)
    con = connect(catalog)
    try:
        known = _genomes(con) | _tombstoned(con)
        members: set[tuple[str, str]] = set()
        for r in member_rows:
            genome, group = r["genome_id"], r["group_id"]
            if group not in groups:
                issues.append(
                    Issue(
                        RULE_UNKNOWN_GROUP,
                        FAILURE,
                        f"group {group!r} is not in {groups_path.name}",
                        genome,
                    )
                )
            elif genome not in known:
                issues.append(
                    Issue(
                        RULE_UNKNOWN_GENOME,
                        WARNING,
                        f"neither in the catalog nor tombstoned; left out of {group}",
                        genome,
                    )
                )
            else:
                members.add((genome, group))
        if failures(issues):
            raise IngestError("groups do not ingest", failures(issues))
        con.execute("BEGIN TRANSACTION")
        rows = {
            "access_group": _replace(
                con, "access_group", sorted(groups.values(), key=lambda g: g.group_id)
            ),
            "genome_group": _replace(
                con, "genome_group", [GenomeGroupRow(*m) for m in sorted(members)]
            ),
        }
        con.execute("COMMIT")
    finally:
        con.close()
    return SideResult(rows, issues)


def ingest_tombstones(catalog: Path, path: Path) -> SideResult:
    records = read_csv(path, TOMBSTONES.columns, TOMBSTONES.columns[:3])
    issues: list[Issue] = []
    rows: dict[str, TombstoneRow] = {}
    for r in records:
        gid = r["genome_id"]
        if r["reason"] not in TOMBSTONES.reasons:
            issues.append(
                Issue(
                    RULE_REASON,
                    FAILURE,
                    f"reason {r['reason']!r} is not one of {', '.join(TOMBSTONES.reasons)}",
                    gid,
                )
            )
        if gid in rows:
            issues.append(Issue(RULE_DUPLICATE, FAILURE, "tombstoned twice", gid))
        rows[gid] = TombstoneRow(gid, r["removed_release"], r["reason"], r["replaced_by"] or None)
    if failures(issues):
        raise IngestError("tombstones do not ingest", failures(issues))
    con = connect(catalog)
    try:
        before = len(_genomes(con))
        con.execute("BEGIN TRANSACTION")
        count = _replace(con, "tombstone", sorted(rows.values(), key=lambda t: t.genome_id))
        apply_tombstones(con)
        refresh_summaries(con, load_summary_templates(), load_palette())
        removed = before - len(_genomes(con))
        con.execute("COMMIT")
    finally:
        con.close()
    return SideResult({"tombstone": count, "removed_genomes": removed}, issues)


def ingest_sets(catalog: Path, path: Path) -> SideResult:
    records = read_csv(path, SETS.columns, SETS.columns)
    issues: list[Issue] = []
    con = connect(catalog)
    try:
        present = _genomes(con)
        tombstoned = _tombstoned(con)
        sets: dict[str, tuple[str, str]] = {}
        members: dict[str, set[str]] = {}
        for r in records:
            sid = r["set_id"]
            label = (r["name"], r["description"])
            if sets.setdefault(sid, label) != label:
                issues.append(
                    Issue(RULE_SET_NAME, FAILURE, f"set {sid!r} has two names or descriptions")
                )
            members.setdefault(sid, set())
            gid = r["genome_id"]
            if gid in present:
                members[sid].add(gid)
            else:
                reason = "tombstoned" if gid in tombstoned else "not in the catalog"
                issues.append(
                    Issue(RULE_UNKNOWN_GENOME, WARNING, f"{reason}; left out of set {sid}", gid)
                )
        if failures(issues):
            raise IngestError("sets do not ingest", failures(issues))
        set_rows = [
            GenomeSetRow(sid, name or sid, description or None, CURATED, len(members[sid]), None)
            for sid, (name, description) in sorted(sets.items())
        ]
        member_rows = [
            GenomeSetMemberRow(sid, gid) for sid in sorted(members) for gid in sorted(members[sid])
        ]
        con.execute("BEGIN TRANSACTION")
        rows = {
            "genome_set": _replace(con, "genome_set", set_rows),
            "genome_set_member": _replace(con, "genome_set_member", member_rows),
        }
        con.execute("COMMIT")
    finally:
        con.close()
    return SideResult(rows, issues)
