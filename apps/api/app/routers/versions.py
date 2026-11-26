"""Version routes and generated-file delivery."""

from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Version
from ..schemas import DeleteSourceResult, VersionDetail, VersionOut
from ..services.scanner import delete_version_source
from .common import get_project, get_version, sorted_versions, version_source_name

router = APIRouter(prefix="/api/projects/{slug}/versions", tags=["versions"])


def file_token(path_value: str | None) -> str:
    """Cache-busting token: changes when the file is reconverted."""
    if not path_value:
        return "0"
    try:
        return str(int(Path(path_value).stat().st_mtime))
    except OSError:
        return "0"


def version_detail(project_slug: str, version: Version) -> VersionDetail:
    detail = VersionDetail.model_validate(version)
    detail.source_name = version_source_name(version)
    base = f"/api/projects/{quote(project_slug)}/versions/{quote(version.label)}"
    if version.glb_path and Path(version.glb_path).is_file():
        detail.glb_url = f"{base}/model.glb?v={file_token(version.glb_path)}"
    if version.scene_path and Path(version.scene_path).is_file():
        detail.scene_url = f"{base}/scene.json?v={file_token(version.scene_path)}"
    if version.objects_path and Path(version.objects_path).is_file():
        detail.objects_url = (
            f"{base}/objects.json?v={file_token(version.objects_path)}"
        )
    return detail


def serve_file(path_value: str | None, media_type: str) -> FileResponse:
    if not path_value:
        raise HTTPException(status_code=404, detail="File is not ready")
    path = Path(path_value).resolve()
    data_root = settings.data_dir.resolve()
    if not path.is_file() or not path.is_relative_to(data_root):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("", response_model=list[VersionOut])
def list_versions(slug: str, db: Session = Depends(get_db)):
    project = get_project(db, slug)
    return sorted_versions(project)


@router.get("/{label}", response_model=VersionDetail)
def version_detail_route(slug: str, label: str, db: Session = Depends(get_db)):
    project = get_project(db, slug)
    version = get_version(db, project, label)
    return version_detail(project.slug, version)


@router.post("/{label}/delete-source", response_model=DeleteSourceResult)
def delete_source_route(slug: str, label: str, db: Session = Depends(get_db)):
    """Remove the .3dm of a converted version to save disk space."""
    project = get_project(db, slug)
    version = get_version(db, project, label)
    if version.status != "ready":
        raise HTTPException(
            status_code=409,
            detail="Wait until the conversion has finished",
        )
    if not version.has_source:
        raise HTTPException(
            status_code=404,
            detail="This version has no .3dm file",
        )
    try:
        freed = delete_version_source(version)
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    db.commit()
    return DeleteSourceResult(
        label=label,
        freed_bytes=freed,
        message=f"Deleted the .3dm file of {label}",
    )


@router.get("/{label}/model.glb")
def version_glb(slug: str, label: str, db: Session = Depends(get_db)):
    project = get_project(db, slug)
    version = get_version(db, project, label)
    return serve_file(version.glb_path, "model/gltf-binary")


@router.get("/{label}/scene.json")
def version_scene(slug: str, label: str, db: Session = Depends(get_db)):
    project = get_project(db, slug)
    version = get_version(db, project, label)
    return serve_file(version.scene_path, "application/json")


@router.get("/{label}/objects.json")
def version_objects(slug: str, label: str, db: Session = Depends(get_db)):
    project = get_project(db, slug)
    version = get_version(db, project, label)
    return serve_file(version.objects_path, "application/json")
