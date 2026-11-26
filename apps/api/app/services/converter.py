"""Run queued .3dm conversions, one at a time.

The web app never uploads a .3dm through the browser. The operator copies the
file into the version folder and presses "Scan again"; the scanner queues a job
and this worker turns the file into model.glb, scene.json and objects.json in
the same folder.

Only one conversion runs at a time: a 1 GB model needs about 2 GB of RAM while
it is being read, so running two would swap on the office server.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from ..config import settings
from ..db import SessionLocal
from ..models import ConversionJob, Version
from .scanner import delete_version_source, read_scene_summary

POLL_SECONDS = 2.0
PROGRESS_REFRESH_SECONDS = 1.5

# A converter line -> (progress, message shown in the version menu).
PROGRESS_STEPS: list[tuple[str, float, str]] = [
    ("reading ", 0.04, "Reading .3dm file"),
    ("loaded in", 0.18, "File loaded, building blocks"),
    ("block definitions cached", 0.30, "Collecting meshes by layer"),
    ("mesh bounds", 0.55, "Building the scene"),
    ("object records", 0.62, "Preparing the GLB"),
    ("writing GLB", 0.66, "Writing GLB"),
    ("GLB written", 0.90, "Writing objects.json"),
    ("objects.json", 0.94, "Writing scene.json"),
    ("layers with mesh", 0.98, "Finishing"),
]

_stop_event = threading.Event()
_worker_thread: threading.Thread | None = None


def start_worker() -> None:
    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        return
    reset_stale_jobs()
    _stop_event.clear()
    _worker_thread = threading.Thread(
        target=worker_loop,
        name="converter-3dm",
        daemon=True,
    )
    _worker_thread.start()


def stop_worker() -> None:
    _stop_event.set()
    if _worker_thread:
        _worker_thread.join(timeout=3)


def reset_stale_jobs() -> None:
    """A job left "running" belongs to a process that was stopped."""
    with SessionLocal() as db:
        running_jobs = db.scalars(
            select(ConversionJob).where(ConversionJob.status == "running")
        ).all()
        for job in running_jobs:
            job.status = "pending"
            job.message = "Queued again after restart"
        converting = db.scalars(
            select(Version).where(Version.status == "converting")
        ).all()
        for version in converting:
            version.status = "pending"
            version.progress = 0.0
            version.message = "Queued again after restart"
        db.commit()


def worker_loop() -> None:
    while not _stop_event.is_set():
        try:
            did_work = run_once()
        except Exception as error:  # keep the worker alive
            print(f"converter worker error: {error}", flush=True)
            did_work = False
        if not did_work:
            _stop_event.wait(POLL_SECONDS)


def run_once() -> bool:
    with SessionLocal() as db:
        job = db.scalar(
            select(ConversionJob)
            .where(ConversionJob.status == "pending")
            .order_by(ConversionJob.id)
        )
        if job is None:
            return False
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        version = db.get(Version, job.version_id)
        if version is None:
            job.status = "error"
            job.error = "Version was deleted"
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
            return True
        version.status = "converting"
        version.progress = 0.02
        version.message = "Preparing conversion"
        db.commit()
        job_id = job.id
        version_id = version.id
        source_path = version.source_path

    try:
        convert_version(job_id, version_id, source_path)
    except Exception as error:
        mark_failed(job_id, version_id, str(error))
    return True


def convert_version(
    job_id: int,
    version_id: int,
    source_path: str | None,
) -> None:
    source = Path(source_path) if source_path else None
    if source is None or not source.is_file():
        raise RuntimeError("No source.3dm file in the version folder")

    output_dir = source.parent
    python = settings.converter_python or sys.executable
    command = [
        python,
        "-u",
        str(settings.converter_script),
        "--source",
        str(source),
        "--output-dir",
        str(output_dir),
    ]
    process = subprocess.Popen(
        command,
        cwd=str(output_dir),
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    tail: list[str] = []
    last_update = 0.0
    assert process.stdout is not None
    for raw_line in process.stdout:
        line = raw_line.strip()
        if not line:
            continue
        tail.append(line)
        tail = tail[-12:]
        step = match_progress(line)
        if step is None:
            continue
        progress, message = step
        if time.time() - last_update < PROGRESS_REFRESH_SECONDS:
            continue
        last_update = time.time()
        update_version(version_id, progress, message)

    exit_code = process.wait()
    if exit_code != 0:
        detail = tail[-1] if tail else "no output"
        raise RuntimeError(f"Converter stopped with exit code {exit_code}: {detail}")

    glb_path = output_dir / "model.glb"
    scene_path = output_dir / "scene.json"
    objects_path = output_dir / "objects.json"
    missing = [
        path.name
        for path in (glb_path, scene_path, objects_path)
        if not path.is_file()
    ]
    if missing:
        raise RuntimeError(f"Missing files after conversion: {', '.join(missing)}")

    summary = read_scene_summary(scene_path, glb_path)
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        version = db.get(Version, version_id)
        if version is not None:
            version.glb_path = str(glb_path)
            version.scene_path = str(scene_path)
            version.objects_path = str(objects_path)
            version.triangle_count = summary.get("triangle_count")
            version.object_count = summary.get("object_count")
            version.layer_count = summary.get("layer_count")
            version.glb_bytes = summary.get("glb_bytes")
            if version.source_size is None:
                version.source_size = summary.get("source_size_bytes")
            version.status = "ready"
            version.progress = 1.0
            version.message = "Ready"
            version.converted_at = now
            if version.delete_source_after:
                try:
                    freed = delete_version_source(version)
                    if freed:
                        print(
                            f"removed the source .3dm of {version.label} "
                            f"({freed} bytes)",
                            flush=True,
                        )
                except (OSError, ValueError) as error:
                    print(
                        f"could not remove the source .3dm: {error}",
                        flush=True,
                    )
        job = db.get(ConversionJob, job_id)
        if job is not None:
            job.status = "success"
            job.progress = 1.0
            job.message = "Conversion finished"
            job.finished_at = now
        db.commit()


def match_progress(line: str) -> tuple[float, str] | None:
    for keyword, progress, message in PROGRESS_STEPS:
        if keyword in line:
            return progress, message
    return None


def update_version(version_id: int, progress: float, message: str) -> None:
    with SessionLocal() as db:
        version = db.get(Version, version_id)
        if version is None or version.status != "converting":
            return
        version.progress = progress
        version.message = message
        db.commit()


def friendly_error(error_text: str) -> str:
    known = [
        (
            "empty scenes",
            "The file has no mesh or extrusion to export. Run _Mesh on the Breps in Rhino, then save again.",
        ),
        (
            "could not read this file",
            "rhino3dm could not read this .3dm file.",
        ),
        (
            "No module named",
            "The server is missing a Python library for the converter.",
        ),
    ]
    for keyword, message in known:
        if keyword in error_text:
            return message
    lines = [line.strip() for line in error_text.strip().splitlines() if line.strip()]
    return (lines[-1] if lines else "Conversion failed")[:400]


def mark_failed(job_id: int, version_id: int, error_text: str) -> None:
    now = datetime.now(timezone.utc)
    message = friendly_error(error_text)
    with SessionLocal() as db:
        version = db.get(Version, version_id)
        if version is not None:
            version.status = "error"
            version.progress = 0.0
            version.message = message
        job = db.get(ConversionJob, job_id)
        if job is not None:
            job.status = "error"
            job.error = error_text[-4000:]
            job.message = message
            job.finished_at = now
        db.commit()
    print(f"conversion failed: {message}", flush=True)
