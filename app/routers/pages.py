"""HTML page routes."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.features import FEATURES, FEATURES_BY_SLUG
from app.services.history import supports as history_supported
from app.templating import templates

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request, "index.html", {"active": "home"})


@router.get("/features/{slug}", response_class=HTMLResponse)
async def feature_page(request: Request, slug: str):
    feature = FEATURES_BY_SLUG.get(slug)
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")
    idx = FEATURES.index(feature)
    return templates.TemplateResponse(request, "feature.html", {
        "active": slug,
        "feature": feature,
        "history_enabled": history_supported(slug),
        "prev_feature": FEATURES[idx - 1] if idx > 0 else None,
        "next_feature": FEATURES[idx + 1] if idx < len(FEATURES) - 1 else None,
    })
