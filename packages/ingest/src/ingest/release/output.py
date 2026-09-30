"""Release output directory, marker and timestamp (contract §6, §6.4).

A release directory holds the marker ``.catalejo-release``. ``release build``
replaces its output only when the directory holds the marker or is empty, so
it never deletes an unrelated directory. A full build keeps the
subdirectories named after the catalog's access groups, which hold the group
releases (milestone 1a plan, decision 12).

The manifest's ``created`` and ``checks.validated_at`` share one timestamp,
``SOURCE_DATE_EPOCH`` when it is set (the reproducible-builds convention),
else the current time in UTC.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

from ingest import __version__

MARKER = ".catalejo-release"
EPOCH_ENV = "SOURCE_DATE_EPOCH"


class ReleaseError(Exception):
    """The release cannot be built."""


def timestamp() -> str:
    epoch = os.environ.get(EPOCH_ENV)
    moment = datetime.fromtimestamp(int(epoch), UTC) if epoch else datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _replaceable(path: Path) -> bool:
    return (path / MARKER).is_file() or not any(path.iterdir())


def prepare(target: Path, keep: Iterable[str] = ()) -> Path:
    """Empty ``target`` (keeping subdirectories named in ``keep``) and mark it."""
    if target.exists():
        if not target.is_dir():
            raise ReleaseError(f"refusing to replace {target}: it is not a directory")
        if not _replaceable(target):
            raise ReleaseError(
                f"refusing to replace {target}: it is not empty and has no {MARKER} marker"
            )
        kept = set(keep)
        for child in target.iterdir():
            if child.is_dir() and child.name in kept:
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    target.mkdir(parents=True, exist_ok=True)
    (target / MARKER).write_text(f"catalejo release {__version__}\n", encoding="utf-8")
    return target


def mark_root(root: Path) -> None:
    """Create the release root of a group build when it does not exist yet."""
    if root.exists() and not _replaceable(root):
        raise ReleaseError(f"refusing to write into {root}: it has no {MARKER} marker")
    root.mkdir(parents=True, exist_ok=True)
    (root / MARKER).write_text(f"catalejo release {__version__}\n", encoding="utf-8")
