"""Fixed catalog the synthetic generator draws from.

Species, resistance determinants, point mutations, plasmids, prophages and
chromosomal genes. Names and classes follow AMRFinderPlus, CARD, MOB-suite and
the typing tools so the synthetic results read like real ones; sequences are
random and generated per run from the seed (``build``). Nothing here is a
file path or an mgap column name; those come from ``ingest.mgap_layout``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ingest import mgap_layout as L

AMR = L.AMRFINDERPLUS.type_amr
STRESS = L.AMRFINDERPLUS.type_stress
VIRULENCE = L.AMRFINDERPLUS.type_virulence
NA = L.AMRFINDERPLUS.missing
_KC = L.KLEBORATE.columns
_SI = L.SISTR.columns
_SC = L.SCCMEC.columns


@dataclass(frozen=True)
class RgiHit:
    """How RGI reports a determinant (CARD model)."""

    best_hit_aro: str
    aro: str
    drug_class: str
    mechanism: str
    family: str
    antibiotic: str
    model_type: str = L.RGI.model_protein_homolog


@dataclass(frozen=True)
class Determinant:
    """A gene reported by AMRFinderPlus (resistance, stress or virulence)."""

    symbol: str
    name: str
    type: str
    subtype: str
    drug_class: str
    subclass: str
    aa_length: int
    product: str
    gene: str | None = None
    scope: str = "core"
    method: str = "EXACTP"
    accession: str = ""
    gc: float = 0.5
    rgi: RgiHit | None = None


def _d(
    symbol: str,
    name: str,
    drug_class: str,
    subclass: str,
    aa: int,
    *,
    type: str = AMR,
    subtype: str = L.AMRFINDERPLUS.subtype_amr,
    gene: str | None = None,
    product: str | None = None,
    scope: str = "core",
    method: str = "EXACTP",
    accession: str = "",
    gc: float = 0.5,
    rgi: RgiHit | None = None,
) -> Determinant:
    return Determinant(
        symbol=symbol,
        name=name,
        type=type,
        subtype=subtype,
        drug_class=drug_class,
        subclass=subclass,
        aa_length=aa,
        product=product or name,
        gene=gene,
        scope=scope,
        method=method,
        accession=accession,
        gc=gc,
        rgi=rgi,
    )


_INACT = "antibiotic inactivation"
_EFFLUX = "antibiotic efflux"
_TARGET = "antibiotic target alteration"
_REPLACE = "antibiotic target replacement"
_PROTECT = "antibiotic target protection"

DETERMINANTS: dict[str, Determinant] = {
    d.symbol: d
    for d in (
        # Carbapenemases
        _d(
            "blaKPC-2",
            "carbapenem-hydrolyzing class A beta-lactamase KPC-2",
            "BETA-LACTAM",
            "CARBAPENEM",
            293,
            gene="blaKPC",
            method="ALLELEP",
            accession="WP_004199234.1",
            gc=0.62,
            rgi=RgiHit(
                "KPC-2",
                "3002312",
                "carbapenem; cephalosporin; penam",
                _INACT,
                "KPC beta-lactamase",
                "imipenem; meropenem",
            ),
        ),
        _d(
            "blaNDM-1",
            "subclass B1 metallo-beta-lactamase NDM-1",
            "BETA-LACTAM",
            "CARBAPENEM",
            270,
            gene="blaNDM",
            method="ALLELEP",
            accession="WP_004201164.1",
            gc=0.57,
            rgi=RgiHit(
                "NDM-1",
                "3000589",
                "carbapenem; cephalosporin; penam",
                _INACT,
                "NDM beta-lactamase",
                "imipenem; meropenem",
            ),
        ),
        _d(
            "blaOXA-23",
            "carbapenem-hydrolyzing class D beta-lactamase OXA-23",
            "BETA-LACTAM",
            "CARBAPENEM",
            273,
            gene="blaOXA",
            method="ALLELEP",
            accession="WP_001046004.1",
            gc=0.38,
            rgi=RgiHit(
                "OXA-23",
                "3001409",
                "carbapenem; cephalosporin; penam",
                _INACT,
                "OXA-51-like beta-lactamase",
                "imipenem",
            ),
        ),
        # Extended-spectrum and other beta-lactamases
        _d(
            "blaCTX-M-15",
            "class A extended-spectrum beta-lactamase CTX-M-15",
            "BETA-LACTAM",
            "CEPHALOSPORIN",
            291,
            gene="blaCTX-M",
            method="ALLELEP",
            accession="WP_000239590.1",
            gc=0.53,
            rgi=RgiHit(
                "CTX-M-15",
                "3001878",
                "cephalosporin",
                _INACT,
                "CTX-M beta-lactamase",
                "ceftazidime; cefotaxime",
            ),
        ),
        _d(
            "blaSHV-11",
            "broad-spectrum class A beta-lactamase SHV-11",
            "BETA-LACTAM",
            "BETA-LACTAM",
            286,
            gene="blaSHV",
            method="ALLELEP",
            accession="WP_004176269.1",
            gc=0.60,
            rgi=RgiHit(
                "SHV-11",
                "3001070",
                "carbapenem; cephalosporin; penam",
                _INACT,
                "SHV beta-lactamase",
                "ampicillin",
            ),
        ),
        _d(
            "blaOXA-1",
            "class D beta-lactamase OXA-1",
            "BETA-LACTAM",
            "CEPHALOSPORIN",
            276,
            gene="blaOXA",
            method="ALLELEP",
            accession="WP_001334766.1",
            gc=0.42,
            rgi=RgiHit(
                "OXA-1",
                "3001396",
                "cephalosporin; penam",
                _INACT,
                "OXA beta-lactamase",
                "ampicillin",
            ),
        ),
        _d(
            "blaZ",
            "penicillin-hydrolyzing class A beta-lactamase BlaZ",
            "BETA-LACTAM",
            "PENICILLIN",
            281,
            gene="blaZ",
            method="BLASTP",
            accession="WP_000733283.1",
            gc=0.31,
            rgi=RgiHit(
                "PC1 beta-lactamase (blaZ)",
                "3000579",
                "penam",
                _INACT,
                "blaZ beta-lactamase",
                "penicillin",
            ),
        ),
        _d(
            "mecA",
            "PBP2a family beta-lactam-resistant peptidoglycan transpeptidase MecA",
            "BETA-LACTAM",
            "METHICILLIN",
            668,
            gene="mecA",
            accession="WP_000725529.1",
            gc=0.32,
            rgi=RgiHit(
                "mecA",
                "3000617",
                "cephalosporin; penam; carbapenem",
                _REPLACE,
                "methicillin resistant PBP2",
                "methicillin",
            ),
        ),
        _d(
            "blaEC-5",
            "class C beta-lactamase EC-5",
            "BETA-LACTAM",
            "CEPHALOSPORIN",
            377,
            gene="blaEC",
            method="ALLELEP",
            accession="WP_000976514.1",
            gc=0.52,
        ),
        _d(
            "blaPDC-3",
            "class C beta-lactamase PDC-3",
            "BETA-LACTAM",
            "CEPHALOSPORIN",
            397,
            gene="blaPDC",
            method="ALLELEP",
            accession="WP_003091335.1",
            gc=0.66,
        ),
        _d(
            "blaADC-25",
            "class C beta-lactamase ADC-25",
            "BETA-LACTAM",
            "CEPHALOSPORIN",
            383,
            gene="blaADC",
            method="ALLELEP",
            accession="WP_000778180.1",
            gc=0.40,
        ),
        _d(
            "blaOXA-66",
            "OXA-51 family carbapenem-hydrolyzing class D beta-lactamase OXA-66",
            "BETA-LACTAM",
            "BETA-LACTAM",
            274,
            gene="blaOXA",
            method="ALLELEP",
            accession="WP_001021784.1",
            gc=0.38,
        ),
        _d(
            "blaACT-15",
            "class C beta-lactamase ACT-15",
            "BETA-LACTAM",
            "CEPHALOSPORIN",
            381,
            gene="blaACT",
            method="ALLELEP",
            accession="WP_063860634.1",
            gc=0.56,
        ),
        _d(
            "blaSRT-2",
            "class C beta-lactamase SRT-2",
            "BETA-LACTAM",
            "CEPHALOSPORIN",
            378,
            gene="blaSRT",
            method="ALLELEP",
            accession="WP_025302429.1",
            gc=0.58,
        ),
        # Colistin
        _d(
            "mcr-1.1",
            "phosphoethanolamine--lipid A transferase MCR-1.1",
            "COLISTIN",
            "COLISTIN",
            541,
            gene="mcr-1",
            method="ALLELEP",
            accession="WP_049589868.1",
            gc=0.49,
            rgi=RgiHit(
                "MCR-1.1",
                "3003689",
                "peptide antibiotic",
                _TARGET,
                "MCR phosphoethanolamine transferase",
                "colistin",
            ),
        ),
        # Aminoglycosides
        _d(
            "aac(6')-Ib-cr5",
            "fluoroquinolone-acetylating aminoglycoside 6'-N-acetyltransferase AAC(6')-Ib-cr5",
            "AMINOGLYCOSIDE/QUINOLONE",
            "AMIKACIN/KANAMYCIN/QUINOLONE/TOBRAMYCIN",
            199,
            gene="aac(6')-Ib-cr",
            method="ALLELEX",
            accession="WP_063840321.1",
            gc=0.49,
            rgi=RgiHit(
                "AAC(6')-Ib-cr6",
                "3002547",
                "fluoroquinolone antibiotic; aminoglycoside antibiotic",
                _INACT,
                "AAC(6')",
                "ciprofloxacin; amikacin",
            ),
        ),
        _d(
            "aac(6')-Iaa",
            "aminoglycoside 6'-N-acetyltransferase AAC(6')-Iaa",
            "AMINOGLYCOSIDE",
            "AMINOGLYCOSIDE",
            145,
            gene="aac(6')-Iaa",
            accession="WP_001082319.1",
            gc=0.52,
            rgi=RgiHit(
                "AAC(6')-Iy",
                "3002567",
                "aminoglycoside antibiotic",
                _INACT,
                "AAC(6')",
                "tobramycin",
            ),
        ),
        _d(
            "aac(6')-Ic",
            "aminoglycoside 6'-N-acetyltransferase AAC(6')-Ic",
            "AMINOGLYCOSIDE",
            "AMINOGLYCOSIDE",
            146,
            gene="aac(6')-Ic",
            accession="WP_004932596.1",
            gc=0.58,
        ),
        _d(
            "aac(6')-Ii",
            "aminoglycoside 6'-N-acetyltransferase AAC(6')-Ii",
            "AMINOGLYCOSIDE",
            "AMINOGLYCOSIDE",
            182,
            gene="aac(6')-Ii",
            accession="WP_002286801.1",
            gc=0.38,
        ),
        _d(
            "aph(3')-IIb",
            "aminoglycoside O-phosphotransferase APH(3')-IIb",
            "AMINOGLYCOSIDE",
            "KANAMYCIN",
            268,
            gene="aph(3')-IIb",
            accession="WP_003090422.1",
            gc=0.66,
        ),
        # Quinolones, fosfomycin, phenicols
        _d(
            "oqxA",
            "multidrug efflux RND transporter periplasmic adaptor subunit OqxA",
            "PHENICOL/QUINOLONE",
            "PHENICOL/QUINOLONE",
            391,
            gene="oqxA",
            accession="WP_002914189.1",
            gc=0.58,
        ),
        _d(
            "fosA",
            "FosA5 family fosfomycin resistance glutathione transferase",
            "FOSFOMYCIN",
            "FOSFOMYCIN",
            139,
            gene="fosA",
            method="BLASTP",
            accession="WP_004146118.1",
            gc=0.58,
            rgi=RgiHit(
                "FosA6",
                "3004111",
                "phosphonic acid antibiotic",
                _INACT,
                "fosfomycin thiol transferase",
                "fosfomycin",
            ),
        ),
        _d(
            "catB3",
            "type B-3 chloramphenicol O-acetyltransferase CatB3",
            "PHENICOL",
            "CHLORAMPHENICOL",
            210,
            gene="catB3",
            method="PARTIALX",
            accession="WP_000186237.1",
            gc=0.46,
        ),
        _d(
            "catB7",
            "type B-7 chloramphenicol O-acetyltransferase CatB7",
            "PHENICOL",
            "CHLORAMPHENICOL",
            212,
            gene="catB7",
            accession="WP_003088911.1",
            gc=0.64,
        ),
        _d(
            "floR",
            "chloramphenicol/florfenicol efflux MFS transporter FloR",
            "PHENICOL",
            "CHLORAMPHENICOL/FLORFENICOL",
            404,
            gene="floR",
            accession="WP_000122075.1",
            gc=0.58,
        ),
        # Tetracyclines, sulfonamides, trimethoprim, macrolides
        _d(
            "tet(A)",
            "tetracycline efflux MFS transporter Tet(A)",
            "TETRACYCLINE",
            "TETRACYCLINE",
            399,
            gene="tet(A)",
            accession="WP_000804064.1",
            gc=0.57,
            rgi=RgiHit(
                "tet(A)",
                "3000165",
                "tetracycline antibiotic",
                _EFFLUX,
                "major facilitator superfamily (MFS) antibiotic efflux pump",
                "tetracycline",
            ),
        ),
        _d(
            "tet(K)",
            "tetracycline efflux MFS transporter Tet(K)",
            "TETRACYCLINE",
            "TETRACYCLINE",
            459,
            gene="tet(K)",
            accession="WP_001553776.1",
            gc=0.30,
        ),
        _d(
            "tet(M)",
            "tetracycline resistance ribosomal protection protein Tet(M)",
            "TETRACYCLINE",
            "TETRACYCLINE",
            639,
            gene="tet(M)",
            accession="WP_002586647.1",
            gc=0.36,
            rgi=RgiHit(
                "tetM",
                "3000186",
                "tetracycline antibiotic",
                _PROTECT,
                "tetracycline-resistant ribosomal protection protein",
                "tetracycline",
            ),
        ),
        _d(
            "sul1",
            "sulfonamide-resistant dihydropteroate synthase Sul1",
            "SULFONAMIDE",
            "SULFONAMIDE",
            279,
            gene="sul1",
            accession="WP_000259031.1",
            gc=0.62,
            rgi=RgiHit(
                "sul1",
                "3000410",
                "sulfonamide antibiotic",
                _REPLACE,
                "sulfonamide resistant sul",
                "sulfamethoxazole",
            ),
        ),
        _d(
            "sul2",
            "sulfonamide-resistant dihydropteroate synthase Sul2",
            "SULFONAMIDE",
            "SULFONAMIDE",
            271,
            gene="sul2",
            accession="WP_001043265.1",
            gc=0.61,
        ),
        _d(
            "dfrA14",
            "trimethoprim-resistant dihydrofolate reductase DfrA14",
            "TRIMETHOPRIM",
            "TRIMETHOPRIM",
            157,
            gene="dfrA14",
            method="EXACTX",
            accession="WP_000339383.1",
            gc=0.47,
        ),
        _d(
            "erm(B)",
            "23S rRNA (adenine(2058)-N(6))-methyltransferase Erm(B)",
            "LINCOSAMIDE/MACROLIDE/STREPTOGRAMIN",
            "LINCOSAMIDE/MACROLIDE/STREPTOGRAMIN",
            245,
            gene="erm(B)",
            accession="WP_001038790.1",
            gc=0.34,
        ),
        _d(
            "erm(C)",
            "23S rRNA (adenine(2058)-N(6))-methyltransferase Erm(C)",
            "LINCOSAMIDE/MACROLIDE/STREPTOGRAMIN",
            "LINCOSAMIDE/MACROLIDE/STREPTOGRAMIN",
            244,
            gene="erm(C)",
            accession="WP_001003263.1",
            gc=0.31,
        ),
        _d(
            "msr(C)",
            "ABC-F type ribosomal protection protein Msr(C)",
            "MACROLIDE",
            "ERYTHROMYCIN/STREPTOGRAMIN B",
            492,
            gene="msr(C)",
            accession="WP_002287878.1",
            gc=0.36,
        ),
        _d(
            "vanA",
            "D-alanine--(R)-lactate ligase VanA",
            "GLYCOPEPTIDE",
            "VANCOMYCIN",
            343,
            gene="vanA",
            accession="WP_000033999.1",
            gc=0.45,
            rgi=RgiHit(
                "vanA",
                "3000010",
                "glycopeptide antibiotic",
                _TARGET,
                "glycopeptide resistance gene cluster",
                "vancomycin",
            ),
        ),
        _d(
            "ble",
            "bleomycin binding protein Ble-MBL",
            "BLEOMYCIN",
            "BLEOMYCIN",
            121,
            gene="ble",
            accession="WP_004201167.1",
            gc=0.60,
        ),
        # Stress
        _d(
            "qacEdelta1",
            "quaternary ammonium compound efflux SMR transporter QacE delta 1",
            "QUATERNARY AMMONIUM",
            "QUATERNARY AMMONIUM",
            115,
            type=STRESS,
            subtype=L.AMRFINDERPLUS.subtype_biocide,
            gene="qacE",
            scope="plus",
            method="ALLELEP",
            accession="WP_000679427.1",
            gc=0.55,
        ),
        _d(
            "arsC",
            "glutaredoxin-dependent arsenate reductase",
            "ARSENIC",
            "ARSENATE",
            141,
            type=STRESS,
            subtype=L.AMRFINDERPLUS.subtype_metal,
            gene="arsC",
            scope="plus",
            accession="AAA21096.1",
            gc=0.52,
        ),
        _d(
            "arsR",
            "arsenical resistance operon transcriptional regulator ArsR",
            "ARSENIC",
            "ARSENIC",
            117,
            type=STRESS,
            subtype=L.AMRFINDERPLUS.subtype_metal,
            gene="arsR",
            scope="plus",
            accession="WP_000429868.1",
            gc=0.52,
        ),
        _d(
            "cadA",
            "cadmium-translocating P-type ATPase CadA",
            "CADMIUM",
            "CADMIUM",
            727,
            type=STRESS,
            subtype=L.AMRFINDERPLUS.subtype_metal,
            gene="cadA",
            scope="plus",
            method="BLASTP",
            accession="WP_000240521.1",
            gc=0.32,
        ),
        # Virulence
        _d(
            "ybtP",
            "yersiniabactin ABC transporter ATP-binding/permease protein YbtP",
            NA,
            NA,
            600,
            type=VIRULENCE,
            subtype=L.AMRFINDERPLUS.subtype_virulence,
            gene="ybtP",
            scope="plus",
            method="BLASTP",
            accession="WP_002904004.1",
            gc=0.58,
        ),
        _d(
            "ybtQ",
            "yersiniabactin ABC transporter ATP-binding/permease protein YbtQ",
            NA,
            NA,
            600,
            type=VIRULENCE,
            subtype=L.AMRFINDERPLUS.subtype_virulence,
            gene="ybtQ",
            scope="plus",
            method="BLASTP",
            accession="WP_002904006.1",
            gc=0.58,
        ),
        _d(
            "iucA",
            "aerobactin synthase IucA",
            NA,
            NA,
            594,
            type=VIRULENCE,
            subtype=L.AMRFINDERPLUS.subtype_virulence,
            gene="iucA",
            scope="plus",
            accession="WP_004213050.1",
            gc=0.54,
        ),
        _d(
            "lukF-PV",
            "Panton-Valentine leukocidin subunit F",
            NA,
            NA,
            325,
            type=VIRULENCE,
            subtype=L.AMRFINDERPLUS.subtype_virulence,
            gene="lukF-PV",
            scope="plus",
            accession="WP_000791404.1",
            gc=0.30,
        ),
        _d(
            "lukS-PV",
            "Panton-Valentine leukocidin subunit S",
            NA,
            NA,
            312,
            type=VIRULENCE,
            subtype=L.AMRFINDERPLUS.subtype_virulence,
            gene="lukS-PV",
            scope="plus",
            accession="WP_000239620.1",
            gc=0.30,
        ),
        _d(
            "sea",
            "staphylococcal enterotoxin type A",
            NA,
            NA,
            257,
            type=VIRULENCE,
            subtype=L.AMRFINDERPLUS.subtype_virulence,
            gene="sea",
            scope="plus",
            accession="WP_000750419.1",
            gc=0.31,
        ),
        _d(
            "iss",
            "increased serum survival lipoprotein Iss",
            NA,
            NA,
            102,
            type=VIRULENCE,
            subtype=L.AMRFINDERPLUS.subtype_virulence,
            gene="iss",
            scope="plus",
            accession="WP_000845953.1",
            gc=0.49,
        ),
    )
}


@dataclass(frozen=True)
class PointMutation:
    """A resistance point mutation screened by AMRFinderPlus in a core gene."""

    gene: str
    variant: str
    element_name: str
    drug_class: str
    subclass: str
    accession: str
    wildtype: str  # variant string at the same position when wild type

    @property
    def symbol(self) -> str:
        return L.AMRFINDERPLUS.point_symbol.format(gene=self.gene, variant=self.variant)

    @property
    def is_promoter(self) -> bool:
        return "-" in self.variant


@dataclass(frozen=True)
class GeneSpec:
    """A non-determinant gene: symbol (or None), product, protein length, category."""

    gene: str | None
    product: str
    aa_length: int
    category: str = "other"  # other, is (transposase or IS), plasmid (replication, transfer)


def _g(gene: str | None, product: str, aa: int, category: str = "other") -> GeneSpec:
    return GeneSpec(gene, product, aa, category)


# Chromosomal genes shared by every species; sequences differ per species.
CORE_GENES: tuple[GeneSpec, ...] = (
    _g("dnaA", "chromosomal replication initiator protein DnaA", 467),
    _g("dnaN", "DNA polymerase III subunit beta", 366),
    _g("recF", "DNA replication and repair protein RecF", 357),
    _g("gyrB", "DNA topoisomerase (ATP-hydrolyzing) subunit B", 804),
    _g("recA", "recombinase RecA", 353),
    _g("rpoA", "DNA-directed RNA polymerase subunit alpha", 329),
    _g("rpoD", "RNA polymerase sigma factor RpoD", 613),
    _g("tufA", "elongation factor Tu", 394),
    _g("fusA", "elongation factor G", 704),
    _g("tsf", "translation elongation factor Ts", 283),
    _g("rplB", "50S ribosomal protein L2", 273),
    _g("rplC", "50S ribosomal protein L3", 209),
    _g("rplD", "50S ribosomal protein L4", 201),
    _g("rpsB", "30S ribosomal protein S2", 241),
    _g("rpsC", "30S ribosomal protein S3", 233),
    _g("gapA", "glyceraldehyde-3-phosphate dehydrogenase", 331),
    _g("pgi", "glucose-6-phosphate isomerase", 549),
    _g("mdh", "malate dehydrogenase", 312),
    _g("pgk", "phosphoglycerate kinase", 387),
    _g("eno", "phosphopyruvate hydratase", 432),
    _g("gltA", "citrate synthase", 427),
    _g("icd", "NADP-dependent isocitrate dehydrogenase", 416),
    _g("atpA", "F0F1 ATP synthase subunit alpha", 513),
    _g("atpD", "F0F1 ATP synthase subunit beta", 460),
    _g("ftsZ", "cell division protein FtsZ", 383),
    _g("ftsA", "cell division protein FtsA", 420),
    _g("murA", "UDP-N-acetylglucosamine 1-carboxyvinyltransferase", 419),
    _g("secY", "preprotein translocase subunit SecY", 443),
    _g("groL", "chaperonin GroEL", 548),
    _g("dnaK", "molecular chaperone DnaK", 638),
    _g("mutL", "DNA mismatch repair endonuclease MutL", 615),
    _g("ligA", "NAD-dependent DNA ligase LigA", 671),
    _g("aroC", "chorismate synthase", 361),
    _g("aroE", "shikimate dehydrogenase", 272),
    _g("purA", "adenylosuccinate synthase", 432),
    _g("purE", "5-(carboxyamino)imidazole ribonucleotide mutase", 169),
    _g("hisD", "histidinol dehydrogenase", 434),
    _g("guaA", "glutamine-hydrolyzing GMP synthase", 525),
    _g("pyrG", "CTP synthase", 545),
    _g("glyA", "serine hydroxymethyltransferase", 417),
    _g("metK", "methionine adenosyltransferase", 384),
    _g("folP", "dihydropteroate synthase", 282),
    _g(None, "hypothetical protein", 118),
    _g(None, "DUF1471 domain-containing protein", 92),
    _g(None, "hypothetical protein", 204),
    _g(None, "YbaB/EbfC family nucleoid-associated protein", 109),
)

GRAM_NEGATIVE_CORE: tuple[GeneSpec, ...] = (
    _g("acrA", "multidrug efflux RND transporter periplasmic adaptor subunit AcrA", 397),
    _g("tolC", "outer membrane channel protein TolC", 493),
    _g("ompA", "outer membrane protein OmpA", 356),
    _g("lpxC", "UDP-3-O-acyl-N-acetylglucosamine deacetylase", 305),
)

# Accessory products drawn per species into a pool; each genome carries part of it.
ACCESSORY_PRODUCTS: tuple[tuple[str | None, str], ...] = (
    (None, "hypothetical protein"),
    (None, "hypothetical protein"),
    (None, "hypothetical protein"),
    (None, "DUF4198 domain-containing protein"),
    (None, "LysR family transcriptional regulator"),
    (None, "MFS transporter"),
    (None, "ABC transporter ATP-binding protein"),
    (None, "TonB-dependent receptor"),
    (None, "GNAT family N-acetyltransferase"),
    (None, "helix-turn-helix domain-containing protein"),
    ("fimA", "type 1 fimbrial major subunit FimA"),
    ("fimC", "type 1 fimbria chaperone FimC"),
    ("ldcC", "lysine decarboxylase LdcC"),
    ("iolE", "myo-inosose-2 dehydratase"),
    ("rbsB", "ribose ABC transporter substrate-binding protein RbsB"),
    ("mviM", "Gfo/Idh/MocA family oxidoreductase"),
    ("ccmA", "heme ABC exporter ATP-binding protein CcmA"),
    ("yjdL", "dipeptide/tripeptide permease YjdL"),
    ("hsdR", "type I restriction-modification system endonuclease HsdR"),
    ("hsdM", "type I restriction-modification system DNA methyltransferase HsdM"),
    (None, "restriction endonuclease subunit S"),
    (None, "toxin-antitoxin system HicB family antitoxin"),
    (None, "type II toxin-antitoxin system RelE/ParE family toxin"),
)

PROPHAGE_PRODUCTS: tuple[tuple[str | None, str], ...] = (
    ("int", "tyrosine-type recombinase/integrase"),
    (None, "phage repressor protein CI"),
    (None, "phage antirepressor KilAC domain-containing protein"),
    (None, "phage terminase large subunit"),
    (None, "phage terminase small subunit"),
    (None, "phage portal protein"),
    (None, "phage major capsid protein"),
    (None, "phage head-tail connector protein"),
    (None, "phage tail tape measure protein"),
    (None, "phage tail fiber protein"),
    (None, "phage holin"),
    (None, "endolysin"),
    (None, "hypothetical protein"),
    (None, "hypothetical protein"),
)

VIRUS_TAXONOMY = "Viruses;Duplodnaviria;Heunggongvirae;Uroviricota;Caudoviricetes;;"


# Plasmids ------------------------------------------------------------------------------


@dataclass(frozen=True)
class PlasmidSpec:
    """A plasmid backbone with its cargo, identical in every genome that carries it.

    ``layout`` lists genes and determinant symbols (strings) in order; the
    MOB-suite and geNomad fields describe how those tools report it.
    """

    key: str
    layout: tuple[GeneSpec | str, ...]
    replicons: tuple[str, ...]
    rep_accessions: tuple[str, ...]
    relaxases: tuple[str, ...]
    relaxase_accessions: tuple[str, ...]
    mpf: str | None
    mobility: str
    primary_cluster: str
    secondary_cluster: str
    mash_neighbor: str
    mash_distance: float
    mash_identification: str
    host_range: tuple[str, str]
    conjugation_genes: tuple[str, ...]
    gc: float
    has_orit: bool = False
    # Genes whose products belong to the replicon (the rep gene carries rep_type).
    rep_gene: str = "repA"
    relaxase_gene: str | None = None


_TRA_F = (
    _g("traM", "conjugal transfer relaxosome protein TraM", 127, "plasmid"),
    _g("traJ", "conjugal transfer transcriptional regulator TraJ", 229, "plasmid"),
    _g("traY", "conjugal transfer relaxosome protein TraY", 75, "plasmid"),
    _g("traA", "conjugal transfer pilin TraA", 121, "plasmid"),
    _g("traL", "conjugal transfer pilus assembly protein TraL", 91, "plasmid"),
    _g("traE", "conjugal transfer pilus assembly protein TraE", 188, "plasmid"),
    _g("traK", "conjugal transfer pilus assembly protein TraK", 242, "plasmid"),
    _g("traB", "conjugal transfer pilus assembly protein TraB", 475, "plasmid"),
    _g("traV", "conjugal transfer pilus assembly protein TraV", 171, "plasmid"),
    _g("traC", "conjugal transfer ATPase TraC", 875, "plasmid"),
    _g("traW", "conjugal transfer pilus assembly protein TraW", 210, "plasmid"),
    _g("traU", "conjugal transfer pilus assembly protein TraU", 330, "plasmid"),
    _g("traN", "conjugal transfer mating-pair stabilization protein TraN", 602, "plasmid"),
    _g("traF", "conjugal transfer pilus assembly protein TraF", 247, "plasmid"),
    _g("traH", "conjugal transfer pilus assembly protein TraH", 458, "plasmid"),
    _g("traG", "conjugal transfer mating-pair stabilization protein TraG", 900, "plasmid"),
    _g("traD", "type IV conjugative transfer system coupling protein TraD", 736, "plasmid"),
    _g("traI", "conjugative transfer relaxase/helicase TraI", 900, "plasmid"),
    _g("traX", "type-F conjugative transfer system pilin acetylase TraX", 248, "plasmid"),
    _g("finO", "fertility inhibition protein FinO", 186, "plasmid"),
)
_REP_F = (
    _g("repA", "IncFII family plasmid replication initiator RepA", 285, "plasmid"),
    _g("repB", "plasmid replication protein RepB", 150, "plasmid"),
    _g("parA", "ParA family protein", 213, "plasmid"),
    _g("parB", "ParB/RepB/Spo0J family partition protein", 320, "plasmid"),
    _g("psiB", "plasmid SOS inhibition protein PsiB", 144, "plasmid"),
    _g("ssb", "single-stranded DNA-binding protein", 178, "plasmid"),
)
_HYP = _g(None, "hypothetical protein", 146)
_HYP2 = _g(None, "hypothetical protein", 97)

PLASMIDS: dict[str, PlasmidSpec] = {
    p.key: p
    for p in (
        # Tn4401 carrying blaKPC-2 between ISKpn7 and ISKpn6, on a pKpQIL-like backbone.
        PlasmidSpec(
            key="pKPC",
            layout=(
                *_REP_F,
                _g("klcA", "antirestriction protein KlcA", 141),
                _g("ardA", "antirestriction protein ArdA", 166),
                _HYP,
                _g("tnpR", "Tn3 family resolvase TnpR", 186, "is"),
                _g("tnpA", "Tn3 family transposase TnpA", 1006, "is"),
                _g("istA", "IS21 family transposase ISKpn7", 509, "is"),
                _g("istB", "IS21-like element ISKpn7 helper ATPase IstB", 262, "is"),
                "blaKPC-2",
                _g(None, "IS1182 family transposase ISKpn6", 429, "is"),
                _HYP2,
                *_TRA_F,
            ),
            replicons=("IncFIB(pQil)", "IncFII(K)"),
            rep_accessions=("000139__JN233705", "000124__KP125893_00142"),
            relaxases=("MOBF",),
            relaxase_accessions=("NC_014312_00116",),
            mpf="MPF_F",
            mobility="conjugative",
            primary_cluster="AA738",
            secondary_cluster="AI083",
            mash_neighbor="CP011647",
            mash_distance=0.00121,
            mash_identification="Klebsiella pneumoniae",
            host_range=("order", "Enterobacterales"),
            conjugation_genes=("F_traL", "F_traE", "F_traK", "F_traV", "F_traU", "MOBF"),
            gc=0.53,
            has_orit=True,
            relaxase_gene="traI",
        ),
        # IncFII plasmid with an ISEcp1-blaCTX-M-15 unit and a class 1 integron.
        PlasmidSpec(
            key="pESBL",
            layout=(
                *_REP_F[:4],
                _HYP,
                _g(None, "IS1380-like element ISEcp1 family transposase", 420, "is"),
                "blaCTX-M-15",
                _g("wbuC", "cupin fold metalloprotein WbuC", 150),
                _g(None, "IS6-like element IS26 family transposase", 234, "is"),
                "blaOXA-1",
                "catB3",
                "aac(6')-Ib-cr5",
                _g("intI1", "class 1 integron integrase IntI1", 337, "is"),
                "qacEdelta1",
                "sul1",
                _g(None, "IS6-like element IS26 family transposase", 234, "is"),
                "arsR",
                "arsC",
                _HYP2,
                *_TRA_F[:12],
                _TRA_F[-1],
            ),
            replicons=("IncFII",),
            rep_accessions=("000125__AY458016",),
            relaxases=("MOBF",),
            relaxase_accessions=("CP035180_00077",),
            mpf="MPF_F",
            mobility="conjugative",
            primary_cluster="AA329",
            secondary_cluster="AJ451",
            mash_neighbor="CP010390",
            mash_distance=0.00178,
            mash_identification="Klebsiella pneumoniae",
            host_range=("order", "Enterobacterales"),
            conjugation_genes=("F_traL", "F_traE", "F_traK", "MOBF"),
            gc=0.52,
            has_orit=True,
            relaxase_gene="traC",
        ),
        # IncX4 plasmid with mcr-1.1.
        PlasmidSpec(
            key="pMCR",
            layout=(
                _g("pir", "replication initiation protein Pir", 305, "plasmid"),
                _g("bis", "DNA-binding protein Bis", 120, "plasmid"),
                _HYP,
                "mcr-1.1",
                _g(None, "PAP2 family lipid A phosphatase", 213),
                _g("hns", "H-NS family nucleoid-associated regulatory protein", 137),
                _g("taxC", "conjugal transfer relaxase TaxC", 380, "plasmid"),
                _g("virB1", "type IV secretion system protein VirB1", 190, "plasmid"),
                _g("virB2", "type IV secretion system protein VirB2", 110, "plasmid"),
                _g("virB4", "type IV secretion system protein VirB4", 800, "plasmid"),
                _g("virB5", "type IV secretion system protein VirB5", 240, "plasmid"),
                _g("virB6", "type IV secretion system protein VirB6", 330, "plasmid"),
                _g("virB8", "type IV secretion system protein VirB8", 230, "plasmid"),
                _g("virB9", "type IV secretion system protein VirB9", 290, "plasmid"),
                _g("virB10", "type IV secretion system protein VirB10", 390, "plasmid"),
                _g("virB11", "type IV secretion system protein VirB11", 330, "plasmid"),
                _g("virD4", "type IV secretion system coupling protein VirD4", 600, "plasmid"),
                _HYP2,
            ),
            replicons=("IncX4",),
            rep_accessions=("000331__CP015977",),
            relaxases=("MOBP",),
            relaxase_accessions=("NC_013090_00004",),
            mpf="MPF_T",
            mobility="conjugative",
            primary_cluster="AB942",
            secondary_cluster="AK207",
            mash_neighbor="KX772778",
            mash_distance=0.00089,
            mash_identification="Escherichia coli",
            host_range=("order", "Enterobacterales"),
            conjugation_genes=("T_virB4", "T_virB9", "T_virB10", "T_virB11", "MOBP"),
            gc=0.42,
            rep_gene="pir",
            relaxase_gene="taxC",
        ),
        # Small ColRNAI plasmid without cargo.
        PlasmidSpec(
            key="pCol",
            layout=(
                _g("mobA", "MobA/MobL family protein", 300, "plasmid"),
                _g("mobC", "plasmid mobilization relaxosome protein MobC", 110, "plasmid"),
                _g("rop", "plasmid copy number control protein Rop", 63, "plasmid"),
                _HYP2,
            ),
            replicons=("ColRNAI",),
            rep_accessions=("000186__JX566770",),
            relaxases=("MOBP",),
            relaxase_accessions=("CP000974_00005",),
            mpf=None,
            mobility="mobilizable",
            primary_cluster="AB189",
            secondary_cluster="AJ838",
            mash_neighbor="CP039972",
            mash_distance=0.01207,
            mash_identification="Klebsiella pneumoniae",
            host_range=("order", "Enterobacterales"),
            conjugation_genes=("MOBP",),
            gc=0.50,
            rep_gene="rop",
            relaxase_gene="mobA",
        ),
        # Staphylococcal blaZ and cadmium plasmid.
        PlasmidSpec(
            key="pBlaZ",
            layout=(
                _g("repA", "plasmid replication initiator protein", 330, "plasmid"),
                _HYP,
                _g("blaI", "penicillinase repressor BlaI", 126),
                _g("blaR1", "beta-lactam sensor/signal transducer BlaR1", 585),
                "blaZ",
                _g(None, "IS6-like element IS257 family transposase", 224, "is"),
                "cadA",
                _g("cadC", "cadmium resistance transcriptional regulator CadC", 122),
                _HYP2,
            ),
            replicons=("rep5a",),
            rep_accessions=("000277__CP002121",),
            relaxases=(),
            relaxase_accessions=(),
            mpf=None,
            mobility="non-mobilizable",
            primary_cluster="AB604",
            secondary_cluster="AL118",
            mash_neighbor="CP002121",
            mash_distance=0.00410,
            mash_identification="Staphylococcus aureus",
            host_range=("genus", "Staphylococcus"),
            conjugation_genes=(),
            gc=0.30,
        ),
        # Small staphylococcal tet(K) plasmid.
        PlasmidSpec(
            key="pTetK",
            layout=(
                _g("repC", "plasmid replication protein RepC", 314, "plasmid"),
                "tet(K)",
                _g("pre", "plasmid recombination enzyme Pre", 420, "plasmid"),
            ),
            replicons=("rep7a",),
            rep_accessions=("000284__J01764",),
            relaxases=("MOBV",),
            relaxase_accessions=("NC_001393_00002",),
            mpf=None,
            mobility="mobilizable",
            primary_cluster="AA107",
            secondary_cluster="AI311",
            mash_neighbor="J01764",
            mash_distance=0.00088,
            mash_identification="Staphylococcus aureus",
            host_range=("genus", "Staphylococcus"),
            conjugation_genes=("MOBV",),
            gc=0.29,
            rep_gene="repC",
            relaxase_gene="pre",
        ),
        # IncX3 plasmid with blaNDM-1 for the additional Gram-negative species.
        PlasmidSpec(
            key="pNDM",
            layout=(
                _g("pir", "replication initiation protein Pir", 305, "plasmid"),
                _HYP,
                _g(None, "IS30-like element ISAba125 family transposase", 330, "is"),
                "blaNDM-1",
                "ble",
                _g("trpF", "phosphoribosylanthranilate isomerase", 205),
                _g("taxC", "conjugal transfer relaxase TaxC", 380, "plasmid"),
                _g("virB4", "type IV secretion system protein VirB4", 800, "plasmid"),
                _g("virB9", "type IV secretion system protein VirB9", 290, "plasmid"),
                _g("virD4", "type IV secretion system coupling protein VirD4", 600, "plasmid"),
                _HYP2,
            ),
            replicons=("IncX3",),
            rep_accessions=("000331__JN247852",),
            relaxases=("MOBP",),
            relaxase_accessions=("NC_019153_00031",),
            mpf="MPF_T",
            mobility="conjugative",
            primary_cluster="AA286",
            secondary_cluster="AI512",
            mash_neighbor="JN247852",
            mash_distance=0.00096,
            mash_identification="Klebsiella pneumoniae",
            host_range=("order", "Enterobacterales"),
            conjugation_genes=("T_virB4", "T_virB9", "MOBP"),
            gc=0.47,
            rep_gene="pir",
            relaxase_gene="taxC",
        ),
        # Acinetobacter plasmid with blaOXA-23.
        PlasmidSpec(
            key="pOXA23",
            layout=(
                _g("repB", "plasmid replication protein RepB", 290, "plasmid"),
                _HYP,
                _g(None, "IS4-like element ISAba1 family transposase", 380, "is"),
                "blaOXA-23",
                _g(None, "ATPase", 360),
                _HYP2,
            ),
            replicons=("rep_cluster_1254",),
            rep_accessions=("000520__CP015365",),
            relaxases=(),
            relaxase_accessions=(),
            mpf=None,
            mobility="non-mobilizable",
            primary_cluster="AC401",
            secondary_cluster="AM002",
            mash_neighbor="CP015365",
            mash_distance=0.00233,
            mash_identification="Acinetobacter baumannii",
            host_range=("genus", "Acinetobacter"),
            conjugation_genes=(),
            gc=0.37,
            rep_gene="repB",
        ),
        # Enterococcal Tn1546 plasmid with vanA.
        PlasmidSpec(
            key="pVAN",
            layout=(
                _g("repA", "plasmid replication initiator protein", 330, "plasmid"),
                _g(None, "Tn3 family transposase", 988, "is"),
                _g("vanR", "VanR-A family response regulator transcription factor", 231),
                _g("vanS", "VanS-A family sensor histidine kinase", 384),
                _g("vanH", "D-lactate dehydrogenase VanH-A", 322),
                "vanA",
                _g("vanX", "D-Ala-D-Ala dipeptidase VanX-A", 202),
                _HYP2,
            ),
            replicons=("rep17",),
            rep_accessions=("000404__CP003584",),
            relaxases=(),
            relaxase_accessions=(),
            mpf=None,
            mobility="non-mobilizable",
            primary_cluster="AB777",
            secondary_cluster="AL590",
            mash_neighbor="CP003584",
            mash_distance=0.00301,
            mash_identification="Enterococcus faecium",
            host_range=("genus", "Enterococcus"),
            conjugation_genes=(),
            gc=0.37,
        ),
    )
}


# Species -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class TaxonLine:
    rank: str
    taxid: int
    name: str


@dataclass(frozen=True)
class StProfile:
    st: str
    alleles: tuple[int, ...]
    weight: float = 1.0
    # Species-specific typing values for this lineage (tool column -> value).
    typing: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class SpeciesSpec:
    code: str
    name: str
    taxid: int
    gc: float
    gram_negative: bool
    lineage: tuple[TaxonLine, ...]  # phylum to genus, for the Kraken2 report
    relative: TaxonLine  # a second species of the genus in the Kraken2 report
    gtdb_lineage: str
    gtdb_reference: str
    mlst_scheme: str | None
    mlst_genes: tuple[str, ...]
    st_profiles: tuple[StProfile, ...]
    typing_tool: str | None  # a tool key of mgap_layout (kleborate, sistr, sccmec)
    intrinsic: tuple[str, ...]  # determinant symbols on every chromosome
    chromosomal_optional: tuple[tuple[str, float], ...]  # (symbol, probability)
    plasmids: tuple[tuple[str, float], ...]  # (plasmid key, probability)
    point_mutations: tuple[PointMutation, ...]
    virulence: tuple[tuple[tuple[str, ...], float], ...]  # (symbols, probability)
    mutation_genes: tuple[GeneSpec, ...]  # core genes carrying screened positions
    min_genomes: int = 2
    weight: float = 1.0
    source_weights: tuple[tuple[str, float], ...] = field(
        default=(("clinical", 0.7), ("environmental", 0.1), ("food", 0.1), ("animal", 0.1))
    )


_PROTEO = TaxonLine("P", 1224, "Pseudomonadota")
_GAMMA = TaxonLine("C", 1236, "Gammaproteobacteria")
_ENTEROBACTERALES = TaxonLine("O", 91347, "Enterobacterales")
_ENTEROBACTERIACEAE = TaxonLine("F", 543, "Enterobacteriaceae")
_BACILLOTA = TaxonLine("P", 1239, "Bacillota")
_BACILLI = TaxonLine("C", 91061, "Bacilli")

_GYRA_KPN = _g("gyrA", "DNA gyrase subunit A", 878)
_PARC = _g("parC", "DNA topoisomerase IV subunit A", 752)
_GYRA_SAU = _g("gyrA", "DNA gyrase subunit A", 889)
_GRLA = _g("grlA", "DNA topoisomerase IV subunit A", 800)

SPECIES: tuple[SpeciesSpec, ...] = (
    SpeciesSpec(
        code="KPN",
        name="Klebsiella pneumoniae",
        taxid=573,
        gc=0.57,
        gram_negative=True,
        lineage=(
            _PROTEO,
            _GAMMA,
            _ENTEROBACTERALES,
            _ENTEROBACTERIACEAE,
            TaxonLine("G", 570, "Klebsiella"),
        ),
        relative=TaxonLine("S", 244366, "Klebsiella variicola"),
        gtdb_lineage="d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Enterobacterales;"
        "f__Enterobacteriaceae;g__Klebsiella;s__Klebsiella pneumoniae",
        gtdb_reference="GCF_000742135.1",
        mlst_scheme="klebsiella",
        mlst_genes=("gapA", "infB", "mdh", "pgi", "phoE", "rpoB", "tonB"),
        st_profiles=(
            StProfile(
                "258",
                (3, 3, 1, 1, 1, 1, 79),
                3.0,
                (
                    (_KC.k_locus, "KL106"),
                    (_KC.k_type, "unknown (KL106)"),
                    (_KC.o_locus, "O2afg"),
                    (_KC.o_type, "O2afg"),
                ),
            ),
            StProfile(
                "11",
                (3, 3, 1, 1, 1, 1, 4),
                2.0,
                (
                    (_KC.k_locus, "KL64"),
                    (_KC.k_type, "K64"),
                    (_KC.o_locus, "O2afg"),
                    (_KC.o_type, "O2afg"),
                ),
            ),
            StProfile(
                "147",
                (3, 4, 6, 1, 7, 4, 38),
                1.5,
                (
                    (_KC.k_locus, "KL64"),
                    (_KC.k_type, "K64"),
                    (_KC.o_locus, "O2afg"),
                    (_KC.o_type, "O2afg"),
                ),
            ),
            StProfile(
                "307",
                (4, 1, 2, 52, 1, 1, 7),
                1.5,
                (
                    (_KC.k_locus, "KL102"),
                    (_KC.k_type, "unknown (KL102)"),
                    (_KC.o_locus, "O2afg"),
                    (_KC.o_type, "O2afg"),
                ),
            ),
            StProfile(
                "25",
                (2, 1, 1, 1, 10, 4, 13),
                1.0,
                (
                    (_KC.k_locus, "KL2"),
                    (_KC.k_type, "K2"),
                    (_KC.o_locus, "OL2α.2"),
                    (_KC.o_type, "O1αβ,2β"),
                ),
            ),
        ),
        typing_tool=L.KLEBORATE.tool,
        intrinsic=("blaSHV-11", "fosA", "oqxA"),
        chromosomal_optional=(),
        plasmids=(("pKPC", 0.3), ("pESBL", 0.35), ("pCol", 0.3)),
        point_mutations=(
            PointMutation(
                "gyrA",
                "S83I",
                "Klebsiella pneumoniae quinolone resistant GyrA",
                "QUINOLONE",
                "QUINOLONE",
                "WP_117036963.1",
                "S83S",
            ),
            PointMutation(
                "parC",
                "S80I",
                "Klebsiella pneumoniae quinolone resistant ParC",
                "QUINOLONE",
                "QUINOLONE",
                "WP_004180440.1",
                "S80S",
            ),
            PointMutation(
                "blaSHV",
                "C-112T",
                "Klebsiella pneumoniae blaSHV promoter region",
                "BETA-LACTAM",
                "CEFIDEROCOL/CEPHALOSPORIN",
                "NZ_CP054063.1:2645215-2645514",
                "C-112C",
            ),
        ),
        virulence=((("ybtP", "ybtQ"), 0.4), (("iucA",), 0.1)),
        mutation_genes=(_GYRA_KPN, _PARC),
        min_genomes=6,
        weight=0.45,
    ),
    SpeciesSpec(
        code="SEN",
        name="Salmonella enterica",
        taxid=28901,
        gc=0.52,
        gram_negative=True,
        lineage=(
            _PROTEO,
            _GAMMA,
            _ENTEROBACTERALES,
            _ENTEROBACTERIACEAE,
            TaxonLine("G", 590, "Salmonella"),
        ),
        relative=TaxonLine("S", 54736, "Salmonella bongori"),
        gtdb_lineage="d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Enterobacterales;"
        "f__Enterobacteriaceae;g__Salmonella;s__Salmonella enterica",
        gtdb_reference="GCF_000006945.2",
        mlst_scheme="senterica_achtman_2",
        mlst_genes=("aroC", "dnaN", "hemD", "hisD", "purE", "sucA", "thrA"),
        st_profiles=(
            StProfile(
                "19",
                (10, 7, 12, 9, 5, 9, 2),
                3.0,
                (
                    (_SI.serovar, "Typhimurium"),
                    (_SI.serogroup, "B"),
                    (_SI.h1, "i"),
                    (_SI.h2, "1,2"),
                    (_SI.o_antigen, "1,4,[5],12"),
                ),
            ),
            StProfile(
                "34",
                (10, 19, 12, 9, 5, 9, 2),
                2.0,
                (
                    (_SI.serovar, "I 1,4,[5],12:i:-"),
                    (_SI.serogroup, "B"),
                    (_SI.h1, "i"),
                    (_SI.h2, "-"),
                    (_SI.o_antigen, "1,4,[5],12"),
                ),
            ),
            StProfile(
                "11",
                (5, 2, 3, 7, 6, 6, 11),
                2.0,
                (
                    (_SI.serovar, "Enteritidis"),
                    (_SI.serogroup, "D1"),
                    (_SI.h1, "g,m"),
                    (_SI.h2, "-"),
                    (_SI.o_antigen, "1,9,12"),
                ),
            ),
            StProfile(
                "32",
                (17, 18, 22, 17, 5, 21, 19),
                1.0,
                (
                    (_SI.serovar, "Infantis"),
                    (_SI.serogroup, "C1"),
                    (_SI.h1, "r"),
                    (_SI.h2, "1,5"),
                    (_SI.o_antigen, "6,7,14"),
                ),
            ),
        ),
        typing_tool=L.SISTR.tool,
        intrinsic=("aac(6')-Iaa",),
        chromosomal_optional=(("tet(A)", 0.3), ("sul2", 0.3), ("floR", 0.2)),
        plasmids=(("pESBL", 0.25), ("pMCR", 0.15)),
        point_mutations=(
            PointMutation(
                "gyrA",
                "D87N",
                "Salmonella enterica quinolone resistant GyrA",
                "QUINOLONE",
                "QUINOLONE",
                "WP_001281271.1",
                "D87D",
            ),
        ),
        virulence=(),
        mutation_genes=(_GYRA_KPN,),
        min_genomes=4,
        weight=0.30,
        source_weights=(("clinical", 0.4), ("food", 0.3), ("animal", 0.2), ("environmental", 0.1)),
    ),
    SpeciesSpec(
        code="SAU",
        name="Staphylococcus aureus",
        taxid=1280,
        gc=0.33,
        gram_negative=False,
        lineage=(
            _BACILLOTA,
            _BACILLI,
            TaxonLine("O", 1385, "Bacillales"),
            TaxonLine("F", 90964, "Staphylococcaceae"),
            TaxonLine("G", 1279, "Staphylococcus"),
        ),
        relative=TaxonLine("S", 985002, "Staphylococcus argenteus"),
        gtdb_lineage="d__Bacteria;p__Bacillota;c__Bacilli;o__Staphylococcales;"
        "f__Staphylococcaceae;g__Staphylococcus;s__Staphylococcus aureus",
        gtdb_reference="GCF_000013425.1",
        mlst_scheme="saureus",
        mlst_genes=("arcC", "aroE", "glpF", "gmk", "pta", "tpi", "yqiL"),
        st_profiles=(
            StProfile("5", (1, 4, 1, 4, 12, 1, 10), 2.0, ((_SC.type, "II"), (_SC.subtype, "IIa"))),
            StProfile("8", (3, 3, 1, 1, 4, 4, 3), 2.0, ((_SC.type, "IV"), (_SC.subtype, "IVa"))),
            StProfile("22", (7, 6, 1, 5, 8, 8, 6), 1.5, ((_SC.type, "IV"), (_SC.subtype, "IVh"))),
            StProfile(
                "398", (3, 35, 19, 2, 20, 26, 39), 1.0, ((_SC.type, "V"), (_SC.subtype, "Vc"))
            ),
        ),
        typing_tool=L.SCCMEC.tool,
        intrinsic=(),
        chromosomal_optional=(("mecA", 0.7), ("erm(C)", 0.2)),
        plasmids=(("pBlaZ", 0.6), ("pTetK", 0.2)),
        point_mutations=(
            PointMutation(
                "gyrA",
                "S84L",
                "Staphylococcus aureus quinolone resistant GyrA",
                "QUINOLONE",
                "QUINOLONE",
                "WP_000819074.1",
                "S84S",
            ),
            PointMutation(
                "grlA",
                "S80F",
                "Staphylococcus aureus quinolone resistant GrlA",
                "QUINOLONE",
                "QUINOLONE",
                "WP_000545461.1",
                "S80S",
            ),
        ),
        virulence=((("lukF-PV", "lukS-PV"), 0.3), (("sea",), 0.2)),
        mutation_genes=(_GYRA_SAU, _GRLA),
        min_genomes=2,
        weight=0.25,
        source_weights=(("clinical", 0.75), ("animal", 0.2), ("food", 0.05)),
    ),
    SpeciesSpec(
        code="SMA",
        name="Serratia marcescens",
        taxid=615,
        gc=0.59,
        gram_negative=True,
        lineage=(
            _PROTEO,
            _GAMMA,
            _ENTEROBACTERALES,
            TaxonLine("F", 1903411, "Yersiniaceae"),
            TaxonLine("G", 613, "Serratia"),
        ),
        relative=TaxonLine("S", 458197, "Serratia nematodiphila"),
        gtdb_lineage="d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Enterobacterales;"
        "f__Enterobacteriaceae;g__Serratia;s__Serratia marcescens",
        gtdb_reference="GCF_003516165.1",
        mlst_scheme=None,
        mlst_genes=(),
        st_profiles=(),
        typing_tool=None,
        intrinsic=("aac(6')-Ic", "blaSRT-2"),
        chromosomal_optional=(),
        plasmids=(("pNDM", 0.2),),
        point_mutations=(),
        virulence=(),
        mutation_genes=(),
        weight=0.12,
    ),
    SpeciesSpec(
        code="ECO",
        name="Escherichia coli",
        taxid=562,
        gc=0.51,
        gram_negative=True,
        lineage=(
            _PROTEO,
            _GAMMA,
            _ENTEROBACTERALES,
            _ENTEROBACTERIACEAE,
            TaxonLine("G", 561, "Escherichia"),
        ),
        relative=TaxonLine("S", 208962, "Escherichia albertii"),
        gtdb_lineage="d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Enterobacterales;"
        "f__Enterobacteriaceae;g__Escherichia;s__Escherichia coli",
        gtdb_reference="GCF_000005845.2",
        mlst_scheme="ecoli_achtman_4",
        mlst_genes=("adk", "fumC", "gyrB", "icd", "mdh", "purA", "recA"),
        st_profiles=(
            StProfile("131", (53, 40, 47, 13, 36, 28, 29), 2.0),
            StProfile("69", (21, 35, 27, 6, 5, 5, 4)),
            StProfile("73", (36, 24, 9, 13, 17, 11, 25)),
        ),
        typing_tool=None,
        intrinsic=("blaEC-5",),
        chromosomal_optional=(("tet(A)", 0.3), ("sul2", 0.3)),
        plasmids=(("pESBL", 0.3), ("pNDM", 0.1), ("pMCR", 0.1)),
        point_mutations=(
            PointMutation(
                "gyrA",
                "S83L",
                "Escherichia coli quinolone resistant GyrA",
                "QUINOLONE",
                "QUINOLONE",
                "WP_001281236.1",
                "S83S",
            ),
        ),
        virulence=((("iss",), 0.4),),
        mutation_genes=(_GYRA_KPN,),
        weight=0.12,
    ),
    SpeciesSpec(
        code="PAE",
        name="Pseudomonas aeruginosa",
        taxid=287,
        gc=0.66,
        gram_negative=True,
        lineage=(
            _PROTEO,
            _GAMMA,
            TaxonLine("O", 72274, "Pseudomonadales"),
            TaxonLine("F", 135621, "Pseudomonadaceae"),
            TaxonLine("G", 286, "Pseudomonas"),
        ),
        relative=TaxonLine("S", 2994495, "Pseudomonas paraeruginosa"),
        gtdb_lineage="d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Pseudomonadales;"
        "f__Pseudomonadaceae;g__Pseudomonas;s__Pseudomonas aeruginosa",
        gtdb_reference="GCF_000006765.1",
        mlst_scheme="paeruginosa",
        mlst_genes=("acsA", "aroE", "guaA", "mutL", "nuoD", "ppsA", "trpE"),
        st_profiles=(
            StProfile("235", (38, 11, 3, 13, 1, 2, 4)),
            StProfile("111", (17, 5, 5, 4, 4, 4, 3)),
        ),
        typing_tool=None,
        intrinsic=("blaPDC-3", "aph(3')-IIb", "catB7"),
        chromosomal_optional=(),
        plasmids=(),
        point_mutations=(),
        virulence=(),
        mutation_genes=(),
        weight=0.10,
    ),
    SpeciesSpec(
        code="ABA",
        name="Acinetobacter baumannii",
        taxid=470,
        gc=0.39,
        gram_negative=True,
        lineage=(
            _PROTEO,
            _GAMMA,
            TaxonLine("O", 72274, "Pseudomonadales"),
            TaxonLine("F", 468, "Moraxellaceae"),
            TaxonLine("G", 469, "Acinetobacter"),
        ),
        relative=TaxonLine("S", 48296, "Acinetobacter pittii"),
        gtdb_lineage="d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Pseudomonadales;"
        "f__Moraxellaceae;g__Acinetobacter;s__Acinetobacter baumannii",
        gtdb_reference="GCF_009035845.1",
        mlst_scheme="abaumannii_2",
        mlst_genes=(
            "Pas_cpn60",
            "Pas_fusA",
            "Pas_gltA",
            "Pas_pyrG",
            "Pas_recA",
            "Pas_rplB",
            "Pas_rpoB",
        ),
        st_profiles=(
            StProfile("2", (2, 2, 2, 2, 2, 2, 2), 2.0),
            StProfile("1", (1, 1, 1, 1, 5, 1, 1)),
        ),
        typing_tool=None,
        intrinsic=("blaOXA-66", "blaADC-25"),
        chromosomal_optional=(),
        plasmids=(("pOXA23", 0.5),),
        point_mutations=(),
        virulence=(),
        mutation_genes=(),
        weight=0.10,
    ),
    SpeciesSpec(
        code="EFM",
        name="Enterococcus faecium",
        taxid=1352,
        gc=0.38,
        gram_negative=False,
        lineage=(
            _BACILLOTA,
            _BACILLI,
            TaxonLine("O", 186826, "Lactobacillales"),
            TaxonLine("F", 81852, "Enterococcaceae"),
            TaxonLine("G", 1350, "Enterococcus"),
        ),
        relative=TaxonLine("S", 357441, "Enterococcus lactis"),
        gtdb_lineage="d__Bacteria;p__Bacillota;c__Bacilli;o__Lactobacillales;"
        "f__Enterococcaceae;g__Enterococcus;s__Enterococcus faecium",
        gtdb_reference="GCF_009734005.1",
        mlst_scheme="efaecium",
        mlst_genes=("atpA", "ddl", "gdh", "purK", "gyd", "pstS", "adk"),
        st_profiles=(
            StProfile("17", (1, 1, 1, 1, 1, 1, 1)),
            StProfile("80", (9, 1, 1, 1, 12, 1, 1)),
        ),
        typing_tool=None,
        intrinsic=("aac(6')-Ii", "msr(C)"),
        chromosomal_optional=(("erm(B)", 0.4),),
        plasmids=(("pVAN", 0.4),),
        point_mutations=(),
        virulence=(),
        mutation_genes=(),
        weight=0.08,
    ),
    SpeciesSpec(
        code="SPN",
        name="Streptococcus pneumoniae",
        taxid=1313,
        gc=0.40,
        gram_negative=False,
        lineage=(
            _BACILLOTA,
            _BACILLI,
            TaxonLine("O", 186826, "Lactobacillales"),
            TaxonLine("F", 1300, "Streptococcaceae"),
            TaxonLine("G", 1301, "Streptococcus"),
        ),
        relative=TaxonLine("S", 28037, "Streptococcus mitis"),
        gtdb_lineage="d__Bacteria;p__Bacillota;c__Bacilli;o__Lactobacillales;"
        "f__Streptococcaceae;g__Streptococcus;s__Streptococcus pneumoniae",
        gtdb_reference="GCF_001457635.1",
        mlst_scheme="spneumoniae",
        mlst_genes=("aroE", "gdh", "gki", "recP", "spi", "xpt", "ddl"),
        st_profiles=(
            StProfile("320", (4, 16, 19, 15, 6, 20, 1)),
            StProfile("199", (8, 13, 14, 4, 17, 4, 14)),
        ),
        typing_tool=None,
        intrinsic=(),
        chromosomal_optional=(("erm(B)", 0.4), ("tet(M)", 0.4)),
        plasmids=(),
        point_mutations=(),
        virulence=(),
        mutation_genes=(),
        weight=0.08,
    ),
    SpeciesSpec(
        code="EHO",
        name="Enterobacter hormaechei",
        taxid=158836,
        gc=0.55,
        gram_negative=True,
        lineage=(
            _PROTEO,
            _GAMMA,
            _ENTEROBACTERALES,
            _ENTEROBACTERIACEAE,
            TaxonLine("G", 547, "Enterobacter"),
        ),
        relative=TaxonLine("S", 550, "Enterobacter cloacae"),
        gtdb_lineage="d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;o__Enterobacterales;"
        "f__Enterobacteriaceae;g__Enterobacter;s__Enterobacter hormaechei_A",
        gtdb_reference="GCF_001729785.1",
        mlst_scheme="ecloacae",
        mlst_genes=("dnaA", "fusA", "gyrB", "leuS", "pyrG", "rplB", "rpoB"),
        st_profiles=(
            StProfile("78", (1, 4, 13, 1, 3, 3, 12)),
            StProfile("171", (44, 35, 20, 44, 49, 5, 6)),
        ),
        typing_tool=None,
        intrinsic=("blaACT-15", "fosA"),
        chromosomal_optional=(),
        plasmids=(("pNDM", 0.2), ("pESBL", 0.2)),
        point_mutations=(),
        virulence=(),
        mutation_genes=(),
        weight=0.08,
    ),
)

MAX_SPECIES = len(SPECIES)


# Metadata vocabularies ---------------------------------------------------------------------------

COUNTRIES: tuple[tuple[str, str, str], ...] = (
    ("CL", "Región Metropolitana", "Santiago"),
    ("CL", "Valparaíso", "Valparaíso"),
    ("CL", "Biobío", "Concepción"),
    ("AR", "Buenos Aires", "La Plata"),
    ("PE", "Lima", "Lima"),
    ("BR", "São Paulo", "Campinas"),
    ("CO", "Antioquia", "Medellín"),
    ("MX", "Jalisco", "Guadalajara"),
    ("ES", "Madrid", "Madrid"),
    ("US", "California", "Los Angeles"),
    ("VN", "Hanoi", "Hanoi"),
    ("ZA", "Gauteng", "Johannesburg"),
)

ISOLATION_SITES: dict[str, tuple[str, ...]] = {
    "clinical": ("blood", "urine", "sputum", "wound", "rectal swab", "cerebrospinal fluid"),
    "environmental": ("river water", "hospital sewage", "soil"),
    "food": ("chicken meat", "pork", "eggs", "lettuce"),
    "animal": ("cattle feces", "swine nasal swab", "poultry cecum", "dog skin"),
    "other": ("unknown",),
}

HOSTS: dict[str, tuple[str, ...]] = {
    "clinical": ("Homo sapiens",),
    "environmental": ("",),
    "food": ("",),
    "animal": ("Bos taurus", "Sus scrofa", "Gallus gallus", "Canis lupus familiaris"),
    "other": ("",),
}

SITES: dict[str, tuple[str, ...]] = {
    "clinical": ("Hospital A", "Hospital B", "Hospital C"),
    "environmental": ("River site 4", "Wastewater plant 1"),
    "food": ("Market 3", "Processing plant 2"),
    "animal": ("Farm 12", "Farm 7", "Veterinary clinic 1"),
    "other": ("Unknown",),
}

COLLECTION_GROUPS: tuple[str, ...] = (
    "National AMR surveillance",
    "One Health study",
    "Hospital outbreak 2023",
    "Food chain monitoring",
)

WARDS: tuple[str, ...] = ("ICU", "Internal medicine", "Pediatrics", "Emergency", "Surgery")
