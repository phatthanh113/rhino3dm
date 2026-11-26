"""Shared router helpers."""

import json
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Project, Version
from ..services.scanner import natural_key


def get_project(db: Session, slug: str) -> Project:
    project = db.scalar(select(Project).where(Project.slug == slug))
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project {slug} not found")
    return project


def get_version(db: Session, project: Project, label: str) -> Version:
    version = db.scalar(
        select(Version).where(
            Version.project_id == project.id,
            Version.label == label,
        )
    )
    if version is None:
        raise HTTPException(status_code=404, detail=f"Version {label} not found")
    return version


def sorted_versions(project: Project) -> list[Version]:
    return sorted(project.versions, key=lambda item: natural_key(item.label))


def version_source_name(version: Version) -> str | None:
    if version.source_path:
        return Path(version.source_path).name
    if version.scene_path and Path(version.scene_path).is_file():
        try:
            data = json.loads(Path(version.scene_path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return data.get("source_file")
    return None
