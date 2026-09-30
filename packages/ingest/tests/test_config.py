"""Every configuration file loads and validates (ingest.config)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import yaml

from ingest import config


def test_every_config_file_loads(repo_root: Path) -> None:
    directory = repo_root / "config"
    assert config.config_dir() == directory
    for name in config.CONFIG_FILES:
        assert (directory / name).is_file(), name
    platform = config.load_platform()
    for accepted in ("SCL0421", "scl0421", "SP10", "SCL30014", "ont_SCL30014", "KP-12.3"):
        assert platform.genome_id_regex.match(accepted), accepted
    for refused in ("", "-SCL1", ".SCL1", "SCL 1", "SCL/1", "A" * 65):
        assert not platform.genome_id_regex.match(refused), refused
    assert platform.species_precedence == ["metadata", "gtdbtk", "mlst", "kraken2"]
    assert platform.thresholds.feature_mapping_overlap == 0.9
    assert platform.thresholds.cluster_mapping_shared == 0.5
    assert platform.qc.completeness_min == 95
    assert platform.qc.contamination_max == 5
    assert platform.umap.seed == 42
    config.load_palette()
    config.load_versions()
    config.load_typing_display()
    config.load_summary_templates()
    config.load_export_presets()


def test_design_token_colors_resolve_in_palette() -> None:
    tokens = config.load_design_tokens()
    palette = config.load_palette()
    for name, ref in tokens.color.items():
        assert palette.resolve(ref).startswith("#"), name


def test_unresolvable_palette_reference_fails(tmp_path: Path, repo_root: Path) -> None:
    for name in config.CONFIG_FILES:
        shutil.copy(repo_root / "config" / name, tmp_path / name)
    path = tmp_path / config.DESIGN_TOKENS_FILE
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["color"]["ink"] = "palette:chrome.missing_color"
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(config.ConfigError):
        config.load_design_tokens(tmp_path)


def test_config_dir_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(config.CONFIG_DIR_ENV, str(tmp_path))
    assert config.config_dir() == tmp_path.resolve()
    with pytest.raises(config.ConfigError):
        config.load_platform()


def test_summary_templates_include_contract_full_case() -> None:
    templates = config.load_summary_templates()
    full = templates.template("full").text
    assert full == (
        "A {resistance_phrase} {st} isolate from {isolation_site}, collected in {year}, with "
        "{completeness}% completeness and {contamination}% contamination. It carries "
        "{top_determinant} on a {plasmid_size} {replicon} plasmid together with {n_other} "
        "other resistance determinants{mutation_clause}, and belongs to a group of "
        "{cluster_size} {st} genomes in this release."
    )
    ids = [t.id for t in templates.templates]
    for fallback in ("no_plasmid", "no_resistance_no_plasmid", "draft_plasmid", "minimal"):
        assert fallback in ids
    phrases = [rule.phrase for rule in templates.resistance_phrase]
    assert phrases == [
        "carbapenem-resistant",
        "colistin-resistant",
        "ESBL-producing",
        "methicillin-resistant",
    ]


def test_typing_display_tools_and_groups() -> None:
    display = config.load_typing_display()
    assert set(display.tools) == {"mlst", "kleborate", "sistr", "sccmec"}
    kleborate = display.tools["kleborate"]
    assert [c.key for c in kleborate.chips] == [
        "K_locus",
        "O_locus",
        "virulence_score",
        "resistance_score",
    ]
    assert kleborate.display_group("gapA") == "allele"
    assert display.tools["mlst"].display_group("gapA") == "allele"


def test_export_presets_follow_requirements() -> None:
    presets = config.load_export_presets()
    widths = {p.key: p.width_mm for p in presets.presets if p.width_mm}
    assert widths == {"single_column": 89, "one_and_half_column": 120, "double_column": 183}
    assert presets.rules.min_font_pt == 7
    assert presets.rules.min_line_pt == 0.5
    assert (presets.rules.dpi.standard, presets.rules.dpi.high) == (300, 600)


@pytest.mark.parametrize(
    ("sample", "genome_id"),
    [
        ("ont_SCL30014", "SCL30014"),
        ("ont_SCL30014_", "SCL30014"),
        ("ONT_SCL30014", "SCL30014"),
        ("SCL29833", "SCL29833"),
        ("SP10", "SP10"),
        ("SCL29833_", "SCL29833"),
    ],
)
def test_sample_name_rules(sample: str, genome_id: str) -> None:
    assert config.load_platform().genome_id_from_sample(sample) == genome_id


def test_sample_name_rule_must_compile(tmp_path: Path, repo_root: Path) -> None:
    for name in config.CONFIG_FILES:
        shutil.copy(repo_root / "config" / name, tmp_path / name)
    path = tmp_path / config.PLATFORM_FILE
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["sample_name_rules"].append({"pattern": "(", "replace": ""})
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(ValueError):
        config.load_platform(tmp_path)


# Species registry (contract 0.7 §4.9 and §9) ------------------------------------------


def _registry_dir(tmp_path: Path, repo_root: Path, edit: object) -> Path:
    for name in config.CONFIG_FILES:
        shutil.copy(repo_root / "config" / name, tmp_path / name)
    path = tmp_path / config.SPECIES_REGISTRY_FILE
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert callable(edit)
    edit(data["species"])
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return tmp_path


def test_species_registry_loads() -> None:
    registry = config.load_species_registry()
    palette = config.load_palette()
    codes = [s.species_code for s in registry.species]
    assert codes[:3] == ["KPN", "SEN", "SAU"]
    assert [s.color_index for s in registry.species] == [0, 1, 2, 3, 4, 5, 6, 7, None, None]
    assert registry.color("KPN", palette) == palette.species.sequence[0]
    assert registry.color("EFM", palette) == palette.species.sequence[7]
    assert registry.color("SPN", palette) == palette.species.other
    assert registry.by_mlst_scheme("klebsiella") is registry.get("KPN")
    assert registry.by_name("salmonella ENTERICA") is registry.get("SEN")
    assert registry.by_name("Klebsiella pneumoniae subsp. pneumoniae") is registry.get("KPN")
    assert registry.by_name("Klebsiella variicola") is None


def _duplicate_code(species: list[dict[str, object]]) -> None:
    species[1]["species_code"] = species[0]["species_code"]


def _duplicate_color(species: list[dict[str, object]]) -> None:
    species[1]["color_index"] = species[0]["color_index"]


def _color_outside_palette(species: list[dict[str, object]]) -> None:
    species[-1]["color_index"] = 8


def _alias_on_two_species(species: list[dict[str, object]]) -> None:
    species[1]["aliases"] = [species[0]["canonical_name"]]


def _scheme_on_two_species(species: list[dict[str, object]]) -> None:
    species[2]["mlst_schemes"] = ["klebsiella"]


def _bad_code(species: list[dict[str, object]]) -> None:
    species[0]["species_code"] = "kpn"


@pytest.mark.parametrize(
    "edit",
    [
        _duplicate_code,
        _duplicate_color,
        _color_outside_palette,
        _alias_on_two_species,
        _scheme_on_two_species,
        _bad_code,
    ],
)
def test_species_registry_rejects(tmp_path: Path, repo_root: Path, edit: object) -> None:
    directory = _registry_dir(tmp_path, repo_root, edit)
    with pytest.raises((ValueError, config.ConfigError)):
        config.load_species_registry(directory)
