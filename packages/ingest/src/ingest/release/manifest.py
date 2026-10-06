"""The release manifest (contract §6.4).

Fields as §6.4: ``schema_version`` 0.1.0 (before the first release the
schema version is not bumped, §2), ``release_id``, ``group_id``, ``created``,
``platform_name``, ``pipeline`` (the distinct versions of tool ``mgap`` in
``tool_version``), ``genome_count``, ``species`` (``has_pangenome`` false and
``tree_ids`` empty until milestone 4a; ``annotation_versions``, contract 0.9
§6.4, maps ``bakta`` and ``amrfinderplus`` to the distinct non-null
``tool_version.database_version`` values of the species' genomes, sorted,
an empty list for a tool that did not run), ``tool_versions`` (every tool but
``mgap``, distinct versions and database versions), ``embedding_models``
(empty until milestone 6), ``curated_sets``, ``files`` (every file of the
release but the manifest, the marker and group subdirectories, sorted by path,
with bytes and SHA-256), ``previous_release`` and ``release_notes`` (null:
``release build`` takes no previous catalog, and NOTES.md comes with
milestone 5) and ``checks``. Keys are written sorted.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import duckdb

from ingest import mgap_layout as L
from ingest.release.output import MARKER

SCHEMA_VERSION = "0.1.0"
PIPELINE_NAME = "gene2dis/mgap"
PIPELINE_TOOL = "mgap"
MANIFEST = "manifest.json"
ANNOTATION_TOOLS = (L.AMRFINDERPLUS.tool, L.BAKTA.tool)


def file_entries(root: Path, skip_dirs: set[str]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if relative.parts[0] in skip_dirs or relative.name in (MANIFEST, MARKER):
            continue
        data = path.read_bytes()
        entries.append(
            {
                "path": relative.as_posix(),
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    return entries


def _distinct(values: list[Any]) -> list[str]:
    return sorted({str(v) for v in values if v is not None})


def annotation_versions(con: duckdb.DuckDBPyConnection) -> dict[str, dict[str, list[str]]]:
    """Per species, the annotation database versions of its genomes (contract §6.4)."""
    tools = ", ".join(f"'{t}'" for t in ANNOTATION_TOOLS)
    found: dict[str, dict[str, list[Any]]] = {}
    for code, tool, database in con.execute(
        f"""SELECT g.species_code, t.tool, t.database_version FROM tool_version t
        JOIN genome g USING (genome_id) WHERE t.tool IN ({tools})"""
    ).fetchall():
        found.setdefault(code, {}).setdefault(tool, []).append(database)
    codes = [r[0] for r in con.execute("SELECT DISTINCT species_code FROM genome").fetchall()]
    return {
        code: {tool: _distinct(found.get(code, {}).get(tool, [])) for tool in ANNOTATION_TOOLS}
        for code in codes
    }


def manifest(
    con: duckdb.DuckDBPyConnection,
    root: Path,
    release_id: str,
    group_id: str | None,
    created: str,
    platform_name: str,
    warnings: int,
    skip_dirs: set[str],
) -> dict[str, Any]:
    tools: dict[str, tuple[list[Any], list[Any]]] = {}
    pipeline: list[Any] = []
    for tool, version, database in con.execute(
        "SELECT tool, version, database_version FROM tool_version"
    ).fetchall():
        if tool == PIPELINE_TOOL:
            pipeline.append(version)
            continue
        versions, databases = tools.setdefault(tool, ([], []))
        versions.append(version)
        databases.append(database)
    versions = annotation_versions(con)
    species: list[dict[str, Any]] = [
        {
            "species_code": code,
            "canonical_name": name,
            "genome_count": n,
            "has_pangenome": False,
            "tree_ids": [],
            "annotation_versions": versions[code],
        }
        for code, name, n in con.execute(
            """SELECT g.species_code, s.canonical_name, count(*) FROM genome g
            JOIN species_registry s USING (species_code) GROUP BY 1, 2 ORDER BY 1"""
        ).fetchall()
    ]
    sets = [
        {"set_id": sid, "name": name, "genome_count": n}
        for sid, name, n in con.execute(
            "SELECT set_id, name, genome_count FROM genome_set ORDER BY set_id"
        ).fetchall()
    ]
    count = con.execute("SELECT count(*) FROM genome").fetchone()
    return {
        "schema_version": SCHEMA_VERSION,
        "release_id": release_id,
        "group_id": group_id,
        "created": created,
        "platform_name": platform_name,
        "pipeline": {"name": PIPELINE_NAME, "versions": _distinct(pipeline)},
        "genome_count": int(count[0]) if count else 0,
        "species": species,
        "tool_versions": [
            {"tool": tool, "versions": _distinct(v), "database_versions": _distinct(d)}
            for tool, (v, d) in sorted(tools.items())
        ],
        "embedding_models": [],
        "curated_sets": sets,
        "files": file_entries(root, skip_dirs),
        "previous_release": None,
        "release_notes": None,
        "checks": {"validated": True, "validated_at": created, "warnings": warnings},
    }


def write_manifest(root: Path, data: dict[str, Any]) -> None:
    text = json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False)
    (root / MANIFEST).write_text(text + "\n", encoding="utf-8")
