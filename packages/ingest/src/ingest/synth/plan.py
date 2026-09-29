"""Decide what every synthetic genome carries, before any sequence is built.

The plan fixes each genome's species, sequence type, assembly status, plasmids,
determinants, mutations, typing, tool versions and metadata, and records the
planted acceptance-item content (requirements §5 and §6) that tests look up in
``synth_manifest.json``. Every decision draws from a generator seeded by the
run seed and the genome identifier, so it does not depend on the order in
which other genomes were planned.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ingest.synth.catalog import (
    COLLECTION_GROUPS,
    COUNTRIES,
    HOSTS,
    ISOLATION_SITES,
    MAX_SPECIES,
    SITES,
    SPECIES,
    WARDS,
    SpeciesSpec,
    StProfile,
)
from ingest.synth.sequences import sub_rng


class SynthError(Exception):
    """The requested synthetic run cannot be produced."""


# Current and previous annotation versions. The mixed-version species uses the
# previous ones for half of its genomes (requirements §5.6, checklist G13).
BAKTA_VERSION = "1.11.4"
BAKTA_DB = "6.0"
BAKTA_VERSION_OLD = "1.9.4"
BAKTA_DB_OLD = "5.1"
AMRFINDER_VERSION = "4.2.5"
AMRFINDER_DB = "2025-12-03.1"
AMRFINDER_VERSION_OLD = "3.12.8"
AMRFINDER_DB_OLD = "2024-07-22.1"

# Species roles by position in the species list.
MIXED_VERSION_SPECIES = 1  # Salmonella enterica
MLST_ONLY_SPECIES = 2  # Staphylococcus aureus: no GTDB-Tk output, no metadata species

GENOME_NUMBER_WIDTH = 4


@dataclass
class Metadata:
    """One row of the metadata seed (contract §4.2), plus extra columns."""

    species: str = ""
    source_type: str = ""
    isolation_date: str = ""
    country: str = ""
    region: str = ""
    city: str = ""
    site: str = ""
    host: str = ""
    isolation_site: str = ""
    collection_group: str = ""
    platform: str = ""
    biosample_accession: str = ""
    assembly_accession: str = ""
    sra_accession: str = ""
    notes: str = ""
    extra: dict[str, str] = field(default_factory=dict[str, str])


@dataclass
class GenomePlan:
    genome_id: str
    species: SpeciesSpec
    index: int  # rank within its species
    complete: bool = False
    fragmented: bool = False
    assembly_gap: bool = False
    profile: StProfile | None = None
    novel_st: bool = False
    clean: bool = False  # no resistance determinants at all
    plasmids: list[str] = field(default_factory=list[str])
    chromosomal: list[str] = field(default_factory=list[str])  # determinant symbols
    virulence: list[str] = field(default_factory=list[str])
    mutations: list[str] = field(default_factory=list[str])  # PointMutation symbols
    prophages: list[int] = field(default_factory=list[int])
    accessory: list[int] = field(default_factory=list[int])
    has_mobsuite: bool = True
    has_typing: bool = True
    in_gtdbtk: bool = True
    conflict_species: str | None = None  # name GTDB-Tk and Kraken2 report instead
    bakta_version: str = BAKTA_VERSION
    bakta_db: str = BAKTA_DB
    amrfinder_version: str = AMRFINDER_VERSION
    amrfinder_db: str = AMRFINDER_DB
    completeness: float = 99.0
    contamination: float = 0.5
    metadata: Metadata = field(default_factory=Metadata)

    @property
    def assembly_status(self) -> str:
        return "complete" if self.complete else "draft"


@dataclass
class RunPlan:
    seed: int
    species: list[SpeciesSpec]
    genomes: list[GenomePlan]

    def by_species(self, code: str) -> list[GenomePlan]:
        return [g for g in self.genomes if g.species.code == code]


def allocate(n_genomes: int, species: list[SpeciesSpec]) -> list[int]:
    """Genomes per species: each minimum, then the rest by weight (largest remainder)."""
    minimum = sum(s.min_genomes for s in species)
    if n_genomes < minimum:
        raise SynthError(f"{len(species)} species need at least {minimum} genomes; got {n_genomes}")
    rest = n_genomes - minimum
    total = sum(s.weight for s in species)
    quotas = [rest * s.weight / total for s in species]
    counts = [s.min_genomes + int(q) for s, q in zip(species, quotas, strict=True)]
    order = sorted(range(len(species)), key=lambda i: (-(quotas[i] - int(quotas[i])), i))
    for i in order[: n_genomes - sum(counts)]:
        counts[i] += 1
    return counts


def _pick_profile(spec: SpeciesSpec, gid: str, seed: int) -> StProfile | None:
    if not spec.st_profiles:
        return None
    rng = sub_rng(seed, "st", gid)
    return rng.choices(spec.st_profiles, weights=[p.weight for p in spec.st_profiles])[0]


def plan_run(seed: int, n_species: int, n_genomes: int) -> RunPlan:
    if not 1 <= n_species <= MAX_SPECIES:
        raise SynthError(f"--species must be between 1 and {MAX_SPECIES}; got {n_species}")
    species = list(SPECIES[:n_species])
    counts = allocate(n_genomes, species)
    genomes: list[GenomePlan] = []
    for s_index, (spec, count) in enumerate(zip(species, counts, strict=True)):
        for i in range(count):
            gid = f"{spec.code}{i + 1:0{GENOME_NUMBER_WIDTH}d}"
            genomes.append(_plan_genome(seed, spec, s_index, i, gid))
    run = RunPlan(seed=seed, species=species, genomes=genomes)
    for position, g in enumerate(run.genomes):
        _plan_metadata(seed, g, position)
    return run


def _plan_genome(seed: int, spec: SpeciesSpec, s_index: int, i: int, gid: str) -> GenomePlan:
    rng = sub_rng(seed, "plan", gid)
    g = GenomePlan(genome_id=gid, species=spec, index=i)
    g.profile = _pick_profile(spec, gid, seed)
    g.complete = i == 0
    g.has_mobsuite = i % 3 != 2
    g.in_gtdbtk = s_index != MLST_ONLY_SPECIES
    # Random content first; forced plants below override it.
    g.plasmids = [key for key, p in spec.plasmids if rng.random() < p]
    g.chromosomal = [sym for sym, p in spec.chromosomal_optional if rng.random() < p]
    g.virulence = [s for group, p in spec.virulence if rng.random() < p for s in group]
    g.mutations = [
        m.symbol for m in spec.point_mutations if not m.is_promoter and rng.random() < 0.4
    ]
    if any(m.is_promoter for m in spec.point_mutations) and rng.random() < 0.15:
        g.mutations.append(next(m.symbol for m in spec.point_mutations if m.is_promoter))
    g.prophages = [k for k in range(3) if rng.random() < 0.45]
    g.accessory = [k for k in range(24) if rng.random() < 0.5]
    g.completeness = round(rng.uniform(97.2, 100.0), 2)
    g.contamination = round(rng.uniform(0.05, 2.4), 2)

    if s_index == MIXED_VERSION_SPECIES and i % 2 == 0:
        g.bakta_version, g.bakta_db = BAKTA_VERSION_OLD, BAKTA_DB_OLD
        g.amrfinder_version, g.amrfinder_db = AMRFINDER_VERSION_OLD, AMRFINDER_DB_OLD

    match spec.code:
        case "KPN":
            _force_kpn(g, i)
        case "SEN":
            _force_sen(g, i)
        case "SAU":
            _force_sau(g, i)
        case _:
            pass
    if g.complete:
        g.has_mobsuite = True
    return g


def _set_plasmids(
    g: GenomePlan, *, include: tuple[str, ...] = (), exclude: tuple[str, ...] = ()
) -> None:
    keep = [p for p in g.plasmids if p not in exclude and p not in include]
    g.plasmids = [*include, *keep]


def _force_kpn(g: GenomePlan, i: int) -> None:
    kpc = "pKPC"
    if i == 0:  # complete genome with the carbapenemase plasmid
        _set_plasmids(g, include=(kpc, "pCol"))
    elif i == 1:  # draft carrier with the three point mutations and a gap
        _set_plasmids(g, include=(kpc,))
        g.mutations = ["gyrA_S83I", "parC_S80I", "blaSHV_C-112T"]
        g.assembly_gap = True
        g.has_mobsuite = True
    elif i == 2:  # draft carrier without MOB-suite (geNomad fallback)
        _set_plasmids(g, include=(kpc,))
        g.mutations = ["gyrA_S83I"]
        g.has_mobsuite = False
    elif i == 3:  # fragmented assembly
        _set_plasmids(g, include=("pESBL",), exclude=(kpc,))
        g.fragmented = True
        g.has_mobsuite = True
        g.completeness, g.contamination = 91.37, 1.18
    elif i == 4:  # species conflict: metadata says K. pneumoniae, tools say K. variicola
        _set_plasmids(g, include=("pESBL",), exclude=(kpc,))
        g.conflict_species = g.species.relative.name
    elif i == 5:  # no Kleborate output and a novel sequence type
        _set_plasmids(g, exclude=(kpc,))
        g.has_typing = False
        g.novel_st = True


def _force_sen(g: GenomePlan, i: int) -> None:
    if i == 0:  # complete genome with the colistin plasmid
        _set_plasmids(g, include=("pMCR",))
    elif i == 1:  # no resistance determinants and no plasmid (summary fallback)
        g.clean = True
        g.plasmids = []
        g.chromosomal = []
        g.virulence = []
        g.mutations = []
        g.has_mobsuite = True
    elif i == 2:  # ESBL plasmid shared with K. pneumoniae, no MOB-suite
        _set_plasmids(g, include=("pESBL",))
        g.mutations = ["gyrA_D87N"]
        g.has_mobsuite = False


def _force_sau(g: GenomePlan, i: int) -> None:
    if i == 0:  # complete MRSA with the blaZ plasmid and PVL
        _set_plasmids(g, include=("pBlaZ",))
        g.chromosomal = ["mecA", *[s for s in g.chromosomal if s != "mecA"]]
        g.virulence = ["lukF-PV", "lukS-PV"]
    elif i == 1:  # draft MSSA, sccmec reports no type; contamination above threshold
        _set_plasmids(g, include=("pBlaZ",))
        g.chromosomal = [s for s in g.chromosomal if s != "mecA"]
        g.contamination = 6.42


def _date(rng_value: float, year: int, month: int, day: int) -> str:
    if rng_value < 0.5:
        return f"{year:04d}-{month:02d}-{day:02d}"
    if rng_value < 0.8:
        return f"{year:04d}-{month:02d}"
    return f"{year:04d}"


def _plan_metadata(seed: int, g: GenomePlan, position: int) -> None:
    rng = sub_rng(seed, "metadata", g.genome_id)
    m = g.metadata
    names = [s for s, _ in g.species.source_weights]
    weights = [w for _, w in g.species.source_weights]
    m.source_type = rng.choices(names, weights=weights)[0]
    m.isolation_site = rng.choice(ISOLATION_SITES[m.source_type])
    if g.index % 7 == 6:
        m.isolation_site = ""
    m.host = rng.choice(HOSTS[m.source_type])
    m.country, m.region, m.city = rng.choice(COUNTRIES)
    m.site = rng.choice(SITES[m.source_type])
    m.collection_group = rng.choice(COLLECTION_GROUPS)
    year = 2015 + (position * 4) % 11
    m.isolation_date = _date(rng.random(), year, rng.randint(1, 12), rng.randint(1, 28))
    if g.complete:
        m.platform = "hybrid" if g.species.code == "SEN" else "ont"
    if rng.random() < 0.5:
        m.biosample_accession = f"SAMN{rng.randrange(10**7, 10**8)}"
        m.sra_accession = f"SRR{rng.randrange(10**7, 10**8)}"
    if g.conflict_species is not None or (g.index % 5 == 4 and g.in_gtdbtk):
        m.species = g.species.name
    m.extra = {
        "ward": rng.choice(WARDS) if m.source_type == "clinical" else "",
        "sequencing_batch": f"B{1 + position % 6:02d}",
    }
