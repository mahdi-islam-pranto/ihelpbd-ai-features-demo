from fastapi.templating import Jinja2Templates

from app import config
from app.features import FEATURES, features_by_category

STATIC_DIR = config.APP_DIR / "static"


def asset(path: str) -> str:
    """URL of a static file with ?v=<modified time>, so browsers fetch the
    new version as soon as the file changes instead of using a stale cache."""
    try:
        version = int((STATIC_DIR / path).stat().st_mtime)
    except OSError:
        version = 0
    return f"/static/{path}?v={version}"


templates = Jinja2Templates(directory=str(config.APP_DIR / "templates"))
templates.env.globals.update(
    app_name=config.APP_NAME,
    company_name=config.COMPANY_NAME,
    features=FEATURES,
    features_by_category=features_by_category,
    asset=asset,
)
