"""FastAPI entry point.

Run from apps/api:
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import APP_ROOT, settings
from .db import SessionLocal, init_db
from .routers import projects, versions, views
from .services.converter import start_worker, stop_worker
from .services.scanner import scan_all

WEB_DIST = APP_ROOT / "apps" / "web" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    init_db()
    with SessionLocal() as db:
        scan_all(db)
    start_worker()
    yield
    stop_worker()


app = FastAPI(title="RhinoView API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(versions.router)
app.include_router(views.router)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "data_dir": str(settings.data_dir),
        "default_project": settings.default_project,
    }


if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
