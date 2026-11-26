"""Scan the data folder and keep the database in sync.

The folder is the source of truth:

    data/projects/<project>/versions/<version>/source.3dm

A version is ready when model.glb, scene.json and objects.json exist. When a
source file is new, or newer than the GLB, a conversion job is queued. No
browser upload is involved; the operator copies files on the server and presses
"Quet lai" in the web UI.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import ConversionJob, Project, Version


@dataclass
class ScanSummary:
    projects: int = 0
    versions: int = 0
    queued: int = 0


def natural_key(label: str) -> list:
    """Sort v2 before v10 instead of alphabetically."""
    return [int(part) if part.isdigit() else part.lower()
            for part in re.split(r"(\d+)", label)]


def ensure_project(db: Session, slug: str, name: str | None = None) -> Project:
    project = db.scalar(select(Project).where(Project.slug == slug))
    if project is None:
        project = Project(slug=slug, name=name or slug)
        db.add(project)
        db.flush()
    return project


def find_source(version_dir: Path) -> Path | None:
    preferred = version_dir / "source.3dm"
    if preferred.exists():
        return preferred
    candidates = sorted(version_dir.glob("*.3dm"))
    return candidates[0] if candidates else None


def delete_version_source(version: Version) -> int:
    """Remove a converted version's .3dm file and return the bytes freed.

    The file name is remembered in scene.json, so the UI still shows the
    original name after the source is gone.
    """
    path = Path(version.source_path) if version.source_path else None
    freed = 0
    if path is not None and path.is_file():
        resolved = path.resolve()
        data_root = settings.data_dir.resolve()
        if resolved.suffix.lower() != ".3dm" or not resolved.is_relative_to(data_root):
            raise ValueError("Refusing to delete a file outside the data folder")
        freed = resolved.stat().st_size
        resolved.unlink()
    if freed and version.source_size is None:
        version.source_size = freed
    version.source_path = None
    version.source_mtime = None
    version.delete_source_after = False
    return freed


def deletable_sources(db: Session, project: Project) -> list[tuple[str, int]]:
    """Ready versions that still keep their .3dm file on disk."""
    versions = db.scalars(
        select(Version).where(
            Version.project_id == project.id,
            Version.status == "ready",
            Version.source_path.is_not(None),
        )
    ).all()
    found: list[tuple[str, int]] = []
    for version in versions:
        path = Path(version.source_path) if version.source_path else None
        if path is not None and path.is_file():
            found.append((version.label, path.stat().st_size))
    return sorted(found, key=lambda item: natural_key(item[0]))


def read_scene_summary(scene_path: Path, glb_path: Path) -> dict:
    try:
        data = json.loads(scene_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    totals = data.get("totals", {})
    return {
        "triangle_count": int(totals.get("triangles") or 0),
        "object_count": int(totals.get("objects") or 0),
        "layer_count": len(data.get("layers", [])),
        "glb_bytes": glb_path.stat().st_size if glb_path.exists() else totals.get("glb_bytes"),
        "source_size_bytes": int(data.get("source_size_bytes") or 0) or None,
    }


def queue_conversion(db: Session, version: Version, message: str) -> bool:
    """Queue one job per version; return True when a new job was added."""
    active_job = db.scalar(
        select(ConversionJob).where(
            ConversionJob.version_id == version.id,
            ConversionJob.status.in_(["pending", "running"]),
        )
    )
    version.status = "pending"
    version.progress = 0.0
    version.message = message
    if active_job is not None:
        return False
    db.add(ConversionJob(version_id=version.id))
    return True


def scan_version(db: Session, project: Project, version_dir: Path) -> bool:
    """Sync one version folder. Return True when a conversion was queued."""
    label = version_dir.name
    source = find_source(version_dir)
    glb_path = version_dir / "model.glb"
    scene_path = version_dir / "scene.json"
    objects_path = version_dir / "objects.json"

    version = db.scalar(
        select(Version).where(
            Version.project_id == project.id,
            Version.label == label,
        )
    )
    if version is None:
        version = Version(project_id=project.id, label=label)
        db.add(version)
        db.flush()

    if version.status == "converting":
        return False

    version.source_path = str(source) if source else None
    version.glb_path = str(glb_path) if glb_path.exists() else None
    version.scene_path = str(scene_path) if scene_path.exists() else None
    version.objects_path = str(objects_path) if objects_path.exists() else None
    if source:
        source_stat = source.stat()
        version.source_size = source_stat.st_size
        version.source_mtime = source_stat.st_mtime

    has_glb = glb_path.exists()
    has_scene = scene_path.exists()
    has_objects = objects_path.exists()

    if has_glb and has_scene and has_objects:
        # A pre-converted version is valid even when source.3dm is absent.
        source_is_newer = (
            source is not None
            and glb_path.stat().st_mtime + 1 < source.stat().st_mtime
        )
        if source_is_newer:
            return queue_conversion(db, version, "source is newer than the GLB, queued for reconversion")
        summary = read_scene_summary(scene_path, glb_path)
        version.triangle_count = summary.get("triangle_count")
        version.object_count = summary.get("object_count")
        version.layer_count = summary.get("layer_count")
        version.glb_bytes = summary.get("glb_bytes")
        if version.source_size is None:
            version.source_size = summary.get("source_size_bytes")
        version.status = "ready"
        version.progress = 1.0
        version.message = "Ready" if source else "Ready (existing GLB)"
        return False

    if source:
        return queue_conversion(db, version, "Waiting to convert")

    version.status = "error"
    version.message = "Missing source.3dm or model.glb"
    return False


def scan_all(db: Session, delete_source: bool = False) -> ScanSummary:
    settings.ensure_dirs()
    summary = ScanSummary()

    default_dir = settings.projects_dir / settings.default_project
    (default_dir / "versions").mkdir(parents=True, exist_ok=True)

    project_dirs = sorted(
        (item for item in settings.projects_dir.iterdir() if item.is_dir()),
        key=lambda item: item.name.lower(),
    )
    for project_dir in project_dirs:
        if project_dir.name.startswith("."):
            continue
        project = ensure_project(db, project_dir.name, project_dir.name)
        summary.projects += 1

        versions_dir = project_dir / "versions"
        if not versions_dir.is_dir():
            continue
        version_dirs = sorted(
            (item for item in versions_dir.iterdir() if item.is_dir()),
            key=lambda item: natural_key(item.name),
        )
        for version_dir in version_dirs:
            if version_dir.name.startswith("."):
                continue
            summary.versions += 1
            if scan_version(db, project, version_dir):
                summary.queued += 1

        if delete_source:
            # Remember the choice for every conversion that is waiting or
            # running; the worker removes the .3dm after a successful run.
            db.flush()
            waiting = db.scalars(
                select(Version).where(
                    Version.project_id == project.id,
                    Version.source_path.is_not(None),
                    Version.status.in_(["pending", "converting"]),
                )
            ).all()
            for version in waiting:
                version.delete_source_after = True

    db.commit()
    return summary
