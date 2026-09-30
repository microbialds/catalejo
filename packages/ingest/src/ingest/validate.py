"""``catalejo release check``: the validation rules of data contract 0.7 §9.

One function per rule, each returning ``Issue`` values with the rule's
identifier. Catalog rules read the catalog only; the input rules on the
metadata table and the mgap results run when ``release check`` is given
``--metadata`` and ``--mgap`` (they also run in ``metadata validate`` and
``ingest``; milestone 1a plan, decision 3); the manifest checksum rule runs
when it is given ``--release`` (decision 4).

Rules on products that milestone 1a does not ingest read their catalog
tables when those exist and pass otherwise: tree tips (``tree_tip``), the
pangenome genome columns (checked through ``cluster_membership``, which
holds the genomes of every ingested pangenome), pangenome or tree presence
for ``pangenome_eligible`` species (``pangenome_species`` and ``tree``;
absent tables mean no product, so the warning fires), and genomes without an
embedding (``embedding``; absent means no model, so no warning).

The ``color_index`` rule reads ``config/species_registry.yaml`` with a
lenient parse, since the strict loader refuses such a file before any check
could report it.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, cast

import duckdb
import yaml

from ingest.config import (
    SPECIES_REGISTRY_FILE,
    PaletteConfig,
    config_dir,
    load_palette,
    load_species_registry,
    platform,
)
from ingest.issues import FAILURE, WARNING, Issue
from ingest.metadata import (
    check_country,
    check_isolation_date,
    check_mgap_sample_present,
    check_mgap_sample_unique,
    check_platform,
    check_source_type,
    country_codes,
    list_samples,
    read_metadata,
)
from ingest.side_tables import METADATA
from ingest.store import table_exists

MANIFEST = "manifest.json"
AMRFINDERPLUS = "amrfinderplus"
BAKTA = "bakta"
MLST_SOURCE = "mlst"

R_PATTERN = "genome_id.pattern"
R_DUPLICATE = "genome_id.duplicate"
R_TOMBSTONED = "genome_id.tombstoned"
R_COLOR_INDEX = "species_registry.color_index"
R_SPECIES = "genome.species_unregistered"
R_NO_GROUP = "genome.no_access_group"
R_FEATURE_COORDINATES = "feature.coordinates"
R_REFERENCE = "reference.dangling"
R_TREE_TIP = "tree_tip.genome_id"
R_PANGENOME = "pangenome.genome_id"
R_CHECKSUM = "manifest.checksum"
R_VOCABULARY = "genome.vocabulary"
W_MLST_ONLY = "species.mlst_only"
W_CONFLICT = "species.conflict"
W_MIXED_VERSIONS = "tool_version.mixed_database"
W_NO_PANGENOME = "species.no_pangenome_or_tree"
W_NO_EMBEDDING = "embedding.missing"
W_SMALL_SET = "genome_set.small"


def _ids(con: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None) -> list[Any]:
    return con.execute(sql, params or []).fetchall()


# Failures ---------------------------------------------------------------------------------------


def check_genome_id_pattern(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    config = platform()
    regex = config.genome_id_regex
    return [
        Issue(R_PATTERN, FAILURE, f"does not match {config.genome_id_pattern}", gid)
        for (gid,) in _ids(con, "SELECT genome_id FROM genome ORDER BY genome_id")
        if not regex.match(gid)
    ]


def check_genome_id_duplicate(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(
        con,
        """SELECT lower(genome_id), list(genome_id ORDER BY genome_id) FROM genome
        GROUP BY 1 HAVING count(*) > 1 ORDER BY 1""",
    )
    return [
        Issue(R_DUPLICATE, FAILURE, f"genome_ids equal without regard to case: {ids}", ids[0])
        for _, ids in rows
    ]


def check_genome_tombstoned(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(
        con,
        """SELECT genome_id FROM genome WHERE genome_id IN (SELECT genome_id FROM tombstone)
        ORDER BY 1""",
    )
    return [Issue(R_TOMBSTONED, FAILURE, "in both genome and tombstone", g) for (g,) in rows]


def check_color_index(
    registry_path: Path | None = None, palette: PaletteConfig | None = None
) -> list[Issue]:
    """color_index shared by two species or outside the palette's species sequence."""
    path = registry_path or config_dir() / SPECIES_REGISTRY_FILE
    palette = palette or load_palette()
    data: Any = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    mapping = cast(dict[str, Any], data) if isinstance(data, dict) else {}
    species = cast(list[Any], mapping.get("species") or [])
    size = len(palette.species.sequence)
    owner: dict[int, str] = {}
    out: list[Issue] = []
    for item in species:
        if not isinstance(item, dict):
            continue
        entry = cast(dict[str, Any], item)
        code = str(entry.get("species_code"))
        index: Any = entry.get("color_index")
        if index is None:
            continue
        if not isinstance(index, int) or not 0 <= index < size:
            out.append(
                Issue(
                    R_COLOR_INDEX,
                    FAILURE,
                    f"{code}: color_index {index!r} is outside 0..{size - 1}",
                )
            )
        elif index in owner:
            out.append(
                Issue(
                    R_COLOR_INDEX, FAILURE, f"{code}: color_index {index} is also {owner[index]}'s"
                )
            )
        else:
            owner[index] = code
    return out


def check_species_registered(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(
        con,
        """SELECT genome_id, species_code FROM genome WHERE species_code IS NULL
        OR species_code NOT IN (SELECT species_code FROM species_registry) ORDER BY 1""",
    )
    return [
        Issue(R_SPECIES, FAILURE, f"species {code!r} is not in species_registry", gid)
        for gid, code in rows
    ]


def check_access_group(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(
        con,
        """SELECT genome_id FROM genome WHERE genome_id NOT IN
        (SELECT genome_id FROM genome_group WHERE group_id IN (SELECT group_id FROM access_group))
        ORDER BY 1""",
    )
    return [Issue(R_NO_GROUP, FAILURE, "belongs to no access group", g) for (g,) in rows]


def check_feature_coordinates(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(
        con,
        """SELECT f.genome_id, f.feature_id, f.contig_id, f.start, f."end", c.length
        FROM feature f LEFT JOIN contig c USING (genome_id, contig_id)
        WHERE f.start > f."end" OR c.length IS NULL OR f."end" > c.length OR f.start < 1
        ORDER BY 1, 2""",
    )
    return [
        Issue(
            R_FEATURE_COORDINATES,
            FAILURE,
            f"feature {fid} at {contig}:{start}-{end} "
            + ("is on an unknown contig" if length is None else f"on a contig of {length} bp"),
            gid,
        )
        for gid, fid, contig, start, end, length in rows
    ]


def check_references(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    """annotation_hit, mutation, region and cluster_membership rows referencing nothing."""
    out: list[Issue] = []
    tables = [
        ("annotation_hit", True),
        ("mutation", True),
        ("region", False),
        ("cluster_membership", True),
    ]
    for table, has_feature in tables:
        if not table_exists(con, table):
            continue
        for gid, n in _ids(
            con,
            f"""SELECT genome_id, count(*) FROM "{table}"
            WHERE genome_id NOT IN (SELECT genome_id FROM genome) GROUP BY 1 ORDER BY 1""",
        ):
            out.append(Issue(R_REFERENCE, FAILURE, f"{n} {table} rows for an unknown genome", gid))
        if has_feature:
            for gid, n in _ids(
                con,
                f"""SELECT genome_id, count(*) FROM "{table}" WHERE feature_id IS NOT NULL
                AND feature_id NOT IN (SELECT feature_id FROM feature) GROUP BY 1 ORDER BY 1""",
            ):
                out.append(
                    Issue(R_REFERENCE, FAILURE, f"{n} {table} rows for an unknown feature_id", gid)
                )
    return out


def check_tree_tips(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    if not table_exists(con, "tree_tip"):
        return []
    rows = _ids(
        con,
        """SELECT tree_id, genome_id FROM tree_tip
        WHERE genome_id NOT IN (SELECT genome_id FROM genome) ORDER BY 1, 2""",
    )
    return [
        Issue(R_TREE_TIP, FAILURE, f"tip of tree {t} is not in the release", g) for t, g in rows
    ]


def check_pangenome_genomes(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    if not table_exists(con, "cluster_membership"):
        return []
    rows = _ids(
        con,
        """SELECT DISTINCT genome_id FROM cluster_membership
        WHERE genome_id NOT IN (SELECT genome_id FROM genome) ORDER BY 1""",
    )
    return [Issue(R_PANGENOME, FAILURE, "pangenome genome not in the release", g) for (g,) in rows]


def check_genome_vocabulary(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    """source_type, platform and country of catalog genomes within their vocabularies."""
    out: list[Issue] = []
    vocabularies = {
        "source_type": set(METADATA.source_types),
        "platform": set(METADATA.platforms),
        "country": set(country_codes()),
    }
    for column, allowed in vocabularies.items():
        for gid, value in _ids(
            con, f'SELECT genome_id, "{column}" FROM genome WHERE "{column}" IS NOT NULL ORDER BY 1'
        ):
            if value not in allowed:
                out.append(Issue(R_VOCABULARY, FAILURE, f"{column} {value!r} is not allowed", gid))
    return out


def check_manifest_checksums(release_dir: Path) -> list[Issue]:
    """Every file entry of the release manifest and of each group manifest matches."""
    manifests = [release_dir / MANIFEST] + sorted(release_dir.glob(f"*/{MANIFEST}"))
    out: list[Issue] = []
    if not manifests[0].is_file():
        return [Issue(R_CHECKSUM, FAILURE, f"no {MANIFEST} in {release_dir}")]
    for manifest in manifests:
        data: Any = json.loads(manifest.read_text(encoding="utf-8"))
        root = manifest.parent
        for entry in data.get("files", []):
            path = root / entry["path"]
            where = f"{manifest.relative_to(release_dir)}: {entry['path']}"
            if not path.is_file():
                out.append(Issue(R_CHECKSUM, FAILURE, f"{where} is missing"))
                continue
            content = path.read_bytes()
            if (
                len(content) != entry["bytes"]
                or hashlib.sha256(content).hexdigest() != entry["sha256"]
            ):
                out.append(Issue(R_CHECKSUM, FAILURE, f"{where} does not match its checksum"))
    return out


# Warnings ---------------------------------------------------------------------------------------


def warn_mlst_only(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(
        con, "SELECT genome_id FROM genome WHERE species_source = ? ORDER BY 1", [MLST_SOURCE]
    )
    return [
        Issue(W_MLST_ONLY, WARNING, "species assigned from the MLST scheme only", g)
        for (g,) in rows
    ]


def warn_conflict(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(con, "SELECT genome_id FROM genome WHERE species_conflict ORDER BY 1")
    return [Issue(W_CONFLICT, WARNING, "species sources disagree", g) for (g,) in rows]


def warn_mixed_versions(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(
        con,
        """SELECT g.species_code, t.tool,
               list(DISTINCT t.database_version ORDER BY t.database_version)
        FROM tool_version t JOIN genome g USING (genome_id)
        WHERE t.tool IN (?, ?) AND t.database_version IS NOT NULL
        GROUP BY 1, 2 HAVING count(DISTINCT t.database_version) > 1 ORDER BY 1, 2""",
        [BAKTA, AMRFINDERPLUS],
    )
    return [
        Issue(W_MIXED_VERSIONS, WARNING, f"{code}: {tool} database versions {versions}")
        for code, tool, versions in rows
    ]


def warn_no_pangenome(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    have: set[str] = set()
    for table in ("pangenome_species", "tree"):
        if table_exists(con, table):
            have |= {r[0] for r in _ids(con, f'SELECT DISTINCT species_code FROM "{table}"')}
    rows = _ids(
        con,
        """SELECT DISTINCT s.species_code FROM species_registry s JOIN genome g USING (species_code)
        WHERE s.pangenome_eligible ORDER BY 1""",
    )
    return [
        Issue(W_NO_PANGENOME, WARNING, f"{code} is pangenome_eligible but has no pangenome or tree")
        for (code,) in rows
        if code not in have
    ]


def warn_no_embedding(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    if not table_exists(con, "embedding"):
        return []
    rows = _ids(
        con,
        """SELECT genome_id FROM genome WHERE genome_id NOT IN
        (SELECT genome_id FROM embedding) ORDER BY 1""",
    )
    return [Issue(W_NO_EMBEDDING, WARNING, "no embedding", g) for (g,) in rows]


def warn_small_sets(con: duckdb.DuckDBPyConnection) -> list[Issue]:
    rows = _ids(
        con,
        """SELECT s.set_id, count(m.genome_id) FROM genome_set s
        LEFT JOIN genome_set_member m USING (set_id) GROUP BY 1 HAVING count(m.genome_id) < 2
        ORDER BY 1""",
    )
    return [
        Issue(W_SMALL_SET, WARNING, f"curated set {sid} has {n} member{'s' if n != 1 else ''}")
        for sid, n in rows
    ]


# Entry points -----------------------------------------------------------------------------------

CATALOG_RULES = (
    check_genome_id_pattern,
    check_genome_id_duplicate,
    check_genome_tombstoned,
    check_species_registered,
    check_access_group,
    check_feature_coordinates,
    check_references,
    check_tree_tips,
    check_pangenome_genomes,
    check_genome_vocabulary,
    warn_mlst_only,
    warn_conflict,
    warn_mixed_versions,
    warn_no_pangenome,
    warn_no_embedding,
    warn_small_sets,
)


def validate_catalog(
    con: duckdb.DuckDBPyConnection, registry_path: Path | None = None
) -> list[Issue]:
    """Every catalog rule of §9, and the registry color_index rule."""
    issues = check_color_index(registry_path)
    for rule in CATALOG_RULES:
        issues += rule(con)
    return issues


def validate_inputs(metadata: Path, results_dir: Path) -> list[Issue]:
    """The §9 rules on the metadata table and the mgap results."""
    load_species_registry()  # the registry must load for the species of the inputs
    table = read_metadata(metadata)
    issues = check_mgap_sample_present(table, list_samples(results_dir))
    issues += check_mgap_sample_unique(table)
    issues += check_isolation_date(table)
    issues += check_source_type(table)
    issues += check_platform(table)
    issues += check_country(table)
    return issues
