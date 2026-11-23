"""JSON API used by the frontend. The browser never talks to the AI APIs
directly - it goes through here so API keys stay on the server."""
import json
import mimetypes

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import (AUDIO_EXTENSIONS, CRM_EXTENSIONS, SAMPLE_CRM_DIR,
                        SAMPLE_RECORDINGS_DIR)
from app.features import FEATURES, FEATURES_BY_SLUG
from app.services.api_client import RunInput, UpstreamError, run_feature

router = APIRouter(prefix="/api")

SAMPLE_KINDS = {
    "recordings": (SAMPLE_RECORDINGS_DIR, AUDIO_EXTENSIONS),
    "crm": (SAMPLE_CRM_DIR, CRM_EXTENSIONS),
}

MAX_UPLOAD_MB = 100


@router.get("/features")
async def list_features():
    return [f.public_dict() for f in FEATURES]


@router.get("/samples/{kind}")
async def list_samples(kind: str):
    if kind not in SAMPLE_KINDS:
        raise HTTPException(404, "Unknown sample type")
    folder, exts = SAMPLE_KINDS[kind]
    if not folder.exists():
        return []
    return [
        {"name": p.name, "url": f"/samples/{kind}/{p.name}", "size": p.stat().st_size}
        for p in sorted(folder.iterdir())
        if p.is_file() and p.suffix.lower() in exts
    ]


def _load_sample(kind: str, name: str) -> tuple[bytes, str, str]:
    folder, exts = SAMPLE_KINDS[kind]
    path = (folder / name).resolve()
    # prevent path traversal outside the sample folder
    if path.parent != folder.resolve() or not path.is_file() or path.suffix.lower() not in exts:
        raise HTTPException(404, "Sample file not found")
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return path.read_bytes(), path.name, ctype


@router.post("/features/{slug}/run")
async def run(
    slug: str,
    file: UploadFile | None = File(None),
    sample: str | None = Form(None),
    sample_kind: str | None = Form(None),
    params: str = Form("{}"),
):
    feature = FEATURES_BY_SLUG.get(slug)
    if not feature:
        raise HTTPException(404, "Feature not found")

    try:
        parsed = json.loads(params or "{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid params JSON")

    file_bytes = filename = ctype = None
    if file is not None and file.filename:
        file_bytes = await file.read()
        if len(file_bytes) > MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(413, f"File too large (max {MAX_UPLOAD_MB} MB)")
        filename, ctype = file.filename, file.content_type
    elif sample:
        sample_kind = sample_kind or feature.file_kind
        if sample_kind not in SAMPLE_KINDS:
            raise HTTPException(400, "Unknown sample type")
        file_bytes, filename, ctype = _load_sample(sample_kind, sample)

    if feature.file_required and file_bytes is None:
        raise HTTPException(400, "Please upload a file or choose a sample.")
    for f in feature.form_fields:
        if f.get("required") and not str(parsed.get(f["name"], "")).strip():
            raise HTTPException(400, f"'{f['label']}' is required.")

    try:
        return await run_feature(feature, RunInput(parsed, file_bytes, filename, ctype))
    except UpstreamError as exc:
        raise HTTPException(exc.status_code if exc.status_code >= 400 else 502, str(exc))
