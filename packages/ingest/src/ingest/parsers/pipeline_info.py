"""Pipeline information parser (contract §4.1, feeding §5.15 ``tool_version``).

``pipeline_info/software_versions.yml`` (nf-core convention) maps each
Nextflow process to the versions of the tools it ran. The platform reads the
entry of each process ``mgap_layout.software_version_keys()`` knows, taking
the tool's own key (``pigz`` beside ``kraken2`` is ignored), the AMRFinderPlus
database version under ``amrfinderplus-database``, and the pipeline version
from the ``Workflow`` entry. An empty version (``rgi:`` in mgap 2.0.0) is
None. The file is run-level; per-genome sources take precedence (§4.1).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ingest import mgap_layout as L
from ingest.parsers._io import optional, read_versions_yml


@dataclass(frozen=True)
class PipelineVersions:
    tools: dict[str, str | None]  # tool -> version, for every known process present
    databases: dict[str, str]  # tool -> database version
    pipeline_version: str | None
    nextflow_version: str | None

    def version(self, tool: str) -> str | None:
        return self.tools.get(tool)

    def has(self, tool: str) -> bool:
        return tool in self.tools


EMPTY = PipelineVersions(tools={}, databases={}, pipeline_version=None, nextflow_version=None)


def parse_pipeline_info(results_dir: Path) -> PipelineVersions | None:
    """Run-level versions, or None when the results carry no ``software_versions.yml``."""
    pi = L.PIPELINE_INFO
    path = pi.software_versions.resolve(results_dir)
    if not path.is_file():
        return None
    data = read_versions_yml(path)
    tools: dict[str, str | None] = {}
    for process, tool in sorted(L.software_version_keys().items()):
        entry = data.get(process)
        if entry is None or tool not in entry:
            continue
        version = optional(entry[tool])
        if tools.get(tool) is None:
            tools[tool] = version
    databases: dict[str, str] = {}
    amr = data.get(L.AMRFINDERPLUS.process, {})
    database = optional(amr.get(L.AMRFINDERPLUS.database_key, ""))
    if database is not None:
        databases[L.AMRFINDERPLUS.tool] = database
    workflow = data.get(pi.workflow_key, {})
    return PipelineVersions(
        tools=tools,
        databases=databases,
        pipeline_version=optional(workflow.get(pi.pipeline_key, "")),
        nextflow_version=optional(workflow.get(pi.nextflow_key, "")),
    )
