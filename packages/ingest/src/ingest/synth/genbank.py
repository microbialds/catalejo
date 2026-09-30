"""Bakta-style GenBank (``.gbff``) output, written with Biopython.

Biopython ships without complete type information, so this module is the one
place the synthetic generator uses it and is checked in basic mode.
"""
# pyright: basic

from __future__ import annotations

import io

from Bio.Seq import Seq
from Bio.SeqFeature import FeatureLocation, SeqFeature
from Bio.SeqIO import write as seqio_write
from Bio.SeqRecord import SeqRecord

from ingest import mgap_layout as L
from ingest.synth.build import CODING_TYPES, Feature, Genome

# A fixed date keeps the output byte-identical between runs (no timestamps).
LOCUS_DATE = "01-JAN-2026"

T = L.BAKTA.feature_types
_KEYS = dict(L.BAKTA.gbff_types)


def _location(f: Feature) -> FeatureLocation:
    strand = {"+": 1, "-": -1}.get(f.strand)
    return FeatureLocation(f.start - 1, f.end, strand=strand)


def _features(f: Feature) -> list[SeqFeature]:
    out: list[SeqFeature] = []
    loc = _location(f)
    if f.locus_tag:
        gene_q: dict[str, list[str]] = {"locus_tag": [f.locus_tag]}
        if f.gene:
            gene_q["gene"] = [f.gene]
        out.append(SeqFeature(loc, type="gene", qualifiers=gene_q))
    q: dict[str, list[str]] = {}
    if f.dbxrefs:
        q["db_xref"] = list(f.dbxrefs)
    if f.type in CODING_TYPES:
        assert f.locus_tag is not None and f.protein is not None
        q["product"] = [f.product]
        q["locus_tag"] = [f.locus_tag]
        q["protein_id"] = [L.BAKTA.gbff_protein_id.format(locus_tag=f.locus_tag)]
        q["translation"] = [f.protein]
        q["codon_start"] = ["1"]
        q["transl_table"] = [str(L.BAKTA.gcode)]
        q["inference"] = ["ab initio prediction:Prodigal:2.6"]
        if f.gene:
            q["gene"] = [f.gene]
    elif f.type == T.gap:
        q["estimated_length"] = [str(f.end - f.start + 1)]
    elif f.type in (T.oric, T.oriv, T.orit, T.ncrna_region):
        q["note"] = [f.product]
        q["inference"] = ["similar to DNA sequence"]
        if f.type == T.ncrna_region:
            q["regulatory_class"] = ["recoding_stimulatory_region"]
    else:
        q["product"] = [f.product]
        if f.locus_tag:
            q["locus_tag"] = [f.locus_tag]
        if f.type == T.ncrna:
            q["ncRNA_class"] = ["other"]
        if f.gene:
            q["gene"] = [f.gene]
    out.append(SeqFeature(loc, type=_KEYS[f.type], qualifiers=q))
    return out


# EMBL divisions as Bakta writes them (PRO for complete replicons, UNC for drafts).
EMBL_DIVISION_COMPLETE = "PRO"
EMBL_DIVISION_DRAFT = "UNC"


def _records(genome: Genome, software: str, database: str, embl: bool) -> list[SeqRecord]:
    b = L.BAKTA
    records: list[SeqRecord] = []
    comment = "\n".join(
        [
            "Annotated with Bakta",
            f"Software: v{software}",
            f"Database: v{database}, {b.database_type}",
            f"DOI: {b.doi}",
            f"URL: {b.url}",
        ]
    )
    for c in genome.contigs:
        topology = b.topology_circular if c.circular else b.topology_linear
        if not c.circular:
            definition = b.gbff_definition_draft.format(contig=c.bakta_id)
            division = EMBL_DIVISION_DRAFT if embl else b.gbff_division_draft
        else:
            if c.plasmid_name:
                definition = b.gbff_definition_plasmid.format(name=c.plasmid_name)
            else:
                definition = b.gbff_definition_chromosome
            division = EMBL_DIVISION_COMPLETE if embl else b.gbff_division_complete
        record = SeqRecord(
            Seq(c.seq),
            id=c.bakta_id,
            name=c.bakta_id,
            description=definition,
            annotations={  # type: ignore[arg-type]
                "molecule_type": "DNA",
                "topology": topology,
                "data_file_division": division,
                "date": LOCUS_DATE,
                "accessions": [c.bakta_id],
                "sequence_version": 1,
                "comment": comment,
            },
        )
        source: dict[str, list[str]] = {"mol_type": ["genomic DNA"]}
        if c.plasmid_name:
            source["plasmid"] = [c.plasmid_name]
        record.features.append(
            SeqFeature(FeatureLocation(0, c.length, strand=1), type="source", qualifiers=source)
        )
        for f in c.features:
            record.features.extend(_features(f))
        records.append(record)
    return records


def gbff_text(genome: Genome, software: str, database: str) -> str:
    """The .gbff of ``genome`` as Bakta writes it (one record per contig)."""
    buffer = io.StringIO()
    seqio_write(_records(genome, software, database, embl=False), buffer, "genbank")
    return buffer.getvalue()


def embl_text(genome: Genome, software: str, database: str) -> str:
    """The .embl of ``genome`` (one record per contig)."""
    buffer = io.StringIO()
    seqio_write(_records(genome, software, database, embl=True), buffer, "embl")
    return buffer.getvalue()
