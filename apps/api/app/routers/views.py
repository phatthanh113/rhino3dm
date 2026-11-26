"""Saved layer views. Views belong to a project, so they can be reopened on
any version; layers are matched by their full path, not by an index.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import SavedView
from ..schemas import SavedViewIn, SavedViewOut
from .common import get_project

router = APIRouter(prefix="/api/projects/{slug}/views", tags=["views"])


def get_view(db: Session, project_id: int, view_id: int) -> SavedView:
    view = db.scalar(
        select(SavedView).where(
            SavedView.id == view_id,
            SavedView.project_id == project_id,
        )
    )
    if view is None:
        raise HTTPException(status_code=404, detail="Layer set not found")
    return view


@router.get("", response_model=list[SavedViewOut])
def list_views(slug: str, db: Session = Depends(get_db)):
    project = get_project(db, slug)
    return db.scalars(
        select(SavedView)
        .where(SavedView.project_id == project.id)
        .order_by(SavedView.created_at.desc())
    ).all()


@router.post("", response_model=SavedViewOut, status_code=201)
def create_view(slug: str, payload: SavedViewIn, db: Session = Depends(get_db)):
    project = get_project(db, slug)
    duplicate = db.scalar(
        select(SavedView).where(
            SavedView.project_id == project.id,
            SavedView.name == payload.name,
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Layer set name already exists")

    view = SavedView(project_id=project.id, **payload.model_dump())
    db.add(view)
    db.commit()
    db.refresh(view)
    return view


@router.put("/{view_id}", response_model=SavedViewOut)
def update_view(
    slug: str,
    view_id: int,
    payload: SavedViewIn,
    db: Session = Depends(get_db),
):
    project = get_project(db, slug)
    view = get_view(db, project.id, view_id)
    duplicate = db.scalar(
        select(SavedView).where(
            SavedView.project_id == project.id,
            SavedView.name == payload.name,
            SavedView.id != view_id,
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="Layer set name already exists")

    for field, value in payload.model_dump().items():
        setattr(view, field, value)
    db.commit()
    db.refresh(view)
    return view


@router.delete("/{view_id}", status_code=204)
def delete_view(slug: str, view_id: int, db: Session = Depends(get_db)):
    project = get_project(db, slug)
    view = get_view(db, project.id, view_id)
    db.delete(view)
    db.commit()
    return Response(status_code=204)
