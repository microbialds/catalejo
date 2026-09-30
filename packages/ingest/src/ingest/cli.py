"""The ``catalejo`` command (contract §8).

Every subcommand of contract §8 exists. Those that later milestones implement
print "not implemented until milestone <N>" to standard error and exit with
code 2, so a script that calls them fails loudly. ``synth`` (contract §8.5)
is implemented.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, NoReturn

import typer

from ingest import __version__
from ingest.synth import DEFAULT_GENOMES, DEFAULT_SEED, DEFAULT_SPECIES

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
MILESTONE_INGEST = "1a"
MILESTONE_PANGENOME_TREE = "4a"
MILESTONE_RELEASE_NOTES_PUBLISH = "5"
MILESTONE_EMBEDDINGS = "6"

NOT_IMPLEMENTED_EXIT = 2


def _not_implemented(command: str, milestone: str) -> NoReturn:
    typer.echo(f"catalejo {command}: not implemented until milestone {milestone}", err=True)
    raise typer.Exit(code=NOT_IMPLEMENTED_EXIT)


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
    """Write metadata.csv from mgap results. Not implemented until milestone 1a."""
    _not_implemented("metadata init", MILESTONE_INGEST)


@metadata_app.command("validate")
def metadata_validate(
    metadata: Annotated[Path, typer.Argument(help="metadata.csv to validate.")],
) -> None:
    """Validate metadata.csv against contract §4.2. Not implemented until milestone 1a."""
    _not_implemented("metadata validate", MILESTONE_INGEST)


# §8.2 Ingestion and external products ----------------------------------------------------


@app.command("ingest")
def ingest(
    mgap: Annotated[Path, typer.Option("--mgap", help="mgap results directory.")],
    metadata: Annotated[Path, typer.Option("--metadata", help="metadata.csv.")],
    catalog: Catalog,
) -> None:
    """Build the master catalog from mgap results. Not implemented until milestone 1a."""
    _not_implemented("ingest", MILESTONE_INGEST)


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
    """Ingest curated genome sets. Not implemented until milestone 1a."""
    _not_implemented("sets ingest", MILESTONE_INGEST)


@groups_app.command("ingest")
def groups_ingest(
    groups: Annotated[Path, typer.Option("--groups", help="groups.csv (§4.8).")],
    members: Annotated[Path, typer.Option("--members", help="genome_groups.csv (§4.8).")],
    catalog: Catalog,
) -> None:
    """Ingest access groups and their members. Not implemented until milestone 1a."""
    _not_implemented("groups ingest", MILESTONE_INGEST)


@tombstones_app.command("ingest")
def tombstones_ingest(
    file: Annotated[Path, typer.Option("--file", help="tombstones.csv (§4.7).")],
    catalog: Catalog,
) -> None:
    """Ingest tombstones. Not implemented until milestone 1a."""
    _not_implemented("tombstones ingest", MILESTONE_INGEST)


# §8.3 Release ---------------------------------------------------------------------------


@release_app.command("check")
def release_check(catalog: Catalog) -> None:
    """Validate the catalog against contract §9. Not implemented until milestone 1a."""
    _not_implemented("release check", MILESTONE_INGEST)


@release_app.command("build")
def release_build(
    catalog: Catalog,
    out: Annotated[Path, typer.Option("--out", help="Release directory to write.")],
    group: Annotated[
        str | None, typer.Option("--group", help="Build the release of one access group.")
    ] = None,
) -> None:
    """Build the release layout of contract §6. Not implemented until milestone 1a."""
    _not_implemented("release build", MILESTONE_INGEST)


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
