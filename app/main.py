"""iHelp AI Demo Platform - FastAPI entry point.

Run:  uvicorn app.main:app --reload
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import config
from app.db import database
from app.routers import api, pages
from app.templating import templates

logging.basicConfig(level=logging.INFO, format="%(levelname)s:  [%(name)s] %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Create the database / tables on startup. If MySQL is down the app still
    # starts; history is disabled until the connection succeeds.
    await run_in_threadpool(database.ensure_db)
    yield


app = FastAPI(title=config.APP_NAME, docs_url="/api/docs", redoc_url=None, lifespan=lifespan)

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
