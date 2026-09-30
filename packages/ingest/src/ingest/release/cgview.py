"""CGView.js map JSON of one genome (contract §7.1; container per milestone 1a plan, decision 10).

The file is ``{"format": "catalejo-cgview", "format_version": 1, "genome":
<map of all contigs>, "contigs": {"<contig_id>": <map of one contig>}}``, each
map a CGView document ``{"cgview": {...}}`` for the version pinned in
``packages/web`` (1.8.2), following the rules the web package read from the
library:

- ``sequence.contigs`` lists names and lengths without sequence.
- Features carry their contig, 1-based contig coordinates with start <= stop,
  strand 1 or -1 (Bakta's ``?`` and ``.`` are drawn as 1), a legend item that
  exists, a ``source`` that places them on exactly one track, and
  ``meta.feature_id`` (null for a hit or mutation that overlaps no feature,
  with ``meta.hit_id`` or ``meta.mutation_id`` beside it).
- Tracks, outside in (§7.1): CDS forward, CDS reverse, other features,
  resistance determinants (AMRFinderPlus resistance genes and point
  mutations, one legend item per palette drug class), virulence factors,
  regions (prophage and plasmid region), GC content, GC skew. Feature tracks
  select by ``source``; plot tracks read one plot each and sit inside the
  backbone.
- GC content (fraction, baseline the genome's mean) and GC skew
  ((G - C) / (G + C), baseline 0) are precomputed in fixed windows of
  ``WINDOW`` bases; positions are whole-map coordinates, starting at 1 in each
  contig's first window and offset by the preceding contigs' lengths.
- ``settings.showShading`` is false (no gradients, requirements §7).

Legend item names are interface text. They are few and stable: "CDS
forward", "CDS reverse", "Other features", "Virulence", "Prophage",
"Plasmid region", "GC content", "GC skew", and for drug classes the palette
key, since the English labels live in ``packages/web/src/strings.ts`` (open
point, milestone 1a). Colors come from ``config/palette.yaml``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from ingest.config import PaletteConfig
from ingest.drug_classes import classify

CGVIEW_VERSION = "1.8.2"
FORMAT = "catalejo-cgview"
FORMAT_VERSION = 1
WINDOW = 1000

CDS_TYPES = ("cds", "sorf")
AMR = "amr"
VIRULENCE = "virulence"
AMRFINDERPLUS = "amrfinderplus"
PROPHAGE = "prophage"

SRC_CDS_FORWARD = "cds_forward"
SRC_CDS_REVERSE = "cds_reverse"
SRC_OTHER = "other_features"
SRC_AMR = "resistance"
SRC_VIRULENCE = "virulence"
SRC_REGIONS = "regions"
SRC_GC_CONTENT = "gc_content"
SRC_GC_SKEW = "gc_skew"

LEGEND_CDS_FORWARD = "CDS forward"
LEGEND_CDS_REVERSE = "CDS reverse"
LEGEND_OTHER = "Other features"
LEGEND_VIRULENCE = "Virulence"
LEGEND_PROPHAGE = "Prophage"
LEGEND_PLASMID_REGION = "Plasmid region"
LEGEND_GC_CONTENT = "GC content"
LEGEND_GC_SKEW = "GC skew"


@dataclass(frozen=True)
class MapContig:
    contig_id: str
    length: int
    circular: bool
    sequence: str


@dataclass(frozen=True)
class MapFeature:
    source: str
    legend: str
    name: str
    type: str
    contig_id: str
    start: int
    end: int
    strand: str
    meta: dict[str, str | None]


@dataclass(frozen=True)
class GenomeMapInput:
    genome_id: str
    contigs: Sequence[MapContig]
    features: Sequence[MapFeature]


# Features ---------------------------------------------------------------------------------------


def feature_items(rows: Sequence[tuple[Any, ...]]) -> list[MapFeature]:
    """Map features of ``feature`` rows: (feature_id, contig_id, start, end, strand, type,
    locus_tag, gene, product)."""
    out: list[MapFeature] = []
    for fid, contig, start, end, strand, ftype, locus, gene, product in rows:
        if ftype in CDS_TYPES:
            forward = strand != "-"
            source = SRC_CDS_FORWARD if forward else SRC_CDS_REVERSE
            legend = LEGEND_CDS_FORWARD if forward else LEGEND_CDS_REVERSE
        else:
            source, legend = SRC_OTHER, LEGEND_OTHER
        name = gene or locus or product or ftype
        out.append(
            MapFeature(source, legend, name, ftype, contig, start, end, strand, {"feature_id": fid})
        )
    return out


def hit_items(rows: Sequence[tuple[Any, ...]], palette: PaletteConfig) -> list[MapFeature]:
    """Map features of AMRFinderPlus hits: (hit_id, feature_id, contig_id, start, end, strand,
    element_name, element_type, drug_class, drug_subclass)."""
    out: list[MapFeature] = []
    for hid, fid, contig, start, end, strand, name, etype, drug, subclass in rows:
        meta: dict[str, str | None] = {"feature_id": fid, "hit_id": hid}
        if etype == AMR:
            _, entry = classify(drug, subclass, palette)
            out.append(MapFeature(SRC_AMR, entry.key, name, AMR, contig, start, end, strand, meta))
        elif etype == VIRULENCE:
            legend = LEGEND_VIRULENCE
            item = MapFeature(
                SRC_VIRULENCE, legend, name, VIRULENCE, contig, start, end, strand, meta
            )
            out.append(item)
    return out


def mutation_items(rows: Sequence[tuple[Any, ...]], palette: PaletteConfig) -> list[MapFeature]:
    """Map features of mutations with coordinates: (mutation_id, feature_id, contig_id, start,
    end, strand, gene, variant, drug_class)."""
    out: list[MapFeature] = []
    for mid, fid, contig, start, end, strand, gene, variant, drug in rows:
        if start is None or end is None:
            continue
        _, entry = classify(drug, None, palette)
        meta: dict[str, str | None] = {"feature_id": fid, "mutation_id": mid}
        out.append(
            MapFeature(
                SRC_AMR, entry.key, f"{gene} {variant}", "mutation", contig, start, end,
                strand or "+", meta,
            )
        )  # fmt: skip
    return out


def region_items(rows: Sequence[tuple[Any, ...]]) -> list[MapFeature]:
    """Map features of regions: (region_id, contig_id, start, end, type)."""
    out: list[MapFeature] = []
    for rid, contig, start, end, rtype in rows:
        legend = LEGEND_PROPHAGE if rtype == PROPHAGE else LEGEND_PLASMID_REGION
        meta: dict[str, str | None] = {"feature_id": None, "region_id": rid}
        out.append(MapFeature(SRC_REGIONS, legend, rtype, rtype, contig, start, end, "+", meta))
    return out


# Plots ------------------------------------------------------------------------------------------


def windows(seq: str, window: int = WINDOW) -> list[tuple[int, float, float]]:
    """(1-based start, GC fraction, GC skew) of each fixed window of ``seq``."""
    out: list[tuple[int, float, float]] = []
    upper = seq.upper()
    for i in range(0, len(upper), window):
        part = upper[i : i + window]
        g, c = part.count("G"), part.count("C")
        acgt = g + c + part.count("A") + part.count("T")
        gc = (g + c) / acgt if acgt else 0.0
        skew = (g - c) / (g + c) if g + c else 0.0
        out.append((i + 1, round(gc, 4), round(skew, 4)))
    return out


def _plots(contigs: Sequence[MapContig]) -> list[dict[str, Any]]:
    positions: list[int] = []
    gc: list[float] = []
    skew: list[float] = []
    offset = 0
    total_gc = total_acgt = 0
    for c in contigs:
        for start, value, s in windows(c.sequence):
            positions.append(offset + start)
            gc.append(value)
            skew.append(s)
        upper = c.sequence.upper()
        n_gc = upper.count("G") + upper.count("C")
        total_gc += n_gc
        total_acgt += n_gc + upper.count("A") + upper.count("T")
        offset += c.length
    mean = round(total_gc / total_acgt, 4) if total_acgt else 0.5
    return [
        {
            "name": LEGEND_GC_CONTENT,
            "source": SRC_GC_CONTENT,
            "type": "line",
            "positions": positions,
            "scores": gc,
            "baseline": mean,
            "axisMin": 0,
            "axisMax": 1,
            "legendPositive": LEGEND_GC_CONTENT,
            "legendNegative": LEGEND_GC_CONTENT,
        },
        {
            "name": LEGEND_GC_SKEW,
            "source": SRC_GC_SKEW,
            "type": "line",
            "positions": positions,
            "scores": skew,
            "baseline": 0,
            "axisMin": -1,
            "axisMax": 1,
            "legendPositive": LEGEND_GC_SKEW,
            "legendNegative": LEGEND_GC_SKEW,
        },
    ]


# Documents --------------------------------------------------------------------------------------


def _legend(palette: PaletteConfig) -> list[dict[str, str]]:
    t = palette.tracks
    items = [
        (LEGEND_CDS_FORWARD, t["cds_forward"], "arrow"),
        (LEGEND_CDS_REVERSE, t["cds_reverse"], "arrow"),
        (LEGEND_OTHER, t["other_features"], "arc"),
        *[(d.key, d.color, "arc") for d in palette.drug_classes],
        (LEGEND_VIRULENCE, t["virulence"], "arc"),
        (LEGEND_PROPHAGE, t["region_prophage"], "arc"),
        (LEGEND_PLASMID_REGION, t["region_plasmid"], "arc"),
        (LEGEND_GC_CONTENT, t["gc_content"], "arc"),
        (LEGEND_GC_SKEW, t["gc_skew"], "arc"),
    ]
    return [{"name": n, "swatchColor": c, "decoration": d} for n, c, d in items]


def _tracks() -> list[dict[str, Any]]:
    def feature_track(name: str, source: str, position: str) -> dict[str, Any]:
        return {
            "name": name,
            "dataType": "feature",
            "dataMethod": "source",
            "dataKeys": source,
            "position": position,
            "separateFeaturesBy": "none",
        }

    def plot_track(name: str, source: str) -> dict[str, Any]:
        return {
            "name": name,
            "dataType": "plot",
            "dataMethod": "source",
            "dataKeys": source,
            "position": "inside",
        }

    return [
        feature_track(LEGEND_CDS_FORWARD, SRC_CDS_FORWARD, "outside"),
        feature_track(LEGEND_CDS_REVERSE, SRC_CDS_REVERSE, "outside"),
        feature_track(LEGEND_OTHER, SRC_OTHER, "inside"),
        feature_track("Resistance determinants", SRC_AMR, "inside"),
        feature_track("Virulence factors", SRC_VIRULENCE, "inside"),
        feature_track("Regions", SRC_REGIONS, "inside"),
        plot_track(LEGEND_GC_CONTENT, SRC_GC_CONTENT),
        plot_track(LEGEND_GC_SKEW, SRC_GC_SKEW),
    ]


def _feature_json(f: MapFeature) -> dict[str, Any]:
    start, stop = min(f.start, f.end), max(f.start, f.end)
    return {
        "name": f.name,
        "type": f.type,
        "source": f.source,
        "contig": f.contig_id,
        "start": start,
        "stop": stop,
        "strand": -1 if f.strand == "-" else 1,
        "legend": f.legend,
        "meta": f.meta,
    }


def document(
    name: str,
    contigs: Sequence[MapContig],
    features: Sequence[MapFeature],
    palette: PaletteConfig,
    circular: bool = True,
) -> dict[str, Any]:
    """One CGView document for ``contigs`` and the features on them."""
    names = {c.contig_id for c in contigs}
    order = {src: i for i, src in enumerate(t["dataKeys"] for t in _tracks())}
    placed = sorted(
        (f for f in features if f.contig_id in names),
        key=lambda f: (order[f.source], f.contig_id, f.start, f.end, f.name),
    )
    return {
        "cgview": {
            "version": CGVIEW_VERSION,
            "name": name,
            "settings": {"format": "circular" if circular else "linear", "showShading": False},
            "sequence": {"contigs": [{"name": c.contig_id, "length": c.length} for c in contigs]},
            "legend": {"items": _legend(palette)},
            "features": [_feature_json(f) for f in placed],
            "plots": _plots(contigs),
            "tracks": _tracks(),
        }
    }


def genome_map(g: GenomeMapInput, palette: PaletteConfig) -> dict[str, Any]:
    """The container of decision 10: the multi-contig map and one map per contig."""
    return {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "genome": document(g.genome_id, g.contigs, g.features, palette),
        "contigs": {
            c.contig_id: document(
                f"{g.genome_id} {c.contig_id}", [c], g.features, palette, circular=c.circular
            )
            for c in g.contigs
        },
    }
