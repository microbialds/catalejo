"""Load and validate the configuration files in ``config/``.

Every catalejo command reads ``config/platform.yaml`` (contract §8); the other
files hold the color vocabulary (requirements §5.4), the design tokens
(requirements §7), the toolchain pins, the typing chips (contract §5.9), the
summary sentence templates (contract §7.4) and the export presets
(requirements §8).

The configuration directory is ``config/`` at the repository root, found by
walking up from this package to the first directory that contains
``CLAUDE.md`` or ``.git``. The environment variable ``CATALEJO_CONFIG_DIR``
overrides it.
"""

from __future__ import annotations

import os
import re
from functools import cache
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

CONFIG_DIR_ENV = "CATALEJO_CONFIG_DIR"

PLATFORM_FILE = "platform.yaml"
PALETTE_FILE = "palette.yaml"
DESIGN_TOKENS_FILE = "design-tokens.yaml"
VERSIONS_FILE = "versions.yaml"
TYPING_DISPLAY_FILE = "typing_display.yaml"
SUMMARY_TEMPLATES_FILE = "summary_templates.yaml"
EXPORT_PRESETS_FILE = "export-presets.yaml"
SPECIES_REGISTRY_FILE = "species_registry.yaml"

CONFIG_FILES = (
    PLATFORM_FILE,
    PALETTE_FILE,
    DESIGN_TOKENS_FILE,
    VERSIONS_FILE,
    TYPING_DISPLAY_FILE,
    SUMMARY_TEMPLATES_FILE,
    EXPORT_PRESETS_FILE,
    SPECIES_REGISTRY_FILE,
)

_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_PALETTE_REF = re.compile(r"^palette:([a-z_]+)\.([a-z_]+)$")
_CONDITION = re.compile(r"^([a-z_]+) (==|!=|>=|<=|>|<) (\S+)$")
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


class ConfigError(Exception):
    """A configuration file is missing or does not validate."""


def _hex_color(value: str) -> str:
    if not _HEX.match(value):
        raise ValueError(f"not a six-digit hex color: {value!r}")
    return value


def _condition(value: str) -> str:
    if not _CONDITION.match(value):
        raise ValueError(f"condition must read '<fact> <operator> <value>': {value!r}")
    return value


HexColor = Annotated[str, AfterValidator(_hex_color)]
Condition = Annotated[str, AfterValidator(_condition)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# platform.yaml ---------------------------------------------------------------


class Thresholds(_Model):
    feature_mapping_overlap: float = Field(gt=0, le=1)
    cluster_mapping_shared: float = Field(gt=0, le=1)
    neighborhood_window: int = Field(gt=0)
    neighborhood_comparison_cap: int = Field(gt=0)
    heatmap_genome_cap: int = Field(gt=0)
    chart_species_max: int = Field(gt=0)


class QcThresholds(_Model):
    completeness_min: float = Field(ge=0, le=100)
    contamination_max: float = Field(ge=0, le=100)


class UmapParameters(_Model):
    n_neighbors: int = Field(gt=1)
    min_dist: float = Field(ge=0)
    seed: int
    metric: str


SpeciesSource = Literal["metadata", "gtdbtk", "mlst", "kraken2"]


class SampleNameRule(_Model):
    """One ordered substitution from an mgap sample name toward a genome_id."""

    pattern: str
    replace: str

    @model_validator(mode="after")
    def _check(self) -> SampleNameRule:
        try:
            re.compile(self.pattern)
        except re.error as exc:
            raise ValueError(f"sample_name_rules pattern {self.pattern!r}: {exc}") from exc
        return self


class PlatformConfig(_Model):
    """``config/platform.yaml`` (contract §3, §7, §8)."""

    version: int
    platform_name: str
    genome_id_pattern: str
    sample_name_rules: list[SampleNameRule]
    species_precedence: list[SpeciesSource]
    thresholds: Thresholds
    qc: QcThresholds
    umap: UmapParameters

    @model_validator(mode="after")
    def _check(self) -> PlatformConfig:
        try:
            re.compile(self.genome_id_pattern)
        except re.error as exc:
            raise ValueError(f"genome_id_pattern: {exc}") from exc
        if sorted(self.species_precedence) != sorted({"metadata", "gtdbtk", "mlst", "kraken2"}):
            raise ValueError("species_precedence must list each of the four sources once")
        return self

    @property
    def genome_id_regex(self) -> re.Pattern[str]:
        return re.compile(self.genome_id_pattern)

    def genome_id_from_sample(self, sample: str) -> str:
        """Apply ``sample_name_rules`` in order (ont_SCL30014 gives SCL30014)."""
        name = sample
        for rule in self.sample_name_rules:
            name = re.sub(rule.pattern, rule.replace, name)
        return name


# palette.yaml ----------------------------------------------------------------


class SpeciesPalette(_Model):
    sequence: list[HexColor] = Field(min_length=8, max_length=8)
    other: HexColor


class DrugClass(_Model):
    key: str
    label_key: str
    color: HexColor
    match: list[str]


class EmbeddingMapPalette(_Model):
    species_lifted: list[HexColor] = Field(min_length=8, max_length=8)
    other: HexColor
    background: HexColor
    panel: HexColor
    rule: HexColor
    control_border: HexColor
    text: HexColor
    text_secondary: HexColor
    text_muted: HexColor


class PaletteConfig(_Model):
    """``config/palette.yaml`` (requirements §5.4)."""

    version: int
    species: SpeciesPalette
    drug_classes: list[DrugClass] = Field(min_length=14, max_length=14)
    contig_types: dict[str, HexColor]
    tracks: dict[str, HexColor]
    neighborhood_categories: dict[str, HexColor]
    embedding_map: EmbeddingMapPalette
    chrome: dict[str, HexColor]

    @model_validator(mode="after")
    def _check(self) -> PaletteConfig:
        keys = [d.key for d in self.drug_classes]
        if len(set(keys)) != len(keys):
            raise ValueError("drug class keys must be unique")
        if keys[-1] != "other":
            raise ValueError("the last drug class must be 'other'")
        if set(self.contig_types) != {"chromosome", "plasmid", "prophage", "unclassified"}:
            raise ValueError("contig_types must list chromosome, plasmid, prophage, unclassified")
        return self

    def section(self, name: str) -> dict[str, str]:
        """Return a flat color section by name, for palette references."""
        match name:
            case "contig_types":
                return self.contig_types
            case "tracks":
                return self.tracks
            case "neighborhood_categories":
                return self.neighborhood_categories
            case "chrome":
                return self.chrome
            case "embedding_map":
                dumped = self.embedding_map.model_dump()
                return {k: v for k, v in dumped.items() if isinstance(v, str)}
            case "species":
                return {"other": self.species.other}
            case _:
                raise KeyError(name)

    def resolve(self, ref: str) -> str:
        """Resolve a ``palette:<section>.<key>`` reference to its hex color."""
        m = _PALETTE_REF.match(ref)
        if m is None:
            raise KeyError(f"not a palette reference: {ref!r}")
        return self.section(m.group(1))[m.group(2)]


# design-tokens.yaml -------------------------------------------------------------


class Typography(_Model):
    families: dict[str, str]
    google_fonts_url: str
    sizes: dict[str, str]
    weights: dict[str, int]
    letter_spacing: dict[str, str]
    line_heights: dict[str, float] = Field(default_factory=dict[str, float])


class DesignTokens(_Model):
    """``config/design-tokens.yaml`` (requirements §7)."""

    version: int
    typography: Typography
    color: dict[str, str]
    spacing: dict[str, str]
    layout: dict[str, str]
    shape: dict[str, str]

    @model_validator(mode="after")
    def _check(self) -> DesignTokens:
        for name, ref in self.color.items():
            if not _PALETTE_REF.match(ref):
                raise ValueError(f"color token {name} must be a palette reference: {ref!r}")
        if set(self.typography.families) != {"serif", "sans", "mono"}:
            raise ValueError("typography.families must be serif, sans and mono")
        return self


# versions.yaml ----------------------------------------------------------------


class VersionsConfig(_Model):
    """``config/versions.yaml`` (CLAUDE.md, Toolchain pins)."""

    python: str
    node: str
    duckdb_python: str
    duckdb_wasm_npm: str
    duckdb_engine: str
    duckdb_engine_minor: str

    @model_validator(mode="after")
    def _check(self) -> VersionsConfig:
        engine_minor = ".".join(self.duckdb_engine.split(".")[:2])
        python_minor = ".".join(self.duckdb_python.split(".")[:2])
        if engine_minor != self.duckdb_engine_minor or python_minor != self.duckdb_engine_minor:
            raise ValueError("duckdb_python and duckdb_engine must share duckdb_engine_minor")
        return self


# typing_display.yaml -------------------------------------------------------------

DisplayGroup = Literal["typing", "virulence", "resistance_score", "allele"]
TypingTool = Literal["mlst", "kleborate", "sistr", "sccmec"]


class TypingChip(_Model):
    key: str
    display_group: DisplayGroup


class TypingToolDisplay(_Model):
    chips: list[TypingChip]
    display_groups: dict[str, DisplayGroup] = Field(default_factory=dict[str, DisplayGroup])
    default_display_group: DisplayGroup
    exclude: list[str] = Field(default_factory=list[str])

    def display_group(self, key: str) -> DisplayGroup:
        for chip in self.chips:
            if chip.key == key:
                return chip.display_group
        return self.display_groups.get(key, self.default_display_group)


class TypingDisplayConfig(_Model):
    """``config/typing_display.yaml`` (contract §5.9)."""

    version: int
    tools: dict[TypingTool, TypingToolDisplay]


# summary_templates.yaml -----------------------------------------------------------


class ArticleRule(_Model):
    default: str
    alternative: str
    an_before: list[str]


class Fact(_Model):
    source: str
    rule: str | None = None


class TemplateVariant(_Model):
    requires: list[str] = Field(default_factory=list[str])
    when: list[Condition] = Field(default_factory=list[Condition])
    text: str


class Template(TemplateVariant):
    id: str


class PhraseMatch(_Model):
    element_name: list[str] | None = None
    source_tool: str | None = None
    element_subtype: str | None = None
    drug_subclass: str | None = None


class PhraseRule(_Model):
    phrase: str
    match: list[PhraseMatch] = Field(min_length=1)


class SummaryTemplatesConfig(_Model):
    """``config/summary_templates.yaml`` (contract §7.4)."""

    version: int
    article: ArticleRule
    facts: dict[str, Fact]
    clauses: dict[str, list[TemplateVariant]]
    templates: list[Template] = Field(min_length=1)
    resistance_phrase: list[PhraseRule] = Field(min_length=1)

    @model_validator(mode="after")
    def _check(self) -> SummaryTemplatesConfig:
        known = set(self.facts) | set(self.clauses)
        variants: list[TemplateVariant] = list(self.templates)
        for clause in self.clauses.values():
            if clause[-1].requires or clause[-1].when:
                raise ValueError("the last variant of every clause must require nothing")
            variants.extend(clause)
        for variant in variants:
            for name in _PLACEHOLDER.findall(variant.text):
                if name not in known:
                    raise ValueError(f"unknown placeholder {{{name}}} in {variant.text!r}")
            for name in variant.requires:
                if name not in self.facts:
                    raise ValueError(f"unknown required fact {name!r}")
            for cond in variant.when:
                m = _CONDITION.match(cond)
                if m is None or m.group(1) not in self.facts:
                    raise ValueError(f"condition on an unknown fact: {cond!r}")
        last = self.templates[-1]
        if last.requires or last.when:
            raise ValueError("the last template must require nothing")
        ids = [t.id for t in self.templates]
        if len(set(ids)) != len(ids):
            raise ValueError("template ids must be unique")
        return self

    def template(self, template_id: str) -> Template:
        for t in self.templates:
            if t.id == template_id:
                return t
        raise KeyError(template_id)


# export-presets.yaml ---------------------------------------------------------------


class ExportPreset(_Model):
    key: str
    label_key: str
    formats: list[Literal["svg", "png"]]
    width_mm: float | None = None
    width_px: int | None = None
    height_px: int | None = None
    png_dpi: int | None = None
    png_scale: int | None = None
    backgrounds: list[Literal["light", "dark"]] | None = None
    applies_to: Literal["any"] | None = None


class SvgRules(_Model):
    text_as_text: bool
    declare_font_families: bool
    outline_text_option: bool


class DpiRules(_Model):
    standard: int
    high: int


class SlideRules(_Model):
    width_px: int
    height_px: int
    png_scale: int
    backgrounds: list[Literal["light", "dark"]]


class ExportRules(_Model):
    min_font_pt: float
    min_line_pt: float
    dpi: DpiRules
    slide: SlideRules
    svg: SvgRules
    background: str
    transparent_background_option: bool
    legend: str
    title: str
    interface_chrome: str
    sidecar_fields: list[str]


class ExportPresetsConfig(_Model):
    """``config/export-presets.yaml`` (requirements §8)."""

    version: int
    presets: list[ExportPreset] = Field(min_length=5, max_length=5)
    rules: ExportRules


# species_registry.yaml ----------------------------------------------------------


def _species_code(value: str) -> str:
    if not re.fullmatch(r"[A-Z]{3,5}", value):
        raise ValueError(f"species_code must be 3 to 5 uppercase letters: {value!r}")
    return value


SpeciesCode = Annotated[str, AfterValidator(_species_code)]


class SpeciesEntry(_Model):
    """One species of ``config/species_registry.yaml`` (contract §4.9)."""

    species_code: SpeciesCode
    canonical_name: str = Field(min_length=1)
    gtdb_name: str | None = None
    ncbi_taxid: int | None = Field(default=None, gt=0)
    aliases: list[str] = Field(default_factory=list[str])
    mlst_schemes: list[str] = Field(default_factory=list[str])
    pangenome_eligible: bool
    color_index: int | None = Field(ge=0)

    def names(self) -> list[str]:
        """Every name that maps to this species: canonical, GTDB and aliases."""
        out = [self.canonical_name, *self.aliases]
        if self.gtdb_name:
            out.append(self.gtdb_name)
        return out


class SpeciesRegistry(_Model):
    """``config/species_registry.yaml`` (contract §3.3, §4.9, §5.1 and §9).

    Validation fails on a duplicate species_code, a color_index used twice, and
    a name or MLST scheme that maps to two species. Names are compared without
    regard to case. The color_index range is checked against the palette by
    ``check_palette`` (``load_species_registry`` does both).
    """

    version: int
    species: list[SpeciesEntry] = Field(min_length=1)

    @model_validator(mode="after")
    def _check(self) -> SpeciesRegistry:
        codes = [s.species_code for s in self.species]
        if len(set(codes)) != len(codes):
            raise ValueError(f"duplicate species_code in {codes}")
        indices = [s.color_index for s in self.species if s.color_index is not None]
        if len(set(indices)) != len(indices):
            raise ValueError(f"a color_index is used by two species: {indices}")
        owner: dict[str, str] = {}
        for s in self.species:
            for name in {n.casefold() for n in s.names()}:
                if owner.setdefault(name, s.species_code) != s.species_code:
                    raise ValueError(f"name {name!r} maps to {owner[name]} and {s.species_code}")
        scheme_owner: dict[str, str] = {}
        for s in self.species:
            for scheme in s.mlst_schemes:
                if scheme_owner.setdefault(scheme, s.species_code) != s.species_code:
                    raise ValueError(
                        f"MLST scheme {scheme!r} maps to {scheme_owner[scheme]} and "
                        f"{s.species_code}"
                    )
        return self

    def check_palette(self, palette: PaletteConfig) -> None:
        """Every color_index must lie inside the palette's species sequence (§9)."""
        size = len(palette.species.sequence)
        for s in self.species:
            if s.color_index is not None and s.color_index >= size:
                raise ValueError(
                    f"{s.species_code}: color_index {s.color_index} is outside the "
                    f"palette's species sequence of {size} colors"
                )

    def get(self, species_code: str) -> SpeciesEntry:
        for s in self.species:
            if s.species_code == species_code:
                return s
        raise KeyError(species_code)

    def by_name(self, name: str) -> SpeciesEntry | None:
        """The species a canonical name, alias or GTDB name maps to, ignoring case."""
        key = name.casefold()
        for s in self.species:
            if key in {n.casefold() for n in s.names()}:
                return s
        return None

    def by_mlst_scheme(self, scheme: str) -> SpeciesEntry | None:
        for s in self.species:
            if scheme in s.mlst_schemes:
                return s
        return None

    def color(self, species_code: str, palette: PaletteConfig) -> str:
        """The species color: its palette sequence entry, or ``species.other`` when null."""
        index = self.get(species_code).color_index
        if index is None:
            return palette.species.other
        return palette.species.sequence[index]


# Loading ------------------------------------------------------------------------


def find_repository_root(start: Path | None = None) -> Path:
    """Walk up from ``start`` (default this file) to the directory holding CLAUDE.md or .git."""
    here = (start or Path(__file__)).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "CLAUDE.md").is_file() or (candidate / ".git").exists():
            return candidate
    raise ConfigError(f"no repository root (CLAUDE.md or .git) above {here}")


def config_dir() -> Path:
    """The configuration directory, honoring ``CATALEJO_CONFIG_DIR``."""
    override = os.environ.get(CONFIG_DIR_ENV)
    if override:
        return Path(override).resolve()
    return find_repository_root() / "config"


def _read_yaml(name: str, directory: Path | None) -> Any:
    path = (directory or config_dir()) / name
    if not path.is_file():
        raise ConfigError(f"missing configuration file: {path}")
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_platform(directory: Path | None = None) -> PlatformConfig:
    return PlatformConfig.model_validate(_read_yaml(PLATFORM_FILE, directory))


def load_palette(directory: Path | None = None) -> PaletteConfig:
    return PaletteConfig.model_validate(_read_yaml(PALETTE_FILE, directory))


def load_design_tokens(directory: Path | None = None) -> DesignTokens:
    """Load the design tokens and check every palette reference resolves."""
    tokens = DesignTokens.model_validate(_read_yaml(DESIGN_TOKENS_FILE, directory))
    palette = load_palette(directory)
    for name, ref in tokens.color.items():
        try:
            palette.resolve(ref)
        except KeyError as exc:
            raise ConfigError(f"design token color {name} does not resolve: {ref}") from exc
    return tokens


def load_versions(directory: Path | None = None) -> VersionsConfig:
    return VersionsConfig.model_validate(_read_yaml(VERSIONS_FILE, directory))


def load_typing_display(directory: Path | None = None) -> TypingDisplayConfig:
    return TypingDisplayConfig.model_validate(_read_yaml(TYPING_DISPLAY_FILE, directory))


def load_summary_templates(directory: Path | None = None) -> SummaryTemplatesConfig:
    return SummaryTemplatesConfig.model_validate(_read_yaml(SUMMARY_TEMPLATES_FILE, directory))


def load_export_presets(directory: Path | None = None) -> ExportPresetsConfig:
    return ExportPresetsConfig.model_validate(_read_yaml(EXPORT_PRESETS_FILE, directory))


@cache
def platform() -> PlatformConfig:
    """The platform configuration, loaded once per process."""
    return load_platform()


def load_species_registry(directory: Path | None = None) -> SpeciesRegistry:
    """Load the species registry and check its color indices against the palette."""
    registry = SpeciesRegistry.model_validate(_read_yaml(SPECIES_REGISTRY_FILE, directory))
    try:
        registry.check_palette(load_palette(directory))
    except ValueError as exc:
        raise ConfigError(str(exc)) from exc
    return registry
