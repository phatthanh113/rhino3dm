"""Database tables for the MVP.

The data folder is still the source of truth for .3dm and GLB files. These
tables only index what is on disk, plus the saved layer views.
"""

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    versions: Mapped[list["Version"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Version.label",
    )
    views: Mapped[list["SavedView"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="SavedView.created_at",
    )


class Version(Base):
    __tablename__ = "versions"
    __table_args__ = (
        UniqueConstraint("project_id", "label", name="uq_version_project_label"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(120))
    source_path: Mapped[str | None] = mapped_column(String(1024))
    glb_path: Mapped[str | None] = mapped_column(String(1024))
    scene_path: Mapped[str | None] = mapped_column(String(1024))
    objects_path: Mapped[str | None] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(String(500))
    source_size: Mapped[int | None] = mapped_column(Integer)
    source_mtime: Mapped[float | None] = mapped_column(Float)
    delete_source_after: Mapped[bool] = mapped_column(default=False)
    triangle_count: Mapped[int | None] = mapped_column(Integer)
    object_count: Mapped[int | None] = mapped_column(Integer)
    layer_count: Mapped[int | None] = mapped_column(Integer)
    glb_bytes: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped[Project] = relationship(back_populates="versions")
    jobs: Mapped[list["ConversionJob"]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
    )

    @property
    def has_source(self) -> bool:
        """True while the original .3dm is still on disk."""
        return bool(self.source_path and Path(self.source_path).is_file())


class ConversionJob(Base):
    __tablename__ = "conversion_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("versions.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(String(500))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    version: Mapped[Version] = relationship(back_populates="jobs")


class SavedView(Base):
    __tablename__ = "saved_views"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_view_project_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    hidden_layers: Mapped[list] = mapped_column(JSON, default=list)
    hidden_materials: Mapped[list] = mapped_column(JSON, default=list)
    sections: Mapped[dict] = mapped_column(JSON, default=dict)
    camera: Mapped[dict] = mapped_column(JSON, default=dict)
    created_on_version: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    project: Mapped[Project] = relationship(back_populates="views")
