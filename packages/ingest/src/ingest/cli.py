"""The ``catalejo`` command (contract §8).

Every subcommand of contract §8 exists. Implemented as of milestone 1a:
``synth`` (§8.5), ``metadata init`` and ``metadata validate`` (§8.1),
``ingest``, ``groups ingest``, ``tombstones ingest`` and ``sets ingest``
(§8.2), ``release check`` and ``release build`` (§8.3). Each prints what it
did and exits with code 1 on any validation failure or unreadable input.

The Tier 0 sequence, as CI runs it on the synthetic data:

    catalejo synth --out data/synth
    catalejo metadata init --mgap data/synth/results \
        --existing data/synth/metadata.csv --out data/synth/metadata.csv
    catalejo ingest --mgap data/synth/results --metadata data/synth/metadata.csv \
        --catalog data/catalog/synth.duckdb
    catalejo tombstones ingest --file data/synth/tombstones.csv \
        --catalog data/catalog/synth.duckdb
    catalejo groups ingest --groups data/synth/groups.csv \
        --members data/synth/genome_groups.csv --catalog ...
    catalejo sets ingest --file data/synth/sets.csv --catalog ...
    catalejo release check --catalog ... --metadata ... --mgap ...
    catalejo release build --catalog ... --out releases/synth
    catalejo release check --catalog ... --release releases/synth

``tombstones ingest`` runs before ``groups ingest`` so that the group rows of
a tombstoned genome that was never ingested are kept, and route its tombstone
to the group releases (``ingest.side``, milestone 1a decision 7c).

The other commands print "not implemented until milestone <N>" to standard
error and exit with code 2, so a script that calls them fails loudly.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, NoReturn

import typer

from ingest import __version__
from ingest.synth import DEFAULT_GENOMES, DEFAULT_SEED, DEFAULT_SPECIES

if TYPE_CHECKING:
    from ingest.side import SideResult

app = typer.Typer(
    name="catalejo",
    help="Catalejo ingestion: mgap parsing, the master catalog, releases and synthetic data.",
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_enable=False,
)
metadata_app = typer.Typer(help="Write and validate metadata.csv (contract §4.2, §8.1).")
pangenome_app = typer.Typer(help="Ingest pangenomes and map clusters (contract §4.3, §8.2).")
tree_app = typer.Typer(help="Ingest phylogenetic trees (contract §4.4, §8.2).")
embeddings_app = typer.Typer(help="Ingest genome embeddings (contract §4.5, §8.2).")
sets_app = typer.Typer(help="Ingest curated genome sets (contract §4.6, §8.2).")
groups_app = typer.Typer(help="Ingest access groups (contract §4.8, §8.2).")
tombstones_app = typer.Typer(help="Ingest tombstones (contract §4.7, §8.2).")
release_app = typer.Typer(help="Check, build, describe and publish releases (contract §8.3).")

app.add_typer(metadata_app, name="metadata", no_args_is_help=True)
app.add_typer(pangenome_app, name="pangenome", no_args_is_help=True)
app.add_typer(tree_app, name="tree", no_args_is_help=True)
app.add_typer(embeddings_app, name="embeddings", no_args_is_help=True)
app.add_typer(sets_app, name="sets", no_args_is_help=True)
app.add_typer(groups_app, name="groups", no_args_is_help=True)
app.add_typer(tombstones_app, name="tombstones", no_args_is_help=True)
app.add_typer(release_app, name="release", no_args_is_help=True)

# Milestones that implement each stub (dev/build-plan.md).
MILESTONE_PANGENOME_TREE = "4a"
MILESTONE_RELEASE_NOTES_PUBLISH = "5"
MILESTONE_EMBEDDINGS = "6"

NOT_IMPLEMENTED_EXIT = 2
# Exit code of any validation failure or unreadable input.
VALIDATION_EXIT = 1


def _not_implemented(command: str, milestone: str) -> NoReturn:
    typer.echo(f"catalejo {command}: not implemented until milestone {milestone}", err=True)
    raise typer.Exit(code=NOT_IMPLEMENTED_EXIT)


def _report_failure(command: str, exc: Exception) -> NoReturn:
    """Print a refusal with its issues and exit with the validation code."""
    typer.echo(f"catalejo {command}: {exc}", err=True)
    for issue in getattr(exc, "issues", []):
        typer.echo(issue.line(), err=True)
    raise typer.Exit(code=VALIDATION_EXIT) from exc


def _side(command: str, run: Callable[[], SideResult]) -> None:
    from ingest.catalog import IngestError

    try:
        result = run()
    except IngestError as exc:
        _report_failure(command, exc)
    counts = ", ".join(f"{name} {n}" for name, n in result.rows.items())
    typer.echo(f"catalejo {command}: {counts}; {len(result.warnings())} warnings")
    for issue in result.issues:
        typer.echo(issue.line(), err=True)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"catalejo {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option(
            "--version",
            callback=_version_callback,
            is_eager=True,
            help="Print the version and exit.",
        ),
    ] = False,
) -> None:
    """Catalejo Genómico ingestion package."""


Catalog = Annotated[Path, typer.Option("--catalog", help="Master catalog DuckDB file.")]


# §8.1 Metadata ----------------------------------------------------------------------


@metadata_app.command("init")
def metadata_init(
    mgap: Annotated[Path, typer.Option("--mgap", help="mgap results directory.")],
    out: Annotated[Path, typer.Option("--out", help="metadata.csv to write.")],
    existing: Annotated[
        Path | None, typer.Option("--existing", help="Existing metadata.csv to preserve.")
    ] = None,
) -> None:
    """Write metadata.csv from mgap results, keeping manual entries (contract §4.2, §8.1)."""
    from ingest.config import ConfigError, platform
    from ingest.metadata import MetadataError, init_metadata, read_metadata, write_metadata

    if existing is not None and not existing.exists():
        typer.echo(
            f"warning: --existing {existing} does not exist; "
            "writing the table from the mgap results alone",
            err=True,
        )
    try:
        previous = read_metadata(existing) if existing is not None and existing.exists() else None
        result = init_metadata(mgap, platform(), previous)
    except (MetadataError, ConfigError) as exc:
        typer.echo(f"catalejo metadata init: {exc}", err=True)
        raise typer.Exit(code=VALIDATION_EXIT) from exc
    if result.samples == 0:
        typer.echo(f"catalejo metadata init: no mgap samples found in {mgap}", err=True)
        raise typer.Exit(code=VALIDATION_EXIT)
    write_metadata(out, result.table)
    for warning in result.warnings():
        typer.echo(f"warning: {warning}", err=True)
    typer.echo(
        f"catalejo metadata init: wrote {len(result.table.rows)} rows to {out} "
        f"({result.samples} samples: {result.matched} kept from the existing file, "
        f"{result.new} new; {len(result.orphans)} rows without a sample)"
    )


@metadata_app.command("validate")
def metadata_validate(
    metadata: Annotated[Path, typer.Argument(help="metadata.csv to validate.")],
    mgap: Annotated[
        Path | None,
        typer.Option("--mgap", help="mgap results directory, to check mgap_sample."),
    ] = None,
) -> None:
    """Validate metadata.csv against contract §4.2 and the input rules of §9."""
    from ingest.config import ConfigError, load_species_registry, platform
    from ingest.issues import failures, warnings
    from ingest.metadata import MetadataError, read_metadata, validate_metadata

    try:
        table = read_metadata(metadata)
        issues = validate_metadata(table, platform(), load_species_registry(), mgap)
    except (MetadataError, ConfigError) as exc:
        typer.echo(f"catalejo metadata validate: {exc}", err=True)
        raise typer.Exit(code=VALIDATION_EXIT) from exc
    for issue in issues:
        typer.echo(issue.line(), err=True)
    failed = failures(issues)
    checked = "with" if mgap is not None else "without"
    typer.echo(
        f"catalejo metadata validate: {len(table.rows)} rows in {metadata}, checked {checked} "
        f"the mgap results; {len(failed)} failures, {len(warnings(issues))} warnings"
    )
    if failed:
        raise typer.Exit(code=VALIDATION_EXIT)


# §8.2 Ingestion and external products ----------------------------------------------------


@app.command("ingest")
def ingest(
    mgap: Annotated[Path, typer.Option("--mgap", help="mgap results directory.")],
    metadata: Annotated[Path, typer.Option("--metadata", help="metadata.csv.")],
    catalog: Catalog,
) -> None:
    """Build the master catalog from mgap results and metadata (contract §5, §8.2)."""
    from ingest.catalog import IngestError, run_ingest
    from ingest.config import ConfigError
    from ingest.metadata import MetadataError

    try:
        result = run_ingest(mgap, metadata, catalog)
    except (IngestError, MetadataError, ConfigError) as exc:
        _report_failure("ingest", exc)
    for line in result.lines():
        typer.echo(line)
    for issue in result.issues:
        typer.echo(issue.line(), err=True)


@pangenome_app.command("ingest")
def pangenome_ingest(
    directory: Annotated[Path, typer.Option("--dir", help="Pangenome directory (§4.3).")],
    catalog: Catalog,
) -> None:
    """Ingest a Panaroo pangenome directory. Not implemented until milestone 4a."""
    _not_implemented("pangenome ingest", MILESTONE_PANGENOME_TREE)


@pangenome_app.command("map")
def pangenome_map(
    previous: Annotated[Path, typer.Option("--previous", help="Previous release catalog.")],
    catalog: Catalog,
) -> None:
    """Map pangenome clusters to the previous release (§3.5). Not implemented until milestone 4a."""
    _not_implemented("pangenome map", MILESTONE_PANGENOME_TREE)


@tree_app.command("ingest")
def tree_ingest(
    directory: Annotated[Path, typer.Option("--dir", help="Tree directory (§4.4).")],
    catalog: Catalog,
) -> None:
    """Ingest a tree directory. Not implemented until milestone 4a."""
    _not_implemented("tree ingest", MILESTONE_PANGENOME_TREE)


@embeddings_app.command("ingest")
def embeddings_ingest(
    file: Annotated[Path, typer.Option("--file", help="Embedding Parquet file (§4.5).")],
    catalog: Catalog,
) -> None:
    """Ingest an embedding file. Not implemented until milestone 6."""
    _not_implemented("embeddings ingest", MILESTONE_EMBEDDINGS)


@sets_app.command("ingest")
def sets_ingest(
    file: Annotated[Path, typer.Option("--file", help="sets.csv (§4.6).")],
    catalog: Catalog,
) -> None:
    """Ingest curated genome sets into the catalog (contract §4.6, §5.14)."""
    from ingest.side import ingest_sets

    _side("sets ingest", lambda: ingest_sets(catalog, file))


@groups_app.command("ingest")
def groups_ingest(
    groups: Annotated[Path, typer.Option("--groups", help="groups.csv (§4.8).")],
    members: Annotated[Path, typer.Option("--members", help="genome_groups.csv (§4.8).")],
    catalog: Catalog,
) -> None:
    """Ingest access groups and their members into the catalog (contract §4.8, §5.17)."""
    from ingest.side import ingest_groups

    _side("groups ingest", lambda: ingest_groups(catalog, groups, members))


@tombstones_app.command("ingest")
def tombstones_ingest(
    file: Annotated[Path, typer.Option("--file", help="tombstones.csv (§4.7).")],
    catalog: Catalog,
) -> None:
    """Ingest tombstones and remove those genomes from the catalog (contract §4.7, §5.16)."""
    from ingest.side import ingest_tombstones

    _side("tombstones ingest", lambda: ingest_tombstones(catalog, file))


# §8.3 Release ---------------------------------------------------------------------------


@release_app.command("check")
def release_check(
    catalog: Catalog,
    metadata: Annotated[
        Path | None, typer.Option("--metadata", help="metadata.csv, for the input rules.")
    ] = None,
    mgap: Annotated[
        Path | None, typer.Option("--mgap", help="mgap results, for the input rules.")
    ] = None,
    release: Annotated[
        Path | None, typer.Option("--release", help="Built release, for the checksum rule.")
    ] = None,
) -> None:
    """Validate the catalog against contract §9; exit 1 on any failure."""
    from ingest.catalog import IngestError, connect
    from ingest.config import ConfigError
    from ingest.issues import failures, warnings
    from ingest.metadata import MetadataError
    from ingest.validate import check_manifest_checksums, validate_catalog, validate_inputs

    if (metadata is None) != (mgap is None):
        typer.echo("catalejo release check: --metadata and --mgap go together", err=True)
        raise typer.Exit(code=VALIDATION_EXIT)
    try:
        con = connect(catalog, read_only=True)
        try:
            issues = validate_catalog(con)
        finally:
            con.close()
        if metadata is not None and mgap is not None:
            issues += validate_inputs(metadata, mgap)
        if release is not None:
            issues += check_manifest_checksums(release)
    except (IngestError, MetadataError, ConfigError) as exc:
        _report_failure("release check", exc)
    for issue in issues:
        typer.echo(issue.line(), err=True)
    scope = ["catalog"]
    scope += ["metadata and mgap results"] if metadata is not None else []
    scope += [f"release {release}"] if release is not None else []
    failed = failures(issues)
    typer.echo(
        f"catalejo release check: checked {', '.join(scope)}: {len(failed)} failures, "
        f"{len(warnings(issues))} warnings"
    )
    if failed:
        raise typer.Exit(code=VALIDATION_EXIT)


@release_app.command("build")
def release_build(
    catalog: Catalog,
    out: Annotated[Path, typer.Option("--out", help="Release directory to write.")],
    group: Annotated[
        str | None, typer.Option("--group", help="Build the release of one access group.")
    ] = None,
) -> None:
    """Build the release layout of contract §6 from the catalog."""
    from ingest.config import ConfigError
    from ingest.release.build import build_release
    from ingest.release.output import ReleaseError

    try:
        result = build_release(catalog, out, group)
    except (ReleaseError, ConfigError) as exc:
        _report_failure("release build", exc)
    for line in result.lines():
        typer.echo(line)


@release_app.command("notes")
def release_notes(
    catalog: Catalog,
    previous: Annotated[Path, typer.Option("--previous", help="Previous release catalog.")],
) -> None:
    """Generate NOTES.md against the previous release. Not implemented until milestone 5."""
    _not_implemented("release notes", MILESTONE_RELEASE_NOTES_PUBLISH)


@release_app.command("publish")
def release_publish(
    directory: Annotated[Path, typer.Option("--dir", help="Release directory.")],
    bucket: Annotated[str, typer.Option("--bucket", help="Object storage bucket.")],
    group: Annotated[str | None, typer.Option("--group", help="Access group.")] = None,
) -> None:
    """Upload a release to object storage. Not implemented until milestone 5."""
    _not_implemented("release publish", MILESTONE_RELEASE_NOTES_PUBLISH)


# §8.5 Synthetic release -------------------------------------------------------------------


@app.command("synth")
def synth(
    out: Annotated[Path, typer.Option("--out", help="Output directory, replaced if it exists.")],
    species: Annotated[
        int, typer.Option("--species", min=1, help="Number of species (1 to 10).")
    ] = DEFAULT_SPECIES,
    genomes: Annotated[
        int, typer.Option("--genomes", min=1, help="Number of genomes.")
    ] = DEFAULT_GENOMES,
    seed: Annotated[int, typer.Option("--seed", help="Random seed.")] = DEFAULT_SEED,
) -> None:
    """Write a synthetic mgap results directory and its side tables (contract §8.5)."""
    from ingest.synth import SynthError, run_synth

    try:
        summary = run_synth(out=out, n_species=species, n_genomes=genomes, seed=seed)
    except SynthError as exc:
        typer.echo(f"catalejo synth: {exc}", err=True)
        raise typer.Exit(code=2) from exc
    for line in summary.lines():
        typer.echo(line)
