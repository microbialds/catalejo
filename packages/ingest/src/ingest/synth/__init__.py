"""Synthetic mgap results for tests and the critic (contract §8.5).

``catalejo synth --species N --genomes M --seed S --out DIR`` writes

- ``DIR/results/``, an mgap-shaped results directory (``ingest.mgap_layout``),
  to be passed to the platform's commands as ``--mgap DIR/results``;
- ``DIR/metadata.csv``, ``groups.csv``, ``genome_groups.csv``, ``sets.csv``
  and ``tombstones.csv`` beside it (contract §4.2, §4.6 to §4.8);
- ``DIR/synth_manifest.json``, which records every planted item and the
  genomes carrying it, for tests to assert against;
- ``DIR/.catalejo-synth``, the marker that allows a later run to replace DIR.

The same arguments always produce byte-identical files.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

from ingest import __version__
from ingest import mgap_layout as L
from ingest.config import ConfigError, find_repository_root, load_summary_templates
from ingest.synth.build import Builder, Feature, Genome
from ingest.synth.catalog import DETERMINANTS, PLASMIDS
from ingest.synth.plan import (
    MIXED_VERSION_SPECIES,
    MLST_ONLY_SPECIES,
    RunPlan,
    SynthError,
    plan_run,
)
from ingest.synth.side import side_tables
from ingest.synth.writers import (
    Output,
    st_value,
    write_genome,
    write_gtdbtk,
    write_software_versions,
)

__all__ = [
    "DEFAULT_GENOMES",
    "DEFAULT_SEED",
    "DEFAULT_SPECIES",
    "MANIFEST",
    "MARKER",
    "RESULTS_DIR",
    "SynthError",
    "SynthSummary",
    "run_synth",
]

RESULTS_DIR = "results"

# Defaults of `catalejo synth`: ten species so that more than eight exist
# (checklist C7) and one lacks an MLST scheme (C8, Serratia marcescens).
DEFAULT_SPECIES = 10
DEFAULT_GENOMES = 100
DEFAULT_SEED = 42
MARKER = ".catalejo-synth"
MANIFEST = "synth_manifest.json"


@dataclass
class SynthSummary:
    out: Path
    species: list[str]
    genomes: int
    files: int
    bytes: int
    side_rows: dict[str, int] = field(default_factory=dict[str, int])
    plants: dict[str, int] = field(default_factory=dict[str, int])

    def lines(self) -> list[str]:
        out = [
            f"catalejo synth: wrote {self.genomes} genomes of {len(self.species)} species "
            f"({', '.join(self.species)}) to {self.out}",
            f"  {RESULTS_DIR}/: {self.files} files, {self.bytes / 1e6:.1f} MB",
        ]
        out += [f"  {name}: {rows} rows" for name, rows in self.side_rows.items()]
        out.append(f"  {MANIFEST}: " + ", ".join(f"{k} {v}" for k, v in self.plants.items()))
        return out


def prepare_output(out: Path) -> Path:
    """Replace ``out`` safely.

    The target must lie inside the repository or the system temporary
    directory. An existing directory is removed only when it holds the marker
    of an earlier run or is empty; anything else is refused.
    """
    target = out.resolve()
    roots = [Path(tempfile.gettempdir()).resolve()]
    try:
        roots.append(find_repository_root())
    except ConfigError:
        pass
    if not any(target != root and target.is_relative_to(root) for root in roots):
        raise SynthError(
            f"refusing to write {target}: it must be inside the repository or the "
            "temporary directory"
        )
    if target.exists():
        if not target.is_dir():
            raise SynthError(f"refusing to replace {target}: it is not a directory")
        if not (target / MARKER).is_file() and any(target.iterdir()):
            raise SynthError(
                f"refusing to replace {target}: it is not empty and has no {MARKER} marker "
                "from an earlier synth run"
            )
        shutil.rmtree(target)
    target.mkdir(parents=True)
    # Written first, so that the output of an interrupted run can be replaced.
    (target / MARKER).write_text(f"catalejo synth {__version__}\n", encoding="utf-8")
    return target


def run_synth(out: Path, n_species: int, n_genomes: int, seed: int) -> SynthSummary:
    run = plan_run(seed, n_species, n_genomes)
    target = prepare_output(out)
    results = Output(target / RESULTS_DIR)
    builder = Builder(seed)
    genomes: list[Genome] = []
    for plan in run.genomes:
        genome = builder.build(plan)
        write_genome(results, genome, seed)
        genomes.append(genome)
    write_gtdbtk(results, run)
    write_software_versions(results, run)

    tables = side_tables(run)
    side = Output(target)
    side_rows: dict[str, int] = {}
    for name, text in tables.files():
        side.text(name, text)
        side_rows[name] = text.count("\n") - 1

    manifest = build_manifest(
        run,
        genomes,
        tables.group_members,
        tables.set_members,
        tables.tombstone,
        tables.tombstone_groups,
    )
    side.text(MANIFEST, json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    plants: dict[str, Any] = manifest["plants"]
    return SynthSummary(
        out=target,
        species=[s.code for s in run.species],
        genomes=len(genomes),
        files=results.files,
        bytes=results.bytes,
        side_rows=side_rows,
        plants={"plants": len(plants), "genomes": len(genomes)},
    )


# Manifest ----------------------------------------------------------------------------------------


def _coords(genome: Genome, predicate: Callable[[Feature], bool]) -> dict[str, Any] | None:
    for c in genome.contigs:
        for f in c.features:
            if predicate(f):
                return {
                    "contig": c.bakta_id,
                    "start": f.start,
                    "end": f.end,
                    "strand": f.strand,
                    "locus_tag": f.locus_tag,
                    "contig_classification": "plasmid" if c.is_plasmid else "chromosome",
                }
    return None


def _phrases(genome: Genome) -> list[str]:
    """Resistance phrases matched by the genome's AMRFinderPlus genes (contract §7.4)."""
    try:
        rules = load_summary_templates().resistance_phrase
    except (ConfigError, ValueError):
        return []
    hits = [DETERMINANTS[f.determinant] for f in genome.features if f.determinant]
    matched: list[str] = []
    for rule in rules:
        for m in rule.match:
            for d in hits:
                if d.type != L.AMRFINDERPLUS.type_amr:
                    continue
                if m.element_name and not any(fnmatchcase(d.symbol, p) for p in m.element_name):
                    continue
                if m.element_subtype and d.subtype != m.element_subtype:
                    continue
                if m.drug_subclass and d.subclass != m.drug_subclass:
                    continue
                if rule.phrase not in matched:
                    matched.append(rule.phrase)
    return matched


def build_manifest(
    run: RunPlan,
    genomes: list[Genome],
    groups: dict[str, list[str]],
    sets: dict[str, list[str]],
    tombstone: tuple[str, str],
    tombstone_groups: list[str],
) -> dict[str, Any]:
    ids = [g.genome_id for g in genomes]

    def where(pred: Callable[[Genome], bool]) -> list[str]:
        return [g.genome_id for g in genomes if pred(g)]

    genome_rows: dict[str, Any] = {}
    for g in genomes:
        p = g.plan
        genome_rows[g.genome_id] = {
            "species_code": p.species.code,
            "species": p.species.name,
            "assembly_status": p.assembly_status,
            "platform": p.metadata.platform
            or (L.PLATFORM_ONT if p.complete else L.PLATFORM_ILLUMINA),
            "detected_platform": L.PLATFORM_ONT if p.complete else L.PLATFORM_ILLUMINA,
            "assembler": L.LONG_READ.autocycler_tool if p.complete else L.SPADES.tool,
            "mgap_sample": p.sample,
            "file_prefix": p.prefix,
            "contigs": len(g.contigs),
            "total_length": g.size,
            "st": st_value(p),
            "mlst_scheme": p.species.mlst_scheme,
            "plasmids": list(p.plasmids),
            "plasmid_contigs": [c.bakta_id for c in g.contigs if c.is_plasmid],
            "has_mobsuite": p.has_mobsuite,
            "has_rgi": p.has_rgi,
            "in_gtdbtk": p.in_gtdbtk,
            "bakta_database": p.bakta_db,
            "amrfinderplus_database": p.amrfinder_db,
            "locus_tag_prefix": g.locus_prefix,
            "checkm2_completeness": p.completeness,
            "checkm2_contamination": p.contamination,
            "resistance_phrases": _phrases(g),
        }

    by_symbol: dict[str, list[str]] = {}
    for g in genomes:
        for symbol in sorted({f.determinant for f in g.features if f.determinant}):
            by_symbol.setdefault(symbol, []).append(g.genome_id)

    def symbols_of(kind: str) -> dict[str, list[str]]:
        return {s: v for s, v in by_symbol.items() if DETERMINANTS[s].type == kind}

    point: dict[str, dict[str, Any]] = {}
    for g in genomes:
        for m in g.plan.species.point_mutations:
            if m.symbol not in g.plan.mutations:
                continue
            if m.is_promoter:
                site = _coords(
                    g, lambda f, m=m: bool(f.determinant) and f.determinant.startswith(m.gene)
                )
                if site is not None:
                    site = {
                        **site,
                        "start": site["start"] - 199,
                        "end": site["start"] + 100,
                        "strand": "+",
                        "locus_tag": None,
                        "feature_locus_tag": site["locus_tag"],
                    }
            else:
                site = _coords(g, lambda f, m=m: f.mutation_gene == m.gene)
            point.setdefault(m.symbol, {})[g.genome_id] = site

    kpc = {
        g.genome_id: {
            **(_coords(g, lambda f: f.determinant == "blaKPC-2") or {}),
            "has_mobsuite": g.plan.has_mobsuite,
        }
        for g in genomes
        if "pKPC" in g.plan.plasmids
    }

    clusters: dict[str, list[str]] = {}
    for g in genomes:
        if g.plan.has_mobsuite:
            for key in g.plan.plasmids:
                clusters.setdefault(PLASMIDS[key].primary_cluster, []).append(g.genome_id)

    species = run.species
    mixed = species[MIXED_VERSION_SPECIES] if len(species) > MIXED_VERSION_SPECIES else None
    mlst_only = species[MLST_ONLY_SPECIES] if len(species) > MLST_ONLY_SPECIES else None
    no_scheme = [s for s in species if s.mlst_scheme is None]

    def split_versions(attr: str) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        if mixed is None:
            return out
        for g in genomes:
            if g.plan.species.code == mixed.code:
                out.setdefault(getattr(g.plan, attr), []).append(g.genome_id)
        return out

    plants: dict[str, Any] = {
        "complete_genomes": {
            s.code: where(lambda g, s=s: g.plan.species.code == s.code and g.plan.complete)
            for s in species
        },
        "draft_genomes": {
            s.code: where(lambda g, s=s: g.plan.species.code == s.code and not g.plan.complete)
            for s in species
        },
        "fragmented_assembly": where(lambda g: g.plan.fragmented),
        "assembly_gap": where(lambda g: g.plan.assembly_gap),
        "mixed_annotation_versions": {
            "species_code": mixed.code if mixed else None,
            "bakta_database": split_versions("bakta_db"),
            "amrfinderplus_database": split_versions("amrfinder_db"),
        },
        "carbapenemase_plasmid": {
            "element": "blaKPC-2",
            "mob_primary_cluster": PLASMIDS["pKPC"].primary_cluster,
            "replicon_types": list(PLASMIDS["pKPC"].replicons),
            "flanks": ["tnpR", "tnpA", "istA", "istB", "ISKpn6"],
            "carriers": kpc,
        },
        "shared_mob_clusters": {k: v for k, v in sorted(clusters.items()) if len(v) > 1},
        "point_mutations": point,
        "promoter_variants": sorted(
            {m.symbol for s in species for m in s.point_mutations if m.is_promoter}
        ),
        "prophages": {
            g.genome_id: [
                {"contig": c.bakta_id, "start": r.start, "end": r.end}
                for c in g.contigs
                for r in c.regions
            ]
            for g in genomes
            if any(c.regions for c in g.contigs)
        },
        "genomad_plasmids": {
            g.genome_id: [c.bakta_id for c in g.contigs if c.is_plasmid]
            for g in genomes
            if g.plan.plasmids
        },
        "no_determinants_no_plasmid": where(lambda g: g.plan.clean and not g.plan.plasmids),
        L.MOBSUITE.tool: {
            "with": where(lambda g: g.plan.has_mobsuite),
            "without": where(lambda g: not g.plan.has_mobsuite),
        },
        "resistance_determinants": symbols_of(L.AMRFINDERPLUS.type_amr),
        "virulence": symbols_of(L.AMRFINDERPLUS.type_virulence),
        "stress": symbols_of(L.AMRFINDERPLUS.type_stress),
        "resistance_phrases": {
            phrase: [gid for gid in ids if phrase in genome_rows[gid]["resistance_phrases"]]
            for phrase in sorted({p for r in genome_rows.values() for p in r["resistance_phrases"]})
        },
        "no_resistance_phrase": [gid for gid in ids if not genome_rows[gid]["resistance_phrases"]],
        "typing": {
            tool: where(
                lambda g, tool=tool: g.plan.has_typing and g.plan.species.typing_tool == tool
            )
            for tool in sorted({s.typing_tool for s in species if s.typing_tool})
        },
        "typing_absent": where(
            lambda g: g.plan.species.typing_tool is not None and not g.plan.has_typing
        ),
        "species_from_mlst_only": {
            "species_code": mlst_only.code if mlst_only else None,
            "genomes": where(lambda g: not g.plan.in_gtdbtk and not g.plan.metadata.species),
        },
        "species_conflict": {
            g.genome_id: {
                "metadata": g.plan.metadata.species,
                L.GTDBTK.tool: g.plan.conflict_species,
                L.KRAKEN2.tool: g.plan.conflict_species,
            }
            for g in genomes
            if g.plan.conflict_species
        },
        "metadata_species": where(lambda g: bool(g.plan.metadata.species)),
        "novel_st": where(lambda g: g.plan.novel_st),
        "no_mlst_scheme": {
            s.code: where(lambda g, s=s: g.plan.species.code == s.code) for s in no_scheme
        },
        "qc_below_threshold": where(lambda g: g.plan.completeness < 95 or g.plan.contamination > 5),
        "missing_isolation_site": where(lambda g: not g.plan.metadata.isolation_site),
        "access_groups": groups,
        "curated_sets": sets,
        "tombstone": {
            "genome_id": tombstone[0],
            "replaced_by": tombstone[1],
            "access_groups": tombstone_groups,
        },
        "prefixed_sample_name": {
            g.genome_id: {"mgap_sample": g.plan.sample, "file_prefix": g.plan.prefix}
            for g in genomes
            if g.plan.sample != g.genome_id
        },
        L.RGI.tool: {
            "with": where(lambda g: g.plan.has_rgi),
            "without": where(lambda g: not g.plan.has_rgi),
        },
    }
    return {
        "generator": {
            "command": "catalejo synth",
            "version": __version__,
            "seed": run.seed,
            "species": len(species),
            "genomes": len(genomes),
        },
        "results_dir": RESULTS_DIR,
        "species": [
            {
                "species_code": s.code,
                "canonical_name": s.name,
                "mlst_scheme": s.mlst_scheme,
                "typing_tool": s.typing_tool,
                "genome_ids": where(lambda g, s=s: g.plan.species.code == s.code),
            }
            for s in species
        ],
        "genomes": genome_rows,
        "plants": plants,
    }
