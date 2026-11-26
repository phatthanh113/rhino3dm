"""Project routes: list, scan, detail."""

import re

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Project
from ..schemas import ProjectOut, ScanRequest, ScanResult, SourceFileOut
from ..services.scanner import (
    deletable_sources,
    ensure_project,
    scan_all,
)
from .common import get_project

router = APIRouter(prefix="/api/projects", tags=["projects"])
SLUG_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).order_by(Project.slug).all()
    if not projects:
        project = ensure_project(db, settings.default_project, settings.default_project)
        db.commit()
        projects = [project]
    return projects


@router.post("/{slug}/scan", response_model=ScanResult)
def scan_project(
    slug: str,
    payload: ScanRequest | None = None,
    db: Session = Depends(get_db),
):
    if not SLUG_PATTERN.match(slug):
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Invalid project name")

    project_dir = settings.projects_dir / slug
    (project_dir / "versions").mkdir(parents=True, exist_ok=True)
    ensure_project(db, slug, slug)
    db.commit()

    delete_source = bool(payload and payload.delete_source)
    summary = scan_all(db, delete_source=delete_source)
    project = get_project(db, slug)
    candidates = deletable_sources(db, project)
    deletable_bytes = sum(size for _, size in candidates)
    message = (
        f"Scanned {summary.projects} projects, {summary.versions} versions"
        + (f", queued {summary.queued} for conversion" if summary.queued else "")
    )
    return ScanResult(
        projects=summary.projects,
        versions=summary.versions,
        queued=summary.queued,
        message=message,
        deletable_sources=[
            SourceFileOut(label=label, bytes=size) for label, size in candidates
        ],
        deletable_bytes=deletable_bytes,
    )


@router.get("/{slug}", response_model=ProjectOut)
def project_detail(slug: str, db: Session = Depends(get_db)):
    return get_project(db, slug)
