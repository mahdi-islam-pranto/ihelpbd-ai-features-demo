"""iHelp AI Demo Platform - FastAPI entry point.

Run:  uvicorn app.main:app --reload
"""
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import config
from app.routers import api, pages
from app.templating import templates

app = FastAPI(title=config.APP_NAME, docs_url="/api/docs", redoc_url=None)

app.mount("/static", StaticFiles(directory=config.APP_DIR / "static"), name="static")

config.SAMPLE_RECORDINGS_DIR.mkdir(exist_ok=True)
config.SAMPLE_CRM_DIR.mkdir(exist_ok=True)
app.mount("/samples/recordings", StaticFiles(directory=config.SAMPLE_RECORDINGS_DIR), name="sample-recordings")
app.mount("/samples/crm", StaticFiles(directory=config.SAMPLE_CRM_DIR), name="sample-crm")

app.include_router(pages.router)
app.include_router(api.router)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    if request.url.path.startswith("/api"):
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return templates.TemplateResponse(request, "404.html", {"active": None},
                                      status_code=exc.status_code)
