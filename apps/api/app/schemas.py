"""Pydantic request and response shapes."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    created_at: datetime


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    status: str
    progress: float
    message: str | None
    source_size: int | None
    has_source: bool = False
    triangle_count: int | None
    object_count: int | None
    layer_count: int | None
    glb_bytes: int | None
    created_at: datetime
    converted_at: datetime | None


class VersionDetail(VersionOut):
    source_name: str | None = None
    glb_url: str | None = None
    scene_url: str | None = None
    objects_url: str | None = None


class SavedViewIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    hidden_layers: list[str] = Field(default_factory=list)
    hidden_materials: list[str] = Field(default_factory=list)
    sections: dict = Field(default_factory=dict)
    camera: dict = Field(default_factory=dict)
    created_on_version: str | None = None


class SavedViewOut(SavedViewIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class ScanRequest(BaseModel):
    delete_source: bool = False


class SourceFileOut(BaseModel):
    label: str
    bytes: int = 0


class ScanResult(BaseModel):
    projects: int
    versions: int
    queued: int
    message: str
    deletable_sources: list[SourceFileOut] = Field(default_factory=list)
    deletable_bytes: int = 0


class DeleteSourceResult(BaseModel):
    label: str
    freed_bytes: int
    message: str
