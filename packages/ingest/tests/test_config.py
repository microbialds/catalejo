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
    assert platform.genome_id_regex.match("SCL0421")
    assert not platform.genome_id_regex.match("scl0421")
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
