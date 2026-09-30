"""Build the sequences and annotations of each planned genome.

A genome is assembled from elements (genes, RNAs, origins, gaps) separated by
spacers. Species-level parts (the chromosome template, core genes, the
accessory pool, prophages) and plasmids are generated once per run, so the
same gene or plasmid is byte-identical in every genome that carries it; this
is what makes protein hashes, flanks and MOB-suite clusters shared across
genomes. Draft assemblies are then cut into contigs at spacers, never inside a
block (a prophage, a promoter and its gene).
"""

from __future__ import annotations

import random
import string
from dataclasses import dataclass, field

from ingest import mgap_layout as L
from ingest.synth.catalog import (
    ACCESSORY_PRODUCTS,
    CORE_GENES,
    DETERMINANTS,
    GRAM_NEGATIVE_CORE,
    PLASMIDS,
    PROPHAGE_PRODUCTS,
    GeneSpec,
    PlasmidSpec,
    PointMutation,
    SpeciesSpec,
)
from ingest.synth.plan import GenomePlan
from ingest.synth.sequences import (
    gc_fraction,
    mutate_cds,
    random_cds,
    random_dna,
    reverse_complement,
    set_codon,
    sub_rng,
    translate,
)

T = L.BAKTA.feature_types
SPACER = "spacer"
CODING_TYPES = (T.cds, T.sorf)
LOCUS_TAG_TYPES = (T.cds, T.sorf, T.trna, T.tmrna, T.rrna, T.ncrna)

N_ACCESSORY = 24
N_PROPHAGES = 3
PROMOTER_SPACER = 260
GAP_LENGTH = 100
FRAGMENTED_JUNK_CONTIGS = 160
# Chromosomal and plasmid backbone genes are shortened by this factor so that a
# default run (100 genomes) stays near 100 megabytes; determinants and the
# genes carrying screened mutations keep their real lengths.
GENE_SCALE = 0.7


def _scaled(aa_length: int) -> int:
    return max(60, round(aa_length * GENE_SCALE))


@dataclass
class Element:
    kind: str  # a Bakta .tsv feature type, or SPACER
    seq: str  # in the feature's own orientation
    strand: str = "+"
    gene: str | None = None
    product: str = ""
    determinant: str | None = None  # AMRFinderPlus symbol
    mutation_gene: str | None = None  # core gene with screened positions
    category: str = "other"
    block: str | None = None  # elements sharing a block stay on one contig
    prophage: int | None = None
    plasmid_role: str | None = None  # "rep", "relaxase" or "mpf" on plasmids


@dataclass
class Feature:
    type: str
    start: int
    end: int
    strand: str
    seq: str  # feature orientation
    gene: str | None
    product: str
    locus_tag: str | None = None
    feature_id: str = ""  # Bakta internal ID for features without a locus tag
    protein: str | None = None
    determinant: str | None = None
    mutation_gene: str | None = None
    category: str = "other"
    prophage: int | None = None
    plasmid_role: str | None = None
    dbxrefs: tuple[str, ...] = ()

    @property
    def ident(self) -> str:
        return self.locus_tag or self.feature_id


@dataclass
class Region:
    prophage: int
    start: int
    end: int
    n_genes: int


@dataclass
class Contig:
    seq: str
    replicon: str  # "chromosome", a plasmid key, or "junk"
    circular: bool
    features: list[Feature] = field(default_factory=list[Feature])
    regions: list[Region] = field(default_factory=list[Region])
    coverage: float = 30.0
    bakta_id: str = ""
    assembly_name: str = ""
    index: int = 0  # 1-based rank in the assembly
    plasmid_name: str = ""  # Bakta plasmid-name tag of a complete plasmid
    rotation: int = 0  # offset of the Autocycler sequence before Dnaapler rotated it

    @property
    def autocycler_seq(self) -> str:
        return (
            self.seq[-self.rotation :] + self.seq[: -self.rotation] if self.rotation else self.seq
        )

    @property
    def rotated_to(self) -> str | None:
        """Gene Dnaapler rotated this replicon to: dnaA, or the plasmid's rep gene."""
        first = self.features[0] if self.features else None
        if first is None or first.start != 1:
            return None
        if self.replicon == "chromosome" or first.plasmid_role == "rep":
            return first.gene
        return None

    @property
    def length(self) -> int:
        return len(self.seq)

    @property
    def gc(self) -> float:
        return gc_fraction(self.seq)

    @property
    def is_plasmid(self) -> bool:
        return self.replicon in PLASMIDS

    @property
    def plasmid(self) -> PlasmidSpec | None:
        return PLASMIDS.get(self.replicon)


@dataclass
class Genome:
    plan: GenomePlan
    contigs: list[Contig]
    locus_prefix: str
    # SPAdes contigs file (scaffolds split at gaps) for drafts: (name, sequence).
    spades_contigs: list[tuple[str, str]] = field(default_factory=list[tuple[str, str]])

    @property
    def genome_id(self) -> str:
        return self.plan.genome_id

    @property
    def features(self) -> list[Feature]:
        return [f for c in self.contigs for f in c.features]

    @property
    def size(self) -> int:
        return sum(c.length for c in self.contigs)


@dataclass(frozen=True)
class _Slot:
    kind: str  # core, mutation, intrinsic, optional, virulence, accessory, prophage, rna
    key: str
    strand: str


class Builder:
    """Generates species-level and plasmid parts once, then genomes from plans."""

    def __init__(self, seed: int) -> None:
        self.seed = seed
        self._genes: dict[str, str] = {}
        self._templates: dict[str, list[_Slot]] = {}
        self._plasmids: dict[str, list[Element]] = {}
        self._phages: dict[str, list[Element]] = {}

    # Species-level parts ----------------------------------------------------------------

    def _gene_seq(self, key: str, aa_length: int, gc: float) -> str:
        if key not in self._genes:
            rng = sub_rng(self.seed, "gene", key)
            self._genes[key] = random_cds(rng, aa_length + 1, gc)
        return self._genes[key]

    def determinant_seq(self, symbol: str) -> str:
        d = DETERMINANTS[symbol]
        return self._gene_seq(f"element:{symbol}", d.aa_length, d.gc)

    def _mutation_gene_seq(self, spec: SpeciesSpec, gene: GeneSpec, carried: list[str]) -> str:
        seq = self._gene_seq(f"core:{spec.code}:{gene.gene}", gene.aa_length, spec.gc)
        rng = sub_rng(self.seed, "codon", spec.code, str(gene.gene))
        for m in spec.point_mutations:
            if m.gene != gene.gene or m.is_promoter:
                continue
            position = int(m.variant[1:-1])
            residue = m.variant[-1] if m.symbol in carried else m.variant[0]
            seq = set_codon(seq, position, residue, rng)
        return seq

    def _template(self, spec: SpeciesSpec) -> list[_Slot]:
        if spec.code in self._templates:
            return self._templates[spec.code]
        rng = sub_rng(self.seed, "template", spec.code)
        core = list(CORE_GENES) + (list(GRAM_NEGATIVE_CORE) if spec.gram_negative else [])
        slots: list[_Slot] = [_Slot("core", str(k), "+") for k in range(1, len(core))]
        slots += [_Slot("mutation", str(g.gene), "") for g in spec.mutation_genes]
        slots += [_Slot("intrinsic", s, "") for s in spec.intrinsic]
        slots += [_Slot("optional", s, "") for s, _ in spec.chromosomal_optional]
        slots += [_Slot("virulence", str(k), "") for k in range(len(spec.virulence))]
        slots += [_Slot("accessory", str(k), "") for k in range(N_ACCESSORY)]
        slots += [_Slot("prophage", str(k), "") for k in range(N_PROPHAGES)]
        slots += [_Slot("rna", str(k), "") for k in range(len(_RNAS))]
        rng.shuffle(slots)
        stranded = [_Slot(s.kind, s.key, rng.choice("+-")) for s in slots]
        # dnaA opens the chromosome on the forward strand, as Dnaapler orients it.
        template = [_Slot("core", "0", "+"), *stranded]
        self._templates[spec.code] = template
        return template

    def _core_gene(self, spec: SpeciesSpec, k: int) -> GeneSpec:
        core = list(CORE_GENES) + (list(GRAM_NEGATIVE_CORE) if spec.gram_negative else [])
        return core[k]

    def _accessory_gene(self, spec: SpeciesSpec, k: int) -> tuple[GeneSpec, str]:
        rng = sub_rng(self.seed, "accessory", spec.code, str(k))
        gene, product = ACCESSORY_PRODUCTS[k % len(ACCESSORY_PRODUCTS)]
        g = GeneSpec(gene, product, rng.randint(90, 420))
        return g, self._gene_seq(f"accessory:{spec.code}:{k}", g.aa_length, spec.gc)

    def _prophage(self, spec: SpeciesSpec, k: int) -> list[Element]:
        key = f"{spec.code}:{k}"
        if key not in self._phages:
            rng = sub_rng(self.seed, "phage", key)
            strand = rng.choice("+-")
            n = rng.randint(10, len(PROPHAGE_PRODUCTS))
            products = [PROPHAGE_PRODUCTS[0], *rng.sample(PROPHAGE_PRODUCTS[1:], n - 1)]
            elements: list[Element] = []
            for j, (gene, product) in enumerate(products):
                aa = rng.randint(60, 700)
                seq = random_cds(rng, aa + 1, spec.gc - 0.03)
                if j:
                    elements.append(_spacer(rng.randint(15, 120), spec.gc, rng))
                elements.append(
                    Element(T.cds, seq, strand, gene, product, block=f"phage:{key}", prophage=k)
                )
            for e in elements:
                e.block = f"phage:{key}"
                e.prophage = k
            self._phages[key] = elements
        return self._phages[key]

    def _plasmid(self, key: str) -> list[Element]:
        if key in self._plasmids:
            return self._plasmids[key]
        spec = PLASMIDS[key]
        rng = sub_rng(self.seed, "plasmid", key)
        elements: list[Element] = []
        for j, item in enumerate(spec.layout):
            if j:
                elements.append(_spacer(rng.randint(40, 300), spec.gc, rng))
            if isinstance(item, str):
                d = DETERMINANTS[item]
                elements.append(
                    Element(
                        T.cds,
                        self.determinant_seq(item),
                        rng.choice("+-"),
                        d.gene,
                        d.product,
                        determinant=item,
                        category="resistance",
                    )
                )
                continue
            seq = self._gene_seq(f"plasmid:{key}:{j}", _scaled(item.aa_length), spec.gc)
            role = None
            if item.gene == spec.rep_gene:
                role = "rep"
            elif item.gene == spec.relaxase_gene:
                role = "relaxase"
            elif (
                item.category == "plasmid"
                and spec.mpf
                and item.gene
                and item.gene[:3]
                in (
                    "tra",
                    "vir",
                )
            ):
                role = "mpf"
            elements.append(
                Element(
                    T.cds,
                    seq,
                    rng.choice("+-"),
                    item.gene,
                    item.product,
                    category=item.category,
                    plasmid_role=role,
                )
            )
            if role == "relaxase" and spec.has_orit:
                elements.append(_spacer(rng.randint(40, 120), spec.gc, rng))
                elements.append(
                    Element(T.orit, random_dna(rng, 259, spec.gc), "?", None, "origin of transfer")
                )
        self._plasmids[key] = elements
        return elements

    # Genomes ------------------------------------------------------------------------------

    def build(self, plan: GenomePlan) -> Genome:
        rng = sub_rng(self.seed, "genome", plan.genome_id)
        spec = plan.species
        chromosome = self._chromosome(plan, rng)
        replicons: list[tuple[str, list[Element]]] = [("chromosome", chromosome)]
        for key in plan.plasmids:
            replicons.append((key, [_copy(e) for e in self._plasmid(key)]))

        pieces: list[tuple[str, list[Element], bool]] = []
        if plan.complete:
            pieces = [(name, elements, True) for name, elements in replicons]
        else:
            for name, elements in replicons:
                if name == "chromosome":
                    cuts = None if plan.fragmented else rng.randint(10, 30)
                elif name == "pKPC":
                    cuts = 0
                else:
                    cuts = rng.randint(0, 1)
                for part in _split(elements, cuts, rng):
                    pieces.append((name, part, False))
            n_junk = FRAGMENTED_JUNK_CONTIGS if plan.fragmented else rng.randint(2, 8)
            for _ in range(n_junk):
                junk = [_spacer(rng.randint(L.MIN_CONTIG_LENGTH, 520), spec.gc, rng)]
                pieces.append(("junk", junk, False))

        contigs = [_place(name, elements, circular) for name, elements, circular in pieces]
        if plan.complete:
            chrom, rest = contigs[0], contigs[1:]
            rest.sort(key=lambda c: -c.length)
            contigs = [chrom, *rest]
        else:
            order = sorted(range(len(contigs)), key=lambda i: (-contigs[i].length, i))
            contigs = [contigs[i] for i in order]

        for k, c in enumerate(contigs, start=1):
            c.index = k
            c.bakta_id = L.BAKTA.contig_name.format(index=k)
            if plan.complete:
                c.coverage = round(rng.uniform(2.0, 9.0), 2)
                c.assembly_name = str(k)
                if c.is_plasmid:
                    c.plasmid_name = L.BAKTA.plasmid_name.format(index=k - 1)
            else:
                c.coverage = round(rng.uniform(18, 90) * (3 if c.is_plasmid else 1), 6)
                c.assembly_name = L.SPADES.node_name.format(
                    index=k, length=c.length, coverage=f"{c.coverage:.6f}"
                )

        prefix = "".join(rng.choice(string.ascii_uppercase) for _ in range(6))
        suffix = "".join(rng.choice(string.ascii_uppercase) for _ in range(4))
        _assign_identifiers(contigs, prefix, suffix, rng)
        genome = Genome(plan=plan, contigs=contigs, locus_prefix=prefix)
        if plan.complete:
            # Autocycler's consensus before Dnaapler rotated each replicon to its
            # dnaA or rep gene; Bakta annotates the rotated sequence.
            for c in contigs:
                c.rotation = rng.randrange(1, c.length)
        else:
            genome.spades_contigs = _spades_contigs(contigs)
        return genome

    def _chromosome(self, plan: GenomePlan, rng: random.Random) -> list[Element]:
        spec = plan.species
        units: list[list[Element]] = []
        for slot in self._template(spec):
            unit = self._slot_elements(plan, slot, rng)
            if unit:
                units.append(unit)
        if plan.complete:
            units.append(
                [
                    Element(
                        T.oric,
                        self._species_dna(spec, "oriC", 420),
                        "?",
                        None,
                        "origin of replication",
                    )
                ]
            )
        if plan.assembly_gap:
            gap = Element(T.gap, "N" * GAP_LENGTH, ".", None, f"gap ({GAP_LENGTH} bp)")
            units.insert(len(units) // 2, [gap])
        elements: list[Element] = []
        for unit in units:
            if elements:
                elements.append(_spacer(rng.randint(30, 200), spec.gc, rng))
            elements.extend(unit)
        return elements

    def _species_dna(self, spec: SpeciesSpec, key: str, length: int) -> str:
        cache_key = f"dna:{spec.code}:{key}"
        if cache_key not in self._genes:
            self._genes[cache_key] = random_dna(
                sub_rng(self.seed, "dna", spec.code, key), length, spec.gc
            )
        return self._genes[cache_key]

    def _slot_elements(self, plan: GenomePlan, slot: _Slot, rng: random.Random) -> list[Element]:
        spec = plan.species
        strand = slot.strand
        match slot.kind:
            case "core":
                g = self._core_gene(spec, int(slot.key))
                seq = self._gene_seq(f"core:{spec.code}:{slot.key}", _scaled(g.aa_length), spec.gc)
                if slot.key != "0" and rng.random() < 0.2:
                    seq = mutate_cds(seq, rng, 1)
                return [Element(T.cds, seq, strand, g.gene, g.product)]
            case "mutation":
                g = next(m for m in spec.mutation_genes if m.gene == slot.key)
                seq = self._mutation_gene_seq(spec, g, plan.mutations)
                return [Element(T.cds, seq, strand, g.gene, g.product, mutation_gene=g.gene)]
            case "intrinsic":
                if plan.clean:
                    return []
                return self._determinant_unit(spec, slot.key, strand)
            case "optional":
                if slot.key not in plan.chromosomal:
                    return []
                return self._determinant_unit(spec, slot.key, strand)
            case "virulence":
                symbols, _ = spec.virulence[int(slot.key)]
                if not set(symbols) <= set(plan.virulence):
                    return []
                unit: list[Element] = []
                for j, symbol in enumerate(symbols):
                    if j:
                        unit.append(_spacer(40 + 20 * j, spec.gc, rng))
                    d = DETERMINANTS[symbol]
                    unit.append(
                        Element(
                            T.cds,
                            self.determinant_seq(symbol),
                            strand,
                            d.gene,
                            d.product,
                            determinant=symbol,
                        )
                    )
                for e in unit:
                    e.block = f"virulence:{slot.key}"
                return unit
            case "accessory":
                if int(slot.key) not in plan.accessory:
                    return []
                g, seq = self._accessory_gene(spec, int(slot.key))
                return [Element(T.cds, seq, strand, g.gene, g.product)]
            case "prophage":
                if int(slot.key) not in plan.prophages:
                    return []
                return [_copy(e) for e in self._prophage(spec, int(slot.key))]
            case "rna":
                kind, gene, product, length = _RNAS[int(slot.key)]
                if kind == T.sorf:
                    seq = self._gene_seq(f"sorf:{spec.code}", length, spec.gc)
                else:
                    seq = self._species_dna(spec, f"rna{slot.key}", length)
                return [Element(kind, seq, strand, gene, product)]
            case _:
                raise ValueError(slot.kind)

    def _determinant_unit(self, spec: SpeciesSpec, symbol: str, strand: str) -> list[Element]:
        d = DETERMINANTS[symbol]
        gene = Element(
            T.cds,
            self.determinant_seq(symbol),
            strand,
            d.gene,
            d.product,
            determinant=symbol,
            category="resistance",
        )
        promoter = next(
            (m for m in spec.point_mutations if m.is_promoter and symbol.startswith(m.gene)),
            None,
        )
        if promoter is None:
            return [gene]
        # The screened promoter region lies upstream of the gene on the forward strand.
        gene.strand = "+"
        gene.block = f"promoter:{symbol}"
        upstream = Element(
            SPACER, self._species_dna(spec, "promoter", PROMOTER_SPACER), block=gene.block
        )
        return [upstream, gene]


# RNA and small ORF slots: (type, gene, product, length; amino acids for sORFs).
_RNAS: tuple[tuple[str, str | None, str, int], ...] = (
    (T.trna, None, "tRNA-Leu", 85),
    (T.trna, None, "tRNA-Gly", 76),
    (T.trna, None, "tRNA-Ser", 90),
    (T.trna, None, "tRNA-Arg", 77),
    (T.rrna, "rrf", "5S ribosomal RNA", 116),
    (T.rrna, "rrs", "16S ribosomal RNA", 1540),
    (T.tmrna, "ssrA", "transfer-messenger RNA, SsrA", 363),
    (T.ncrna, "ssrS", "6S RNA", 183),
    (T.ncrna, "isrJ", "isrJ Hfq binding RNA", 79),
    (T.ncrna_region, None, "DnaX ribosomal frameshifting element", 65),
    (T.sorf, None, "small protein", 34),
)


def _spacer(length: int, gc: float, rng: random.Random) -> Element:
    return Element(SPACER, random_dna(rng, length, gc))


def _copy(e: Element) -> Element:
    return Element(**vars(e))


def _split(elements: list[Element], cuts: int | None, rng: random.Random) -> list[list[Element]]:
    """Cut at spacers outside blocks; ``cuts=None`` cuts at every such spacer."""
    candidates = [
        i
        for i, e in enumerate(elements)
        if e.kind == SPACER and e.block is None and len(e.seq) >= 20 and 0 < i < len(elements) - 1
    ]
    if cuts is None:
        chosen = candidates
    else:
        chosen = sorted(rng.sample(candidates, min(cuts, len(candidates))))
    pieces: list[list[Element]] = []
    current: list[Element] = []
    for i, e in enumerate(elements):
        if i in chosen:
            h = len(e.seq) // 2
            current.append(Element(SPACER, e.seq[:h]))
            pieces.append(current)
            current = [Element(SPACER, e.seq[h:])]
        else:
            current.append(e)
    pieces.append(current)
    # Merge pieces shorter than the minimum contig length into their neighbor.
    merged: list[list[Element]] = []
    for piece in pieces:
        if merged and sum(len(e.seq) for e in piece) < L.MIN_CONTIG_LENGTH:
            merged[-1].extend(piece)
        else:
            merged.append(piece)
    if len(merged) > 1 and sum(len(e.seq) for e in merged[0]) < L.MIN_CONTIG_LENGTH:
        merged[1] = merged[0] + merged[1]
        merged.pop(0)
    return merged


def _place(replicon: str, elements: list[Element], circular: bool) -> Contig:
    parts: list[str] = []
    features: list[Feature] = []
    regions: dict[int, Region] = {}
    pos = 1
    for e in elements:
        if e.kind != SPACER:
            start, end = pos, pos + len(e.seq) - 1
            f = Feature(
                type=e.kind,
                start=start,
                end=end,
                strand=e.strand,
                seq=e.seq,
                gene=e.gene,
                product=e.product,
                determinant=e.determinant,
                mutation_gene=e.mutation_gene,
                category=e.category,
                prophage=e.prophage,
                plasmid_role=e.plasmid_role,
            )
            if e.kind in CODING_TYPES:
                f.protein = translate(e.seq)
            features.append(f)
            if e.prophage is not None:
                r = regions.get(e.prophage)
                if r is None:
                    regions[e.prophage] = Region(e.prophage, start, end, 1)
                else:
                    r.end = end
                    r.n_genes += 1
        parts.append(reverse_complement(e.seq) if e.strand == "-" else e.seq)
        pos += len(e.seq)
    return Contig(
        seq="".join(parts),
        replicon=replicon,
        circular=circular,
        features=features,
        regions=sorted(regions.values(), key=lambda r: r.start),
    )


def _assign_identifiers(
    contigs: list[Contig], prefix: str, suffix: str, rng: random.Random
) -> None:
    locus = 0
    internal = 0
    for c in contigs:
        for f in c.features:
            if f.type in LOCUS_TAG_TYPES:
                locus += 1
                f.locus_tag = f"{prefix}_{locus:05d}"
            else:
                internal += 1
                f.feature_id = f"{prefix}{suffix}_{internal}"
            if f.type in CODING_TYPES:
                ref = "".join(rng.choice(string.ascii_uppercase + string.digits) for _ in range(6))
                f.dbxrefs = ("SO:0001217", f"UniRef:UniRef50_A0A{ref}", f"UniRef:UniRef90_A0A{ref}")
            elif f.type == T.rrna:
                f.dbxrefs = ("RFAM:RF00001", "SO:0000652")


def _spades_contigs(contigs: list[Contig]) -> list[tuple[str, str]]:
    """The SPAdes contigs file: scaffolds split at runs of N, renamed by length."""
    pieces: list[tuple[str, float]] = []
    for c in contigs:
        for part in c.seq.split("N" * GAP_LENGTH):
            if part:
                pieces.append((part, c.coverage))
    order = sorted(range(len(pieces)), key=lambda i: (-len(pieces[i][0]), i))
    out: list[tuple[str, str]] = []
    for k, i in enumerate(order, start=1):
        seq, cov = pieces[i]
        name = L.SPADES.node_name.format(index=k, length=len(seq), coverage=f"{cov:.6f}")
        out.append((name, seq))
    return out


def point_mutation_carried(plan: GenomePlan, m: PointMutation) -> bool:
    return m.symbol in plan.mutations
